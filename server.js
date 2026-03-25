/**
 * Daily Growth Tracker API — SQLite + JWT auth
 */
require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const { randomUUID } = require("crypto");
const { openDatabase } = require("./db-sqljs");

const PORT = Number(process.env.PORT) || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "dev-only-change-me-in-production";
const SALT_ROUNDS = 10;

const ROOT = path.join(__dirname, "..");
const DB_PATH = path.join(__dirname, "growth-tracker.db");

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function authMiddleware(req, res, next) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const payload = jwt.verify(h.slice(7), JWT_SECRET);
    req.userId = payload.userId;
    req.userEmail = payload.email;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function signToken(userId, email) {
  return jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "30d" });
}

async function main() {
  const { wrapped: db } = await openDatabase(DB_PATH);
  db.pragma("foreign_keys = ON");

  db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    task_date TEXT NOT NULL,
    title TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    estimated_minutes INTEGER NOT NULL DEFAULT 30,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_user_date ON tasks(user_id, task_date);

  CREATE TABLE IF NOT EXISTS user_prefs (
    user_id INTEGER PRIMARY KEY,
    last_affirmation_date TEXT,
    overload_dismissed_date TEXT,
    hours_warning_dismissed_date TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 40,
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.post("/api/auth/register", authLimiter, (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password || typeof email !== "string" || typeof password !== "string") {
      return res.status(400).json({ error: "Email and password are required." });
    }
    const em = email.trim().toLowerCase();
    if (!emailRe.test(em)) {
      return res.status(400).json({ error: "Invalid email format." });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    }

    const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(em);
    if (existing) {
      return res.status(409).json({
        error: "This email is already registered. Please sign in instead.",
        code: "EMAIL_EXISTS",
      });
    }

    const hash = bcrypt.hashSync(password, SALT_ROUNDS);
    const created = new Date().toISOString();
    const info = db.prepare("INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)").run(
      em,
      hash,
      created
    );

    const userId = info.lastInsertRowid;
    db.prepare(
      "INSERT INTO user_prefs (user_id, last_affirmation_date, overload_dismissed_date, hours_warning_dismissed_date) VALUES (?, NULL, NULL, NULL)"
    ).run(userId);

    const token = signToken(userId, em);
    res.status(201).json({ token, user: { email: em } });
  });

  app.post("/api/auth/login", authLimiter, (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }
    const em = email.trim().toLowerCase();
    const row = db.prepare("SELECT id, password_hash, email FROM users WHERE email = ?").get(em);
    if (!row || !bcrypt.compareSync(password, row.password_hash)) {
      return res.status(401).json({ error: "Invalid email or password." });
    }
    const token = signToken(row.id, row.email);
    res.json({ token, user: { email: row.email } });
  });

  app.get("/api/me", authMiddleware, (req, res) => {
    res.json({ userId: req.userId, email: req.userEmail });
  });

  app.get("/api/preferences", authMiddleware, (req, res) => {
    const row = db
      .prepare(
        "SELECT last_affirmation_date, overload_dismissed_date, hours_warning_dismissed_date FROM user_prefs WHERE user_id = ?"
      )
      .get(req.userId);
    if (!row) {
      return res.json({
        lastAffirmationDate: null,
        overloadDismissedDate: null,
        hoursWarningDismissedDate: null,
      });
    }
    res.json({
      lastAffirmationDate: row.last_affirmation_date,
      overloadDismissedDate: row.overload_dismissed_date,
      hoursWarningDismissedDate: row.hours_warning_dismissed_date,
    });
  });

  app.put("/api/preferences", authMiddleware, (req, res) => {
    const b = req.body || {};
    const lastAffirmationDate = b.lastAffirmationDate ?? null;
    const overloadDismissedDate = b.overloadDismissedDate ?? null;
    const hoursWarningDismissedDate = b.hoursWarningDismissedDate ?? null;

    db.prepare(
      `INSERT INTO user_prefs (user_id, last_affirmation_date, overload_dismissed_date, hours_warning_dismissed_date)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       last_affirmation_date = excluded.last_affirmation_date,
       overload_dismissed_date = excluded.overload_dismissed_date,
       hours_warning_dismissed_date = excluded.hours_warning_dismissed_date`
    ).run(req.userId, lastAffirmationDate, overloadDismissedDate, hoursWarningDismissedDate);

    res.json({ ok: true });
  });

  function rowsToDayMap(rows) {
    const map = {};
    for (const r of rows) {
      if (!map[r.task_date]) map[r.task_date] = [];
      map[r.task_date].push({
        id: r.id,
        title: r.title,
        done: !!r.done,
        estimatedMinutes: r.estimated_minutes,
      });
    }
    return map;
  }

  app.get("/api/days", authMiddleware, (req, res) => {
    const { start, end } = req.query;
    if (!start || !end || typeof start !== "string" || typeof end !== "string") {
      return res.status(400).json({ error: "Query params start and end (YYYY-MM-DD) are required." });
    }
    const rows = db
      .prepare(
        `SELECT id, task_date, title, done, estimated_minutes FROM tasks
       WHERE user_id = ? AND task_date >= ? AND task_date <= ?
       ORDER BY task_date, title`
      )
      .all(req.userId, start, end);

    res.json({ days: rowsToDayMap(rows) });
  });

  app.put("/api/days/:date", authMiddleware, (req, res) => {
    const taskDate = req.params.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(taskDate)) {
      return res.status(400).json({ error: "Invalid date." });
    }
    const { tasks } = req.body || {};
    if (!Array.isArray(tasks)) {
      return res.status(400).json({ error: "Body must include tasks array." });
    }

    const del = db.prepare("DELETE FROM tasks WHERE user_id = ? AND task_date = ?");
    const ins = db.prepare(
      `INSERT INTO tasks (id, user_id, task_date, title, done, estimated_minutes)
     VALUES (?, ?, ?, ?, ?, ?)`
    );

    const run = db.transaction(() => {
      del.run(req.userId, taskDate);
      for (const t of tasks) {
        if (!t.title || typeof t.title !== "string") continue;
        const id = typeof t.id === "string" && t.id ? t.id : randomUUID();
        const done = t.done ? 1 : 0;
        const em =
          typeof t.estimatedMinutes === "number" && t.estimatedMinutes > 0
            ? Math.round(t.estimatedMinutes)
            : 30;
        ins.run(id, req.userId, taskDate, t.title.trim(), done, em);
      }
    });
    run();

    res.json({ ok: true });
  });

  app.delete("/api/tasks/:taskId", authMiddleware, (req, res) => {
    const info = db.prepare("DELETE FROM tasks WHERE id = ? AND user_id = ?").run(req.params.taskId, req.userId);
    if (info.changes === 0) {
      return res.status(404).json({ error: "Task not found." });
    }
    res.json({ ok: true });
  });

  /** Bulk import (e.g. migrate from localStorage after registration) */
  app.post("/api/import", authMiddleware, (req, res) => {
    const { tasksByDate } = req.body || {};
    if (!tasksByDate || typeof tasksByDate !== "object") {
      return res.status(400).json({ error: "tasksByDate object required." });
    }

    const delRange = db.prepare("DELETE FROM tasks WHERE user_id = ? AND task_date = ?");
    const ins = db.prepare(
      `INSERT INTO tasks (id, user_id, task_date, title, done, estimated_minutes)
     VALUES (?, ?, ?, ?, ?, ?)`
    );

    const run = db.transaction(() => {
      for (const dateKey of Object.keys(tasksByDate)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;
        const list = tasksByDate[dateKey];
        if (!Array.isArray(list)) continue;
        delRange.run(req.userId, dateKey);
        for (const t of list) {
          if (!t || !t.title) continue;
          const id = t.id || randomUUID();
          const done = t.done ? 1 : 0;
          const em =
            typeof t.estimatedMinutes === "number" && t.estimatedMinutes > 0
              ? Math.round(t.estimatedMinutes)
              : 30;
          ins.run(id, req.userId, dateKey, String(t.title).trim(), done, em);
        }
      }
    });
    run();

    res.json({ ok: true });
  });

  app.use(express.static(ROOT, { index: "index.html" }));

  app.listen(PORT, () => {
    console.log(`Growth Tracker API + static files at http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
