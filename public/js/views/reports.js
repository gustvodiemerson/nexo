// Relatórios: fluxo de caixa, categorias, comparação, patrimônio, casal e insights.
import {
  h, icon, S, GET, qs, toast, errMsg, openSheet, field, seg, iconBadge, emptyState, skeleton, errorState, scopeSwitch, scopeParam, pageHead, sectionTitle, progressBar, monthNav, money, brl, pct, spct,
  monthLabel, monthShort, addMonthsYM, todayISO, monthEndISO, avatar, firstName, bus,
} from '../ui.js';
import { barPairs, lineChart, stackedBars, donut } from '../charts.js';
import { setMovFilter } from './money.js';

let tab = 'fluxo', rMonth = todayISO().slice(0, 7), rKind = 'expense', rMonths = 6;

function exportSheet() {
  openSheet('Exportar movimentações', (close) => {
    const t = todayISO();
    const from = h('input', { class: 'input', type: 'date', value: t.slice(0, 7) + '-01' });
    const to = h('input', { class: 'input', type: 'date', value: monthEndISO(t.slice(0, 7)) });
    const link = () => `/api/reports/export.csv${qs({ scope: scopeParam(), from: from.value, to: to.value })}`;
    return h('div', { class: 'stack' }, h('p', { class: 'muted small' }, 'Gera uma planilha CSV (separador “;”, compatível com Excel e Google Planilhas) com os lançamentos do período, respeitando o ambiente selecionado.'),
      h('div', { class: 'grid-2' }, field('De', from), field('Até', to)),
      h('a', { class: 'btn primary block', href: '#', onclick: (e) => { e.preventDefault(); if (!from.value || !to.value || from.value > to.value) { toast('Período inválido.', 'err'); return; } const a = h('a', { href: link(), download: '' }); document.body.append(a); a.click(); a.remove(); close(); } }, icon('download', 18), 'Baixar CSV'),
      h('button', { class: 'btn block', type: 'button', onclick: () => { close(); setTimeout(() => window.print(), 200); } }, icon('receipt', 18), 'Imprimir / salvar em PDF'));
  });
}

const kpi = (label, value, cls = '', sub) => h('div', { class: 'card' }, h('div', { class: 'metric' }, h('span', { class: 'm-l' }, label), h('span', { class: `m-v ${cls}` }, value), sub ? h('span', { class: 'small muted' }, sub) : null));
const diffBadge = (cur, prev, inverse) => {
  if (!prev) return cur ? h('span', { class: 'badge' }, 'novo') : h('span', { class: 'dim' }, '—');
  const d = (cur - prev) / prev, good = inverse ? d <= 0 : d >= 0;
  return h('span', { class: `badge ${Math.abs(d) < 0.005 ? '' : good ? 'ok' : 'bad'}` }, spct(d, 0));
};

async function tabFluxo(box) {
  const scope = scopeParam();
  const r = await GET('/reports/cashflow' + qs({ scope, months: rMonths }));
  const labels = r.series.map((m) => monthShort(m.month));
  const monthsSeg = seg([{ v: 3, l: '3 meses' }, { v: 6, l: '6 meses' }, { v: 12, l: '12 meses' }], rMonths, (v) => { rMonths = v; load(); }, 'sm');
  box.replaceChildren(monthsSeg.el,
    h('div', { class: 'grid-2' }, kpi('Receitas', money(r.totals.income_cents), 'pos'), kpi('Despesas', money(r.totals.expense_cents), 'neg')),
    kpi('Resultado do período', money(r.totals.income_cents - r.totals.expense_cents), r.totals.income_cents - r.totals.expense_cents >= 0 ? 'pos' : 'neg', `Média mensal de despesas: ${money(Math.round(r.totals.expense_cents / r.months))}`),
    h('div', { class: 'card stack' }, h('div', { class: 'card-title' }, icon('chart', 18), 'Receitas x despesas'),
      barPairs(r.series.map((m, i) => ({ label: labels[i], a: m.income, b: m.expense }))),
      h('div', { class: 'legend' }, h('span', null, h('i', { style: { background: '#2ee59d' } }), 'Receitas'), h('span', null, h('i', { style: { background: '#ff5c7a' } }), 'Despesas'))),
    h('div', { class: 'card stack' }, h('div', { class: 'card-title' }, icon('pulse', 18), 'Fluxo de caixa acumulado (saldo em contas)'),
      lineChart(labels, [{ name: 'Saldo acumulado', color: '#38d5ff', values: r.series.map((m) => m.cumulative_cents) }])),
    h('div', { class: 'card pad-sm' }, h('div', { class: 'list' }, [...r.series].reverse().map((m) => h('div', { class: 'list-item', style: { minHeight: '48px' } }, h('div', { class: 'li-main' }, h('div', { class: 'li-title' }, monthLabel(m.month)), h('div', { class: 'li-sub' }, `Receitas ${money(m.income)} • Despesas ${money(m.expense)}`)), h('div', { class: `li-end ${m.net >= 0 ? 'pos' : 'neg'}` }, money(m.net)))))));
}

