// Registro assistido: cartão de confirmação dos pedidos da IA e leitura de nota fiscal por foto.
// A IA só propõe; quem grava é o usuário, tocando em "Pessoal" ou "Casal" (as regras de isolamento do servidor continuam valendo).
import {
  h, icon, S, GET, POST, bus, lookups, toast, errMsg, busy, formError, field, textInput, moneyInput, seg, openSheet, brl, fmtDate, todayISO, uid, canEditCouple, iconBadge, emptyState,
} from '../ui.js';

const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

function resolveCategory(L, scope, kind, hint) {
  if (!hint) return null;
  const n = norm(hint); if (n.length < 3) return null;
  const cats = L.categories.filter((c) => c.scope === scope && c.kind === kind);
  const exact = cats.find((c) => norm(c.name) === n);
  if (exact) return exact.id;
  const part = cats.filter((c) => { const cn = norm(c.name); return cn.length >= 3 && (cn.includes(n) || n.includes(cn)); });
  const leaf = part.find((c) => c.parent_id) || part[0];
  return leaf ? leaf.id : null;
}
function pickAccount(L, scope, hint, preferId) {
  const list = L.accounts.filter((a) => a.scope === scope);
  if (preferId && list.some((a) => String(a.id) === String(preferId))) return Number(preferId);
  if (hint) { const n = norm(hint); const m = list.find((a) => norm(a.name) === n) || list.find((a) => norm(a.name).includes(n) || n.includes(norm(a.name))); if (m) return m.id; }
  return (list.find((a) => a.type !== 'card') || list[0] || {}).id || null;
}
const scopeLabel = (s) => (s === 'couple' ? 'Casal' : 'Pessoal');

// Botões "Registrar no Pessoal / Casal". Para quem não tem casal, um único botão.
function scopeButtons(onPick, { label = 'Registrar', preferScope } = {}) {
  const couple = !!S.couple;
  if (!couple) return h('div', { class: 'row' }, h('button', { class: 'btn primary grow', type: 'button', onclick: (e) => onPick('personal', e.currentTarget) }, icon('check', 16), label));
  const canC = canEditCouple();
  return h('div', { class: 'stack' }, h('div', { class: 'tiny dim center' }, 'Onde registrar?'),
    h('div', { class: 'row' },
      h('button', { class: `btn ${preferScope !== 'couple' ? 'primary' : ''} grow`, type: 'button', onclick: (e) => onPick('personal', e.currentTarget) }, 'Pessoal'),
      h('button', { class: `btn ${preferScope === 'couple' ? 'primary' : ''} grow`, type: 'button', disabled: !canC || undefined, title: canC ? '' : 'Você não tem permissão de edição no casal', onclick: (e) => onPick('couple', e.currentTarget) }, 'Casal')));
}

async function bulkCreate({ scope, items, accountId, source, resolveHints = true }) {
  const L = await lookups(true);
  const acc = pickAccount(L, scope, null, accountId);
  if (!acc) throw new Error(`Você ainda não tem uma conta ${scope === 'couple' ? 'do casal' : 'pessoal'}. Crie uma em Finanças → Contas.`);
  const payload = items.map((it) => ({
    type: it.type, description: it.description, amount_cents: it.amount_cents, date: it.date || todayISO(), status: it.status || 'paid',
    account_id: resolveHints ? pickAccount(L, scope, it.account, acc) : acc, category_id: resolveCategory(L, scope, it.type, it.category) || undefined,
  }));
  const r = await POST('/transactions/bulk', { scope, batch: 'b' + uid().replace(/-/g, ''), account_id: acc, items: payload, source });
  bus.emit('change');
  return r;
}

// ---------- cartão do chat da IA ----------
export function proposalCard(items, { onDone } = {}) {
  const box = h('div', { class: 'proposal stack', style: { marginTop: '10px' } });
  const total = items.reduce((a, i) => a + (i.type === 'income' ? 1 : -1) * i.amount_cents, 0);
  const rows = items.map((i) => h('div', { class: 'row between', style: { gap: '10px' } },
    h('div', { class: 'row', style: { gap: '8px', minWidth: 0 } }, iconBadge(i.type === 'income' ? 'income' : 'receipt', i.type === 'income' ? '#2ee59d' : '#ff5c7a', '', 18),
      h('div', { style: { minWidth: 0 } }, h('div', { style: { fontWeight: 600, overflowWrap: 'anywhere' } }, i.description), h('div', { class: 'tiny dim' }, `${i.type === 'income' ? 'Receita' : 'Despesa'} • ${fmtDate(i.date)}${i.status === 'pending' ? ' • pendente' : ''}${i.category ? ' • ' + i.category : ''}`))),
    h('strong', { class: 'num', style: { color: i.type === 'income' ? 'var(--green, #2ee59d)' : 'var(--red, #ff5c7a)', whiteSpace: 'nowrap' } }, (i.type === 'income' ? '+ ' : '− ') + brl(i.amount_cents))));
  const done = h('div');
  const err = formError();
  const actions = scopeButtons(async (scope, btn) => {
    await busy(btn, async () => {
      await bulkCreate({ scope, items, source: 'ia' });
      actions.remove(); discard.remove();
      done.replaceChildren(h('div', { class: 'row', style: { gap: '8px' } }, icon('check', 18), h('span', null, `Registrado em ${scopeLabel(scope)}.`)));
      toast(items.length > 1 ? `${items.length} lançamentos registrados` : 'Lançamento registrado');
      onDone && onDone(scope);
    }, err);
  });
  const discard = h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { box.replaceChildren(h('span', { class: 'tiny dim' }, 'Cancelado — nada foi registrado.')); } }, 'Descartar');
  box.append(...rows, items.length > 1 ? h('div', { class: 'row between tiny dim' }, h('span', null, 'Saldo do pedido'), h('span', { class: 'num' }, brl(Math.abs(total)))) : null, err, actions, done, h('div', { class: 'row', style: { justifyContent: 'center' } }, discard));
  return box;
}

