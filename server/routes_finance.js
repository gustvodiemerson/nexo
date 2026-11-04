// Contas, categorias, lançamentos (receitas/despesas/transferências), recorrências, parcelas, orçamentos, contas a pagar.
import { q, tx } from './db.js';
import { get, post, patch, del } from './router.js';
import { v, bad, forbidden, notFound, HttpError, uuid, todayISO, addMonths, addDays, monthStart, monthEnd } from './lib.js';
import {
  parseScope, scopeSql, writeTarget, getOwned, getAccountFor, canRead, canWrite, audit, emitChange, notify, accountBalances,
} from './core.js';
import { balanceSummary, budgetStatus, pendingBills, checkBudgetAlerts, sums } from './calc.js';

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const color = (c) => (typeof c === 'string' && COLOR_RE.test(c) ? c : null);
const ICON_RE = /^[a-z0-9_-]{1,24}$/;

// ================= contas =================
get('/api/accounts', (req) => {
  const scope = parseScope(req.ctx, req.query.scope);
  const b = balanceSummary(req.ctx, scope);
  const archived = req.query.archived === '1';
  let accounts = b.accounts;
  if (archived) {
    const s = scopeSql(req.ctx, scope);
    const rows = q.all(`SELECT * FROM accounts WHERE ${s.sql} AND archived=1 ORDER BY id`, ...s.params);
    const bal = accountBalances(rows.map((r) => r.id));
    accounts = rows.map((r) => ({ ...r, balance_cents: bal.get(r.id) || 0 }));
  }
  const today = todayISO();
  accounts = accounts.map((a) => {
    if (a.type !== 'card') return a;
    const debt = -a.balance_cents;
    return { ...a, invoice_cents: debt, available_cents: a.credit_limit_cents != null ? a.credit_limit_cents - debt : null,
      next_due: a.due_day ? nextDay(today, a.due_day) : null };
  });
  return { accounts, total_cents: b.total_cents, card_debt_cents: b.card_debt_cents };
});

function nextDay(today, day) {
  const [y, m, d] = today.split('-').map(Number);
  const mk = (yy, mm) => { const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate(); return `${yy}-${String(mm).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`; };
  const cur = mk(y, m);
  if (cur >= today) return cur;
  const t = y * 12 + m; return mk(Math.floor(t / 12), (t % 12) + 1);
}

function accountFields(b, existing) {
  const type = existing ? existing.type : v.oneOf(b.type, ['checking', 'wallet', 'savings', 'card'], { field: 'tipo' });
  const out = {
    name: v.str(b.name ?? existing?.name, { field: 'nome', min: 2, max: 40 }),
    color: color(b.color) || existing?.color || '#7aa2ff',
  };
  out.initial_cents = b.initial_cents === undefined ? (existing?.initial_cents ?? 0) : v.int(b.initial_cents, { field: 'saldo inicial', min: -100_000_000_000_00, max: 100_000_000_000_00 });
  if (type === 'card') {
    out.credit_limit_cents = b.credit_limit_cents === undefined ? existing?.credit_limit_cents ?? null : v.cents(b.credit_limit_cents, { field: 'limite', required: false, allowZero: true });
    out.closing_day = b.closing_day === undefined ? existing?.closing_day ?? null : v.int(b.closing_day, { field: 'dia de fechamento', min: 1, max: 31, required: false });
    out.due_day = b.due_day === undefined ? existing?.due_day ?? null : v.int(b.due_day, { field: 'dia de vencimento', min: 1, max: 31, required: false });
  } else { out.credit_limit_cents = null; out.closing_day = null; out.due_day = null; }
  return { type, ...out };
}

