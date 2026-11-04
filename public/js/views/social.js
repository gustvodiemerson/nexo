// Chat do casal, assistente de IA e notificações.
import {
  h, icon, S, GET, POST, DEL, qs, bus, toast, errMsg, busy, openSheet, confirmDialog, emptyState, skeleton, pageHead, backHead, iconBadge, avatar, seg, money, brl, pct, fmtDate, fmtTime, relDate,
  timeAgo, richText, partnerOf, progressBar, firstName, scopeParam, sqlToDate, todayISO,
} from '../ui.js';

// ================= CHAT =================
function attachCard(a) {
  if (a.kind === 'goal') return h('a', { class: 'attach', href: '#/metas', style: { display: 'block', color: 'inherit' } }, h('div', { class: 'row small' }, icon('target', 15), h('strong', null, a.title)), progressBar(a.pct, null, 'grad'), h('div', { class: 'small muted' }, `${money(a.current_cents)} de ${money(a.target_cents)} (${pct(a.pct)})`));
  return h('a', { class: 'attach', href: '#/movimentos', style: { display: 'block', color: 'inherit' } }, h('div', { class: 'row small' }, icon(a.type === 'income' ? 'income' : a.type === 'transfer' ? 'swap' : 'expense', 15), h('strong', null, a.title)),
    h('div', { class: `num ${a.type === 'income' ? 'pos' : a.type === 'expense' ? 'neg' : ''}`, style: { fontWeight: 700 } }, money(a.amount_cents)), h('div', { class: 'small muted' }, `${fmtDate(a.date)} • ${a.scope === 'couple' ? 'Casal' : 'Pessoal'}`));
}

export async function chatView() {
  const root = h('div', { class: 'view' });
  if (!S.couple) { root.append(pageHead('Chat do casal', 'Conversa privada entre vocês dois'), emptyState('chat', 'O chat é para casais', 'Crie ou entre em um casal para conversar e compartilhar movimentações e metas.', h('a', { class: 'btn primary', href: '#/casal' }, 'Configurar casal'))); return root; }
  const data = await GET('/chat' + qs({ limit: 50 }));
  const partner = data.partner || partnerOf();
  let partnerRead = data.partner_last_read_id || 0;
  const ids = new Set(); let firstId = null, lastDay = '';
  const log = h('div', { class: 'chat-log' }, h('div', { class: 'bubble-wrap' }));
  const wrap = log.firstChild;
  const ticks = () => wrap.querySelectorAll('.bubble.me').forEach((b) => { const t = b.querySelector('.tick'); if (t) t.textContent = Number(b.dataset.id) <= partnerRead ? '✓✓' : '✓'; });
  function bubble(m) {
    const me = m.user_id === S.me.id;
    const el = h('div', { class: `bubble ${me ? 'me' : ''}`, dataset: { id: m.id }, onclick: me ? () => del(m) : undefined, title: me ? 'Toque para apagar' : undefined },
      m.body ? h('div', null, m.body) : null, m.attachment ? attachCard(m.attachment) : null,
      h('div', { class: 'meta' }, fmtTime(m.created_at), me ? h('span', { class: 'tick' }, m.id <= partnerRead ? '✓✓' : '✓') : null));
    return el;
  }
  async function del(m) { if (!(await confirmDialog({ title: 'Apagar mensagem?', text: 'Ela some para vocês dois.', confirm: 'Apagar', danger: true }))) return; try { await DEL('/chat/' + m.id); } catch (e) { toast(errMsg(e), 'err'); } }
  function add(m, { prepend = false } = {}) {
    if (ids.has(m.id)) return; ids.add(m.id);
    const day = sqlToDate(m.created_at).toLocaleDateString('en-CA');
    const el = bubble(m);
    if (prepend) { wrap.insertBefore(el, wrap.querySelector('.bubble')); firstId = m.id; return; }
    if (day !== lastDay) { wrap.append(h('div', { class: 'group-date center', style: { textAlign: 'center' } }, day === todayISO() ? 'Hoje' : fmtDate(day))); lastDay = day; }
    wrap.append(el); if (firstId === null) firstId = m.id;
  }
  const bottom = () => { log.scrollTop = log.scrollHeight; };
  const markRead = () => POST('/chat/read').then(() => bus.emit('counters')).catch(() => {});
  if (data.messages.length >= 50) wrap.append(h('button', { class: 'btn sm', type: 'button', style: { alignSelf: 'center' }, onclick: async (e) => {
    try { const r = await GET('/chat' + qs({ before: firstId, limit: 50 })); [...r.messages].reverse().forEach((m) => add(m, { prepend: true })); if (r.messages.length < 50) e.target.remove(); } catch (er) { toast(errMsg(er), 'err'); } } }, 'Carregar anteriores'));
  data.messages.forEach((m) => add(m));
  if (!data.messages.length) wrap.append(h('p', { class: 'muted center', style: { padding: '30px 10px' } }, `Diga olá${partner ? ' para ' + firstName(partner.name) : ''}! 💜 Compartilhe também movimentações e metas por aqui.`));

  const input = h('textarea', { class: 'input', rows: 1, placeholder: 'Mensagem…', maxLength: 2000, 'aria-label': 'Mensagem' });
  input.oninput = () => { input.style.height = 'auto'; input.style.height = Math.min(120, input.scrollHeight) + 'px'; };
  let sending = false;
  async function send(body, attachment) {
    if (sending) return; sending = true;
    try { await POST('/chat', { body, attachment }); input.value = ''; input.style.height = 'auto'; } catch (e) { toast(errMsg(e), 'err'); } finally { sending = false; }
  }
  const form = h('form', { class: 'composer', onsubmit: (e) => { e.preventDefault(); const t = input.value.trim(); if (t) send(t); } },
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Compartilhar movimentação ou meta', onclick: () => shareSheet(send) }, icon('paperclip', 20)), input,
    h('button', { class: 'btn primary', type: 'submit', 'aria-label': 'Enviar' }, icon('send', 20)));
  input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(min-width: 700px)').matches) { e.preventDefault(); form.requestSubmit(); } };

  root.append(h('div', { class: 'row' }, avatar(partner, 44), h('div', { class: 'grow' }, h('h1', { style: { fontSize: '20px' } }, partner ? firstName(partner.name) : 'Seu parceiro(a)'), h('div', { class: 'small muted' }, partner ? 'Chat do casal' : 'Aguardando seu parceiro(a) entrar')), icon('lock', 16)),
    h('div', { class: 'chat-shell' }, log, form));

  const offs = [
    bus.on('chat', ({ message }) => { const near = log.scrollHeight - log.scrollTop - log.clientHeight < 140 || message.user_id === S.me.id; add(message); if (near) bottom(); if (message.user_id !== S.me.id && document.visibilityState === 'visible') markRead(); }),
    bus.on('chat_read', (d) => { if (d.user_id !== S.me.id) { partnerRead = d.last_read_id; ticks(); } }),
    bus.on('chat_delete', ({ id }) => { ids.delete(id); wrap.querySelector(`.bubble[data-id="${id}"]`)?.remove(); }),
  ];
  root._dispose = () => offs.forEach((o) => o());
  setTimeout(bottom, 30); markRead();
  return root;
}

