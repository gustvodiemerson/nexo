// Movimentações, formulário de lançamento, contas, orçamentos, contas a pagar e recorrências.
import {
  h, icon, S, GET, POST, PATCH, DEL, qs, bus, lookups, toast, errMsg, busy, formError, field, textInput, select, moneyInput, seg, switchEl, iconBadge, scopeBadge,
  emptyState, skeleton, openSheet, confirmDialog, scopeSwitch, scopeParam, monthNav, sectionTitle, pageHead, progressBar, money, signedMoney, brl, relDate, fmtDate,
  monthLabel, monthEndISO, todayISO, addMonthsYM, debounce, uid, canEditCouple, hasCouple, firstName, num2, pct,
} from '../ui.js';

export const PALETTE = ['#7aa2ff', '#ff5d8f', '#ffb454', '#3ddc97', '#b38cff', '#4cc9f0', '#ff8fb8', '#ffd166', '#f4a261', '#9aa7ff'];
const TYPE_LABEL = { income: 'Receita', expense: 'Despesa', transfer: 'Transferência' };
const ACC_TYPE = { checking: ['Conta corrente', 'bank', '#4cc9f0'], wallet: ['Carteira', 'wallet', '#3ddc97'], savings: ['Poupança', 'piggy', '#ffc857'], card: ['Cartão de crédito', 'card', '#ff5d8f'] };
const FREQ = { weekly: 'Semanal', monthly: 'Mensal', yearly: 'Anual' };
const canWriteScope = (scope) => scope === 'personal' || canEditCouple();

export function swatches(value, onPick) {
  const wrap = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Cor' });
  const paint = () => [...wrap.children].forEach((b) => b.classList.toggle('on', b.dataset.c === value));
  PALETTE.forEach((c) => wrap.append(h('button', { type: 'button', class: '', dataset: { c }, style: { background: c }, 'aria-label': c, onclick: () => { value = c; paint(); onPick && onPick(c); } })));
  paint();
  return { el: wrap, get: () => value };
}

// ---------- linha de lançamento ----------
export function txRow(t, { onclick } = {}) {
  const transfer = t.type === 'transfer';
  const col = transfer ? '#4cc9f0' : (t.category_color || (t.type === 'income' ? '#3ddc97' : '#8a93ad'));
  const ic = transfer ? 'swap' : (t.category_icon || (t.type === 'income' ? 'income' : 'expense'));
  const sub = [t.parent_category_name ? `${t.parent_category_name} › ${t.category_name}` : (t.category_name || (transfer ? `${t.account_name || ''} → ${t.to_account_name || ''}` : 'Sem categoria')), t.account_name && !transfer ? t.account_name : null].filter(Boolean).join(' • ');
  const row = h('button', { class: 'list-item', type: 'button', onclick: onclick || (() => openTx(t.id)) },
    iconBadge(ic, col),
    h('div', { class: 'li-main' }, h('div', { class: 'li-title' }, t.description),
      h('div', { class: 'li-sub' }, sub, t.scope === 'couple' && S.couple && t.user_name ? ` • ${firstName(t.user_name)}` : '')),
    h('div', { class: 'li-end' }, h('div', { class: t.type === 'income' ? 'pos' : t.type === 'expense' ? 'neg' : '' }, signedMoney(t.amount_cents, t.type)),
      h('div', { class: 'li-sub' }, t.status === 'pending' ? h('span', { class: 'badge warn' }, 'Pendente · ', relDate(t.date)) : relDate(t.date))));
  return row;
}

// ---------- detalhe do lançamento ----------
export async function openTx(id) {
  let t;
  try { t = (await GET('/transactions/' + id)).transaction; } catch (e) { toast(errMsg(e), 'err'); return; }
  const writable = canWriteScope(t.scope);
  const transfer = t.type === 'transfer';
  openSheet('Detalhes', (close) => {
    const rows = [
      ['Data', fmtDate(t.date)], ['Situação', t.status === 'paid' ? (t.type === 'income' ? 'Recebido' : t.type === 'transfer' ? 'Concluída' : 'Pago') : 'Pendente'],
      [transfer ? 'Sai de' : 'Conta', t.account_name], transfer ? ['Vai para', t.to_account_name] : ['Categoria', t.parent_category_name ? `${t.parent_category_name} › ${t.category_name}` : (t.category_name || 'Sem categoria')],
      ['Registrado por', t.user_name], t.installment_total ? ['Parcela', `${t.installment_no} de ${t.installment_total}`] : null, t.recurring_id ? ['Recorrência', 'Lançamento recorrente'] : null, t.notes ? ['Observações', t.notes] : null,
    ].filter(Boolean);
    const actions = h('div', { class: 'stack-sm' });
    if (t.status === 'pending' && writable) actions.append(h('button', { class: 'btn primary block', type: 'button', onclick: () => { close(); payDialog(t); } }, icon('check', 18), t.type === 'income' ? 'Marcar como recebido' : 'Marcar como pago'));
    const sub = h('div', { class: 'row' });
    if (writable) sub.append(h('button', { class: 'btn grow', type: 'button', onclick: () => { close(); txForm({ tx: t }); } }, icon('edit', 18), 'Editar'));
    if (S.couple) sub.append(h('button', { class: 'btn grow', type: 'button', onclick: async () => {
      if (t.scope === 'personal' && !(await confirmDialog({ title: 'Compartilhar com seu parceiro?', text: 'Este lançamento é pessoal. Ao enviá-lo no chat, seu parceiro verá descrição, valor e data.', confirm: 'Compartilhar' }))) return;
      try { await POST('/chat', { body: '', attachment: { kind: 'transaction', id: t.id } }); toast('Enviado no chat do casal'); close(); } catch (e) { toast(errMsg(e), 'err'); }
    } }, icon('chat', 18), 'No chat'));
    actions.append(sub);
    if (writable) actions.append(h('button', { class: 'btn danger-ghost block', type: 'button', onclick: async () => { close(); deleteTx(t); } }, icon('trash', 18), 'Excluir'));
    return h('div', { class: 'stack' },
      h('div', { class: 'row' }, iconBadge(transfer ? 'swap' : (t.category_icon || 'dots'), transfer ? '#4cc9f0' : t.category_color, 'lg'),
        h('div', { class: 'grow' }, h('div', { style: { fontWeight: 650, fontSize: '17px' } }, t.description), h('div', { class: 'row-wrap', style: { marginTop: '4px' } }, h('span', { class: 'badge' }, TYPE_LABEL[t.type]), scopeBadge(t.scope), t.status === 'pending' && h('span', { class: 'badge warn' }, 'Pendente')))),
      h('div', { class: 'stat-big num ' + (t.type === 'income' ? 'pos' : t.type === 'expense' ? 'neg' : ''), style: { fontSize: '30px' } }, signedMoney(t.amount_cents, t.type)),
      h('div', { class: 'card flat pad-sm' }, h('div', { class: 'list' }, rows.map(([k, v]) => h('div', { class: 'list-item', style: { minHeight: '44px' } }, h('span', { class: 'muted grow' }, k), h('span', { style: { textAlign: 'right', fontWeight: 500 } }, v))))),
      actions);
  });
}

