// Conexão com bancos (Pluggy / Open Finance, somente leitura) e ajuste de saldo das contas.
import { q, tx } from './db.js';
import { get, post, del } from './router.js';
import { v, bad, notFound, HttpError } from './lib.js';
import { getOwned, accountBalances, audit, emitChange, coupleMemberIds } from './core.js';
import { moveAccount } from './routes_finance.js';
import { timingSafeEqual, randomBytes } from 'node:crypto';
import * as pluggy from './pluggy.js';
import { syncBankAccount, calibrate, balanceCheck, syncBanks } from './bank.js';

const ITEM_RE = /^[0-9a-fA-F-]{20,64}$/;
const itemId = (s) => { const t = String(s || '').trim(); if (!ITEM_RE.test(t)) throw bad('Item ID inválido. Copie o código completo no app demo do Pluggy.', 'item_id'); return t.toLowerCase(); };

async function ownedBankAccount(ctx, id) {
  const ba = await q.get('SELECT * FROM bank_accounts WHERE id=? AND user_id=?', Number(id), ctx.userId);
  if (!ba) throw notFound();
  return ba;
}

get('/api/bank', async (req) => {
  const ctx = req.ctx;
  const links = await q.all('SELECT id, connector, status, last_sync_at, last_error, created_at FROM bank_links WHERE user_id=? ORDER BY id', ctx.userId);
  const accs = await q.all(
    `SELECT ba.*, a.name AS account_name, a.scope AS account_scope FROM bank_accounts ba LEFT JOIN accounts a ON a.id=ba.account_id WHERE ba.user_id=? ORDER BY ba.id`, ctx.userId);
  const bal = await accountBalances(accs.map((a) => a.account_id).filter(Boolean));
  return {
    configured: pluggy.configured(),
    links: links.map((l) => ({
      ...l,
      accounts: accs.filter((a) => a.link_id === l.id).map((a) => {
        const nexo = a.account_id ? bal.get(a.account_id) ?? 0 : null;
        return {
          id: a.id, name: a.name, kind: a.kind, account_id: a.account_id, account_name: a.account_name, account_scope: a.account_scope, bank_balance_cents: a.bank_balance_cents, balance_at: a.balance_at,
          nexo_balance_cents: nexo, diff_cents: a.kind === 'card' || a.bank_balance_cents == null || nexo == null ? null : a.bank_balance_cents - nexo, synced_to: a.synced_to,
        };
      }),
    })),
  };
});

// Passo 1: valida o Item ID no Pluggy e mostra as contas encontradas + contas do NEXO que podem receber os lançamentos.
post('/api/bank/preview', async (req) => {
  const ctx = req.ctx;
  const id = itemId(req.body.item_id);
  if (await q.get('SELECT 1 AS x FROM bank_links WHERE item_id=?', id)) throw new HttpError(409, 'Este banco já está conectado.');
  const item = await pluggy.getItem(id);
  const accounts = (await pluggy.listAccounts(id)).map((a) => ({
    pluggy_id: String(a.id), name: String(a.name || a.marketingName || 'Conta').slice(0, 60), kind: pluggy.kindOf(a), balance_cents: pluggy.cents(a.balance),
  }));
  const mine = await q.all("SELECT id, name, type FROM accounts WHERE user_id=? AND archived=0 ORDER BY id", ctx.userId);
  return { connector: item?.connector?.name || 'Banco', status: item?.status || null, accounts, my_accounts: mine };
});