async function shareSheet(send) {
  openSheet('Compartilhar no chat', (close) => {
    const box = h('div', { class: 'stack' }, skeleton(2, 56));
    const tab = seg([{ v: 'tx', l: 'Movimentação' }, { v: 'goal', l: 'Meta' }], 'tx', (v) => draw(v));
    async function draw(v) {
      box.replaceChildren(skeleton(2, 56));
      try {
        if (v === 'tx') {
          const r = await GET('/transactions' + qs({ scope: 'couple', limit: 20 }));
          box.replaceChildren(r.transactions.length ? h('div', { class: 'list' }, r.transactions.map((t) => h('button', { class: 'list-item', type: 'button', onclick: () => { close(); send('', { kind: 'transaction', id: t.id }); } },
            iconBadge(t.type === 'income' ? 'income' : 'expense', t.type === 'income' ? '#2ee59d' : '#ff5c7a'), h('div', { class: 'li-main' }, h('div', { class: 'li-title' }, t.description), h('div', { class: 'li-sub' }, fmtDate(t.date))), h('div', { class: 'li-end' }, money(t.amount_cents))))) : h('p', { class: 'muted center' }, 'Nenhuma movimentação do casal ainda. Para compartilhar uma pessoal, abra-a e use “No chat”.'));
        } else {
          const r = await GET('/goals' + qs({ scope: 'couple' }));
          box.replaceChildren(r.goals.length ? h('div', { class: 'list' }, r.goals.map((g) => h('button', { class: 'list-item', type: 'button', onclick: () => { close(); send('', { kind: 'goal', id: g.id }); } },
            iconBadge('target', '#b38cff'), h('div', { class: 'li-main' }, h('div', { class: 'li-title' }, g.name), h('div', { class: 'li-sub' }, `${pct(g.pct)} de ${money(g.target_cents)}`))))) : h('p', { class: 'muted center' }, 'Nenhuma meta do casal ainda.'));
        }
      } catch (e) { box.replaceChildren(h('p', { class: 'err-text' }, errMsg(e))); }
    }
    draw('tx');
    return h('div', { class: 'stack' }, tab.el, box);
  });
}

