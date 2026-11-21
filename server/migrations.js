// Migrações incrementais (a versão 1 é o schema base em schema.js). Aplicadas sozinhas no primeiro acesso após o deploy.
export const MIGRATIONS = [
  {
    version: 2, // integração bancária (Pluggy / Open Finance, somente leitura)
    sql: `
ALTER TABLE transactions ADD COLUMN external_id TEXT;
CREATE UNIQUE INDEX uq_tx_external ON transactions(account_id, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE bank_links (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL UNIQUE,
  connector TEXT,
  status TEXT,
  last_sync_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() at time zone 'utc','YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX idx_bank_links_user ON bank_links(user_id);

CREATE TABLE bank_accounts (
  id BIGSERIAL PRIMARY KEY,
  link_id BIGINT NOT NULL REFERENCES bank_links(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pluggy_account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('checking','savings','card')),
  bank_balance_cents BIGINT,
  balance_at TEXT,
  account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
  synced_to TEXT,
  UNIQUE (user_id, pluggy_account_id)
);
CREATE INDEX idx_bank_accounts_link ON bank_accounts(link_id);
ALTER TABLE bank_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;
`,
  },
];
