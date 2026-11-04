// Chat do casal e notificações.
import { q } from './db.js';
import { get, post, del } from './router.js';
import { v, bad, forbidden, notFound, rateLimit } from './lib.js';
import { audit, emit, notify, coupleMemberIds, getOwned, canRead } from './core.js';
import { brl, goalsWithProgress } from './calc.js';
import { todayISO } from './lib.js';

// ---------- notificações ----------
get('/api/notifications', (req) => {
  const limit = Math.min(Number(req.query.limit) || 40, 100);
  const rows = q.all('SELECT id,type,title,body,link,read_at,created_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT ?', req.user.id, limit);
  const unread = q.get('SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND read_at IS NULL', req.user.id).n;
  return { notifications: rows, unread };
});
post('/api/notifications/read', (req) => {
  if (req.body.id) q.run("UPDATE notifications SET read_at=datetime('now') WHERE id=? AND user_id=? AND read_at IS NULL", Number(req.body.id), req.user.id);
  else q.run("UPDATE notifications SET read_at=datetime('now') WHERE user_id=? AND read_at IS NULL", req.user.id);
  return { ok: true };
});
del('/api/notifications', (req) => { q.run('DELETE FROM notifications WHERE user_id=? AND read_at IS NOT NULL', req.user.id); return { ok: true }; });

// ---------- chat ----------
const mapMsg = (m) => ({ id: m.id, user_id: m.user_id, user_name: m.user_name, user_avatar: m.user_avatar, body: m.body, attachment: m.attachment ? JSON.parse(m.attachment) : null, created_at: m.created_at });
const MSG_SELECT = 'SELECT m.*, u.name AS user_name, u.avatar AS user_avatar FROM chat_messages m JOIN users u ON u.id=m.user_id';

function requireCouple(ctx) { if (!ctx.coupleId) throw bad('O chat está disponível quando você faz parte de um casal.'); }

get('/api/chat', (req) => {
  const ctx = req.ctx; requireCouple(ctx);
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  let rows;
  if (req.query.after) rows = q.all(`${MSG_SELECT} WHERE m.couple_id=? AND m.id>? ORDER BY m.id LIMIT ?`, ctx.coupleId, Number(req.query.after), limit);
  else if (req.query.before) rows = q.all(`${MSG_SELECT} WHERE m.couple_id=? AND m.id<? ORDER BY m.id DESC LIMIT ?`, ctx.coupleId, Number(req.query.before), limit).reverse();
  else rows = q.all(`${MSG_SELECT} WHERE m.couple_id=? ORDER BY m.id DESC LIMIT ?`, ctx.coupleId, limit).reverse();
  const partner = q.get('SELECT u.id, u.name, u.avatar FROM couple_members m JOIN users u ON u.id=m.user_id WHERE m.couple_id=? AND u.id<>?', ctx.coupleId, ctx.userId) || null;
  const partnerRead = partner ? (q.get('SELECT last_read_id FROM chat_reads WHERE couple_id=? AND user_id=?', ctx.coupleId, partner.id)?.last_read_id || 0) : 0;
  return { messages: rows.map(mapMsg), partner, partner_last_read_id: partnerRead };
});

post('/api/chat', (req) => {
  const ctx = req.ctx; requireCouple(ctx);
  rateLimit('chat:' + ctx.userId, 60, 60_000);
  let body = v.str(req.body.body, { field: 'mensagem', max: 2000, required: !req.body.attachment }) || '';
  let attachment = null;
  const at = req.body.attachment;
  if (at) {
    const kind = v.oneOf(at.kind, ['transaction', 'goal'], { field: 'anexo' });
    if (kind === 'transaction') {
      const t = getOwned('transactions', at.id, ctx);
      attachment = { kind, id: t.id, title: t.description, type: t.type, amount_cents: t.amount_cents, date: t.date, scope: t.scope };
    } else {
      const g = getOwned('goals', at.id, ctx);
      const prog = goalsWithProgress(ctx, g.scope, todayISO()).find((x) => x.id === g.id);
      attachment = { kind, id: g.id, title: g.name, target_cents: g.target_cents, current_cents: prog.current_cents, pct: prog.pct, deadline: g.deadline };
    }
  }
  if (!body && !attachment) throw bad('Escreva uma mensagem.', 'body');
  const id = Number(q.run('INSERT INTO chat_messages(couple_id,user_id,body,attachment) VALUES (?,?,?,?)', ctx.coupleId, ctx.userId, body, attachment ? JSON.stringify(attachment) : null).lastInsertRowid);
  q.run('INSERT INTO chat_reads(couple_id,user_id,last_read_id) VALUES (?,?,?) ON CONFLICT(couple_id,user_id) DO UPDATE SET last_read_id=excluded.last_read_id', ctx.coupleId, ctx.userId, id);
  const msg = mapMsg(q.get(`${MSG_SELECT} WHERE m.id=?`, id));
  const members = coupleMemberIds(ctx.coupleId);
  emit(members, 'chat', { message: msg });
  for (const uid of members.filter((x) => x !== ctx.userId)) {
    const lastRead = q.get('SELECT last_read_id FROM chat_reads WHERE couple_id=? AND user_id=?', ctx.coupleId, uid)?.last_read_id || 0;
    notify(uid, { type: 'chat', title: `${req.user.name} enviou uma mensagem`, body: (body || 'Compartilhou um item').slice(0, 120), link: '#/chat', dedupe: `chat:${ctx.coupleId}:${lastRead}` });
  }
  audit(ctx, 'chat.send', 'chat', id, { attachment: attachment?.kind || null }, 'couple');
  req.status = 201;
  return { message: msg };
});

post('/api/chat/read', (req) => {
  const ctx = req.ctx; requireCouple(ctx);
  const max = q.get('SELECT IFNULL(MAX(id),0) AS m FROM chat_messages WHERE couple_id=?', ctx.coupleId).m;
  q.run('INSERT INTO chat_reads(couple_id,user_id,last_read_id) VALUES (?,?,?) ON CONFLICT(couple_id,user_id) DO UPDATE SET last_read_id=excluded.last_read_id', ctx.coupleId, ctx.userId, max);
  q.run("UPDATE notifications SET read_at=datetime('now') WHERE user_id=? AND type='chat' AND read_at IS NULL", ctx.userId);
  emit(coupleMemberIds(ctx.coupleId), 'chat_read', { user_id: ctx.userId, last_read_id: max });
  return { ok: true, last_read_id: max };
});

del('/api/chat/:id', (req) => {
  const ctx = req.ctx; requireCouple(ctx);
  const m = q.get('SELECT * FROM chat_messages WHERE id=? AND couple_id=?', Number(req.params.id), ctx.coupleId);
  if (!m) throw notFound();
  if (m.user_id !== ctx.userId) throw forbidden('Você só pode apagar as próprias mensagens.');
  q.run('DELETE FROM chat_messages WHERE id=?', m.id);
  emit(coupleMemberIds(ctx.coupleId), 'chat_delete', { id: m.id });
  return { ok: true };
});
