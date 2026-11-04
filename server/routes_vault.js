// Cofre (reservas), metas e investimentos.
import { q, tx } from './db.js';
import { get, post, patch, del } from './router.js';
import { v, bad, notFound, HttpError, todayISO, addMonths, ym } from './lib.js';
import { parseScope, scopeSql, writeTarget, getOwned, getAccountFor, canRead, audit, emitChange, notify, vaultBalance, investmentSnapshot, accountBalances, coupleMemberIds } from './core.js';
import { vaultsSummary, investmentsSummary, goalsWithProgress, brl } from './calc.js';

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const color = (c, d = '#ffc857') => (typeof c === 'string' && COLOR_RE.test(c) ? c : d);
const isUniqueError = (e) => /UNIQUE constraint failed/i.test(String(e.message));
const others = (ctx, scope) => (scope === 'couple' ? coupleMemberIds(ctx.coupleId).filter((id) => id !== ctx.userId) : []);

// ================= cofre =================
get('/api/vaults', (req) => {
  const scope = parseScope(req.ctx, req.query.scope);
  const sum = vaultsSummary(req.ctx, scope);
  return {
    total_cents: sum.total_cents,
    vaults: sum.items.map((i) => ({ ...i, pct: i.target_cents ? Math.min(1, i.balance_cents / i.target_cents) : null })),
  };
});

get('/api/vaults/:id', (req) => {
  const vault = getOwned('vaults', req.params.id, req.ctx);
  const movements = q.all(
    `SELECT m.*, u.name AS user_name, a.name AS account_name FROM vault_movements m JOIN users u ON u.id=m.user_id LEFT JOIN accounts a ON a.id=m.account_id
     WHERE m.vault_id=? ORDER BY m.date DESC, m.id DESC LIMIT 200`, vault.id);
  const balance = vaultBalance(vault.id);
  return { vault: { ...vault, balance_cents: balance, pct: vault.target_cents ? Math.min(1, balance / vault.target_cents) : null }, movements };
});

post('/api/vaults', (req) => {
  const ctx = req.ctx;
  const target = writeTarget(ctx, v.oneOf(req.body.scope, ['personal', 'couple'], { field: 'escopo' }));
  const name = v.str(req.body.name, { field: 'nome', min: 2, max: 50 });
  const t = v.cents(req.body.target_cents, { field: 'objetivo', required: false });
  const deadline = v.date(req.body.deadline, { field: 'prazo', required: false });
  const id = Number(q.run('INSERT INTO vaults(scope,user_id,couple_id,name,target_cents,deadline,color) VALUES (?,?,?,?,?,?,?)',
    target.scope, target.user_id, target.couple_id, name, t, deadline, color(req.body.color)).lastInsertRowid);
  audit(ctx, 'vault.create', 'vault', id, { name, target_cents: t }, target.scope);
  emitChange(ctx, target.scope, 'vaults');
  req.status = 201;
  return { vault: q.get('SELECT * FROM vaults WHERE id=?', id) };
});

patch('/api/vaults/:id', (req) => {
  const row = getOwned('vaults', req.params.id, req.ctx, { write: true });
  const b = req.body;
  q.run('UPDATE vaults SET name=?, target_cents=?, deadline=?, color=?, archived=? WHERE id=?',
    b.name !== undefined ? v.str(b.name, { field: 'nome', min: 2, max: 50 }) : row.name,
    b.target_cents !== undefined ? v.cents(b.target_cents, { required: false }) : row.target_cents,
    b.deadline !== undefined ? v.date(b.deadline, { required: false }) : row.deadline,
    b.color !== undefined ? color(b.color) : row.color,
    b.archived !== undefined ? v.bool(b.archived) : row.archived, row.id);
  audit(req.ctx, 'vault.update', 'vault', row.id, null, row.scope);
  emitChange(req.ctx, row.scope, 'vaults');
  return { vault: q.get('SELECT * FROM vaults WHERE id=?', row.id) };
});

del('/api/vaults/:id', (req) => {
  const row = getOwned('vaults', req.params.id, req.ctx, { write: true });
  if (vaultBalance(row.id) > 0) throw new HttpError(409, 'Retire o saldo do cofre para uma conta antes de excluí-lo.');
  q.run('DELETE FROM vaults WHERE id=?', row.id);
  audit(req.ctx, 'vault.delete', 'vault', row.id, { name: row.name }, row.scope);
  emitChange(req.ctx, row.scope, 'vaults');
  return { ok: true };
});

