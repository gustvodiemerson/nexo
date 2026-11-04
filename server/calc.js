// Cálculos compartilhados (saldos, totais, orçamentos, séries) — sempre a partir de dados reais.
import { q } from './db.js';
import { scopeSql, accountBalances, vaultBalance, investmentSnapshot } from './core.js';
import { addMonths, monthStart, monthEnd, ym } from './lib.js';

export const brl = (cents) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((cents || 0) / 100);

export async function visibleAccounts(ctx, scope, { archived = false } = {}) {
  const s = scopeSql(ctx, scope);
  return await q.all(`SELECT * FROM accounts WHERE ${s.sql} ${archived ? '' : 'AND archived=0'} ORDER BY id`, ...s.params);
}

// Saldo total (exclui cartões, que são dívida) + fatura aberta dos cartões.
export async function balanceSummary(ctx, scope, asOf) {
  const accs = await visibleAccounts(ctx, scope);
  const bal = await accountBalances(accs.map((a) => a.id), asOf);
  let total = 0, cardDebt = 0;
  const items = accs.map((a) => {
    const b = bal.get(a.id) || 0;
    if (a.type === 'card') cardDebt += -b; else total += b;
    return { ...a, balance_cents: b };
  });
  return { total_cents: total, card_debt_cents: cardDebt, accounts: items };
}

export async function sums(ctx, scope, from, to) {
  const s = scopeSql(ctx, scope);
  const rows = await q.all(
    `SELECT type, SUM(amount_cents) AS total, COUNT(*) AS n FROM transactions
     WHERE ${s.sql} AND status='paid' AND type IN ('income','expense') AND date BETWEEN ? AND ? GROUP BY type`,
    ...s.params, from, to,
  );
  const out = { income: 0, expense: 0, income_n: 0, expense_n: 0 };
  for (const r of rows) { out[r.type] = r.total; out[r.type + '_n'] = r.n; }
  return out;
}

// Gastos (ou receitas) por categoria raiz — subcategorias somam na categoria pai.
export async function byCategory(ctx, scope, from, to, kind = 'expense') {
  const s = scopeSql(ctx, scope, 't.');
  const rows = await q.all(
    `SELECT t.category_id AS cid, SUM(t.amount_cents) AS total, COUNT(*) AS n FROM transactions t
     WHERE ${s.sql} AND t.status='paid' AND t.type=? AND t.date BETWEEN ? AND ? GROUP BY t.category_id`,
    ...s.params, kind, from, to,
  );
  const cs = scopeSql(ctx, scope);
  const cats = new Map((await q.all(`SELECT * FROM categories WHERE ${cs.sql}`, ...cs.params)).map((c) => [c.id, c]));
  const acc = new Map();
  for (const r of rows) {
    let c = r.cid ? cats.get(r.cid) : null;
    let root = c;
    while (root && root.parent_id && cats.get(root.parent_id)) root = cats.get(root.parent_id);
    const key = root ? root.id : 0;
    const cur = acc.get(key) || {
      category_id: key || null, name: root ? root.name : 'Sem categoria', color: root ? root.color : '#8a93ad',
      icon: root ? root.icon : 'dots', total: 0, n: 0,
    };
    cur.total += r.total; cur.n += r.n; acc.set(key, cur);
  }
  const list = [...acc.values()].sort((a, b) => b.total - a.total);
  const sum = list.reduce((x, c) => x + c.total, 0);
  return list.map((c) => ({ ...c, pct: sum ? c.total / sum : 0 }));
}

// Série mensal de receitas/despesas dos últimos n meses (inclui o mês de `endISO`).
export async function monthlySeries(ctx, scope, endISO, n = 6) {
  const firstMonth = ym(addMonths(endISO, -(n - 1)));
  const from = firstMonth + '-01', to = monthEnd(endISO);
  const s = scopeSql(ctx, scope);
  const rows = await q.all(
    `SELECT substr(date,1,7) AS m, type, SUM(amount_cents) AS total FROM transactions
     WHERE ${s.sql} AND status='paid' AND type IN ('income','expense') AND date BETWEEN ? AND ? GROUP BY m, type`,
    ...s.params, from, to,
  );
  const map = new Map();
  for (let i = 0; i < n; i++) map.set(ym(addMonths(endISO, -(n - 1) + i)), { month: ym(addMonths(endISO, -(n - 1) + i)), income: 0, expense: 0 });
  for (const r of rows) { const e = map.get(r.m); if (e) e[r.type] = r.total; }
  return [...map.values()].map((e) => ({ ...e, net: e.income - e.expense }));
}

