// Inscrição do aparelho nas notificações push e preferências de cada tipo de aviso.
import { q } from './db.js';
import { get, post, patch, del } from './router.js';
import { bad } from './lib.js';
import { getVapid, getPrefs, savePrefs, sendPush, DEFAULT_PREFS } from './push.js';

get('/api/push/config', async (req) => {
  const keys = await getVapid();
  const n = (await q.get('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id=?', req.ctx.userId)).n;
  return { publicKey: keys.publicKey, devices: n, prefs: await getPrefs(req.ctx.userId) };
});

post('/api/push/subscribe', async (req) => {
  const sub = req.body?.subscription || {};
  const endpoint = String(sub.endpoint || ''), p256dh = String(sub.keys?.p256dh || ''), auth = String(sub.keys?.auth || '');
  if (!/^https:\/\/.{10,600}$/.test(endpoint) || !p256dh || !auth || p256dh.length > 200 || auth.length > 100) throw bad('Inscrição inválida.');
  const n = (await q.get('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id=? AND endpoint<>?', req.ctx.userId, endpoint)).n;
  if (n >= 8) throw bad('Limite de aparelhos atingido. Desative as notificações em um aparelho antigo.');
  await q.run(
    `INSERT INTO push_subscriptions(user_id,endpoint,p256dh,auth,user_agent) VALUES (?,?,?,?,?)
     ON CONFLICT (endpoint) DO UPDATE SET user_id=EXCLUDED.user_id, p256dh=EXCLUDED.p256dh, auth=EXCLUDED.auth, user_agent=EXCLUDED.user_agent`,
    req.ctx.userId, endpoint, p256dh, auth, String(req.headers['user-agent'] || '').slice(0, 160));
  req.status = 201;
  return { ok: true };
});

post('/api/push/unsubscribe', async (req) => {
  const endpoint = String(req.body?.endpoint || '');
  if (endpoint) await q.run('DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?', req.ctx.userId, endpoint);
  else await q.run('DELETE FROM push_subscriptions WHERE user_id=?', req.ctx.userId);
  return { ok: true };
});

patch('/api/push/prefs', async (req) => {
  const cur = await getPrefs(req.ctx.userId);
  const next = { ...cur };
  for (const k of Object.keys(DEFAULT_PREFS)) if (typeof req.body?.[k] === 'boolean') next[k] = req.body[k];
  return { prefs: await savePrefs(req.ctx.userId, next) };
});

post('/api/push/test', async (req) => {
  const sent = await sendPush(req.ctx.userId, { type: 'test', title: 'NEXO • teste', body: 'Pronto! As notificações estão funcionando neste aparelho. 💜', link: '#/notificacoes' }, { force: true });
  if (!sent) throw bad('Nenhum aparelho recebeu. Ative as notificações neste aparelho e tente de novo.');
  return { sent };
});
