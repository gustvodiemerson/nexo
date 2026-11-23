// Cliente mínimo da API do Pluggy (Open Finance, somente leitura). As chaves ficam só em variáveis de ambiente do servidor.
import { HttpError } from './lib.js';

const base = () => (process.env.PLUGGY_BASE_URL || 'https://api.pluggy.ai').replace(/\/+$/, '');
export const configured = () => !!(process.env.PLUGGY_CLIENT_ID && process.env.PLUGGY_CLIENT_SECRET);
const TIMEOUT = () => Number(process.env.PLUGGY_TIMEOUT_MS) || 8000;

let cache = { key: null, exp: 0 };

async function raw(method, path, { params, body, key } = {}) {
  const url = new URL(base() + path);
  for (const [k, val] of Object.entries(params || {})) if (val !== undefined && val !== null && val !== '') url.searchParams.set(k, String(val));
  const headers = { Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  if (key) headers['X-API-KEY'] = key;
  let res;
  try { res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(TIMEOUT()) }); }
  catch (e) { throw new HttpError(504, e?.name === 'TimeoutError' ? 'O Pluggy demorou para responder. Tente novamente.' : 'Não foi possível falar com o Pluggy agora.'); }
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

async function apiKey(force = false) {
  if (!configured()) throw new HttpError(503, 'A integração bancária ainda não foi configurada neste servidor.');
  if (!force && cache.key && Date.now() < cache.exp) return cache.key;
  const r = await raw('POST', '/auth', { body: { clientId: process.env.PLUGGY_CLIENT_ID, clientSecret: process.env.PLUGGY_CLIENT_SECRET } });
  if (r.status !== 200 || !r.data?.apiKey) {
    console.error('[pluggy] auth falhou', r.status);
    throw new HttpError(502, r.status === 401 || r.status === 403 ? 'As chaves do Pluggy foram recusadas. Confira o Client ID e o Client Secret.' : 'Falha ao autenticar no Pluggy.');
  }
  cache = { key: r.data.apiKey, exp: Date.now() + 100 * 60_000 }; // a chave vale 2 h
  return cache.key;
}

async function api(path, params, { soft = false } = {}) {
  let r = await raw('GET', path, { params, key: await apiKey() });
  if (r.status === 401 || r.status === 403) r = await raw('GET', path, { params, key: await apiKey(true) });
  if (soft && (r.status < 200 || r.status >= 300)) return { failed: r };
  if (r.status === 404) throw new HttpError(404, 'Não encontrado no Pluggy. Confira o Item ID.');
  if (r.status === 429) throw new HttpError(429, 'Limite de consultas do Pluggy atingido. Tente de novo em alguns minutos.');
  if (r.status < 200 || r.status >= 300) throw failure(path, r);
  return r.data;
}
function failure(path, r) {
  const msg = String(r.data?.message || r.data?.error || '').replace(/\s+/g, ' ').slice(0, 140);
  console.error('[pluggy]', path, r.status, JSON.stringify(r.data)?.slice(0, 300));
  return new HttpError(502, `O Pluggy retornou um erro (${r.status}${msg ? ': ' + msg : ''}).`);
}

// Pede ao Pluggy que busque dados novos no banco (melhor esforço) e espera um pouco o resultado.
// Devolve também o que o Pluggy respondeu e quando os dados dele foram atualizados pela última vez (para diagnóstico).
export async function refreshItem(id, waitMs = 6000) {
  let r = await raw('PATCH', '/items/' + encodeURIComponent(id), { body: {}, key: await apiKey() });
  if (r.status === 401 || r.status === 403) r = await raw('PATCH', '/items/' + encodeURIComponent(id), { body: {}, key: await apiKey(true) });
  if (r.status < 200 || r.status >= 300) {
    console.error('[pluggy] refresh', r.status, JSON.stringify(r.data)?.slice(0, 200));
    let it = null; try { it = await getItem(id); } catch { /* ignora */ }
    return { ok: false, http: r.status, status: it?.status || r.data?.status || null, message: String(r.data?.message || '').slice(0, 140) || null, updated_at: it?.lastUpdatedAt || null, execution: it?.executionStatus || null };
  }
  let item = r.data || {}; let status = item.status || 'UPDATING';
  const end = Date.now() + waitMs;
  while (status === 'UPDATING' && Date.now() < end) {
    await new Promise((res) => setTimeout(res, 1200));
    try { item = (await getItem(id)) || item; status = item.status || status; } catch { break; }
  }
  return { ok: true, status, message: null, updated_at: item.lastUpdatedAt || null, execution: item.executionStatus || null };
}
export const getItem = (id) => api('/items/' + encodeURIComponent(id));
export async function listAccounts(itemId) { const d = await api('/accounts', { itemId }); return d?.results || []; }

