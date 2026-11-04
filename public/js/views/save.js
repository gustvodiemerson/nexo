// Cofre (reservas), metas e investimentos.
import {
  h, icon, S, GET, POST, PATCH, DEL, qs, bus, lookups, toast, errMsg, busy, formError, field, textInput, select, moneyInput, seg, iconBadge, scopeBadge, emptyState, skeleton,
  openSheet, confirmDialog, scopeSwitch, scopeParam, sectionTitle, pageHead, backHead, progressBar, money, brl, fmtDate, todayISO, uid, canEditCouple, pct, spct, firstName, monthShort,
} from '../ui.js';
import { lineChart, donut, sparkline } from '../charts.js';
import { swatches } from './money.js';

const canWriteScope = (scope) => scope === 'personal' || canEditCouple();
const scopePicker = (def) => (S.couple && canEditCouple() ? seg([{ v: 'personal', l: 'Pessoal' }, { v: 'couple', l: 'Casal' }], def || (S.scope === 'couple' ? 'couple' : 'personal')) : null);
const dateInput = (v, extra = {}) => h('input', { class: 'input', type: 'date', value: v || '', min: '1990-01-01', max: '2100-12-31', ...extra });

// ================= COFRE =================
export function vaultForm(vault) {
  openSheet(vault ? 'Editar cofre' : 'Novo cofre', (close) => {
    const sc = !vault ? scopePicker() : null;
    const name = textInput({ placeholder: 'Ex.: Reserva de emergência', maxLength: 50, value: vault?.name || '' });
    const target = moneyInput({ cents: vault?.target_cents || 0, label: 'Objetivo' });
    const deadline = dateInput(vault?.deadline);
    const sw = swatches(vault?.color || '#ffc857');
    const err = formError(); const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Salvar');
    return h('form', { class: 'stack', novalidate: true, onsubmit: (e) => { e.preventDefault(); busy(btn, async () => {
      const body = { name: name.value, target_cents: target.get() || null, deadline: deadline.value || null, color: sw.get() };
      if (vault) await PATCH('/vaults/' + vault.id, body); else await POST('/vaults', { ...body, scope: sc ? sc.get() : 'personal' });
      toast('Cofre salvo'); bus.emit('change'); close(); }, err); } },
      sc && field('Ambiente', sc.el, { hint: 'Cofres do casal são alimentados pelos dois.' }), field('Nome', name), field('Objetivo (opcional)', target.el), field('Prazo (opcional)', deadline), field('Cor', sw.el), err, btn);
  });
}

export async function vaultMove(vault, type, goalId) {
  let L; try { L = await lookups(true); } catch (e) { toast(errMsg(e), 'err'); return; }
  const deposit = type === 'deposit';
  openSheet(deposit ? `Guardar em “${vault.name}”` : `Retirar de “${vault.name}”`, (close) => {
    const accs = L.accounts.filter((a) => a.scope === vault.scope && a.type !== 'card');
    const amount = moneyInput({});
    const date = dateInput(todayISO());
    const acc = select([{ v: '', l: deposit ? 'Não debitar de nenhuma conta' : 'Não creditar em nenhuma conta' }, ...accs.map((a) => ({ v: a.id, l: `${a.name} (${brl(a.balance_cents)})` }))], '');
    const note = textInput({ placeholder: 'Opcional', maxLength: 200 });
    const idem = uid(); const err = formError();
    const btn = h('button', { class: `btn ${deposit ? 'primary' : ''} block`, type: 'submit' }, deposit ? 'Guardar' : 'Retirar');
    return h('form', { class: 'stack', novalidate: true, onsubmit: (e) => { e.preventDefault(); busy(btn, async () => {
      if (!amount.get()) throw new Error('Informe um valor maior que zero.');
      await POST(`/vaults/${vault.id}/movements`, { type, amount_cents: amount.get(), date: date.value, account_id: acc.value ? Number(acc.value) : undefined, note: note.value || undefined, idempotency_key: idem });
      toast(deposit ? 'Valor guardado no cofre 💛' : 'Retirada registrada'); bus.emit('change'); close(); }, err); } },
      field('Valor', amount.el), field('Data', date), field(deposit ? 'Sai da conta' : 'Vai para a conta', acc, { hint: 'Vincular a uma conta atualiza o saldo dela automaticamente.' }), field('Observação', note), err, btn);
  });
}