function payDialog(t) {
  openSheet(t.type === 'income' ? 'Marcar como recebido' : 'Marcar como pago', (close) => {
    const date = h('input', { class: 'input', type: 'date', value: todayISO(), max: '2100-12-31' });
    const err = formError(); const btn = h('button', { class: 'btn primary block', type: 'button' }, 'Confirmar');
    btn.onclick = () => busy(btn, async () => { await POST(`/transactions/${t.id}/pay`, { date: date.value }); toast('Lançamento baixado'); bus.emit('change'); close(); }, err);
    return h('div', { class: 'stack' }, h('p', { class: 'muted' }, `${t.description} • ${brl(t.amount_cents)}`), field(t.type === 'income' ? 'Data do recebimento' : 'Data do pagamento', date), err, btn);
  });
}

async function deleteTx(t) {
  let group = '';
  if (t.installment_group) {
    const choice = await new Promise((resolve) => {
      let done = false;
      openSheet('Excluir parcela', (close) => h('div', { class: 'stack' }, h('p', { class: 'muted' }, `“${t.description}” faz parte de um parcelamento.`),
        h('button', { class: 'btn block', onclick: () => { done = true; close(); resolve('one'); } }, 'Somente esta parcela'),
        h('button', { class: 'btn block', onclick: () => { done = true; close(); resolve('following'); } }, 'Esta e as seguintes'),
        h('button', { class: 'btn danger-ghost block', onclick: () => { done = true; close(); resolve('all'); } }, 'Todas as parcelas'),
        h('button', { class: 'btn ghost block', onclick: () => { done = true; close(); resolve(null); } }, 'Cancelar')), { onClose: () => { if (!done) resolve(null); }, noFocus: true });
    });
    if (!choice) return; group = choice === 'one' ? '' : choice;
  } else if (!(await confirmDialog({ title: 'Excluir lançamento?', text: `“${t.description}” (${brl(t.amount_cents)}) será removido e os saldos serão recalculados.`, confirm: 'Excluir', danger: true }))) return;
  try { await DEL(`/transactions/${t.id}${group ? '?group=' + group : ''}`); toast('Lançamento excluído'); bus.emit('change'); } catch (e) { toast(errMsg(e), 'err'); }
}

// ---------- formulário de lançamento ----------
export function categorySelect(L, scope, kind, value, { blank = 'Sem categoria', onlyRoots = false } = {}) {
  const cats = L.categories.filter((c) => c.scope === scope && c.kind === kind);
  const roots = cats.filter((c) => !c.parent_id);
  const sel = h('select', { class: 'select' }, blank !== null && h('option', { value: '' }, blank));
  for (const r of roots) {
    const kids = onlyRoots ? [] : cats.filter((c) => c.parent_id === r.id);
    if (kids.length) { sel.append(h('optgroup', { label: r.name }, h('option', { value: r.id }, `${r.name} (geral)`), kids.map((k) => h('option', { value: k.id }, k.name)))); }
    else sel.append(h('option', { value: r.id }, r.name));
  }
  if (value) sel.value = String(value);
  return sel;
}

