/**
 * NEXO — Enlace de invitación (3129, PLAN etapa 2; dueño 15-11: «WhatsApp y TikTok… tu ajuste me parece bien»; la página va en su
 * GitHub). En «Agregar contactos», «Invitar a NEXO» comparte un texto corto con un enlace:
 *   https://maurizio-bot.github.io/nexo-app/i#NX12345678-ABCDEFGH
 * con mi NEXO ID y un código de UN uso que caduca a los 7 días (después de «#»: el navegador no lo manda a ningún servidor).
 * Quien lo toca con NEXO instalado abre la app con ese ID ya puesto en «Agregar por NEXO ID» (nativo: InviteLink.kt); sin la app
 * (o mientras no haya página), basta pegar el enlace o el texto entero en ese campo. La solicitud lleva el código y en mi bandeja
 * sale «aceptó tu invitación»; se sigue aceptando A MANO (SEC-2, 07-11: nada entra solo, por los impostores).
 * Perillas de prueba: window.NEXO_INVITE_BASE (otra dirección https), window.NEXO_INVITE_NOW (reloj).
 */
import { t } from './i18n.js';

export var INVITE_BASE = 'https://maurizio-bot.github.io/nexo-app/i';
var KEY = 'nexo_invites', TTL_MS = 7 * 24 * 3600 * 1000, MAX = 30;
var ALPHA = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // sin 0/O, 1/I/L: se puede dictar
var CODE_RE = /^[2-9A-HJ-NP-Z]{8}$/;
// Apps para compartir (la primera instalada; si ninguna, el menú del teléfono)
export var SHARE_TARGETS = { whatsapp: ['com.whatsapp', 'com.whatsapp.w4b'], tiktok: ['com.zhiliaoapp.musically', 'com.ss.android.ugc.trill'], more: [] };

function _now() { return (typeof window !== 'undefined' && typeof window.NEXO_INVITE_NOW === 'function') ? window.NEXO_INVITE_NOW() : Date.now(); }
function _base() { var b = typeof window !== 'undefined' && window.NEXO_INVITE_BASE; return (typeof b === 'string' && /^https:\/\/[^\s#]+$/.test(b)) ? b : INVITE_BASE; }
function _load() { try { var v = JSON.parse(localStorage.getItem(KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } }
function _save(m) { try { localStorage.setItem(KEY, JSON.stringify(m)); } catch (e) {} }
function _prune(m) {
  var now = _now(), keys = Object.keys(m).filter(function(c) { return m[c] && now - (m[c].at || 0) < TTL_MS; });
  keys.sort(function(a, b) { return (m[b].at || 0) - (m[a].at || 0); });
  var out = {}; keys.slice(0, MAX).forEach(function(c) { out[c] = m[c]; });
  return out;
}
function _code() {
  var r = new Uint8Array(8), s = '';
  crypto.getRandomValues(r);
  for (var i = 0; i < 8; i++) s += ALPHA.charAt(r[i] % ALPHA.length);
  return s;
}

/** Enlace con mi NEXO ID y un código. */
export function inviteLink(myId, code) { return _base() + '#' + String(myId || '').toUpperCase() + (code ? '-' + code : ''); }
/** Texto de la invitación (el del idioma de la app) con el enlace. */
export function inviteText(link) { return t('invite_text', 'Te invito a NEXO: mensajes y llamadas aunque no haya señal, sin número de teléfono y cifrado de punta a punta. Toca aquí para agregarme: {link}').replace('{link}', link); }

/** Invitación nueva: guarda el código (7 días, un uso) y devuelve { code, link, text }; null sin NEXO ID. */
export function createInvite(myId) {
  if (!/^nx[0-9a-z]{8}$/i.test(String(myId || ''))) return null;
  var m = _prune(_load()), code = _code();
  while (m[code]) code = _code();
  m[code] = { at: _now(), used: 0 };
  _save(_prune(m));
  var link = inviteLink(myId, code);
  return { code: code, link: link, text: inviteText(link) };
}

/** De un enlace, el texto entero de la invitación o un ID suelto: { id: 'nx…', code: 'ABCDEFGH' | '' }; null si no hay ID. */
export function parseInvite(text) {
  var s = String(text || '').slice(0, 600).toUpperCase();
  var m = s.match(/NX[0-9A-Z]{8}(?:-([2-9A-HJ-NP-Z]{8}))?(?![0-9A-Z])/) || s.match(/NX[0-9A-Z]{8}/);
  if (!m) return null;
  return { id: m[0].slice(0, 10).toLowerCase(), code: m[1] || '' };
}

/** ¿Este código es una invitación MÍA vigente y sin usar? Si `use`, queda usada (un uso). */
export function takeInviteCode(code, use) {
  if (!CODE_RE.test(String(code || ''))) return false;
  var m = _prune(_load()), e = m[code];
  if (!e || e.used) return false;
  if (use) { e.used = _now(); _save(m); }
  return true;
}
export function inviteCodeOk(code) { return CODE_RE.test(String(code || '')); }

/** Compartir una invitación nueva por WhatsApp / TikTok / el menú del teléfono. Devuelve una promesa con el camino ('copiado' si solo se pudo copiar). */
export function shareInvite(target, myId) {
  var inv = createInvite(myId);
  if (!inv) return Promise.reject(new Error(t('invite_share_fail', 'No se pudo compartir la invitación')));
  var pl = (typeof window !== 'undefined') && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE;
  var pkgs = SHARE_TARGETS[target] || [];
  console.log('[INVITE] invitación nueva (' + target + '), caduca en 7 días');
  if (pl && typeof pl.shareText === 'function') return Promise.resolve(pl.shareText({ text: inv.text, pkgs: pkgs })).then(function(r) { return (r && r.via) || target; });
  if (typeof navigator !== 'undefined' && navigator.share) return navigator.share({ text: inv.text }).then(function() { return 'menu'; });
  if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(inv.text).then(function() { return 'copiado'; });
  return Promise.reject(new Error(t('invite_share_fail', 'No se pudo compartir la invitación')));
}

// Gancho de pruebas
try { if (typeof window !== 'undefined') window.__nexoInvite = { create: createInvite, parse: parseInvite, take: takeInviteCode, link: inviteLink, share: shareInvite }; } catch (e) {}
