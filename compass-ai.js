/* Additive, read-only drafting UI. Conversation text is kept in memory only. */
(() => {
  "use strict";
  const adapter = window.CompassAIAdapter;
  if (!adapter) return;
  const root = document.createElement("aside");
  root.id = "compassAi";
  root.hidden = true;
  root.setAttribute("aria-label", "コンパスくん AI文章作成");
  root.innerHTML = `
    <button class="ca-launch" type="button" aria-label="コンパスくんを開く" aria-expanded="false" aria-controls="compassAiPanel"><img src="./assets/compass-kun.png" alt=""><span>コンパスくん</span></button>
    <section class="ca-panel" id="compassAiPanel" aria-label="コンパスくんチャット" hidden>
      <header class="ca-head"><img src="./assets/compass-kun.png" alt=""><strong>コンパスくん</strong><button type="button" class="ca-new">新しい会話</button><button type="button" class="ca-close" aria-label="チャットを閉じる">閉じる</button></header>
      <div class="ca-body">
        <p class="ca-greeting">こんにちは！コンパスくんです。何を作成しますか？</p>
        <div class="ca-modes"><button type="button" data-mode="recommendation" aria-pressed="false">推薦文を作成</button><button type="button" data-mode="job" aria-pressed="false">求人票を作成</button></div>
        <label class="ca-target" hidden>作成対象<select aria-label="AI文章の作成対象"><option value="">対象を選択してください</option></select></label>
        <details class="ca-source" hidden><summary>送信する登録情報を確認</summary><pre></pre></details>
        <label class="ca-consent" hidden><input type="checkbox"><span>選択した登録情報と入力文をOpenAIへ送信して文章を作成する</span></label>
        <div class="ca-log" role="log" aria-label="文章作成の会話" aria-live="polite"></div>
        <p class="ca-status" role="status"></p>
      </div>
      <form class="ca-compose" hidden><textarea aria-label="コンパスくんへの指示" maxlength="2000" placeholder="例：この人の推薦文を作って"></textarea><div class="ca-actions"><small>氏名・連絡先の入力は避け、生成文は確認してご利用ください。</small><button class="ca-send" type="submit">作成する</button></div></form>
      <footer class="ca-budget" aria-live="polite">4名共有のAI予算を確認します</footer>
      <div class="ca-testing" hidden><button type="button" class="ca-test">架空データで接続確認（上限20円相当）</button></div>
    </section>`;
  document.body.append(root);
  const $ = selector => root.querySelector(selector);
  const launcher = $(".ca-launch"), panel = $(".ca-panel"), select = $("select"), status = $(".ca-status"), input = $("textarea");
  let ambient = null, mode = "", target = null, preview = null, history = [], busy = false, contextBusy = false, usage = null;
  let session = "", epoch = 0, contextEpoch = 0, dockFrame = 0;
  const setStatus = text => { status.textContent = text; };
  const money = value => Number(value || 0).toLocaleString("ja-JP", { maximumFractionDigits: 2 });
  function targetFromValue(value) {
    const at = value.indexOf(":");
    const key = { candidate: "candidateId", application: "applicationId", facility: "facilityId" }[value.slice(0, at)];
    return key ? { [key]: value.slice(at + 1) } : null;
  }
  function refreshControls() {
    $(".ca-send").disabled = busy || contextBusy || !preview || !$(".ca-consent input").checked || !usage?.configured || usage?.blocked;
    $(".ca-send").textContent = busy ? "作成中…" : "作成する";
    $(".ca-new").disabled = busy;
    $(".ca-test").disabled = busy || contextBusy || Boolean(mode) || history.length > 0;
    select.disabled = busy || contextBusy || history.length > 0;
    root.querySelectorAll("[data-mode]").forEach(button => { button.disabled = busy || history.length > 0; });
  }
  function displayUsage(value) {
    usage = value;
    $(".ca-testing").hidden = !value.smokeTestEnabled || !value.configured;
    const budget = $(".ca-budget");
    budget.textContent = `${value.month}・4名共有 概算${money(value.spentJpy)}円 / ${money(value.budgetJpy)}円（予約 ${money(value.reservedJpy)}円）${value.warning ? "・予算残額にご注意ください" : ""}${value.blocked ? "・今月の生成停止" : ""}`;
    budget.dataset.warning = String(value.warning || value.blocked);
    budget.title = `安全停止額 ${money(value.stopJpy)}円。${(value.users || []).map(u => `${u.name}：${money(u.spentJpy)}円`).join(" / ")}`;
    if (!value.configured) setStatus("AI接続は未設定、または停止中です。管理者に確認してください。");
    refreshControls();
  }
  function errorMessage(error) {
    // Only server AI messages are safe to show; transport errors may contain URLs.
    return error?.details?.code?.startsWith("AI_") ? error.message : "通信結果を確認できません。自動再送はしていません。利用状況を確認し、管理者へ連絡してください。";
  }
  async function loadUsage() {
    const currentEpoch = epoch;
    try { const value = await adapter.request("/api/ai/usage", { method: "GET" }); if (checkSession() && currentEpoch === epoch) displayUsage(value); }
    catch (error) { if (currentEpoch === epoch) { usage = null; $(".ca-budget").textContent = "AI予算を確認できません"; setStatus(errorMessage(error)); refreshControls(); } }
  }
  async function loadTarget() {
    const generation = ++contextEpoch, currentEpoch = epoch;
    target = targetFromValue(select.value); preview = null; contextBusy = Boolean(target);
    $(".ca-source").hidden = true; $(".ca-consent").hidden = true; $(".ca-consent input").checked = false;
    refreshControls();
    if (!target) { setStatus("作成対象を選択してください。"); return; }
    setStatus("登録情報を確認しています…");
    try {
      const value = await adapter.request("/api/ai/context", { method: "POST", body: { mode, target } });
      if (!checkSession() || currentEpoch !== epoch || generation !== contextEpoch) return;
      preview = value;
      $(".ca-source pre").textContent = `${value.title}\n参照元：${value.sources.join("、")}\n\n${Object.entries(value.facts).map(([k, v]) => `${k}：${v}`).join("\n")}\n\n未登録：${value.missing.join("、") || "なし"}\n不足項目はチャットで補足できます。`;
      $(".ca-source").hidden = false; $(".ca-consent").hidden = false;
      setStatus(value.missing.length ? "不足情報は確認しながら作成します。送信内容を確認してください。" : "送信内容を確認してください。");
    } catch (error) { if (currentEpoch === epoch && generation === contextEpoch) setStatus(errorMessage(error)); }
    finally { if (currentEpoch === epoch && generation === contextEpoch) { contextBusy = false; refreshControls(); } }
  }
  function chooseMode(value) {
    mode = value;
    root.querySelectorAll("[data-mode]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.mode === mode)));
    $(".ca-target").hidden = false; $(".ca-compose").hidden = false;
    input.placeholder = mode === "recommendation" ? "例：この人の推薦文を作って" : "例：給与と休日がわかる求人票を作って";
    select.replaceChildren(new Option("対象を選択してください", ""));
    const options = mode === "recommendation" ? adapter.candidates() : adapter.jobs();
    const preferred = mode === "recommendation" && ambient?.candidateId ? `candidate:${ambient.candidateId}` : mode === "job" && ambient?.applicationId ? `application:${ambient.applicationId}` : mode === "job" && ambient?.facilityId ? `facility:${ambient.facilityId}` : "";
    const seen = new Set();
    for (const option of options) if (!seen.has(option.value)) { select.add(new Option(option.label, option.value)); seen.add(option.value); }
    if (preferred && !seen.has(preferred)) select.add(new Option(ambient.candidateLabel || ambient.applicationLabel || ambient.facilityLabel || "詳細画面の対象", preferred));
    select.value = preferred;
    loadTarget();
  }
  function addMessage(role, text, copy = false) {
    const box = document.createElement("article"); box.className = "ca-message"; box.dataset.role = role;
    const p = document.createElement("p"); p.textContent = text; box.append(p);
    if (copy) {
      const button = document.createElement("button"); button.type = "button"; button.className = "ca-copy"; button.textContent = "コピー";
      button.addEventListener("click", async () => {
        try {
          if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
          else {
            const area = document.createElement("textarea"); area.value = text; area.style.cssText = "position:fixed;opacity:0"; root.append(area); area.select();
            const copied = document.execCommand("copy"); area.remove(); if (!copied) throw new Error("copy");
          }
          button.textContent = "コピー済み";
        } catch { button.textContent = "コピーできませんでした"; }
      });
      box.append(button);
    }
    $(".ca-log").append(box);
    box.scrollIntoView({ block: "nearest" });
  }
  function reset() {
    epoch++; contextEpoch++; history = []; target = preview = usage = null; mode = ""; busy = contextBusy = false;
    $(".ca-log").replaceChildren(); input.value = ""; select.replaceChildren();
    for (const name of [".ca-target", ".ca-source", ".ca-consent", ".ca-compose"]) $(name).hidden = true;
    $(".ca-consent input").checked = false;
    $(".ca-testing").hidden = true;
    root.querySelectorAll("[data-mode]").forEach(b => { b.setAttribute("aria-pressed", "false"); });
    setStatus(""); refreshControls();
  }
  function checkSession() {
    const next = adapter.session();
    if (next !== session) { session = next; ambient = null; reset(); panel.hidden = true; launcher.hidden = false; launcher.setAttribute("aria-expanded", "false"); }
    root.hidden = !session;
    return Boolean(session);
  }
  function open() {
    if (!checkSession()) return;
    panel.hidden = false; launcher.hidden = true; launcher.setAttribute("aria-expanded", "true");
    if (!adapter.ready()) setStatus("共有データの読み込み完了後にご利用ください。");
    loadUsage(); scheduleDock(); $(".ca-close").focus();
  }
  function close() { panel.hidden = true; launcher.hidden = false; launcher.setAttribute("aria-expanded", "false"); scheduleDock(); launcher.focus(); }
  root.addEventListener("click", event => event.stopPropagation());
  root.addEventListener("change", event => event.stopPropagation());
  root.addEventListener("keydown", event => { if (event.key === "Escape") { event.stopPropagation(); close(); } });
  launcher.addEventListener("click", open); $(".ca-close").addEventListener("click", close);
  $(".ca-new").addEventListener("click", () => { if (!history.length || window.confirm("作成した文章を残す場合はコピーしてください。新しい会話を開始しますか？")) { reset(); loadUsage(); } });
  root.querySelectorAll("[data-mode]").forEach(button => button.addEventListener("click", () => { if (!busy && !history.length && adapter.ready()) chooseMode(button.dataset.mode); }));
  select.addEventListener("change", loadTarget);
  $(".ca-consent input").addEventListener("change", refreshControls);
  $(".ca-test").addEventListener("click", async () => {
    if (!checkSession() || busy || mode || history.length) return;
    const currentEpoch = epoch;
    busy = true; refreshControls();
    try {
      const plan = await adapter.request("/api/ai/smoke-test", { method: "GET" });
      if (!checkSession() || currentEpoch !== epoch) return;
      if (!plan.canRun) { setStatus("接続テストの最大見積額が予算残額に収まらないため停止しました。"); return; }
      if (!window.confirm(`実在する求職者を参照せず、架空データで推薦文・求人票・修正文を3件生成します。最大見積り${money(plan.estimatedMaxJpy)}円。テスト累計20円相当以内で、共有月500円枠にも計上します。実行しますか？`)) { setStatus("接続テストをキャンセルしました。"); return; }
      const labels = { recommendation: "推薦文", job: "求人票", revision: "固定の架空初稿の修正" };
      for (const caseId of plan.cases) {
        setStatus(`${labels[caseId]}の接続を確認しています…`);
        const result = await adapter.request("/api/ai/smoke-test", { method: "POST", body: { caseId, requestId: crypto.randomUUID(), consent: true } });
        if (!checkSession() || currentEpoch !== epoch) return;
        addMessage("assistant", `【接続テスト：${labels[caseId]}】\n${result.text}\n\n入力 ${result.metering.inputTokens} / 出力 ${result.metering.outputTokens} トークン・保守的概算 ${money(result.metering.conservativeJpy)}円`, true);
        displayUsage(result.usage);
        if (result.incomplete) { setStatus("出力上限に達したため接続テストを停止しました。自動再送は行いません。"); return; }
      }
      setStatus("3件の接続確認が完了しました。表示された架空の文章を確認してください。テスト後は管理者が接続確認機能を無効にしてください。");
    } catch (error) { if (currentEpoch === epoch) { setStatus(errorMessage(error)); await loadUsage(); } }
    finally { if (currentEpoch === epoch) { busy = false; refreshControls(); } }
  });
  $(".ca-compose").addEventListener("submit", async event => {
    event.preventDefault(); event.stopPropagation();
    if (!checkSession() || busy || $(".ca-send").disabled || !input.value.trim()) return;
    const text = input.value.trim(), currentEpoch = epoch;
    if (text.length > 2000) return;
    busy = true; refreshControls(); setStatus("文章を作成しています…（最大45秒程度）");
    addMessage("user", text); input.value = "";
    const prior = history.slice(-8).map(item => ({ ...item, content: item.content.slice(0, 6000) }));
    while (prior.reduce((n, item) => n + item.content.length, 0) > 12000) prior.splice(0, 2);
    try {
      const result = await adapter.request("/api/ai/generate", { method: "POST", body: { requestId: crypto.randomUUID(), mode, target, consent: true, message: text, history: prior } });
      if (!checkSession() || currentEpoch !== epoch) return;
      history.push({ role: "user", content: text }, { role: "assistant", content: result.text });
      addMessage("assistant", result.text, true); displayUsage(result.usage);
      setStatus(result.incomplete ? "出力上限に達しました。続きを依頼できます（別途利用額がかかります）。" : "下書きです。内容を確認してコピーしてください。");
    } catch (error) {
      if (currentEpoch === epoch) { setStatus(errorMessage(error)); await loadUsage(); }
    } finally { if (currentEpoch === epoch) { busy = false; refreshControls(); } }
  });
  function scheduleDock() { if (!dockFrame) dockFrame = requestAnimationFrame(dock); }
  function dock() {
    dockFrame = 0;
    if (root.hidden) return;
    let right = innerWidth <= 600 ? 12 : 16, bottom = innerWidth <= 600 ? 12 : 16;
    const drawer = document.getElementById("drawerBackdrop");
    const pane = drawer?.classList.contains("open") ? drawer.querySelector(".drawer") : null;
    if (pane && innerWidth > 900) {
      const left = pane.getBoundingClientRect().left;
      const width = panel.hidden ? 90 : 410;
      if (left > width + 30) right = innerWidth - left + 12;
    }
    root.style.right = `${right}px`; root.style.bottom = `${bottom}px`;
    if (!panel.hidden) return;
    // Check only the launcher's footprint, preserving other floating controls.
    for (let attempt = 0; attempt < 8; attempt++) {
      const rect = launcher.getBoundingClientRect();
      const points = [[rect.left + 5, rect.top + 5], [rect.right - 5, rect.bottom - 5], [rect.left + rect.width / 2, rect.top + rect.height / 2]];
      const collision = points.some(([x, y]) => document.elementsFromPoint(x, y).some(el => !root.contains(el) && el.closest("button,input,select,textarea,a,[role='status'],.toast")));
      if (!collision || rect.top < 100) break;
      bottom += 50; root.style.bottom = `${bottom}px`;
    }
  }
  window.CompassAI = { setContext(value) {
    checkSession(); ambient = value;
    // A conversation's target never changes silently when navigating to another record.
    if (mode && !busy && !history.length) chooseMode(mode);
    scheduleDock();
  } };
  new MutationObserver(records => {
    if (records.some(r => !root.contains(r.target))) { checkSession(); scheduleDock(); }
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "hidden", "aria-hidden"] });
  window.addEventListener("resize", scheduleDock);
  window.addEventListener("scroll", scheduleDock, { passive: true, capture: true });
  window.addEventListener("storage", checkSession);
  setInterval(checkSession, 15000);
  checkSession(); scheduleDock();
})();
