// Núcleo da interface: DOM, formatação pt-BR, API, estado, componentes reutilizáveis.
import { icon, logoMark } from './icons.js';
export { icon, logoMark };

// ---------- DOM ----------
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'for') el.htmlFor = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k in el && k !== 'list' && k !== 'form' && k !== 'style') { try { el[k] = v; } catch { el.setAttribute(k, v); } }
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, kids);
  return el;
}
export function append(el, kids) {
  for (const k of kids) {
    if (k === null || k === undefined || k === false) continue;
    if (Array.isArray(k)) append(el, k);
    else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const $ = (sel, root = document) => root.querySelector(sel);

// ---------- formatação ----------
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const NUM2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const brl = (c) => BRL.format((c || 0) / 100).replace(/ /g, ' ');
export const num2 = (c) => NUM2.format((c || 0) / 100);
export const money = (c) => (S.hide ? 'R$ ••••' : brl(c));
export const signedMoney = (c, type) => (S.hide ? 'R$ ••••' : (type === 'income' ? '+ ' : type === 'expense' ? '- ' : '') + brl(Math.abs(c)));
export const pct = (x, d = 0) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(d).replace('.', ',')}%`);
export const spct = (x, d = 1) => (x === null || x === undefined ? null : `${x >= 0 ? '+' : '−'}${(Math.abs(x) * 100).toFixed(d).replace('.', ',')}%`);
export const todayISO = () => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()); } catch { return new Date().toISOString().slice(0, 10); } };
export const fmtDate = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
export const addDaysISO = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export function relDate(iso) {
  const t = todayISO();
  if (iso === t) return 'Hoje';
  if (iso === addDaysISO(t, -1)) return 'Ontem';
  if (iso === addDaysISO(t, 1)) return 'Amanhã';
  return iso.slice(8, 10) + '/' + iso.slice(5, 7);
}
const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
export const monthName = (m) => MONTHS[Number(m.slice(5, 7)) - 1];
export const monthLabel = (m) => `${monthName(m)}/${m.slice(0, 4)}`;
export const monthShort = (m) => MONTHS[Number(m.slice(5, 7)) - 1].slice(0, 3).toLowerCase();
export const addMonthsYM = (m, n) => { const t = Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1 + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };
export const monthEndISO = (m) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).toISOString().slice(0, 10);
export const sqlToDate = (s) => new Date(String(s).replace(' ', 'T') + 'Z');
export const fmtTime = (s) => sqlToDate(s).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
export function fmtDateTime(s) { const d = sqlToDate(s); return d.toLocaleDateString('pt-BR') + ' ' + fmtTime(s); }
export function timeAgo(s) {
  const m = Math.round((Date.now() - sqlToDate(s).getTime()) / 60000);
  if (m < 1) return 'agora'; if (m < 60) return `há ${m} min`;
  const hh = Math.round(m / 60); if (hh < 24) return `há ${hh} h`;
  const d = Math.round(hh / 24); return d < 30 ? `há ${d} d` : fmtDate(sqlToDate(s).toISOString());
}
export const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';
export function greeting() {
  const hr = Number(new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo' }).format(new Date())) % 24;
  return hr < 5 ? 'Boa madrugada' : hr < 12 ? 'Bom dia' : hr < 18 ? 'Boa tarde' : 'Boa noite';
}
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

// ---------- armazenamento local (somente preferências de interface) ----------
export const store = {
  get(k, d) { try { const v = localStorage.getItem('nexo.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('nexo.' + k, JSON.stringify(v)); } catch { /* ignore */ } },
  del(k) { try { localStorage.removeItem('nexo.' + k); } catch { /* ignore */ } },
};

// ---------- estado e eventos ----------
export const S = { me: null, couple: null, scope: store.get('scope', 'all'), hide: store.get('hide', false), counters: { notifications: 0, chat: 0 } };
const handlers = new Map();
export const bus = {
  on(ev, fn) { if (!handlers.has(ev)) handlers.set(ev, new Set()); handlers.get(ev).add(fn); return () => handlers.get(ev)?.delete(fn); },
  emit(ev, data) { for (const fn of [...(handlers.get(ev) || [])]) { try { fn(data); } catch (e) { console.error(e); } } },
};
export const hasCouple = () => !!S.couple;
export const canEditCouple = () => !!S.couple && S.couple.can_edit;
export const scopeParam = () => (S.couple ? (S.scope || 'all') : 'personal');
export function setScope(s) { S.scope = s; store.set('scope', s); bus.emit('scope', s); }
export function toggleHide() { S.hide = !S.hide; store.set('hide', S.hide); bus.emit('hide'); }
export const partnerOf = () => (S.couple ? S.couple.members.find((m) => !m.me) || null : null);
export function coupleTitle() {
  if (!S.couple) return firstName(S.me?.name);
  const ms = [...S.couple.members].sort((a, b) => (b.me ? 1 : 0) - (a.me ? 1 : 0));
  return ms.map((m) => firstName(m.name)).join(' & ');
}

// ---------- API ----------
export class ApiError extends Error { constructor(msg, status, field) { super(msg); this.status = status; this.field = field; } }
export async function api(method, path, body) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method, credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch { throw new ApiError('Sem conexão com o servidor. Verifique sua internet e tente de novo.', 0); }
  let data = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('json')) { try { data = await res.json(); } catch { data = null; } }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) bus.emit('unauthorized');
    throw new ApiError((data && data.error) || `Erro ${res.status}`, res.status, data && data.field);
  }
  return data;
}
export const GET = (p) => api('GET', p);
export const POST = (p, b = {}) => api('POST', p, b);
export const PATCH = (p, b = {}) => api('PATCH', p, b);
export const DEL = (p) => api('DELETE', p);
export const qs = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== null && v !== undefined && v !== '') p.set(k, v); const s = p.toString(); return s ? '?' + s : ''; };

let lookupsCache = null;
export async function lookups(force = false) {
  if (!lookupsCache || force) lookupsCache = GET('/lookups?scope=all').catch((e) => { lookupsCache = null; throw e; });
  return lookupsCache;
}
bus.on('change', () => { lookupsCache = null; });

// ---------- toasts ----------
export function toast(msg, type = 'ok') {
  const box = document.getElementById('toasts'); if (!box) return;
  const el = h('div', { class: `toast ${type}`, role: type === 'err' ? 'alert' : 'status' }, icon(type === 'err' ? 'alert' : 'check', 18), h('span', null, msg));
  box.append(el);
  setTimeout(() => { el.classList.add('fade-out'); setTimeout(() => el.remove(), 320); }, type === 'err' ? 5000 : 2600);
}
// Pop-up de aviso no topo da tela (estilo WhatsApp): toque abre, desliza para cima fecha, some sozinho.
const POP_ICON = { chat: 'chat', bank: 'bank', budget: 'alert', goal: 'target', vault: 'vault', couple: 'heart', activity: 'heart', due: 'bell', recurring: 'bell' };
let popEl = null, popKey = '', popAt = 0;
export function popup({ title, body, link, type }) {
  const key = (title || '') + '|' + (body || '');
  if (key === popKey && Date.now() - popAt < 30000) return; // o mesmo aviso chega por dois caminhos (push e consulta periódica)
  popKey = key; popAt = Date.now();
  popEl?.remove();
  let timer;
  const close = () => { clearTimeout(timer); if (!el.isConnected) return; el.classList.add('out'); setTimeout(() => el.remove(), 250); };
  const el = h('div', { class: 'popup', role: 'alert', onclick: () => { close(); if (link && /^#\//.test(link)) location.hash = link; } },
    h('div', { class: 'popup-ic' }, icon(POP_ICON[type] || 'bell', 20)),
    h('div', { class: 'popup-tx' }, h('div', { class: 'popup-ti' }, title || 'NEXO'), body ? h('div', { class: 'popup-bd' }, body) : null),
    h('div', { class: 'popup-now' }, 'agora'));
  let y0 = null;
  el.addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY; }, { passive: true });
  el.addEventListener('touchmove', (e) => { if (y0 !== null && e.touches[0].clientY - y0 < -24) { y0 = null; close(); } }, { passive: true });
  popEl = el; document.body.append(el);
  timer = setTimeout(close, 6500);
  try { navigator.vibrate && navigator.vibrate([90, 50, 90]); } catch { /* ignora */ }
}
export const errMsg = (e) => (e && e.message) || 'Algo deu errado. Tente novamente.';

// ---------- folhas (modais) ----------
const sheets = [];
export function closeAllSheets() { for (const s of [...sheets]) s.close(); }
export function openSheet(title, build, opts = {}) {
  const prevFocus = document.activeElement;
  const overlay = h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  const sheet = h('div', { class: 'sheet' });
  let closed = false;
  const api_ = {
    close(result) {
      if (closed) return; closed = true;
      overlay.remove(); const i = sheets.indexOf(api_); if (i >= 0) sheets.splice(i, 1);
      if (!sheets.length) document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
      try { prevFocus && prevFocus.focus && prevFocus.focus(); } catch { /* ignore */ }
      opts.onClose && opts.onClose(result);
    },
    el: sheet,
  };
  const onKey = (e) => { if (e.key === 'Escape' && sheets[sheets.length - 1] === api_) api_.close(); };
  document.addEventListener('keydown', onKey);
  sheet.append(h('div', { class: 'grab' }), h('h2', null, h('span', null, title), h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Fechar', onclick: () => api_.close() }, icon('x', 18))));
  sheet.append(build(api_.close, api_));
  overlay.append(sheet);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) api_.close(); });
  document.body.append(overlay); document.body.style.overflow = 'hidden';
  sheets.push(api_);
  const f = sheet.querySelector('input:not([type=hidden]):not([type=checkbox]), select, textarea');
  if (f && !opts.noFocus && window.matchMedia('(min-width: 700px)').matches) f.focus();
  return api_;
}
export function confirmDialog({ title = 'Confirmar', text = '', confirm = 'Confirmar', danger = false, extra } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    openSheet(title, (close) => h('div', { class: 'stack' },
      text && h('p', { class: 'muted' }, text), extra || null,
      h('div', { class: 'row', style: { marginTop: '6px' } },
        h('button', { class: 'btn grow', type: 'button', onclick: () => { answered = true; close(); resolve(false); } }, 'Cancelar'),
        h('button', { class: `btn grow ${danger ? 'danger' : 'primary'}`, type: 'button', onclick: () => { answered = true; close(); resolve(true); } }, confirm))),
    { onClose: () => { if (!answered) resolve(false); }, noFocus: true });
  });
}
// Executa uma ação assíncrona com o botão em estado de carregamento; mostra erros no formulário.
export async function busy(btn, fn, errBox) {
  if (btn.classList.contains('busy')) return;
  btn.classList.add('busy'); if (errBox) { errBox.textContent = ''; errBox.classList.add('hidden'); }
  try { return await fn(); }
  catch (e) { if (errBox) { errBox.textContent = errMsg(e); errBox.classList.remove('hidden'); } else toast(errMsg(e), 'err'); }
  finally { btn.classList.remove('busy'); }
}
export const formError = () => h('div', { class: 'alert bad hidden', role: 'alert', 'aria-live': 'assertive' });

// ---------- componentes ----------
let fid = 0;
export function field(label, control, { hint, error } = {}) {
  const id = control.id || (control.id = 'f' + ++fid);
  return h('div', { class: 'field' }, label && h('label', { for: id }, label), control, hint && h('div', { class: 'hint' }, hint), error && h('div', { class: 'err' }, error));
}
export function textInput(props = {}) { return h('input', { class: 'input', type: 'text', autocomplete: 'off', ...props }); }
export function select(options, value, props = {}) {
  const el = h('select', { class: 'select', ...props }, options.map((o) => h('option', { value: o.v, disabled: o.disabled || undefined }, o.l)));
  if (value !== undefined && value !== null) el.value = String(value);
  return el;
}
export function moneyInput({ cents = 0, placeholder = '0,00', label = 'Valor' } = {}) {
  let val = cents | 0;
  const input = h('input', { class: 'input input-money num', inputMode: 'numeric', placeholder, autocomplete: 'off', 'aria-label': label });
  const render = () => { input.value = val ? num2(val) : ''; };
  input.addEventListener('input', () => { const d = input.value.replace(/\D/g, '').slice(0, 12); val = d ? parseInt(d, 10) : 0; render(); });
  render();
  const el = h('div', { class: 'money-wrap' }, h('span', { class: 'cur' }, 'R$'), input);
  return { el, input, get: () => val, set: (c) => { val = c | 0; render(); } };
}
export function seg(options, value, onChange, cls = '') {
  let cur = value;
  const el = h('div', { class: `seg ${cls}`, role: 'tablist' });
  const paint = () => [...el.children].forEach((b, i) => { const on = options[i].v === cur; b.classList.toggle('active', on); b.setAttribute('aria-selected', on); });
  options.forEach((o) => el.append(h('button', { type: 'button', role: 'tab', disabled: o.disabled || undefined, onclick: () => { cur = o.v; paint(); onChange && onChange(cur); } }, o.l)));
  paint();
  return { el, get: () => cur, set: (v) => { cur = v; paint(); onChange && onChange(cur); } };
}
export function switchEl(checked, onchange, label) {
  return h('input', { class: 'switch', type: 'checkbox', checked: !!checked, 'aria-label': label, onchange: (e) => onchange && onchange(e.target.checked) });
}
export const iconBadge = (name, color, cls = '', size = 22) => h('div', { class: `ico ${cls}`, style: { '--c': color || 'var(--blue)' } }, icon(name, size));
export function avatar(user, size = 40) {
  const el = h('div', { class: 'avatar', style: { '--s': size + 'px' }, role: 'img', 'aria-label': user?.name || '' });
  if (user && user.avatar) el.style.backgroundImage = `url("${user.avatar}")`; else el.textContent = (firstName(user?.name)[0] || '?').toUpperCase();
  return el;
}
export const scopeBadge = (scope) => h('span', { class: `badge ${scope === 'couple' ? 'couple' : 'personal'}` }, icon(scope === 'couple' ? 'heart' : 'user', 11), scope === 'couple' ? 'Casal' : 'Pessoal');
export function emptyState(ic, title, text, action) {
  return h('div', { class: 'empty' }, iconBadge(ic, 'var(--violet)', 'lg', 28), h('h3', null, title), text && h('p', null, text), action || null);
}
export const skeleton = (n = 3, hgt = 84) => h('div', { class: 'stack', 'aria-busy': 'true', 'aria-label': 'Carregando' }, Array.from({ length: n }, () => h('div', { class: 'skel', style: { height: hgt + 'px' } })));
export function errorState(e, retry) {
  return h('div', { class: 'empty' }, iconBadge('alert', 'var(--red)', 'lg', 28), h('h3', null, 'Não foi possível carregar'), h('p', null, errMsg(e)),
    retry && h('button', { class: 'btn primary', onclick: retry }, icon('refresh', 18), 'Tentar novamente'));
}
export function scopeSwitch(onchange) {
  if (!S.couple) return null;
  const opts = [['all', 'Tudo'], ['personal', 'Pessoal'], ['couple', 'Casal']];
  const el = h('div', { class: 'scope-switch', role: 'tablist', 'aria-label': 'Ambiente' }, opts.map(([v, l]) => h('button', {
    type: 'button', role: 'tab', class: S.scope === v ? 'active' : '', 'aria-selected': S.scope === v,
    onclick: () => { if (S.scope !== v) { setScope(v); onchange && onchange(v); } },
  }, l)));
  return el;
}
export function monthNav(month, onChange, { max } = {}) {
  const limit = max || todayISO().slice(0, 7);
  return h('div', { class: 'month-nav' },
    h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Mês anterior', onclick: () => onChange(addMonthsYM(month, -1)) }, icon('chevron-left', 18)),
    h('span', { class: 'mn-label' }, icon('calendar', 16), monthLabel(month)),
    h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Próximo mês', disabled: month >= limit && !max, onclick: () => onChange(addMonthsYM(month, 1)) }, icon('chevron', 18)));
}
export function sectionTitle(text, right) { return h('div', { class: 'section-title' }, h('span', null, text), right || null); }
export const linkTo = (hash, label, ic = 'chevron') => h('a', { href: hash }, label, icon(ic, 14));
export function progressBar(p, color, cls = '') { return h('div', { class: `bar ${cls}`, role: 'progressbar', 'aria-valuenow': Math.round(Math.min(1, Math.max(0, p || 0)) * 100), 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('i', { style: { width: `${Math.min(100, Math.max(0, (p || 0) * 100))}%`, ...(color ? { '--c': color } : {}) } })); }
export function pageHead(title, sub, right) { return h('div', { class: 'page-head' }, h('div', null, h('h1', null, title), sub && h('div', { class: 'sub' }, sub)), right || null); }
export function backHead(title, sub, right, back = '#/mais') { return h('div', { class: 'page-head' }, h('div', { class: 'row' }, h('a', { class: 'icon-btn', href: back, 'aria-label': 'Voltar' }, icon('chevron-left', 20)), h('div', null, h('h1', null, title), sub && h('div', { class: 'sub' }, sub))), right || null); }

// Redimensiona imagem escolhida pelo usuário e devolve data URL (jpeg).
export function pickImage({ max = 512, quality = 0.82, limit = 280000 } = {}) {
  return new Promise((resolve, reject) => {
    const inp = h('input', { type: 'file', accept: 'image/*' });
    inp.onchange = () => {
      const f = inp.files && inp.files[0]; if (!f) return resolve(null);
      const url = URL.createObjectURL(f); const img = new Image();
      img.onload = () => {
        let w = img.width, hh = img.height; const k = Math.min(1, max / Math.max(w, hh)); w = Math.round(w * k); hh = Math.round(hh * k);
        const c = document.createElement('canvas'); c.width = w; c.height = hh; c.getContext('2d').drawImage(img, 0, 0, w, hh); URL.revokeObjectURL(url);
        let q = quality, out = c.toDataURL('image/jpeg', q);
        while (out.length > limit && q > 0.35) { q -= 0.1; out = c.toDataURL('image/jpeg', q); }
        out.length > limit ? reject(new Error('Imagem muito grande. Escolha uma menor.')) : resolve(out);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não foi possível ler a imagem.')); };
      img.src = url;
    };
    inp.click();
  });
}

// Texto simples → nós DOM com **negrito**, _itálico_ e listas (sem innerHTML).
export function richText(text) {
  const wrap = h('div', { class: 'rich' });
  const inline = (s) => {
    const out = []; const re = /\*\*(.+?)\*\*|_(.+?)_/g; let last = 0, m;
    while ((m = re.exec(s))) { if (m.index > last) out.push(s.slice(last, m.index)); out.push(m[1] ? h('strong', null, m[1]) : h('em', null, m[2])); last = m.index + m[0].length; }
    if (last < s.length) out.push(s.slice(last)); return out;
  };
  let list = null;
  for (const line of String(text).split('\n')) {
    const li = /^\s*(?:[•\-*]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) { if (!list) { list = h('ul'); wrap.append(list); } list.append(h('li', null, inline(li[1]))); continue; }
    list = null;
    if (line.trim()) wrap.append(h('p', null, inline(line)));
  }
  return wrap;
}
export async function copyText(t) {
  try { await navigator.clipboard.writeText(t); toast('Copiado!'); }
  catch { const ta = h('textarea', { value: t, style: { position: 'fixed', opacity: 0 } }); document.body.append(ta); ta.select(); try { document.execCommand('copy'); toast('Copiado!'); } catch { toast('Não foi possível copiar.', 'err'); } ta.remove(); }
}
export function debounce(fn, ms = 250) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// ---------- sessão e barra superior ----------
export function setSession(p) { S.me = p && p.user ? p.user : null; S.couple = p && p.couple ? p.couple : null; bus.emit('session'); }
export function topActions() {
  const unread = S.counters.notifications;
  return h('div', { class: 'hero-actions' },
    h('a', { class: 'icon-btn', href: '#/notificacoes', 'aria-label': `Notificações${unread ? ` (${unread} novas)` : ''}` }, icon('bell', 20), h('span', { class: `dot ${unread ? '' : 'hidden'}`, 'data-counter': 'notifications' }, unread > 99 ? '99+' : unread)),
    h('a', { href: '#/perfil', 'aria-label': 'Perfil' }, avatar(S.me, 42)));
}
export function brandEl({ tag = true } = {}) {
  return h('div', { class: 'brand' }, logoMark(), h('div', null, h('div', { class: 'wm' }, 'NEX', h('b', null, 'O')), tag && h('span', { class: 'tag' }, 'Juntos, mais longe.')));
}
export function passwordField(label, props = {}) {
  const input = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', ...props });
  input.style.paddingRight = '48px';
  const eye = h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'Mostrar senha', style: { position: 'absolute', right: '8px', top: '7px', border: '0', background: 'none' } }, icon('eye', 18));
  eye.onclick = () => { const show = input.type === 'password'; input.type = show ? 'text' : 'password'; clear(eye).append(icon(show ? 'eye-off' : 'eye', 18)); eye.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha'); };
  const wrap = h('div', { style: { position: 'relative' } }, input, eye);
  wrap.id = input.id = input.id || 'pw' + ++fid;
  return { el: field(label, wrap), input };
}

// Evita que append(null/undefined/false) vire o texto "null" no DOM.
for (const P of [Element.prototype, DocumentFragment.prototype]) {
  const ap = P.append, rc = P.replaceChildren;
  const clean = (a) => a.filter((x) => x !== null && x !== undefined && x !== false);
  P.append = function (...n) { return ap.apply(this, clean(n)); };
  P.replaceChildren = function (...n) { return rc.apply(this, clean(n)); };
}
