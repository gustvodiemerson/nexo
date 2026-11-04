// Telas públicas: entrar, cadastro, recuperação de senha e convite do casal.
import { h, icon, brandEl, field, textInput, passwordField, busy, formError, POST, GET, setSession, S, toast, errMsg, store, openSheet, skeleton, errorState, emptyState, fmtDate } from '../ui.js';

const shell = (...kids) => h('div', { class: 'auth view' }, brandEl(), ...kids);

export function loginView() {
  const email = textInput({ type: 'email', autocomplete: 'email', inputMode: 'email', placeholder: 'voce@email.com', required: true });
  const pw = passwordField('Senha', { placeholder: 'Sua senha', required: true });
  const err = formError();
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Entrar');
  const form = h('form', { class: 'stack', novalidate: true, onsubmit: (e) => { e.preventDefault(); busy(btn, async () => { setSession(await POST('/auth/login', { email: email.value, password: pw.input.value })); }, err); } },
    field('E-mail', email), pw.el, err, btn,
    h('a', { class: 'link-btn center', href: '#/recuperar' }, 'Esqueci minha senha'));
  return shell(h('h1', null, 'Que bom ter você de volta'), h('div', { class: 'card glow' }, form),
    h('p', { class: 'center muted' }, 'Ainda não tem conta? ', h('a', { class: 'link-btn', href: '#/cadastro' }, 'Criar conta')),
    sessionStorage.getItem('nexo.invite') ? h('div', { class: 'alert info' }, icon('heart', 18), 'Entre ou crie sua conta para aceitar o convite do casal.') : null);
}

export function registerView() {
  const name = textInput({ autocomplete: 'name', placeholder: 'Como devemos te chamar?', required: true, maxLength: 60 });
  const email = textInput({ type: 'email', autocomplete: 'email', inputMode: 'email', placeholder: 'voce@email.com', required: true });
  const pw = passwordField('Senha', { autocomplete: 'new-password', placeholder: 'Mínimo de 8 caracteres, com letras e números' });
  const err = formError();
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Criar minha conta');
  const form = h('form', { class: 'stack', novalidate: true, onsubmit: (e) => { e.preventDefault(); busy(btn, async () => { setSession(await POST('/auth/register', { name: name.value, email: email.value, password: pw.input.value })); }, err); } },
    field('Nome', name), field('E-mail', email), pw.el, err, btn,
    h('p', { class: 'small dim center' }, 'Seus dados financeiros ficam protegidos e isolados: o que é pessoal só você vê.'));
  return shell(h('h1', null, 'Crie sua conta'), h('div', { class: 'card glow' }, form),
    h('p', { class: 'center muted' }, 'Já tem conta? ', h('a', { class: 'link-btn', href: '#/entrar' }, 'Entrar')),
    sessionStorage.getItem('nexo.invite') ? h('div', { class: 'alert info' }, icon('heart', 18), 'Depois de criar a conta, você entra no casal automaticamente.') : null);
}

export function forgotView() {
  const email = textInput({ type: 'email', autocomplete: 'email', inputMode: 'email', placeholder: 'voce@email.com', required: true });
  const err = formError(); const out = h('div');
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Enviar instruções');
  const form = h('form', { class: 'stack', novalidate: true, onsubmit: (e) => {
    e.preventDefault();
    busy(btn, async () => {
      const r = await POST('/auth/forgot', { email: email.value });
      out.replaceChildren(h('div', { class: 'alert good' }, icon('mail', 18), r.message),
        r.dev_link ? h('div', { class: 'alert warn' }, icon('info', 18), h('div', null, 'Servidor sem e-mail configurado (modo desenvolvimento). Use este link: ', h('a', { href: r.dev_link }, 'redefinir senha'))) : null);
    }, err);
  } }, field('E-mail da conta', email), err, btn, out);
  return shell(h('h1', null, 'Recuperar senha'), h('p', { class: 'center muted' }, 'Informe seu e-mail e enviaremos um link para criar uma nova senha.'), h('div', { class: 'card glow' }, form),
    h('p', { class: 'center' }, h('a', { class: 'link-btn', href: '#/entrar' }, 'Voltar para o login')));
}

export function resetView({ token }) {
  const pw = passwordField('Nova senha', { autocomplete: 'new-password', placeholder: 'Mínimo de 8 caracteres, com letras e números' });
  const pw2 = passwordField('Confirmar nova senha', { autocomplete: 'new-password' });
  const err = formError();
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Salvar nova senha');
  const form = h('form', { class: 'stack', novalidate: true, onsubmit: (e) => {
    e.preventDefault();
    busy(btn, async () => {
      if (pw.input.value !== pw2.input.value) throw new Error('As senhas não coincidem.');
      await POST('/auth/reset', { token, password: pw.input.value });
      toast('Senha alterada! Entre com a nova senha.'); location.hash = '#/entrar';
    }, err);
  } }, pw.el, pw2.el, err, btn);
  return shell(h('h1', null, 'Criar nova senha'), h('div', { class: 'card glow' }, form));
}

// Convite do casal (funciona logado ou não).
export async function inviteView({ code }) {
  const clean = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  let inv;
  try { inv = (await GET('/invites/' + clean)).invite; }
  catch (e) { return shell(emptyState('heart', 'Convite indisponível', errMsg(e), h('a', { class: 'btn primary', href: '#/' }, 'Ir para o início'))); }
  const body = h('div', { class: 'card glow stack center' },
    h('div', { class: 'ico lg', style: { '--c': 'var(--pink)', margin: '0 auto' } }, icon('heart', 28)),
    h('h2', null, `${inv.inviter} convidou você`),
    h('p', { class: 'muted' }, `Para fazer parte do casal “${inv.couple_name}” no NEXO e organizar as finanças juntos. O convite vale até ${fmtDate(inv.expires_at)}.`),
    h('p', { class: 'small dim' }, 'Suas contas e lançamentos pessoais continuam privados. Vocês só compartilham o que for marcado como “Casal”.'));
  if (!S.me) {
    sessionStorage.setItem('nexo.invite', clean);
    body.append(h('a', { class: 'btn primary block', href: '#/cadastro' }, 'Criar conta e aceitar'), h('a', { class: 'btn block', href: '#/entrar' }, 'Já tenho conta'));
    return shell(body);
  }
  const err = formError();
  if (S.couple) body.append(h('div', { class: 'alert warn' }, icon('info', 18), 'Você já faz parte de um casal. Saia dele em Casal > Sair do casal para aceitar este convite.'), h('a', { class: 'btn block', href: '#/' }, 'Voltar'));
  else {
    const btn = h('button', { class: 'btn primary block', type: 'button' }, 'Entrar no casal');
    btn.onclick = () => busy(btn, async () => { const r = await POST('/couple/join', { code: clean }); sessionStorage.removeItem('nexo.invite'); S.couple = r.couple; location.hash = '#/'; setSession({ user: S.me, couple: r.couple }); toast('Bem-vindos ao casal! 💜'); }, err);
    body.append(err, btn, h('a', { class: 'btn ghost block', href: '#/' }, 'Agora não'));
  }
  const wrap = h('div', { class: 'view' }, body);
  return wrap;
}
