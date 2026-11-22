// Sincronização bancária: importa lançamentos do Pluggy sem duplicar e confere o saldo com o do banco.
import { q, tx } from './db.js';
import { addDays, todayISO } from './lib.js';
import { accountBalances, audit, emitChange, notify } from './core.js';
import * as pluggy from './pluggy.js';
import { brl } from './calc.js';

const BACKFILL_DAYS = () => Math.min(365, Math.max(7, Number(process.env.BANK_BACKFILL_DAYS) || 90));
const OVERLAP_DAYS = 10;

async function categoryIndex(acc, userId) {
  const rows = acc?.scope === 'couple'
    ? await q.all("SELECT id, name, kind FROM categories WHERE scope='couple' AND couple_id=? AND parent_id IS NULL", acc.couple_id)
    : await q.all("SELECT id, name, kind FROM categories WHERE scope='personal' AND user_id=? AND parent_id IS NULL", userId);
  const m = new Map();
  for (const r of rows) m.set(r.kind + ':' + r.name, r.id);
  return m;
}

// Atualiza (e devolve) o saldo atual do NEXO x saldo do banco.
export async function balanceCheck(ba) {
  if (!ba.account_id) return { nexo_cents: null, diff_cents: null };
  const nexo = (await accountBalances([ba.account_id])).get(ba.account_id) ?? 0;
  const diff = ba.kind === 'card' || ba.bank_balance_cents == null ? null : ba.bank_balance_cents - nexo;
  return { nexo_cents: nexo, diff_cents: diff };
}

// Faz o saldo da conta no NEXO igualar o do banco, ajustando o saldo inicial (não cria lançamentos falsos).
export async function calibrate(ba) {
  if (!ba.account_id || ba.kind === 'card' || ba.bank_balance_cents == null) return null;
  const { diff_cents } = await balanceCheck(ba);
  if (!diff_cents) return 0;
  await q.run('UPDATE accounts SET initial_cents = initial_cents + ? WHERE id=?', diff_cents, ba.account_id);
  return diff_cents;
}

const sign = (t) => (t.type === 'income' ? '+' : '−') + brl(t.amount_cents);
async function tellImported(ctx, link, ba, fresh) {
  const where = `${link.connector || 'Banco'}${ba.kind === 'card' ? ' (cartão)' : ''}`;
  const shown = fresh.slice(0, 3).map((t) => `${sign(t)} ${t.description}`).join(' · ');
  await notify(ctx.userId, {
    type: 'bank', link: '#/movimentacoes', dedupe: `bank:${ba.id}:${Date.now()}`,
    title: fresh.length === 1 ? `${where}: nova movimentação` : `${where}: ${fresh.length} novas movimentações`,
    body: shown + (fresh.length > 3 ? ` e mais ${fresh.length - 3}` : ''),
  });
}