post('/api/vaults/:id/movements', (req) => {
  const ctx = req.ctx, b = req.body;
  const vault = getOwned('vaults', req.params.id, ctx, { write: true });
  const type = v.oneOf(b.type, ['deposit', 'withdraw'], { field: 'tipo' });
  const amount = v.cents(b.amount_cents);
  const date = v.date(b.date || todayISO());
  const note = v.str(b.note, { field: 'observação', max: 200, required: false });
  const idem = b.idempotency_key ? v.str(b.idempotency_key, { field: 'chave', max: 100 }) : null;
  let accountId = null;
  if (b.account_id) {
    const a = getAccountFor(ctx, b.account_id);
    if (a.scope !== vault.scope) throw bad('A conta precisa pertencer ao mesmo ambiente do cofre.', 'account_id');
    if (a.type === 'card') throw bad('Não é possível movimentar o cofre por um cartão de crédito.', 'account_id');
    accountId = a.id;
  }
  if (idem) {
    const ex = q.get('SELECT * FROM vault_movements WHERE user_id=? AND idempotency_key=?', ctx.userId, idem);
    if (ex) return { movement: ex, balance_cents: vaultBalance(vault.id), duplicate: true };
  }
  let id;
  try {
    id = tx(() => {
      if (type === 'withdraw' && vaultBalance(vault.id) < amount) throw bad('Saldo insuficiente no cofre.', 'amount_cents');
      return Number(q.run('INSERT INTO vault_movements(vault_id,user_id,account_id,type,amount_cents,date,note,idempotency_key) VALUES (?,?,?,?,?,?,?,?)',
        vault.id, ctx.userId, accountId, type, amount, date, note, idem).lastInsertRowid);
    });
  } catch (e) {
    if (idem && isUniqueError(e)) { const ex = q.get('SELECT * FROM vault_movements WHERE user_id=? AND idempotency_key=?', ctx.userId, idem); return { movement: ex, balance_cents: vaultBalance(vault.id), duplicate: true }; }
    throw e;
  }
  audit(ctx, 'vault.' + type, 'vault', vault.id, { amount_cents: amount, date, account_id: accountId }, vault.scope);
  const bal = vaultBalance(vault.id);
  if (type === 'deposit') {
    for (const uid of others(ctx, vault.scope)) notify(uid, { type: 'vault', title: `${req.user.name} guardou ${brl(amount)}`, body: `Cofre "${vault.name}"`, link: '#/cofre' });
    // Meta atingida
    for (const g of q.all('SELECT * FROM goals WHERE vault_id=?', vault.id)) {
      if (bal >= g.target_cents) {
        const ids = g.scope === 'couple' ? coupleMemberIds(g.couple_id) : [g.user_id];
        for (const uid of ids) notify(uid, { type: 'goal', title: `Meta alcançada: ${g.name} 🎉`, body: `Vocês chegaram a ${brl(g.target_cents)}.`, link: '#/metas', dedupe: `goal-done:${g.id}` });
      }
    }
  }
  emitChange(ctx, vault.scope, 'vaults');
  req.status = 201;
  return { movement: q.get('SELECT * FROM vault_movements WHERE id=?', id), balance_cents: bal };
});

del('/api/vaults/:id/movements/:mid', (req) => {
  const vault = getOwned('vaults', req.params.id, req.ctx, { write: true });
  const m = q.get('SELECT * FROM vault_movements WHERE id=? AND vault_id=?', Number(req.params.mid), vault.id);
  if (!m) throw notFound();
  tx(() => {
    q.run('DELETE FROM vault_movements WHERE id=?', m.id);
    if (vaultBalance(vault.id) < 0) throw new HttpError(409, 'Não é possível remover: o saldo do cofre ficaria negativo.');
  });
  audit(req.ctx, 'vault.movement_delete', 'vault', vault.id, { amount_cents: m.amount_cents, type: m.type }, vault.scope);
  emitChange(req.ctx, vault.scope, 'vaults');
  return { ok: true, balance_cents: vaultBalance(vault.id) };
});

// ================= metas =================
get('/api/goals', (req) => {
  const scope = parseScope(req.ctx, req.query.scope);
  const goals = goalsWithProgress(req.ctx, scope, todayISO());
  return { goals, achieved: goals.filter((g) => g.achieved).length, total: goals.length };
});

