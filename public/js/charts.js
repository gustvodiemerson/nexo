// Gráficos SVG leves, sem dependências. Todos os números vêm dos dados reais da API.
import { h, brl } from './ui.js';

let gid = 0;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const svgEl = (html, cls = '') => { const w = h('div', { class: `chart-wrap ${cls}` }); w.innerHTML = html; return w; };
export const short = (cents) => {
  const v = Math.abs(cents) / 100, s = cents < 0 ? '−' : '';
  if (v >= 1e6) return `${s}${(v / 1e6).toFixed(1).replace('.', ',')} mi`;
  if (v >= 1000) return `${s}${(v / 1000).toFixed(v >= 10000 ? 0 : 1).replace('.', ',')} mil`;
  return `${s}${Math.round(v)}`;
};

function smooth(pts) {
  if (pts.length < 2) return '';
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const f = (n) => n.toFixed(1);
    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)},${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)},${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])},${f(p2[1])}`;
  }
  return d;
}

// Tooltip por toque/hover em elementos com data-tip.
function tips(wrap) {
  const tip = h('div', { class: 'tooltip hidden' }); wrap.append(tip);
  const show = (el) => {
    const t = el.getAttribute('data-tip'); if (!t) return;
    tip.textContent = t; tip.classList.remove('hidden');
    const r = el.getBoundingClientRect(), w = wrap.getBoundingClientRect();
    tip.style.left = Math.min(Math.max(r.left - w.left + r.width / 2, 60), w.width - 60) + 'px'; tip.style.top = (r.top - w.top) + 'px';
  };
  wrap.addEventListener('pointerover', (e) => { const el = e.target.closest('[data-tip]'); if (el) show(el); });
  wrap.addEventListener('pointerleave', () => tip.classList.add('hidden'));
  wrap.addEventListener('pointerdown', (e) => { const el = e.target.closest('[data-tip]'); if (el) show(el); else tip.classList.add('hidden'); });
  return wrap;
}

// Linha suave com área e ponto final iluminado.
export function sparkline(values, { w = 200, hgt = 64, from = '#ff2d95', to = '#2f8bff', fill = true, label = 'Evolução' } = {}) {
  const id = ++gid, vals = values && values.length ? values : [0, 0];
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const padY = 8, padX = 6;
  const pts = vals.map((v, i) => [padX + (i * (w - padX * 2)) / Math.max(1, vals.length - 1), max === min ? hgt / 2 : hgt - padY - ((v - min) / span) * (hgt - padY * 2)]);
  const flat = max === min; if (flat) fill = false;
  const d = smooth(pts), last = pts[pts.length - 1];
  const area = `${d}L${last[0]},${hgt}L${pts[0][0]},${hgt}Z`;
  return svgEl(`<svg viewBox="0 0 ${w} ${hgt}" role="img" aria-label="${esc(label)}" preserveAspectRatio="none">
    <defs><linearGradient id="sg${id}" x1="0" x2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>
    <linearGradient id="sf${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${to}" stop-opacity=".30"/><stop offset="1" stop-color="${to}" stop-opacity="0"/></linearGradient></defs>
    ${fill ? `<path d="${area}" fill="url(#sf${id})"/>` : ''}
    <path d="${d}" fill="none" stroke="url(#sg${id})" stroke-width="2.6" stroke-linecap="round" vector-effect="non-scaling-stroke" ${flat ? 'stroke-dasharray="2 6" opacity=".6"' : `style="filter:drop-shadow(0 0 5px ${to}99)"`}/>
    </svg>`, 'spark');
}

// Anel de progresso com gradiente.
export function ring(p, { size = 128, stroke = 13, from = '#ff2d95', to = '#2f8bff', center = '', sub = '' } = {}) {
  const id = ++gid, r = (size - stroke) / 2, c = 2 * Math.PI * r, v = Math.min(1, Math.max(0, p || 0));
  return svgEl(`<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${Math.round(v * 100)}% concluído">
    <defs><linearGradient id="rg${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="rgba(255,255,255,.09)" stroke-width="${stroke}"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="url(#rg${id})" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${(c * v).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})" style="filter:drop-shadow(0 0 6px ${from}88);transition:stroke-dasharray .9s ease"/>
    <text x="50%" y="${sub ? '47%' : '53%'}" text-anchor="middle" fill="#f1f4ff" font-size="${size * 0.21}" font-weight="700" font-family="inherit">${esc(center)}</text>
    ${sub ? `<text x="50%" y="63%" text-anchor="middle" fill="#aab4d8" font-size="${size * 0.085}" font-family="inherit">${esc(sub)}</text>` : ''}
    </svg>`, 'ring');
}

function niceMax(v) { if (v <= 0) return 100; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }

// Barras agrupadas (receitas x despesas) por mês.
export function barPairs(series, { hgt = 190 } = {}) {
  const W = 360, padL = 38, padB = 24, padT = 10, innerH = hgt - padB - padT;
  const max = niceMax(Math.max(1, ...series.flatMap((s) => [s.a, s.b])));
  const gw = (W - padL - 6) / series.length, bw = Math.min(16, gw * 0.3);
  const y = (v) => padT + innerH - (v / max) * innerH;
  let g = '';
  for (let i = 0; i <= 4; i++) { const v = (max * i) / 4, yy = y(v); g += `<line x1="${padL}" x2="${W}" y1="${yy}" y2="${yy}" stroke="rgba(150,170,255,.12)"/><text x="${padL - 6}" y="${yy + 4}" text-anchor="end" fill="#7480ab" font-size="10">${short(v)}</text>`; }
  series.forEach((s, i) => {
    const cx = padL + gw * i + gw / 2;
    const tip = `${s.label}: receitas ${brl(s.a)} • despesas ${brl(s.b)}`;
    g += `<g data-tip="${esc(tip)}" tabindex="0"><rect x="${cx - gw / 2}" y="${padT}" width="${gw}" height="${innerH}" fill="transparent"/>
      <rect x="${cx - bw - 1.5}" y="${y(s.a)}" width="${bw}" height="${Math.max(0, padT + innerH - y(s.a))}" rx="4" fill="#2ee59d" opacity=".92"/>
      <rect x="${cx + 1.5}" y="${y(s.b)}" width="${bw}" height="${Math.max(0, padT + innerH - y(s.b))}" rx="4" fill="#ff5c7a" opacity=".92"/></g>
      <text x="${cx}" y="${hgt - 6}" text-anchor="middle" fill="#aab4d8" font-size="11">${esc(s.label)}</text>`;
  });
  return tips(svgEl(`<svg viewBox="0 0 ${W} ${hgt}" role="img" aria-label="Receitas e despesas por mês">${g}</svg>`));
}

// Linhas (uma ou mais séries) com eixo e marcadores.
export function lineChart(labels, series, { hgt = 200, area = true } = {}) {
  const W = 360, padL = 42, padR = 8, padB = 24, padT = 12, innerH = hgt - padB - padT, id = ++gid;
  const all = series.flatMap((s) => s.values);
  let max = Math.max(0, ...all), min = Math.min(0, ...all);
  if (max === min) max = min + 100;
  const top = niceMax(max), bot = min < 0 ? -niceMax(-min) : 0, span = top - bot;
  const x = (i) => padL + (i * (W - padL - padR)) / Math.max(1, labels.length - 1);
  const y = (v) => padT + innerH - ((v - bot) / span) * innerH;
  let g = '';
  for (let i = 0; i <= 4; i++) { const v = bot + (span * i) / 4, yy = y(v); g += `<line x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}" stroke="rgba(150,170,255,.12)"/><text x="${padL - 6}" y="${yy + 4}" text-anchor="end" fill="#7480ab" font-size="10">${short(v)}</text>`; }
  const step = Math.ceil(labels.length / 7);
  labels.forEach((l, i) => { if (i % step === 0 || i === labels.length - 1) g += `<text x="${x(i)}" y="${hgt - 6}" text-anchor="middle" fill="#aab4d8" font-size="11">${esc(l)}</text>`; });
  series.forEach((s, si) => {
    const pts = s.values.map((v, i) => [x(i), y(v)]);
    if (area && si === 0 && pts.length > 1) g += `<defs><linearGradient id="la${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity=".28"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient></defs><path d="${smooth(pts)}L${pts[pts.length - 1][0]},${y(Math.max(bot, 0))}L${pts[0][0]},${y(Math.max(bot, 0))}Z" fill="url(#la${id})"/>`;
    g += `<path d="${smooth(pts)}" fill="none" stroke="${s.color}" stroke-width="2.6" stroke-linecap="round" ${s.dashed ? 'stroke-dasharray="5 5"' : ''} style="filter:drop-shadow(0 0 4px ${s.color}88)"/>`;
    pts.forEach((p, i) => { g += `<circle cx="${p[0]}" cy="${p[1]}" r="${labels.length > 14 ? 2 : 3.4}" fill="#0a1030" stroke="${s.color}" stroke-width="2" data-tip="${esc(`${labels[i]} • ${s.name}: ${brl(s.values[i])}`)}"/><circle cx="${p[0]}" cy="${p[1]}" r="12" fill="transparent" data-tip="${esc(`${labels[i]} • ${s.name}: ${brl(s.values[i])}`)}"/>`; });
  });
  return tips(svgEl(`<svg viewBox="0 0 ${W} ${hgt}" role="img" aria-label="Gráfico de linhas">${g}</svg>`));
}