export async function txForm(opts = {}) {
  let L;
  try { L = await lookups(true); } catch (e) { toast(errMsg(e), 'err'); return; }
  const editing = opts.tx || null;
  if (!L.accounts.length) {
    openSheet('Nova movimentação', (close) => emptyState('wallet', 'Crie sua primeira conta', 'Para registrar receitas e despesas, cadastre onde seu dinheiro está: conta corrente, carteira, poupança ou cartão.',
      h('button', { class: 'btn primary', type: 'button', onclick: () => { close(); accountForm(); } }, icon('plus', 18), 'Criar conta')));
    return;
  }
  openSheet(editing ? 'Editar lançamento' : 'Novo lançamento', (close) => {
    const canCouple = !!S.couple && canEditCouple();
    let scope = editing ? editing.scope : (opts.scope || (S.scope === 'couple' && canCouple ? 'couple' : 'personal'));
    if (!editing && scope === 'couple' && !canCouple) scope = 'personal';
    let type = editing ? editing.type : (opts.type || 'expense');
    const idem = uid();
    const typeSeg = seg([{ v: 'expense', l: 'Despesa', disabled: !!editing }, { v: 'income', l: 'Receita', disabled: !!editing }, { v: 'transfer', l: 'Transferência', disabled: !!editing }], type, (v) => { type = v; syncType(); }, 'expense');
    const scopeSeg = !editing && canCouple ? seg([{ v: 'personal', l: 'Pessoal' }, { v: 'couple', l: 'Casal' }], scope, (v) => { scope = v; fillAccounts(); fillCats(); }) : null;
    const amount = moneyInput({ cents: editing ? editing.amount_cents : 0 });
    const desc = textInput({ placeholder: 'Ex.: Mercado do mês', maxLength: 120, value: editing ? editing.description.replace(/ \(\d+\/\d+\)$/, '') : '' });
    const date = h('input', { class: 'input', type: 'date', value: editing ? editing.date : todayISO(), min: '1990-01-01', max: '2100-12-31' });
    const acc = h('select', { class: 'select' }); const acc2 = h('select', { class: 'select' });
    const catWrap = h('div'); let cat = h('select', { class: 'select' });
    const statusSeg = seg([{ v: 'paid', l: 'Pago' }, { v: 'pending', l: 'Pendente' }], editing ? editing.status : 'paid');
    const inst = h('input', { class: 'input', type: 'number', min: 1, max: 60, value: 1, inputMode: 'numeric' });
    const rec = select([{ v: '', l: 'Não repete' }, { v: 'weekly', l: 'Toda semana' }, { v: 'monthly', l: 'Todo mês' }, { v: 'yearly', l: 'Todo ano' }], '');
    const auto = switchEl(false, null, 'Lançar como pago automaticamente');
    const notes = h('textarea', { class: 'textarea', maxLength: 500, placeholder: 'Opcional', value: editing?.notes || '' });
    const hint = h('div', { class: 'hint' });
    const err = formError();
    const btn = h('button', { class: `btn ${editing ? 'primary' : 'primary'} block`, type: 'submit' }, editing ? 'Salvar alterações' : 'Salvar');

    const accList = () => L.accounts.filter((a) => a.scope === scope);
    function fillAccounts() {
      const list = accList(); const keepA = acc.value, keepB = acc2.value;
      acc.replaceChildren(...(list.length ? list.map((a) => h('option', { value: a.id }, a.name + (a.type === 'card' ? ' (cartão)' : ''))) : [h('option', { value: '' }, `Nenhuma conta ${scope === 'couple' ? 'do casal' : 'pessoal'}`)]));
      acc2.replaceChildren(...list.map((a) => h('option', { value: a.id }, a.name + (a.type === 'card' ? ' (cartão)' : ''))));
      const pick = (el, keep, fallback) => { if (list.some((a) => String(a.id) === String(keep))) el.value = keep; else if (fallback !== undefined) el.value = fallback; };
      const first = editing ? String(editing.account_id) : (opts.account_id ? String(opts.account_id) : (list.find((a) => a.type !== 'card') || list[0] || {}).id);
      pick(acc, keepA || first, first); if (!acc.value && list[0]) acc.value = list[0].id;
      const second = editing?.to_account_id ? String(editing.to_account_id) : (list.find((a) => String(a.id) !== acc.value) || {}).id;
      pick(acc2, keepB || second, second);
    }
    function fillCats() {
      const keep = cat.value || (editing && editing.category_id ? String(editing.category_id) : '');
      const kind = type === 'income' ? 'income' : 'expense';
      const next = categorySelect(L, scope, kind, keep); next.id = cat.id; catWrap.replaceChildren(next); cat = next;
    }
    const catField = field('Categoria', catWrap), toField = field('Vai para', acc2), accField = field('Conta', acc), statusField = field('Situação', statusSeg.el), instField = field('Parcelas', inst), recField = field('Repetir', rec), autoRow = h('div', { class: 'row between hidden' }, h('span', { class: 'muted' }, 'Lançar como pago automaticamente'), auto);
    function syncType() {
      const tr = type === 'transfer';
      toField.classList.toggle('hidden', !tr); catField.classList.toggle('hidden', tr); statusField.classList.toggle('hidden', tr);
      instField.classList.toggle('hidden', tr || !!editing); recField.classList.toggle('hidden', tr || !!editing);
      accField.querySelector('label').textContent = tr ? 'Sai de' : (type === 'income' ? 'Entra em' : 'Pago com');
      statusSeg.el.className = 'seg ' + (type === 'income' ? 'income' : 'expense');
      [...statusSeg.el.children][0].textContent = type === 'income' ? 'Recebido' : 'Pago';
      desc.placeholder = tr ? 'Ex.: Pagamento da fatura' : type === 'income' ? 'Ex.: Salário' : 'Ex.: Mercado do mês';
      fillCats(); syncRep();
    }
    function syncRep() {
      const n = Number(inst.value) || 1;
      rec.disabled = n > 1; inst.disabled = !!rec.value;
      autoRow.classList.toggle('hidden', !rec.value || type === 'transfer' || !!editing);
      hint.textContent = n > 1 && amount.get() ? `${n}x de ${brl(Math.floor(amount.get() / n))} (a primeira parcela fica ${statusSeg.get() === 'paid' ? 'paga' : 'pendente'}, as demais pendentes).` : '';
    }
    inst.oninput = syncRep; rec.onchange = syncRep; amount.input.addEventListener('input', syncRep); statusSeg.el.addEventListener('click', syncRep);
    fillAccounts(); syncType();
    acc.onchange = () => { if (type === 'transfer' && acc2.value === acc.value) { const o = [...acc2.options].find((x) => x.value !== acc.value); if (o) acc2.value = o.value; } };

    const form = h('form', { class: 'stack', novalidate: true, onsubmit: (e) => {
      e.preventDefault();
      busy(btn, async () => {
        if (!amount.get()) throw new Error('Informe um valor maior que zero.');
        if (!desc.value.trim()) throw new Error('Informe uma descrição.');
        if (!acc.value) throw new Error('Escolha uma conta. Se não houver, crie uma em Contas.');
        if (type === 'transfer' && (!acc2.value || acc2.value === acc.value)) throw new Error('Escolha duas contas diferentes.');
        if (editing) {
          const body = { description: desc.value, notes: notes.value || null, amount_cents: amount.get(), date: date.value, account_id: Number(acc.value), status: statusSeg.get() };
          if (type === 'transfer') body.to_account_id = Number(acc2.value); else body.category_id = cat.value ? Number(cat.value) : null;
          await PATCH('/transactions/' + editing.id, body); toast('Lançamento atualizado');
        } else {
          const body = { scope, type, account_id: Number(acc.value), amount_cents: amount.get(), date: date.value, description: desc.value, notes: notes.value || undefined, idempotency_key: idem };
          if (type === 'transfer') body.to_account_id = Number(acc2.value);
          else { body.status = statusSeg.get(); if (cat.value) body.category_id = Number(cat.value); if (Number(inst.value) > 1) body.installments = Number(inst.value); if (rec.value) body.recurrence = { frequency: rec.value, auto_paid: auto.checked }; }
          const r = await POST('/transactions', body); toast(r.duplicate ? 'Este lançamento já havia sido registrado' : type === 'income' ? 'Receita registrada' : type === 'expense' ? 'Despesa registrada' : 'Transferência registrada');
        }
        bus.emit('change'); close();
      }, err);
    } },
      !editing && typeSeg.el, editing && h('div', { class: 'row' }, h('span', { class: 'badge' }, TYPE_LABEL[type]), scopeBadge(scope)),
      scopeSeg && field('Onde registrar', scopeSeg.el, { hint: scope === 'couple' ? 'Visível para vocês dois.' : 'Só você vê.' }),
      field('Valor', amount.el), field('Descrição', desc), field('Data', date), accField, toField, catField, statusField, instField, recField, autoRow, hint,
      field('Observações', notes), err, btn);
    return form;
  }, { noFocus: false });
}