post('/api/accounts', (req) => {
  const ctx = req.ctx;
  const target = writeTarget(ctx, v.oneOf(req.body.scope, ['personal', 'couple'], { field: 'escopo' }));
  const f = accountFields(req.body);
  const id = Number(q.run(
    'INSERT INTO accounts(scope,user_id,couple_id,name,type,initial_cents,credit_limit_cents,closing_day,due_day,color) VALUES (?,?,?,?,?,?,?,?,?,?)',
    target.scope, target.user_id, target.couple_id, f.name, f.type, f.initial_cents, f.credit_limit_cents, f.closing_day, f.due_day, f.color,
  ).lastInsertRowid);
  audit(ctx, 'account.create', 'account', id, { name: f.name, type: f.type, initial_cents: f.initial_cents }, target.scope);
  emitChange(ctx, target.scope, 'accounts');
  req.status = 201;
  return { account: q.get('SELECT * FROM accounts WHERE id=?', id) };
});

patch('/api/accounts/:id', (req) => {
  const ctx = req.ctx;
  const row = getOwned('accounts', req.params.id, ctx, { write: true });
  const f = accountFields(req.body, row);
  const archived = req.body.archived === undefined ? row.archived : v.bool(req.body.archived);
  q.run('UPDATE accounts SET name=?, initial_cents=?, credit_limit_cents=?, closing_day=?, due_day=?, color=?, archived=? WHERE id=?',
    f.name, f.initial_cents, f.credit_limit_cents, f.closing_day, f.due_day, f.color, archived, row.id);
  audit(ctx, 'account.update', 'account', row.id, { name: f.name, initial_cents: f.initial_cents, archived }, row.scope);
  emitChange(ctx, row.scope, 'accounts');
  return { account: q.get('SELECT * FROM accounts WHERE id=?', row.id) };
});

del('/api/accounts/:id', (req) => {
  const ctx = req.ctx;
  const row = getOwned('accounts', req.params.id, ctx, { write: true });
  const used = q.get(
    `SELECT (SELECT COUNT(*) FROM transactions WHERE account_id=? OR to_account_id=?)
          + (SELECT COUNT(*) FROM vault_movements WHERE account_id=?)
          + (SELECT COUNT(*) FROM investment_entries WHERE account_id=?) AS n`, row.id, row.id, row.id, row.id).n;
  if (used > 0) throw new HttpError(409, 'Esta conta possui movimentações. Arquive-a em vez de excluir para preservar o histórico.');
  q.run('DELETE FROM accounts WHERE id=?', row.id);
  audit(ctx, 'account.delete', 'account', row.id, { name: row.name }, row.scope);
  emitChange(ctx, row.scope, 'accounts');
  return { ok: true };
});

// ================= categorias =================
get('/api/categories', (req) => {
  const scope = parseScope(req.ctx, req.query.scope);
  const s = scopeSql(req.ctx, scope);
  const kind = req.query.kind;
  const rows = q.all(`SELECT * FROM categories WHERE ${s.sql} ${kind ? 'AND kind=?' : ''} ORDER BY parent_id IS NOT NULL, name`, ...s.params, ...(kind ? [kind] : []));
  const roots = rows.filter((r) => !r.parent_id).map((r) => ({ ...r, children: [] }));
  const byId = new Map(roots.map((r) => [r.id, r]));
  for (const r of rows) if (r.parent_id && byId.has(r.parent_id)) byId.get(r.parent_id).children.push(r);
  return { categories: roots };
});

post('/api/categories', (req) => {
  const ctx = req.ctx;
  const target = writeTarget(ctx, v.oneOf(req.body.scope, ['personal', 'couple'], { field: 'escopo' }));
  const name = v.str(req.body.name, { field: 'nome', min: 2, max: 40 });
  let kind = v.oneOf(req.body.kind, ['income', 'expense'], { field: 'tipo' });
  let parent = null, icon = ICON_RE.test(req.body.icon || '') ? req.body.icon : 'dots', col = color(req.body.color) || '#8a93ad';
  if (req.body.parent_id) {
    parent = getOwned('categories', req.body.parent_id, ctx, { write: true });
    if (parent.scope !== target.scope || parent.parent_id) throw bad('Categoria pai inválida.', 'parent_id');
    kind = parent.kind; icon = parent.icon; col = parent.color;
  }
  const id = Number(q.run('INSERT INTO categories(scope,user_id,couple_id,parent_id,name,kind,icon,color) VALUES (?,?,?,?,?,?,?,?)',
    target.scope, target.user_id, target.couple_id, parent?.id || null, name, kind, icon, col).lastInsertRowid);
  audit(ctx, 'category.create', 'category', id, { name }, target.scope);
  emitChange(ctx, target.scope, 'categories');
  req.status = 201;
  return { category: q.get('SELECT * FROM categories WHERE id=?', id) };
});