// Barras empilhadas (patrimônio por componente).
export function stackedBars(labels, layers, { hgt = 200 } = {}) {
  const W = 360, padL = 42, padB = 24, padT = 10, innerH = hgt - padB - padT;
  const totals = labels.map((_, i) => layers.reduce((x, l) => x + Math.max(0, l.values[i]), 0));
  const max = niceMax(Math.max(1, ...totals));
  const gw = (W - padL - 6) / labels.length, bw = Math.min(26, gw * 0.62);
  const y = (v) => padT + innerH - (v / max) * innerH;
  let g = '';
  for (let i = 0; i <= 4; i++) { const v = (max * i) / 4, yy = y(v); g += `<line x1="${padL}" x2="${W}" y1="${yy}" y2="${yy}" stroke="rgba(150,170,255,.12)"/><text x="${padL - 6}" y="${yy + 4}" text-anchor="end" fill="#7480ab" font-size="10">${short(v)}</text>`; }
  const step = Math.ceil(labels.length / 8);
  labels.forEach((l, i) => {
    const cx = padL + gw * i + gw / 2; let acc = 0;
    const tip = `${l} • ${layers.map((ly) => `${ly.name}: ${brl(ly.values[i])}`).join(' • ')}`;
    g += `<g data-tip="${esc(tip)}">`;
    layers.forEach((ly) => { const v = Math.max(0, ly.values[i]); const y1 = y(acc + v), y0 = y(acc); g += `<rect x="${cx - bw / 2}" y="${y1}" width="${bw}" height="${Math.max(0, y0 - y1)}" fill="${ly.color}" opacity=".92"/>`; acc += v; });
    g += `<rect x="${cx - gw / 2}" y="${padT}" width="${gw}" height="${innerH}" fill="transparent"/></g>`;
    if (i % step === 0 || i === labels.length - 1) g += `<text x="${cx}" y="${hgt - 6}" text-anchor="middle" fill="#aab4d8" font-size="11">${esc(l)}</text>`;
  });
  return tips(svgEl(`<svg viewBox="0 0 ${W} ${hgt}" role="img" aria-label="Patrimônio por componente">${g}</svg>`));
}