// ---------- movimentações ----------
const F = { month: todayISO().slice(0, 7), type: '', status: '', q: '', account_id: '', category_id: '', user_id: '' };
export function setMovFilter(o) { Object.assign(F, o); }

export async function movimentosView() {
  const L = await lookups().catch(() => null);
  const root = h('div', { class: 'view' });
  const scope = scopeParam();
  const render = () => {
    const list = h('div'); let offset = 0; const LIMIT = 40;
    const totals = h('div', { class: 'kpi4' });
    const search = h('input', { class: 'input', type: 'search', placeholder: 'Buscar por descrição ou observação', value: F.q, 'aria-label': 'Buscar', enterKeyHint: 'search' });
    search.oninput = debounce(() => { F.q = search.value.trim(); load(true); }, 300);
    const monthBox = h('div'); const drawMonth = () => { monthBox.replaceChildren(F.month ? monthNav(F.month, (m) => { F.month = m; drawMonth(); load(true); }, { max: addMonthsYM(todayISO().slice(0, 7), 24) }) : h('div', { class: 'center muted' }, 'Todo o histórico')); };
    const allBtn = h('button', { class: 'chip', type: 'button', onclick: () => { F.month = F.month ? '' : todayISO().slice(0, 7); allBtn.classList.toggle('active', !F.month); drawMonth(); load(true); } }, icon('clock', 15), 'Tudo');
    allBtn.classList.toggle('active', !F.month);
    const typeSeg = seg([{ v: '', l: 'Todas' }, { v: 'income', l: 'Receitas' }, { v: 'expense', l: 'Despesas' }, { v: 'transfer', l: 'Transf.' }], F.type, (v) => { F.type = v; load(true); }, 'sm');
    const pend = h('button', { class: 'chip' + (F.status === 'pending' ? ' active' : ''), type: 'button', onclick: () => { F.status = F.status === 'pending' ? '' : 'pending'; pend.classList.toggle('active', F.status === 'pending'); load(true); } }, icon('clock', 15), 'Pendentes');
    const nf = ['account_id', 'category_id', 'user_id'].filter((k) => F[k]).length;
    const filterBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Mais filtros', onclick: () => filterSheet(L, scope, () => { root.replaceChildren(...render()); }) }, icon('filter', 20), nf ? h('span', { class: 'dot' }, nf) : null);
    drawMonth();
    async function load(reset) {
      if (reset) { offset = 0; list.replaceChildren(skeleton(4, 64)); }
      try {
        const r = await GET('/transactions' + qs({ scope, from: F.month ? F.month + '-01' : '', to: F.month ? monthEndISO(F.month) : '', type: F.type, status: F.status, q: F.q, account_id: F.account_id, category_id: F.category_id, user_id: F.user_id, limit: LIMIT, offset }));
        if (reset) { list.replaceChildren(); totals.replaceChildren(
          h('div', { class: 'card' }, h('div', { class: 'metric' }, h('span', { class: 'm-l' }, icon('income', 15), 'Receitas'), h('span', { class: 'm-v pos' }, money(r.totals.income_cents)))),
          h('div', { class: 'card' }, h('div', { class: 'metric' }, h('span', { class: 'm-l' }, icon('expense', 15), 'Despesas'), h('span', { class: 'm-v neg' }, money(r.totals.expense_cents)))),
          h('div', { class: 'card', style: { gridColumn: 'span 2' } }, h('div', { class: 'metric' }, h('span', { class: 'm-l' }, icon('pulse', 15), 'Resultado (lançamentos pagos)'), h('span', { class: `m-v ${r.totals.income_cents - r.totals.expense_cents >= 0 ? 'pos' : 'neg'}` }, money(r.totals.income_cents - r.totals.expense_cents))))); }
        list.querySelector('.more')?.remove();
        if (reset && !r.transactions.length) { list.append(emptyState('receipt', 'Nenhuma movimentação encontrada', F.q || nf || F.type || F.status ? 'Ajuste os filtros ou a busca.' : 'Registre sua primeira receita ou despesa com o botão +.', h('button', { class: 'btn primary', type: 'button', onclick: () => txForm({}) }, icon('plus', 18), 'Registrar'))); return; }
        let lastDate = list.dataset.last && !reset ? list.dataset.last : '', card = list.querySelector('.card:last-of-type .list');
        if (reset) { lastDate = ''; card = null; }
        for (const t of r.transactions) {
          if (t.date !== lastDate) { list.append(h('div', { class: 'group-date' }, new Date(t.date + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })), card = h('div', { class: 'card pad-sm' }, h('div', { class: 'list' }))); card = card.firstChild; lastDate = t.date; }
          card.append(txRow(t));
        }
        list.dataset.last = lastDate; offset += r.transactions.length;
        if (offset < r.count) list.append(h('button', { class: 'btn block more', type: 'button', style: { marginTop: '12px' }, onclick: () => load(false) }, `Carregar mais (${r.count - offset})`));
      } catch (e) { list.replaceChildren(emptyState('alert', 'Erro ao carregar', errMsg(e), h('button', { class: 'btn', onclick: () => load(true) }, 'Tentar novamente'))); }
    }
    load(true);
    return [pageHead('Movimentações', 'Histórico completo', h('div', { class: 'row' }, filterBtn, h('button', { class: 'btn primary sm', type: 'button', onclick: () => txForm({}) }, icon('plus', 16), 'Novo'))),
      h('div', { class: 'row between', style: { flexWrap: 'wrap' } }, scopeSwitch(() => bus.emit('scope-refresh')) || h('span'), allBtn),
      monthBox, typeSeg.el, search, h('div', { class: 'row-wrap' }, pend, ...activeChips(L, () => root.replaceChildren(...render()))), totals, list];
  };
  root.append(...render());
  return root;
}

