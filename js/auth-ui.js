/**
 * Auth gate: register / sign in
 */
(function () {
  "use strict";

  function $(id) {
    return document.getElementById(id);
  }

  function showError(el, msg) {
    el.textContent = msg || "";
    el.hidden = !msg;
  }

  async function tryRestoreSession() {
    if (!window.DGT_API.isLoggedIn()) return false;
    try {
      await window.DGT_API.verifySession();
      return true;
    } catch {
      window.DGT_API.logout();
      return false;
    }
  }

  function showApp(show) {
    const gate = $("auth-gate");
    const main = $("main-shell");
    if (gate) gate.hidden = show;
    if (main) main.hidden = !show;
  }

  function updateUserBar() {
    const emailEl = $("user-email");
    const bar = $("user-bar");
    if (!emailEl || !bar) return;
    if (window.DGT_API.isLoggedIn()) {
      emailEl.textContent = window.DGT_API.getUserEmail();
      bar.hidden = false;
    } else {
      bar.hidden = true;
    }
  }

  async function onRegister(e) {
    e.preventDefault();
    const email = $("reg-email").value.trim();
    const pw = $("reg-password").value;
    const err = $("auth-error-register");
    showError(err, "");
    try {
      await window.DGT_API.register(email, pw);
      showApp(true);
      updateUserBar();
      window.dispatchEvent(new CustomEvent("dgt-auth-change", { detail: { loggedIn: true } }));
    } catch (ex) {
      showError(err, ex.message || "Could not register.");
    }
  }

  async function onLogin(e) {
    e.preventDefault();
    const email = $("login-email").value.trim();
    const pw = $("login-password").value;
    const err = $("auth-error-login");
    showError(err, "");
    try {
      await window.DGT_API.login(email, pw);
      showApp(true);
      updateUserBar();
      window.dispatchEvent(new CustomEvent("dgt-auth-change", { detail: { loggedIn: true } }));
    } catch (ex) {
      showError(err, ex.message || "Could not sign in.");
    }
  }

  function onLogout() {
    window.DGT_API.logout();
    showApp(false);
    updateUserBar();
    window.dispatchEvent(new CustomEvent("dgt-auth-change", { detail: { loggedIn: false } }));
  }

  function switchTab(which) {
    const reg = $("auth-panel-register");
    const log = $("auth-panel-login");
    const tReg = $("tab-register");
    const tLog = $("tab-login");
    if (!reg || !log) return;
    if (which === "register") {
      reg.hidden = false;
      log.hidden = true;
      tReg.classList.add("auth-tab--active");
      tLog.classList.remove("auth-tab--active");
    } else {
      reg.hidden = true;
      log.hidden = false;
      tLog.classList.add("auth-tab--active");
      tReg.classList.remove("auth-tab--active");
    }
  }

  async function init() {
    const ok = await tryRestoreSession();
    showApp(ok);
    updateUserBar();
    window.dispatchEvent(new CustomEvent("dgt-auth-change", { detail: { loggedIn: ok } }));

    $("form-register")?.addEventListener("submit", onRegister);
    $("form-login")?.addEventListener("submit", onLogin);
    $("btn-logout")?.addEventListener("click", onLogout);
    $("tab-register")?.addEventListener("click", () => switchTab("register"));
    $("tab-login")?.addEventListener("click", () => switchTab("login"));
    $("link-to-login")?.addEventListener("click", (e) => {
      e.preventDefault();
      switchTab("login");
    });
    $("link-to-register")?.addEventListener("click", (e) => {
      e.preventDefault();
      switchTab("register");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
