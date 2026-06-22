// Cloudflare Worker: Slack Events API -> Supabase -> Compass candidates.
//
// Required environment variables:
// - SLACK_SIGNING_SECRET
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY
// Optional:
// - SLACK_CHANNEL_ID  // 08_新規振分けだけに絞る場合

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return json({ ok: true, service: "Compass Slack DB ingest" });
    }

    const rawBody = await request.text();
    let payload = {};
    try {
      payload = JSON.parse(rawBody || "{}");
    } catch {
      return json({ ok: false, error: "invalid_json" }, 400);
    }

    if (payload.type === "url_verification") {
      return new Response(payload.challenge || "", {
        headers: { "content-type": "text/plain;charset=utf-8" }
      });
    }

    const signatureOk = await verifySlackSignature(request, rawBody, env.SLACK_SIGNING_SECRET);
    if (!signatureOk) return json({ ok: false, error: "invalid_signature" }, 401);

    const event = payload.event || {};
    if (event.type !== "message") return json({ ok: true, ignored: "event_type" });
    if (env.SLACK_CHANNEL_ID && event.channel !== env.SLACK_CHANNEL_ID) {
      return json({ ok: true, ignored: "channel" });
    }
    if (event.subtype && !["bot_message"].includes(event.subtype)) {
      return json({ ok: true, ignored: "subtype" });
    }

    const text = slackEventText(event);
    const parsed = parseCandidate(text, event, payload);
    if (!parsed.name && !parsed.phone) return json({ ok: true, ignored: "no_candidate" });

    const result = await upsertCandidate(parsed, env);
    return json({ ok: true, candidate: result });
  }
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json;charset=utf-8" }
  });
}