export async function vaultsSummary(ctx, scope, asOf) {
  const s = scopeSql(ctx, scope);
  const rows = await q.all(`SELECT * FROM vaults WHERE ${s.sql} AND archived=0 ORDER BY id`, ...s.params);
  const items = await Promise.all(rows.map(async (r) => ({ ...r, balance_cents: await vaultBalance(r.id, asOf) })));
  return { total_cents: items.reduce((x, i) => x + i.balance_cents, 0), items };
}

export async function investmentsSummary(ctx, scope, asOf) {
  const s = scopeSql(ctx, scope);
  const rows = await q.all(`SELECT * FROM investments WHERE ${s.sql} ORDER BY id`, ...s.params);
  let invested = 0, value = 0, planned = 0;
  const items = await Promise.all(rows.map(async (r) => {
    if (r.status === 'planned') { planned += r.planned_cents || 0; return { ...r, invested_cents: 0, value_cents: 0, return_cents: 0, return_pct: 0 }; }
    const snap = await investmentSnapshot(r.id, asOf);
    invested += snap.invested; value += snap.value;
    const ret = snap.value - snap.invested;
    return { ...r, invested_cents: snap.invested, value_cents: snap.value, return_cents: ret, return_pct: snap.invested ? ret / snap.invested : 0 };
  }));
  return {
    invested_cents: invested, value_cents: value, return_cents: value - invested,
    return_pct: invested ? (value - invested) / invested : 0, planned_cents: planned, items,
  };
}

export async function budgetStatus(ctx, scope, monthISO) {
  const s = scopeSql(ctx, scope);
  const from = monthStart(monthISO), to = monthEnd(monthISO);
  const budgets = await q.all(`SELECT * FROM budgets WHERE ${s.sql} ORDER BY id`, ...s.params);
  return Promise.all(budgets.map(async (b) => {
    const where = b.scope === 'couple' ? "t.scope='couple' AND t.couple_id=?" : "t.scope='personal' AND t.user_id=?";
    const p = b.scope === 'couple' ? b.couple_id : b.user_id;
    let spent;
    if (b.category_id) {
      spent = (await q.get(
        `SELECT IFNULL(SUM(t.amount_cents),0) AS s FROM transactions t WHERE ${where} AND t.type='expense' AND t.status='paid'
         AND t.date BETWEEN ? AND ? AND t.category_id IN (SELECT id FROM categories WHERE id=? OR parent_id=?)`,
        p, from, to, b.category_id, b.category_id,
      )).s;
    } else {
      spent = (await q.get(
        `SELECT IFNULL(SUM(t.amount_cents),0) AS s FROM transactions t WHERE ${where} AND t.type='expense' AND t.status='paid' AND t.date BETWEEN ? AND ?`,
        p, from, to,
      )).s;
    }
    const cat = b.category_id ? await q.get('SELECT name,color,icon FROM categories WHERE id=?', b.category_id) : null;
    return {
      id: b.id, scope: b.scope, category_id: b.category_id, category_name: cat ? cat.name : 'Orçamento geral do mês',
      category_color: cat ? cat.color : '#7aa2ff', category_icon: cat ? cat.icon : 'wallet',
      limit_cents: b.limit_cents, spent_cents: spent, remaining_cents: b.limit_cents - spent,
      pct: b.limit_cents ? spent / b.limit_cents : 0,
    };
  }));
}

