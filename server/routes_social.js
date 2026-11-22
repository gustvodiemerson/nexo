// Chat do casal e notificações.
import { q } from './db.js';
import { get, post, del, Raw } from './router.js';
import { v, bad, forbidden, notFound, rateLimit } from './lib.js';
import { pollEvents, audit, emit, notify, coupleMemberIds, getOwned, canRead } from './core.js';
import { brl, goalsWithProgress } from './calc.js';
import { todayISO } from './lib.js';

// ---------- notificações ----------
get('/api/notifications', async (req) => {
  const limit = Math.min(Number(req.query.limit) || 40, 100);
  const rows = await q.all('SELECT id,type,title,body,link,read_at,created_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT ?', req.user.id, limit);
  const unread = (await q.get('SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND read_at IS NULL', req.user.id)).n;
  return { notifications: rows, unread };
});
post('/api/notifications/read', async (req) => {
  if (req.body.id) await q.run("UPDATE notifications SET read_at=datetime('now') WHERE id=? AND user_id=? AND read_at IS NULL", Number(req.body.id), req.user.id);
  else await q.run("UPDATE notifications SET read_at=datetime('now') WHERE user_id=? AND read_at IS NULL", req.user.id);
  return { ok: true };
});
del('/api/notifications', async (req) => { await q.run('DELETE FROM notifications WHERE user_id=? AND read_at IS NOT NULL', req.user.id); return { ok: true }; });

// ---------- chat ----------
const mapMsg = (m) => ({ id: m.id, user_id: m.user_id, user_name: m.user_name, user_avatar: m.user_avatar, body: m.body, attachment: m.attachment ? JSON.parse(m.attachment) : null, created_at: m.created_at });
const MSG_SELECT = 'SELECT m.*, u.name AS user_name, u.avatar AS user_avatar FROM chat_messages m JOIN users u ON u.id=m.user_id';

function requireCouple(ctx) { if (!ctx.coupleId) throw bad('O chat está disponível quando você faz parte de um casal.'); }

get('/api/chat', async (req) => {
  const ctx = req.ctx; requireCouple(ctx);
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  let rows;
  if (req.query.after) rows = await q.all(`${MSG_SELECT} WHERE m.couple_id=? AND m.id>? ORDER BY m.id LIMIT ?`, ctx.coupleId, Number(req.query.after), limit);
  else if (req.query.before) rows = (await q.all(`${MSG_SELECT} WHERE m.couple_id=? AND m.id<? ORDER BY m.id DESC LIMIT ?`, ctx.coupleId, Number(req.query.before), limit)).reverse();
  else rows = (await q.all(`${MSG_SELECT} WHERE m.couple_id=? ORDER BY m.id DESC LIMIT ?`, ctx.coupleId, limit)).reverse();
  const partner = await q.get('SELECT u.id, u.name, u.avatar FROM couple_members m JOIN users u ON u.id=m.user_id WHERE m.couple_id=? AND u.id<>?', ctx.coupleId, ctx.userId) || null;
  const partnerRead = partner ? ((await q.get('SELECT last_read_id FROM chat_reads WHERE couple_id=? AND user_id=?', ctx.coupleId, partner.id))?.last_read_id || 0) : 0;
  return { messages: rows.map(mapMsg), partner, partner_last_read_id: partnerRead };
});

const IMG_RE = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/;
get('/api/chat/images/:id', async (req) => {
  const ctx = req.ctx; requireCouple(ctx);
  const r = await q.get('SELECT mime, data FROM chat_images WHERE id=? AND couple_id=?', Number(req.params.id), ctx.coupleId);
  if (!r) throw notFound();
  return new Raw(Buffer.from(r.data, 'base64'), r.mime, { 'Cache-Control': 'private, max-age=31536000, immutable' });
});

