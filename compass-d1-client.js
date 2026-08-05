(function () {
  "use strict";

  const TOKEN_KEY = "compassD1Token";
  const API_KEY = "compassD1ApiUrl";

  function cleanUrl(value) {
    return String(value || "").trim().replace(/\/+$/, "");
  }

  function resolveApiUrl(defaultUrl) {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = cleanUrl(params.get("d1Api"));
    if (fromQuery) {
      localStorage.setItem(API_KEY, fromQuery);
      params.delete("d1Api");
      const query = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    }
    return fromQuery || cleanUrl(localStorage.getItem(API_KEY)) || cleanUrl(defaultUrl);
  }

  function apiError(message, details = null) {
    const error = new Error(message || "D1 API error");
    error.details = details;
    return error;
  }

  class D1Query {
    constructor(client, table) {
      this.client = client;
      this.spec = {
        table,
        action: "select",
        columns: "*",
        filters: [],
        orders: [],
        or: "",
        limit: null,
        count: "",
        returning: false,
        single: false,
        maybeSingle: false,
        rows: null,
        values: null,
        onConflict: ""
      };
    }

    select(columns = "*", options = {}) {
      this.spec.columns = columns || "*";
      this.spec.count = options?.count || "";
      if (this.spec.action !== "select") this.spec.returning = true;
      return this;
    }

    insert(rows) {
      this.spec.action = "insert";
      this.spec.rows = rows;
      return this;
    }

    upsert(rows, options = {}) {
      this.spec.action = "upsert";
      this.spec.rows = rows;
      this.spec.onConflict = options?.onConflict || "";
      return this;
    }

    update(values) {
      this.spec.action = "update";
      this.spec.values = values || {};
      return this;
    }

    delete() {
      this.spec.action = "delete";
      return this;
    }

    eq(column, value) {
      this.spec.filters.push({ type: "eq", column, value });
      return this;
    }

    ilike(column, value) {
      this.spec.filters.push({ type: "ilike", column, value });
      return this;
    }

    in(column, values) {
      this.spec.filters.push({ type: "in", column, values: Array.isArray(values) ? values : [] });
      return this;
    }

    or(expression) {
      this.spec.or = String(expression || "");
      return this;
    }

    order(column, options = {}) {
      this.spec.orders.push({ column, ascending: options?.ascending !== false });
      return this;
    }

    limit(value) {
      this.spec.limit = Math.max(0, Number(value || 0));
      return this;
    }

    single() {
      this.spec.single = true;
      return this;
    }

    maybeSingle() {
      this.spec.maybeSingle = true;
      return this;
    }

    then(resolve, reject) {
      return this.client.query(this.spec).then(resolve, reject);
    }
  }

  class PollChannel {
    constructor(client) {
      this.client = client;
      this.listeners = [];
      this.timer = 0;
      this.lastVersion = "";
    }

    on(_event, filter, callback) {
      this.listeners.push({ table: filter?.table || "", callback });
      return this;
    }

    subscribe(callback) {
      callback?.("SUBSCRIBED");
      const poll = async () => {
        try {
          const response = await this.client.request("/api/version", { method: "GET" });
          const version = String(response?.version || "");
          if (this.lastVersion && version && version !== this.lastVersion) {
            const payload = { commit_timestamp: new Date().toISOString() };
            this.listeners.forEach(listener => listener.callback?.(payload));
          }
          if (version) this.lastVersion = version;
        } catch (error) {
          console.warn("D1 version poll skipped:", error.message);
        }
      };
      poll();
      this.timer = window.setInterval(poll, 30000);
      return this;
    }
  }

  class CompassD1Client {
    constructor(defaultUrl) {
      this.url = resolveApiUrl(defaultUrl);
      this.auth = {
        getSession: async () => {
          const token = localStorage.getItem(TOKEN_KEY) || "";
          if (!token || !this.url) return { data: { session: null }, error: null };
          try {
            const user = await this.request("/api/me", { method: "GET" });
            return { data: { session: { access_token: token, user } }, error: null };
          } catch (error) {
            localStorage.removeItem(TOKEN_KEY);
            return { data: { session: null }, error };
          }
        },
        signInWithPassword: async ({ email, password }) => {
          try {
            const result = await this.request("/api/login", {
              method: "POST",
              auth: false,
              body: { email, password }
            });
            localStorage.setItem(TOKEN_KEY, result.token);
            return { data: { session: { access_token: result.token }, user: result.user }, error: null };
          } catch (error) {
            return { data: null, error };
          }
        },
        getUser: async () => {
          try {
            const user = await this.request("/api/me", { method: "GET" });
            return { data: { user }, error: null };
          } catch (error) {
            return { data: { user: null }, error };
          }
        },
        signOut: async () => {
          try {
            await this.request("/api/logout", { method: "POST" });
          } catch (_) {
            // The local token must be removed even when the network is unavailable.
          }
          localStorage.removeItem(TOKEN_KEY);
          return { error: null };
        }
      };
      this.functions = {
        invoke: async (_name, options = {}) => {
          try {
            const data = await this.request("/api/mail", { method: "POST", body: options.body || {} });
            return { data, error: null };
          } catch (error) {
            return { data: null, error };
          }
        }
      };
    }

    from(table) {
      return new D1Query(this, table);
    }

    async rpc(name, args = {}) {
      try {
        const response = await this.request("/api/rpc", { method: "POST", body: { name, args } });
        return { data: response.data ?? null, error: null };
      } catch (error) {
        return { data: null, error };
      }
    }

    channel() {
      return new PollChannel(this);
    }

    async query(spec) {
      try {
        const response = await this.request("/api/query", { method: "POST", body: spec });
        return { data: response.data ?? null, count: response.count ?? null, error: null };
      } catch (error) {
        return { data: null, count: null, error };
      }
    }

    async request(path, options = {}) {
      if (!this.url || this.url.includes("REPLACE")) throw apiError("D1 API URLが未設定です");
      const headers = { "content-type": "application/json" };
      const token = localStorage.getItem(TOKEN_KEY) || "";
      if (options.auth !== false && token) headers.authorization = `Bearer ${token}`;
      const response = await fetch(`${this.url}${path}`, {
        method: options.method || "GET",
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
      });
      const text = await response.text();
      let payload = {};
      try {
        payload = text ? JSON.parse(text) : {};
      } catch (_) {
        payload = { message: text };
      }
      if (!response.ok) throw apiError(payload.error || payload.message || `HTTP ${response.status}`, payload);
      return payload;
    }
  }

  window.createCompassD1Client = defaultUrl => new CompassD1Client(defaultUrl);
})();
