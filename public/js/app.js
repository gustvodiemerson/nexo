// NEXO — casca do aplicativo: roteador, navegação, eventos em tempo real e inicialização.
import {
  h, icon, S, bus, GET, POST, $, clear, toast, popup, errMsg, setSession, clearOfflineData, flushOutbox, outboxList, isOffline, closeAllSheets, openSheet, brandEl, topActions, skeleton, errorState, debounce, avatar, iconBadge, store,
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
let shell = null, token = 0, current = null, currentRoute = null, currentParams = null;

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
async function refreshMe() { try { const me = await GET('/auth/me'); S.me = me.user; S.couple = me.couple; try { localStorage.setItem('nexo:me', JSON.stringify(me)); } catch { /* ignora */ } } catch { /* silencioso */ } }

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

// ---------- atualização periódica (polling; a Netlify não mantém conexões abertas) ----------
let pollTimer = null, cursor = null, polling = false;
const jget = (d) => d || {};
function dispatchEvent(ev) {
  const d = jget(ev.data);
  if (ev.type === 'change') { (async () => { if (d.what === 'couple') await refreshMe(); bus.emit('change', d); })(); }
  else if (ev.type === 'notification') {
    refreshCounters();
    if (d.type === 'chat' && currentRoute && currentRoute.p === '/chat') return;
    popup({ title: d.title, body: d.body, link: d.link, type: d.type });
  }
  else if (ev.type === 'chat') { bus.emit('chat', d); if (!(currentRoute && currentRoute.p === '/chat')) refreshCounters(); }
  else if (ev.type === 'chat_read') bus.emit('chat_read', d);
  else if (ev.type === 'chat_delete') bus.emit('chat_delete', d);
}
async function pollTick() {
  pollTimer = null;
  if (!S.me || !polling) return;
  if (!document.hidden && navigator.onLine !== false) {
    try {
      const r = await GET('/events/poll' + (cursor === null ? '' : '?after=' + cursor));
      if (cursor !== null) for (const ev of r.events) dispatchEvent(ev);
      cursor = r.last;
    } catch { /* sessão expirada é tratada pelo próximo fetch */ }
  }
  if (S.me && polling) schedulePoll();
}
function schedulePoll(ms) {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(pollTick, ms ?? (currentRoute && currentRoute.p === '/chat' ? 3000 : 15000));
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.me && cursor !== null) schedulePoll(300); });
function connectEvents() { if (!polling && S.me) { polling = true; cursor = null; schedulePoll(50); } }
function disconnectEvents() { polling = false; clearTimeout(pollTimer); pollTimer = null; cursor = null; }

// ---------- bancos: atualiza ao abrir o app e ao voltar para ele ----------
let lastBank = 0;
async function autoBankSync() {
  if (!S.me || document.hidden || Date.now() - lastBank < 100_000) return;
  lastBank = Date.now();
  try { const r = await POST('/bank/auto-sync'); if (r && r.imported) { toast(`${r.imported} nova(s) movimentação(ões) do banco`); bus.emit('change'); } } catch { /* sem banco ou sem rede: ignora */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') autoBankSync(); });
setInterval(autoBankSync, 120_000); // com o app aberto, confere o banco a cada ~2 min

// ---------- sessão ----------
bus.on('session', () => {
  closeAllSheets();
  if (S.me) {
    connectEvents(); refreshCounters(); setTimeout(autoBankSync, 1500);
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
  try { localStorage.removeItem('nexo:me'); } catch { /* ignora */ }
  clearOfflineData();
  setSession(null);
}
window.nexoLogout = logout;
bus.on('unauthorized', () => { if (S.me) { toast('Sua sessão expirou. Entre novamente.', 'err'); setSession(null); } });

// ---------- PWA ----------
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installPrompt = e; bus.emit('install'); });
window.addEventListener('appinstalled', () => { S.installPrompt = null; toast('NEXO instalado!'); bus.emit('install'); });
window.addEventListener('offline', () => toast('Você está offline. Dá para ver telas já abertas e registrar lançamentos.', 'err'));
window.addEventListener('online', () => { toast('Conexão restabelecida.'); bus.emit('change'); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.me) { refreshCounters(); refreshView(); } });
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.type === 'nexo-push' && S.me) { refreshCounters(); if (!(e.data.type2 === 'chat' && currentRoute && currentRoute.p === '/chat')) popup({ ...e.data, type: e.data.type2 }); } if (e.data && e.data.type === 'nexo-open' && S.me && /^#\//.test(e.data.link || '')) location.hash = e.data.link; });
}

// ---------- início ----------
(async function boot() {
  try { const me = await GET('/auth/me'); S.me = me.user; S.couple = me.couple; try { localStorage.setItem('nexo:me', JSON.stringify(me)); } catch { /* ignora */ } }
  catch (e) {
    S.me = null;
    if (e && e.status === 0) { // sem internet ao abrir: usa os dados do último acesso neste aparelho
      let me = null; try { me = JSON.parse(localStorage.getItem('nexo:me') || 'null'); } catch { /* ignora */ }
      if (me && me.user) { S.me = me.user; S.couple = me.couple; } else toast(errMsg(e), 'err');
    }
  }
  bus.emit('session');
})();

// ---------- faixa "sem internet" e fila de envio ----------
const offBar = document.createElement('div');
offBar.className = 'offline-bar'; offBar.hidden = true; offBar.setAttribute('role', 'status');
document.body.append(offBar);
function drawOffBar() {
  const n = outboxList().length;
  offBar.hidden = !(isOffline() || n);
  offBar.textContent = isOffline() ? `Sem internet — mostrando dados salvos${n ? ` · ${n} lançamento(s) aguardando envio` : ''}` : `Enviando ${n} lançamento(s) salvo(s) offline…`;
}
bus.on('offline', drawOffBar); bus.on('outbox', drawOffBar); bus.on('session', () => { drawOffBar(); if (S.me) flushOutbox(); });
