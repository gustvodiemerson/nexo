// Notificações push: ativar neste aparelho e escolher o que receber.
import { h, icon, GET, POST, PATCH, toast, errMsg, busy } from '../ui.js';

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const b64 = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...r].map((c) => c.charCodeAt(0))); };

export async function pushState() {
  if (!supported()) return { supported: false, enabled: false, permission: 'unsupported' };
  let enabled = false;
  try { const reg = await navigator.serviceWorker.ready; enabled = !!(await reg.pushManager.getSubscription()); } catch { /* ignore */ }
  return { supported: true, enabled, permission: Notification.permission };
}

export async function enablePush() {
  if (!supported()) throw new Error('Este navegador não suporta notificações. No Android, use o Chrome com o app instalado.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('A permissão foi negada. Libere as notificações do NEXO nas configurações do celular (Configurações → Apps → NEXO → Notificações).');
  const reg = await navigator.serviceWorker.ready;
  const cfg = await GET('/push/config');
  let sub = await reg.pushManager.getSubscription();
  if (sub) { try { await sub.unsubscribe(); } catch { /* ignore */ } }
  sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(cfg.publicKey) });
  await POST('/push/subscribe', { subscription: sub.toJSON() });
}

export async function disablePush() {
  try {
    const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription();
    if (sub) { const ep = sub.endpoint; await sub.unsubscribe(); await POST('/push/unsubscribe', { endpoint: ep }); }
  } catch { /* ignore */ }
}

const TYPES = [
  ['chat', 'Mensagens do chat', 'Quando seu parceiro(a) enviar mensagem'],
  ['couple', 'Atividade do casal', 'Lançamentos, convites e mudanças no ambiente do casal'],
  ['bills', 'Contas a pagar', 'Vencimentos, contas vencidas e recorrências'],
  ['goals', 'Metas e cofre', 'Depósitos, metas perto do prazo ou alcançadas'],
  ['budget', 'Orçamentos', 'Quando passar de 80% ou estourar um limite'],
  ['bank', 'Movimentações do banco', 'Pix, compras e entradas que chegarem do banco'],
];

export function pushCard() {
  const box = h('div', { class: 'card stack' }, h('div', { class: 'muted small' }, 'Carregando…'));
  async function paint() {
    const st = await pushState();
    let cfg = null; try { cfg = await GET('/push/config'); } catch { /* ignore */ }
    const kids = [h('div', { class: 'card-title' }, icon('bell', 18), 'Avisos no celular')];
    if (!st.supported) {
      kids.push(h('p', { class: 'muted small' }, 'Este navegador não permite notificações. No Android, instale o NEXO (menu ⋮ → Instalar app) e abra pelo ícone.'));
    } else if (!st.enabled) {
      kids.push(h('p', { class: 'muted small' }, 'Receba na tela do celular, com o app fechado: mensagens do chat, contas a vencer, movimentações do banco e mais — com os valores.'));
      if (st.permission === 'denied') kids.push(h('div', { class: 'alert bad' }, 'As notificações estão bloqueadas. Libere em Configurações do celular → Apps → NEXO (ou Chrome) → Notificações e volte aqui.'));
      const btn = h('button', { class: 'btn primary block', type: 'button' }, icon('bell', 18), 'Ativar notificações neste aparelho');
      btn.onclick = () => busy(btn, async () => { try { await enablePush(); toast('Notificações ativadas'); await paint(); } catch (e) { toast(errMsg(e), 'err'); } });
      kids.push(btn);
    } else {
      kids.push(h('div', { class: 'alert good' }, icon('check', 18), 'Ativadas neste aparelho.'));
      const prefs = cfg ? cfg.prefs : {};
      for (const [k, label, sub] of TYPES) {
        const cb = h('input', { type: 'checkbox', checked: prefs[k] !== false, id: 'pf-' + k });
        cb.onchange = async () => { try { await PATCH('/push/prefs', { [k]: cb.checked }); } catch (e) { toast(errMsg(e), 'err'); cb.checked = !cb.checked; } };
        kids.push(h('label', { class: 'row', for: 'pf-' + k, style: { alignItems: 'center', gap: '12px' } }, cb, h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 } }, label), h('div', { class: 'small muted' }, sub))));
      }
      const test = h('button', { class: 'btn block', type: 'button' }, 'Enviar notificação de teste');
      test.onclick = () => busy(test, async () => { try { await POST('/push/test'); toast('Teste enviado'); } catch (e) { toast(errMsg(e), 'err'); } });
      const off = h('button', { class: 'btn danger-ghost block', type: 'button' }, 'Desativar neste aparelho');
      off.onclick = () => busy(off, async () => { await disablePush(); toast('Notificações desativadas neste aparelho'); await paint(); });
      kids.push(test, off);
    }
    box.replaceChildren(...kids);
  }
  paint();
  return box;
}
