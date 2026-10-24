/**
 * NEXO — Piezas pequeñas de la interfaz (sacadas de main.js en la ronda 2752, sin cambios): avisos en pantalla
 * (error de permiso, información), menú de adjuntar, plugins de cámara/archivos, liberar un vídeo/imagen y si el
 * contacto tiene Wi-Fi Direct.
 */

// v9.9.48: "camino rápido": Wi-Fi Direct o la misma red Wi-Fi (lan.js); por ellos fotos, vídeos y archivos grandes
export function _wdReach(contactId) {
  var bi = window.bleInterface;
  if (!bi || !contactId) return false;
  return !!((bi.lan && bi.lan.canReach(contactId)) || (bi.wifiDirect && bi.wifiDirect.canReach(contactId)));
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

export function _showPermissionError(permName) {
  var existing = document.getElementById('perm-error-toast');
  if (existing) existing.remove();
  var toast = document.createElement('div');
  toast.id = 'perm-error-toast';
  toast.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:rgba(255,59,48,0.95);color:#fff;padding:12px 20px;border-radius:12px;font-size:13px;font-weight:600;z-index:10000;backdrop-filter:blur(4px);box-shadow:0 4px 20px rgba(0,0,0,0.4);max-width:90vw;text-align:center;';
  // Si el mensaje ya es descriptivo (tamaño), no añadir el prefijo de permiso
  if (permName && (permName.indexOf('Archivo') === 0 || permName.indexOf('Video') === 0 || permName.indexOf('demasiado') > -1)) {
    toast.innerHTML = permName;
  } else {
    toast.innerHTML = 'Permiso de ' + permName + ' denegado.<span style="font-size:11px;opacity:0.8;font-weight:400;">Ve a Ajustes > Aplicaciones > NEXO > Permisos</span>';
  }
  document.body.appendChild(toast);
  setTimeout(function() {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.5s';
    setTimeout(function() { toast.remove(); }, 500);
  }, 4000);
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
  var t = document.getElementById('perm-error-toast');
  if (t && t.className === 'info-toast') t.remove();
}
