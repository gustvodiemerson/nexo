// Dashboard, relatórios e exportação.
import { q } from './db.js';
import { get } from './router.js';
import { Raw } from './router.js';
import { v, bad, todayISO, addMonths, monthStart, monthEnd, ym } from './lib.js';
import { parseScope, scopeSql } from './core.js';
import {
  balanceSummary, sums, byCategory, monthlySeries, vaultsSummary, investmentsSummary, goalsWithProgress, pendingBills,
  recentTransactions, budgetStatus, netWorthAt,
} from './calc.js';
import { computeInsights } from './insights.js';
import { runUserJobs } from './jobs.js';

const monthParam = (m) => { const x = m || todayISO().slice(0, 7); if (!/^\d{4}-\d{2}$/.test(x)) throw bad('Mês inválido.', 'month'); return x; };
const lastDayOf = (m) => monthEnd(m + '-01');
const asOfFor = (m, today) => { const e = lastDayOf(m); return e > today ? today : e; };

get('/api/dashboard', (req) => {
  const ctx = req.ctx;
  const scope = parseScope(ctx, req.query.scope);
  const today = todayISO();
  runUserJobs(ctx, today);
  const from = monthStart(today), to = monthEnd(today);
  const prevMonthEnd = monthEnd(addMonths(today, -1));
  const bal = balanceSummary(ctx, scope);
  const prevBal = balanceSummary(ctx, scope, prevMonthEnd);
  const cur = sums(ctx, scope, from, to), prev = sums(ctx, scope, monthStart(addMonths(today, -1)), prevMonthEnd);
  const inv = investmentsSummary(ctx, scope);
  const prevInv = investmentsSummary(ctx, scope, prevMonthEnd);
  const vlt = vaultsSummary(ctx, scope);
  const goals = goalsWithProgress(ctx, scope, today);
  const budgets = budgetStatus(ctx, scope, today);
  const overall = budgets.find((b) => !b.category_id) || null;
  const bills = pendingBills(ctx, scope, today, 30);
  const trend = [];
  for (let i = 5; i >= 0; i--) {
    const e = i === 0 ? today : monthEnd(addMonths(today, -i));
    trend.push({ month: ym(e), total_cents: i === 0 ? bal.total_cents : balanceSummary(ctx, scope, e).total_cents });
  }
  const vaultMonthDeposits = q.get(
    `SELECT IFNULL(SUM(CASE WHEN m.type='deposit' THEN m.amount_cents ELSE -m.amount_cents END),0) AS s FROM vault_movements m JOIN vaults vv ON vv.id=m.vault_id
     WHERE ${scopeSql(ctx, scope, 'vv.').sql} AND m.date BETWEEN ? AND ?`, ...scopeSql(ctx, scope, 'vv.').params, from, to).s;
  const prevTotal = prevBal.total_cents;
  return {
    scope, today, month: ym(today),
    balance: {
      total_cents: bal.total_cents, card_debt_cents: bal.card_debt_cents, prev_total_cents: prevTotal,
      change_pct: prevTotal !== 0 ? (bal.total_cents - prevTotal) / Math.abs(prevTotal) : null, accounts_count: bal.accounts.length, trend,
    },
    month_summary: { income_cents: cur.income, expense_cents: cur.expense, net_cents: cur.income - cur.expense, saved_cents: vaultMonthDeposits, prev_income_cents: prev.income, prev_expense_cents: prev.expense },
    series: monthlySeries(ctx, scope, today, 6),
    investments: { invested_cents: inv.invested_cents, value_cents: inv.value_cents, return_cents: inv.return_cents, return_pct: inv.return_pct, planned_cents: inv.planned_cents,
      change_pct: prevInv.value_cents ? (inv.value_cents - prevInv.value_cents) / prevInv.value_cents : null, count: inv.items.length },
    vaults: { total_cents: vlt.total_cents, items: vlt.items.slice(0, 4).map((i) => ({ id: i.id, name: i.name, scope: i.scope, balance_cents: i.balance_cents, target_cents: i.target_cents, color: i.color })) },
    goals: { achieved: goals.filter((g) => g.achieved).length, total: goals.length, items: goals.filter((g) => !g.achieved).slice(0, 3) },
    budget: overall || (budgets.length ? { limit_cents: budgets.reduce((x, b) => x + b.limit_cents, 0), spent_cents: budgets.reduce((x, b) => x + b.spent_cents, 0), pct: budgets.reduce((x, b) => x + b.spent_cents, 0) / budgets.reduce((x, b) => x + b.limit_cents, 0), derived: true } : null),
    recent: recentTransactions(ctx, scope, 6),
    bills: { overdue_count: bills.overdue.length, overdue_cents: bills.overdue.filter((b) => b.type === 'expense').reduce((x, b) => x + b.amount_cents, 0), next: [...bills.overdue, ...bills.upcoming].slice(0, 4) },
    insights: computeInsights(ctx, scope, today).slice(0, 3),
    counters: counters(ctx),
  };
});