function activeChips(L, redraw) {
  const out = [];
  const add = (k, label) => out.push(h('button', { class: 'chip active', type: 'button', onclick: () => { F[k] = ''; redraw(); } }, label, icon('x', 14)));
  if (L) {
    if (F.account_id) add('account_id', L.accounts.find((a) => String(a.id) === String(F.account_id))?.name || 'Conta');
    if (F.category_id) add('category_id', L.categories.find((c) => String(c.id) === String(F.category_id))?.name || 'Categoria');
    if (F.user_id) add('user_id', firstName(L.members.find((m) => String(m.id) === String(F.user_id))?.name) || 'Pessoa');
  }
  return out;
}

function filterSheet(L, scope, done) {
  openSheet('Filtros', (close) => {
    const acc = select([{ v: '', l: 'Todas as contas' }, ...(L?.accounts || []).filter((a) => scope === 'all' || a.scope === scope).map((a) => ({ v: a.id, l: a.name }))], F.account_id);
    const cat = h('select', { class: 'select' }, h('option', { value: '' }, 'Todas as categorias'));
    for (const r of (L?.categories || []).filter((c) => !c.parent_id && (scope === 'all' || c.scope === scope))) cat.append(h('option', { value: r.id }, `${r.name}${S.couple && scope === 'all' ? (r.scope === 'couple' ? ' (casal)' : ' (pessoal)') : ''}`));
    cat.value = F.category_id;
    const who = S.couple ? select([{ v: '', l: 'Todos' }, ...(L?.members || []).map((m) => ({ v: m.id, l: firstName(m.name) }))], F.user_id) : null;
    return h('div', { class: 'stack' }, field('Conta', acc), field('Categoria (inclui subcategorias)', cat), who && field('Registrado por', who),
      h('div', { class: 'row' }, h('button', { class: 'btn grow', type: 'button', onclick: () => { F.account_id = F.category_id = F.user_id = ''; close(); done(); } }, 'Limpar'),
        h('button', { class: 'btn primary grow', type: 'button', onclick: () => { F.account_id = acc.value; F.category_id = cat.value; F.user_id = who ? who.value : ''; close(); done(); } }, 'Aplicar')));
  });
}