// Sincroniza uma conta do banco. `ctx` = { userId, ip }.
export async function syncBankAccount(ctx, ba, { firstCalibrate = true } = {}) {
  const link = await q.get('SELECT * FROM bank_links WHERE id=?', ba.link_id);
  if (!link) throw new Error('vínculo ausente');
  const today = todayISO();
  const first = !ba.synced_to;
  try {
    // saldo atual do banco
    const accs = await pluggy.listAccounts(link.item_id);
    const remote = accs.find((a) => String(a.id) === ba.pluggy_account_id);
    if (remote) {
      const bal = pluggy.cents(remote.balance);
      await q.run("UPDATE bank_accounts SET bank_balance_cents=?, balance_at=datetime('now') WHERE id=?", bal, ba.id);
      ba = { ...ba, bank_balance_cents: bal };
    }
    const from = first ? addDays(today, -BACKFILL_DAYS()) : addDays(ba.synced_to, -OVERLAP_DAYS);
    const list = (await pluggy.listTransactions(ba.pluggy_account_id, from, today)).map(pluggy.normalizeTx).filter(Boolean);
    const acct = await q.get('SELECT scope, couple_id FROM accounts WHERE id=?', ba.account_id);
    const sc = acct?.scope === 'couple' ? 'couple' : 'personal';
    const cats = await categoryIndex(acct, ctx.userId);
    const fresh = [];
    if (list.length) {
      await tx(async () => {
        for (let i = 0; i < list.length; i += 80) {
          const chunk = list.slice(i, i + 80);
          const ph = chunk.map(() => "(?,?,?,?,?,?,?,'paid',?,?,?,?)").join(',');
          const params = chunk.flatMap((t) => {
            const cn = pluggy.guessCategoryName(t.description, t.type);
            return [sc, ctx.userId, sc === 'couple' ? acct.couple_id : null, ba.account_id, t.type, t.amount_cents, t.date, cn ? cats.get(t.type + ':' + cn) ?? null : null, t.description, t.external_id, pluggy.guessPaymentMethod(t.description, ba.kind)];
          });
          const rows = await q.all(
            `INSERT INTO transactions(scope,user_id,couple_id,account_id,type,amount_cents,date,status,category_id,description,external_id,payment_method) VALUES ${ph}
             ON CONFLICT DO NOTHING RETURNING type, amount_cents, description, date`, ...params);
          fresh.push(...rows);
        }
      });
    }
    const imported = fresh.length;
    await q.run('UPDATE bank_accounts SET synced_to=? WHERE id=?', today, ba.id);
    await q.run("UPDATE bank_links SET last_sync_at=datetime('now'), last_error=NULL WHERE id=?", link.id);
    let calibrated = null;
    if (first && firstCalibrate) calibrated = await calibrate(ba);
    if (imported) {
      await audit({ ...ctx, coupleId: acct?.couple_id }, 'bank.sync', 'bank_account', ba.id, { imported }, sc);
      await emitChange({ ...ctx, coupleId: acct?.couple_id }, sc, 'transactions');
      if (!first) await tellImported(ctx, link, ba, fresh);
    }
    const chk = await balanceCheck(ba);
    return { imported, fetched: list.length, calibrated_cents: calibrated, ...chk };
  } catch (e) {
    await q.run('UPDATE bank_links SET last_error=? WHERE id=?', String(e.message || 'erro').slice(0, 200), link.id);
    throw e;
  }
}

const ago = (t) => (t ? Date.now() - new Date(String(t).replace(' ', 'T') + 'Z').getTime() : Infinity);
const REFRESH_EVERY = 100_000; // pede ao Pluggy para buscar no banco a cada ~2 min por banco (o Pluggy pode limitar por conta própria)

// Atualiza os bancos de um usuário (ou de todos, se userId for nulo): pede atualização ao Pluggy de tempos em tempos
// e importa o que houver de novo. Respeita um orçamento de tempo (funções serverless têm limite).
export async function syncBanks({ userId = null, itemId = null, budgetMs = 8000, minAgeMs = 2 * 60_000, refresh = true } = {}) {
  if (!pluggy.configured()) return { imported: 0, links: 0 };
  const started = Date.now();
  const links = await q.all(`SELECT * FROM bank_links ${userId ? 'WHERE user_id=?' : itemId ? 'WHERE item_id=?' : ''} ORDER BY last_sync_at NULLS FIRST`, ...(userId ? [userId] : itemId ? [itemId] : []));
  let imported = 0;
  for (const l of links) {
    if (Date.now() - started > budgetMs) break;
    if (ago(l.last_sync_at) < minAgeMs) continue;
    try {
      if (refresh && ago(l.last_refresh_at) > REFRESH_EVERY) {
        await q.run("UPDATE bank_links SET last_refresh_at=datetime('now') WHERE id=?", l.id);
        await pluggy.refreshItem(l.item_id, 0).catch(() => {});
      }
      const accs = await q.all('SELECT * FROM bank_accounts WHERE link_id=? AND account_id IS NOT NULL', l.id);
      for (const ba of accs) {
        if (Date.now() - started > budgetMs) break;
        const r = await syncBankAccount({ userId: l.user_id, ip: null }, ba, { firstCalibrate: false });
        imported += r.imported;
      }
    } catch (e) { console.error('[bank sync]', l.id, e.message); }
  }
  return { imported, links: links.length };
}
export const syncAllBanks = (opts = {}) => syncBanks({ budgetMs: 25_000, minAgeMs: 60_000, ...opts });
