/**
 * NEXO — Banner «Activa las notificaciones» en Contactos (3153, diagnóstico real: Honor con las notificaciones denegadas;
 * sin ellas, con la app cerrada no llegan ni mensajes ni llamadas y el dueño no se enteraba: solo quedaba un log).
 * Sin ventanas emergentes: una tarjeta arriba de Contactos con «Activar». Si Android aún deja preguntar, vuelve a pedir el
 * permiso; si no (responde al instante sin diálogo), abre los ajustes de notificaciones de la app. Se comprueba al volver a la
 * app (sin pedir nada) y desaparece sola al concederse. La «✕» la oculta 24 h.
 */
import { t } from './i18n.js';

var HIDE_KEY = 'nexo_notif_banner_hide';
var HIDE_MS = 24 * 3600 * 1000;
var ASK_FAST_MS = 400; // si «denegado» llega antes de esto, Android no mostró diálogo: ya no deja preguntar

function _plugin() { try { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; } catch (e) { return null; } }
function _get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function _set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function _hidden() { var at = parseInt(_get(HIDE_KEY) || '0', 10) || 0; return at > 0 && Date.now() - at < HIDE_MS; }
function _remove() { var b = document.getElementById('nexo-notif-banner'); if (b && b.parentNode) b.parentNode.removeChild(b); }

function _show() {
  if (_hidden() || document.getElementById('nexo-notif-banner')) return;
  var host = document.getElementById('contacts-view');
  if (!host) return;
  var b = document.createElement('div'); b.id = 'nexo-notif-banner'; b.className = 'nx-notif-banner';
  var txt = document.createElement('span'); txt.className = 'nx-notif-txt';
  txt.textContent = t('notif_banner_text', 'Activa las notificaciones de NEXO para recibir mensajes y llamadas con la app cerrada.');
  var go = document.createElement('button'); go.id = 'nexo-notif-go'; go.className = 'nx-notif-go';
  go.textContent = t('notif_banner_btn', 'Activar');
  var x = document.createElement('button'); x.id = 'nexo-notif-x'; x.className = 'nx-notif-x';
  x.textContent = '✕'; x.setAttribute('aria-label', t('notif_banner_close', 'Ocultar 24 horas'));
  b.append(txt, go, x);
  host.insertBefore(b, host.firstChild);
  x.onclick = function() { _set(HIDE_KEY, String(Date.now())); _remove(); };
  go.onclick = function() {
    var pl = _plugin(); if (!pl) return;
    var t0 = Date.now();
    var openSettings = function() { try { Promise.resolve(pl.openAlertSetting({ what: 'notifications' })).catch(function() {}); } catch (e) {} };
    if (typeof pl.ensureNotificationPermission !== 'function') { openSettings(); return; }
    Promise.resolve(pl.ensureNotificationPermission()).then(function(r) {
      if (r && r.granted === true) { _remove(); return; }
      if (Date.now() - t0 < ASK_FAST_MS) openSettings(); // sin diálogo: Android ya no deja preguntar
    }).catch(openSettings);
  };
}

// Comprueba sin pedir nada (alertSettings.notifications) y muestra u oculta el banner
export function notifBannerCheck() {
  var pl = _plugin();
  if (!pl || typeof pl.alertSettings !== 'function') return Promise.resolve();
  return Promise.resolve(pl.alertSettings()).then(function(r) {
    if (!r) return;
    if (r.notifications === false) _show(); else _remove();
  }).catch(function() {});
}

// denied: resultado de ensurePermission en el arranque (granted === false) → mostrar ya; después, al volver a la app, recomprobar
export function notifBannerInit(denied) {
  if (denied === true) _show();
  if (!notifBannerInit._on) {
    notifBannerInit._on = true;
    document.addEventListener('visibilitychange', function() { if (document.visibilityState === 'visible') notifBannerCheck(); });
    document.addEventListener('resume', function() { notifBannerCheck(); });
  }
  return notifBannerCheck();
}
