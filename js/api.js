/**
 * API client for Daily Growth Tracker (same origin as the app)
 */
(function () {
  "use strict";

  const TOKEN_KEY = "dgt_token";
  const USER_KEY = "dgt_user_email";

  function baseUrl() {
    return window.location.origin;
  }

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function setToken(token, email) {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
    if (email) localStorage.setItem(USER_KEY, email);
    else localStorage.removeItem(USER_KEY);
  }

  function isLoggedIn() {
    return !!getToken();
  }

  function getUserEmail() {
    return localStorage.getItem(USER_KEY) || "";
  }

  function networkHelpMessage() {
    if (window.location.protocol === "file:") {
      return "This page was opened as a file. Start the server (cd server && npm start) and open http://localhost:3000 in your browser.";
    }
    return "Can't reach the server. In a terminal run: cd server && npm start — then reload this page. If you use another port, open that URL instead.";
  }

  async function request(path, options = {}) {
    if (window.location.protocol === "file:") {
      throw new Error(networkHelpMessage());
    }

    const headers = { ...options.headers };
    if (!headers["Content-Type"] && options.body && typeof options.body === "object") {
      headers["Content-Type"] = "application/json";
    }
    const t = getToken();
    if (t) headers.Authorization = `Bearer ${t}`;

    let res;
    try {
      res = await fetch(baseUrl() + path, {
        ...options,
        headers,
        body:
          options.body && typeof options.body === "object" && !(options.body instanceof FormData)
            ? JSON.stringify(options.body)
            : options.body,
      });
    } catch {
      throw new Error(networkHelpMessage());
    }

    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { error: text || res.statusText };
    }

    if (!res.ok) {
      const err = new Error((data && data.error) || res.statusText || "Request failed");
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  window.DGT_API = {
    getToken,
    setToken,
    isLoggedIn,
    getUserEmail,

    async register(email, password) {
      const data = await request("/api/auth/register", {
        method: "POST",
        body: { email, password },
      });
      setToken(data.token, data.user.email);
      return data;
    },

    async login(email, password) {
      const data = await request("/api/auth/login", {
        method: "POST",
        body: { email, password },
      });
      setToken(data.token, data.user.email);
      return data;
    },

    logout() {
      setToken(null, null);
    },

    async fetchDays(start, end) {
      const q = `?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
      return request("/api/days" + q, { method: "GET" });
    },

    async putDay(dateKey, tasks) {
      return request("/api/days/" + encodeURIComponent(dateKey), {
        method: "PUT",
        body: { tasks },
      });
    },

    async getPreferences() {
      return request("/api/preferences", { method: "GET" });
    },

    async putPreferences(prefs) {
      return request("/api/preferences", {
        method: "PUT",
        body: prefs,
      });
    },

    async importBulk(tasksByDate) {
      return request("/api/import", {
        method: "POST",
        body: { tasksByDate },
      });
    },

    async verifySession() {
      return request("/api/me", { method: "GET" });
    },
  };
})();
