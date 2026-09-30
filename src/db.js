const Database = require('better-sqlite3');

const STATUSES = ['recibido', 'diagnostico', 'mantenimiento', 'espera_refacciones', 'listo', 'entregado'];
const ROLES = ['admin', 'mecanico'];

function openDb(file = ':memory:') {
  const db = new Database(file);
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'usuario' CHECK (role IN ('admin','mecanico')),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS repairs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folio TEXT NOT NULL UNIQUE,
      mechanic_id INTEGER NOT NULL REFERENCES users(id),
      plate TEXT NOT NULL,
      make TEXT NOT NULL,
      model TEXT NOT NULL,
      year INTEGER,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'recibido',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repair_id INTEGER NOT NULL REFERENCES repairs(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      note TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS repair_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repair_id INTEGER NOT NULL REFERENCES repairs(id) ON DELETE CASCADE,
      concept TEXT NOT NULL,
      amount REAL NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  // Migración de bases anteriores: sin correo de cliente y sin cuentas de usuario
  if (db.prepare('PRAGMA table_info(repairs)').all().some((c) => c.name === 'customer_email'))
    db.exec('ALTER TABLE repairs DROP COLUMN customer_email');
  db.exec("DELETE FROM users WHERE role = 'usuario'");
  return db;
}

module.exports = { openDb, STATUSES, ROLES };
