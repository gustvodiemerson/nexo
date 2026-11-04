// Menu "Mais", casal, perfil, segurança e categorias.
import {
  h, icon, S, GET, POST, PATCH, DEL, qs, bus, toast, errMsg, busy, formError, field, textInput, select, seg, switchEl, iconBadge, avatar, emptyState, openSheet, confirmDialog, pageHead, backHead,
  sectionTitle, passwordField, pickImage, copyText, setSession, firstName, money, fmtDate, fmtDateTime, monthNav, todayISO, canEditCouple, brandEl, lookups,
} from '../ui.js';
import { swatches } from './money.js';

// ================= MAIS =================
export async function maisView() {
  const item = (href, ic, label, color, sub) => h('a', { class: 'card clickable', href, style: { color: 'inherit' } }, h('div', { class: 'row' }, iconBadge(ic, color), h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 } }, label), sub ? h('div', { class: 'small muted' }, sub) : null)));
  const root = h('div', { class: 'view' }, pageHead('Mais', 'Tudo do NEXO'),
    h('a', { class: 'card glow row', href: '#/perfil', style: { color: 'inherit' } }, avatar(S.me, 56), h('div', { class: 'grow', style: { minWidth: 0 } }, h('div', { style: { fontWeight: 650, fontSize: '17px' } }, S.me.name), h('div', { class: 'small muted ellipsis' }, S.me.email), S.couple ? h('div', { class: 'small', style: { color: 'var(--pink)' } }, `Casal: ${S.couple.name}`) : null), icon('chevron', 18)),
    h('div', { class: 'menu-grid' },
      item('#/casal', 'couple', 'Casal', '#ff3d9a', S.couple ? S.couple.name : 'Criar ou entrar'), item('#/cofre', 'vault', 'Cofre', '#ffc857'), item('#/metas', 'target', 'Metas', '#b38cff'), item('#/relatorios', 'chart', 'Relatórios', '#38d5ff'),
      item('#/planejamento', 'calendar', 'Planejamento', '#ff9f4a'), item('#/contas', 'bank', 'Contas e cartões', '#3b82ff'), item('#/chat', 'chat', 'Chat do casal', '#ff3d9a'), item('#/ia', 'brain', 'Assistente de IA', '#2ee59d'),
      item('#/categorias', 'tag', 'Categorias', '#7aa2ff'), item('#/notificacoes', 'bell', 'Notificações', '#ffc857'), item('#/seguranca', 'shield', 'Segurança', '#2ee59d'), item('#/perfil', 'user', 'Perfil', '#9aa7ff')));
  const inst = h('div');
  const paint = () => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    inst.replaceChildren(standalone ? null : h('div', { class: 'card stack' }, h('div', { class: 'card-title' }, icon('smartphone', 18), 'Instalar o NEXO no celular'),
      S.installPrompt ? h('button', { class: 'btn primary block', type: 'button', onclick: async () => { S.installPrompt.prompt(); try { await S.installPrompt.userChoice; } catch { /* ignore */ } S.installPrompt = null; paint(); } }, icon('download', 18), 'Instalar aplicativo')
        : h('p', { class: 'install-hint' }, /iphone|ipad|ipod/i.test(navigator.userAgent) ? 'No iPhone: toque em Compartilhar e depois em “Adicionar à Tela de Início”.' : 'No Android/Chrome: abra o menu ⋮ e toque em “Instalar aplicativo” ou “Adicionar à tela inicial”.')));
  };
  paint();
  root.append(inst, h('button', { class: 'btn danger-ghost block', type: 'button', onclick: () => window.nexoLogout() }, icon('logout', 18), 'Sair da conta'), h('p', { class: 'tiny dim center' }, 'NEXO • Juntos, mais longe.'));
  const off = bus.on('install', paint); root._dispose = off;
  return root;
}

