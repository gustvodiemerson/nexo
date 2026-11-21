// Sincronização bancária: importa lançamentos do Pluggy sem duplicar e confere o saldo com o do banco.
import { q, tx } from './db.js';
import { addDays, todayISO } from './lib.js';
import { accountBalances, audit, emitChange } from './core.js';
import * as pluggy from './pluggy.js';

const BACKFILL_DAYS = () => Math.min(365, Math.max(7, Number(process.env.BANK_BACKFILL_DAYS) || 90));
const OVERLAP_DAYS = 10;

async function categoryIndex(userId) {
  const rows = await q.all("SELECT id, name, kind FROM categories WHERE scope='personal' AND user_id=? AND parent_id IS NULL", userId);
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
    const cats = await categoryIndex(ctx.userId);
    let imported = 0;
    if (list.length) {
      await tx(async () => {
        for (let i = 0; i < list.length; i += 80) {
          const chunk = list.slice(i, i + 80);
          const ph = chunk.map(() => "('personal',?,NULL,?,?,?,?,'paid',?,?,?)").join(',');
          const params = chunk.flatMap((t) => {
            const cn = pluggy.guessCategoryName(t.description, t.type);
            return [ctx.userId, ba.account_id, t.type, t.amount_cents, t.date, cn ? cats.get(t.type + ':' + cn) ?? null : null, t.description, t.external_id];
          });
          const r = await q.run(
            `INSERT OR IGNORE INTO transactions(scope,user_id,couple_id,account_id,type,amount_cents,date,status,category_id,description,external_id) VALUES ${ph}`, ...params);
          imported += r.changes || 0;
        }
      });
    }
    await q.run('UPDATE bank_accounts SET synced_to=? WHERE id=?', today, ba.id);
    await q.run("UPDATE bank_links SET last_sync_at=datetime('now'), last_error=NULL WHERE id=?", link.id);
    let calibrated = null;
    if (first && firstCalibrate) calibrated = await calibrate(ba);
    if (imported) { await audit(ctx, 'bank.sync', 'bank_account', ba.id, { imported }, 'personal'); await emitChange(ctx, 'personal', 'transactions'); }
    const chk = await balanceCheck(ba);
    return { imported, fetched: list.length, calibrated_cents: calibrated, ...chk };
  } catch (e) {
    await q.run('UPDATE bank_links SET last_error=? WHERE id=?', String(e.message || 'erro').slice(0, 200), link.id);
    throw e;
  }
}

// Rotina automática (a cada hora, mas cada conta só é consultada a cada ~6 h). Respeita um orçamento de tempo.
export async function syncAllBanks({ budgetMs = 20_000, minAgeMs = 6 * 3600_000 } = {}) {
  if (!pluggy.configured()) return 0;
  const started = Date.now();
  let n = 0;
  const rows = await q.all(
    `SELECT ba.*, l.last_sync_at FROM bank_accounts ba JOIN bank_links l ON l.id=ba.link_id WHERE ba.account_id IS NOT NULL ORDER BY l.last_sync_at NULLS FIRST`);
  for (const ba of rows) {
    if (Date.now() - started > budgetMs) break;
    if (ba.last_sync_at && Date.now() - new Date(ba.last_sync_at.replace(' ', 'T') + 'Z').getTime() < minAgeMs) continue;
    try { await syncBankAccount({ userId: ba.user_id, ip: null }, ba, { firstCalibrate: false }); n++; }
    catch (e) { console.error('[bank sync]', ba.id, e.message); }
  }
  return n;
}