// Metas: progresso vem do cofre vinculado.
export async function goalsWithProgress(ctx, scope, todayISO) {
  const s = scopeSql(ctx, scope);
  const rows = await q.all(`SELECT * FROM goals WHERE ${s.sql} ORDER BY id`, ...s.params);
  return Promise.all(rows.map(async (g) => {
    const current = g.vault_id ? await vaultBalance(g.vault_id) : 0;
    const remaining = Math.max(0, g.target_cents - current);
    let monthsLeft = null, perMonth = null, overdue = false;
    if (g.deadline) {
      const [y1, m1] = todayISO.split('-').map(Number), [y2, m2] = g.deadline.split('-').map(Number);
      monthsLeft = (y2 - y1) * 12 + (m2 - m1);
      overdue = g.deadline < todayISO && remaining > 0;
      if (remaining > 0 && !overdue) perMonth = Math.ceil(remaining / Math.max(1, monthsLeft));
    }
    return {
      ...g, current_cents: current, remaining_cents: remaining, pct: Math.min(1, current / g.target_cents),
      achieved: current >= g.target_cents, months_left: monthsLeft, per_month_cents: perMonth, overdue,
    };
  }));
}

export async function pendingBills(ctx, scope, todayISO, horizonDays = 30) {
  const s = scopeSql(ctx, scope, 't.');
  const rows = await q.all(
    `SELECT t.id, t.scope, t.type, t.description, t.amount_cents, t.date, t.account_id, a.name AS account_name, c.name AS category_name,
            t.installment_no, t.installment_total
     FROM transactions t LEFT JOIN accounts a ON a.id=t.account_id LEFT JOIN categories c ON c.id=t.category_id
     WHERE ${s.sql} AND t.status='pending' AND t.type IN ('income','expense') ORDER BY t.date, t.id`,
    ...s.params,
  );
  const limit = new Date(todayISO + 'T00:00:00Z'); limit.setUTCDate(limit.getUTCDate() + horizonDays);
  const lim = limit.toISOString().slice(0, 10);
  return {
    overdue: rows.filter((r) => r.date < todayISO),
    upcoming: rows.filter((r) => r.date >= todayISO && r.date <= lim),
    later: rows.filter((r) => r.date > lim),
  };
}

export async function recentTransactions(ctx, scope, limit = 6) {
  const s = scopeSql(ctx, scope, 't.');
  return await q.all(
    `SELECT t.id, t.scope, t.type, t.description, t.amount_cents, t.date, t.status, t.user_id, u.name AS user_name,
            c.name AS category_name, c.color AS category_color, c.icon AS category_icon, a.name AS account_name, a.type AS account_type
     FROM transactions t LEFT JOIN categories c ON c.id=t.category_id LEFT JOIN accounts a ON a.id=t.account_id LEFT JOIN users u ON u.id=t.user_id
     WHERE ${s.sql} AND t.status='paid' ORDER BY t.date DESC, t.id DESC LIMIT ?`,
    ...s.params, limit,
  );
}

// Patrimônio ao final de um mês: contas (sem cartões) + cofres + investimentos (valor).
export async function netWorthAt(ctx, scope, asOf) {
  const b = await balanceSummary(ctx, scope, asOf);
  const v = await vaultsSummary(ctx, scope, asOf);
  const i = await investmentsSummary(ctx, scope, asOf);
  return { accounts: b.total_cents, card_debt: b.card_debt_cents, vaults: v.total_cents, investments: i.value_cents, total: b.total_cents + v.total_cents + i.value_cents - b.card_debt_cents };
}

export async function checkBudgetAlerts(ctx, scope, dateISO, notify) {
  // Alerta quando um orçamento cruza 80% / 100% (uma vez por mês e nível).
  const month = ym(dateISO);
  const sc = scope === 'couple' ? 'couple' : 'personal';
  for (const b of await budgetStatus(ctx, sc, dateISO)) {
    const level = b.pct >= 1 ? 100 : b.pct >= 0.8 ? 80 : 0;
    if (!level) continue;
    const users = sc === 'couple' ? (await q.all('SELECT user_id FROM couple_members WHERE couple_id=?', ctx.coupleId)).map((r) => r.user_id) : [ctx.userId];
    for (const uid of users) {
      await notify(uid, {
        type: 'budget', link: '#/planejamento', dedupe: `budget:${b.id}:${month}:${level}`,
        title: level === 100 ? `Orçamento estourado: ${b.category_name}` : `Orçamento em ${Math.round(b.pct * 100)}%: ${b.category_name}`,
        body: `Gasto ${brl(b.spent_cents)} de ${brl(b.limit_cents)}${sc === 'couple' ? ' (casal)' : ''}.`,
      });
    }
  }
}