export async function cofreView() {
  const r = await GET('/vaults' + qs({ scope: scopeParam() }));
  const root = h('div', { class: 'view' }, pageHead('Cofre', 'Reservas e economias', h('button', { class: 'btn primary sm', type: 'button', onclick: () => vaultForm() }, icon('plus', 16), 'Novo')), scopeSwitch(),
    h('div', { class: 'card gold glow' }, h('div', { class: 'metric' }, h('span', { class: 'm-l' }, h('span', { class: 'gold' }, icon('vault', 18)), 'Total guardado'), h('span', { class: 'big-num gold' }, money(r.total_cents)), h('span', { class: 'small muted' }, `${r.vaults.length} cofre(s)`))));
  if (!r.vaults.length) root.append(emptyState('vault', 'Nenhum cofre ainda', 'Crie reservas para emergências, viagens ou qualquer objetivo, e acompanhe cada depósito.', h('button', { class: 'btn primary', type: 'button', onclick: () => vaultForm() }, icon('plus', 18), 'Criar cofre')));
  for (const v of r.vaults) root.append(h('div', { class: 'card clickable', onclick: () => { location.hash = '#/cofre/' + v.id; } },
    h('div', { class: 'row between' }, h('div', { class: 'row' }, iconBadge('vault', v.color || '#ffc857'), h('div', null, h('div', { style: { fontWeight: 650 } }, v.name), h('div', { class: 'row-wrap', style: { marginTop: '3px' } }, S.couple ? scopeBadge(v.scope) : null, v.deadline ? h('span', { class: 'badge' }, icon('calendar', 11), fmtDate(v.deadline)) : null))), h('div', { class: 'num', style: { fontWeight: 700, fontSize: '18px' } }, money(v.balance_cents))),
    v.target_cents ? h('div', { class: 'stack-sm', style: { marginTop: '10px' } }, progressBar(v.pct, v.color || '#ffc857'), h('div', { class: 'row between small muted' }, h('span', null, `${pct(v.pct)} do objetivo`), h('span', { class: 'num' }, `meta ${money(v.target_cents)}`))) : null,
    canWriteScope(v.scope) ? h('div', { class: 'row', style: { marginTop: '12px' } },
      h('button', { class: 'btn sm grow primary', type: 'button', onclick: (e) => { e.stopPropagation(); vaultMove(v, 'deposit'); } }, icon('plus', 15), 'Guardar'),
      h('button', { class: 'btn sm grow', type: 'button', onclick: (e) => { e.stopPropagation(); vaultMove(v, 'withdraw'); } }, icon('minus', 15), 'Retirar')) : null));
  return root;
}