patch('/api/categories/:id', (req) => {
  const row = getOwned('categories', req.params.id, req.ctx, { write: true });
  const name = v.str(req.body.name ?? row.name, { field: 'nome', min: 2, max: 40 });
  const col = row.parent_id ? row.color : (color(req.body.color) || row.color);
  const icon = row.parent_id ? row.icon : (ICON_RE.test(req.body.icon || '') ? req.body.icon : row.icon);
  q.run('UPDATE categories SET name=?, color=?, icon=? WHERE id=?', name, col, icon, row.id);
  if (!row.parent_id) q.run('UPDATE categories SET color=?, icon=? WHERE parent_id=?', col, icon, row.id);
  audit(req.ctx, 'category.update', 'category', row.id, { name }, row.scope);
  emitChange(req.ctx, row.scope, 'categories');
  return { category: q.get('SELECT * FROM categories WHERE id=?', row.id) };
});

del('/api/categories/:id', (req) => {
  const row = getOwned('categories', req.params.id, req.ctx, { write: true });
  q.run('DELETE FROM categories WHERE id=?', row.id); // lançamentos ficam "sem categoria"
  audit(req.ctx, 'category.delete', 'category', row.id, { name: row.name }, row.scope);
  emitChange(req.ctx, row.scope, 'categories');
  return { ok: true };
});

// Dados de apoio para formulários.
get('/api/lookups', (req) => {
  const scope = parseScope(req.ctx, req.query.scope);
  const b = balanceSummary(req.ctx, scope);
  const s = scopeSql(req.ctx, scope);
  const cats = q.all(`SELECT id, scope, parent_id, name, kind, icon, color FROM categories WHERE ${s.sql} ORDER BY name`, ...s.params);
  const vaults = q.all(`SELECT id, scope, name, color FROM vaults WHERE ${s.sql} AND archived=0 ORDER BY name`, ...s.params);
  const members = req.ctx.coupleId
    ? q.all('SELECT u.id, u.name FROM couple_members m JOIN users u ON u.id=m.user_id WHERE m.couple_id=?', req.ctx.coupleId) : [{ id: req.ctx.userId, name: req.user.name }];
  return { accounts: b.accounts.map(({ id, scope: sc, name, type, color: c, balance_cents }) => ({ id, scope: sc, name, type, color: c, balance_cents })), categories: cats, vaults, members, today: todayISO() };
});

// ================= lançamentos =================
const TX_SELECT = `SELECT t.*, c.name AS category_name, c.color AS category_color, c.icon AS category_icon, pc.name AS parent_category_name,
  a.name AS account_name, a.type AS account_type, ta.name AS to_account_name, u.name AS user_name
  FROM transactions t LEFT JOIN categories c ON c.id=t.category_id LEFT JOIN categories pc ON pc.id=c.parent_id
  LEFT JOIN accounts a ON a.id=t.account_id LEFT JOIN accounts ta ON ta.id=t.to_account_id LEFT JOIN users u ON u.id=t.user_id`;

