// Contexto de acesso, escopos (pessoal/casal), auditoria, eventos em tempo real e notificações.
import { q, tx } from './db.js';
import { bad, forbidden, notFound } from './lib.js';

// ---------- contexto ----------
export function getCtx(user, ip) {
  const m = q.get('SELECT couple_id, role, can_edit, share_personal_total FROM couple_members WHERE user_id=?', user.id);
  return {
    user, userId: user.id, ip,
    coupleId: m ? m.couple_id : null,
    role: m ? m.role : null,
    canEditCouple: m ? !!m.can_edit : false,
  };
}

// Valida/normaliza o escopo pedido.
export function parseScope(ctx, s, { allowAll = true } = {}) {
  const def = ctx.coupleId && allowAll ? 'all' : 'personal';
  const scope = s || def;
  if (!['personal', 'couple', 'all'].includes(scope)) throw bad('Escopo inválido.', 'scope');
  if (scope === 'all' && !allowAll) throw bad('Escopo inválido.', 'scope');
  if (scope === 'couple' && !ctx.coupleId) throw bad('Você ainda não faz parte de um casal.', 'scope');
  if (scope === 'all' && !ctx.coupleId) return 'personal';
  return scope;
}

// Fragmento SQL de isolamento. `a` = prefixo de alias (ex.: 't.').
export function scopeSql(ctx, scope, a = '') {
  const personal = { sql: `(${a}scope='personal' AND ${a}user_id=?)`, params: [ctx.userId] };
  const couple = ctx.coupleId
    ? { sql: `(${a}scope='couple' AND ${a}couple_id=?)`, params: [ctx.coupleId] }
    : { sql: '(0)', params: [] };
  if (scope === 'personal') return personal;
  if (scope === 'couple') return couple;
  return { sql: `(${personal.sql} OR ${couple.sql})`, params: [...personal.params, ...couple.params] };
}

export function canRead(ctx, row) {
  if (!row) return false;
  if (row.scope === 'personal') return row.user_id === ctx.userId;
  return !!ctx.coupleId && row.couple_id === ctx.coupleId;
}
export function canWrite(ctx, row) {
  if (!canRead(ctx, row)) return false;
  if (row.scope === 'couple') return ctx.canEditCouple;
  return true;
}

// Destino de escrita de um novo registro.
export function writeTarget(ctx, scope) {
  if (scope === 'couple') {
    if (!ctx.coupleId) throw bad('Você ainda não faz parte de um casal.', 'scope');
    if (!ctx.canEditCouple) throw forbidden('Você tem acesso somente leitura aos dados do casal.');
    return { scope: 'couple', user_id: ctx.userId, couple_id: ctx.coupleId };
  }
  if (scope === 'personal') return { scope: 'personal', user_id: ctx.userId, couple_id: null };
  throw bad('Escolha entre pessoal ou casal.', 'scope');
}

const TABLES = new Set(['accounts', 'categories', 'transactions', 'recurring', 'budgets', 'vaults', 'goals', 'investments']);
export function getOwned(table, id, ctx, { write = false } = {}) {
  if (!TABLES.has(table)) throw new Error('tabela inválida');
  const n = Number(id);
  if (!Number.isInteger(n)) throw notFound();
  const row = q.get(`SELECT * FROM ${table} WHERE id=?`, n);
  // 404 (e não 403) para não revelar a existência de registros alheios.
  if (!row || !canRead(ctx, row)) throw notFound();
  if (write && !canWrite(ctx, row)) throw forbidden('Você tem acesso somente leitura aos dados do casal.');
  return row;
}

// Conta acessível para o usuário (para uso em transações etc.).
export function getAccountFor(ctx, id, { write = true } = {}) {
  const row = q.get('SELECT * FROM accounts WHERE id=?', Number(id));
  if (!row || !canRead(ctx, row)) throw bad('Conta inválida.', 'account_id');
  if (write && !canWrite(ctx, row)) throw forbidden('Você tem acesso somente leitura a esta conta.');
  if (row.archived) throw bad('Esta conta está arquivada.', 'account_id');
  return row;
}

