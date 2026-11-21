// Contexto de acesso, escopos (pessoal/casal), auditoria, eventos em tempo real e notificações.
import { q, tx } from './db.js';
import { bad, forbidden, notFound } from './lib.js';

// ---------- contexto ----------
export async function getCtx(user, ip) {
  const m = await q.get('SELECT couple_id, role, can_edit, share_personal_total FROM couple_members WHERE user_id=?', user.id);
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
    : { sql: '(FALSE)', params: [] };
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
export async function getOwned(table, id, ctx, { write = false } = {}) {
  if (!TABLES.has(table)) throw new Error('tabela inválida');
  const n = Number(id);
  if (!Number.isInteger(n)) throw notFound();
  const row = await q.get(`SELECT * FROM ${table} WHERE id=?`, n);
  // 404 (e não 403) para não revelar a existência de registros alheios.
  if (!row || !canRead(ctx, row)) throw notFound();
  if (write && !canWrite(ctx, row)) throw forbidden('Você tem acesso somente leitura aos dados do casal.');
  return row;
}

// Conta acessível para o usuário (para uso em transações etc.).
export async function getAccountFor(ctx, id, { write = true } = {}) {
  const row = await q.get('SELECT * FROM accounts WHERE id=?', Number(id));
  if (!row || !canRead(ctx, row)) throw bad('Conta inválida.', 'account_id');
  if (write && !canWrite(ctx, row)) throw forbidden('Você tem acesso somente leitura a esta conta.');
  if (row.archived) throw bad('Esta conta está arquivada.', 'account_id');
  return row;
}

export async function coupleMemberIds(coupleId) {
  if (!coupleId) return [];
  return (await q.all('SELECT user_id FROM couple_members WHERE couple_id=?', coupleId)).map((r) => r.user_id);
}

// ---------- auditoria ----------
export async function audit(ctx, action, entity, entityId, details, scope) {
  try {
    await q.run(
      'INSERT INTO audit_log(user_id,couple_id,scope,action,entity,entity_id,details,ip) VALUES (?,?,?,?,?,?,?,?)',
      ctx.userId ?? null, scope === 'couple' ? ctx.coupleId : null, scope || null, action, entity || null,
      entityId ?? null, details ? JSON.stringify(details) : null, ctx.ip || null,
    );
  } catch (e) { console.error('audit falhou', e.message); }
}

// ---------- eventos (polling: tabela events) ----------
export async function emit(userIds, type, data = {}) {
  const ids = [...new Set(userIds)];
  if (!ids.length) return;
  try {
    const json = JSON.stringify(data);
    const ph = ids.map(() => '(?,?,?)').join(',');
    await q.run(`INSERT INTO events(user_id,type,data) VALUES ${ph}`, ...ids.flatMap((id) => [id, type, json]));
  } catch (e) { console.error('emit falhou', e.message); }
}
export async function pollEvents(userId, after) {
  const last = (await q.get('SELECT COALESCE(MAX(id),0) AS m FROM events WHERE user_id=?', userId)).m;
  if (after === null || after > last) return { events: [], last };
  const rows = await q.all('SELECT id,type,data FROM events WHERE user_id=? AND id>? ORDER BY id LIMIT 100', userId, after);
  const events = rows.map((r) => ({ id: r.id, type: r.type, data: r.data ? JSON.parse(r.data) : {} }));
  return { events, last: events.length ? events[events.length - 1].id : after };
}
export async function eventsCleanup() { await q.run("DELETE FROM events WHERE created_at < to_char((now() - interval '1 day') at time zone 'utc','YYYY-MM-DD HH24:MI:SS')"); }

// Avisa os dispositivos relevantes que dados mudaram.
export async function emitChange(ctx, scope, what = 'data') {
  const ids = scope === 'couple' ? await coupleMemberIds(ctx.coupleId) : [ctx.userId];
  await emit(ids, 'change', { scope, what, by: ctx.userId });
}

// ---------- notificações ----------
export async function notify(userId, { type, title, body, link, dedupe }) {
  try {
    const r = await q.run(
      'INSERT OR IGNORE INTO notifications(user_id,type,title,body,link,dedupe_key) VALUES (?,?,?,?,?,?)',
      userId, type, title, body || null, link || null, dedupe || null,
    );
    if (r.changes) await emit([userId], 'notification', { type, title, body, link });
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
export async function seedCategories(scope, userId, coupleId) {
  const ins = async (name, kind, icon, color, parent) =>
    Number((await q.run(
      'INSERT INTO categories(scope,user_id,couple_id,parent_id,name,kind,icon,color) VALUES (?,?,?,?,?,?,?,?)',
      scope, userId, coupleId, parent || null, name, kind, icon, color,
    )).lastInsertRowid);
  await tx(async () => {
    for (const [name, icon, color, subs] of DEFAULT_EXPENSE) {
      const id = await ins(name, 'expense', icon, color);
      for (const s of subs) await ins(s, 'expense', icon, color, id);
    }
    for (const [name, icon, color] of DEFAULT_INCOME) await ins(name, 'income', icon, color);
  });
}

// ---------- saldos ----------
const MAX_DATE = '9999-12-31';
// Saldo das contas (apenas lançamentos pagos) até a data informada.
export async function accountBalances(accountIds, asOf = MAX_DATE) {
  const out = new Map();
  if (!accountIds.length) return out;
  const ph = accountIds.map(() => '?').join(',');
  const rows = await q.all(
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

export async function vaultBalance(vaultId, asOf = MAX_DATE) {
  return (await q.get(
    `SELECT IFNULL(SUM(CASE WHEN type='deposit' THEN amount_cents ELSE -amount_cents END),0) AS b
     FROM vault_movements WHERE vault_id=? AND date<=?`, vaultId, asOf,
  )).b;
}

// Valor de um investimento: (último valuation + aportes líquidos depois) ou aportes líquidos.
export async function investmentSnapshot(invId, asOf = MAX_DATE) {
  const entries = await q.all('SELECT type, amount_cents, date, id FROM investment_entries WHERE investment_id=? AND date<=? ORDER BY date, id', invId, asOf);
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