export async function cofreDetalheView({ id }) {
  const { vault, movements } = await GET('/vaults/' + id);
  const writable = canWriteScope(vault.scope);
  const root = h('div', { class: 'view' }, backHead(vault.name, S.couple ? (vault.scope === 'couple' ? 'Cofre do casal' : 'Cofre pessoal') : 'Cofre', writable ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Editar cofre', onclick: () => vaultForm(vault) }, icon('edit', 18)) : null, '#/cofre'),
    h('div', { class: 'card gold glow stack' },
      h('div', { class: 'metric' }, h('span', { class: 'm-l' }, 'Saldo do cofre'), h('span', { class: 'big-num gold' }, money(vault.balance_cents))),
      vault.target_cents ? h('div', { class: 'stack-sm' }, progressBar(vault.pct, vault.color || '#ffc857'), h('div', { class: 'row between small muted' }, h('span', null, `${pct(vault.pct)} de ${money(vault.target_cents)}`), vault.deadline ? h('span', null, `até ${fmtDate(vault.deadline)}`) : null)) : null,
      writable ? h('div', { class: 'row' }, h('button', { class: 'btn primary grow', type: 'button', onclick: () => vaultMove(vault, 'deposit') }, icon('plus', 18), 'Guardar'), h('button', { class: 'btn grow', type: 'button', onclick: () => vaultMove(vault, 'withdraw') }, icon('minus', 18), 'Retirar')) : null));
  root.append(sectionTitle('Histórico'));
  root.append(movements.length ? h('div', { class: 'card pad-sm' }, h('div', { class: 'list' }, movements.map((m) => h('div', { class: 'list-item' },
    iconBadge(m.type === 'deposit' ? 'arrow-down' : 'arrow-up', m.type === 'deposit' ? '#ffc857' : '#ff9f4a'),
    h('div', { class: 'li-main' }, h('div', { class: 'li-title' }, m.type === 'deposit' ? 'Depósito' : 'Retirada', m.note ? ` • ${m.note}` : ''), h('div', { class: 'li-sub' }, `${fmtDate(m.date)} • ${firstName(m.user_name)}${m.account_name ? ` • ${m.account_name}` : ''}`)),
    h('div', { class: 'li-end' }, h('div', { class: m.type === 'deposit' ? 'gold' : '' }, `${m.type === 'deposit' ? '+ ' : '- '}${money(m.amount_cents)}`),
      writable ? h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Excluir movimento', style: { marginTop: '4px' }, onclick: async () => { if (!(await confirmDialog({ title: 'Excluir movimento?', text: 'O saldo do cofre e da conta vinculada será recalculado.', confirm: 'Excluir', danger: true }))) return; try { await DEL(`/vaults/${vault.id}/movements/${m.id}`); toast('Movimento excluído'); bus.emit('change'); } catch (e) { toast(errMsg(e), 'err'); } } }, icon('trash', 14)) : null))))) : h('div', { class: 'card' }, emptyState('piggy', 'Sem movimentos', 'Os depósitos e retiradas aparecem aqui, com quem fez cada um.')));
  if (writable) root.append(h('button', { class: 'btn danger-ghost block', type: 'button', onclick: async () => {
    if (!(await confirmDialog({ title: 'Excluir cofre?', text: 'Só é possível excluir cofres sem saldo. Metas ligadas a ele perdem o acompanhamento.', confirm: 'Excluir', danger: true }))) return;
    try { await DEL('/vaults/' + vault.id); toast('Cofre excluído'); location.hash = '#/cofre'; } catch (e) { toast(errMsg(e), 'err'); }
  } }, icon('trash', 18), 'Excluir cofre'));
  return root;
}

// ================= METAS =================
const KIND = { viagem: ['Viagem', 'plane', '#38d5ff'], compra: ['Compra', 'bag', '#ff8fb8'], patrimonio: ['Patrimônio', 'home2', '#3ddc97'], projeto: ['Projeto', 'flag', '#b38cff'], reserva: ['Reserva', 'shield', '#ffc857'], outro: ['Outro', 'star', '#7aa2ff'] };

async function goalForm(goal) {
  let L; try { L = await lookups(true); } catch (e) { toast(errMsg(e), 'err'); return; }
  openSheet(goal ? 'Editar meta' : 'Nova meta', (close) => {
    const sc = !goal ? scopePicker() : null;
    const kind = select(Object.entries(KIND).map(([v, k]) => ({ v, l: k[0] })), goal?.kind || 'viagem');
    const name = textInput({ placeholder: 'Ex.: Viagem dos sonhos', maxLength: 60, value: goal?.name || '' });
    const target = moneyInput({ cents: goal?.target_cents || 0, label: 'Valor da meta' });
    const deadline = dateInput(goal?.deadline);
    const notes = h('textarea', { class: 'textarea', maxLength: 300, placeholder: 'Opcional', value: goal?.notes || '' });
    const vaultSel = h('select', { class: 'select' });
    const fillV = () => { const scope = sc ? sc.get() : 'personal'; vaultSel.replaceChildren(h('option', { value: '' }, 'Criar um cofre para esta meta'), ...L.vaults.filter((v) => v.scope === scope).map((v) => h('option', { value: v.id }, `Usar o cofre “${v.name}”`))); };
    if (sc) sc.el.addEventListener('click', fillV); fillV();
    const err = formError(); const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Salvar meta');
    return h('form', { class: 'stack', novalidate: true, onsubmit: (e) => { e.preventDefault(); busy(btn, async () => {
      const body = { name: name.value, kind: kind.value, target_cents: target.get(), deadline: deadline.value || null, notes: notes.value || null };
      if (goal) await PATCH('/goals/' + goal.id, body); else await POST('/goals', { ...body, scope: sc ? sc.get() : 'personal', vault_id: vaultSel.value ? Number(vaultSel.value) : undefined });
      toast('Meta salva'); bus.emit('change'); close(); }, err); } },
      sc && field('Ambiente', sc.el), field('Tipo', kind), field('Nome da meta', name), field('Valor a alcançar', target.el), field('Prazo (opcional)', deadline),
      !goal && field('Onde guardar', vaultSel, { hint: 'O progresso da meta acompanha o saldo do cofre automaticamente.' }), field('Observações', notes), err, btn);
  });
}

function goalSheet(g) {
  const k = KIND[g.kind] || KIND.outro, writable = canWriteScope(g.scope);
  openSheet(g.name, (close) => h('div', { class: 'stack' },
    h('div', { class: 'row' }, iconBadge(k[1], k[2], 'lg'), h('div', { class: 'grow' }, h('div', { class: 'row-wrap' }, h('span', { class: 'badge' }, k[0]), S.couple ? scopeBadge(g.scope) : null, g.achieved ? h('span', { class: 'badge ok' }, 'Alcançada 🎉') : g.overdue ? h('span', { class: 'badge bad' }, 'Prazo vencido') : null))),
    h('div', { class: 'stat-big num', style: { fontSize: '28px' } }, money(g.current_cents), h('span', { class: 'muted', style: { fontSize: '15px', fontWeight: 500 } }, ` / ${money(g.target_cents)}`)),
    progressBar(g.pct, null, 'grad'),
    h('div', { class: 'card flat pad-sm' }, h('div', { class: 'list' },
      [['Progresso', pct(g.pct)], ['Falta', money(g.remaining_cents)], g.deadline ? ['Prazo', `${fmtDate(g.deadline)}${g.months_left != null && g.months_left >= 0 ? ` (${g.months_left} mês(es))` : ''}`] : null, g.per_month_cents ? ['Guardar por mês', money(g.per_month_cents)] : null, g.notes ? ['Observações', g.notes] : null].filter(Boolean)
        .map(([a, b]) => h('div', { class: 'list-item', style: { minHeight: '44px' } }, h('span', { class: 'muted grow' }, a), h('span', { style: { fontWeight: 600, textAlign: 'right' } }, b))))),
    writable && g.vault_id ? h('button', { class: 'btn primary block', type: 'button', onclick: () => { close(); vaultMove({ id: g.vault_id, name: g.name, scope: g.scope }, 'deposit'); } }, icon('piggy', 18), 'Guardar para esta meta') : null,
    h('div', { class: 'row' },
      g.vault_id ? h('a', { class: 'btn grow', href: '#/cofre/' + g.vault_id }, icon('vault', 18), 'Ver cofre') : null,
      S.couple ? h('button', { class: 'btn grow', type: 'button', onclick: async () => { try { await POST('/chat', { body: '', attachment: { kind: 'goal', id: g.id } }); toast('Meta enviada no chat'); close(); } catch (e) { toast(errMsg(e), 'err'); } } }, icon('chat', 18), 'No chat') : null),
    writable ? h('div', { class: 'row' }, h('button', { class: 'btn grow', type: 'button', onclick: () => { close(); goalForm(g); } }, icon('edit', 18), 'Editar'),
      h('button', { class: 'btn danger-ghost grow', type: 'button', onclick: async () => { if (!(await confirmDialog({ title: 'Excluir meta?', text: 'O cofre vinculado e seu saldo permanecem.', confirm: 'Excluir', danger: true }))) return; try { await DEL('/goals/' + g.id); toast('Meta excluída'); bus.emit('change'); close(); } catch (e) { toast(errMsg(e), 'err'); } } }, icon('trash', 18), 'Excluir')) : null));
}

export async function metasView() {
  const r = await GET('/goals' + qs({ scope: scopeParam() }));
  const root = h('div', { class: 'view' }, pageHead('Metas', r.total ? `${r.achieved} de ${r.total} alcançada(s)` : 'Sonhos com valor e prazo', h('button', { class: 'btn primary sm', type: 'button', onclick: () => goalForm() }, icon('plus', 16), 'Nova')), scopeSwitch());
  if (!r.goals.length) root.append(emptyState('target', 'Nenhuma meta ainda', 'Crie metas para viagens, compras, patrimônio ou projetos. O progresso acompanha o seu cofre automaticamente.', h('button', { class: 'btn primary', type: 'button', onclick: () => goalForm() }, icon('plus', 18), 'Criar meta')));
  for (const g of r.goals) {
    const k = KIND[g.kind] || KIND.outro;
    root.append(h('div', { class: 'card clickable', onclick: () => goalSheet(g) },
      h('div', { class: 'row between' }, h('div', { class: 'row' }, iconBadge(k[1], k[2]), h('div', null, h('div', { style: { fontWeight: 650 } }, g.name), h('div', { class: 'row-wrap', style: { marginTop: '3px' } }, S.couple ? scopeBadge(g.scope) : null, g.achieved ? h('span', { class: 'badge ok' }, 'Alcançada') : g.overdue ? h('span', { class: 'badge bad' }, 'Atrasada') : g.deadline ? h('span', { class: 'badge' }, icon('calendar', 11), fmtDate(g.deadline)) : null))), h('span', { class: 'num', style: { fontWeight: 750, fontSize: '18px' } }, pct(g.pct))),
      h('div', { style: { margin: '10px 0 6px' } }, progressBar(g.pct, null, 'grad')),
      h('div', { class: 'row between small muted' }, h('span', { class: 'num' }, `${money(g.current_cents)} de ${money(g.target_cents)}`), g.per_month_cents ? h('span', null, `${money(g.per_month_cents)}/mês`) : g.achieved ? h('span', { class: 'pos' }, '🎉') : null)));
  }
  return root;
}

// ================= INVESTIMENTOS =================
const ASSET = { renda_fixa: ['Renda fixa', '#38d5ff'], acoes: ['Ações', '#b38cff'], fiis: ['FIIs', '#ff8fb8'], fundos: ['Fundos', '#ffc857'], cripto: ['Cripto', '#ff9f4a'], previdencia: ['Previdência', '#3ddc97'], outro: ['Outro', '#7aa2ff'] };
let invTab = 'realized';

function investForm(inv) {
  openSheet(inv ? 'Editar investimento' : 'Novo investimento', (close) => {
    const sc = !inv ? scopePicker() : null;
    let status = inv?.status || 'realized';
    const statusSeg = seg([{ v: 'realized', l: 'Já investi', disabled: inv && inv.status === 'realized' && false }, { v: 'planned', l: 'Pretendo investir' }], status, (v) => { status = v; sync(); });
    const name = textInput({ placeholder: 'Ex.: Tesouro Selic 2029', maxLength: 60, value: inv?.name || '' });
    const type = select(Object.entries(ASSET).map(([v, a]) => ({ v, l: a[0] })), inv?.asset_type || 'renda_fixa');
    const inst = textInput({ placeholder: 'Ex.: Tesouro Direto, corretora…', maxLength: 60, value: inv?.institution || '' });
    const planned = moneyInput({ cents: inv?.planned_cents || 0, label: 'Valor planejado' });
    const ret = h('input', { class: 'input', type: 'number', step: '0.01', inputMode: 'decimal', placeholder: 'Ex.: 10,5', value: inv?.expected_return_pct ?? '' });
    const tdate = dateInput(inv?.target_date);
    const plannedBox = h('div', { class: 'stack' }, field('Valor que pretende investir', planned.el), field('Rentabilidade esperada (% ao ano)', ret, { hint: 'Usada apenas para projeção; não é garantia de retorno.' }), field('Data prevista', tdate));
    const sync = () => plannedBox.classList.toggle('hidden', status !== 'planned');
    sync();
    const err = formError(); const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Salvar');
    return h('form', { class: 'stack', novalidate: true, onsubmit: (e) => { e.preventDefault(); busy(btn, async () => {
      const body = { name: name.value, asset_type: type.value, institution: inst.value || null, status };
      if (status === 'planned') { body.planned_cents = planned.get(); body.expected_return_pct = ret.value === '' ? null : Number(String(ret.value).replace(',', '.')); body.target_date = tdate.value || null; }
      let r; if (inv) r = await PATCH('/investments/' + inv.id, body); else r = await POST('/investments', { ...body, scope: sc ? sc.get() : 'personal' });
      toast('Investimento salvo'); bus.emit('change'); close(); if (!inv && r.investment) location.hash = '#/investimentos/' + r.investment.id; }, err); } },
      sc && field('Carteira', sc.el, { hint: 'Individual ou compartilhada com o casal.' }), field('Situação', statusSeg.el), field('Nome do ativo', name), field('Tipo', type), field('Instituição', inst), plannedBox, err, btn);
  });
}

export async function investimentosView() {
  const r = await GET('/investments' + qs({ scope: scopeParam() }));
  const realized = r.items.filter((i) => i.status === 'realized'), planned = r.items.filter((i) => i.status === 'planned');
  const root = h('div', { class: 'view' }, pageHead('Investimentos', 'Carteira e planos', h('button', { class: 'btn primary sm', type: 'button', onclick: () => investForm() }, icon('plus', 16), 'Novo')), scopeSwitch());
  root.append(h('div', { class: 'card glow stack' },
    h('div', { class: 'metric' }, h('span', { class: 'm-l' }, icon('invest', 16), 'Valor atual da carteira'), h('span', { class: 'big-num' }, money(r.value_cents))),
    h('div', { class: 'grid-2' },
      h('div', { class: 'metric' }, h('span', { class: 'm-l' }, 'Total investido'), h('span', { class: 'm-v' }, money(r.invested_cents))),
      h('div', { class: 'metric' }, h('span', { class: 'm-l' }, 'Rentabilidade'), h('span', { class: `m-v ${r.return_cents >= 0 ? 'pos' : 'neg'}` }, r.invested_cents ? `${money(r.return_cents)} (${spct(r.return_pct)})` : '—'))),
    r.planned_cents ? h('div', { class: 'alert warn' }, icon('flag', 18), h('div', null, h('strong', null, money(r.planned_cents)), ' planejados (ainda não investidos — não entram no valor acima).')) : null));
  if (r.evolution.some((e) => e.value_cents || e.invested_cents)) root.append(h('div', { class: 'card stack' }, h('div', { class: 'card-title' }, icon('trend', 18), 'Evolução patrimonial (12 meses)'),
    lineChart(r.evolution.map((e) => monthShort(e.month)), [{ name: 'Valor da carteira', color: '#2ee59d', values: r.evolution.map((e) => e.value_cents) }, { name: 'Total investido', color: '#3b82ff', values: r.evolution.map((e) => e.invested_cents), dashed: true }]),
    h('div', { class: 'legend' }, h('span', null, h('i', { style: { background: '#2ee59d' } }), 'Valor da carteira'), h('span', null, h('i', { style: { background: '#3b82ff' } }), 'Total investido'))));
  const types = Object.entries(r.by_type).filter(([, v]) => v > 0);
  if (types.length) root.append(h('div', { class: 'card stack' }, h('div', { class: 'card-title' }, icon('pie', 18), 'Distribuição por tipo'),
    donut(types.map(([k, v]) => ({ name: (ASSET[k] || ASSET.outro)[0], color: (ASSET[k] || ASSET.outro)[1], value: v })), { center: money(r.value_cents).replace('R$ ', ''), sub: 'total' }),
    h('div', { class: 'legend' }, types.map(([k, v]) => h('span', null, h('i', { style: { background: (ASSET[k] || ASSET.outro)[1] } }), `${(ASSET[k] || ASSET.outro)[0]} ${pct(v / r.value_cents)}`)))));
  const tab = seg([{ v: 'realized', l: `Realizados (${realized.length})` }, { v: 'planned', l: `Planejados (${planned.length})` }], invTab, (v) => { invTab = v; draw(); });
  const box = h('div');
  const draw = () => {
    const list = invTab === 'realized' ? realized : planned;
    box.replaceChildren(list.length ? h('div', { class: 'card pad-sm' }, h('div', { class: 'list' }, list.map((i) => h('a', { class: 'list-item', href: '#/investimentos/' + i.id, style: { color: 'inherit' } },
      iconBadge(i.status === 'planned' ? 'flag' : 'trend', (ASSET[i.asset_type] || ASSET.outro)[1]),
      h('div', { class: 'li-main' }, h('div', { class: 'li-title' }, i.name), h('div', { class: 'li-sub' }, [(ASSET[i.asset_type] || ASSET.outro)[0], i.institution].filter(Boolean).join(' • '), S.couple ? ' • ' + (i.scope === 'couple' ? 'Casal' : 'Pessoal') : '')),
      i.status === 'planned' ? h('div', { class: 'li-end' }, h('div', { class: 'gold' }, money(i.planned_cents)), h('div', { class: 'li-sub' }, 'planejado'))
        : h('div', { class: 'li-end' }, h('div', null, money(i.value_cents)), h('div', { class: `li-sub ${i.return_cents >= 0 ? 'pos' : 'neg'}` }, i.invested_cents ? spct(i.return_pct) : 'sem aportes'))))))
      : h('div', { class: 'card' }, emptyState(invTab === 'realized' ? 'invest' : 'flag', invTab === 'realized' ? 'Nenhum investimento realizado' : 'Nada planejado ainda', invTab === 'realized' ? 'Cadastre seus ativos e registre aportes para acompanhar a rentabilidade.' : 'Planeje futuros investimentos sem misturar com o que já foi aplicado.', h('button', { class: 'btn primary', type: 'button', onclick: () => investForm() }, icon('plus', 18), 'Cadastrar'))));
  };
  draw();
  root.append(tab.el, box);
  return root;
}

async function entrySheet(inv, type) {
  let L; try { L = await lookups(true); } catch (e) { toast(errMsg(e), 'err'); return; }
  const titles = { aporte: 'Registrar aporte', resgate: 'Registrar resgate', valuation: 'Atualizar valor atual' };
  openSheet(titles[type], (close) => {
    const accs = L.accounts.filter((a) => a.scope === inv.scope && a.type !== 'card');
    const amount = moneyInput({ cents: type === 'valuation' ? inv.value_cents : 0, label: 'Valor' });
    const date = dateInput(todayISO());
    const acc = select([{ v: '', l: type === 'aporte' ? 'Não debitar de nenhuma conta' : 'Não creditar em nenhuma conta' }, ...accs.map((a) => ({ v: a.id, l: `${a.name} (${brl(a.balance_cents)})` }))], '');
    const note = textInput({ placeholder: 'Opcional', maxLength: 200 });
    const idem = uid(); const err = formError(); const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Salvar');
    return h('form', { class: 'stack', novalidate: true, onsubmit: (e) => { e.preventDefault(); busy(btn, async () => {
      await POST(`/investments/${inv.id}/entries`, { type, amount_cents: amount.get(), date: date.value, account_id: type !== 'valuation' && acc.value ? Number(acc.value) : undefined, note: note.value || undefined, idempotency_key: idem });
      toast('Registro salvo'); bus.emit('change'); close(); }, err); } },
      type === 'valuation' && h('p', { class: 'small muted' }, 'Informe quanto o investimento vale hoje (saldo total do ativo). A diferença para o total investido é a rentabilidade.'),
      field(type === 'valuation' ? 'Valor atual do ativo' : 'Valor', amount.el), field('Data', date), type !== 'valuation' && field(type === 'aporte' ? 'Sai da conta' : 'Cai na conta', acc, { hint: 'Opcional: atualiza o saldo da conta escolhida.' }), field('Observação', note), err, btn);
  });
}

export async function investimentoDetalheView({ id }) {
  const { investment: inv, entries } = await GET('/investments/' + id);
  const writable = canWriteScope(inv.scope), a = ASSET[inv.asset_type] || ASSET.outro, planned = inv.status === 'planned';
  const root = h('div', { class: 'view' }, backHead(inv.name, [a[0], inv.institution, S.couple ? (inv.scope === 'couple' ? 'Casal' : 'Pessoal') : null].filter(Boolean).join(' • '), writable ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Editar', onclick: () => investForm(inv) }, icon('edit', 18)) : null, '#/investimentos'));
  if (planned) {
    root.append(h('div', { class: 'card glow stack' }, h('span', { class: 'badge warn', style: { alignSelf: 'flex-start' } }, icon('flag', 11), 'Planejado — ainda não investido'),
      h('div', { class: 'metric' }, h('span', { class: 'm-l' }, 'Valor planejado'), h('span', { class: 'big-num gold' }, money(inv.planned_cents))),
      h('div', { class: 'list' }, [inv.expected_return_pct != null ? ['Rentabilidade esperada', `${String(inv.expected_return_pct).replace('.', ',')}% ao ano`] : null, inv.target_date ? ['Data prevista', fmtDate(inv.target_date)] : null, inv.projection_cents ? ['Projeção na data (estimativa)', money(inv.projection_cents)] : null].filter(Boolean)
        .map(([k, v]) => h('div', { class: 'list-item', style: { minHeight: '44px' } }, h('span', { class: 'muted grow' }, k), h('span', { style: { fontWeight: 600 } }, v)))),
      inv.projection_cents ? h('p', { class: 'small dim' }, 'Projeção apenas ilustrativa, com juros compostos sobre o valor planejado. Rentabilidade passada ou esperada não garante resultados futuros.') : null,
      writable ? h('button', { class: 'btn primary block', type: 'button', onclick: async () => { try { await PATCH('/investments/' + inv.id, { status: 'realized' }); toast('Marcado como realizado. Registre o primeiro aporte!'); bus.emit('change'); } catch (e) { toast(errMsg(e), 'err'); } } }, icon('check', 18), 'Já investi: marcar como realizado') : null));
  } else {
    root.append(h('div', { class: 'card glow stack' }, h('div', { class: 'metric' }, h('span', { class: 'm-l' }, 'Valor atual'), h('span', { class: 'big-num' }, money(inv.value_cents))),
      h('div', { class: 'grid-2' }, h('div', { class: 'metric' }, h('span', { class: 'm-l' }, 'Investido'), h('span', { class: 'm-v' }, money(inv.invested_cents))), h('div', { class: 'metric' }, h('span', { class: 'm-l' }, 'Rentabilidade'), h('span', { class: `m-v ${inv.return_cents >= 0 ? 'pos' : 'neg'}` }, inv.invested_cents ? `${money(inv.return_cents)} (${spct(inv.return_pct)})` : '—'))),
      writable ? h('div', { class: 'grid-2' }, h('button', { class: 'btn primary', type: 'button', onclick: () => entrySheet(inv, 'aporte') }, icon('plus', 18), 'Aporte'), h('button', { class: 'btn', type: 'button', onclick: () => entrySheet(inv, 'resgate') }, icon('minus', 18), 'Resgate')) : null,
      writable ? h('button', { class: 'btn block', type: 'button', onclick: () => entrySheet(inv, 'valuation') }, icon('refresh', 18), 'Atualizar valor atual') : null));
    root.append(sectionTitle('Movimentos do ativo'));
    const LBL = { aporte: ['Aporte', 'arrow-down', '#3b82ff'], resgate: ['Resgate', 'arrow-up', '#ff9f4a'], valuation: ['Atualização de valor', 'refresh', '#8b5cf6'] };
    root.append(entries.length ? h('div', { class: 'card pad-sm' }, h('div', { class: 'list' }, entries.map((e) => h('div', { class: 'list-item' }, iconBadge(LBL[e.type][1], LBL[e.type][2]),
      h('div', { class: 'li-main' }, h('div', { class: 'li-title' }, LBL[e.type][0], e.note ? ` • ${e.note}` : ''), h('div', { class: 'li-sub' }, `${fmtDate(e.date)} • ${firstName(e.user_name)}${e.account_name ? ` • ${e.account_name}` : ''}`)),
      h('div', { class: 'li-end' }, h('div', null, money(e.amount_cents)), writable ? h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Excluir registro', style: { marginTop: '4px' }, onclick: async () => { if (!(await confirmDialog({ title: 'Excluir registro?', text: 'O valor e a rentabilidade serão recalculados.', confirm: 'Excluir', danger: true }))) return; try { await DEL(`/investments/${inv.id}/entries/${e.id}`); toast('Registro excluído'); bus.emit('change'); } catch (er) { toast(errMsg(er), 'err'); } } }, icon('trash', 14)) : null))))) : h('div', { class: 'card' }, emptyState('invest', 'Sem registros', 'Registre aportes e atualize o valor periodicamente para acompanhar a evolução.')));
  }
  if (writable) root.append(h('button', { class: 'btn danger-ghost block', type: 'button', onclick: async () => {
    const force = inv.value_cents > 0;
    if (!(await confirmDialog({ title: 'Excluir investimento?', text: force ? 'Este investimento possui saldo. Excluir apaga todo o histórico de aportes e resgates.' : 'O investimento será removido.', confirm: 'Excluir', danger: true }))) return;
    try { await DEL(`/investments/${inv.id}${force ? '?force=1' : ''}`); toast('Investimento excluído'); location.hash = '#/investimentos'; } catch (e) { toast(errMsg(e), 'err'); }
  } }, icon('trash', 18), 'Excluir investimento'));
  return root;
}