// ---------- contas ----------
export function accountForm(acct, { scope } = {}) {
  openSheet(acct ? 'Editar conta' : 'Nova conta', (close) => {
    const canCouple = !!S.couple && canEditCouple();
    let type = acct ? acct.type : 'checking';
    const typeSeg = seg([{ v: 'checking', l: 'Corrente', disabled: !!acct }, { v: 'wallet', l: 'Carteira', disabled: !!acct }, { v: 'savings', l: 'Poupança', disabled: !!acct }, { v: 'card', l: 'Cartão', disabled: !!acct }], type, (v) => { type = v; sync(); });
    const scopeSeg = !acct && canCouple ? seg([{ v: 'personal', l: 'Pessoal' }, { v: 'couple', l: 'Casal' }], scope || (S.scope === 'couple' ? 'couple' : 'personal')) : null;
    const name = textInput({ placeholder: 'Ex.: Nubank, Carteira, Cartão Visa', maxLength: 40, value: acct?.name || '' });
    const init = moneyInput({ cents: acct ? Math.abs(acct.initial_cents) : 0, label: 'Saldo inicial' });
    const neg = h('input', { type: 'checkbox', checked: !!acct && acct.initial_cents < 0, id: 'negchk' });
    const limit = moneyInput({ cents: acct?.credit_limit_cents || 0, label: 'Limite' });
    const closing = h('input', { class: 'input', type: 'number', min: 1, max: 31, inputMode: 'numeric', value: acct?.closing_day || '' });
    const due = h('input', { class: 'input', type: 'number', min: 1, max: 31, inputMode: 'numeric', value: acct?.due_day || '' });
    const sw = swatches(acct?.color || PALETTE[0]);
    const err = formError(); const btn = h('button', { class: 'btn primary block', type: 'submit' }, acct ? 'Salvar' : 'Criar conta');
    const initField = field('Saldo inicial', init.el, { hint: 'Quanto há na conta hoje. Os saldos seguintes são calculados pelos lançamentos.' });
    const negRow = h('label', { class: 'row small muted', for: 'negchk' }, neg, 'Saldo devedor (negativo)');
    const cardBox = h('div', { class: 'stack' }, field('Limite do cartão', limit.el), h('div', { class: 'grid-2' }, field('Dia de fechamento', closing), field('Dia de vencimento', due)));
    function sync() { cardBox.classList.toggle('hidden', type !== 'card'); initField.classList.toggle('hidden', type === 'card'); negRow.classList.toggle('hidden', type === 'card'); }
    sync();
    return h('form', { class: 'stack', novalidate: true, onsubmit: (e) => {
      e.preventDefault();
      busy(btn, async () => {
        const body = { name: name.value, color: sw.get() };
        if (type === 'card') { body.credit_limit_cents = limit.get() || null; body.closing_day = closing.value ? Number(closing.value) : null; body.due_day = due.value ? Number(due.value) : null; body.initial_cents = 0; }
        else body.initial_cents = neg.checked ? -init.get() : init.get();
        if (acct) await PATCH('/accounts/' + acct.id, body); else await POST('/accounts', { ...body, type, scope: scopeSeg ? scopeSeg.get() : 'personal' });
        toast(acct ? 'Conta atualizada' : 'Conta criada'); bus.emit('change'); close();
      }, err);
    } }, !acct && typeSeg.el, scopeSeg && field('Ambiente', scopeSeg.el, { hint: 'Contas do casal aparecem para vocês dois.' }), field('Nome', name), initField, negRow, cardBox, field('Cor', sw.el), err, btn);
  });
}

function accountSheet(a) {
  const meta = ACC_TYPE[a.type];
  openSheet(a.name, (close) => {
    const writable = canWriteScope(a.scope);
    const rows = [['Tipo', meta[0]], ['Ambiente', a.scope === 'couple' ? 'Casal' : 'Pessoal'], a.type === 'card' ? ['Fatura em aberto', brl(a.invoice_cents)] : ['Saldo atual', brl(a.balance_cents)],
      a.type === 'card' && a.credit_limit_cents != null ? ['Limite disponível', `${brl(a.available_cents)} de ${brl(a.credit_limit_cents)}`] : null, a.due_day ? ['Vencimento', `Dia ${a.due_day}${a.next_due ? ` (próximo: ${fmtDate(a.next_due)})` : ''}`] : null, a.closing_day ? ['Fechamento', `Dia ${a.closing_day}`] : null].filter(Boolean);
    return h('div', { class: 'stack' },
      h('div', { class: 'card flat pad-sm' }, h('div', { class: 'list' }, rows.map(([k, v]) => h('div', { class: 'list-item', style: { minHeight: '44px' } }, h('span', { class: 'muted grow' }, k), h('span', { style: { fontWeight: 600 } }, v))))),
      h('button', { class: 'btn block', type: 'button', onclick: () => { setMovFilter({ account_id: a.id, category_id: '', type: '', status: '', q: '', month: '' }); close(); location.hash = '#/movimentos'; } }, icon('list', 18), 'Ver movimentações'),
      a.type === 'card' && writable && h('button', { class: 'btn primary block', type: 'button', onclick: () => { close(); txForm({ type: 'transfer', scope: a.scope }); } }, icon('swap', 18), 'Pagar fatura (transferência)'),
      writable && h('div', { class: 'row' },
        h('button', { class: 'btn grow', type: 'button', onclick: () => { close(); accountForm(a); } }, icon('edit', 18), 'Editar'),
        h('button', { class: 'btn grow', type: 'button', onclick: async () => { try { await PATCH('/accounts/' + a.id, { archived: !a.archived }); toast(a.archived ? 'Conta reativada' : 'Conta arquivada'); bus.emit('change'); close(); } catch (e) { toast(errMsg(e), 'err'); } } }, icon('download', 18), a.archived ? 'Reativar' : 'Arquivar')),
      writable && h('button', { class: 'btn danger-ghost block', type: 'button', onclick: async () => {
        if (!(await confirmDialog({ title: 'Excluir conta?', text: 'Só é possível excluir contas sem movimentações. Se houver histórico, arquive a conta.', confirm: 'Excluir', danger: true }))) return;
        try { await DEL('/accounts/' + a.id); toast('Conta excluída'); bus.emit('change'); close(); } catch (e) { toast(errMsg(e), 'err'); }
      } }, icon('trash', 18), 'Excluir'));
  });
}