// Passo 2: cria o vínculo. mappings: { [pluggy_id]: id de conta pessoal existente | null (criar nova) | 'skip' }
post('/api/bank/links', async (req) => {
  const ctx = req.ctx;
  const id = itemId(req.body.item_id);
  if (await q.get('SELECT 1 AS x FROM bank_links WHERE item_id=?', id)) throw new HttpError(409, 'Este banco já está conectado.');
  const item = await pluggy.getItem(id);
  const connector = String(item?.connector?.name || 'Banco').slice(0, 40);
  const remote = await pluggy.listAccounts(id);
  if (!remote.length) throw bad('Nenhuma conta encontrada neste Item ID.');
  const wantScope = req.body.scope === 'personal' ? 'personal' : (ctx.coupleId && ctx.canEditCouple ? 'couple' : 'personal'); // padrão: Casal, para o parceiro(a) ver tudo
  const maps = req.body.mappings && typeof req.body.mappings === 'object' ? req.body.mappings : {};
  const used = new Set();
  const out = await tx(async () => {
    const linkId = Number((await q.run('INSERT INTO bank_links(user_id,item_id,connector,status) VALUES (?,?,?,?)', ctx.userId, id, connector, item?.status || null)).lastInsertRowid);
    const created = [];
    for (const a of remote) {
      const pid = String(a.id), kind = pluggy.kindOf(a);
      const choice = maps[pid];
      if (choice === 'skip') continue;
      const name = String(a.name || a.marketingName || 'Conta').slice(0, 60);
      let accountId;
      if (choice !== undefined && choice !== null && choice !== '') {
        const acc = await getOwned('accounts', choice, ctx, { write: true });
        if (acc.user_id !== ctx.userId) throw bad('Escolha uma conta criada por você.');
        if ((acc.type === 'card') !== (kind === 'card')) throw bad(kind === 'card' ? 'Um cartão do banco precisa ir para uma conta do tipo cartão.' : 'Uma conta do banco não pode ser ligada a um cartão.');
        if (used.has(acc.id)) throw bad('Duas contas do banco não podem usar a mesma conta do NEXO.');
        accountId = acc.id;
      } else {
        const label = `${connector} • ${name}`.slice(0, 40);
        const accRow = await q.run(
          'INSERT INTO accounts(scope,user_id,couple_id,name,type,initial_cents,color) VALUES (?,?,?,?,?,?,?)',
          wantScope, ctx.userId, wantScope === 'couple' ? ctx.coupleId : null, label, kind, 0, kind === 'card' ? '#ff5d8f' : '#4cc9f0');
        accountId = Number(accRow.lastInsertRowid);
      }
      used.add(accountId);
      await q.run(
        'INSERT INTO bank_accounts(link_id,user_id,pluggy_account_id,name,kind,bank_balance_cents,balance_at,account_id) VALUES (?,?,?,?,?,?,datetime(\'now\'),?)',
        linkId, ctx.userId, pid, name, kind, pluggy.cents(a.balance), accountId);
      created.push(pid);
    }
    if (!created.length) throw bad('Selecione ao menos uma conta para importar.');
    return linkId;
  });
  await audit(ctx, 'bank.link', 'bank_link', out, { connector }, wantScope);
  await emitChange(ctx, 'personal', 'accounts');
  if (wantScope === 'couple') await emitChange(ctx, 'couple', 'accounts');
  req.status = 201;
  const accounts = await q.all('SELECT id, name, kind FROM bank_accounts WHERE link_id=? ORDER BY id', out);
  return { link_id: out, accounts };
});

// Importa lançamentos de uma conta (a tela chama uma conta por vez para cada chamada ser curta).
post('/api/bank/accounts/:id/sync', async (req) => {
  const ba = await ownedBankAccount(req.ctx, req.params.id);
  return await syncBankAccount(req.ctx, ba);
});

// Chamada ao abrir/voltar ao app: pede atualização e importa o que houver de novo (rápida, com limite de tempo).
post('/api/bank/auto-sync', async (req) => await syncBanks({ userId: req.ctx.userId, budgetMs: 7000, minAgeMs: 90_000 }));

// Pede ao Pluggy para buscar dados novos no banco (antes de importar).
post('/api/bank/links/:id/refresh', async (req) => {
  const l = await q.get('SELECT * FROM bank_links WHERE id=? AND user_id=?', Number(req.params.id), req.ctx.userId);
  if (!l) throw notFound();
  const r = await pluggy.refreshItem(l.item_id);
  if (r.status) await q.run('UPDATE bank_links SET status=? WHERE id=?', String(r.status).slice(0, 40), l.id);
  return r;
});

// Faz o saldo no NEXO igualar o saldo do banco.
post('/api/bank/accounts/:id/calibrate', async (req) => {
  const ba = await ownedBankAccount(req.ctx, req.params.id);
  if (ba.kind === 'card') throw bad('Cartões não têm ajuste de saldo.');
  const delta = await calibrate(ba);
  await audit(req.ctx, 'bank.calibrate', 'bank_account', ba.id, { delta_cents: delta }, 'personal');
  await emitChange(req.ctx, 'personal', 'accounts');
  return { delta_cents: delta, ...(await balanceCheck(ba)) };
});