post('/api/chat', async (req) => {
  const ctx = req.ctx; requireCouple(ctx);
  await rateLimit('chat:' + ctx.userId, 60, 60_000);
  const clientId = req.body.client_id ? String(req.body.client_id).slice(0, 64) : null;
  if (clientId) { // reenvio do mesmo envio (rede ruim/offline): devolve a mensagem já criada, sem duplicar
    const dup = await q.get(`${MSG_SELECT} WHERE m.user_id=? AND m.client_id=?`, ctx.userId, clientId);
    if (dup) return { message: mapMsg(dup), duplicate: true };
  }
  let body = v.str(req.body.body, { field: 'mensagem', max: 2000, required: !req.body.attachment }) || '';
  let attachment = null;
  const at = req.body.attachment;
  if (at) {
    const kind = v.oneOf(at.kind, ['transaction', 'goal', 'image'], { field: 'anexo' });
    if (kind === 'image') {
      const m = IMG_RE.exec(String(at.data || ''));
      if (!m || m[2].length > 1_800_000) throw bad('Foto inválida ou grande demais.', 'attachment');
      const id = Number((await q.run('INSERT INTO chat_images(couple_id,user_id,mime,data) VALUES (?,?,?,?)', ctx.coupleId, ctx.userId, 'image/' + m[1], m[2])).lastInsertRowid);
      attachment = { kind, id };
    } else if (kind === 'transaction') {
      const t = await getOwned('transactions', at.id, ctx);
      attachment = { kind, id: t.id, title: t.description, type: t.type, amount_cents: t.amount_cents, date: t.date, scope: t.scope };
    } else {
      const g = await getOwned('goals', at.id, ctx);
      const prog = (await goalsWithProgress(ctx, g.scope, todayISO())).find((x) => x.id === g.id);
      attachment = { kind, id: g.id, title: g.name, target_cents: g.target_cents, current_cents: prog.current_cents, pct: prog.pct, deadline: g.deadline };
    }
  }
  if (!body && !attachment) throw bad('Escreva uma mensagem.', 'body');
  const id = Number((await q.run('INSERT INTO chat_messages(couple_id,user_id,body,attachment,client_id) VALUES (?,?,?,?,?)', ctx.coupleId, ctx.userId, body, attachment ? JSON.stringify(attachment) : null, clientId)).lastInsertRowid);
  const [, row, members] = await Promise.all([
    q.run('INSERT INTO chat_reads(couple_id,user_id,last_read_id) VALUES (?,?,?) ON CONFLICT(couple_id,user_id) DO UPDATE SET last_read_id=excluded.last_read_id', ctx.coupleId, ctx.userId, id),
    q.get(`${MSG_SELECT} WHERE m.id=?`, id),
    coupleMemberIds(ctx.coupleId),
  ]);
  const msg = mapMsg(row);
  await emit(members, 'chat', { message: msg });
  await Promise.all([
    ...members.filter((x) => x !== ctx.userId).map(async (uid) => {
      const lastRead = (await q.get('SELECT last_read_id FROM chat_reads WHERE couple_id=? AND user_id=?', ctx.coupleId, uid))?.last_read_id || 0;
      await notify(uid, { type: 'chat', title: `${req.user.name} enviou ${attachment?.kind === 'image' && !body ? 'uma foto' : 'uma mensagem'}`, body: (body || (attachment?.kind === 'image' ? '📷 Foto' : 'Compartilhou um item')).slice(0, 120), link: '#/chat', dedupe: `chat:${ctx.coupleId}:${lastRead}` });
    }),
    audit(ctx, 'chat.send', 'chat', id, { attachment: attachment?.kind || null }, 'couple'),
  ]);
  req.status = 201;
  return { message: msg };
});

post('/api/chat/read', async (req) => {
  const ctx = req.ctx; requireCouple(ctx);
  const max = (await q.get('SELECT IFNULL(MAX(id),0) AS m FROM chat_messages WHERE couple_id=?', ctx.coupleId)).m;
  await q.run('INSERT INTO chat_reads(couple_id,user_id,last_read_id) VALUES (?,?,?) ON CONFLICT(couple_id,user_id) DO UPDATE SET last_read_id=excluded.last_read_id', ctx.coupleId, ctx.userId, max);
  await q.run("UPDATE notifications SET read_at=datetime('now') WHERE user_id=? AND type='chat' AND read_at IS NULL", ctx.userId);
  await emit(await coupleMemberIds(ctx.coupleId), 'chat_read', { user_id: ctx.userId, last_read_id: max });
  return { ok: true, last_read_id: max };
});

del('/api/chat/:id', async (req) => {
  const ctx = req.ctx; requireCouple(ctx);
  const m = await q.get('SELECT * FROM chat_messages WHERE id=? AND couple_id=?', Number(req.params.id), ctx.coupleId);
  if (!m) throw notFound();
  if (m.user_id !== ctx.userId) throw forbidden('Você só pode apagar as próprias mensagens.');
  await q.run('DELETE FROM chat_messages WHERE id=?', m.id);
  try { const at = m.attachment ? JSON.parse(m.attachment) : null; if (at?.kind === 'image') await q.run('DELETE FROM chat_images WHERE id=? AND couple_id=?', at.id, ctx.coupleId); } catch { /* ignora */ }
  await emit(await coupleMemberIds(ctx.coupleId), 'chat_delete', { id: m.id });
  return { ok: true };
});

// ---------- eventos (substitui o SSE: o app consulta periodicamente) ----------
get('/api/events/poll', async (req) => pollEvents(req.user.id, req.query.after === undefined ? null : Number(req.query.after) || 0));
