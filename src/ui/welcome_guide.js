/**
 * NEXO — Guía de bienvenida (la PRIMERA vez que se abre la app). Pedido del dueño 05-11: «¿creas una mini guía para la
 * primera descarga?» → DENTRO de la app, una pantalla de bienvenida que aparece sola la primera vez.
 *
 * Son unas pocas diapositivas cortas, con la estética NEXO (degradado cian→violeta), que explican lo básico: qué es
 * NEXO, cómo agregar el primer contacto y mandar el primer mensaje, y un último paso (dejar que NEXO funcione en
 * segundo plano) que enlaza con el aviso de batería de siempre (battery_prompt.js). No toca nada del protocolo ni de la
 * lógica de la app: es solo una capa informativa que se cierra con «Empezar».
 *
 * - Se muestra UNA sola vez (marca `nexo_welcome_done` en localStorage, igual que el aviso de batería). Luego se puede
 *   volver a ver en Perfil → Ajustes → «Guía de bienvenida».
 * - Al terminar (o al saltarla) llama a onDone(): en el arranque, eso dispara el aviso de batería a continuación, de
 *   modo que el usuario nuevo ve primero la bienvenida y después el único paso que hace falta para que funcione siempre.
 * - Sin dependencias nativas: se prueba en el simulador (tests/sim/welcome.js) arrancando la app como un teléfono nuevo.
 */

import { t } from './i18n.js';

var DONE_KEY = 'nexo_welcome_done';

function _get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function _set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

/** ¿Hace falta mostrar la bienvenida? Lógica PURA (testeable): sí salvo que ya se haya visto (o se fuerce desde Ajustes). */
export function welcomeNeeded(seen, force) { return !!force || !seen; }

/** ¿Ya se vio la bienvenida alguna vez en este teléfono? */
export function welcomeSeen() { return _get(DONE_KEY) === '1'; }

function _injectStyles() {
  if (typeof document === 'undefined' || document.getElementById('nexo-welcome-styles')) return;
  var s = document.createElement('style');
  s.id = 'nexo-welcome-styles';
  s.textContent = '#nexo-welcome-overlay { position: fixed; inset: 0; z-index: 2147483646; display: flex; align-items: center; justify-content: center; padding: 18px; box-sizing: border-box;'
    + ' background: radial-gradient(circle at 18% 8%, rgba(0,200,255,0.16), transparent 42%), radial-gradient(circle at 88% 92%, rgba(168,85,247,0.18), transparent 46%), linear-gradient(170deg,#0a0a15 0%,#10112a 55%,#0b1428 100%); }'
    + ' #nexo-welcome-overlay .wel-in { width: 100%; max-width: 370px; display: flex; flex-direction: column; color: #fff; text-align: center; box-sizing: border-box; }'
    + ' #nexo-welcome-overlay .wel-icon { font-size: 60px; line-height: 1; margin: 6px 0 14px; }'
    + ' #nexo-welcome-overlay .wel-title { font-size: 23px; font-weight: 800; margin: 0 0 12px; background: linear-gradient(135deg,#00c8ff,#a855f7); -webkit-background-clip: text; background-clip: text; color: transparent; }'
    + ' #nexo-welcome-overlay .wel-body { font-size: 15px; line-height: 1.6; color: #cdd3e6; margin: 0 auto; max-width: 320px; min-height: 120px; }'
    + ' #nexo-welcome-overlay .wel-body b { color: #fff; }'
    + ' #nexo-welcome-overlay .wel-dots { display: flex; gap: 7px; justify-content: center; margin: 20px 0 16px; }'
    + ' #nexo-welcome-overlay .wel-dot { width: 8px; height: 8px; border-radius: 50%; background: rgba(255,255,255,0.22); transition: background 0.2s, transform 0.2s; }'
    + ' #nexo-welcome-overlay .wel-dot.on { background: linear-gradient(135deg,#00c8ff,#a855f7); transform: scale(1.25); }'
    + ' #nexo-welcome-overlay .wel-primary { display: block; width: 100%; padding: 15px; border: none; border-radius: 14px; font-size: 16px; font-weight: 700; color: #fff; cursor: pointer; background: linear-gradient(135deg,#00c8ff,#a855f7); box-shadow: 0 8px 22px rgba(0,200,255,0.3); }'
    + ''
    + ' #nexo-welcome-overlay .wel-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 10px; min-height: 22px; }'
    + ' #nexo-welcome-overlay .wel-ghost { background: transparent; color: #8b93ab; border: none; font-size: 14px; padding: 6px 2px; cursor: pointer; }'
    + ' #nexo-welcome-overlay .wel-ghost:disabled { visibility: hidden; }';
  document.head.appendChild(s);
}