async function tabCategorias(box) {
  const scope = scopeParam();
  const r = await GET('/reports/categories' + qs({ scope, month: rMonth, kind: rKind }));
  const nav = monthNav(rMonth, (m) => { rMonth = m; load(); });
  const kindSeg = seg([{ v: 'expense', l: 'Despesas' }, { v: 'income', l: 'Receitas' }], rKind, (v) => { rKind = v; load(); }, rKind);
  const items = r.categories;
  box.replaceChildren(nav, kindSeg.el,
    items.length ? h('div', { class: 'card stack' }, donut(items.map((c) => ({ name: c.name, color: c.color, value: c.total })), { center: money(r.total_cents).replace('R$ ', ''), sub: rKind === 'expense' ? 'em despesas' : 'em receitas' }))
      : h('div', { class: 'card' }, emptyState('pie', 'Sem lançamentos no mês', `Nenhuma ${rKind === 'expense' ? 'despesa' : 'receita'} paga em ${monthLabel(rMonth)}.`)),
    items.length ? h('div', { class: 'card pad-sm' }, h('div', { class: 'list' }, items.map((c) => h('button', { class: 'list-item', type: 'button', onclick: () => { setMovFilter({ month: rMonth, category_id: c.category_id || '', type: rKind, status: '', q: '', account_id: '', user_id: '' }); location.hash = '#/movimentos'; } },
      iconBadge(c.icon || 'dots', c.color), h('div', { class: 'li-main' }, h('div', { class: 'li-title' }, c.name), h('div', { style: { marginTop: '5px' } }, progressBar(c.pct, c.color)), h('div', { class: 'li-sub' }, `${c.n} lançamento(s) • ${pct(c.pct)}`)), h('div', { class: 'li-end' }, money(c.total)))))) : null);
}

async function tabComparacao(box) {
  const scope = scopeParam();
  const r = await GET('/reports/compare' + qs({ scope, month: rMonth }));
  const nav = monthNav(rMonth, (m) => { rMonth = m; load(); });
  const row = (label, cur, prev, inverse) => h('div', { class: 'list-item', style: { minHeight: '58px' } }, h('div', { class: 'li-main' }, h('div', { class: 'li-title' }, label), h('div', { class: 'li-sub' }, `${monthLabel(r.previous_month)}: ${money(prev)}`)), h('div', { class: 'li-end' }, h('div', null, money(cur)), diffBadge(cur, prev, inverse)));
  box.replaceChildren(nav,
    h('div', { class: 'card pad-sm' }, h('div', { class: 'list' }, row('Receitas', r.current.income_cents, r.previous.income_cents, false), row('Despesas', r.current.expense_cents, r.previous.expense_cents, true),
      row('Resultado', r.current.income_cents - r.current.expense_cents, r.previous.income_cents - r.previous.expense_cents, false))),
    sectionTitle(`Despesas por categoria: ${monthShort(r.month)} x ${monthShort(r.previous_month)}`),
    r.categories.length ? h('div', { class: 'card pad-sm' }, h('div', { class: 'list' }, r.categories.map((c) => h('div', { class: 'list-item' }, iconBadge('tag', c.color, 'sm', 16),
      h('div', { class: 'li-main' }, h('div', { class: 'li-title' }, c.name), h('div', { class: 'li-sub' }, `antes ${money(c.previous_cents)}`)), h('div', { class: 'li-end' }, h('div', null, money(c.current_cents)), diffBadge(c.current_cents, c.previous_cents, true)))))) : h('div', { class: 'card' }, emptyState('chart', 'Sem dados para comparar', 'Registre despesas em dois meses para ver a comparação.')));
}

