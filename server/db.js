// Banco PostgreSQL. Produção: Supabase via DATABASE_URL (pg). Local/testes: PGlite (Postgres embutido, sem instalar nada).
// API: q.get / q.all / q.run (async) e tx(async fn) com transações reentrantes (SAVEPOINT).
import path from 'node:path';
import fs from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { SCHEMA } from './schema.js';
import { MIGRATIONS } from './migrations.js';

const NOW_SQL = `to_char(now() at time zone 'utc','YYYY-MM-DD HH24:MI:SS')`;
const NO_ID_TABLES = new Set(['couple_members', 'chat_reads', 'rate_limits', 'schema_migrations', 'app_settings', 'push_prefs']);

// ---- tradução de dialeto (o código das rotas foi escrito em SQL "estilo SQLite") ----
function prep(sql, { forRun = false } = {}) {
  let out = '', n = 0, i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'") { // literal de texto
      let j = i + 1;
      while (j < sql.length) { if (sql[j] === "'" && sql[j + 1] === "'") j += 2; else if (sql[j] === "'") break; else j++; }
      out += sql.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === '?') { out += '$' + (++n); i++; continue; }
    out += c; i++;
  }
  out = out.replace(/datetime\('now'\)/gi, NOW_SQL).replace(/\bIFNULL\(/gi, 'COALESCE(');
  if (/^\s*INSERT\s+OR\s+IGNORE\s+INTO/i.test(out)) {
    out = out.replace(/^\s*INSERT\s+OR\s+IGNORE\s+INTO/i, 'INSERT INTO').replace(/;?\s*$/, ' ON CONFLICT DO NOTHING');
  }
  if (forRun) {
    const m = /^\s*INSERT\s+INTO\s+(\w+)/i.exec(out);
    if (m && !/\bRETURNING\b/i.test(out) && !NO_ID_TABLES.has(m[1].toLowerCase())) out = out.replace(/;?\s*$/, ' RETURNING id');
  }
  return out;
}

// ---- drivers ----
const mutex = (() => { let p = Promise.resolve(); return () => { let release; const next = new Promise((r) => (release = r)); const prev = p; p = prev.then(() => next); return prev.then(() => release); }; })();

async function makePg(url) {
  const { default: pg } = await import('pg');
  pg.types.setTypeParser(20, Number);
  pg.types.setTypeParser(1700, Number);
  const ssl = process.env.DATABASE_SSL === '0' ? false : { rejectUnauthorized: false };
  const pool = new pg.Pool({ connectionString: url, max: Number(process.env.PG_POOL_MAX) || 4, ssl, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 8_000 });
  pool.on('error', (e) => console.error('[pg pool]', e.message));
  const wrap = (r) => ({ rows: r.rows, count: r.rowCount });
  return {
    name: 'pg',
    query: async (sql, params) => wrap(await pool.query(sql, params)),
    exec: async (sql) => { await pool.query(sql); },
    async acquire() {
      const c = await pool.connect();
      return { query: async (sql, params) => wrap(await c.query(sql, params)), release: () => c.release() };
    },
    async migrateLock(fn) {
      const c = await pool.connect();
      try { await c.query('SELECT pg_advisory_lock(727274)'); return await fn(async (s) => { const r = await c.query(s); return Array.isArray(r) ? r[r.length - 1] : r; }); }
      finally { try { await c.query('SELECT pg_advisory_unlock(727274)'); } catch {} c.release(); }
    },
    close: () => pool.end(),
  };
}

