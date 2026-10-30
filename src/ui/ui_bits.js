/**
 * NEXO — Piezas pequeñas de la interfaz (sacadas de main.js en la ronda 2752, sin cambios): avisos en pantalla
 * (error de permiso, información), menú de adjuntar, plugins de cámara/archivos, liberar un vídeo/imagen y si el
 * contacto tiene Wi-Fi Direct.
 */

import { t } from './i18n.js';

// v9.9.48: "camino rápido": Wi-Fi Direct o la misma red Wi-Fi (lan.js); por ellos fotos, vídeos y archivos grandes
export function _wdReach(contactId) {
  var bi = window.bleInterface;
  if (!bi || !contactId) return false;
  return !!((bi.lan && bi.lan.canReach(contactId)) || (bi.wifiDirect && bi.wifiDirect.canReach(contactId)));
}

// Ronda 2780 (pedido del dueño): el contacto puede ir por internet (anunció nt y tiene clave aceptada). Vale aunque no
// esté en línea ahora: por internet las fotos y archivos medianos pueden ir por Tor directo o al buzón de los relés (y
// llegan cuando el otro abre). No depende de que los relés estén conectados en este instante.
export function _netReach(contactId) {
  var bi = window.bleInterface;
  if (!bi || !contactId || !bi.net || typeof bi.net._netContacts !== 'function') return false;
  var nx = (contactId || '').toString().toLowerCase();
  try { return bi.net._netContacts().some(function(c) { return (c.nexoId || c.deviceUUID || '').toLowerCase() === nx; }); } catch (e) { return false; }
}

// Ronda 2780: ¿hay un camino LOCAL para archivos grandes con el contacto (misma red Wi-Fi, Wi-Fi Direct o Bluetooth
// L2CAP)? Si lo hay, el archivo grande va por ahí (rápido, gratis y lo primero según la regla del dueño) con big_file.js;
// no se sube el tope del sobre para que no salga por internet en su lugar ni se quede en trozos lentos por Bluetooth.
export function _bigLocalRoute(contactId) {
  var bi = window.bleInterface;
  if (!bi || !contactId || !bi.bigFiles || typeof bi.bigFiles.route !== 'function') return false;
  try { return !!bi.bigFiles.route(contactId); } catch (e) { return false; }
}

export function _getAttachmentPlugins() {
  var Plugins = window.Capacitor ? window.Capacitor.Plugins : null;
  return {
    Camera: Plugins ? Plugins.Camera : null,
    Filesystem: Plugins ? Plugins.Filesystem : null,
    Geolocation: Plugins ? Plugins.Geolocation : null
  };
}

export function _toggleAttachMenu() {
  var menu = document.getElementById('attach-menu');
  if (menu) {
    menu.classList.toggle('hidden');
    menu.classList.toggle('visible');
  }
}

export function _closeAttachMenu() {
  var menu = document.getElementById('attach-menu');
  if (menu) {
    menu.classList.add('hidden');
    menu.classList.remove('visible');
  }
}

// v9.9.32: liberar el reproductor de verdad (en Android quitarlo del DOM no suelta el decodificador)
export function _releaseMedia(root) {
  if (!root) return;
  Array.prototype.forEach.call(root.querySelectorAll('video,audio'), function(m) {
    try { m.pause(); } catch (e) {}
    try { m.removeAttribute('src'); m.load(); } catch (e) {}
  });
}

export function _showPermissionError(permName, ms) {
  var existing = document.getElementById('perm-error-toast');
  if (existing) existing.remove();
  var toast = document.createElement('div');
  toast.id = 'perm-error-toast';
  toast.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:rgba(255,59,48,0.95);color:#fff;padding:12px 20px;border-radius:12px;font-size:13px;font-weight:600;z-index:10000;backdrop-filter:blur(4px);box-shadow:0 4px 20px rgba(0,0,0,0.4);max-width:90vw;text-align:center;';
  // Una palabra (micrófono, ubicación…): permiso denegado y dónde darlo; si no, el mensaje tal cual. Ronda 2771: antes
  // solo se reconocían algunos mensajes y salía "Permiso de Demasiado grande… denegado" o "Permiso de (micrófono) no
  // encontrado denegado"
  if (permName && /[\s:]/.test(String(permName).trim())) {
    toast.textContent = permName;
  } else {
    toast.innerHTML = t('misc_perm_of', 'Permiso de ') + permName + t('misc_perm_denied', ' denegado.') + '<span style="display:block;margin-top:4px;font-size:11px;opacity:0.8;font-weight:400;">' + t('misc_perm_goto', 'Ve a Ajustes > Aplicaciones > NEXO > Permisos') + '</span>';
  }
  document.body.appendChild(toast);
  // Ronda 2792 (diagnóstico del dueño): un aviso largo (p. ej. «archivo demasiado grande para internet…») en 4 s, justo
  // al cerrarse el selector, se perdía («no avisa»). Se permite pasar una duración mayor para esos avisos.
  setTimeout(function() {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.5s';
    setTimeout(function() { toast.remove(); }, 500);
  }, ms || 4000);
}

// v9.9.43: aviso informativo (no de error) arriba de la pantalla; ms = cuánto se ve
export function _showInfoToast(text, ms) {
  var existing = document.getElementById('perm-error-toast');
  if (existing) existing.remove();
  var toast = document.createElement('div');
  toast.id = 'perm-error-toast';
  toast.className = 'info-toast';
  toast.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:rgba(0,130,252,0.95);color:#fff;padding:12px 20px;border-radius:12px;font-size:13px;font-weight:600;z-index:10000;box-shadow:0 4px 20px rgba(0,0,0,0.4);max-width:90vw;text-align:center;';
  toast.textContent = text;
  document.body.appendChild(toast);
  setTimeout(function() { if (toast.parentNode) toast.remove(); }, ms || 4000);
}

export function _hideInfoToast() {
  var el = document.getElementById('perm-error-toast');
  if (el && el.className === 'info-toast') el.remove();
}