// ================= CASAL =================
function inviteSheet(inv) {
  openSheet('Convidar parceiro(a)', (close) => h('div', { class: 'stack' },
    h('p', { class: 'muted' }, 'Envie o link ou o código. Vale por 7 dias e só pode ser usado por uma pessoa.'),
    h('div', { class: 'copybox' }, h('span', null, inv.code), h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Copiar código', onclick: () => copyText(inv.code) }, icon('copy', 16))),
    h('div', { class: 'row' }, h('button', { class: 'btn grow', type: 'button', onclick: () => copyText(inv.link) }, icon('link', 18), 'Copiar link'),
      navigator.share ? h('button', { class: 'btn primary grow', type: 'button', onclick: () => navigator.share({ title: 'NEXO', text: `Vem organizar as finanças comigo no NEXO! Código: ${inv.code}`, url: inv.link }).catch(() => {}) }, icon('share', 18), 'Compartilhar') : null)));
}

export async function casalView() {
  const root = h('div', { class: 'view' });
  if (!S.couple) {
    const name = textInput({ placeholder: 'Ex.: Digu & Mary', maxLength: 60 });
    const err = formError(); const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Criar casal');
    const code = textInput({ placeholder: 'Código do convite', maxLength: 20, style: { textTransform: 'uppercase', letterSpacing: '.12em' } });
    const err2 = formError(); const btn2 = h('button', { class: 'btn block', type: 'submit' }, 'Entrar com o código');
    root.append(pageHead('Casal', 'Finanças juntos, privacidade preservada'),
      h('div', { class: 'card glow' }, h('form', { class: 'stack', novalidate: true, onsubmit: (e) => { e.preventDefault(); busy(btn, async () => { const r = await POST('/couple', { name: name.value }); setSession({ user: S.me, couple: r.couple }); toast('Casal criado! Agora convide seu parceiro(a) 💜'); }, err); } },
        h('div', { class: 'card-title' }, icon('heart', 18), 'Criar um casal'), h('p', { class: 'small muted' }, 'Você cria o casal e convida a outra pessoa. O que é “pessoal” continua só seu.'), field('Nome do casal', name), err, btn)),
      h('div', { class: 'card' }, h('form', { class: 'stack', novalidate: true, onsubmit: (e) => { e.preventDefault(); busy(btn2, async () => { const r = await POST('/couple/join', { code: code.value }); sessionStorage.removeItem('nexo.invite'); setSession({ user: S.me, couple: r.couple }); toast('Bem-vindos ao casal! 💜'); location.hash = '#/'; }, err2); } },
        h('div', { class: 'card-title' }, icon('key', 18), 'Recebeu um convite?'), field('Código', code), err2, btn2)));
    return root;
  }
  const c = S.couple, owner = c.role === 'owner', me = c.members.find((m) => m.me), partner = c.members.find((m) => !m.me);
  const cover = h('div', { class: 'cover-edit hero-cover' }); if (c.cover) cover.style.backgroundImage = `url("${c.cover}")`;
  if (owner) cover.append(h('button', { class: 'btn sm', type: 'button', onclick: async () => { try { const img = await pickImage({ max: 900, limit: 440000 }); if (!img) return; const r = await PATCH('/couple', { name: c.name, cover: img }); setSession({ user: S.me, couple: r.couple }); toast('Foto atualizada'); } catch (e) { toast(errMsg(e), 'err'); } } }, icon('upload', 15), 'Trocar foto'));
  root.append(pageHead('Casal', c.name, owner ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Renomear', onclick: () => openSheet('Nome do casal', (close) => { const n = textInput({ value: c.name, maxLength: 60 }); const er = formError(); const b = h('button', { class: 'btn primary block', type: 'submit' }, 'Salvar'); return h('form', { class: 'stack', onsubmit: (e) => { e.preventDefault(); busy(b, async () => { const r = await PATCH('/couple', { name: n.value }); setSession({ user: S.me, couple: r.couple }); close(); }, er); } }, field('Nome', n), er, b); }) }, icon('edit', 18)) : null), cover);
  root.append(sectionTitle('Participantes'), h('div', { class: 'card pad-sm' }, h('div', { class: 'list' }, c.members.map((m) => h('div', { class: 'list-item' }, avatar(m, 46),
    h('div', { class: 'li-main' }, h('div', { class: 'li-title' }, m.name, m.me ? ' (você)' : ''), h('div', { class: 'li-sub' }, `${m.role === 'owner' ? 'Criou o casal' : 'Participante'} • ${m.can_edit ? 'Pode editar' : 'Somente leitura'}`)),
    owner && !m.me ? h('div', { class: 'li-end' }, h('div', { class: 'li-sub' }, 'Pode editar'), switchEl(m.can_edit, async (on) => { try { const r = await PATCH('/couple/members/' + m.id, { can_edit: on }); setSession({ user: S.me, couple: r.couple }); } catch (e) { toast(errMsg(e), 'err'); } }, 'Permitir edição')) : null)))));
  if (!partner && owner) {
    root.append(h('div', { class: 'card glow stack' }, h('div', { class: 'card-title' }, icon('heart', 18), 'Convide seu parceiro(a)'), h('p', { class: 'small muted' }, 'Gere um link ou código de convite. Você pode revogá-lo a qualquer momento.'),
      h('button', { class: 'btn primary block', type: 'button', onclick: async (e) => { await busy(e.currentTarget, async () => { const r = await POST('/couple/invites'); const m = await GET('/auth/me'); S.couple = m.couple; inviteSheet(r.invite); bus.emit('change'); }); } }, icon('link', 18), 'Gerar convite')),
      c.invites.length ? h('div', { class: 'card pad-sm' }, h('div', { class: 'list' }, c.invites.map((i) => h('div', { class: 'list-item' }, iconBadge('key', '#ffc857'), h('div', { class: 'li-main' }, h('div', { class: 'li-title num' }, i.code), h('div', { class: 'li-sub' }, `Expira em ${fmtDate(i.expires_at)}`)),
        h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Copiar código', onclick: () => copyText(i.code) }, icon('copy', 15)), h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Revogar convite', onclick: async () => { try { await DEL('/couple/invites/' + i.id); toast('Convite revogado'); const m = await GET('/auth/me'); setSession(m); } catch (e) { toast(errMsg(e), 'err'); } } }, icon('x', 15)))))) : null);
  }
  root.append(h('div', { class: 'card stack' }, h('div', { class: 'card-title' }, icon('lock', 18), 'Privacidade'),
    h('div', { class: 'row between' }, h('div', null, h('div', { style: { fontWeight: 600 } }, 'Mostrar meu total pessoal ao parceiro'), h('div', { class: 'small muted' }, 'Só o saldo somado das suas contas pessoais. Lançamentos e contas continuam privados.')),
      switchEl(me.share_personal_total, async (on) => { try { const r = await PATCH('/couple/me', { share_personal_total: on }); setSession({ user: S.me, couple: r.couple }); } catch (e) { toast(errMsg(e), 'err'); } }, 'Compartilhar total pessoal')),
    h('p', { class: 'small dim' }, 'Itens marcados como “Casal” são vistos pelos dois; itens “Pessoal” são vistos somente por quem os criou.')));
  // visão do mês
  try {
    const o = await GET('/couple/overview'); const tot = o.members.reduce((x, m) => x + m.expense_cents, 0);
    root.append(sectionTitle('Neste mês, no casal'), h('div', { class: 'card pad-sm' }, h('div', { class: 'list' }, o.members.map((m) => h('div', { class: 'list-item' }, avatar(m, 40), h('div', { class: 'li-main' }, h('div', { class: 'li-title' }, firstName(m.name)), h('div', { class: 'li-sub' }, `Receitas ${money(m.income_cents)} • Despesas ${money(m.expense_cents)}`)),
      h('div', { class: 'li-end' }, m.personal_total_cents !== null ? money(m.personal_total_cents) : h('span', { class: 'badge' }, icon('lock', 11), 'privado')))))), tot ? null : null);
  } catch { /* opcional */ }
  root.append(h('button', { class: 'btn danger-ghost block', type: 'button', onclick: async () => {
    if (!(await confirmDialog({ title: 'Sair do casal?', text: partner ? 'Os dados compartilhados continuarão com seu parceiro(a). Seus dados pessoais ficam com você.' : 'Como não há outro participante, o casal e seus dados compartilhados serão apagados.', confirm: 'Sair do casal', danger: true }))) return;
    try { await POST('/couple/leave', { confirm: true }); setSession({ user: S.me, couple: null }); toast('Você saiu do casal'); } catch (e) { toast(errMsg(e), 'err'); } } }, icon('logout', 18), 'Sair do casal'));
  return root;
}

// ================= PERFIL =================
export async function perfilView() {
  const name = textInput({ value: S.me.name, maxLength: 60 });
  const err = formError(); const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Salvar alterações');
  const av = h('div', { class: 'center' }, avatar(S.me, 96));
  const form = h('form', { class: 'stack', novalidate: true, onsubmit: (e) => { e.preventDefault(); busy(btn, async () => { const r = await PATCH('/profile', { name: name.value }); setSession(r); toast('Perfil atualizado'); }, err); } },
    field('Nome', name), field('E-mail', h('input', { class: 'input', value: S.me.email, disabled: true })), err, btn);
  return h('div', { class: 'view' }, backHead('Perfil', 'Seus dados'), av,
    h('div', { class: 'row', style: { justifyContent: 'center' } },
      h('button', { class: 'btn sm', type: 'button', onclick: async () => { try { const img = await pickImage({ max: 320, limit: 250000 }); if (!img) return; setSession(await PATCH('/profile', { name: S.me.name, avatar: img })); toast('Foto atualizada'); } catch (e) { toast(errMsg(e), 'err'); } } }, icon('upload', 15), 'Trocar foto'),
      S.me.avatar ? h('button', { class: 'btn sm danger-ghost', type: 'button', onclick: async () => { try { setSession(await PATCH('/profile', { name: S.me.name, avatar: null })); } catch (e) { toast(errMsg(e), 'err'); } } }, 'Remover') : null),
    h('div', { class: 'card' }, form));
}

// ================= SEGURANÇA =================
export async function segurancaView() {
  const { sessions } = await GET('/profile/sessions');
  const cur = passwordField('Senha atual', { autocomplete: 'current-password' }), n1 = passwordField('Nova senha', { autocomplete: 'new-password', placeholder: 'Mínimo de 8, com letras e números' }), n2 = passwordField('Confirmar nova senha', { autocomplete: 'new-password' });
  const err = formError(); const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Alterar senha');
  const pw = h('form', { class: 'stack', novalidate: true, onsubmit: (e) => { e.preventDefault(); busy(btn, async () => {
    if (n1.input.value !== n2.input.value) throw new Error('As senhas não coincidem.');
    await POST('/profile/password', { current: cur.input.value, password: n1.input.value }); cur.input.value = n1.input.value = n2.input.value = ''; toast('Senha alterada. Outros dispositivos foram desconectados.'); bus.emit('change'); }, err); } }, cur.el, n1.el, n2.el, err, btn);
  const dev = (ua) => (/iphone|ipad/i.test(ua) ? 'iPhone/iPad' : /android/i.test(ua) ? 'Android' : /windows/i.test(ua) ? 'Windows' : /mac/i.test(ua) ? 'Mac' : /linux/i.test(ua) ? 'Linux' : 'Dispositivo') + (/chrome|crios/i.test(ua) ? ' • Chrome' : /safari/i.test(ua) ? ' • Safari' : /firefox/i.test(ua) ? ' • Firefox' : '');
  const root = h('div', { class: 'view' }, backHead('Segurança', 'Senha e sessões'), h('div', { class: 'card glow' }, h('div', { class: 'card-title', style: { marginBottom: '10px' } }, icon('key', 18), 'Alterar senha'), pw),
    sectionTitle('Dispositivos conectados'), h('div', { class: 'card pad-sm' }, h('div', { class: 'list' }, sessions.map((s) => h('div', { class: 'list-item' }, iconBadge('smartphone', s.current ? '#2ee59d' : '#7aa2ff'),
      h('div', { class: 'li-main' }, h('div', { class: 'li-title' }, dev(s.user_agent || ''), s.current ? h('span', { class: 'badge ok', style: { marginLeft: '6px' } }, 'este aparelho') : null), h('div', { class: 'li-sub' }, `Último uso ${fmtDateTime(s.last_seen_at)} • IP ${s.ip || '—'}`)),
      !s.current ? h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Desconectar', onclick: async () => { try { await DEL('/profile/sessions/' + s.id); bus.emit('change'); } catch (e) { toast(errMsg(e), 'err'); } } }, icon('x', 15)) : null)))),
    sessions.length > 1 ? h('button', { class: 'btn block', type: 'button', onclick: async () => { try { await DEL('/profile/sessions'); toast('Outros dispositivos desconectados'); bus.emit('change'); } catch (e) { toast(errMsg(e), 'err'); } } }, icon('logout', 18), 'Desconectar todos os outros') : null,
    h('div', { class: 'card stack' }, h('div', { class: 'card-title neg' }, icon('alert', 18), 'Excluir conta'), h('p', { class: 'small muted' }, 'Apaga seus dados pessoais definitivamente. Se você estiver em um casal, os dados compartilhados permanecem com seu parceiro(a). Esta ação não pode ser desfeita.'),
      h('button', { class: 'btn danger-ghost block', type: 'button', onclick: () => openSheet('Excluir conta', (close) => {
        const p = passwordField('Confirme sua senha', {}); const er = formError(); const b = h('button', { class: 'btn danger block', type: 'submit' }, 'Excluir minha conta definitivamente');
        return h('form', { class: 'stack', onsubmit: (e) => { e.preventDefault(); busy(b, async () => { await POST('/profile/delete', { password: p.input.value }); close(); setSession(null); toast('Conta excluída.'); }, er); } }, p.el, er, b); }) }, icon('trash', 18), 'Excluir minha conta')));
  return root;
}

// ================= CATEGORIAS =================
const CAT_ICONS = ['home', 'cart', 'car', 'heart', 'ticket', 'book', 'bag', 'repeat', 'paw', 'gift', 'receipt', 'dots', 'briefcase', 'laptop', 'trend', 'undo', 'plane', 'star', 'coins', 'card', 'bank', 'tag', 'smartphone', 'moon'];
let catScope = 'personal', catKind = 'expense';
function categoryForm(cat, parent, scope, kind) {
  openSheet(cat ? 'Editar categoria' : parent ? `Subcategoria de ${parent.name}` : 'Nova categoria', (close) => {
    const name = textInput({ value: cat?.name || '', maxLength: 40, placeholder: 'Ex.: Academia' });
    let ic = cat?.icon || 'tag'; const sw = swatches(cat?.color || '#7aa2ff');
    const pick = h('div', { class: 'icon-pick' }); const paint = () => [...pick.children].forEach((b) => b.classList.toggle('on', b.dataset.i === ic));
    CAT_ICONS.forEach((n) => pick.append(h('button', { type: 'button', dataset: { i: n }, 'aria-label': n, onclick: () => { ic = n; paint(); } }, icon(n, 22)))); paint();
    const err = formError(); const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Salvar');
    return h('form', { class: 'stack', novalidate: true, onsubmit: (e) => { e.preventDefault(); busy(btn, async () => {
      if (cat) await PATCH('/categories/' + cat.id, { name: name.value, icon: ic, color: sw.get() });
      else await POST('/categories', { name: name.value, scope, kind, parent_id: parent?.id, icon: ic, color: sw.get() });
      toast('Categoria salva'); bus.emit('change'); close(); }, err); } },
      field('Nome', name), !(parent || cat?.parent_id) && field('Ícone', pick), !(parent || cat?.parent_id) && field('Cor', sw.el), err, btn);
  });
}
export async function categoriasView() {
  if (!S.couple) catScope = 'personal';
  const r = await GET('/categories' + qs({ scope: catScope, kind: catKind }));
  const writable = catScope === 'personal' || canEditCouple();
  const root = h('div', { class: 'view' }, backHead('Categorias', 'Organize seus lançamentos', writable ? h('button', { class: 'btn primary sm', type: 'button', onclick: () => categoryForm(null, null, catScope, catKind) }, icon('plus', 16), 'Nova') : null),
    S.couple ? seg([{ v: 'personal', l: 'Pessoais' }, { v: 'couple', l: 'Do casal' }], catScope, (v) => { catScope = v; bus.emit('scope-refresh'); }).el : null,
    seg([{ v: 'expense', l: 'Despesas' }, { v: 'income', l: 'Receitas' }], catKind, (v) => { catKind = v; bus.emit('scope-refresh'); }, catKind).el);
  if (!r.categories.length) root.append(emptyState('tag', 'Sem categorias', 'Crie categorias para classificar seus lançamentos.'));
  for (const c of r.categories) root.append(h('div', { class: 'card pad-sm' }, h('div', { class: 'list' },
    h('div', { class: 'list-item' }, iconBadge(c.icon, c.color), h('div', { class: 'li-main' }, h('div', { class: 'li-title' }, c.name), h('div', { class: 'li-sub' }, `${c.children.length} subcategoria(s)`)),
      writable ? h('div', { class: 'row' }, kind('plus', 'Adicionar subcategoria', () => categoryForm(null, c, catScope, catKind)), kind('edit', 'Editar', () => categoryForm(c, null, catScope, catKind)), kind('trash', 'Excluir', () => delCat(c))) : null),
    c.children.map((k) => h('div', { class: 'list-item', style: { paddingLeft: '28px', minHeight: '48px' } }, h('span', { class: 'dim' }, '↳'), h('div', { class: 'li-main' }, h('div', { class: 'li-title', style: { fontWeight: 500 } }, k.name)),
      writable ? h('div', { class: 'row' }, kind('edit', 'Editar', () => categoryForm(k, null, catScope, catKind)), kind('trash', 'Excluir', () => delCat(k))) : null)))));
  return root;
}
const kind = (ic, label, fn) => h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': label, onclick: fn }, icon(ic, 15));
async function delCat(c) {
  if (!(await confirmDialog({ title: `Excluir “${c.name}”?`, text: 'Os lançamentos dessa categoria ficam “sem categoria”. Subcategorias também são removidas.', confirm: 'Excluir', danger: true }))) return;
  try { await DEL('/categories/' + c.id); toast('Categoria excluída'); bus.emit('change'); } catch (e) { toast(errMsg(e), 'err'); }
}