post('/api/goals', (req) => {
  const ctx = req.ctx, b = req.body;
  const target = writeTarget(ctx, v.oneOf(b.scope, ['personal', 'couple'], { field: 'escopo' }));
  const name = v.str(b.name, { field: 'nome', min: 2, max: 60 });
  const kind = v.oneOf(b.kind, ['viagem', 'compra', 'patrimonio', 'projeto', 'reserva', 'outro'], { def: 'outro', field: 'tipo' });
  const amount = v.cents(b.target_cents, { field: 'valor da meta' });
  const deadline = v.date(b.deadline, { field: 'prazo', required: false });
  const notes = v.str(b.notes, { field: 'observações', max: 300, required: false });
  const id = tx(() => {
    let vaultId;
    if (b.vault_id) { const vlt = getOwned('vaults', b.vault_id, ctx); if (vlt.scope !== target.scope) throw bad('Cofre inválido para este ambiente.', 'vault_id'); vaultId = vlt.id; }
    else vaultId = Number(q.run('INSERT INTO vaults(scope,user_id,couple_id,name,target_cents,deadline,color) VALUES (?,?,?,?,?,?,?)',
      target.scope, target.user_id, target.couple_id, name, amount, deadline, color(b.color)).lastInsertRowid);
    return Number(q.run('INSERT INTO goals(scope,user_id,couple_id,vault_id,name,kind,target_cents,deadline,notes) VALUES (?,?,?,?,?,?,?,?,?)',
      target.scope, target.user_id, target.couple_id, vaultId, name, kind, amount, deadline, notes).lastInsertRowid);
  });
  audit(ctx, 'goal.create', 'goal', id, { name, target_cents: amount }, target.scope);
  for (const uid of others(ctx, target.scope)) notify(uid, { type: 'goal', title: `Nova meta do casal: ${name}`, body: brl(amount), link: '#/metas' });
  emitChange(ctx, target.scope, 'goals');
  req.status = 201;
  return { goal: goalsWithProgress(ctx, target.scope, todayISO()).find((g) => g.id === id) };
});

patch('/api/goals/:id', (req) => {
  const row = getOwned('goals', req.params.id, req.ctx, { write: true });
  const b = req.body;
  const amount = b.target_cents !== undefined ? v.cents(b.target_cents) : row.target_cents;
  const deadline = b.deadline !== undefined ? v.date(b.deadline, { required: false }) : row.deadline;
  q.run('UPDATE goals SET name=?, kind=?, target_cents=?, deadline=?, notes=? WHERE id=?',
    b.name !== undefined ? v.str(b.name, { field: 'nome', min: 2, max: 60 }) : row.name,
    b.kind !== undefined ? v.oneOf(b.kind, ['viagem', 'compra', 'patrimonio', 'projeto', 'reserva', 'outro']) : row.kind,
    amount, deadline, b.notes !== undefined ? v.str(b.notes, { max: 300, required: false }) : row.notes, row.id);
  if (row.vault_id) q.run('UPDATE vaults SET target_cents=?, deadline=? WHERE id=? AND name=?', amount, deadline, row.vault_id, row.name);
  audit(req.ctx, 'goal.update', 'goal', row.id, { target_cents: amount }, row.scope);
  emitChange(req.ctx, row.scope, 'goals');
  return { goal: goalsWithProgress(req.ctx, row.scope, todayISO()).find((g) => g.id === row.id) };
});

del('/api/goals/:id', (req) => {
  const row = getOwned('goals', req.params.id, req.ctx, { write: true });
  q.run('DELETE FROM goals WHERE id=?', row.id); // o cofre e seu saldo permanecem
  audit(req.ctx, 'goal.delete', 'goal', row.id, { name: row.name }, row.scope);
  emitChange(req.ctx, row.scope, 'goals');
  return { ok: true };
});

// ================= investimentos =================
const ASSET_TYPES = ['renda_fixa', 'acoes', 'fiis', 'fundos', 'cripto', 'previdencia', 'outro'];