// ================= IA =================
const SUGG = ['Como foi meu mês até agora?', 'Onde posso economizar?', 'Consigo cumprir minhas metas?', 'Quais contas vencem em breve?'];
export async function iaView() {
  const status = await GET('/ai/status').catch(() => ({ mode: 'local', active: 'local' }));
  let scope = S.couple ? (S.scope || 'all') : 'personal';
  const root = h('div', { class: 'view' });
  const wrap = h('div', { class: 'bubble-wrap' }); const log = h('div', { class: 'chat-log' }, wrap);
  const draw = async () => {
    wrap.replaceChildren(skeleton(2, 50));
    try {
      const r = await GET('/ai/history' + qs({ scope })); wrap.replaceChildren();
      if (!r.messages.length) wrap.append(h('div', { class: 'bubble' }, richText('Olá! Sou a **IA do Nexo**. Analiso **somente os seus dados reais** (receitas, despesas, metas e investimentos) e não invento valores. Pergunte à vontade.')));
      r.messages.forEach((m) => msg(m.role, m.content));
    } catch (e) { wrap.replaceChildren(h('p', { class: 'err-text' }, errMsg(e))); }
    log.scrollTop = log.scrollHeight;
  };
  function msg(role, text) { const b = h('div', { class: `bubble ${role === 'user' ? 'me' : ''}` }, role === 'user' ? text : richText(text)); wrap.append(b); log.scrollTop = log.scrollHeight; return b; }
  const input = h('textarea', { class: 'input', rows: 1, maxLength: 1000, placeholder: 'Pergunte sobre seus gastos, metas…', 'aria-label': 'Pergunta' });
  let busyFlag = false;
  async function ask(text) {
    text = text.trim(); if (!text || busyFlag) return; busyFlag = true; input.value = '';
    msg('user', text); const typing = h('div', { class: 'bubble' }, h('div', { class: 'typing' }, h('i'), h('i'), h('i'))); wrap.append(typing); log.scrollTop = log.scrollHeight;
    try { const r = await POST('/ai/chat', { scope, message: text }); typing.remove(); msg('assistant', r.reply); } catch (e) { typing.remove(); toast(errMsg(e), 'err'); } finally { busyFlag = false; }
  }
  const form = h('form', { class: 'composer', onsubmit: (e) => { e.preventDefault(); ask(input.value); } }, input, h('button', { class: 'btn primary', type: 'submit', 'aria-label': 'Enviar' }, icon('send', 20)));
  input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } };
  const sc = S.couple ? seg([{ v: 'all', l: 'Tudo' }, { v: 'personal', l: 'Pessoal' }, { v: 'couple', l: 'Casal' }], scope, (v) => { scope = v; draw(); }, 'sm') : null;
  root.append(pageHead('Assistente de IA', status.mode === 'external' ? `Conectado: ${status.active}` : 'Modo local (sem provedor externo configurado)', h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Limpar conversa', onclick: async () => { if (await confirmDialog({ title: 'Limpar conversa?', text: 'O histórico com a IA será apagado.', confirm: 'Limpar', danger: true })) { try { await DEL('/ai/history'); draw(); } catch (e) { toast(errMsg(e), 'err'); } } } }, icon('trash', 18))),
    sc && sc.el, h('div', { class: 'sugg' }, SUGG.map((s) => h('button', { class: 'chip', type: 'button', onclick: () => ask(s) }, s))),
    h('div', { class: 'chat-shell' }, log, form), h('p', { class: 'tiny dim center' }, 'A IA usa apenas dados que você pode ver e não substitui um profissional certificado.'));
  draw();
  return root;
}

// ================= NOTIFICAÇÕES =================
const NOTIF_ICON = { chat: ['chat', '#ff3d9a'], budget: ['alert', '#ffc857'], goal: ['target', '#b38cff'], vault: ['vault', '#ffc857'], couple: ['heart', '#ff3d9a'], bill: ['receipt', '#ffb454'] };
export async function notificacoesView() {
  const r = await GET('/notifications');
  const root = h('div', { class: 'view' }, backHead('Notificações', r.unread ? `${r.unread} nova(s)` : 'Tudo em dia', h('div', { class: 'row' },
    h('button', { class: 'btn sm', type: 'button', onclick: async () => { try { await POST('/notifications/read', {}); bus.emit('change'); } catch (e) { toast(errMsg(e), 'err'); } } }, icon('check', 15), 'Ler todas'),
    h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Limpar lidas', onclick: async () => { try { await DEL('/notifications'); bus.emit('change'); } catch (e) { toast(errMsg(e), 'err'); } } }, icon('trash', 15))), '#/'));
  root.append(r.notifications.length ? h('div', { class: 'card pad-sm' }, h('div', { class: 'list' }, r.notifications.map((n) => {
    const [ic, col] = NOTIF_ICON[n.type] || ['bell', '#3b82ff'];
    return h('button', { class: 'list-item', type: 'button', onclick: async () => { if (!n.read_at) { try { await POST('/notifications/read', { id: n.id }); } catch { /* ignore */ } bus.emit('change'); } if (n.link) location.hash = n.link; } },
      iconBadge(ic, col), h('div', { class: 'li-main' }, h('div', { class: 'li-title', style: { whiteSpace: 'normal', fontWeight: n.read_at ? 500 : 700 } }, n.title), n.body ? h('div', { class: 'li-sub', style: { whiteSpace: 'normal' } }, n.body) : null, h('div', { class: 'tiny dim' }, timeAgo(n.created_at))),
      !n.read_at ? h('span', { class: 'badge', style: { background: 'var(--pink)', color: '#fff', borderColor: 'transparent' } }, 'nova') : null);
  }))) : h('div', { class: 'card' }, emptyState('bell', 'Nenhuma notificação', 'Avisos de orçamento, metas, vencimentos e mensagens do casal aparecem aqui.')));
  return root;
}