async function makePglite() {
  const spec = '@electric-sql/pglite'; // especificador dinâmico: o bundler da Netlify não embute o PGlite
  const { PGlite } = await import(spec);
  const dir = process.env.PGLITE_DIR || path.join(process.env.DATA_DIR || path.resolve(process.cwd(), 'data'), 'pglite');
  const mem = process.env.PGLITE_DIR === 'memory';
  if (!mem) fs.mkdirSync(path.dirname(dir), { recursive: true });
  const db = new PGlite(mem ? undefined : dir);
  const opts = { parsers: { 20: (v) => Number(v), 1700: (v) => Number(v) } };
  await db.waitReady;
  const wrap = (r) => ({ rows: r.rows, count: r.affectedRows ?? r.rows.length });
  return {
    name: 'pglite',
    query: async (sql, params) => { const rel = await mutex(); try { return wrap(await db.query(sql, params, opts)); } finally { rel(); } },
    exec: async (sql) => { const rel = await mutex(); try { await db.exec(sql); } finally { rel(); } },
    async acquire() {
      const rel = await mutex();
      return { query: async (sql, params) => wrap(await db.query(sql, params, opts)), release: rel };
    },
    async migrateLock(fn) { const rel = await mutex(); try { return await fn(async (s) => { const r = await db.exec(s); return r[r.length - 1] || { rows: [] }; }); } finally { rel(); } },
    close: () => db.close(),
  };
}

// ---- inicialização + migração automática ----
let driverP = null;
export function getDriver() {
  if (!driverP) {
    driverP = (async () => {
      const d = process.env.DATABASE_URL ? await makePg(process.env.DATABASE_URL) : await makePglite();
      await d.migrateLock(async (run) => {
        await run(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (${NOW_SQL}))`);
        const current = Number((await run('SELECT COALESCE(MAX(version),0) AS v FROM schema_migrations')).rows[0].v);
        let applied = current;
        if (applied < 1) {
          await run('BEGIN');
          try { await run(SCHEMA); await run("INSERT INTO schema_migrations(version) VALUES (1)"); await run('COMMIT'); }
          catch (e) { try { await run('ROLLBACK'); } catch {} throw e; }
          applied = 1;
        }
        for (const m of MIGRATIONS) {
          if (m.version <= applied) continue;
          await run('BEGIN');
          try { await run(m.sql); await run(`INSERT INTO schema_migrations(version) VALUES (${Number(m.version)})`); await run('COMMIT'); }
          catch (e) { try { await run('ROLLBACK'); } catch {} throw e; }
          applied = m.version;
        }
      });
      return d;
    })();
    driverP.catch(() => { driverP = null; });
  }
  return driverP;
}

// ---- API ----
const als = new AsyncLocalStorage();
async function exec(sql, params, forRun) {
  const text = prep(sql, { forRun });
  const store = als.getStore();
  if (store) return store.client.query(text, params);
  return (await getDriver()).query(text, params);
}
export const q = {
  get: async (sql, ...p) => (await exec(sql, p, false)).rows[0],
  all: async (sql, ...p) => (await exec(sql, p, false)).rows,
  run: async (sql, ...p) => { const r = await exec(sql, p, true); return { changes: r.count, lastInsertRowid: r.rows[0]?.id }; },
};

// Transação reentrante: a mais externa usa BEGIN; as internas, SAVEPOINT. O cliente viaja em AsyncLocalStorage.
export async function tx(fn) {
  const cur = als.getStore();
  if (cur) {
    const sp = `sp${++cur.n}`;
    await cur.client.query(`SAVEPOINT ${sp}`);
    try { const r = await fn(); await cur.client.query(`RELEASE SAVEPOINT ${sp}`); return r; }
    catch (e) { try { await cur.client.query(`ROLLBACK TO SAVEPOINT ${sp}`); await cur.client.query(`RELEASE SAVEPOINT ${sp}`); } catch {} throw e; }
  }
  const client = await (await getDriver()).acquire();
  const store = { client, n: 0 };
  try {
    await client.query('BEGIN');
    try { const r = await als.run(store, fn); await client.query('COMMIT'); return r; }
    catch (e) { try { await client.query('ROLLBACK'); } catch {} throw e; }
  } finally { client.release(); }
}

export async function closeDb() { if (driverP) { try { await (await driverP).close(); } catch {} driverP = null; } }