// Las diapositivas (icono + título + cuerpo). El cuerpo se arma con t() para es/it/en.
function _slides() {
  return [
    { icon: '👋',
      title: t('welcome_s1_title', 'Bienvenido a NEXO'),
      body: t('welcome_s1_body', 'Mensajería privada que funciona <b>sin internet</b>: directo entre teléfonos por Bluetooth y Wi-Fi. Tus mensajes van cifrados de extremo a extremo, solo tú y quien recibe pueden leerlos.') },
    { icon: '➕',
      title: t('welcome_s2_title', 'Agrega tu primer contacto'),
      body: t('welcome_s2_body', 'Toca el botón <b>+</b> (abajo a la derecha). Si la otra persona está cerca con NEXO abierto, aparece sola. Si está lejos, comparte tu <b>NEXO ID</b> (👤 Perfil → «Compartir mi ID») o agrégala por el suyo.') },
    { icon: '💬',
      title: t('welcome_s3_title', 'Manda tu primer mensaje'),
      body: t('welcome_s3_body', 'Abre el contacto y escribe. Puedes enviar <b>fotos, vídeos, audios y archivos</b>, y hacer <b>llamadas y videollamadas</b>. Todo directo entre los teléfonos, aunque no haya señal.') },
    { icon: '🔋',
      title: t('welcome_s4_title', 'Un paso para que funcione siempre'),
      body: t('welcome_s4_body', 'Para recibir mensajes y llamadas con la app cerrada o la pantalla apagada, deja que NEXO funcione en <b>segundo plano</b>. Te lo pedimos ahora, es rápido.') }
  ];
}

/**
 * Muestra la bienvenida si hace falta. opts: { force, onDone }.
 *  - force: true → se muestra aunque ya se haya visto (para «ver la guía otra vez» desde Ajustes). No marca el flag.
 *  - onDone(): se llama al cerrar (o si no hacía falta mostrarla). En el arranque dispara el aviso de batería.
 */
export function welcomeGuide(opts) {
  opts = opts || {};
  var force = !!opts.force;
  var done = typeof opts.onDone === 'function' ? opts.onDone : function () {};
  if (typeof document === 'undefined') { done(); return; }
  if (!welcomeNeeded(welcomeSeen(), force)) { done(); return; }           // ya vista: paso directo al onDone (p. ej. batería)
  if (document.getElementById('nexo-welcome-overlay')) return;            // ya está en pantalla
  _injectStyles();

  var slides = _slides();
  var i = 0;
  var finished = false;

  var overlay = document.createElement('div');
  overlay.id = 'nexo-welcome-overlay';
  var box = document.createElement('div');
  box.className = 'wel-in';
  overlay.appendChild(box);

  var icon = document.createElement('div'); icon.className = 'wel-icon';
  var title = document.createElement('div'); title.className = 'wel-title';
  var body = document.createElement('div'); body.className = 'wel-body';
  var dots = document.createElement('div'); dots.className = 'wel-dots';
  for (var d = 0; d < slides.length; d++) { var dot = document.createElement('div'); dot.className = 'wel-dot'; dots.appendChild(dot); }
  var primary = document.createElement('button'); primary.className = 'wel-primary'; primary.id = 'nexo-welcome-next';
  var row = document.createElement('div'); row.className = 'wel-row';
  var back = document.createElement('button'); back.className = 'wel-ghost'; back.id = 'nexo-welcome-back'; back.textContent = t('welcome_back', '‹ Atrás');
  var skip = document.createElement('button'); skip.className = 'wel-ghost'; skip.id = 'nexo-welcome-skip'; skip.textContent = t('welcome_skip', 'Saltar');
  row.append(back, skip);
  box.append(icon, title, body, dots, primary, row);

  function render() {
    var s = slides[i];
    icon.textContent = s.icon;
    title.textContent = s.title;
    body.innerHTML = s.body;   // texto FIJO de la propia app (i18n), sin datos de nadie → seguro
    var kids = dots.children;
    for (var k = 0; k < kids.length; k++) kids[k].className = 'wel-dot' + (k === i ? ' on' : '');
    var last = i === slides.length - 1;
    primary.textContent = last ? t('welcome_start', 'Empezar') : t('welcome_next', 'Siguiente');
    back.disabled = i === 0;                 // en la 1ª no hay «Atrás»
    skip.style.visibility = last ? 'hidden' : '';   // en la última ya no tiene sentido «Saltar»
  }

  function finish() {
    if (finished) return;
    finished = true;
    if (!force) _set(DONE_KEY, '1');         // vista: no vuelve a salir sola (sí desde Ajustes). «Ver otra vez» no la marca.
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    try { done(); } catch (e) {}
  }

  primary.onclick = function () { if (i < slides.length - 1) { i++; render(); } else finish(); };
  back.onclick = function () { if (i > 0) { i--; render(); } };
  skip.onclick = finish;

  document.body.appendChild(overlay);
  render();
}

// UMD / global, como el resto de módulos de UI (y gancho para el simulador)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { welcomeGuide: welcomeGuide, welcomeNeeded: welcomeNeeded, welcomeSeen: welcomeSeen };
} else if (typeof window !== 'undefined') {
  window.NEXO_welcome = welcomeGuide;
  try { window.__nexoWelcomeNeeded = welcomeNeeded; } catch (e) {}
}