get('/api/investments', (req) => {
  const scope = parseScope(req.ctx, req.query.scope);
  const sum = investmentsSummary(req.ctx, scope);
  const byType = {};
  for (const i of sum.items.filter((x) => x.status === 'realized')) byType[i.asset_type] = (byType[i.asset_type] || 0) + i.value_cents;
  // Evolução patrimonial dos últimos 12 meses (valor da carteira ao fim de cada mês).
  const today = todayISO(), evolution = [];
  for (let i = 11; i >= 0; i--) {
    const d = addMonths(today.slice(0, 7) + '-01', -i);
    const asOf = i === 0 ? today : new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7), 0)).toISOString().slice(0, 10);
    let value = 0, invested = 0;
    for (const it of sum.items.filter((x) => x.status === 'realized')) { const s = investmentSnapshot(it.id, asOf); value += s.value; invested += s.invested; }
    evolution.push({ month: ym(asOf), value_cents: value, invested_cents: invested });
  }
  return { ...sum, by_type: byType, evolution };
});

get('/api/investments/:id', (req) => {
  const inv = getOwned('investments', req.params.id, req.ctx);
  const entries = q.all(`SELECT e.*, u.name AS user_name, a.name AS account_name FROM investment_entries e JOIN users u ON u.id=e.user_id LEFT JOIN accounts a ON a.id=e.account_id
    WHERE e.investment_id=? ORDER BY e.date DESC, e.id DESC`, inv.id);
  const snap = investmentSnapshot(inv.id);
  let projection = null;
  if (inv.status === 'planned' && inv.planned_cents && inv.expected_return_pct != null && inv.target_date) {
    const months = Math.max(0, (Number(inv.target_date.slice(0, 4)) - Number(todayISO().slice(0, 4))) * 12 + Number(inv.target_date.slice(5, 7)) - Number(todayISO().slice(5, 7)));
    projection = Math.round(inv.planned_cents * Math.pow(1 + inv.expected_return_pct / 100, months / 12));
  }
  return { investment: { ...inv, invested_cents: snap.invested, value_cents: snap.value, return_cents: snap.value - snap.invested, return_pct: snap.invested ? (snap.value - snap.invested) / snap.invested : 0, projection_cents: projection }, entries };
});

post('/api/investments', (req) => {
  const ctx = req.ctx, b = req.body;
  const target = writeTarget(ctx, v.oneOf(b.scope, ['personal', 'couple'], { field: 'escopo' }));
  const status = v.oneOf(b.status, ['realized', 'planned'], { def: 'realized', field: 'situação' });
  const planned = status === 'planned' ? v.cents(b.planned_cents, { field: 'valor planejado' }) : null;
  const ret = b.expected_return_pct === undefined || b.expected_return_pct === null || b.expected_return_pct === '' ? null : Number(b.expected_return_pct);
  if (ret !== null && (!Number.isFinite(ret) || ret < -100 || ret > 1000)) throw bad('Rentabilidade esperada inválida.', 'expected_return_pct');
  const id = Number(q.run(
    'INSERT INTO investments(scope,user_id,couple_id,name,asset_type,institution,status,planned_cents,expected_return_pct,target_date) VALUES (?,?,?,?,?,?,?,?,?,?)',
    target.scope, target.user_id, target.couple_id, v.str(b.name, { field: 'nome', min: 2, max: 60 }), v.oneOf(b.asset_type, ASSET_TYPES, { def: 'outro', field: 'tipo de ativo' }),
    v.str(b.institution, { field: 'instituição', max: 60, required: false }), status, planned, ret, v.date(b.target_date, { required: false, field: 'data prevista' }),
  ).lastInsertRowid);
  audit(ctx, 'investment.create', 'investment', id, { name: b.name, status }, target.scope);
  emitChange(ctx, target.scope, 'investments');
  req.status = 201;
  return { investment: q.get('SELECT * FROM investments WHERE id=?', id) };
});

patch('/api/investments/:id', (req) => {
  const row = getOwned('investments', req.params.id, req.ctx, { write: true });
  const b = req.body;
  const status = b.status !== undefined ? v.oneOf(b.status, ['realized', 'planned']) : row.status;
  if (status === 'planned' && row.status === 'realized' && q.get('SELECT 1 FROM investment_entries WHERE investment_id=?', row.id)) throw bad('Investimentos com aportes não podem voltar a ser apenas planejados.');
  const ret = b.expected_return_pct !== undefined ? (b.expected_return_pct === null || b.expected_return_pct === '' ? null : Number(b.expected_return_pct)) : row.expected_return_pct;
  if (ret !== null && (!Number.isFinite(ret) || ret < -100 || ret > 1000)) throw bad('Rentabilidade esperada inválida.', 'expected_return_pct');
  q.run('UPDATE investments SET name=?, asset_type=?, institution=?, status=?, planned_cents=?, expected_return_pct=?, target_date=? WHERE id=?',
    b.name !== undefined ? v.str(b.name, { field: 'nome', min: 2, max: 60 }) : row.name,
    b.asset_type !== undefined ? v.oneOf(b.asset_type, ASSET_TYPES) : row.asset_type,
    b.institution !== undefined ? v.str(b.institution, { max: 60, required: false }) : row.institution, status,
    b.planned_cents !== undefined ? v.cents(b.planned_cents, { required: false }) : row.planned_cents, ret,
    b.target_date !== undefined ? v.date(b.target_date, { required: false }) : row.target_date, row.id);
  audit(req.ctx, 'investment.update', 'investment', row.id, { status }, row.scope);
  emitChange(req.ctx, row.scope, 'investments');
  return { investment: q.get('SELECT * FROM investments WHERE id=?', row.id) };
});