export function coupleMemberIds(coupleId) {
  if (!coupleId) return [];
  return q.all('SELECT user_id FROM couple_members WHERE couple_id=?', coupleId).map((r) => r.user_id);
}

// ---------- auditoria ----------
export function audit(ctx, action, entity, entityId, details, scope) {
  try {
    q.run(
      'INSERT INTO audit_log(user_id,couple_id,scope,action,entity,entity_id,details,ip) VALUES (?,?,?,?,?,?,?,?)',
      ctx.userId ?? null, scope === 'couple' ? ctx.coupleId : null, scope || null, action, entity || null,
      entityId ?? null, details ? JSON.stringify(details) : null, ctx.ip || null,
    );
  } catch (e) { console.error('audit falhou', e.message); }
}

// ---------- eventos (SSE) ----------
const clients = new Map(); // userId -> Set<res>
export function addClient(userId, res) {
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId).add(res);
}
export function removeClient(userId, res) {
  const s = clients.get(userId); if (!s) return;
  s.delete(res); if (!s.size) clients.delete(userId);
}
export function emit(userIds, type, data = {}) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const id of new Set(userIds)) {
    for (const res of clients.get(id) || []) { try { res.write(payload); } catch { /* conexão caiu */ } }
  }
}
export function heartbeat() {
  for (const set of clients.values()) for (const res of set) { try { res.write(': ping\n\n'); } catch {} }
}
setInterval(heartbeat, 25_000).unref();

// Avisa os dispositivos relevantes que dados mudaram.
export function emitChange(ctx, scope, what = 'data') {
  const ids = scope === 'couple' ? coupleMemberIds(ctx.coupleId) : [ctx.userId];
  emit(ids, 'change', { scope, what, by: ctx.userId });
}

// ---------- notificações ----------
export function notify(userId, { type, title, body, link, dedupe }) {
  try {
    const r = q.run(
      'INSERT OR IGNORE INTO notifications(user_id,type,title,body,link,dedupe_key) VALUES (?,?,?,?,?,?)',
      userId, type, title, body || null, link || null, dedupe || null,
    );
    if (r.changes) emit([userId], 'notification', { type, title, body, link });
  } catch (e) { console.error('notify falhou', e.message); }
}

// ---------- categorias padrão ----------
const DEFAULT_EXPENSE = [
  ['Moradia', 'home', '#7aa2ff', ['Aluguel/Financiamento', 'Condomínio', 'Energia', 'Água', 'Internet', 'Manutenção']],
  ['Alimentação', 'cart', '#ff5d8f', ['Mercado', 'Restaurantes', 'Delivery', 'Padaria']],
  ['Transporte', 'car', '#ffb454', ['Combustível', 'Aplicativos', 'Transporte público', 'Manutenção do veículo']],
  ['Saúde', 'heart', '#3ddc97', ['Farmácia', 'Consultas', 'Plano de saúde']],
  ['Lazer', 'ticket', '#b38cff', ['Streaming', 'Passeios', 'Viagens']],
  ['Educação', 'book', '#4cc9f0', []],
  ['Compras', 'bag', '#ff8fb8', ['Roupas', 'Casa', 'Eletrônicos']],
  ['Assinaturas', 'repeat', '#9aa7ff', []],
  ['Pets', 'paw', '#f4a261', []],
  ['Presentes', 'gift', '#ff6b9d', []],
  ['Impostos e taxas', 'receipt', '#c0c6d8', []],
  ['Outros', 'dots', '#8a93ad', []],
];
const DEFAULT_INCOME = [
  ['Salário', 'briefcase', '#3ddc97'], ['Freelas', 'laptop', '#4cc9f0'], ['Rendimentos', 'trend', '#ffd166'],
  ['Reembolsos', 'undo', '#9aa7ff'], ['Presentes recebidos', 'gift', '#ff8fb8'], ['Outras receitas', 'dots', '#8a93ad'],
];
export function seedCategories(scope, userId, coupleId) {
  const ins = (name, kind, icon, color, parent) =>
    Number(q.run(
      'INSERT INTO categories(scope,user_id,couple_id,parent_id,name,kind,icon,color) VALUES (?,?,?,?,?,?,?,?)',
      scope, userId, coupleId, parent || null, name, kind, icon, color,
    ).lastInsertRowid);
  tx(() => {
    for (const [name, icon, color, subs] of DEFAULT_EXPENSE) {
      const id = ins(name, 'expense', icon, color);
      for (const s of subs) ins(s, 'expense', icon, color, id);
    }
    for (const [name, icon, color] of DEFAULT_INCOME) ins(name, 'income', icon, color);
  });
}