// Rosca de categorias.
export function donut(items, { size = 190, stroke = 30, center = '', sub = '' } = {}) {
  const total = items.reduce((x, i) => x + i.value, 0), r = (size - stroke) / 2, c = 2 * Math.PI * r;
  let acc = 0, g = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="${stroke}"/>`;
  if (total > 0) items.forEach((it) => {
    const len = (it.value / total) * c, gap = items.length > 1 ? 2.5 : 0;
    g += `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${it.color}" stroke-width="${stroke}" stroke-dasharray="${Math.max(0, len - gap).toFixed(1)} ${(c - Math.max(0, len - gap)).toFixed(1)}" stroke-dashoffset="${(-acc).toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})" data-tip="${esc(`${it.name}: ${brl(it.value)} (${Math.round((it.value / total) * 100)}%)`)}"/>`;
    acc += len;
  });
  g += `<text x="50%" y="${sub ? '47%' : '54%'}" text-anchor="middle" fill="#f1f4ff" font-size="${size * 0.105}" font-weight="700" font-family="inherit">${esc(center)}</text>${sub ? `<text x="50%" y="61%" text-anchor="middle" fill="#aab4d8" font-size="${size * 0.065}" font-family="inherit">${esc(sub)}</text>` : ''}`;
  const w = tips(svgEl(`<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Distribuição por categoria">${g}</svg>`, 'donut'));
  w.style.maxWidth = size + 'px'; w.style.margin = '0 auto';
  return w;
}