export function counters(ctx) {
  const notifications = q.get('SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND read_at IS NULL', ctx.userId).n;
  let chat = 0;
  if (ctx.coupleId) {
    const r = q.get('SELECT last_read_id FROM chat_reads WHERE couple_id=? AND user_id=?', ctx.coupleId, ctx.userId);
    chat = q.get('SELECT COUNT(*) AS n FROM chat_messages WHERE couple_id=? AND user_id<>? AND id>?', ctx.coupleId, ctx.userId, r ? r.last_read_id : 0).n;
  }
  return { notifications, chat };
}
get('/api/counters', (req) => counters(req.ctx));

// ---------- relatórios ----------
get('/api/reports/cashflow', (req) => {
  const ctx = req.ctx, scope = parseScope(ctx, req.query.scope);
  const n = Math.min(Math.max(Number(req.query.months) || 6, 2), 24), today = todayISO();
  const series = monthlySeries(ctx, scope, today, n);
  let running = 0;
  const first = balanceSummary(ctx, scope, monthEnd(addMonths(today, -n))).total_cents;
  running = first;
  return { scope, months: n, series: series.map((m) => { running += m.net; return { ...m, cumulative_cents: running }; }),
    totals: { income_cents: series.reduce((x, m) => x + m.income, 0), expense_cents: series.reduce((x, m) => x + m.expense, 0) } };
});

get('/api/reports/categories', (req) => {
  const ctx = req.ctx, scope = parseScope(ctx, req.query.scope);
  const month = monthParam(req.query.month);
  const from = req.query.from ? v.date(req.query.from) : month + '-01', to = req.query.to ? v.date(req.query.to) : lastDayOf(month);
  const kind = v.oneOf(req.query.kind, ['expense', 'income'], { def: 'expense' });
  const cats = byCategory(ctx, scope, from, to, kind);
  return { from, to, kind, total_cents: cats.reduce((x, c) => x + c.total, 0), categories: cats };
});

get('/api/reports/compare', (req) => {
  const ctx = req.ctx, scope = parseScope(ctx, req.query.scope);
  const month = monthParam(req.query.month);
  const prevM = ym(addMonths(month + '-01', -1));
  const a = { from: month + '-01', to: lastDayOf(month) }, b = { from: prevM + '-01', to: lastDayOf(prevM) };
  const cur = sums(ctx, scope, a.from, a.to), prev = sums(ctx, scope, b.from, b.to);
  const cc = byCategory(ctx, scope, a.from, a.to), pc = byCategory(ctx, scope, b.from, b.to);
  const ids = new Map();
  for (const c of cc) ids.set(c.category_id, { category_id: c.category_id, name: c.name, color: c.color, current_cents: c.total, previous_cents: 0 });
  for (const c of pc) { const e = ids.get(c.category_id) || { category_id: c.category_id, name: c.name, color: c.color, current_cents: 0, previous_cents: 0 }; e.previous_cents = c.total; ids.set(c.category_id, e); }
  return {
    month, previous_month: prevM,
    current: { income_cents: cur.income, expense_cents: cur.expense }, previous: { income_cents: prev.income, expense_cents: prev.expense },
    categories: [...ids.values()].map((e) => ({ ...e, diff_cents: e.current_cents - e.previous_cents, diff_pct: e.previous_cents ? (e.current_cents - e.previous_cents) / e.previous_cents : null })).sort((x, y) => y.current_cents - x.current_cents),
  };
});

