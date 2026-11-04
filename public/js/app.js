// NEXO — casca do aplicativo: roteador, navegação, eventos em tempo real e inicialização.
import {
  h, icon, S, bus, GET, POST, $, clear, toast, errMsg, setSession, closeAllSheets, openSheet, brandEl, topActions, skeleton, errorState, debounce, avatar, iconBadge, store,
} from './ui.js';

// Rotas: carregadas sob demanda. `live` = a tela cuida das próprias atualizações; `public` = acessível sem login; `guest` = só para visitantes.
const load = (file, fn) => () => import(`./views/${file}.js`).then((m) => m[fn]);
const ROUTES = [
  { p: '/entrar', title: 'Entrar', public: true, guest: true, view: load('auth', 'loginView') },
  { p: '/cadastro', title: 'Criar conta', public: true, guest: true, view: load('auth', 'registerView') },
  { p: '/recuperar', title: 'Recuperar senha', public: true, guest: true, view: load('auth', 'forgotView') },
  { p: '/redefinir/:token', title: 'Nova senha', public: true, guest: true, view: load('auth', 'resetView') },
  { p: '/convite/:code', title: 'Convite do casal', public: true, view: load('auth', 'inviteView') },
  { p: '/', title: 'Início', nav: 'home', hero: true, view: load('home', 'homeView') },
  { p: '/movimentos', title: 'Movimentações', nav: 'fin', view: load('money', 'movimentosView') },
  { p: '/contas', title: 'Contas', nav: 'fin', view: load('money', 'contasView') },
  { p: '/planejamento', title: 'Planejamento', nav: 'fin', view: load('money', 'planejamentoView') },
  { p: '/relatorios', title: 'Relatórios', nav: 'fin', view: load('reports', 'relatoriosView') },
  { p: '/investimentos', title: 'Investimentos', nav: 'inv', view: load('save', 'investimentosView') },
  { p: '/investimentos/:id', title: 'Investimento', nav: 'inv', view: load('save', 'investimentoDetalheView') },
  { p: '/cofre', title: 'Cofre', nav: 'more', view: load('save', 'cofreView') },
  { p: '/cofre/:id', title: 'Cofre', nav: 'more', view: load('save', 'cofreDetalheView') },
  { p: '/metas', title: 'Metas', nav: 'more', view: load('save', 'metasView') },
  { p: '/chat', title: 'Chat do casal', nav: 'more', live: true, view: load('social', 'chatView') },
  { p: '/ia', title: 'Assistente de IA', nav: 'more', live: true, view: load('social', 'iaView') },
  { p: '/notificacoes', title: 'Notificações', nav: 'more', view: load('social', 'notificacoesView') },
  { p: '/mais', title: 'Mais', nav: 'more', view: load('settings', 'maisView') },
  { p: '/casal', title: 'Casal', nav: 'more', view: load('settings', 'casalView') },
  { p: '/perfil', title: 'Perfil', nav: 'more', view: load('settings', 'perfilView') },
  { p: '/seguranca', title: 'Segurança', nav: 'more', view: load('settings', 'segurancaView') },
  { p: '/categorias', title: 'Categorias', nav: 'more', view: load('settings', 'categoriasView') },
];
for (const r of ROUTES) { const keys = []; r.re = new RegExp('^' + r.p.replace(/:([a-z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$'); r.keys = keys; }

const parseHash = () => { const raw = location.hash.replace(/^#/, '') || '/'; return { path: raw.split('?')[0] || '/' }; };
function find(path) { for (const r of ROUTES) { const m = r.re.exec(path); if (m) return { route: r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) }; } return null; }

const root = $('#root');
let shell = null, token = 0, current = null, currentRoute = null, currentParams = null, es = null;

// ---------- casca ----------
const NAV = [
  ['/', 'Início', 'home', 'home'], ['/movimentos', 'Movimentações', 'list', 'fin'], ['/contas', 'Contas', 'bank', 'fin'], ['/planejamento', 'Planejamento', 'calendar', 'fin'],
  ['/cofre', 'Cofre', 'vault', 'more'], ['/metas', 'Metas', 'target', 'more'], ['/investimentos', 'Investimentos', 'trend', 'inv'], ['/relatorios', 'Relatórios', 'chart', 'fin'],
  ['/chat', 'Chat do casal', 'chat', 'more', 'chat'], ['/ia', 'Assistente de IA', 'brain', 'more'],
];
function buildShell() {
  const side = h('aside', { class: 'sidebar', 'aria-label': 'Menu principal' }, h('a', { href: '#/', class: 'brand', 'aria-label': 'NEXO — início' }, brandEl().firstChild, h('div', { class: 'wm' }, 'NEX', h('b', null, 'O'))),
    NAV.map(([p, l, ic, , counter]) => h('a', { class: 'navlink', href: '#' + p, dataset: { path: p } }, icon(ic, 20), l, counter ? h('span', { class: 'badge-dot hidden', 'data-counter': counter }) : null)),
    h('div', { class: 'nav-sep' }),
    h('a', { class: 'navlink', href: '#/casal', dataset: { path: '/casal' } }, icon('couple', 20), 'Casal'),
    h('a', { class: 'navlink', href: '#/notificacoes', dataset: { path: '/notificacoes' } }, icon('bell', 20), 'Notificações', h('span', { class: 'badge-dot hidden', 'data-counter': 'notifications' })),
    h('a', { class: 'navlink', href: '#/mais', dataset: { path: '/mais' } }, icon('settings', 20), 'Configurações'));
  const tab = (key, href, label, ic, counter) => h('a', { class: 'tab', href, dataset: { nav: key }, 'aria-label': label }, icon(ic, 24), h('span', null, label), counter ? h('span', { class: 'badge-dot hidden', 'data-counter': counter }) : null);
  const bottom = h('nav', { class: 'bottomnav', 'aria-label': 'Navegação' }, tab('home', '#/', 'Início', 'home'), tab('fin', '#/movimentos', 'Finanças', 'chart'),
    h('button', { class: 'fab', type: 'button', 'aria-label': 'Novo lançamento', onclick: openFab }, icon('plus', 30)), tab('inv', '#/investimentos', 'Investimentos', 'trend'), tab('more', '#/mais', 'Mais', 'grid', 'chat'));
  const topbar = h('header', { class: 'topbar' }, h('a', { href: '#/', 'aria-label': 'Início' }, brandEl({ tag: false })), h('div', { class: 'grow' }), topActions());
  const view = h('div', { id: 'view' });
  const el = h('div', { class: 'app' }, side, h('div', { class: 'content' }, h('main', { class: 'main', id: 'main' }, topbar, view)), bottom);
  return { el, view, topbar, bottom, side };
}

async function openFab() {
  const { txForm } = await import('./views/money.js');
  openSheet('O que você quer registrar?', (close) => h('div', { class: 'stack' },
    h('div', { class: 'grid-2' },
      h('button', { class: 'tile', type: 'button', style: { minHeight: '96px', color: 'var(--text)' }, onclick: () => { close(); txForm({ type: 'expense' }); } }, h('span', { class: 'neg' }, icon('expense', 32)), h('span', { style: { fontWeight: 600 } }, 'Despesa')),
      h('button', { class: 'tile', type: 'button', style: { minHeight: '96px', color: 'var(--text)' }, onclick: () => { close(); txForm({ type: 'income' }); } }, h('span', { class: 'pos' }, icon('income', 32)), h('span', { style: { fontWeight: 600 } }, 'Receita'))),
    h('div', { class: 'grid-2' },
      h('button', { class: 'tile', type: 'button', style: { minHeight: '84px', color: 'var(--text)' }, onclick: () => { close(); txForm({ type: 'transfer' }); } }, h('span', { class: 'blue' }, icon('swap', 28)), h('span', { style: { fontWeight: 600 } }, 'Transferência')),
      h('a', { class: 'tile', href: '#/cofre', style: { minHeight: '84px', color: 'var(--text)' } }, h('span', { class: 'gold' }, icon('vault', 28)), h('span', { style: { fontWeight: 600 } }, 'Guardar no cofre')))), { noFocus: true });
}

function paintCounters() {
  const c = S.counters;
  document.querySelectorAll('[data-counter]').forEach((el) => {
    const n = c[el.dataset.counter] || 0;
    el.textContent = n > 99 ? '99+' : String(n); el.classList.toggle('hidden', !n);
  });
}
bus.on('counters', paintCounters);
async function refreshCounters() { try { S.counters = await GET('/counters'); paintCounters(); } catch { /* silencioso */ } }
async function refreshMe() { try { const me = await GET('/auth/me'); S.me = me.user; S.couple = me.couple; } catch { /* silencioso */ } }

// ---------- roteamento ----------
async function route() {
  closeAllSheets();
  const { path } = parseHash();
  const m = find(path);
  const pend = sessionStorage.getItem('nexo.invite');
  if (S.me && pend && !path.startsWith('/convite') && !S.couple) { location.hash = '#/convite/' + pend; return; }
  if (S.me && pend && S.couple) sessionStorage.removeItem('nexo.invite');
  if (!S.me) {
    if (!m || !m.route.public) { location.hash = '#/entrar'; return; }
    shell = null; document.title = `${m.route.title} — NEXO`; current?._dispose?.(); current = null;
    root.replaceChildren(h('div', { class: 'boot' }, skeleton(1, 120)));
    try { const node = await (await m.route.view())(m.params); root.replaceChildren(node); window.scrollTo(0, 0); } catch (e) { root.replaceChildren(errorState(e, route)); }
    return;
  }
  if (m && m.route.guest) { location.hash = '#/'; return; }
  if (!shell) { shell = buildShell(); root.replaceChildren(shell.el); paintCounters(); }
  if (!m) { currentRoute = null; show({ title: 'Página não encontrada', view: async () => async () => h('div', { class: 'view' }, h('div', { class: 'empty' }, h('h3', null, 'Página não encontrada'), h('a', { class: 'btn primary', href: '#/' }, 'Ir para o início'))) }, {}); return; }
  const nv = path.match(/^\/novo\/(despesa|receita|transferencia)$/);
  if (nv) { location.hash = '#/'; const { txForm } = await import('./views/money.js'); txForm({ type: { despesa: 'expense', receita: 'income', transferencia: 'transfer' }[nv[1]] }); return; }
  show(m.route, m.params);
}
window.addEventListener('hashchange', route);

async function show(r, params, { refresh = false } = {}) {
  const my = ++token;
  currentRoute = r; currentParams = params;
  const host = shell.view;
  document.title = `${r.title} — NEXO`;
  shell.topbar.classList.toggle('hidden', !!r.hero);
  shell.el.classList.toggle('on-hero', !!r.hero);
  shell.el.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === r.nav));
  shell.el.querySelectorAll('.sidebar .navlink').forEach((a) => a.classList.toggle('active', a.dataset.path === (location.hash.replace(/^#/, '').split('?')[0] || '/')));
  if (!refresh) { current?._dispose?.(); current = null; clear(host); host.append(h('div', { class: 'view' }, skeleton(3, 90))); window.scrollTo(0, 0); }
  try {
    const fn = await r.view();
    const node = await fn(params);
    if (my !== token) return;
    const y = window.scrollY;
    current?._dispose?.(); clear(host); host.append(node); current = node;
    if (refresh) window.scrollTo(0, y);
    paintCounters();
  } catch (e) {
    if (my !== token) return;
    if (e && e.status === 401) return;
    clear(host); host.append(h('div', { class: 'view' }, errorState(e, () => show(r, params))));
  }
}

const refreshView = debounce(() => {
  if (!S.me || !shell || !currentRoute || currentRoute.live || currentRoute.public) return;
  const a = document.activeElement;
  if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && shell.view.contains(a)) return; // não interrompe digitação
  show(currentRoute, currentParams, { refresh: true });
}, 250);
for (const ev of ['change', 'scope', 'scope-refresh', 'hide']) bus.on(ev, refreshView);
bus.on('change', () => { refreshCounters(); });

// ---------- tempo real (SSE) ----------
function connectEvents() {
  if (es || typeof EventSource === 'undefined') return;
  es = new EventSource('/api/events');
  const j = (ev) => { try { return JSON.parse(ev.data); } catch { return {}; } };
  es.addEventListener('change', async (ev) => { const d = j(ev); if (d.what === 'couple') { await refreshMe(); } bus.emit('change', d); });
  es.addEventListener('notification', (ev) => {
    const d = j(ev); refreshCounters();
    if (d.type === 'chat' && currentRoute && currentRoute.p === '/chat') return;
    toast(d.title + (d.body ? ` — ${d.body}` : ''));
  });
  es.addEventListener('chat', (ev) => { bus.emit('chat', j(ev)); if (!(currentRoute && currentRoute.p === '/chat')) refreshCounters(); });
  es.addEventListener('chat_read', (ev) => bus.emit('chat_read', j(ev)));
  es.addEventListener('chat_delete', (ev) => bus.emit('chat_delete', j(ev)));
  es.onerror = () => { /* o navegador reconecta sozinho; se a sessão expirou, o próximo fetch cuida */ };
}
function disconnectEvents() { if (es) { es.close(); es = null; } }

// ---------- sessão ----------
bus.on('session', () => {
  closeAllSheets();
  if (S.me) {
    connectEvents(); refreshCounters();
    const p = parseHash().path;
    const pend = sessionStorage.getItem('nexo.invite');
    const target = pend && !S.couple ? '#/convite/' + pend : (find(p)?.route.guest || p === '/' ? '#/' : null);
    if (target && location.hash !== target) { location.hash = target; return; }
    route();
  } else { disconnectEvents(); shell = null; if (!find(parseHash().path)?.route.public) location.hash = '#/entrar'; else route(); }
});
export async function logout() {
  try { await POST('/auth/logout'); } catch { /* ignore */ }
  S.counters = { notifications: 0, chat: 0 };
  setSession(null);
}
window.nexoLogout = logout;
bus.on('unauthorized', () => { if (S.me) { toast('Sua sessão expirou. Entre novamente.', 'err'); setSession(null); } });

// ---------- PWA ----------
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installPrompt = e; bus.emit('install'); });
window.addEventListener('appinstalled', () => { S.installPrompt = null; toast('NEXO instalado!'); bus.emit('install'); });
window.addEventListener('offline', () => toast('Você está offline. Algumas ações não funcionarão.', 'err'));
window.addEventListener('online', () => { toast('Conexão restabelecida.'); bus.emit('change'); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.me) { refreshCounters(); refreshView(); } });
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

// ---------- início ----------
(async function boot() {
  try { const me = await GET('/auth/me'); S.me = me.user; S.couple = me.couple; } catch (e) { S.me = null; if (e && e.status === 0) toast(errMsg(e), 'err'); }
  bus.emit('session');
})();
