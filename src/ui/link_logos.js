/**
 * NEXO — Logos de TikTok, Instagram, Facebook y YouTube DENTRO de la app (COLA 31, dueño 23-11): la tarjeta segura de un enlace
 * enseña el logo del sitio sin bajar nada de internet. SVG dibujado con nodos (createElementNS), nunca con innerHTML.
 * Formas simplificadas de las marcas; para publicar conviene cambiarlas por los SVG de los kits de marca oficiales.
 */
var NS = 'http://www.w3.org/2000/svg';
var seq = 0;
var TT_NOTE = 'M15.6 4.5c.4 1.8 1.7 3.1 3.5 3.3v2.6c-1.3 0-2.5-.4-3.5-1.1v5a4.6 4.6 0 1 1-4.6-4.6c.3 0 .5 0 .8.1v2.7a2 2 0 1 0 1.3 1.9V4.5z';
var LOGOS = {
  youtube: [['rect', { x: 1, y: 5, width: 22, height: 14, rx: 4.5, fill: '#FF0000' }], ['path', { d: 'M10 8.8l5.6 3.2-5.6 3.2z', fill: '#fff' }]],
  facebook: [['circle', { cx: 12, cy: 12, r: 11, fill: '#1877F2' }],
    ['path', { d: 'M13.4 23v-8.4h2.8l.4-3.3h-3.2V9.2c0-.9.3-1.6 1.6-1.6h1.7V4.7c-.3 0-1.3-.1-2.5-.1-2.5 0-4.2 1.5-4.2 4.3v2.4H7.2v3.3H10V23z', fill: '#fff' }]],
  instagram: [['rect', { x: 1.5, y: 1.5, width: 21, height: 21, rx: 6, fill: 'url(#G)' }],
    ['rect', { x: 5.5, y: 5.5, width: 13, height: 13, rx: 4, fill: 'none', stroke: '#fff', 'stroke-width': 1.8 }],
    ['circle', { cx: 12, cy: 12, r: 3.1, fill: 'none', stroke: '#fff', 'stroke-width': 1.8 }], ['circle', { cx: 16.1, cy: 7.9, r: 1, fill: '#fff' }]],
  tiktok: [['rect', { x: 1, y: 1, width: 22, height: 22, rx: 6, fill: '#000' }],
    ['path', { d: TT_NOTE, fill: '#25F4EE', transform: 'translate(-0.7 -0.7)' }], ['path', { d: TT_NOTE, fill: '#FE2C55', transform: 'translate(0.7 0.7)' }],
    ['path', { d: TT_NOTE, fill: '#fff' }]],
};

function _el(tag, attrs) { var e = document.createElementNS(NS, tag); Object.keys(attrs).forEach(function(k) { e.setAttribute(k, String(attrs[k])); }); return e; }

/** <svg> con el logo del sitio `k` (o null si no hay) */
export function siteLogo(k) {
  var parts = LOGOS[k]; if (!parts) return null;
  var svg = _el('svg', { viewBox: '0 0 24 24', width: 34, height: 34, 'aria-hidden': 'true', focusable: 'false', class: 'nx-lc-svg' });
  var gid = '';
  if (k === 'instagram') {
    gid = 'nxig' + (++seq);
    var g = _el('linearGradient', { id: gid, x1: 0, y1: 1, x2: 1, y2: 0 });
    [['0', '#FEDA75'], ['0.3', '#FA7E1E'], ['0.6', '#D62976'], ['1', '#4F5BD5']].forEach(function(s) { g.appendChild(_el('stop', { offset: s[0], 'stop-color': s[1] })); });
    var defs = _el('defs', {}); defs.appendChild(g); svg.appendChild(defs);
  }
  parts.forEach(function(p) {
    var a = Object.assign({}, p[1]);
    if (a.fill === 'url(#G)') a.fill = 'url(#' + gid + ')';
    svg.appendChild(_el(p[0], a));
  });
  return svg;
}
