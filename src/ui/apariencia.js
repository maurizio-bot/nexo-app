/**
 * apariencia.js — Ajustes → Apariencia (cola 33, pedido del dueño 21-11). SOLO estética y SOLO de este teléfono (no viaja al otro):
 *  • Color de las burbujas PROPIAS: un color o dos en degradado (por defecto los de siempre, celeste → morado; «dos» se ofrece primero).
 *  • Estilo: «pleno» (sólido o degradado, como las enviadas de siempre) o «cristal» (translúcido, deja ver el fondo, como las recibidas).
 *  • Tipo de letra de toda la app: pilas de fuentes que YA trae el teléfono (nada se baja de internet ni se añaden archivos de fuentes).
 * Todo va con variables CSS en :root (--burbuja-1, --burbuja-2, --burbuja-txt…, --nx-font) y una clase en <html>
 * (nx-bub-glass, nx-font-custom): nexo_theme.css las usa con los valores de siempre como respaldo, así que SIN elección guardada no cambia
 * ni un estilo calculado. Se guarda como el resto de ajustes locales: archivo cifrado en reposo (plugin saveToFile/loadFromFile).
 * Contraste: si el color elegido es claro, el texto de la burbuja pasa a oscuro (luminancia WCAG) y la hora, los ✓✓ y los enlaces se
 * recalculan para seguir legibles sobre los dos colores.
 */
import { t } from './i18n.js';