async function tabPatrimonio(box) {
  const scope = scopeParam();
  const n = rMonths === 3 ? 6 : rMonths;
  const r = await GET('/reports/networth' + qs({ scope, months: n }));
  const labels = r.points.map((p) => monthShort(p.month));
  const c = r.current;
  box.replaceChildren(seg([{ v: 6, l: '6 meses' }, { v: 12, l: '12 meses' }, { v: 24, l: '24 meses' }], n, (v) => { rMonths = v; load(); }, 'sm').el,
    h('div', { class: 'card glow stack' }, h('div', { class: 'metric' }, h('span', { class: 'm-l' }, icon('trend', 16), 'Patrimônio total hoje'), h('span', { class: 'big-num' }, money(c.total)), h('span', { class: 'small muted' }, 'Contas + cofres + investimentos − faturas de cartão')),
      h('div', { class: 'grid-2' }, h('div', { class: 'metric' }, h('span', { class: 'm-l' }, 'Em contas'), h('span', { class: 'm-v' }, money(c.accounts))), h('div', { class: 'metric' }, h('span', { class: 'm-l' }, 'Em cofres'), h('span', { class: 'm-v gold' }, money(c.vaults))),
        h('div', { class: 'metric' }, h('span', { class: 'm-l' }, 'Investimentos'), h('span', { class: 'm-v', style: { color: 'var(--violet)' } }, money(c.investments))), h('div', { class: 'metric' }, h('span', { class: 'm-l' }, 'Faturas de cartão'), h('span', { class: 'm-v neg' }, money(c.card_debt))))),
    h('div', { class: 'card stack' }, h('div', { class: 'card-title' }, icon('chart', 18), 'Composição ao longo do tempo'),
      stackedBars(labels, [{ name: 'Contas', color: '#38d5ff', values: r.points.map((p) => p.accounts) }, { name: 'Cofres', color: '#ffc857', values: r.points.map((p) => p.vaults) }, { name: 'Investimentos', color: '#8b5cf6', values: r.points.map((p) => p.investments) }]),
      h('div', { class: 'legend' }, h('span', null, h('i', { style: { background: '#38d5ff' } }), 'Contas'), h('span', null, h('i', { style: { background: '#ffc857' } }), 'Cofres'), h('span', null, h('i', { style: { background: '#8b5cf6' } }), 'Investimentos'))),
    h('div', { class: 'card stack' }, h('div', { class: 'card-title' }, icon('trend', 18), 'Evolução patrimonial'), lineChart(labels, [{ name: 'Patrimônio', color: '#ff3d9a', values: r.points.map((p) => p.total) }])));
}

