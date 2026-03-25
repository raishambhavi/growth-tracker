/**
 * sql.js wrapper with a better-sqlite3-like API + file persistence
 */
const fs = require("fs");

/**
 * @param {import("sql.js").Database} db
 * @param {() => void} persist
 */
function wrapDatabase(db, persist) {
  let inTransaction = false;

  function execRun(sql, params = []) {
    db.run(sql, params);
    const changes = db.getRowsModified();
    const s = db.prepare("SELECT last_insert_rowid() AS id");
    s.step();
    const r = s.getAsObject();
    s.free();
    return { changes, lastInsertRowid: r.id };
  }

  function maybePersist() {
    if (!inTransaction) persist();
  }

  return {
    pragma(cmd) {
      const sql = cmd.trim().toUpperCase().startsWith("PRAGMA") ? cmd : `PRAGMA ${cmd}`;
      db.run(sql);
      maybePersist();
    },
    exec(sql) {
      db.exec(sql);
      maybePersist();
    },
    prepare(sql) {
      return {
        get(...params) {
          const stmt = db.prepare(sql);
          stmt.bind(params);
          if (!stmt.step()) {
            stmt.free();
            return undefined;
          }
          const row = stmt.getAsObject();
          stmt.free();
          return row;
        },
        all(...params) {
          const stmt = db.prepare(sql);
          stmt.bind(params);
          const rows = [];
          while (stmt.step()) {
            rows.push(stmt.getAsObject());
          }
          stmt.free();
          return rows;
        },
        run(...params) {
          const out = execRun(sql, params);
          maybePersist();
          return out;
        },
      };
    },
    transaction(fn) {
      return () => {
        inTransaction = true;
        db.run("BEGIN");
        try {
          fn();
          db.run("COMMIT");
        } catch (e) {
          try {
            db.run("ROLLBACK");
          } catch (_) {}
          throw e;
        } finally {
          inTransaction = false;
        }
        persist();
      };
    },
  };
}

async function openDatabase(dbPath) {
  const initSqlJs = require("sql.js");
  const SQL = await initSqlJs();
  let raw;
  if (fs.existsSync(dbPath)) {
    raw = new Uint8Array(fs.readFileSync(dbPath));
  }
  const db = raw ? new SQL.Database(raw) : new SQL.Database();

  function persist() {
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
  }

  const wrapped = wrapDatabase(db, persist);
  return { db, wrapped, persist };
}

module.exports = { openDatabase };
