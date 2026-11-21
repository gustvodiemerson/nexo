// Ícones SVG (traço 1.8, 24x24). Uso: icon('home', 22)
const P = {
  camera: '<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.2a1.5 1.5 0 0 0 1.2-.6l.7-1A1.5 1.5 0 0 1 10.9 4h2.2a1.5 1.5 0 0 1 1.3.6l.7 1a1.5 1.5 0 0 0 1.2.6h1.2A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z"/><circle cx="12" cy="12.5" r="3.5"/>',
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5a1 1 0 0 0 1 1H10v-5.5h4v5.5h3.5a1 1 0 0 0 1-1V10"/>',
  chart: '<path d="M5 20V11M12 20V5M19 20v-7"/><path d="M3 20.5h18"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M8 14h2M12 14h2M8 17h2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>', check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  bell: '<path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off': '<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.7C3.7 8.5 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 4.4-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  wallet: '<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18a2 2 0 0 1 2 2v2"/><path d="M4 7.5V17a2.5 2.5 0 0 0 2.5 2.5H19a1.5 1.5 0 0 0 1.5-1.5V10.5A1.5 1.5 0 0 0 19 9H6.5A2.5 2.5 0 0 1 4 6.5"/><circle cx="16.5" cy="14.2" r="1.2"/>',
  'arrow-down': '<path d="M12 5v14M6 13l6 6 6-6"/>', 'arrow-up': '<path d="M12 19V5M6 11l6-6 6 6"/>', 'arrow-right': '<path d="M5 12h14M13 6l6 6-6 6"/>', 'arrow-left': '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  'arrow-ne': '<path d="M7 17 17 7M8 7h9v9"/>', 'arrow-sw': '<path d="M17 7 7 17M16 17H7V8"/>', swap: '<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
  income: '<circle cx="12" cy="12" r="9"/><path d="M12 16.5v-9M8.5 11 12 7.5l3.5 3.5"/>', expense: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v9M8.5 13 12 16.5l3.5-3.5"/>',
  vault: '<rect x="3" y="4" width="18" height="15" rx="3"/><circle cx="12" cy="11.5" r="3.4"/><path d="M12 9.2v4.6M9.7 11.5h4.6"/><path d="M7 19v1.5M17 19v1.5"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="3"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/><circle cx="12" cy="15.5" r="1.2"/>',
  trend: '<path d="M3 17 9 11l4 4 8-9"/><path d="M15 6h6v6"/>', 'trend-down': '<path d="M3 7l6 6 4-4 8 9"/><path d="M15 18h6v-6"/>',
  invest: '<path d="M4 20V13M10 20V9M16 20v-7M22 20V5"/><path d="M2 20.5h21"/>',
  chat: '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 3.5V17H6.5A2.5 2.5 0 0 1 4 14.5z"/><path d="M8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01"/>',
  users: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 5.2a3.5 3.5 0 0 1 0 6.6M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 20.5a8 8 0 0 1 16 0"/>',
  heart: '<path d="M12 20.5S3.5 15 3.5 9A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8.5 2c0 6-8.5 11.5-8.5 11.5z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/><path d="M12 12 19 5M16 5h3v3"/>',
  card: '<rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M2.5 10h19M6.5 15h4"/>',
  bank: '<path d="M3 9.5 12 4l9 5.5"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20.5h18"/>',
  coins: '<ellipse cx="9" cy="7" rx="6" ry="3"/><path d="M3 7v4c0 1.7 2.7 3 6 3s6-1.3 6-3V7"/><path d="M3 11v4c0 1.7 2.7 3 6 3 1.2 0 2.3-.2 3.2-.5"/><path d="M15 10.5c3.3 0 6 1.3 6 3v4c0 1.7-2.7 3-6 3s-6-1.3-6-3v-4c0-1.7 2.7-3 6-3z"/>',
  piggy: '<path d="M18.5 9.5V7l-2.4 1A8 8 0 0 0 13 7.5H10A6 6 0 0 0 4 13.5c0 2 1 3.6 2.5 4.6V20h3v-1.2c.5.1 1 .2 1.5.2h2c.5 0 1-.1 1.5-.2V20h3v-2.2c1.2-.8 2-2 2.2-3.3H22v-3z"/><circle cx="15.5" cy="11.5" r=".8"/>',
  cart: '<path d="M3 4h2.5l2 10.5a1.5 1.5 0 0 0 1.5 1.2h8a1.5 1.5 0 0 0 1.5-1.1L20 8H6.2"/><circle cx="9.5" cy="19.5" r="1.4"/><circle cx="17" cy="19.5" r="1.4"/>',
  car: '<path d="M5 16.5V12l1.8-4.6A2 2 0 0 1 8.7 6h6.6a2 2 0 0 1 1.9 1.4L19 12v4.5"/><path d="M3.5 12h17a1 1 0 0 1 1 1v3.5h-19V13a1 1 0 0 1 1-1z"/><path d="M5.5 16.5V19M18.5 16.5V19"/><circle cx="7.5" cy="14.3" r=".6"/><circle cx="16.5" cy="14.3" r=".6"/>',
  ticket: '<path d="M3 9V7.5A1.5 1.5 0 0 1 4.5 6h15A1.5 1.5 0 0 1 21 7.5V9a3 3 0 0 0 0 6v1.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5V15a3 3 0 0 0 0-6z"/><path d="M14 6v12" stroke-dasharray="2 2.5"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 18.5V5.5M8.5 7.5H16"/>',
  bag: '<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>', repeat: '<path d="M17 3l3 3-3 3"/><path d="M4 11V9.5A3.5 3.5 0 0 1 7.5 6H20M7 21l-3-3 3-3"/><path d="M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H4"/>',
  paw: '<circle cx="6" cy="10" r="1.8"/><circle cx="10" cy="6" r="1.8"/><circle cx="14.5" cy="6" r="1.8"/><circle cx="18.2" cy="10" r="1.8"/><path d="M12 11.5c-3 0-5.5 3-5.5 5.4A2.6 2.6 0 0 0 9 19.5c1 0 1.7-.5 3-.5s2 .5 3 .5a2.6 2.6 0 0 0 2.5-2.6c0-2.4-2.5-5.4-5.5-5.4z"/>',
  gift: '<rect x="3.5" y="9" width="17" height="4" rx="1"/><path d="M5 13v7.5h14V13M12 9v11.5"/><path d="M12 9c-1.5-4-6-4-5-1 .6 1.7 3.5 1 5 1zM12 9c1.5-4 6-4 5-1-.6 1.7-3.5 1-5 1z"/>',
  receipt: '<path d="M6 3h12v18l-2.2-1.5L13.6 21 12 19.7 10.4 21l-2.2-1.5L6 21z"/><path d="M9 8h6M9 12h6M9 16h3"/>', dots: '<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>',
  briefcase: '<rect x="3" y="7.5" width="18" height="12.5" rx="2.5"/><path d="M8.5 7.5V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v1.5M3 13h18"/>', laptop: '<rect x="5" y="5" width="14" height="10" rx="2"/><path d="M2.5 19.5h19l-1.8-4.5H4.3z"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H9"/>', pulse: '<path d="M3 12h4l2.5-6 4 12 2.5-6H21"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>', filter: '<path d="M3.5 5.5h17l-6.5 7.8V19l-4 2v-7.7z"/>', download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 16V5M7 9l5-5 5 5M5 20h14"/>', send: '<path d="M21 3 10.5 13.5M21 3l-6.5 18-4-7.5L3 9.5z"/>', copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/>',
  share: '<circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="6" r="2.6"/><circle cx="18" cy="18" r="2.6"/><path d="m8.3 10.8 7.4-3.6M8.3 13.2l7.4 3.6"/>', link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"/>',
  edit: '<path d="M4 20h4L19.5 8.5a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>', trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5L18 7M9 7V4.5h6V7"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>', 'chevron-down': '<path d="m5 9 7 7 7-7"/>', 'chevron-left': '<path d="m15 5-7 7 7 7"/>', 'chevron-up': '<path d="m5 15 7-7 7 7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>', alert: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.5h.01"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5h.01"/>',
  star: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 17l-5.2 2.7 1-5.9L3.5 9.7l5.9-.8z"/>', shield: '<path d="M12 3 4.5 6v5.5c0 4.7 3.2 8.2 7.5 9.5 4.3-1.3 7.5-4.8 7.5-9.5V6z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M16 7l3 3M14 9l2 2"/>', logout: '<path d="M9 4H6.5A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20H9M16 8l4 4-4 4M20 12H9"/>', mail: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m3.5 7.5 8.5 6 8.5-6"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="2"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="2"/>',
  sparkle: '<path d="M12 3.5 14 10l6.5 2L14 14l-2 6.5L10 14l-6.5-2L10 10z"/><path d="M19 3v3M17.5 4.5h3"/>', brain: '<path d="M9.5 4A3.5 3.5 0 0 0 6 7.5 3.5 3.5 0 0 0 4 11a3.5 3.5 0 0 0 1.5 2.9A3.5 3.5 0 0 0 9 19a3 3 0 0 0 3 1V4.5A2.5 2.5 0 0 0 9.5 4z"/><path d="M14.5 4A3.5 3.5 0 0 1 18 7.5a3.5 3.5 0 0 1 2 3.5 3.5 3.5 0 0 1-1.5 2.9A3.5 3.5 0 0 1 15 19a3 3 0 0 1-3 1"/>',
  robot: '<rect x="4.5" y="7.5" width="15" height="11" rx="4"/><path d="M12 4v3.5M9 12.5v1.5M15 12.5v1.5M2.5 12v3M21.5 12v3"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>', pie: '<path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>',
  flag: '<path d="M5 21V4M5 4.5h12l-2 4 2 4H5"/>', plane: '<path d="M21 3 3 10.5l7 2.5 2.5 7z"/><path d="m10 13 4-4"/>', home2: '<path d="M4 20V10l8-6 8 6v10z"/><path d="M10 20v-6h4v6"/>',
  tag: '<path d="M3.5 12.5V4.5a1 1 0 0 1 1-1h8l8 8a1.5 1.5 0 0 1 0 2.1l-6.4 6.4a1.5 1.5 0 0 1-2.1 0z"/><circle cx="8" cy="8" r="1.3"/>', smartphone: '<rect x="7" y="3" width="10" height="18" rx="3"/><path d="M11 18h2"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>', refresh: '<path d="M20 5v5h-5M4 19v-5h5"/><path d="M5.5 9A7.5 7.5 0 0 1 19 10M18.5 15A7.5 7.5 0 0 1 5 14"/>',
  paperclip: '<path d="m20 11.5-8 8a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9.5 17.2a1.7 1.7 0 0 1-2.4-2.4l7.7-7.7"/>', percent: '<path d="M19 5 5 19"/><circle cx="7" cy="7" r="2.3"/><circle cx="17" cy="17" r="2.3"/>',
  couple: '<circle cx="8.5" cy="9" r="3"/><circle cx="15.5" cy="9" r="3"/><path d="M3 20a5.5 5.5 0 0 1 11 0M10 20a5.5 5.5 0 0 1 11 0"/>', infinity: '<path d="M8 8c-2.5 0-4 1.8-4 4s1.5 4 4 4c4 0 4-8 8-8 2.5 0 4 1.8 4 4s-1.5 4-4 4c-4 0-4-8-8-8z"/>',
};

export function icon(name, size = 22, extra = '') {
  const body = P[name] || P.dots;
  const wrap = document.createElement('span');
  wrap.style.display = 'inline-flex';
  wrap.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`;
  return wrap.firstChild.parentNode.firstChild; // devolve o próprio <svg>
}
export const hasIcon = (n) => !!P[n];
export const ICON_NAMES = Object.keys(P);

// Marca (símbolo do infinito em gradiente).
let lgid = 0;
export function logoMark() {
  const id = 'lg' + (++lgid);
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 92 56'); s.setAttribute('class', 'mark'); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="6" y1="0" x2="86" y2="0"><stop offset="0" stop-color="#ff2d95"/><stop offset=".5" stop-color="#a14dff"/><stop offset="1" stop-color="#2fa2ff"/></linearGradient></defs>
  <path d="M46 28C38 16 30 10 22 10 12 10 6 18 6 28s6 18 16 18c8 0 16-6 24-18 8-12 16-18 24-18 10 0 16 8 16 18s-6 18-16 18c-8 0-16-6-24-18Z" fill="none" stroke="url(#${id})" stroke-width="8.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  return s;
}