async function verifySlackSignature(request, rawBody, signingSecret) {
  if (!signingSecret) return false;
  const timestamp = request.headers.get("x-slack-request-timestamp") || "";
  const signature = request.headers.get("x-slack-signature") || "";
  if (!timestamp || !signature) return false;
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;

  const base = `v0:${timestamp}:${rawBody}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(base));
  const expected = "v0=" + [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  return timingSafeEqual(expected, signature);
}

function timingSafeEqual(a, b) {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

function slackEventText(event) {
  const parts = [];
  collectSlackText(event.blocks || [], parts);
  if (event.text) parts.push(event.text);
  return normalizeSlackText(parts.join("\n"));
}

function collectSlackText(node, parts) {
  if (!node) return;
  if (Array.isArray(node)) {
    node.forEach(item => collectSlackText(item, parts));
    return;
  }
  if (typeof node !== "object") return;
  if (typeof node.text === "string") parts.push(node.text);
  if (node.text && typeof node.text === "object") collectSlackText(node.text, parts);
  if (node.elements) collectSlackText(node.elements, parts);
  if (node.fields) collectSlackText(node.fields, parts);
  if (node.accessory) collectSlackText(node.accessory, parts);
}

function normalizeSlackText(text) {
  return String(text || "")
    .replace(/<@[^>|]+\\|([^>]+)>/g, "$1")
    .replace(/<@([^>]+)>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[：:]\s*/g, "：")
    .replace(/\r/g, "\n")
    .trim();
}

function parseCandidate(text, event, payload) {
  const fields = parseKeyValues(text);
  const source = clean(pick(fields, ["流入先", "応募媒体", "媒体"]) || workflowSource(event, payload) || "Slack");
  return {
    id: `slack_${cleanId(event.channel || "channel")}_${cleanId(event.ts || Date.now())}`,
    registered: new Date().toISOString().slice(0, 10),
    source,
    sourceNo: "",
    name: clean(pick(fields, ["求職者氏名", "求職者名", "氏名", "名前"])),
    age: normalizeAge(pick(fields, ["年齢", "生年", "生年月日"])),
    gender: clean(pick(fields, ["性別"])) || "未確認",
    phone: cleanPhone(pick(fields, ["TEL", "電話", "電話番号", "携帯番号"])),
    protector: clean(pick(fields, ["新規対応者", "担当者", "担当", "対応者", "CA"])),
    status: clean(pick(fields, ["ステータス"])) || "未通電",
    memo: clean(pick(fields, ["日時等申し送り", "日時申し送り", "申し送り", "メモ", "備考"])),
    area: areaSummary(clean(pick(fields, ["エリア", "住所"]))),
    areaDetail: clean(pick(fields, ["エリア", "住所"])),
    rawText: text,
    slackChannel: event.channel || "",
    slackTs: event.ts || ""
  };
}

function parseKeyValues(text) {
  const fields = {};
  String(text || "").split(/\n+/).forEach(line => {
    const match = line.match(/^\s*[■▼◼︎・-]?\s*([^：:]{1,30})[：:]\s*(.*)$/);
    if (!match) return;
    fields[clean(match[1])] = clean(match[2]);
  });
  return fields;
}

function pick(fields, labels) {
  for (const label of labels) {
    if (fields[label]) return fields[label];
  }
  return "";
}

function clean(value) {
  return String(value || "").replace(/^[-ー]+$/, "").trim();
}

function cleanPhone(value) {
  return clean(value).replace(/[^\d+\-\s]/g, "").trim();
}

function cleanId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function normalizeAge(value) {
  const text = clean(value);
  const year = Number((text.match(/\b(19\d{2}|20\d{2})\b/) || [])[1]);
  if (year) return new Date().getFullYear() - year;
  const age = Number((text.match(/\d{1,3}/) || [])[0]);
  return Number.isFinite(age) ? age : null;
}

function areaSummary(value) {
  const text = clean(value);
  const match = text.match(/([^都道府県]+[都道府県])/);
  return match ? match[1] : "";
}

function workflowSource(event, payload) {
  const candidates = [
    event.username,
    event.bot_profile?.name,
    payload.authorizations?.[0]?.app_name
  ];
  return clean(candidates.find(Boolean) || "");
}

async function upsertCandidate(candidate, env) {
  const sourceNo = await nextCandidateNo(candidate.source, env);
  const row = {
    id: candidate.id,
    registered: candidate.registered,
    source: candidate.source,
    source_no: sourceNo,
    area: candidate.area,
    area_detail: candidate.areaDetail,
    name: candidate.name || "氏名未設定",
    age: candidate.age,
    gender: candidate.gender,
    phone: candidate.phone,
    protector: normalizeOwner(candidate.protector),
    status: candidate.status,
    memo: candidate.memo,
    slack_channel: candidate.slackChannel || null,
    slack_ts: candidate.slackTs || null,
    raw: {
      source: candidate.source,
      sourceNo,
      nextAction: candidate.memo,
      rawText: candidate.rawText,
      slackChannel: candidate.slackChannel,
      slackTs: candidate.slackTs
    },
    created_by: "Slack",
    updated_by: "Slack"
  };

  const endpoint = `${env.SUPABASE_URL}/rest/v1/compass_candidates`;
  const response = await fetch(`${endpoint}?on_conflict=id`, {
    method: "POST",
    headers: supabaseHeaders(env, {
      "prefer": "resolution=merge-duplicates,return=representation"
    }),
    body: JSON.stringify(row)
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`candidate_upsert_failed: ${body}`);
  const rows = body ? JSON.parse(body) : [];
  return rows[0] || row;
}

async function nextCandidateNo(source, env) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/compass_next_candidate_no`, {
    method: "POST",
    headers: supabaseHeaders(env),
    body: JSON.stringify({ p_source: source || "Slack" })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`source_no_failed: ${text}`);
  return JSON.parse(text);
}

function supabaseHeaders(env, extra = {}) {
  return {
    "content-type": "application/json",
    "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
    "authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra
  };
}

function normalizeOwner(value) {
  const text = clean(value);
  if (text.includes("大類")) return "大類";
  if (text.includes("福島")) return "福島";
  if (text.includes("西岡")) return "西岡";
  if (text.includes("佐藤")) return "佐藤";
  return text || "";
}