let showArchived = false;
export async function contasView() {
  const scope = scopeParam();
  const [r, arch] = await Promise.all([GET('/accounts' + qs({ scope })), showArchived ? GET('/accounts' + qs({ scope, archived: 1 })) : null]);
  const groups = ['checking', 'wallet', 'savings', 'card'].map((t) => [t, r.accounts.filter((a) => a.type === t)]).filter(([, l]) => l.length);
  const root = h('div', { class: 'view' },
    pageHead('Contas e cartões', 'Onde está o seu dinheiro', h('button', { class: 'btn primary sm', type: 'button', onclick: () => accountForm(null, { scope: S.scope === 'couple' ? 'couple' : 'personal' }) }, icon('plus', 16), 'Nova')),
    scopeSwitch(() => bus.emit('scope-refresh')),
    h('div', { class: 'card glow' }, h('div', { class: 'metric' }, h('span', { class: 'm-l' }, icon('wallet', 16), 'Saldo total em contas'), h('span', { class: 'big-num' }, money(r.total_cents)),
      r.card_debt_cents ? h('span', { class: 'small neg' }, `Faturas em aberto: ${money(r.card_debt_cents)}`) : null)));
  if (!groups.length) root.append(emptyState('bank', 'Nenhuma conta ainda', 'Cadastre suas contas, carteiras e cartões para acompanhar saldos e registrar movimentações.', h('button', { class: 'btn primary', onclick: () => accountForm() }, icon('plus', 18), 'Criar primeira conta')));
  for (const [t, list] of groups) {
    const meta = ACC_TYPE[t];
    root.append(sectionTitle(meta[0] + (list.length > 1 ? 's' : '')), h('div', { class: 'card pad-sm' }, h('div', { class: 'list' }, list.map((a) => accRow(a)))));
  }
  const arc = h('button', { class: 'chip' + (showArchived ? ' active' : ''), type: 'button', onclick: () => { showArchived = !showArchived; bus.emit('scope-refresh'); } }, icon('download', 15), showArchived ? 'Ocultar arquivadas' : 'Ver arquivadas');
  root.append(h('div', null, arc));
  if (arch && arch.accounts.length) root.append(h('div', { class: 'card pad-sm' }, h('div', { class: 'list' }, arch.accounts.map((a) => accRow({ ...a, archived: 1 })))));
  return root;
}
function accRow(a) {
  const meta = ACC_TYPE[a.type];
  const sub = a.type === 'card' ? `Fatura ${money(a.invoice_cents)}${a.available_cents != null ? ` • disponível ${money(a.available_cents)}` : ''}${a.due_day ? ` • vence dia ${a.due_day}` : ''}` : meta[0];
  return h('button', { class: 'list-item', type: 'button', onclick: () => accountSheet(a) }, iconBadge(meta[1], a.color || meta[2]),
    h('div', { class: 'li-main' }, h('div', { class: 'li-title' }, a.name, a.archived ? h('span', { class: 'badge', style: { marginLeft: '6px' } }, 'Arquivada') : null), h('div', { class: 'li-sub' }, sub)),
    h('div', { class: 'li-end' }, h('div', { class: a.type === 'card' ? 'neg' : a.balance_cents < 0 ? 'neg' : '' }, a.type === 'card' ? money(a.invoice_cents) : money(a.balance_cents)), S.couple ? scopeBadge(a.scope) : null));
}

