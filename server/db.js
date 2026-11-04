// Banco SQLite (node:sqlite) com migrações versionadas.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
export const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'nexo.db');

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');

const MIGRATIONS = [
  // 1 — núcleo
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    avatar TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_login_at TEXT
  );
  CREATE TABLE sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_agent TEXT,
    ip TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);
  CREATE TABLE password_resets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    used_at TEXT
  );

  CREATE TABLE couples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    cover TEXT,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE couple_members (
    couple_id INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
    can_edit INTEGER NOT NULL DEFAULT 1,
    share_personal_total INTEGER NOT NULL DEFAULT 0,
    joined_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (couple_id, user_id)
  );
  CREATE TABLE invites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    couple_id INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
    code TEXT NOT NULL UNIQUE,
    created_by INTEGER NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked','expired')),
    expires_at TEXT NOT NULL,
    accepted_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_invites_couple ON invites(couple_id);

  CREATE TABLE accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL CHECK (scope IN ('personal','couple')),
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    couple_id INTEGER REFERENCES couples(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('checking','wallet','savings','card')),
    initial_cents INTEGER NOT NULL DEFAULT 0,
    credit_limit_cents INTEGER,
    closing_day INTEGER,
    due_day INTEGER,
    color TEXT,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_accounts_scope ON accounts(scope, user_id, couple_id);

  CREATE TABLE categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL CHECK (scope IN ('personal','couple')),
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    couple_id INTEGER REFERENCES couples(id) ON DELETE CASCADE,
    parent_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('income','expense')),
    icon TEXT,
    color TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_categories_scope ON categories(scope, user_id, couple_id);

  CREATE TABLE recurring (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL CHECK (scope IN ('personal','couple')),
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    couple_id INTEGER REFERENCES couples(id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    type TEXT NOT NULL CHECK (type IN ('income','expense')),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    description TEXT NOT NULL,
    frequency TEXT NOT NULL CHECK (frequency IN ('weekly','monthly','yearly')),
    next_date TEXT NOT NULL,
    end_date TEXT,
    auto_paid INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL CHECK (scope IN ('personal','couple')),
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    couple_id INTEGER REFERENCES couples(id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    to_account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('income','expense','transfer')),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    date TEXT NOT NULL,
    due_date TEXT,
    status TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid','pending')),
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    description TEXT NOT NULL,
    notes TEXT,
    recurring_id INTEGER REFERENCES recurring(id) ON DELETE SET NULL,
    installment_group TEXT,
    installment_no INTEGER,
    installment_total INTEGER,
    idempotency_key TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_tx_scope_date ON transactions(scope, user_id, couple_id, date);
  CREATE INDEX idx_tx_account ON transactions(account_id, date);
  CREATE INDEX idx_tx_to_account ON transactions(to_account_id);
  CREATE INDEX idx_tx_category ON transactions(category_id);
  CREATE INDEX idx_tx_status ON transactions(status, due_date);
  CREATE UNIQUE INDEX uq_tx_idem ON transactions(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
  CREATE UNIQUE INDEX uq_tx_recurring ON transactions(recurring_id, date) WHERE recurring_id IS NOT NULL;

  CREATE TABLE budgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL CHECK (scope IN ('personal','couple')),
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    couple_id INTEGER REFERENCES couples(id) ON DELETE CASCADE,
    category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
    limit_cents INTEGER NOT NULL CHECK (limit_cents > 0),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX uq_budget_personal ON budgets(user_id, IFNULL(category_id,0)) WHERE scope='personal';
  CREATE UNIQUE INDEX uq_budget_couple ON budgets(couple_id, IFNULL(category_id,0)) WHERE scope='couple';

  CREATE TABLE vaults (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL CHECK (scope IN ('personal','couple')),
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    couple_id INTEGER REFERENCES couples(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    target_cents INTEGER,
    deadline TEXT,
    color TEXT,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE vault_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vault_id INTEGER NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    type TEXT NOT NULL CHECK (type IN ('deposit','withdraw')),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    date TEXT NOT NULL,
    note TEXT,
    idempotency_key TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_vm_vault ON vault_movements(vault_id, date);
  CREATE UNIQUE INDEX uq_vm_idem ON vault_movements(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

  CREATE TABLE goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL CHECK (scope IN ('personal','couple')),
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    couple_id INTEGER REFERENCES couples(id) ON DELETE CASCADE,
    vault_id INTEGER REFERENCES vaults(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'outro' CHECK (kind IN ('viagem','compra','patrimonio','projeto','reserva','outro')),
    target_cents INTEGER NOT NULL CHECK (target_cents > 0),
    deadline TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE investments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL CHECK (scope IN ('personal','couple')),
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    couple_id INTEGER REFERENCES couples(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    asset_type TEXT NOT NULL DEFAULT 'outro' CHECK (asset_type IN ('renda_fixa','acoes','fiis','fundos','cripto','previdencia','outro')),
    institution TEXT,
    status TEXT NOT NULL DEFAULT 'realized' CHECK (status IN ('realized','planned')),
    planned_cents INTEGER,
    expected_return_pct REAL,
    target_date TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE investment_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    investment_id INTEGER NOT NULL REFERENCES investments(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    type TEXT NOT NULL CHECK (type IN ('aporte','resgate','valuation')),
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
    date TEXT NOT NULL,
    note TEXT,
    idempotency_key TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_ie_inv ON investment_entries(investment_id, date);
  CREATE UNIQUE INDEX uq_ie_idem ON investment_entries(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

  CREATE TABLE chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    couple_id INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    attachment TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_chat_couple ON chat_messages(couple_id, id);
  CREATE TABLE chat_reads (
    couple_id INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_read_id INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (couple_id, user_id)
  );

  CREATE TABLE notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    link TEXT,
    dedupe_key TEXT,
    read_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_notif_user ON notifications(user_id, read_at, id);
  CREATE UNIQUE INDEX uq_notif_dedupe ON notifications(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

  CREATE TABLE ai_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scope TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user','assistant')),
    content TEXT NOT NULL,
    provider TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_ai_user ON ai_messages(user_id, scope, id);

  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    couple_id INTEGER,
    scope TEXT,
    action TEXT NOT NULL,
    entity TEXT,
    entity_id INTEGER,
    details TEXT,
    ip TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_audit_user ON audit_log(user_id, id);
  CREATE INDEX idx_audit_couple ON audit_log(couple_id, id);
  `,
];

function migrate() {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime(\'now\')))');
  const current = db.prepare('SELECT IFNULL(MAX(version),0) AS v FROM schema_migrations').get().v;
  for (let i = current; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[i]);
      db.prepare('INSERT INTO schema_migrations(version) VALUES (?)').run(i + 1);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
}
migrate();

export const q = {
  get: (sql, ...p) => db.prepare(sql).get(...p),
  all: (sql, ...p) => db.prepare(sql).all(...p),
  run: (sql, ...p) => db.prepare(sql).run(...p),
};

let depth = 0;
// Transação reentrante: a mais externa usa BEGIN IMMEDIATE; as internas usam SAVEPOINT.
export function tx(fn) {
  const outer = depth === 0, sp = `sp${depth}`;
  db.exec(outer ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
  depth++;
  try {
    const r = fn();
    depth--;
    db.exec(outer ? 'COMMIT' : `RELEASE ${sp}`);
    return r;
  } catch (e) {
    depth--;
    try { db.exec(outer ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`); } catch {}
    throw e;
  }
}
