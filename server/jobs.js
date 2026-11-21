// Rotinas automáticas: lançamentos recorrentes e alertas de vencimento/metas.
import { q, tx } from './db.js';
import { addMonths, addDays, todayISO } from './lib.js';
import { notify, getCtx, coupleMemberIds } from './core.js';
import { pendingBills, goalsWithProgress, brl } from './calc.js';
import { syncAllBanks } from './bank.js';

const next = (d, f) => (f === 'weekly' ? addDays(d, 7) : f === 'yearly' ? addMonths(d, 12) : addMonths(d, 1));

export async function materializeRecurring(today = todayISO()) {
  let created = 0;
  const due = await q.all('SELECT * FROM recurring WHERE active=1 AND next_date<=?', today);
  for (const r of due) {
    try {
      await tx(async () => {
        let d = r.next_date, guard = 0;
        while (d <= today && guard++ < 60) {
          if (r.end_date && d > r.end_date) { await q.run('UPDATE recurring SET active=0 WHERE id=?', r.id); break; }
          const status = r.auto_paid ? 'paid' : 'pending';
          const res = await q.run(
            `INSERT OR IGNORE INTO transactions(scope,user_id,couple_id,account_id,type,amount_cents,date,due_date,status,category_id,description,recurring_id)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
            r.scope, r.user_id, r.couple_id, r.account_id, r.type, r.amount_cents, d, status === 'pending' ? d : null, status, r.category_id, r.description, r.id);
          if (res.changes) {
            created++;
            const ids = r.scope === 'couple' ? await coupleMemberIds(r.couple_id) : [r.user_id];
            for (const uid of ids) await notify(uid, {
              type: 'recurring', title: `${r.type === 'income' ? 'Receita' : 'Despesa'} recorrente lançada: ${r.description}`,
              body: `${brl(r.amount_cents)} em ${d.split('-').reverse().join('/')}${status === 'pending' ? ' — aguardando baixa' : ''}`, link: '#/movimentacoes', dedupe: `rec:${r.id}:${d}`,
            });
          }
          d = next(d, r.frequency);
        }
        await q.run('UPDATE recurring SET next_date=? WHERE id=?', d, r.id);
        if (r.end_date && d > r.end_date) await q.run('UPDATE recurring SET active=0 WHERE id=?', r.id);
      });
    } catch (e) { console.error('recorrência falhou', r.id, e.message); }
  }
  return created;
}

export async function runUserJobs(ctx, today = todayISO()) {
  await materializeRecurring(today);
  try {
    const bills = await pendingBills(ctx, ctx.coupleId ? 'all' : 'personal', today, 3);
    for (const b of bills.overdue.filter((x) => x.type === 'expense')) {
      await notify(ctx.userId, { type: 'due', title: `Conta vencida: ${b.description}`, body: `${brl(b.amount_cents)} venceu em ${b.date.split('-').reverse().join('/')}.`, link: '#/movimentacoes', dedupe: `late:${b.id}:${b.date}` });
    }
    for (const b of bills.upcoming.filter((x) => x.type === 'expense')) {
      await notify(ctx.userId, { type: 'due', title: `Vence ${b.date === today ? 'hoje' : 'em breve'}: ${b.description}`, body: `${brl(b.amount_cents)} — ${b.date.split('-').reverse().join('/')}.`, link: '#/movimentacoes', dedupe: `soon:${b.id}:${b.date}` });
    }
    for (const g of await goalsWithProgress(ctx, ctx.coupleId ? 'all' : 'personal', today)) {
      if (g.achieved || !g.deadline) continue;
      const days = Math.round((new Date(g.deadline + 'T00:00:00Z') - new Date(today + 'T00:00:00Z')) / 864e5);
      if (days >= 0 && days <= 30) await notify(ctx.userId, { type: 'goal', title: `Meta perto do prazo: ${g.name}`, body: `Faltam ${brl(g.remaining_cents)} e ${days} dia(s).`, link: '#/metas', dedupe: `goal-deadline:${g.id}:${g.deadline.slice(0, 7)}` });
    }
  } catch (e) { console.error('jobs de usuário falharam', e.message); }
}

export async function runGlobalJobs() {
  const today = todayISO();
  await materializeRecurring(today);
  for (const u of await q.all('SELECT * FROM users')) await runUserJobs(await getCtx(u, null), today);
  try { await syncAllBanks(); } catch (e) { console.error('sync bancário falhou', e.message); }
}
