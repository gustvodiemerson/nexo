// Dashboard inicial (tela principal do NEXO).
import {
  h, icon, S, GET, qs, bus, scopeParam, scopeSwitch, brandEl, topActions, greeting, coupleTitle, money, brl, spct, pct, monthLabel, iconBadge, progressBar,
  sectionTitle, toggleHide, firstName, emptyState, fmtDate, relDate, hasCouple, avatar,
} from '../ui.js';
import { sparkline, ring } from '../charts.js';
import { txRow, txForm, accountForm } from './money.js';

const quick = (ic, label, color, props) => h(props.href ? 'a' : 'button', { type: props.href ? undefined : 'button', class: '', style: { '--c': color }, ...props }, icon(ic, 30), h('span', null, label));

export async function homeView() {
  const scope = scopeParam();
  const [d, inv] = await Promise.all([GET('/dashboard' + qs({ scope })), GET('/investments' + qs({ scope })).catch(() => null)]);
  S.counters = d.counters; bus.emit('counters');
  const couple = !!S.couple;
  const root = h('div', { class: 'home' });

  // --- hero ---
  const hero = h('div', { class: 'hero hero-cover' }, h('div', { class: 'hero-inner' },
    h('div', { class: 'row between' }, brandEl(), topActions()),
    h('div', { class: 'hero-greet' },
      h('h1', null, `${greeting()}, `, couple ? coupleTitle() : firstName(S.me.name), ' ', h('span', { style: { color: 'var(--pink)' } }, icon('heart', 22))),
      h('p', null, couple ? 'Hoje é mais um passo para os nossos sonhos!' : 'Que tal organizarmos suas finanças hoje?'))));
  if (S.couple && S.couple.cover) hero.style.backgroundImage = `url("${S.couple.cover}")`;

  // --- saldo total ---
  const ch = spct(d.balance.change_pct);
  const trend = d.balance.trend.map((t) => t.total_cents);
  const balance = h('div', { class: 'card glow balance-card' },
    h('div', { class: 'row between' },
      h('div', { class: 'row' }, h('span', { class: 'card-title' }, icon('wallet', 20), 'Saldo total'),
        h('button', { class: 'icon-btn sm eye', type: 'button', 'aria-label': S.hide ? 'Mostrar valores' : 'Ocultar valores', onclick: toggleHide }, icon(S.hide ? 'eye-off' : 'eye', 18))),
      h('a', { class: 'btn sm', href: '#/contas' }, 'Ver detalhes', icon('arrow-right', 14))),
    scopeSwitch(),
    h('div', { class: 'row between', style: { alignItems: 'flex-end', gap: '6px' } },
      h('div', { class: 'stack-sm', style: { minWidth: 0 } },
        h('div', { class: 'big-num' }, money(d.balance.total_cents)),
        ch ? h('div', { class: `small ${d.balance.change_pct >= 0 ? 'pos' : 'neg'}`, style: { fontWeight: 600 } }, icon(d.balance.change_pct >= 0 ? 'arrow-up' : 'arrow-down', 13), ` ${ch} `, h('span', { class: 'muted', style: { fontWeight: 400 } }, 'em relação ao mês passado'))
          : h('div', { class: 'small muted' }, d.balance.accounts_count ? 'Sem saldo no fim do mês passado para comparar' : 'Cadastre suas contas para começar'),
        d.balance.card_debt_cents ? h('div', { class: 'small muted' }, `Faturas em aberto: ${money(d.balance.card_debt_cents)}`) : null),
      h('div', { style: { width: '44%', flexShrink: 0 } }, sparkline(trend, { label: 'Evolução do saldo nos últimos 6 meses' }))),
    h('div', { class: 'row between small dim' }, h('span', null, 'últimos 6 meses'), d.balance.accounts_count ? h('a', { href: '#/contas' }, `${d.balance.accounts_count} conta(s)`) : null));
  const wrapBalance = h('div', { class: 'balance-card' }, balance); balance.style.margin = '0';
  wrapBalance.style.cssText = 'margin:0 16px;position:relative;z-index:3';

  // --- corpo ---
  const body = h('div', { class: 'view', style: { paddingTop: '16px' } });

  // onboarding (somente quando faltam passos reais)
  const steps = [
    { done: d.balance.accounts_count > 0, ic: 'bank', t: 'Cadastre sua primeira conta', s: 'Conta corrente, carteira, poupança ou cartão', act: () => accountForm() },
    { done: d.recent.length > 0, ic: 'receipt', t: 'Registre uma movimentação', s: 'Receitas e despesas atualizam seu saldo na hora', act: () => txForm({}) },
    ...(couple ? [] : [{ done: false, ic: 'heart', t: 'Convide seu parceiro(a)', s: 'Organizem as finanças juntos, com privacidade', href: '#/casal', optional: true }]),
  ];
  if (steps.some((s) => !s.done && !s.optional)) {
    body.append(h('div', { class: 'card checklist' }, h('div', { class: 'card-title' }, icon('star', 18), 'Primeiros passos'),
      h('div', { class: 'list' }, steps.map((s) => h(s.href ? 'a' : 'button', { class: 'list-item', href: s.href, type: s.href ? undefined : 'button', onclick: s.act, 'aria-label': s.t },
        iconBadge(s.done ? 'check' : s.ic, s.done ? '#2ee59d' : '#ff3d9a'), h('div', { class: 'li-main' }, h('div', { class: `li-title ${s.done ? 'done-line' : ''}` }, s.t), h('div', { class: 'li-sub' }, s.s)), icon('chevron', 18))))));
  }

  // atalhos
  body.append(h('div', { class: 'quick' },
    quick('wallet', 'Registrar Despesa', '#2ee59d', { onclick: () => txForm({ type: 'expense' }) }),
    quick('income', 'Registrar Receita', '#3b82ff', { onclick: () => txForm({ type: 'income' }) }),
    quick('vault', 'Meu Cofre', '#ffc857', { href: '#/cofre' }),
    quick('invest', 'Investimentos', '#8b5cf6', { href: '#/investimentos' }),
    couple ? quick('chat', 'Chat do Casal', '#ff3d9a', { href: '#/chat' }) : quick('target', 'Metas', '#ff3d9a', { href: '#/metas' })));

  // orçamento + investimentos
  const b = d.budget;
  const bp = b ? Math.min(1, b.pct || 0) : 0;
  const budgetCard = h('div', { class: 'card clickable', onclick: () => { location.hash = '#/planejamento'; } },
    h('div', { class: 'row between' }, h('span', { class: 'card-title' }, icon(couple ? 'users' : 'target', 18), couple ? 'Nossa Vida a Dois' : 'Meu orçamento'), icon('chevron', 18)),
    b ? h('div', { class: 'row', style: { gap: '10px', marginTop: '8px' } }, ring(bp, { size: 96, stroke: 11, center: pct(b.pct), sub: 'do limite' }),
      h('div', { class: 'stack-sm', style: { minWidth: 0 } }, h('div', { class: 'small muted' }, 'Meta do mês'), h('div', { class: 'num', style: { fontWeight: 700 } }, money(b.limit_cents)), h('div', { class: 'small muted' }, 'Gasto até agora'), h('div', { class: `num ${b.pct >= 1 ? 'neg' : ''}`, style: { fontWeight: 700 } }, money(b.spent_cents))))
      : h('div', { class: 'stack-sm', style: { marginTop: '10px' } }, h('p', { class: 'small muted' }, 'Defina um limite mensal de gastos e acompanhe o progresso aqui.'), h('span', { class: 'btn sm primary', style: { alignSelf: 'flex-start' } }, 'Definir orçamento')));
  const evo = inv && inv.evolution ? inv.evolution.map((e) => e.value_cents) : [];
  const invCh = spct(d.investments.change_pct);
  const invCard = h('div', { class: 'card clickable', onclick: () => { location.hash = '#/investimentos'; } },
    h('div', { class: 'row between' }, h('span', { class: 'card-title' }, icon('invest', 18), 'Investimentos'), icon('chevron', 18)),
    h('div', { class: 'stack-sm', style: { marginTop: '8px' } }, h('div', { class: 'stat-big num', style: { fontSize: '22px' } }, money(d.investments.value_cents)),
      d.investments.count ? h('div', { class: `small ${d.investments.return_pct >= 0 ? 'pos' : 'neg'}`, style: { fontWeight: 600 } }, `${spct(d.investments.return_pct) || '0,0%'} `, h('span', { class: 'muted', style: { fontWeight: 400 } }, 'rentab. total')) : h('div', { class: 'small muted' }, 'Nenhum investimento ainda'),
      evo.some((v) => v) ? sparkline(evo, { from: '#2ee59d', to: '#38d5ff', label: 'Evolução da carteira' }) : (d.investments.planned_cents ? h('div', { class: 'small gold' }, `Planejado: ${money(d.investments.planned_cents)}`) : null)));
  body.append(h('div', { class: 'grid-2' }, budgetCard, invCard));

  // resumo do mês
  const ms = d.month_summary;
  body.append(h('div', { class: 'card' },
    h('div', { class: 'row between' }, h('span', { class: 'card-title' }, icon('star', 18), 'Resumo do Mês'), h('span', { class: 'small muted row' }, icon('calendar', 15), monthLabel(d.month))),
    h('div', { class: 'grid-4', style: { marginTop: '10px' } },
      h('a', { class: 'tile', href: '#/movimentos', style: { color: 'inherit' } }, h('span', { class: 'neg' }, icon('cart', 26)), h('span', { class: 't-l' }, 'Despesas'), h('span', { class: 't-v' }, money(ms.expense_cents))),
      h('a', { class: 'tile', href: '#/movimentos', style: { color: 'inherit' } }, h('span', { class: 'pos' }, icon('arrow-up', 26)), h('span', { class: 't-l' }, 'Receitas'), h('span', { class: 't-v' }, money(ms.income_cents))),
      h('a', { class: 'tile', href: '#/cofre', style: { color: 'inherit' } }, h('span', { class: 'gold' }, icon('piggy', 26)), h('span', { class: 't-l' }, 'Economia'), h('span', { class: 't-v' }, money(ms.saved_cents))),
      h('a', { class: 'tile', href: '#/metas', style: { color: 'inherit' } }, h('span', { style: { color: 'var(--violet)' } }, icon('target', 26)), h('span', { class: 't-l' }, 'Metas'), h('span', { class: 't-v' }, `${d.goals.achieved} de ${d.goals.total}`)))));

  // contas a pagar
  if (d.bills.next.length) {
    body.append(sectionTitle('Contas a pagar', h('a', { href: '#/planejamento' }, 'Ver tudo', icon('chevron', 14))),
      d.bills.overdue_count ? h('div', { class: 'alert bad' }, icon('alert', 18), `${d.bills.overdue_count} conta(s) vencida(s)${d.bills.overdue_cents ? ` — ${money(d.bills.overdue_cents)}` : ''}`) : null,
      h('div', { class: 'card pad-sm' }, h('div', { class: 'list' }, d.bills.next.map((x) => h('a', { class: 'list-item', href: '#/planejamento' }, iconBadge(x.type === 'income' ? 'income' : 'receipt', x.date < d.today ? '#ff5c7a' : '#ffb454'),
        h('div', { class: 'li-main' }, h('div', { class: 'li-title' }, x.description), h('div', { class: 'li-sub' }, x.date < d.today ? h('span', { class: 'neg' }, `Venceu em ${fmtDate(x.date)}`) : `Vence ${relDate(x.date).toLowerCase()}`)),
        h('div', { class: 'li-end' }, money(x.amount_cents)))))));
  }

  // metas
  if (d.goals.items.length) body.append(sectionTitle(couple ? 'Metas do casal' : 'Minhas metas', h('a', { href: '#/metas' }, 'Ver todas', icon('chevron', 14))),
    h('div', { class: 'stack' }, d.goals.items.map((g) => h('a', { class: 'card clickable', href: '#/metas', style: { color: 'inherit' } },
      h('div', { class: 'row between' }, h('span', { style: { fontWeight: 600 } }, g.name), h('span', { class: 'num', style: { fontWeight: 700 } }, pct(g.pct))),
      progressBar(g.pct, null, 'grad'), h('div', { class: 'row between small muted' }, h('span', { class: 'num' }, `${money(g.current_cents)} / ${money(g.target_cents)}`), g.per_month_cents ? h('span', null, `${money(g.per_month_cents)}/mês`) : null)))));

  // cofre
  if (d.vaults.items.length) body.append(h('div', { class: 'card gold clickable', onclick: () => { location.hash = '#/cofre'; } },
    h('div', { class: 'row between' }, h('span', { class: 'card-title' }, h('span', { class: 'gold' }, icon('vault', 20)), 'Cofre e reserva'), h('span', { class: 'num gold', style: { fontWeight: 700 } }, money(d.vaults.total_cents))),
    h('div', { class: 'stack', style: { marginTop: '10px' } }, d.vaults.items.map((v) => h('div', { class: 'stack-sm' }, h('div', { class: 'row between small' }, h('span', null, v.name), h('span', { class: 'num muted' }, v.target_cents ? `${money(v.balance_cents)} / ${money(v.target_cents)}` : money(v.balance_cents))), v.target_cents ? progressBar(v.balance_cents / v.target_cents, v.color || '#ffc857') : null)))));

  // últimas movimentações
  body.append(sectionTitle('Últimas movimentações', h('a', { href: '#/movimentos' }, 'Ver todas', icon('chevron', 14))));
  body.append(d.recent.length ? h('div', { class: 'card pad-sm' }, h('div', { class: 'list' }, d.recent.map((t) => txRow(t))))
    : h('div', { class: 'card' }, emptyState('receipt', 'Nenhuma movimentação ainda', 'Quando você registrar receitas e despesas, elas aparecem aqui.', h('button', { class: 'btn primary', type: 'button', onclick: () => txForm({}) }, icon('plus', 18), 'Registrar agora'))));

  // IA
  body.append(h('a', { class: 'card clickable glow', href: '#/ia', style: { color: 'inherit' } },
    h('div', { class: 'row' }, iconBadge('brain', '#38d5ff', 'lg', 28), h('div', { class: 'grow' }, h('div', { style: { fontWeight: 650 } }, 'IA do Nexo'), h('div', { class: 'small muted' }, d.insights.length && d.insights[0].id !== 'empty' ? d.insights[0].title : 'Precisa de uma ajuda? Pergunte sobre seus gastos, investimentos e metas.')), icon('chevron', 20))));

  root.append(hero, wrapBalance, body);
  return root;
}