async function tabCasal(box) {
  if (!S.couple) { box.replaceChildren(h('div', { class: 'card' }, emptyState('couple', 'Disponível para casais', 'Crie ou entre em um casal para comparar a participação de cada um.', h('a', { class: 'btn primary', href: '#/casal' }, 'Configurar casal')))); return; }
  const r = await GET('/couple/overview' + qs({ month: rMonth }));
  const nav = monthNav(rMonth, (m) => { rMonth = m; load(); });
  const totalExp = r.members.reduce((x, m) => x + m.expense_cents, 0), totalInc = r.members.reduce((x, m) => x + m.income_cents, 0);
  const colors = ['#ff3d9a', '#3b82ff'];
  const split = (key, total) => h('div', { class: 'stack-sm' }, h('div', { class: 'split' }, r.members.map((m, i) => h('i', { style: { width: `${total ? (m[key] / total) * 100 : 0}%`, background: colors[i % 2] } }))),
    h('div', { class: 'legend' }, r.members.map((m, i) => h('span', null, h('i', { style: { background: colors[i % 2] } }), `${firstName(m.name)} ${total ? pct(m[key] / total) : '0%'} • ${money(m[key])}`))));
  box.replaceChildren(nav, h('p', { class: 'small muted center' }, 'Apenas lançamentos pagos do ambiente do casal.'),
    h('div', { class: 'card stack' }, h('div', { class: 'card-title' }, icon('arrow-down', 18), `Despesas do casal: ${money(totalExp)}`), totalExp ? split('expense_cents', totalExp) : h('p', { class: 'muted small' }, 'Sem despesas do casal neste mês.')),
    h('div', { class: 'card stack' }, h('div', { class: 'card-title' }, icon('arrow-up', 18), `Receitas do casal: ${money(totalInc)}`), totalInc ? split('income_cents', totalInc) : h('p', { class: 'muted small' }, 'Sem receitas do casal neste mês.')),
    h('div', { class: 'card pad-sm' }, h('div', { class: 'list' }, r.members.map((m) => h('div', { class: 'list-item' }, avatar(m, 42),
      h('div', { class: 'li-main' }, h('div', { class: 'li-title' }, m.me ? `${firstName(m.name)} (você)` : firstName(m.name)), h('div', { class: 'li-sub' }, `Receitas ${money(m.income_cents)} • Despesas ${money(m.expense_cents)}`)),
      h('div', { class: 'li-end' }, m.personal_total_cents !== null ? h('div', null, h('div', null, money(m.personal_total_cents)), h('div', { class: 'li-sub' }, m.me ? 'seu total pessoal' : 'total pessoal (compartilhado)')) : h('div', { class: 'li-sub' }, h('span', { class: 'badge' }, icon('lock', 11), 'Pessoal privado'))))))));
}

async function tabInsights(box) {
  const r = await GET('/reports/insights' + qs({ scope: scopeParam() }));
  const L = { good: ['check', '#2ee59d'], warn: ['alert', '#ffc857'], info: ['info', '#3b82ff'] };
  box.replaceChildren(h('p', { class: 'small muted' }, 'Análises calculadas automaticamente a partir dos seus lançamentos reais — sem inventar dados.'),
    ...r.insights.map((i) => h('div', { class: `alert ${i.level === 'good' ? 'good' : i.level === 'warn' ? 'warn' : 'info'}` }, icon(L[i.level]?.[0] || 'info', 20), h('div', null, h('div', { style: { fontWeight: 650 } }, i.title), h('div', { class: 'small muted', style: { marginTop: '2px' } }, i.text)))),
    h('a', { class: 'btn primary block', href: '#/ia' }, icon('brain', 18), 'Conversar com a IA sobre isso'));
}

const TABS = [['fluxo', 'Fluxo de caixa', tabFluxo], ['categorias', 'Categorias', tabCategorias], ['comparacao', 'Comparação', tabComparacao], ['patrimonio', 'Patrimônio', tabPatrimonio], ['casal', 'Casal', tabCasal], ['insights', 'Insights', tabInsights]];
let box, tabsEl;
async function load() {
  tabsEl.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.t === tab));
  box.replaceChildren(skeleton(3, 110));
  try { await TABS.find((t) => t[0] === tab)[2](box); } catch (e) { box.replaceChildren(errorState(e, load)); }
}

export async function relatoriosView() {
  if (!S.couple && tab === 'casal') tab = 'fluxo';
  tabsEl = h('div', { class: 'tabs', role: 'tablist' }, TABS.filter((t) => t[0] !== 'casal' || S.couple).map(([k, l]) => h('button', { class: 'chip', type: 'button', role: 'tab', dataset: { t: k }, onclick: () => { tab = k; load(); } }, l)));
  box = h('div', { class: 'stack' });
  const root = h('div', { class: 'view' },
    pageHead('Relatórios', 'Entenda para onde vai o seu dinheiro', h('button', { class: 'btn sm no-print', type: 'button', onclick: exportSheet }, icon('download', 16), 'Exportar')),
    scopeSwitch(), tabsEl, box);
  load();
  return root;
}