// ---------- saldos ----------
const MAX_DATE = '9999-12-31';
// Saldo das contas (apenas lançamentos pagos) até a data informada.
export function accountBalances(accountIds, asOf = MAX_DATE) {
  const out = new Map();
  if (!accountIds.length) return out;
  const ph = accountIds.map(() => '?').join(',');
  const rows = q.all(
    `SELECT a.id, a.initial_cents
      + IFNULL((SELECT SUM(CASE WHEN t.type='income' THEN t.amount_cents ELSE -t.amount_cents END)
                FROM transactions t WHERE t.account_id=a.id AND t.status='paid' AND t.type IN ('income','expense') AND t.date<=?),0)
      - IFNULL((SELECT SUM(t.amount_cents) FROM transactions t WHERE t.account_id=a.id AND t.type='transfer' AND t.date<=?),0)
      + IFNULL((SELECT SUM(t.amount_cents) FROM transactions t WHERE t.to_account_id=a.id AND t.type='transfer' AND t.date<=?),0)
      + IFNULL((SELECT SUM(CASE WHEN m.type='withdraw' THEN m.amount_cents ELSE -m.amount_cents END) FROM vault_movements m WHERE m.account_id=a.id AND m.date<=?),0)
      + IFNULL((SELECT SUM(CASE WHEN e.type='resgate' THEN e.amount_cents WHEN e.type='aporte' THEN -e.amount_cents ELSE 0 END) FROM investment_entries e WHERE e.account_id=a.id AND e.date<=?),0)
      AS balance
     FROM accounts a WHERE a.id IN (${ph})`,
    asOf, asOf, asOf, asOf, asOf, ...accountIds,
  );
  for (const r of rows) out.set(r.id, r.balance);
  return out;
}

export function vaultBalance(vaultId, asOf = MAX_DATE) {
  return q.get(
    `SELECT IFNULL(SUM(CASE WHEN type='deposit' THEN amount_cents ELSE -amount_cents END),0) AS b
     FROM vault_movements WHERE vault_id=? AND date<=?`, vaultId, asOf,
  ).b;
}

// Valor de um investimento: (último valuation + aportes líquidos depois) ou aportes líquidos.
export function investmentSnapshot(invId, asOf = MAX_DATE) {
  const entries = q.all('SELECT type, amount_cents, date, id FROM investment_entries WHERE investment_id=? AND date<=? ORDER BY date, id', invId, asOf);
  let invested = 0, value = 0;
  for (const e of entries) {
    if (e.type === 'aporte') { invested += e.amount_cents; value += e.amount_cents; }
    else if (e.type === 'resgate') {
      // resgate reduz o custo proporcionalmente ao valor resgatado
      const ratio = value > 0 ? Math.min(1, e.amount_cents / value) : 1;
      invested -= Math.round(invested * ratio); value -= e.amount_cents;
    } else if (e.type === 'valuation') { value = e.amount_cents; }
  }
  return { invested: Math.max(0, invested), value: Math.max(0, value) };
}