// Desconecta o banco. Com ?purge=1 também apaga os lançamentos importados e as contas que ficarem vazias.
del('/api/bank/links/:id', async (req) => {
  const l = await q.get('SELECT * FROM bank_links WHERE id=? AND user_id=?', Number(req.params.id), req.ctx.userId);
  if (!l) throw notFound();
  const purge = req.query.purge === '1';
  const ids = (await q.all('SELECT account_id FROM bank_accounts WHERE link_id=? AND account_id IS NOT NULL', l.id)).map((r) => r.account_id);
  let removed = 0, accounts = 0;
  await tx(async () => {
    if (purge) for (const id of ids) removed += (await q.run('DELETE FROM transactions WHERE account_id=? AND external_id IS NOT NULL', id)).changes || 0;
    await q.run('DELETE FROM bank_links WHERE id=?', l.id);
  });
  if (purge) for (const id of ids) { // remove a conta só se não sobrou nada ligado a ela
    try { await tx(async () => { await q.run('DELETE FROM accounts WHERE id=?', id); }); accounts++; } catch { /* tem lançamentos manuais: mantém */ }
  }
  await audit(req.ctx, 'bank.unlink', 'bank_link', l.id, { connector: l.connector, purge, removed }, 'personal');
  await emitChange(req.ctx, 'personal', 'accounts');
  await emitChange(req.ctx, 'couple', 'accounts');
  return { ok: true, removed, accounts };
});

// Compartilha com o casal todas as contas ligadas a bancos (as que já foram importadas como pessoais).
post('/api/bank/share-all', async (req) => {
  const ctx = req.ctx;
  const rows = await q.all(`SELECT DISTINCT a.id, a.name FROM bank_accounts ba JOIN accounts a ON a.id=ba.account_id WHERE ba.user_id=? AND a.scope='personal'`, ctx.userId);
  let moved = 0; const failed = [];
  for (const r of rows) {
    try { await moveAccount(ctx, r.id, 'couple'); moved++; } catch (e) { failed.push(`${r.name}: ${e.message}`); }
  }
  return { moved, failed };
});

// Aviso instantâneo do Pluggy (webhook): cadastre a URL em Pluggy → Aplicação → Webhooks. O token na URL impede chamadas de terceiros.
async function webhookToken() {
  let r = await q.get("SELECT value FROM app_settings WHERE key='bank_webhook'");
  if (!r) { await q.run("INSERT OR IGNORE INTO app_settings(key,value) VALUES ('bank_webhook', ?)", randomBytes(24).toString('hex')); r = await q.get("SELECT value FROM app_settings WHERE key='bank_webhook'"); }
  return r.value;
}
post('/api/bank/webhook', async (req) => {
  const tok = Buffer.from(String(req.query.token || '')), real = Buffer.from(await webhookToken());
  if (tok.length !== real.length || !timingSafeEqual(tok, real)) throw new HttpError(403, 'Token inválido.');
  const item = String(req.body?.itemId || req.body?.item?.id || '').toLowerCase();
  const ev = String(req.body?.event || '');
  if (item && /^(item\/|transactions\/)/.test(ev) && !/error|login/.test(ev)) {
    const run = syncBanks({ itemId: item, budgetMs: 8000, minAgeMs: 0, refresh: false }).catch((e) => console.error('[webhook]', e.message));
    const defer = globalThis.__nexoWaitUntil;
    if (typeof defer === 'function') defer(run); else await run;
  }
  return { ok: true };
}, { auth: false });
get('/api/bank/webhook-url', async (req) => ({ url: `${req.url.origin}/api/bank/webhook?token=${await webhookToken()}` }));

// Ajuste manual: informa o saldo real e o app recalcula o saldo inicial (contas que não usam banco conectado).
post('/api/accounts/:id/adjust-balance', async (req) => {
  const ctx = req.ctx;
  const acc = await getOwned('accounts', req.params.id, ctx, { write: true });
  if (acc.type === 'card') throw bad('Para cartões, ajuste o valor da fatura pelos lançamentos.');
  const target = v.int(req.body.balance_cents, { field: 'saldo', min: -100_000_000_000_00, max: 100_000_000_000_00 });
  const cur = (await accountBalances([acc.id])).get(acc.id) ?? 0;
  const delta = target - cur;
  if (delta) await q.run('UPDATE accounts SET initial_cents = initial_cents + ? WHERE id=?', delta, acc.id);
  await audit(ctx, 'account.adjust', 'account', acc.id, { delta_cents: delta, balance_cents: target }, acc.scope);
  await emitChange(ctx, acc.scope, 'accounts');
  return { delta_cents: delta, balance_cents: target };
});
