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
 *   volver a ver en Ajustes (la ruedita) → Diagnóstico y ayuda → «Guía de bienvenida».
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
    + ' background: var(--nx-bg,#070812); }'
    + ' #nexo-welcome-overlay .wel-in { width: 100%; max-width: 370px; display: flex; flex-direction: column; color: #fff; text-align: center; box-sizing: border-box; }'
    + ' #nexo-welcome-overlay .wel-icon { font-size: 60px; line-height: 1; margin: 6px 0 14px; }'
    + ' #nexo-welcome-overlay .wel-title { font-size: 26px; font-weight: 800; letter-spacing: -0.3px; margin: 0 0 12px; background: linear-gradient(90deg,#fff 30%,#b9c4ff); -webkit-background-clip: text; background-clip: text; color: transparent; }'
    + ' #nexo-welcome-overlay .wel-body { font-size: 15px; line-height: 1.6; color: var(--nx-muted); margin: 0 auto; max-width: 320px; min-height: 120px; }'
    + ' #nexo-welcome-overlay .wel-body b { color: #fff; }'
    + ' #nexo-welcome-overlay .wel-dots { display: flex; gap: 7px; justify-content: center; margin: 20px 0 16px; }'
    + ' #nexo-welcome-overlay .wel-dot { width: 8px; height: 8px; border-radius: 50%; background: rgba(255,255,255,0.22); transition: background 0.2s, transform 0.2s; }'
    + ' #nexo-welcome-overlay .wel-dot.on { background: var(--nx-grad); transform: scale(1.25); }'
    + ' #nexo-welcome-overlay .wel-primary { display: block; width: 100%; padding: 15px; border: none; border-radius: 14px; font-size: 16px; font-weight: 700; color: #fff; cursor: pointer; background: var(--nx-grad); box-shadow: 0 10px 30px rgba(0,200,255,0.35), 0 4px 12px rgba(168,85,247,0.35); }'
    + ''
    + ' #nexo-welcome-overlay .wel-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 10px; min-height: 22px; }'
    + ' #nexo-welcome-overlay .wel-ghost { background: transparent; color: var(--nx-muted); border: none; font-size: 14px; padding: 6px 2px; cursor: pointer; }'
    + ' #nexo-welcome-overlay .wel-ghost:disabled { visibility: hidden; }';
  document.head.appendChild(s);
}

// Las diapositivas (icono + título + cuerpo). El cuerpo se arma con t() para es/it/en.
function _slides() {
  return [
    { icon: '👋',
      title: t('welcome_s1_title', 'Bienvenido a NEXO'),
      body: t('welcome_s1_body', 'Mensajería privada que <b>no se queda sin camino</b>: Bluetooth, Wi-Fi, internet o el puente de otro teléfono. Si falla uno, usa otro. Todo va cifrado de extremo a extremo: solo tú y quien recibe pueden leerlo.') },
    { icon: '➕',
      title: t('welcome_s2_title', 'Agrega a tus contactos'),
      body: t('welcome_s2_body', 'Toca el botón <b>+</b> de abajo a la derecha. Si la otra persona está cerca con NEXO abierto, aparece sola: tócala y, cuando acepte, ya pueden hablar. Si está lejos, mándale un <b>enlace</b> (WhatsApp, TikTok…) o agrégala por su <b>NEXO ID</b>.') },
    { icon: '💬',
      title: t('welcome_s3_title', 'Escribe, manda y llama'),
      body: t('welcome_s3_body', 'Abre un chat y escribe. Con el <b>+</b> junto al texto mandas <b>fotos, vídeos, archivos y tu ubicación</b>; en «Más» hay contacto, cobro, stickers, juegos y buscar en el chat. Mantén el <b>micrófono</b> para una nota de voz (desliza a la izquierda para cancelar). Arriba a la derecha: <b>llamada y videollamada</b>.') },
    // dueño 28-11: la guía al día con todas las funciones (inventario del código 28-11)
    { icon: '↩️',
      title: t('welcome_sm_title', 'Tus mensajes'),
      body: t('welcome_sm_body', '<b>Desliza</b> un mensaje para responderlo. <b>Mantenlo presionado</b> para reaccionar, editar (15 min), reenviar, seleccionar varios, destacar, fijar o borrar. <b>Dos toques</b> ponen ❤️. Al revisar una foto o vídeo, el ojo <b>«1»</b> la manda para verse una sola vez. Tocando su foto arriba: buscar, destacados, <b>mensajes temporales</b> y silenciar.') },
    { icon: '👥',
      title: t('welcome_sg_title', 'Grupos'),
      body: t('welcome_sg_body', 'Toca los <b>tres puntos (⋮)</b> de un contacto y elige <b>«Crear grupo»</b>. En el ⋮ del grupo están sus <b>Ajustes</b> (foto, permisos, administradores, agregar personas). Desde la cabecera del grupo haces <b>llamadas de grupo</b>, y manteniendo presionado el fondo lo cambias o lo compartes.') },
    { icon: '📸',
      title: t('welcome_se_title', 'Estados'),
      body: t('welcome_se_body', 'Toca la <b>flecha →</b> de arriba (junto a la lupa) o desliza hacia la <b>izquierda</b>. Toca un círculo para ver sus estados; en «Mi estado» publicas texto, foto, audio o vídeo, y en «Mis estados» eliges <b>quién los ve</b>. Un puntito te avisa de los nuevos.') },
    { icon: '📡',
      title: t('welcome_sc_title', 'También sin internet'),
      body: t('welcome_sc_body', 'Toca el <b>símbolo junto al nombre</b> del chat y te dice por dónde va: Wi-Fi, internet, Bluetooth, <b>salto</b> por otro NEXO o <b>internet prestado</b> de un NEXO cercano. Los archivos grandes van por <b>Wi-Fi Direct</b>. Entre mucha gente, en el menú del chat (toca su foto) puedes <b>buscar a la persona</b>.') },
    { icon: '🔐',
      title: t('welcome_sp_title', 'Tu cuenta, protegida'),
      body: t('welcome_sp_body', 'Todo va cifrado de extremo a extremo; toca el <b>🔒</b> del inicio de un chat para verificar con <b>QR</b>. En <b>Ajustes → Seguridad</b> pones bloqueo con huella o PIN. En <b>Ajustes → Respaldo y cambio de teléfono</b>, <b>Fénix</b> recupera tu cuenta si pierdes el teléfono y «Pasar mi cuenta» la lleva a uno nuevo.') },
    { icon: '🎨',
      title: t('welcome_sa_title', 'Hazla tuya'),
      body: t('welcome_sa_body', 'Mantén presionado un espacio libre (la lista, un chat, Perfil) para cambiar el <b>fondo</b>. En <b>Ajustes → Apariencia</b> eliges el color de las burbujas, el estilo y la letra. La <b>ruedita</b> de arriba abre Ajustes, y esta guía está en Ajustes → Diagnóstico y ayuda.') },
    { icon: '🔋',
      title: t('welcome_s4_title', 'Un paso para que funcione siempre'),
      body: t('welcome_s4_body', 'Cuando agregues a tu primer contacto te pediremos dejar que NEXO funcione en <b>segundo plano</b>: así recibes mensajes y llamadas con la app cerrada o la pantalla apagada.') }
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
