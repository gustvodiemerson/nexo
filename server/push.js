// Notificações push (Web Push / VAPID). As chaves do servidor são geradas uma vez e guardadas no banco (ou vêm de VAPID_* no ambiente).
import webpush from 'web-push';
import { q } from './db.js';

export const GROUPS = { chat: 'chat', due: 'bills', recurring: 'bills', goal: 'goals', vault: 'goals', budget: 'budget', couple: 'couple', activity: 'couple', bank: 'bank' };
export const DEFAULT_PREFS = { chat: true, bills: true, goals: true, budget: true, couple: true, bank: true };

let vapid = null;
export async function getVapid() {
  if (vapid) return vapid;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return (vapid = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY });
  }
  let row = await q.get("SELECT value FROM app_settings WHERE key='vapid'");
  if (!row) {
    await q.run("INSERT OR IGNORE INTO app_settings(key,value) VALUES ('vapid', ?)", JSON.stringify(webpush.generateVAPIDKeys()));
    row = await q.get("SELECT value FROM app_settings WHERE key='vapid'");
  }
  return (vapid = JSON.parse(row.value));
}
const subject = () => process.env.VAPID_SUBJECT || (/^https:\/\//.test(process.env.APP_URL || '') ? process.env.APP_URL : 'mailto:nexo@nexo.app');

export async function getPrefs(userId) {
  const r = await q.get('SELECT prefs FROM push_prefs WHERE user_id=?', userId);
  let p = {}; try { p = r ? JSON.parse(r.prefs) : {}; } catch { /* usa padrão */ }
  return { ...DEFAULT_PREFS, ...Object.fromEntries(Object.entries(p).filter(([k, x]) => k in DEFAULT_PREFS && typeof x === 'boolean')) };
}
export async function savePrefs(userId, prefs) {
  const clean = Object.fromEntries(Object.keys(DEFAULT_PREFS).map((k) => [k, typeof prefs?.[k] === 'boolean' ? prefs[k] : true]));
  await q.run('INSERT INTO push_prefs(user_id,prefs) VALUES (?,?) ON CONFLICT (user_id) DO UPDATE SET prefs=EXCLUDED.prefs', userId, JSON.stringify(clean));
  return clean;
}

// Envia para todos os aparelhos do usuário. `force` ignora as preferências (ex.: botão "enviar teste").
export async function sendPush(userId, { type, title, body, link, tag }, { force = false } = {}) {
  try {
    if (!force) { const g = GROUPS[type]; if (g && (await getPrefs(userId))[g] === false) return 0; }
    const subs = await q.all('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id=?', userId);
    if (!subs.length) return 0;
    const keys = await getVapid();
    const payload = JSON.stringify({ title: String(title || 'NEXO').slice(0, 100), body: String(body || '').slice(0, 220), link: link || '#/notificacoes', tag: tag || type || 'nexo' });
    let sent = 0;
    await Promise.allSettled(subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload,
          { TTL: 6 * 3600, urgency: 'high', timeout: 4000, vapidDetails: { subject: subject(), publicKey: keys.publicKey, privateKey: keys.privateKey } });
        sent++;
      } catch (e) {
        if (e?.statusCode === 404 || e?.statusCode === 410) await q.run('DELETE FROM push_subscriptions WHERE id=?', s.id); // aparelho desinstalou/revogou
        else console.error('[push]', e?.statusCode || '', String(e?.body || e?.message || '').slice(0, 120));
      }
    }));
    return sent;
  } catch (e) { console.error('[push] falhou', e.message); return 0; }
}

// Usado pelas rotas: não deixa um provedor lento segurar a resposta por mais de ~3 s.
export function pushSoon(userId, msg) {
  return Promise.race([sendPush(userId, msg), new Promise((r) => setTimeout(() => r(0), 3000))]);
}
