// Insights determinísticos calculados somente a partir dos dados reais do usuário.
import { q } from './db.js';
import { scopeSql } from './core.js';
import { addMonths, monthStart, monthEnd, todayISO } from './lib.js';
import { brl, sums, byCategory, monthlySeries, budgetStatus, balanceSummary, vaultsSummary, goalsWithProgress, pendingBills } from './calc.js';

const pct = (x) => `${Math.round(Math.abs(x) * 100)}%`;

export async function computeInsights(ctx, scope, today = todayISO()) {
  const out = [];
  const add = (id, level, title, text) => out.push({ id, level, title, text });
  const from = monthStart(today), to = monthEnd(today);
  const prevFrom = monthStart(addMonths(today, -1)), prevTo = monthEnd(addMonths(today, -1));
  const cur = await sums(ctx, scope, from, to), prev = await sums(ctx, scope, prevFrom, prevTo);
  const hasData = (await q.get(`SELECT COUNT(*) AS n FROM transactions t WHERE ${scopeSql(ctx, scope, 't.').sql}`, ...scopeSql(ctx, scope, 't.').params)).n;
  if (!hasData) {
    add('empty', 'info', 'Comece registrando movimentações', 'Assim que houver receitas e despesas lançadas, eu analiso padrões, desperdícios e capacidade de poupança.');
    return out;
  }

  if (prev.expense > 0 && cur.expense > 0) {
    const d = (cur.expense - prev.expense) / prev.expense;
    if (Math.abs(d) >= 0.1) add('exp-vs-prev', d > 0 ? 'warn' : 'good', d > 0 ? `Gastos ${pct(d)} maiores que no mês passado` : `Gastos ${pct(d)} menores que no mês passado`,
      `${brl(cur.expense)} neste mês contra ${brl(prev.expense)} no mês anterior (parcial, até hoje).`);
  }
  const cats = await byCategory(ctx, scope, from, to);
  if (cats.length && cur.expense > 0) {
    const top = cats[0];
    add('top-cat', top.pct >= 0.4 ? 'warn' : 'info', `${top.name} lidera os gastos do mês`, `${brl(top.total)} (${pct(top.pct)} das despesas) em ${top.n} lançamento(s).`);
    const prevCats = new Map((await byCategory(ctx, scope, prevFrom, prevTo)).map((c) => [c.category_id, c.total]));
    let best = null;
    for (const c of cats) {
      const p = prevCats.get(c.category_id) || 0;
      const diff = c.total - p;
      if (p > 0 && diff > 5000 && c.total / p >= 1.3 && (!best || diff > best.diff)) best = { c, p, diff };
    }
    if (best) add('cat-up', 'warn', `${best.c.name} subiu ${pct(best.c.total / best.p - 1)}`, `De ${brl(best.p)} para ${brl(best.c.total)} em relação ao mês passado — vale revisar esses gastos.`);
  }
  if (cur.income > 0) {
    const rate = (cur.income - cur.expense) / cur.income;
    add('savings-rate', rate >= 0.2 ? 'good' : rate < 0 ? 'warn' : 'info',
      rate < 0 ? 'Despesas acima das receitas neste mês' : `Você está poupando ${pct(rate)} da renda do mês`,
      rate < 0 ? `Receitas de ${brl(cur.income)} e despesas de ${brl(cur.expense)}: déficit de ${brl(cur.expense - cur.income)}.` : `Sobraram ${brl(cur.income - cur.expense)} até agora. Uma referência comum é guardar pelo menos 20%.`);
  }
  for (const b of (await budgetStatus(ctx, scope, today)).filter((x) => x.pct >= 0.8).sort((a, b) => b.pct - a.pct).slice(0, 2)) {
    add('budget-' + b.id, 'warn', b.pct >= 1 ? `Orçamento estourado: ${b.category_name}` : `Orçamento de ${b.category_name} em ${pct(b.pct)}`, `Gasto ${brl(b.spent_cents)} de um limite de ${brl(b.limit_cents)}.`);
  }
  const bills = await pendingBills(ctx, scope, today, 7);
  if (bills.overdue.length) add('overdue', 'warn', `${bills.overdue.length} conta(s) vencida(s)`, `Total em atraso: ${brl(bills.overdue.filter((b) => b.type === 'expense').reduce((x, b) => x + b.amount_cents, 0))}.`);
  if (bills.upcoming.length) add('upcoming', 'info', `${bills.upcoming.length} vencimento(s) nos próximos 7 dias`, bills.upcoming.slice(0, 3).map((b) => `${b.description} (${brl(b.amount_cents)} em ${b.date.split('-').reverse().join('/')})`).join('; ') + '.');

  // Assinaturas e recorrências
  const rs = scopeSql(ctx, scope);
  const rec = await q.all(`SELECT * FROM recurring WHERE ${rs.sql} AND active=1 AND type='expense'`, ...rs.params);
  const monthly = rec.reduce((x, r) => x + (r.frequency === 'weekly' ? r.amount_cents * 4.33 : r.frequency === 'yearly' ? r.amount_cents / 12 : r.amount_cents), 0);
  if (rec.length >= 2) add('recurring', 'info', `${rec.length} despesas recorrentes somam ${brl(Math.round(monthly))}/mês`, 'Revise as que você realmente usa; cortar uma assinatura esquecida é a economia mais fácil.');

  // Capacidade de poupança e metas
  const series = (await monthlySeries(ctx, scope, prevTo, 3)).filter((m) => m.income > 0 || m.expense > 0);
  const avgNet = series.length ? Math.round(series.reduce((x, m) => x + m.net, 0) / series.length) : null;
  const avgExp = series.length ? Math.round(series.reduce((x, m) => x + m.expense, 0) / series.length) : null;
  for (const g of (await goalsWithProgress(ctx, scope, today)).filter((g) => !g.achieved && g.per_month_cents).slice(0, 3)) {
    if (avgNet === null) break;
    const ok = avgNet >= g.per_month_cents;
    add('goal-' + g.id, ok ? 'good' : 'warn', `Meta "${g.name}": guardar ${brl(g.per_month_cents)}/mês`,
      `Faltam ${brl(g.remaining_cents)} em ${g.months_left} mês(es). Sua sobra média recente é ${brl(avgNet)}/mês — ${ok ? 'dá para cumprir no ritmo atual.' : 'abaixo do necessário; considere ajustar o prazo, o valor ou os gastos.'}`);
  }
  const bal = await balanceSummary(ctx, scope), vlt = await vaultsSummary(ctx, scope);
  if (avgExp > 0) {
    const months = vlt.total_cents / avgExp;
    add('reserve', months >= 6 ? 'good' : months >= 3 ? 'info' : 'warn', `Reserva cobre ${months.toFixed(1).replace('.', ',')} mês(es) de despesas`,
      `Cofres somam ${brl(vlt.total_cents)} e a despesa média recente é ${brl(avgExp)}/mês. O recomendado costuma ficar entre 3 e 6 meses.`);
    const idle = bal.accounts.filter((a) => a.type === 'checking' || a.type === 'wallet').reduce((x, a) => x + a.balance_cents, 0);
    if (idle > avgExp * 3) add('idle', 'info', 'Dinheiro parado em conta', `${brl(idle)} em contas correntes/carteiras, mais de 3x a despesa mensal. Considere direcionar parte ao cofre ou a investimentos.`);
  }
  return out;
}