export var APAR_FILE = 'nexo_apariencia.json';
export var DEF = { n: 2, c1: '#00c8ff', c2: '#a855f7', estilo: 'pleno', fuente: 'sistema' };
// Paleta rápida (además del selector libre)
export var PALETA = ['#00c8ff', '#a855f7', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#6366f1', '#f97316', '#facc15', '#e5e7eb'];
// Fuentes que ya están en el teléfono: la actual (sin tocar nada), serif, redondeada y monoespaciada. Si el teléfono no trae la
// primera de la pila, el navegador baja a la siguiente (y al final a la genérica): nunca se pide nada a internet.
export var FUENTES = {
  sistema: { nombre: function() { return t('apar_f_sistema', 'La de siempre'); }, pila: '' },
  serif: { nombre: function() { return t('apar_f_serif', 'Con serifa'); }, pila: "Georgia, 'Noto Serif', 'Droid Serif', 'Times New Roman', serif" },
  redonda: { nombre: function() { return t('apar_f_redonda', 'Redondeada'); }, pila: "ui-rounded, 'Nunito', 'Quicksand', 'Varela Round', 'Google Sans', 'Segoe UI', sans-serif" },
  mono: { nombre: function() { return t('apar_f_mono', 'Máquina de escribir'); }, pila: "ui-monospace, 'Roboto Mono', 'Cutive Mono', 'Courier New', monospace" }
};
var HEX = /^#[0-9a-f]{6}$/i;
var _cfg = null;   // elección guardada (o null = de fábrica)

function _pl() { return (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; }

// ---- colores (puras y exportadas: prueba apariencia.js) ----
export function hexRgb(h) { var v = parseInt(String(h).slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }
// Luminancia relativa WCAG (0 negro … 1 blanco)
export function luminancia(h) {
  var c = hexRgb(h).map(function(x) { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function contraste(a, b) { var la = luminancia(a), lb = luminancia(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
function _peor(fg, fondos) { return Math.min.apply(null, fondos.map(function(f) { return contraste(fg, f); })); }
// Color de texto sobre los dos fondos: el que dé mejor contraste en el PEOR de los dos (blanco de siempre si empatan)
export function textoSobre(fondos) { return _peor('#ffffff', fondos) >= _peor('#111111', fondos) ? '#ffffff' : '#111111'; }
function _rgba(h, a) { var c = hexRgb(h); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }

// Normaliza lo leído del archivo (nunca se confía en él): cualquier campo raro vuelve a su valor de fábrica
export function limpiar(o) {
  o = o && typeof o === 'object' ? o : {};
  var r = {
    n: o.n === 1 ? 1 : 2,
    c1: HEX.test(o.c1 || '') ? String(o.c1).toLowerCase() : DEF.c1,
    c2: HEX.test(o.c2 || '') ? String(o.c2).toLowerCase() : DEF.c2,
    estilo: o.estilo === 'cristal' ? 'cristal' : 'pleno',
    fuente: Object.prototype.hasOwnProperty.call(FUENTES, o.fuente) ? o.fuente : 'sistema'
  };
  return r;
}
export function esDeFabrica(c) { return c.n === DEF.n && c.c1 === DEF.c1 && c.c2 === DEF.c2 && c.estilo === DEF.estilo && c.fuente === DEF.fuente; }

// Variables CSS que resultan de una elección (puro: la prueba lo comprueba sin tocar el DOM)
export function variables(c) {
  var c2 = c.n === 1 ? c.c1 : c.c2, v = {};
  v['--burbuja-1'] = c.c1; v['--burbuja-2'] = c2;
  v['--burbuja-1a'] = _rgba(c.c1, 0.34); v['--burbuja-2a'] = _rgba(c2, 0.34);   // versión translúcida (cristal)
  v['--burbuja-borde'] = _rgba(c.c1, 0.55);
  var txt = c.estilo === 'cristal' ? '#ffffff' : textoSobre([c.c1, c2]);       // el cristal se ve sobre el fondo oscuro: texto claro
  var claro = txt !== '#ffffff';
  v['--burbuja-txt'] = txt;
  v['--burbuja-hora'] = claro ? 'rgba(0,0,0,0.62)' : 'rgba(255,255,255,0.7)';
  v['--burbuja-ent'] = claro ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.75)';    // ✓ enviado / entregado
  v['--burbuja-pend'] = claro ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.45)';
  // ✓✓ leído: el celeste de siempre si se distingue (contraste ≥ 3) sobre los dos colores; si no, el mejor de azul oscuro / blanco / negro
  var fondos = c.estilo === 'cristal' ? ['#1a1c2e'] : [c.c1, c2], leido = '#00c8ff';
  if (_peor(leido, fondos) < 3) {
    leido = ['#0a3d91', '#ffffff', '#111111'].sort(function(a, b) { return _peor(b, fondos) - _peor(a, fondos); })[0];
  }
  v['--burbuja-leido'] = leido;
  // enlace: azul oscuro si se distingue (≥ 3) sobre los dos colores; si no, el mejor entre blanco y negro
  var fb = c.estilo === 'cristal' ? ['#1a1c2e'] : [c.c1, c2], enlace = claro ? '#0a3d91' : '#ffffff';
  if (_peor(enlace, fb) < 3) enlace = ['#ffffff', '#111111'].sort(function(a, b) { return _peor(b, fb) - _peor(a, fb); })[0];
  v['--burbuja-enlace'] = enlace;
  return v;
}
var _NOMBRES = ['--burbuja-1', '--burbuja-2', '--burbuja-1a', '--burbuja-2a', '--burbuja-borde', '--burbuja-txt', '--burbuja-hora', '--burbuja-ent', '--burbuja-pend', '--burbuja-leido', '--burbuja-enlace'];

// Pinta la elección en :root. Sin elección (o de fábrica) quita TODO: la app queda exactamente como antes de existir esto.
export function aplicar(c) {
  try {
    var root = document.documentElement, st = root.style;
    _NOMBRES.forEach(function(k) { st.removeProperty(k); });
    st.removeProperty('--nx-font');
    root.classList.remove('nx-bub-custom', 'nx-bub-glass', 'nx-font-custom');
    if (!c || esDeFabrica(c)) return;
    var colores = c.n !== DEF.n || c.c1 !== DEF.c1 || c.c2 !== DEF.c2 || c.estilo !== DEF.estilo;
    if (colores) {
      var v = variables(c);
      Object.keys(v).forEach(function(k) { st.setProperty(k, v[k]); });
      root.classList.add('nx-bub-custom');
      if (c.estilo === 'cristal') root.classList.add('nx-bub-glass');
    }
    if (c.fuente !== 'sistema' && Object.prototype.hasOwnProperty.call(FUENTES, c.fuente)) { st.setProperty('--nx-font', FUENTES[c.fuente].pila); root.classList.add('nx-font-custom'); }
  } catch (e) {}
}

export function aparienciaActual() { return _cfg ? limpiar(_cfg) : limpiar(null); }

function _guardar() {
  var p = _pl();
  if (!p || typeof p.saveToFile !== 'function') return;
  var c = aparienciaActual();
  // De fábrica = archivo vacío ({}): al leerlo vuelve todo a lo de siempre
  var body = esDeFabrica(c) ? {} : { n: c.n, c1: c.c1, c2: c.c2, estilo: c.estilo, fuente: c.fuente };
  try { Promise.resolve(p.saveToFile({ filename: APAR_FILE, content: JSON.stringify(body) })).catch(function() {}); } catch (e) {}
}

// El selector libre de color manda decenas de cambios por segundo al arrastrar: se pinta al momento y se guarda una vez al soltar
var _gT = null;
function _guardarPronto() { if (_gT) clearTimeout(_gT); _gT = setTimeout(function() { _gT = null; _guardar(); }, 300); }
// Cambia lo elegido (parcial), lo pinta y lo guarda
export function setApariencia(parcial) {
  var c = aparienciaActual();
  Object.keys(parcial || {}).forEach(function(k) { c[k] = parcial[k]; });
  _cfg = limpiar(c);
  aplicar(_cfg); _guardarPronto();
  return _cfg;
}
export function restablecerApariencia() { if (_gT) { clearTimeout(_gT); _gT = null; } _cfg = null; aplicar(null); _guardar(); }

// Al arrancar la app: lee el archivo y lo pinta
export function loadApariencia() {
  var p = _pl();
  if (!p || typeof p.loadFromFile !== 'function') return Promise.resolve();
  try {
    return Promise.resolve(p.loadFromFile({ filename: APAR_FILE })).then(function(r) {
      if (!r || !r.exists || !r.content) return;
      var o = null; try { o = JSON.parse(r.content); } catch (e) { return; }
      _cfg = limpiar(o); aplicar(_cfg);
    }).catch(function() {});
  } catch (e) { return Promise.resolve(); }
}

// ---- pantalla de Ajustes ----
export function aparienciaCardHtml() {
  return '<div class="nx-card" id="nexo-apar-card"><div class="nx-h"><span class="nx-ico">🎨</span>' + t('apar_title', 'Apariencia') + '</div>' +
    '<div class="nx-sub">' + t('apar_sub', 'Solo cambia cómo se ve en este teléfono; el otro no lo nota.') + '</div>' +
    '<div class="apar-prev"><div class="message own" id="apar-demo"><div class="msg-content"><span class="msg-text">' + t('apar_demo', 'Así se verán tus mensajes') + ' <a class="nx-link" href="#" onclick="return false">nexo.app</a></span></div>' +
    '<div class="msg-meta"><span class="msg-time">12:34</span><span class="msg-status status-read">✓✓</span></div></div></div>' +
    '<div class="apar-lbl">' + t('apar_colors', 'Color de tus burbujas') + '</div>' +
    '<div class="apar-seg" id="apar-n"><button type="button" data-n="2">' + t('apar_two', 'Dos colores') + '</button><button type="button" data-n="1">' + t('apar_one', 'Un color') + '</button></div>' +
    '<div class="apar-pick" data-k="c1"><span class="apar-k" id="apar-k1">' + t('apar_c1', 'Color 1') + '</span><div class="apar-sw" id="apar-sw1"></div><input type="color" id="apar-in1" aria-labelledby="apar-k1"></div>' +
    '<div class="apar-pick" data-k="c2" id="apar-pick2"><span class="apar-k" id="apar-k2">' + t('apar_c2', 'Color 2') + '</span><div class="apar-sw" id="apar-sw2"></div><input type="color" id="apar-in2" aria-labelledby="apar-k2"></div>' +
    '<div class="apar-lbl">' + t('apar_style', 'Estilo') + '</div>' +
    '<div class="apar-seg" id="apar-estilo"><button type="button" data-e="pleno">' + t('apar_full', 'Pleno') + '</button><button type="button" data-e="cristal">' + t('apar_glass', 'Cristal') + '</button></div>' +
    '<div class="apar-lbl">' + t('apar_font', 'Tipo de letra') + '</div>' +
    '<div class="apar-fonts" id="apar-fuente">' + Object.keys(FUENTES).map(function(k) {
      return '<button type="button" data-f="' + k + '"' + (FUENTES[k].pila ? ' style="font-family:' + FUENTES[k].pila.replace(/"/g, "'") + '"' : '') + '>' + FUENTES[k].nombre() + '</button>';
    }).join('') + '</div>' +
    '<button type="button" id="apar-reset" class="nx-link">' + t('apar_reset', 'Restablecer') + '</button></div>';
}

// Conecta los controles de la tarjeta (se llama al armar Ajustes)
export function aparienciaWire(sheet) {
  var $ = function(s) { return sheet.querySelector(s); };
  if (!$('#nexo-apar-card')) return;
  var pintar = function() {
    var c = aparienciaActual();
    Array.prototype.forEach.call(sheet.querySelectorAll('#apar-n button'), function(b) { b.classList.toggle('on', +b.getAttribute('data-n') === c.n); });
    Array.prototype.forEach.call(sheet.querySelectorAll('#apar-estilo button'), function(b) { b.classList.toggle('on', b.getAttribute('data-e') === c.estilo); });
    Array.prototype.forEach.call(sheet.querySelectorAll('#apar-fuente button'), function(b) { b.classList.toggle('on', b.getAttribute('data-f') === c.fuente); });
    $('#apar-pick2').style.display = c.n === 1 ? 'none' : '';
    $('#apar-in1').value = c.c1; $('#apar-in2').value = c.c2;
    ['1', '2'].forEach(function(i) {
      Array.prototype.forEach.call(sheet.querySelectorAll('#apar-sw' + i + ' button'), function(b) { b.classList.toggle('on', b.getAttribute('data-c') === c['c' + i]); });
    });
  };
  ['1', '2'].forEach(function(i) {
    var cont = $('#apar-sw' + i);
    PALETA.forEach(function(col) {
      var b = document.createElement('button'); b.type = 'button'; b.setAttribute('data-c', col); b.setAttribute('aria-label', col); b.style.background = col;
      b.onclick = function() { var o = {}; o['c' + i] = col; setApariencia(o); pintar(); };
      cont.appendChild(b);
    });
    // selector libre: «input» pinta al momento mientras se arrastra
    $('#apar-in' + i).oninput = function() { var o = {}; o['c' + i] = this.value; setApariencia(o); pintar(); };
  });
  Array.prototype.forEach.call(sheet.querySelectorAll('#apar-n button'), function(b) { b.onclick = function() { setApariencia({ n: +b.getAttribute('data-n') }); pintar(); }; });
  Array.prototype.forEach.call(sheet.querySelectorAll('#apar-estilo button'), function(b) { b.onclick = function() { setApariencia({ estilo: b.getAttribute('data-e') }); pintar(); }; });
  Array.prototype.forEach.call(sheet.querySelectorAll('#apar-fuente button'), function(b) { b.onclick = function() { setApariencia({ fuente: b.getAttribute('data-f') }); pintar(); }; });
  $('#apar-reset').onclick = function() { restablecerApariencia(); pintar(); };
  pintar();
}