// ---------- nota fiscal ----------
async function compressImage(file, { max = 1400, quality = 0.72, limit = 1_100_000 } = {}) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    bmp = await new Promise((res, rej) => { const u = URL.createObjectURL(file); const im = new Image(); im.onload = () => { res(im); }; im.onerror = () => rej(new Error('Não foi possível ler a foto.')); im.src = u; });
  }
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)), hh = Math.max(1, Math.round(bmp.height * k));
  const c = document.createElement('canvas'); c.width = w; c.height = hh;
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, hh); ctx.drawImage(bmp, 0, 0, w, hh);
  let q = quality, out = c.toDataURL('image/jpeg', q);
  while (out.length > limit && q > 0.4) { q -= 0.08; out = c.toDataURL('image/jpeg', q); }
  if (out.length > limit) throw new Error('A foto ficou grande demais. Tente de novo mais de perto.');
  return out;
}

export function receiptFlow() {
  openSheet('Nota fiscal por foto', (close) => {
    const body = h('div', { class: 'stack' });
    const camInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true });
    const galInput = h('input', { type: 'file', accept: 'image/*', hidden: true });

    async function start() {
      body.replaceChildren(h('p', { class: 'muted center' }, 'Carregando…'));
      let st = {}; try { st = await GET('/ai/status'); } catch { /* segue */ }
      if (st && st.receipts === false) {
        body.replaceChildren(emptyState('camera', 'Leitura de notas indisponível', 'Para ler notas fiscais por foto, o administrador do app precisa ligar uma IA com visão no servidor (por exemplo GEMINI_API_KEY, que tem plano gratuito). Enquanto isso, registre manualmente.',
          h('button', { class: 'btn', type: 'button', onclick: close }, 'Fechar')));
        return;
      }
      body.replaceChildren(
        h('p', { class: 'muted center' }, 'Fotografe a nota ou o cupom fiscal, bem enquadrado e com boa luz. O Nexo lê os itens e valores e você confere antes de registrar.'),
        h('button', { class: 'btn primary block', type: 'button', onclick: () => camInput.click() }, icon('camera', 18), 'Tirar foto'),
        h('button', { class: 'btn block', type: 'button', onclick: () => galInput.click() }, icon('upload', 18), 'Escolher da galeria'),
        h('p', { class: 'tiny dim center' }, 'A foto é enviada só para a leitura e não fica guardada.'));
    }

    async function onFile(file) {
      if (!file) return;
      const prev = URL.createObjectURL(file);
      body.replaceChildren(h('img', { src: prev, alt: 'Nota fiscal', style: { maxHeight: '220px', objectFit: 'contain', borderRadius: '14px', alignSelf: 'center' } }),
        h('div', { class: 'typing', style: { alignSelf: 'center' } }, h('i'), h('i'), h('i')), h('p', { class: 'muted center' }, 'Lendo a nota…'));
      try {
        const image = await compressImage(file);
        const r = await POST('/ai/receipt', { image });
        URL.revokeObjectURL(prev);
        review(r.receipt);
      } catch (e) {
        URL.revokeObjectURL(prev);
        body.replaceChildren(h('div', { class: 'alert bad' }, errMsg(e)), h('button', { class: 'btn primary block', type: 'button', onclick: start }, 'Tentar de novo'));
      }
    }
    camInput.onchange = () => { const f = camInput.files[0]; camInput.value = ''; onFile(f); };
    galInput.onchange = () => { const f = galInput.files[0]; galInput.value = ''; onFile(f); };

    async function review(rc) {
      if (!rc.readable) {
        body.replaceChildren(emptyState('camera', 'Não consegui ler essa nota', 'Tente de novo com a nota esticada, bem iluminada e ocupando a foto toda.', h('button', { class: 'btn primary', type: 'button', onclick: start }, 'Nova foto')));
        return;
      }
      let L; try { L = await lookups(true); } catch (e) { body.replaceChildren(h('div', { class: 'alert bad' }, errMsg(e))); return; }
      const state = rc.items.map((it) => ({ ...it, on: true }));
      let mode = 'items';
      const store = textInput({ maxLength: 80, value: rc.store || '', placeholder: 'Loja' });
      const date = h('input', { class: 'input', type: 'date', value: rc.date || todayISO(), min: '1990-01-01', max: '2100-12-31' });
      const accSel = h('select', { class: 'select' }, L.accounts.filter((a) => a.type !== 'card' || true).map((a) => h('option', { value: a.id }, a.name + (S.couple ? ` (${scopeLabel(a.scope).toLowerCase()})` : '') + (a.type === 'card' ? ' — cartão' : ''))));
      const firstNonCard = L.accounts.find((a) => a.type !== 'card' && a.scope === 'personal') || L.accounts.find((a) => a.type !== 'card') || L.accounts[0];
      if (firstNonCard) accSel.value = firstNonCard.id;
      const list = h('div', { class: 'stack' });
      const sumEl = h('div', { class: 'row between' });
      const err = formError();
      const sum = () => state.filter((s) => s.on).reduce((a, s) => a + s.amount_cents, 0);
      function paint() {
        list.replaceChildren(...state.map((it, i) => {
          const amt = moneyInput({ cents: it.amount_cents });
          amt.input.addEventListener('input', () => { it.amount_cents = amt.get(); paintSum(); });
          const d = textInput({ maxLength: 120, value: it.description });
          d.addEventListener('input', () => { it.description = d.value; });
          const chk = h('input', { type: 'checkbox', checked: it.on, 'aria-label': 'Incluir item', onchange: () => { it.on = chk.checked; row.style.opacity = it.on ? 1 : 0.45; paintSum(); } });
          const row = h('div', { class: 'card pad-sm stack', style: { gap: '6px', opacity: it.on ? 1 : 0.45 } },
            h('div', { class: 'row', style: { gap: '8px' } }, chk, d, h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Remover item', onclick: () => { state.splice(i, 1); paint(); paintSum(); } }, icon('x', 14))),
            h('div', { class: 'row between' }, h('span', { class: 'tiny dim' }, it.category ? `Categoria sugerida: ${it.category}` : 'Sem categoria'), amt.el));
          return row;
        }));
      }
      function paintSum() {
        const s = sum(), t = rc.total_cents;
        sumEl.replaceChildren(h('span', null, mode === 'items' ? 'Soma dos itens' : 'Total a registrar'), h('strong', { class: 'num' }, brl(mode === 'items' ? s : (t || s))));
        note.textContent = t && Math.abs(t - s) > 1 && mode === 'items' ? `O total da nota é ${brl(t)}, mas os itens somam ${brl(s)}. Confira os valores (descontos podem causar a diferença).` : '';
        note.classList.toggle('hidden', !note.textContent);
      }
      const note = h('div', { class: 'hint hidden' });
      const modeSeg = seg([{ v: 'items', l: 'Item por item' }, { v: 'total', l: 'Só o total' }], 'items', (v) => { mode = v; list.classList.toggle('hidden', mode === 'total'); paintSum(); });
      paint(); paintSum();
      const buttons = scopeButtons(async (scope, btn) => {
        await busy(btn, async () => {
          const chosen = L.accounts.find((a) => String(a.id) === accSel.value);
          const accId = chosen && chosen.scope === scope ? chosen.id : undefined;
          const dt = date.value || todayISO();
          const name = store.value.trim();
          let items;
          if (mode === 'items') {
            items = state.filter((s) => s.on && s.amount_cents > 0 && s.description.trim()).map((s) => ({ type: 'expense', description: (s.description.trim()).slice(0, 120), amount_cents: s.amount_cents, date: dt, category: s.category }));
            if (!items.length) throw new Error('Marque ao menos um item com valor.');
          } else {
            const t = rc.total_cents || sum(); if (!t) throw new Error('Não há valor para registrar.');
            const cats = [...new Set(state.map((s) => s.category).filter(Boolean))];
            items = [{ type: 'expense', description: (name || 'Compra').slice(0, 120), amount_cents: t, date: dt, category: cats.length === 1 ? cats[0] : null }];
          }
          const r = await bulkCreate({ scope, items, accountId: accId, source: 'nota', resolveHints: false });
          toast(`${r.created} despesa${r.created > 1 ? 's' : ''} registrada${r.created > 1 ? 's' : ''} em ${scopeLabel(scope)}`);
          close();
        }, err);
      }, { label: 'Registrar despesas' });
      body.replaceChildren(
        h('div', { class: 'row', style: { gap: '8px' } }, iconBadge('receipt', '#ffb454'), h('div', null, h('div', { style: { fontWeight: 700 } }, 'Confira a leitura'), h('div', { class: 'tiny dim' }, 'Edite o que precisar antes de registrar.'))),
        field('Loja', store), field('Data da compra', date), field('Pago com', accSel), modeSeg.el, list, note, sumEl, err, buttons);
    }

    start();
    return h('div', { class: 'stack' }, camInput, galInput, body);
  }, { noFocus: true });
}
