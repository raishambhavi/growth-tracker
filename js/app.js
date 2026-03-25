/**
 * Daily Growth Tracker — tasks, calendar, API sync, auth
 */
(function () {
  "use strict";

  const STORAGE_KEY = "growthTracker:v2";
  const LEGACY_KEY = "growthTracker:v1";
  const MIGRATED_KEY = "dgt_server_migrated";
  const MAX_DAY_MINUTES = 14 * 60;

  const AFFIRMATIONS = [
    "Small steps today build the life you want tomorrow.",
    "You are allowed to grow at your own pace.",
    "Progress, not perfection, is what counts.",
    "Your effort matters even when no one sees it.",
    "Today is a fresh chance to show up for yourself.",
    "Consistency beats intensity — keep going.",
    "You have overcome hard days before; you can do it again.",
    "Rest is part of growth, not the opposite of it.",
    "Celebrate what you did, not just what is left.",
    "Clarity comes from action — one task at a time.",
    "You are building habits that will carry you forward.",
    "It is okay to adjust your plan; flexibility is strength.",
    "Focus on the next right thing.",
    "Your future self will thank you for today.",
    "You deserve the peace that comes from honest effort.",
    "Courage is showing up even when it is hard.",
    "Every checklist item is a vote for who you want to be.",
    "You are not behind; you are exactly where you can begin.",
    "Let today be proof that you care about your growth.",
    "Trust the process — you are learning as you go.",
    "Good things compound when you stay in motion.",
    "You can be proud of trying.",
    "Light attracts light — keep your habits kind.",
    "One hour of focused work can change your week.",
    "You are more capable than yesterday's doubts.",
    "Gentle discipline beats harsh self-criticism.",
    "Your energy is precious — spend it on what matters.",
    "Growth is quiet sometimes; that does not mean it is not real.",
    "You are writing your story with every choice.",
    "Breathe. Begin. You have got this.",
  ];

  let viewDateKey = "";
  let calendarApi = null;
  let syncTimer = null;
  let mainAppStarted = false;

  function todayKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function parseDateKey(key) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function dayOfYear(date) {
    const start = new Date(date.getFullYear(), 0, 0);
    return Math.floor((date - start) / 86400000);
  }

  function migrateTask(t) {
    const em =
      typeof t.estimatedMinutes === "number" && t.estimatedMinutes > 0
        ? Math.round(t.estimatedMinutes)
        : 30;
    return {
      id: t.id || crypto.randomUUID(),
      title: String(t.title || ""),
      done: !!t.done,
      estimatedMinutes: em,
    };
  }

  function loadState() {
    try {
      let raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        raw = localStorage.getItem(LEGACY_KEY);
        if (raw) localStorage.removeItem(LEGACY_KEY);
      }
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      const state = {
        tasksByDate: {},
        lastAffirmationDate: parsed.lastAffirmationDate ?? null,
        overloadDismissedDate: parsed.overloadDismissedDate ?? null,
        hoursWarningDismissedDate: parsed.hoursWarningDismissedDate ?? null,
      };
      for (const dk of Object.keys(parsed.tasksByDate || {})) {
        state.tasksByDate[dk] = (parsed.tasksByDate[dk] || []).map(migrateTask);
      }
      return state;
    } catch {
      return defaultState();
    }
  }

  function defaultState() {
    return {
      tasksByDate: {},
      lastAffirmationDate: null,
      overloadDismissedDate: null,
      hoursWarningDismissedDate: null,
    };
  }

  function saveStateLocal() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {}
  }

  let persistTimer = null;
  function persistState() {
    saveStateLocal();
    if (!window.DGT_API || !DGT_API.isLoggedIn()) return;
    clearTimeout(persistTimer);
    persistTimer = setTimeout(async () => {
      try {
        await DGT_API.putPreferences({
          lastAffirmationDate: state.lastAffirmationDate,
          overloadDismissedDate: state.overloadDismissedDate,
          hoursWarningDismissedDate: state.hoursWarningDismissedDate,
        });
        await DGT_API.putDay(viewDateKey, getTasksForDate(state, viewDateKey));
      } catch (_) {}
    }, 400);
  }

  let state = loadState();

  function getTasksForDate(st, dateKey) {
    return st.tasksByDate[dateKey] || [];
  }

  function normalizeTitle(s) {
    return s.trim().toLowerCase().replace(/\s+/g, " ");
  }

  function getSuggestedMinutesForTitle(st, title) {
    const norm = normalizeTitle(title);
    const mins = [];
    for (const dk of Object.keys(st.tasksByDate).sort().reverse()) {
      for (const t of st.tasksByDate[dk] || []) {
        if (
          normalizeTitle(t.title) === norm &&
          typeof t.estimatedMinutes === "number" &&
          t.estimatedMinutes > 0
        ) {
          mins.push(t.estimatedMinutes);
        }
      }
    }
    if (mins.length === 0) return 30;
    const avg = mins.reduce((a, b) => a + b, 0) / mins.length;
    return Math.max(5, Math.round(avg / 5) * 5);
  }

  function totalEstimatedMinutes(tasks) {
    return tasks.reduce((s, t) => s + (t.estimatedMinutes > 0 ? t.estimatedMinutes : 30), 0);
  }

  function formatDuration(totalMin) {
    if (totalMin < 60) return `${totalMin} min`;
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  function setProgressGradient(pct) {
    const bar = document.getElementById("progress-gradient-bar");
    if (!bar) return;
    const p = Math.max(0, Math.min(100, pct));
    bar.style.clipPath = p <= 0 ? "inset(0 100% 0 0)" : `inset(0 ${100 - p}% 0 0)`;
  }

  function getPatternSuggestions(st, dateKey, limit = 6) {
    const todayTitles = new Set(
      getTasksForDate(st, dateKey).map((t) => normalizeTitle(t.title))
    );
    const counts = new Map();
    const today = parseDateKey(dateKey);
    const keys = Object.keys(st.tasksByDate)
      .filter((k) => {
        if (k === dateKey) return false;
        const d = parseDateKey(k);
        const diffDays = (today - d) / 86400000;
        return diffDays >= 0 && diffDays <= 14;
      })
      .sort()
      .reverse();

    for (const dk of keys) {
      for (const t of st.tasksByDate[dk] || []) {
        const n = normalizeTitle(t.title);
        if (!n) continue;
        counts.set(n, (counts.get(n) || 0) + 1);
      }
    }

    const entries = [...counts.entries()]
      .filter(([title, c]) => c >= 2 && !todayTitles.has(title))
      .sort((a, b) => b[1] - a[1]);

    const seen = new Set();
    const result = [];
    for (const [norm, count] of entries) {
      const original = findOriginalTitle(st, norm);
      if (!original || seen.has(norm)) continue;
      seen.add(norm);
      result.push({ title: original, count });
      if (result.length >= limit) break;
    }
    return result;
  }

  function findOriginalTitle(st, normalized) {
    for (const dk of Object.keys(st.tasksByDate)) {
      for (const t of st.tasksByDate[dk] || []) {
        if (normalizeTitle(t.title) === normalized) return t.title.trim();
      }
    }
    return null;
  }

  function getOverloadMessage(st, dateKey) {
    const days = Object.keys(st.tasksByDate)
      .filter((k) => k < dateKey)
      .sort()
      .reverse()
      .slice(0, 14);

    if (days.length < 3) return null;

    let sumPlanned = 0;
    let sumDone = 0;
    let n = 0;
    for (const dk of days) {
      const tasks = st.tasksByDate[dk] || [];
      if (tasks.length === 0) continue;
      const done = tasks.filter((t) => t.done).length;
      sumPlanned += tasks.length;
      sumDone += done;
      n++;
    }
    if (n === 0) return null;

    const avgDone = sumDone / n;
    const completionRate = sumPlanned > 0 ? sumDone / sumPlanned : 0;
    const avgPlanned = sumPlanned / n;

    const today = getTasksForDate(st, dateKey);
    const todayCount = today.length;
    if (todayCount === 0) return null;

    const overPlanning =
      todayCount > Math.max(avgDone * 1.25, avgPlanned * 0.9) &&
      completionRate < 0.65 &&
      avgDone > 0;

    if (!overPlanning) return null;

    return `Based on your recent days, you usually complete about ${avgDone.toFixed(
      1
    )} tasks while planning more. Consider trimming this day's list to ${Math.max(
      1,
      Math.ceil(avgDone)
    )}–${Math.ceil(avgDone + 1)} priorities — or keep going; this is only a suggestion.`;
  }

  function progressPercent(tasks) {
    if (!tasks.length) return 0;
    const done = tasks.filter((t) => t.done).length;
    return Math.round((done / tasks.length) * 100);
  }

  function buildReport(st) {
    const tk = todayKey();
    const lines = [];
    lines.push("DAILY GROWTH TRACKER — REPORT");
    lines.push(`Generated: ${new Date().toLocaleString()}`);
    lines.push("");

    const dateKeys = Object.keys(st.tasksByDate).sort();
    const last14 = dateKeys.filter((k) => k < tk).slice(-14);

    let totalPlanned = 0;
    let totalDone = 0;
    let dayCount = 0;
    let sumDailyEst = 0;
    let daysWithTasks = 0;

    for (const dk of last14) {
      const tasks = st.tasksByDate[dk] || [];
      if (tasks.length === 0) continue;
      totalPlanned += tasks.length;
      totalDone += tasks.filter((t) => t.done).length;
      dayCount++;
      sumDailyEst += totalEstimatedMinutes(tasks);
      daysWithTasks++;
    }

    lines.push("## Summary (last up to 14 days before today)");
    if (dayCount === 0) {
      lines.push("Not enough history yet — log a few days for richer insights.");
    } else {
      const rate = totalPlanned > 0 ? (totalDone / totalPlanned) * 100 : 0;
      lines.push(`Days with tasks: ${dayCount}`);
      lines.push(`Task completion rate: ${rate.toFixed(0)}% (${totalDone} of ${totalPlanned} completed)`);
      lines.push(`Average tasks listed per day: ${(totalPlanned / dayCount).toFixed(1)}`);
      lines.push(`Average tasks finished per day: ${(totalDone / dayCount).toFixed(1)}`);
      if (daysWithTasks) {
        const avgEst = sumDailyEst / daysWithTasks;
        lines.push(`Average estimated workload per day: ${formatDuration(Math.round(avgEst))}`);
      }
    }
    lines.push("");

    lines.push("## How you are doing");
    if (dayCount >= 3) {
      const rate = totalPlanned > 0 ? totalDone / totalPlanned : 0;
      if (rate >= 0.75) {
        lines.push("- You finish most of what you plan — strong follow-through.");
      } else if (rate >= 0.5) {
        lines.push(
          "- You complete a solid share of your list — small tweaks to planning could lift consistency."
        );
      } else {
        lines.push(
          "- Completion is below half of listed tasks on average — shorter daily lists may feel more achievable."
        );
      }
    } else {
      lines.push("- After a few more days of use, trends will be clearer.");
    }
    lines.push("");

    lines.push("## What to improve");
    const tips = [];
    if (dayCount >= 3) {
      const rate = totalPlanned > 0 ? totalDone / totalPlanned : 0;
      if (rate < 0.6) {
        tips.push("- Try listing fewer priorities so wins feel reachable.");
      }
      if (daysWithTasks && sumDailyEst / daysWithTasks > MAX_DAY_MINUTES) {
        tips.push(
          "- Estimated time per day often exceeds 14 hours — spread work across days or shorten estimates."
        );
      }
    }
    const overload = getOverloadMessage(st, tk);
    if (overload) tips.push(`- ${overload}`);
    if (tips.length === 0) {
      tips.push("- Keep tracking — patterns will sharpen suggestions over time.");
    }
    tips.forEach((t) => lines.push(t));
    lines.push("");

    lines.push("## Recurring themes");
    const patterns = getPatternSuggestions(st, tk, 8);
    if (patterns.length) {
      patterns.forEach((p) => lines.push(`- ${p.title} (often repeated)`));
    } else {
      lines.push("- Repeat task titles across days to surface habits here.");
    }

    lines.push("");
    lines.push("---");
    lines.push(
      typeof window.DGT_API !== "undefined" && DGT_API.isLoggedIn()
        ? "Data is tied to your signed-in account on this server."
        : "This report is generated from data stored in your browser."
    );
    return lines.join("\n");
  }

  async function ensureWideRangeForReport() {
    if (!DGT_API.isLoggedIn()) return;
    try {
      const { days } = await DGT_API.fetchDays("2020-01-01", todayKey());
      for (const k of Object.keys(days)) {
        state.tasksByDate[k] = (days[k] || []).map(migrateTask);
      }
      saveStateLocal();
    } catch (_) {}
  }

  function exportCsv(st) {
    const rows = [["date", "task_title", "done", "estimated_minutes"]];
    const dates = Object.keys(st.tasksByDate).sort();
    for (const dk of dates) {
      for (const t of st.tasksByDate[dk] || []) {
        rows.push([
          dk,
          t.title.replace(/"/g, '""'),
          t.done ? "yes" : "no",
          String(t.estimatedMinutes ?? 30),
        ]);
      }
    }
    return rows.map((r) => r.map((c) => `"${String(c)}"`).join(",")).join("\n");
  }

  function importCsv(text) {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) throw new Error("CSV needs a header and at least one row.");

    const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase().trim());
    const dateIdx = header.indexOf("date");
    const titleIdx = header.indexOf("task_title");
    const doneIdx = header.indexOf("done");
    const estIdx = header.indexOf("estimated_minutes");
    if (dateIdx < 0 || titleIdx < 0) {
      throw new Error('Expected columns: date, task_title, and optionally "done", estimated_minutes.');
    }

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      if (cols.length < 2) continue;
      const dk = cols[dateIdx]?.trim();
      const title = cols[titleIdx]?.trim();
      if (!dk || !title) continue;
      const done =
        doneIdx >= 0 ? /^y(es)?|true|1$/i.test(cols[doneIdx]?.trim() || "") : false;
      let estimatedMinutes = 30;
      if (estIdx >= 0 && cols[estIdx] !== undefined) {
        const n = parseInt(cols[estIdx].trim(), 10);
        if (!Number.isNaN(n) && n > 0) estimatedMinutes = n;
      }

      if (!state.tasksByDate[dk]) state.tasksByDate[dk] = [];
      const exists = state.tasksByDate[dk].some(
        (t) => normalizeTitle(t.title) === normalizeTitle(title)
      );
      if (!exists) {
        state.tasksByDate[dk].push({
          id: crypto.randomUUID(),
          title,
          done,
          estimatedMinutes,
        });
      }
    }
    saveStateLocal();
  }

  function parseCsvLine(line) {
    const out = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) {
        if (c === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i++;
          } else inQ = false;
        } else cur += c;
      } else {
        if (c === '"') inQ = true;
        else if (c === ",") {
          out.push(cur);
          cur = "";
        } else cur += c;
      }
    }
    out.push(cur);
    return out;
  }

  const el = {
    heroBrand: document.getElementById("hero-brand"),
    heroDate: document.getElementById("hero-date"),
    heroDay: document.getElementById("hero-day"),
    progressLabelText: document.getElementById("progress-label-text"),
    progressText: document.getElementById("progress-text"),
    estTimeSummary: document.getElementById("est-time-summary"),
    taskList: document.getElementById("task-list"),
    taskInput: document.getElementById("task-input"),
    addBtn: document.getElementById("add-task"),
    alertBox: document.getElementById("overload-alert"),
    alertText: document.getElementById("overload-text"),
    dismissOverload: document.getElementById("dismiss-overload"),
    suggestions: document.getElementById("pattern-suggestions"),
    suggestionChips: document.getElementById("suggestion-chips"),
    affirmationModal: document.getElementById("affirmation-modal"),
    affirmationText: document.getElementById("affirmation-text"),
    closeAffirmation: document.getElementById("close-affirmation"),
    celebration: document.getElementById("celebration"),
    closeCelebration: document.getElementById("close-celebration"),
    exportBtn: document.getElementById("export-csv"),
    downloadReportBtn: document.getElementById("download-report"),
    importInput: document.getElementById("import-csv"),
    importFeedback: document.getElementById("import-feedback"),
    hoursWarningModal: document.getElementById("hours-warning-modal"),
    closeHoursWarning: document.getElementById("close-hours-warning"),
  };

  let prevProgress = 0;

  async function migrateLocalToServerIfNeeded() {
    if (!DGT_API.isLoggedIn()) return;
    if (localStorage.getItem(MIGRATED_KEY) === "1") return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        localStorage.setItem(MIGRATED_KEY, "1");
        return;
      }
      const parsed = JSON.parse(raw);
      const tbd = parsed.tasksByDate || {};
      if (Object.keys(tbd).length > 0) {
        await DGT_API.importBulk(tbd);
      }
      localStorage.setItem(MIGRATED_KEY, "1");
    } catch (_) {
      localStorage.setItem(MIGRATED_KEY, "1");
    }
  }

  async function hydrateFromServer() {
    if (!DGT_API.isLoggedIn()) return;
    const prefs = await DGT_API.getPreferences();
    state.lastAffirmationDate = prefs.lastAffirmationDate;
    state.overloadDismissedDate = prefs.overloadDismissedDate;
    state.hoursWarningDismissedDate = prefs.hoursWarningDismissedDate;

    const range = calendarApi ? calendarApi.getRange() : { start: viewDateKey, end: viewDateKey };
    const { days } = await DGT_API.fetchDays(range.start, range.end);
    for (const k of Object.keys(days)) {
      state.tasksByDate[k] = (days[k] || []).map(migrateTask);
    }
    saveStateLocal();
  }

  async function refreshMonthFromServer() {
    if (!DGT_API.isLoggedIn() || !calendarApi) return;
    try {
      const range = calendarApi.getRange();
      const { days } = await DGT_API.fetchDays(range.start, range.end);
      for (const k of Object.keys(days)) {
        state.tasksByDate[k] = (days[k] || []).map(migrateTask);
      }
      saveStateLocal();
      calendarApi.refresh();
      renderTasks();
      renderOverload();
    } catch (_) {}
  }

  function dayHasTasks(key) {
    const t = getTasksForDate(state, key);
    return t.length > 0;
  }

  async function initMainApp() {
    if (!DGT_API.isLoggedIn()) return;
    if (mainAppStarted) return;

    viewDateKey = todayKey();

    const mount = document.getElementById("calendar-mount");
    if (!mount) return;
    mount.innerHTML = "";

    calendarApi = DGT_Calendar.init({
      container: mount,
      onSelect: (key) => {
        viewDateKey = key;
        renderHeader();
        renderTasks();
        renderOverload();
      },
      getDots: dayHasTasks,
      onMonthChange: refreshMonthFromServer,
    });
    calendarApi.setSelectedKey(viewDateKey);

    await migrateLocalToServerIfNeeded();
    await hydrateFromServer();

    if (syncTimer) clearInterval(syncTimer);
    syncTimer = setInterval(refreshMonthFromServer, 60000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") refreshMonthFromServer();
    });

    renderHeader();
    renderTasks();
    renderOverload();
    showAffirmationIfNeeded();

    mainAppStarted = true;
  }

  document.getElementById("btn-cal-today")?.addEventListener("click", () => {
    if (!calendarApi) return;
    viewDateKey = todayKey();
    calendarApi.setSelectedKey(viewDateKey);
    renderHeader();
    renderTasks();
    renderOverload();
  });

  function renderHeader() {
    const d = parseDateKey(viewDateKey);
    el.heroDate.textContent = d.toLocaleDateString(undefined, {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    el.heroDay.textContent = d.toLocaleDateString(undefined, { weekday: "long" });
    const isToday = viewDateKey === todayKey();
    if (el.heroBrand) el.heroBrand.textContent = isToday ? "Today" : "Selected day";
    if (el.progressLabelText) {
      el.progressLabelText.textContent = isToday ? "Today's progress" : "This day's progress";
    }
  }

  function tryShowHoursWarning() {
    const tasks = getTasksForDate(state, viewDateKey);
    const totalMin = totalEstimatedMinutes(tasks);
    if (totalMin <= MAX_DAY_MINUTES) return;
    if (state.hoursWarningDismissedDate === viewDateKey) return;
    if (el.affirmationModal.classList.contains("visible")) return;
    el.hoursWarningModal.classList.add("visible");
  }

  function closeHoursWarning() {
    state.hoursWarningDismissedDate = viewDateKey;
    persistState();
    el.hoursWarningModal.classList.remove("visible");
  }

  function renderTasks() {
    const key = viewDateKey;
    const tasks = getTasksForDate(state, key);
    const pct = progressPercent(tasks);

    setProgressGradient(pct);
    el.progressText.textContent = `${pct}% · ${tasks.filter((t) => t.done).length}/${tasks.length} done`;

    const totalMin = totalEstimatedMinutes(tasks);
    if (tasks.length === 0) {
      el.estTimeSummary.hidden = true;
    } else {
      el.estTimeSummary.hidden = false;
      el.estTimeSummary.textContent = `Estimated time for this day: ${formatDuration(totalMin)}`;
    }

    el.taskList.innerHTML = "";
    if (tasks.length === 0) {
      const p = document.createElement("p");
      p.className = "empty-state";
      p.textContent =
        "No tasks for this day. Add one below, or import a CSV from Excel / Google Sheets.";
      el.taskList.appendChild(p);
    } else {
      tasks.forEach((task) => {
        const li = document.createElement("li");
        li.className = "task-item" + (task.done ? " done" : "");

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = task.done;
        cb.id = `t-${task.id}`;

        const content = document.createElement("div");
        content.className = "task-content";

        const label = document.createElement("label");
        label.className = "task-title";
        label.htmlFor = cb.id;
        label.textContent = task.title;

        const estRow = document.createElement("div");
        estRow.className = "task-estimate";

        const estText = document.createElement("span");
        estText.className = "task-estimate-text";
        function refreshEstLabel() {
          estText.textContent = `~${formatDuration(task.estimatedMinutes)}`;
        }
        refreshEstLabel();

        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "link-btn";
        editBtn.textContent = "Edit";

        let editing = false;
        editBtn.addEventListener("click", () => {
          if (editing) return;
          editing = true;
          estRow.innerHTML = "";
          const inp = document.createElement("input");
          inp.type = "number";
          inp.min = "5";
          inp.max = "1440";
          inp.step = "5";
          inp.value = String(task.estimatedMinutes);
          inp.setAttribute("aria-label", "Estimated minutes");
          let committed = false;
          const commit = () => {
            if (committed) return;
            committed = true;
            let v = parseInt(inp.value, 10);
            if (Number.isNaN(v) || v < 5) v = 5;
            if (v > 1440) v = 1440;
            task.estimatedMinutes = v;
            persistState();
            editing = false;
            renderTasks();
            renderOverload();
          };
          inp.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          });
          inp.addEventListener("blur", commit);
          estRow.appendChild(inp);
          inp.focus();
          inp.select();
        });

        estRow.appendChild(estText);
        estRow.appendChild(editBtn);

        cb.addEventListener("change", () => {
          task.done = cb.checked;
          persistState();
          const newPct = progressPercent(getTasksForDate(state, viewDateKey));
          if (newPct === 100 && tasks.length > 0 && prevProgress < 100) {
            showCelebration();
          }
          prevProgress = newPct;
          renderTasks();
          renderOverload();
        });

        content.appendChild(label);
        content.appendChild(estRow);
        li.appendChild(cb);
        li.appendChild(content);

        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "task-delete";
        delBtn.setAttribute("aria-label", "Remove task");
        delBtn.title = "Remove task";
        delBtn.textContent = "−";
        delBtn.addEventListener("click", () => deleteTask(task.id));

        li.appendChild(delBtn);
        el.taskList.appendChild(li);
      });
    }

    prevProgress = pct;

    const patterns = getPatternSuggestions(state, key);
    if (patterns.length === 0) {
      el.suggestions.hidden = true;
    } else {
      el.suggestions.hidden = false;
      el.suggestionChips.innerHTML = "";
      patterns.forEach(({ title, count }) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "chip";
        btn.innerHTML = `${escapeHtml(title)} <span class="count">×${count}</span>`;
        btn.addEventListener("click", () => addTask(title));
        el.suggestionChips.appendChild(btn);
      });
    }

    tryShowHoursWarning();
    if (calendarApi) calendarApi.refresh();
  }

  function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  function deleteTask(taskId) {
    const key = viewDateKey;
    const arr = state.tasksByDate[key];
    if (!arr) return;
    const i = arr.findIndex((t) => t.id === taskId);
    if (i === -1) return;
    arr.splice(i, 1);
    if (arr.length === 0) delete state.tasksByDate[key];
    persistState();
    renderTasks();
    renderOverload();
  }

  function addTask(title) {
    const t = title.trim() || el.taskInput.value.trim();
    if (!t) return;
    const key = viewDateKey;
    if (!state.tasksByDate[key]) state.tasksByDate[key] = [];
    const suggested = getSuggestedMinutesForTitle(state, t);
    state.tasksByDate[key].push({
      id: crypto.randomUUID(),
      title: t,
      done: false,
      estimatedMinutes: suggested,
    });
    el.taskInput.value = "";
    persistState();
    renderTasks();
    renderOverload();
  }

  function renderOverload() {
    const key = viewDateKey;
    const msg = getOverloadMessage(state, key);
    if (!msg || state.overloadDismissedDate === key) {
      el.alertBox.hidden = true;
      return;
    }
    el.alertBox.hidden = false;
    el.alertText.textContent = msg;
  }

  function showAffirmationIfNeeded() {
    if (viewDateKey !== todayKey()) return;
    const key = todayKey();
    if (state.lastAffirmationDate === key) return;

    const idx = dayOfYear(parseDateKey(key)) % AFFIRMATIONS.length;
    el.affirmationText.textContent = AFFIRMATIONS[idx];
    el.affirmationModal.classList.add("visible");
  }

  function closeAffirmation() {
    if (viewDateKey === todayKey()) {
      state.lastAffirmationDate = todayKey();
      persistState();
    }
    el.affirmationModal.classList.remove("visible");
    tryShowHoursWarning();
  }

  function showCelebration() {
    el.celebration.classList.add("visible");
  }

  function hideCelebration() {
    el.celebration.classList.remove("visible");
  }

  el.addBtn.addEventListener("click", () => addTask(el.taskInput.value));
  el.taskInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addTask(el.taskInput.value);
  });

  el.dismissOverload.addEventListener("click", () => {
    state.overloadDismissedDate = viewDateKey;
    persistState();
    renderOverload();
  });

  el.closeAffirmation.addEventListener("click", closeAffirmation);
  el.affirmationModal.addEventListener("click", (e) => {
    if (e.target === el.affirmationModal) closeAffirmation();
  });

  el.closeCelebration.addEventListener("click", hideCelebration);

  el.closeHoursWarning.addEventListener("click", closeHoursWarning);
  el.hoursWarningModal.addEventListener("click", (e) => {
    if (e.target === el.hoursWarningModal) closeHoursWarning();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (el.celebration.classList.contains("visible")) hideCelebration();
    else if (el.hoursWarningModal.classList.contains("visible")) closeHoursWarning();
    else if (el.affirmationModal.classList.contains("visible")) closeAffirmation();
  });

  el.downloadReportBtn.addEventListener("click", async () => {
    await ensureWideRangeForReport();
    const text = buildReport(state);
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `growth-report-${todayKey()}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  el.exportBtn.addEventListener("click", async () => {
    await ensureWideRangeForReport();
    const csv = exportCsv(state);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `growth-tracker-${todayKey()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  function showImportMessage(text, isError) {
    el.importFeedback.textContent = text;
    el.importFeedback.hidden = false;
    el.importFeedback.style.color = isError ? "var(--danger)" : "var(--muted)";
    clearTimeout(showImportMessage._t);
    showImportMessage._t = setTimeout(() => {
      el.importFeedback.hidden = true;
    }, 5000);
  }

  el.importInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        importCsv(String(reader.result));
        if (DGT_API.isLoggedIn()) {
          await DGT_API.importBulk(state.tasksByDate);
        }
        renderTasks();
        renderOverload();
        showImportMessage("Import complete — merged with your saved data.", false);
      } catch (err) {
        showImportMessage(err.message || "Could not import CSV.", true);
      }
      el.importInput.value = "";
    };
    reader.readAsText(file);
  });

  window.addEventListener("dgt-auth-change", async (e) => {
    if (!e.detail.loggedIn) {
      mainAppStarted = false;
      if (syncTimer) {
        clearInterval(syncTimer);
        syncTimer = null;
      }
      calendarApi = null;
      return;
    }
    await initMainApp();
  });
})();