del('/api/investments/:id', (req) => {
  const row = getOwned('investments', req.params.id, req.ctx, { write: true });
  const snap = investmentSnapshot(row.id);
  if (snap.value > 0 && req.query.force !== '1') throw new HttpError(409, 'Este investimento possui saldo. Registre o resgate ou confirme a exclusão do histórico.');
  q.run('DELETE FROM investments WHERE id=?', row.id);
  audit(req.ctx, 'investment.delete', 'investment', row.id, { name: row.name, value_cents: snap.value }, row.scope);
  emitChange(req.ctx, row.scope, 'investments');
  return { ok: true };
});

post('/api/investments/:id/entries', (req) => {
  const ctx = req.ctx, b = req.body;
  const inv = getOwned('investments', req.params.id, ctx, { write: true });
  if (inv.status === 'planned') throw bad('Este investimento ainda é apenas planejado. Marque-o como realizado para registrar aportes.');
  const type = v.oneOf(b.type, ['aporte', 'resgate', 'valuation'], { field: 'tipo' });
  const amount = v.cents(b.amount_cents, { allowZero: type === 'valuation' });
  const date = v.date(b.date || todayISO());
  const idem = b.idempotency_key ? v.str(b.idempotency_key, { field: 'chave', max: 100 }) : null;
  let accountId = null;
  if (b.account_id && type !== 'valuation') {
    const a = getAccountFor(ctx, b.account_id);
    if (a.scope !== inv.scope) throw bad('A conta precisa pertencer ao mesmo ambiente do investimento.', 'account_id');
    if (a.type === 'card') throw bad('Não é possível investir por um cartão de crédito.', 'account_id');
    accountId = a.id;
  }
  if (idem) { const ex = q.get('SELECT * FROM investment_entries WHERE user_id=? AND idempotency_key=?', ctx.userId, idem); if (ex) return { entry: ex, duplicate: true }; }
  let id;
  try {
    id = tx(() => {
      if (type === 'resgate' && investmentSnapshot(inv.id).value < amount) throw bad('Resgate maior que o valor atual do investimento.', 'amount_cents');
      return Number(q.run('INSERT INTO investment_entries(investment_id,user_id,account_id,type,amount_cents,date,note,idempotency_key) VALUES (?,?,?,?,?,?,?,?)',
        inv.id, ctx.userId, accountId, type, amount, date, v.str(b.note, { max: 200, required: false, field: 'observação' }), idem).lastInsertRowid);
    });
  } catch (e) {
    if (idem && isUniqueError(e)) return { entry: q.get('SELECT * FROM investment_entries WHERE user_id=? AND idempotency_key=?', ctx.userId, idem), duplicate: true };
    throw e;
  }
  audit(ctx, 'investment.' + type, 'investment', inv.id, { amount_cents: amount, date, account_id: accountId }, inv.scope);
  emitChange(ctx, inv.scope, 'investments');
  req.status = 201;
  return { entry: q.get('SELECT * FROM investment_entries WHERE id=?', id) };
});

del('/api/investments/:id/entries/:eid', (req) => {
  const inv = getOwned('investments', req.params.id, req.ctx, { write: true });
  const e = q.get('SELECT * FROM investment_entries WHERE id=? AND investment_id=?', Number(req.params.eid), inv.id);
  if (!e) throw notFound();
  q.run('DELETE FROM investment_entries WHERE id=?', e.id);
  audit(req.ctx, 'investment.entry_delete', 'investment', inv.id, { type: e.type, amount_cents: e.amount_cents }, inv.scope);
  emitChange(req.ctx, inv.scope, 'investments');
  return { ok: true };
});
