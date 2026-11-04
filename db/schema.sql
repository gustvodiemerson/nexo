-- NEXO — esquema do banco (PostgreSQL / Supabase). Idempotência: o app aplica isso sozinho no primeiro acesso;
-- rodar manualmente no SQL Editor do Supabase é opcional (só em banco vazio).

CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  avatar TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc','YYYY-MM-DD HH24:MI:SS')),
  last_login_at TEXT
);
CREATE TABLE sessions (
  id BIGSERIAL PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_agent TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc','YYYY-MM-DD HH24:MI:SS')),
  last_seen_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc','YYYY-MM-DD HH24:MI:SS')),
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE TABLE password_resets (
  id BIGSERIAL PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE couples (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  cover TEXT,
  created_by BIGINT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc','YYYY-MM-DD HH24:MI:SS'))
);
CREATE TABLE couple_members (
  couple_id BIGINT NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  can_edit BIGINT NOT NULL DEFAULT 1,
  share_personal_total BIGINT NOT NULL DEFAULT 0,
  joined_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc','YYYY-MM-DD HH24:MI:SS')),
  PRIMARY KEY (couple_id, user_id)
);
CREATE TABLE invites (
  id BIGSERIAL PRIMARY KEY,
  couple_id BIGINT NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  created_by BIGINT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked','expired')),
  expires_at TEXT NOT NULL,
  accepted_by BIGINT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc','YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX idx_invites_couple ON invites(couple_id);

CREATE TABLE accounts (
  id BIGSERIAL PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('personal','couple')),
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  couple_id BIGINT REFERENCES couples(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('checking','wallet','savings','card')),
  initial_cents BIGINT NOT NULL DEFAULT 0,
  credit_limit_cents BIGINT,
  closing_day BIGINT,
  due_day BIGINT,
  color TEXT,
  archived BIGINT NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc','YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX idx_accounts_scope ON accounts(scope, user_id, couple_id);

CREATE TABLE categories (
  id BIGSERIAL PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('personal','couple')),
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  couple_id BIGINT REFERENCES couples(id) ON DELETE CASCADE,
  parent_id BIGINT REFERENCES categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('income','expense')),
  icon TEXT,
  color TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc','YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX idx_categories_scope ON categories(scope, user_id, couple_id);

CREATE TABLE recurring (
  id BIGSERIAL PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('personal','couple')),
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  couple_id BIGINT REFERENCES couples(id) ON DELETE CASCADE,
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  category_id BIGINT REFERENCES categories(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('income','expense')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  description TEXT NOT NULL,
  frequency TEXT NOT NULL CHECK (frequency IN ('weekly','monthly','yearly')),
  next_date TEXT NOT NULL,
  end_date TEXT,
  auto_paid BIGINT NOT NULL DEFAULT 0,
  active BIGINT NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc','YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE transactions (
  id BIGSERIAL PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('personal','couple')),
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  couple_id BIGINT REFERENCES couples(id) ON DELETE CASCADE,
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  to_account_id BIGINT REFERENCES accounts(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('income','expense','transfer')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  date TEXT NOT NULL,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid','pending')),
  category_id BIGINT REFERENCES categories(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  notes TEXT,
  recurring_id BIGINT REFERENCES recurring(id) ON DELETE SET NULL,
  installment_group TEXT,
  installment_no BIGINT,
  installment_total BIGINT,
  idempotency_key TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc','YYYY-MM-DD HH24:MI:SS')),
  updated_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc','YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX idx_tx_scope_date ON transactions(scope, user_id, couple_id, date);
CREATE INDEX idx_tx_account ON transactions(account_id, date);
CREATE INDEX idx_tx_to_account ON transactions(to_account_id);
CREATE INDEX idx_tx_category ON transactions(category_id);
CREATE INDEX idx_tx_status ON transactions(status, due_date);
CREATE UNIQUE INDEX uq_tx_idem ON transactions(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX uq_tx_recurring ON transactions(recurring_id, date) WHERE recurring_id IS NOT NULL;

CREATE TABLE budgets (
  id BIGSERIAL PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('personal','couple')),
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  couple_id BIGINT REFERENCES couples(id) ON DELETE CASCADE,
  category_id BIGINT REFERENCES categories(id) ON DELETE CASCADE,
  limit_cents BIGINT NOT NULL CHECK (limit_cents > 0),
  created_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc','YYYY-MM-DD HH24:MI:SS'))
);
CREATE UNIQUE INDEX uq_budget_personal ON budgets(user_id, COALESCE(category_id,0)) WHERE scope='personal';
CREATE UNIQUE INDEX uq_budget_couple ON budgets(couple_id, COALESCE(category_id,0)) WHERE scope='couple';

CREATE TABLE vaults (
  id BIGSERIAL PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('personal','couple')),
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  couple_id BIGINT REFERENCES couples(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  target_cents BIGINT,
  deadline TEXT,
  color TEXT,
  archived BIGINT NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc','YYYY-MM-DD HH24:MI:SS'))
);
CREATE TABLE vault_movements (
  id BIGSERIAL PRIMARY KEY,
  vault_id BIGINT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id),
  account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('deposit','withdraw')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  date TEXT NOT NULL,
  note TEXT,
  idempotency_key TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc','YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX idx_vm_vault ON vault_movements(vault_id, date);
CREATE UNIQUE INDEX uq_vm_idem ON vault_movements(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE goals (
  id BIGSERIAL PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('personal','couple')),
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  couple_id BIGINT REFERENCES couples(id) ON DELETE CASCADE,
  vault_id BIGINT REFERENCES vaults(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'outro' CHECK (kind IN ('viagem','compra','patrimonio','projeto','reserva','outro')),
  target_cents BIGINT NOT NULL CHECK (target_cents > 0),
  deadline TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc','YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE investments (
  id BIGSERIAL PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('personal','couple')),
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  couple_id BIGINT REFERENCES couples(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  asset_type TEXT NOT NULL DEFAULT 'outro' CHECK (asset_type IN ('renda_fixa','acoes','fiis','fundos','cripto','previdencia','outro')),
  institution TEXT,
  status TEXT NOT NULL DEFAULT 'realized' CHECK (status IN ('realized','planned')),
  planned_cents BIGINT,
  expected_return_pct DOUBLE PRECISION,
  target_date TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc','YYYY-MM-DD HH24:MI:SS'))
);
CREATE TABLE investment_entries (
  id BIGSERIAL PRIMARY KEY,
  investment_id BIGINT NOT NULL REFERENCES investments(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id),
  account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('aporte','resgate','valuation')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents >= 0),
  date TEXT NOT NULL,
  note TEXT,
  idempotency_key TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc','YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX idx_ie_inv ON investment_entries(investment_id, date);
CREATE UNIQUE INDEX uq_ie_idem ON investment_entries(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE chat_messages (
  id BIGSERIAL PRIMARY KEY,
  couple_id BIGINT NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  attachment TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc','YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX idx_chat_couple ON chat_messages(couple_id, id);
CREATE TABLE chat_reads (
  couple_id BIGINT NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_id BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (couple_id, user_id)
);

CREATE TABLE notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  dedupe_key TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc','YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX idx_notif_user ON notifications(user_id, read_at, id);
CREATE UNIQUE INDEX uq_notif_dedupe ON notifications(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE ai_messages (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  provider TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc','YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX idx_ai_user ON ai_messages(user_id, scope, id);

CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT,
  couple_id BIGINT,
  scope TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id BIGINT,
  details TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc','YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX idx_audit_user ON audit_log(user_id, id);
CREATE INDEX idx_audit_couple ON audit_log(couple_id, id);

CREATE TABLE events (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  data TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc','YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX idx_events_user ON events(user_id, id);

CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  n BIGINT NOT NULL,
  reset_at BIGINT NOT NULL
);

-- Segurança: RLS ligado e sem políticas = a API pública do Supabase (anon/authenticated) não enxerga nada.
-- O app conecta com o papel "postgres", que ignora RLS.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_resets ENABLE ROW LEVEL SECURITY;
ALTER TABLE couples ENABLE ROW LEVEL SECURITY;
ALTER TABLE couple_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE vaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE investments ENABLE ROW LEVEL SECURITY;
ALTER TABLE investment_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