get('/api/reports/networth', (req) => {
  const ctx = req.ctx, scope = parseScope(ctx, req.query.scope);
  const n = Math.min(Math.max(Number(req.query.months) || 12, 2), 36), today = todayISO();
  const points = [];
  for (let i = n - 1; i >= 0; i--) {
    const e = i === 0 ? today : monthEnd(addMonths(today, -i));
    points.push({ month: ym(e), ...netWorthAt(ctx, scope, e) });
  }
  return { scope, points, current: points[points.length - 1] };
});

// Participação de cada pessoa (somente ambiente do casal).
get('/api/reports/members', (req) => {
  const ctx = req.ctx;
  if (!ctx.coupleId) throw bad('Você ainda não faz parte de um casal.');
  const month = monthParam(req.query.month);
  const rows = q.all(
    `SELECT t.user_id, u.name, t.type, SUM(t.amount_cents) AS total FROM transactions t JOIN users u ON u.id=t.user_id
     WHERE t.scope='couple' AND t.couple_id=? AND t.status='paid' AND t.type IN ('income','expense') AND t.date BETWEEN ? AND ? GROUP BY t.user_id, t.type`,
    ctx.coupleId, month + '-01', lastDayOf(month));
  const map = new Map();
  for (const r of rows) { const e = map.get(r.user_id) || { user_id: r.user_id, name: r.name, income_cents: 0, expense_cents: 0 }; e[r.type + '_cents'] = r.total; map.set(r.user_id, e); }
  return { month, members: [...map.values()] };
});

get('/api/reports/insights', (req) => {
  const scope = parseScope(req.ctx, req.query.scope);
  return { scope, insights: computeInsights(req.ctx, scope) };
});

// Exportação CSV (separador ';' e BOM, compatível com Excel em pt-BR).
get('/api/reports/export.csv', (req) => {
  const ctx = req.ctx, scope = parseScope(ctx, req.query.scope);
  const from = v.date(req.query.from || monthStart(todayISO()), { field: 'data inicial' }), to = v.date(req.query.to || monthEnd(todayISO()), { field: 'data final' });
  const s = scopeSql(ctx, scope, 't.');
  const rows = q.all(
    `SELECT t.date, t.type, t.status, t.description, t.amount_cents, t.scope, c.name AS category, a.name AS account, ta.name AS to_account, u.name AS who, t.notes
     FROM transactions t LEFT JOIN categories c ON c.id=t.category_id LEFT JOIN accounts a ON a.id=t.account_id LEFT JOIN accounts ta ON ta.id=t.to_account_id LEFT JOIN users u ON u.id=t.user_id
     WHERE ${s.sql} AND t.date BETWEEN ? AND ? ORDER BY t.date, t.id`, ...s.params, from, to);
  const esc = (x) => {
    let s2 = x == null ? '' : String(x);
    if (/^[=+\-@\t\r]/.test(s2)) s2 = "'" + s2; // evita injeção de fórmulas em planilhas
    return /[";\n\r]/.test(s2) ? '"' + s2.replace(/"/g, '""') + '"' : s2;
  };
  const TYPE = { income: 'Receita', expense: 'Despesa', transfer: 'Transferência' }, ST = { paid: 'Pago', pending: 'Pendente' };
  const lines = [['Data', 'Tipo', 'Situação', 'Descrição', 'Valor (R$)', 'Ambiente', 'Categoria', 'Conta', 'Conta destino', 'Responsável', 'Observações'].join(';')];
  for (const r of rows) {
    lines.push([r.date.split('-').reverse().join('/'), TYPE[r.type], ST[r.status], r.description, (r.amount_cents / 100).toFixed(2).replace('.', ','),
      r.scope === 'couple' ? 'Casal' : 'Pessoal', r.category, r.account, r.to_account, r.who, r.notes].map(esc).join(';'));
  }
  return new Raw('﻿' + lines.join('\r\n'), 'text/csv; charset=utf-8', { 'Content-Disposition': `attachment; filename="nexo-${from}_a_${to}.csv"` });
});