get('/api/transactions', (req) => {
  const ctx = req.ctx, Q = req.query;
  const scope = parseScope(ctx, Q.scope);
  const s = scopeSql(ctx, scope, 't.');
  const where = [s.sql], params = [...s.params];
  if (Q.from) { where.push('t.date>=?'); params.push(v.date(Q.from, { field: 'data inicial' })); }
  if (Q.to) { where.push('t.date<=?'); params.push(v.date(Q.to, { field: 'data final' })); }
  if (Q.type) { where.push('t.type=?'); params.push(v.oneOf(Q.type, ['income', 'expense', 'transfer'], { field: 'tipo' })); }
  if (Q.status) { where.push('t.status=?'); params.push(v.oneOf(Q.status, ['paid', 'pending'], { field: 'status' })); }
  if (Q.account_id) { where.push('(t.account_id=? OR t.to_account_id=?)'); params.push(Number(Q.account_id), Number(Q.account_id)); }
  if (Q.user_id) { where.push('t.user_id=?'); params.push(Number(Q.user_id)); }
  if (Q.category_id) {
    where.push('t.category_id IN (SELECT id FROM categories WHERE id=? OR parent_id=?)'); params.push(Number(Q.category_id), Number(Q.category_id));
  }
  if (Q.q) { where.push("(t.description LIKE ? ESCAPE '\\' OR t.notes LIKE ? ESCAPE '\\')"); const like = '%' + String(Q.q).slice(0, 60).replace(/[\\%_]/g, '\\$&') + '%'; params.push(like, like); }
  const W = where.join(' AND ');
  const limit = Math.min(Math.max(Number(Q.limit) || 50, 1), 200), offset = Math.max(Number(Q.offset) || 0, 0);
  const rows = q.all(`${TX_SELECT} WHERE ${W} ORDER BY t.date DESC, t.id DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
  const tot = q.all(`SELECT t.type, SUM(t.amount_cents) AS total, COUNT(*) AS n FROM transactions t WHERE ${W} AND t.status='paid' GROUP BY t.type`, ...params);
  const count = q.get(`SELECT COUNT(*) AS n FROM transactions t WHERE ${W}`, ...params).n;
  const totals = { income_cents: 0, expense_cents: 0, transfer_cents: 0 };
  for (const r of tot) totals[r.type + '_cents'] = r.total;
  return { transactions: rows, count, limit, offset, totals };
});

get('/api/transactions/:id', (req) => {
  const row = getOwned('transactions', req.params.id, req.ctx);
  return { transaction: q.get(`${TX_SELECT} WHERE t.id=?`, row.id) };
});

function getCategoryFor(ctx, id, scope, type) {
  if (id === undefined || id === null || id === '') return null;
  const c = q.get('SELECT * FROM categories WHERE id=?', Number(id));
  if (!c || !canRead(ctx, c) || c.scope !== scope) throw bad('Categoria inválida.', 'category_id');
  if (c.kind !== type) throw bad('A categoria não corresponde ao tipo do lançamento.', 'category_id');
  return c;
}

function nextOccurrence(date, freq) {
  return freq === 'weekly' ? addDays(date, 7) : freq === 'yearly' ? addMonths(date, 12) : addMonths(date, 1);
}

const isUniqueError = (e) => /UNIQUE constraint failed/i.test(String(e.message));

post('/api/transactions', (req) => {
  const ctx = req.ctx, b = req.body;
  const scope = v.oneOf(b.scope, ['personal', 'couple'], { field: 'escopo' });
  const target = writeTarget(ctx, scope);
  const type = v.oneOf(b.type, ['income', 'expense', 'transfer'], { field: 'tipo' });
  const account = getAccountFor(ctx, b.account_id);
  if (account.scope !== scope) throw bad('A conta precisa pertencer ao mesmo ambiente (pessoal/casal) do lançamento.', 'account_id');
  const amount = v.cents(b.amount_cents);
  const date = v.date(b.date);
  const description = v.str(b.description, { field: 'descrição', max: 120 });
  const notes = v.str(b.notes, { field: 'observações', max: 500, required: false });
  const status = type === 'transfer' ? 'paid' : v.oneOf(b.status, ['paid', 'pending'], { def: 'paid', field: 'situação' });
  const idem = b.idempotency_key ? v.str(b.idempotency_key, { field: 'chave', max: 100 }) : null;

  if (idem) {
    const ex = q.get('SELECT id FROM transactions WHERE user_id=? AND idempotency_key=?', ctx.userId, idem);
    if (ex) return { transaction: q.get(`${TX_SELECT} WHERE t.id=?`, ex.id), duplicate: true };
  }
  let toAccount = null, category = null;
  if (type === 'transfer') {
    toAccount = getAccountFor(ctx, b.to_account_id);
    if (toAccount.scope !== scope) throw bad('As duas contas precisam pertencer ao mesmo ambiente.', 'to_account_id');
    if (toAccount.id === account.id) throw bad('Escolha contas diferentes na transferência.', 'to_account_id');
  } else category = getCategoryFor(ctx, b.category_id, scope, type);

  const installments = b.installments ? v.int(b.installments, { field: 'parcelas', min: 1, max: 60 }) : 1;
  const rec = b.recurrence && b.recurrence.frequency ? b.recurrence : null;
  if (installments > 1 && (rec || type === 'transfer')) throw bad('Parcelamento não pode ser combinado com recorrência ou transferência.');
  if (rec && type === 'transfer') throw bad('Transferências não podem ser recorrentes.');

  let firstId;
  try {
    firstId = tx(() => {
      const ins = (o) => Number(q.run(
        `INSERT INTO transactions(scope,user_id,couple_id,account_id,to_account_id,type,amount_cents,date,due_date,status,category_id,description,notes,
           recurring_id,installment_group,installment_no,installment_total,idempotency_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        target.scope, target.user_id, target.couple_id, account.id, toAccount?.id ?? null, type, o.amount, o.date, o.status === 'pending' ? o.date : null,
        o.status, category?.id ?? null, o.description, notes, o.recurring_id ?? null, o.group ?? null, o.no ?? null, o.total ?? null, o.idem ?? null,
      ).lastInsertRowid);
      if (installments > 1) {
        const group = uuid(), base = Math.floor(amount / installments), rest = amount - base * installments;
        let first;
        for (let i = 0; i < installments; i++) {
          const id = ins({
            amount: base + (i === 0 ? rest : 0), date: addMonths(date, i), status: i === 0 ? status : 'pending',
            description: `${description} (${i + 1}/${installments})`, group, no: i + 1, total: installments, idem: i === 0 ? idem : null,
          });
          if (i === 0) first = id;
        }
        return first;
      }
      let recId = null;
      if (rec) {
        const frequency = v.oneOf(rec.frequency, ['weekly', 'monthly', 'yearly'], { field: 'frequência' });
        const end = rec.end_date ? v.date(rec.end_date, { field: 'data final da recorrência' }) : null;
        recId = Number(q.run(
          `INSERT INTO recurring(scope,user_id,couple_id,account_id,category_id,type,amount_cents,description,frequency,next_date,end_date,auto_paid)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          target.scope, target.user_id, target.couple_id, account.id, category?.id ?? null, type, amount, description, frequency,
          nextOccurrence(date, frequency), end, v.bool(rec.auto_paid, false),
        ).lastInsertRowid);
      }
      return ins({ amount, date, status, description, recurring_id: recId, idem });
    });
  } catch (e) {
    if (idem && isUniqueError(e)) {
      const ex = q.get('SELECT id FROM transactions WHERE user_id=? AND idempotency_key=?', ctx.userId, idem);
      if (ex) return { transaction: q.get(`${TX_SELECT} WHERE t.id=?`, ex.id), duplicate: true };
    }
    throw e;
  }
  audit(ctx, 'transaction.create', 'transaction', firstId, { type, amount_cents: amount, date, status, installments, recurring: !!rec, account_id: account.id }, scope);
  if (type === 'expense' && status === 'paid') checkBudgetAlerts(ctx, scope, date, notify);
  emitChange(ctx, scope, 'transactions');
  req.status = 201;
  return { transaction: q.get(`${TX_SELECT} WHERE t.id=?`, firstId) };
});

patch('/api/transactions/:id', (req) => {
  const ctx = req.ctx, b = req.body;
  const row = getOwned('transactions', req.params.id, ctx, { write: true });
  const f = {
    description: b.description !== undefined ? v.str(b.description, { field: 'descrição', max: 120 }) : row.description,
    notes: b.notes !== undefined ? v.str(b.notes, { field: 'observações', max: 500, required: false }) : row.notes,
    amount: b.amount_cents !== undefined ? v.cents(b.amount_cents) : row.amount_cents,
    date: b.date !== undefined ? v.date(b.date) : row.date,
    status: row.type === 'transfer' ? 'paid' : b.status !== undefined ? v.oneOf(b.status, ['paid', 'pending'], { field: 'situação' }) : row.status,
    account_id: row.account_id, to_account_id: row.to_account_id, category_id: row.category_id,
  };
  if (b.account_id !== undefined && Number(b.account_id) !== row.account_id) {
    const a = getAccountFor(ctx, b.account_id); if (a.scope !== row.scope) throw bad('Conta inválida para este ambiente.', 'account_id'); f.account_id = a.id;
  }
  if (row.type === 'transfer' && b.to_account_id !== undefined) {
    const a = getAccountFor(ctx, b.to_account_id); if (a.scope !== row.scope) throw bad('Conta inválida para este ambiente.', 'to_account_id'); f.to_account_id = a.id;
  }
  if (row.type === 'transfer' && f.account_id === f.to_account_id) throw bad('Escolha contas diferentes na transferência.');
  if (row.type !== 'transfer' && b.category_id !== undefined) f.category_id = getCategoryFor(ctx, b.category_id, row.scope, row.type)?.id ?? null;
  q.run(`UPDATE transactions SET description=?, notes=?, amount_cents=?, date=?, status=?, due_date=?, account_id=?, to_account_id=?, category_id=?, updated_at=datetime('now') WHERE id=?`,
    f.description, f.notes, f.amount, f.date, f.status, f.status === 'pending' ? f.date : row.due_date, f.account_id, f.to_account_id, f.category_id, row.id);
  audit(ctx, 'transaction.update', 'transaction', row.id, { before: { amount_cents: row.amount_cents, date: row.date, status: row.status }, after: { amount_cents: f.amount, date: f.date, status: f.status } }, row.scope);
  if (row.type === 'expense' && f.status === 'paid') checkBudgetAlerts(ctx, row.scope, f.date, notify);
  emitChange(ctx, row.scope, 'transactions');
  return { transaction: q.get(`${TX_SELECT} WHERE t.id=?`, row.id) };
});

// Dar baixa em um lançamento pendente (conta a pagar/receber).
post('/api/transactions/:id/pay', (req) => {
  const ctx = req.ctx;
  const row = getOwned('transactions', req.params.id, ctx, { write: true });
  if (row.status === 'paid') throw bad('Este lançamento já foi baixado.');
  const date = req.body.date ? v.date(req.body.date) : todayISO();
  let accountId = row.account_id;
  if (req.body.account_id && Number(req.body.account_id) !== row.account_id) {
    const a = getAccountFor(ctx, req.body.account_id); if (a.scope !== row.scope) throw bad('Conta inválida para este ambiente.', 'account_id'); accountId = a.id;
  }
  q.run("UPDATE transactions SET status='paid', date=?, account_id=?, updated_at=datetime('now') WHERE id=?", date, accountId, row.id);
  audit(ctx, 'transaction.pay', 'transaction', row.id, { amount_cents: row.amount_cents, date }, row.scope);
  if (row.type === 'expense') checkBudgetAlerts(ctx, row.scope, date, notify);
  emitChange(ctx, row.scope, 'transactions');
  return { transaction: q.get(`${TX_SELECT} WHERE t.id=?`, row.id) };
});

del('/api/transactions/:id', (req) => {
  const ctx = req.ctx;
  const row = getOwned('transactions', req.params.id, ctx, { write: true });
  let n;
  if (row.installment_group && (req.query.group === 'all' || req.query.group === 'following')) {
    n = q.run(
      `DELETE FROM transactions WHERE installment_group=? AND scope=? AND IFNULL(couple_id,0)=IFNULL(?,0) ${req.query.group === 'following' ? 'AND installment_no>=?' : ''}`,
      row.installment_group, row.scope, row.couple_id, ...(req.query.group === 'following' ? [row.installment_no] : []),
    ).changes;
  } else n = q.run('DELETE FROM transactions WHERE id=?', row.id).changes;
  audit(ctx, 'transaction.delete', 'transaction', row.id, { amount_cents: row.amount_cents, description: row.description, date: row.date, removed: n }, row.scope);
  emitChange(ctx, row.scope, 'transactions');
  return { ok: true, removed: Number(n) };
});

// ================= recorrências =================
get('/api/recurring', (req) => {
  const scope = parseScope(req.ctx, req.query.scope);
  const s = scopeSql(req.ctx, scope, 'r.');
  return {
    recurring: q.all(
      `SELECT r.*, a.name AS account_name, c.name AS category_name, c.color AS category_color FROM recurring r
       LEFT JOIN accounts a ON a.id=r.account_id LEFT JOIN categories c ON c.id=r.category_id WHERE ${s.sql} ORDER BY r.active DESC, r.next_date`, ...s.params),
  };
});
patch('/api/recurring/:id', (req) => {
  const row = getOwned('recurring', req.params.id, req.ctx, { write: true });
  const b = req.body;
  q.run('UPDATE recurring SET description=?, amount_cents=?, end_date=?, auto_paid=?, active=? WHERE id=?',
    b.description !== undefined ? v.str(b.description, { field: 'descrição', max: 120 }) : row.description,
    b.amount_cents !== undefined ? v.cents(b.amount_cents) : row.amount_cents,
    b.end_date !== undefined ? v.date(b.end_date, { required: false }) : row.end_date,
    b.auto_paid !== undefined ? v.bool(b.auto_paid) : row.auto_paid,
    b.active !== undefined ? v.bool(b.active) : row.active, row.id);
  audit(req.ctx, 'recurring.update', 'recurring', row.id, null, row.scope);
  emitChange(req.ctx, row.scope, 'transactions');
  return { recurring: q.get('SELECT * FROM recurring WHERE id=?', row.id) };
});
del('/api/recurring/:id', (req) => {
  const row = getOwned('recurring', req.params.id, req.ctx, { write: true });
  q.run('DELETE FROM recurring WHERE id=?', row.id); // lançamentos já gerados permanecem
  audit(req.ctx, 'recurring.delete', 'recurring', row.id, { description: row.description }, row.scope);
  emitChange(req.ctx, row.scope, 'transactions');
  return { ok: true };
});

// ================= contas a pagar / receber =================
get('/api/bills', (req) => {
  const scope = parseScope(req.ctx, req.query.scope);
  const b = pendingBills(req.ctx, scope, todayISO(), 30);
  return { ...b, today: todayISO() };
});

// ================= orçamentos =================
get('/api/budgets', (req) => {
  const scope = parseScope(req.ctx, req.query.scope);
  const month = req.query.month || todayISO().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) throw bad('Mês inválido.', 'month');
  return { month, budgets: budgetStatus(req.ctx, scope, month + '-01') };
});
post('/api/budgets', (req) => {
  const ctx = req.ctx;
  const target = writeTarget(ctx, v.oneOf(req.body.scope, ['personal', 'couple'], { field: 'escopo' }));
  const limit = v.cents(req.body.limit_cents, { field: 'limite' });
  let cat = null;
  if (req.body.category_id) {
    cat = getOwned('categories', req.body.category_id, ctx);
    if (cat.scope !== target.scope || cat.kind !== 'expense' || cat.parent_id) throw bad('Escolha uma categoria de despesa principal deste ambiente.', 'category_id');
  }
  const exists = target.scope === 'couple'
    ? q.get('SELECT id FROM budgets WHERE couple_id=? AND IFNULL(category_id,0)=?', target.couple_id, cat?.id ?? 0)
    : q.get("SELECT id FROM budgets WHERE scope='personal' AND user_id=? AND IFNULL(category_id,0)=?", target.user_id, cat?.id ?? 0);
  let id;
  if (exists) { q.run('UPDATE budgets SET limit_cents=? WHERE id=?', limit, exists.id); id = exists.id; }
  else id = Number(q.run('INSERT INTO budgets(scope,user_id,couple_id,category_id,limit_cents) VALUES (?,?,?,?,?)', target.scope, target.user_id, target.couple_id, cat?.id ?? null, limit).lastInsertRowid);
  audit(ctx, 'budget.upsert', 'budget', id, { limit_cents: limit, category_id: cat?.id ?? null }, target.scope);
  emitChange(ctx, target.scope, 'budgets');
  req.status = exists ? 200 : 201;
  return { ok: true, id };
});
del('/api/budgets/:id', (req) => {
  const row = getOwned('budgets', req.params.id, req.ctx, { write: true });
  q.run('DELETE FROM budgets WHERE id=?', row.id);
  audit(req.ctx, 'budget.delete', 'budget', row.id, null, row.scope);
  emitChange(req.ctx, row.scope, 'budgets');
  return { ok: true };
});

// ================= planejamento mensal =================
get('/api/planning', (req) => {
  const ctx = req.ctx;
  const scope = parseScope(ctx, req.query.scope);
  const month = req.query.month || todayISO().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) throw bad('Mês inválido.', 'month');
  const from = month + '-01', to = monthEnd(from);
  const s = scopeSql(ctx, scope, 't.');
  const pend = q.all(`SELECT t.type, SUM(t.amount_cents) AS total, COUNT(*) AS n FROM transactions t WHERE ${s.sql} AND t.status='pending' AND t.type IN ('income','expense') AND t.date BETWEEN ? AND ? GROUP BY t.type`, ...s.params, from, to);
  const rs = scopeSql(ctx, scope, 'r.');
  const rec = q.all(`SELECT r.type, r.frequency, r.amount_cents, r.next_date, r.end_date FROM recurring r WHERE ${rs.sql} AND r.active=1`, ...rs.params);
  // Recorrências ainda não lançadas dentro do mês (previstas).
  let expectedIncome = 0, expectedExpense = 0;
  for (const r of rec) {
    let d = r.next_date, guard = 0;
    while (d <= to && guard++ < 40) {
      if (d >= from && (!r.end_date || d <= r.end_date)) { if (r.type === 'income') expectedIncome += r.amount_cents; else expectedExpense += r.amount_cents; }
      d = nextOccurrence(d, r.frequency);
    }
  }
  const done = sums(ctx, scope, from, to);
  const pendIncome = pend.find((p) => p.type === 'income')?.total || 0, pendExpense = pend.find((p) => p.type === 'expense')?.total || 0;
  const budgets = budgetStatus(ctx, scope, from);
  return {
    month,
    income: { received_cents: done.income, pending_cents: pendIncome, expected_recurring_cents: expectedIncome },
    expense: { paid_cents: done.expense, pending_cents: pendExpense, expected_recurring_cents: expectedExpense },
    projected_result_cents: done.income + pendIncome + expectedIncome - done.expense - pendExpense - expectedExpense,
    budgets, budget_total_cents: budgets.filter((b) => b.category_id).reduce((x, b) => x + b.limit_cents, 0),
    overall_budget: budgets.find((b) => !b.category_id) || null,
  };
});