// Lançamentos de uma conta no intervalo [from, to] (YYYY-MM-DD), todas as páginas.
// Usa a API nova (v2, por cursor) e, se ela falhar, a antiga (v1, por página, marcada como obsoleta pelo Pluggy).
export async function listTransactions(accountId, from, to) {
  const out = [];
  let after = null, ok = true;
  for (let i = 0; i < 12; i++) {
    const d = await api('/v2/transactions', { accountId, dateFrom: from, dateTo: to, after, pageSize: 500 }, { soft: true });
    if (d.failed) { ok = false; console.error('[pluggy] v2 falhou', d.failed.status, JSON.stringify(d.failed.data)?.slice(0, 200)); break; }
    out.push(...(d.results || []));
    const next = d.next ? String(d.next) : null;
    after = next ? new URLSearchParams(next.includes('?') ? next.slice(next.indexOf('?') + 1) : next).get('after') : null;
    if (!after) return out;
  }
  if (ok) return out;
  out.length = 0;
  for (let page = 1; page <= 12; page++) {
    const d = await api('/transactions', { accountId, from, to, pageSize: 500, page });
    out.push(...(d?.results || []));
    if (!d || page >= (d.totalPages || 1)) break;
  }
  return out;
}

export const cents = (n) => (Number.isFinite(Number(n)) ? Math.round(Number(n) * 100) : null);
export function kindOf(acc) {
  if (acc.type === 'CREDIT' || acc.subtype === 'CREDIT_CARD') return 'card';
  return acc.subtype === 'SAVINGS_ACCOUNT' ? 'savings' : 'checking';
}

// Converte um lançamento do Pluggy para o formato do NEXO (ignora os ainda não efetivados).
export function normalizeTx(t) {
  if (!t || !t.id || String(t.status || '').toUpperCase() === 'PENDING') return null;
  const amt = Number(t.amount);
  if (!Number.isFinite(amt) || amt === 0) return null;
  const type = t.type === 'CREDIT' ? 'income' : t.type === 'DEBIT' ? 'expense' : (amt < 0 ? 'expense' : 'income');
  const date = String(t.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const description = String(t.description || t.descriptionRaw || 'Movimentação bancária').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Movimentação bancária';
  return { external_id: String(t.id).slice(0, 80), type, amount_cents: Math.round(Math.abs(amt) * 100), date, description };
}

// Sugestão de categoria por palavras-chave (o usuário revisa depois). Devolve o nome da categoria raiz.
const RULES = [
  ['expense', 'Alimentação', /mercado|supermerc|atacad|padaria|restaur|lanchon|ifood|i food|burger|pizza|acai|assai|carrefour|hortifruti|acougue|sorvet|cafe|delivery/],
  ['expense', 'Transporte', /uber|\b99\b|posto |combust|ipiranga|shell|estacion|pedagio|sem parar|gasolina|metro|onibus/],
  ['expense', 'Saúde', /farmac|drog|clinic|hospital|laborat|odonto|consulta/],
  ['expense', 'Assinaturas', /netflix|spotify|disney|hbo|prime video|youtube|apple\.com|google one|deezer|globoplay/],
  ['expense', 'Moradia', /aluguel|condomin|energia|enel|energisa|cemig|sanesul|sabesp|copasa|internet|\bvivo\b|\bclaro\b|\btim\b|\boi\b/],
  ['expense', 'Educação', /escola|curso|faculdade|udemy|colegio|universid/],
  ['expense', 'Compras', /shopee|mercado ?livre|amazon|magalu|magazine|shein|americanas|renner|riachuelo|c&a/],
  ['expense', 'Impostos e taxas', /tarifa|\biof\b|imposto|\btaxa\b|anuidade|juros/],
  ['income', 'Salário', /salario|folha de pag|pagto salario|proventos/],
  ['income', 'Rendimentos', /rendimento|rend pago|dividend|cdb|juros/],
];
const plain = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export function guessCategoryName(description, type) {
  const d = plain(description);
  for (const [t, name, re] of RULES) if (t === type && re.test(d)) return name;
  return null;
}

// Forma de pagamento provável (Pix, boleto, dinheiro…) a partir da descrição e do tipo de conta.
export function guessPaymentMethod(description, kind) {
  const d = plain(description);
  if (/\bpix\b/.test(d)) return 'pix';
  if (/boleto|pagto titulo|pagamento de titulo|convenio|fatura/.test(d)) return 'boleto';
  if (/\bted\b|\bdoc\b|transferencia|transf /.test(d)) return 'transfer';
  if (/saque|deposito em dinheiro/.test(d)) return 'cash';
  if (kind === 'card') return 'credit';
  if (/debito|compra no debito|compra cartao/.test(d)) return 'debit';
  return null;
}