// ---------- planejamento ----------
let planMonth = todayISO().slice(0, 7);
export async function planejamentoView() {
  const scope = scopeParam();
  const [p, bills, recs] = await Promise.all([GET('/planning' + qs({ scope, month: planMonth })), GET('/bills' + qs({ scope })), GET('/recurring' + qs({ scope }))]);
  const root = h('div', { class: 'view' });
  const row = (label, a, b, c) => h('div', { class: 'list-item', style: { minHeight: '48px' } }, h('div', { class: 'li-main' }, h('div', { class: 'li-title' }, label), h('div', { class: 'li-sub', style: { whiteSpace: 'normal' } }, `${b}`, c ? ` • ${c}` : '')), h('div', { class: 'li-end' }, a));
  root.append(pageHead('Planejamento', 'Mês a mês, com orçamento e vencimentos'), scopeSwitch(() => bus.emit('scope-refresh')),
    monthNav(planMonth, (m) => { planMonth = m; bus.emit('scope-refresh'); }, { max: addMonthsYM(todayISO().slice(0, 7), 24) }),
    h('div', { class: 'card glow' }, h('div', { class: 'metric' }, h('span', { class: 'm-l' }, icon('pulse', 16), `Resultado projetado de ${monthLabel(planMonth)}`),
      h('span', { class: `big-num ${p.projected_result_cents >= 0 ? 'pos' : 'neg'}` }, money(p.projected_result_cents)),
      h('span', { class: 'small muted' }, 'Receitas recebidas + a receber + recorrências previstas, menos despesas pagas + a pagar + recorrências previstas.')),
      h('div', { class: 'list', style: { marginTop: '10px' } },
        row('Receitas', h('span', { class: 'pos' }, money(p.income.received_cents)), `Recebido`, `a receber ${money(p.income.pending_cents)} • previsto recorrente ${money(p.income.expected_recurring_cents)}`),
        row('Despesas', h('span', { class: 'neg' }, money(p.expense.paid_cents)), `Pago`, `a pagar ${money(p.expense.pending_cents)} • previsto recorrente ${money(p.expense.expected_recurring_cents)}`))));
  // Orçamentos
  root.append(sectionTitle('Orçamentos e limites', h('button', { class: 'link', type: 'button', onclick: () => budgetForm() }, 'Definir', icon('plus', 14))));
  if (!p.budgets.length) root.append(h('div', { class: 'card' }, emptyState('target', 'Sem orçamentos', 'Defina limites de gasto por categoria (ou um limite geral) e receba alertas ao chegar em 80% e 100%.', h('button', { class: 'btn primary', type: 'button', onclick: () => budgetForm() }, icon('plus', 18), 'Definir orçamento'))));
  else root.append(h('div', { class: 'card' }, h('div', { class: 'stack' }, [...p.budgets].sort((a, b) => (a.category_id ? 1 : 0) - (b.category_id ? 1 : 0)).map((b) => {
    const col = b.pct >= 1 ? 'var(--red)' : b.pct >= 0.8 ? 'var(--gold)' : 'var(--green)';
    return h('button', { class: 'stack-sm', type: 'button', style: { textAlign: 'left' }, onclick: () => budgetForm(b) },
      h('div', { class: 'row between' }, h('div', { class: 'row' }, iconBadge(b.category_icon || 'wallet', b.category_color, 'sm', 16), h('span', { style: { fontWeight: 600 } }, b.category_name), S.couple ? scopeBadge(b.scope) : null), h('span', { class: 'num', style: { color: col, fontWeight: 700 } }, pct(b.pct))),
      progressBar(b.pct, col), h('div', { class: 'row between small muted' }, h('span', null, `${money(b.spent_cents)} de ${money(b.limit_cents)}`), h('span', null, b.remaining_cents >= 0 ? `restam ${money(b.remaining_cents)}` : `estourou ${money(-b.remaining_cents)}`)));
  }))));
  // Contas a pagar / receber
  root.append(sectionTitle('Contas a pagar e a receber'));
  const all = [...bills.overdue.map((b) => ({ ...b, od: true })), ...bills.upcoming, ...bills.later];
  if (!all.length) root.append(h('div', { class: 'card' }, h('p', { class: 'muted center', style: { padding: '8px' } }, 'Nada pendente. Lançamentos marcados como “Pendente” aparecem aqui com a data de vencimento.')));
  else root.append(h('div', { class: 'card pad-sm' }, h('div', { class: 'list' }, all.slice(0, 30).map((b) => h('div', { class: 'list-item' },
    iconBadge(b.type === 'income' ? 'income' : 'receipt', b.od ? '#ff5c7a' : b.type === 'income' ? '#2ee59d' : '#ffb454'),
    h('div', { class: 'li-main' }, h('div', { class: 'li-title' }, b.description), h('div', { class: 'li-sub' }, b.od ? h('span', { class: 'neg' }, `Venceu em ${fmtDate(b.date)}`) : `Vence em ${fmtDate(b.date)}`, ` • ${b.account_name || ''}`)),
    h('div', { class: 'li-end' }, h('div', { class: b.type === 'income' ? 'pos' : '' }, money(b.amount_cents)), h('button', { class: 'btn sm', type: 'button', style: { marginTop: '4px' }, onclick: () => payDialog(b) }, b.type === 'income' ? 'Receber' : 'Pagar')))))));
  // Recorrências
  root.append(sectionTitle('Recorrências'));
  if (!recs.recurring.length) root.append(h('div', { class: 'card' }, h('p', { class: 'muted center', style: { padding: '8px' } }, 'Ao criar um lançamento com “Repetir”, ele aparece aqui. Assinaturas, aluguel e salário são ótimos exemplos.')));
  else root.append(h('div', { class: 'card pad-sm' }, h('div', { class: 'list' }, recs.recurring.map((r) => h('div', { class: 'list-item' },
    iconBadge('repeat', r.category_color || (r.type === 'income' ? '#2ee59d' : '#9aa7ff')),
    h('div', { class: 'li-main' }, h('div', { class: `li-title ${r.active ? '' : 'done-line'}` }, r.description), h('div', { class: 'li-sub' }, `${FREQ[r.frequency]} • próxima em ${fmtDate(r.next_date)}${r.account_name ? ' • ' + r.account_name : ''}`)),
    h('div', { class: 'li-end' }, h('div', { class: r.type === 'income' ? 'pos' : '' }, money(r.amount_cents)),
      h('div', { class: 'row', style: { justifyContent: 'flex-end', gap: '6px', marginTop: '4px' } },
        switchEl(r.active, async (on) => { try { await PATCH('/recurring/' + r.id, { active: on }); bus.emit('change'); } catch (e) { toast(errMsg(e), 'err'); } }, 'Ativa'),
        h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Excluir recorrência', onclick: async () => { if (await confirmDialog({ title: 'Excluir recorrência?', text: 'Os lançamentos já gerados permanecem; apenas as próximas repetições deixam de ser criadas.', confirm: 'Excluir', danger: true })) { try { await DEL('/recurring/' + r.id); toast('Recorrência excluída'); bus.emit('change'); } catch (e) { toast(errMsg(e), 'err'); } } } }, icon('trash', 15)))))))));
  return root;
}

async function budgetForm(b) {
  let L; try { L = await lookups(true); } catch (e) { toast(errMsg(e), 'err'); return; }
  openSheet(b ? 'Editar orçamento' : 'Novo orçamento', (close) => {
    const canCouple = !!S.couple && canEditCouple();
    const scopeSeg = !b && canCouple ? seg([{ v: 'personal', l: 'Pessoal' }, { v: 'couple', l: 'Casal' }], S.scope === 'couple' ? 'couple' : 'personal', () => fill()) : null;
    const limit = moneyInput({ cents: b ? b.limit_cents : 0, label: 'Limite mensal' });
    const catWrap = h('div'); let cat = h('select', { class: 'select' });
    const sc = () => (b ? b.scope : scopeSeg ? scopeSeg.get() : 'personal');
    function fill() { const next = categorySelect(L, sc(), 'expense', b ? b.category_id : '', { blank: 'Orçamento geral do mês (todas as despesas)', onlyRoots: true }); next.disabled = !!b; catWrap.replaceChildren(next); cat = next; }
    fill();
    const err = formError(); const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Salvar');
    return h('form', { class: 'stack', novalidate: true, onsubmit: (e) => { e.preventDefault(); busy(btn, async () => {
      await POST('/budgets', { scope: sc(), category_id: cat.value ? Number(cat.value) : undefined, limit_cents: limit.get() });
      toast('Orçamento salvo'); bus.emit('change'); close(); }, err); } },
      scopeSeg && field('Ambiente', scopeSeg.el), field('Categoria', catWrap, { hint: 'Subcategorias contam para a categoria principal.' }), field('Limite por mês', limit.el), err, btn,
      b && h('button', { class: 'btn danger-ghost block', type: 'button', onclick: async () => { try { await DEL('/budgets/' + b.id); toast('Orçamento removido'); bus.emit('change'); close(); } catch (e) { toast(errMsg(e), 'err'); } } }, icon('trash', 18), 'Remover orçamento'));
  });
}
