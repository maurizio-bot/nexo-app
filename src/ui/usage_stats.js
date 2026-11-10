/**
 * NEXO — Resumen diario de uso al desarrollador (2989; pendiente importante #2 de la conversación del dueño 10-11: «responde ¿lo usan entre
 * ellos? sin preguntar»). Cuenta, en este teléfono, SOLO NÚMEROS por día: mensajes enviados y recibidos, cuántos llegaron (✓✓) y cuántos se
 * leyeron, adjuntos por tipo y con cuántos chats hubo actividad. Nunca contenido, nombres ni identificadores de terceros (los chats se
 * cuentan por una marca corta y no vuelven a salir). Al abrir la app un día nuevo, el resumen del último día completo sale al desarrollador por
 * el mismo canal cifrado del diagnóstico automático (`nexo_diag`, síntoma «resumen_diario»), una vez por día y sujeto al MISMO interruptor
 * (Perfil → Ajustes → Diagnóstico automático). Un día en que la app se abrió pero no se escribió nada también se informa (eso ES el dato).
 * Los contadores viven en localStorage (`nexo_usage`, últimos 14 días).
 * Perillas de prueba (tests/sim/usage.js): window.__nexoUsage.
 */
import { vaultSetUsageHook } from '../vault/vault_manager.js';
import { _getBLEContacts, _showToast } from './ble_helpers.js';
import { autoDiagSendSummary, autoDiagBuild } from './autodiag.js';
import { t } from './i18n.js';

var KEY = 'nexo_usage', KEY_SENT = 'nexo_usage_sent', KEY_TRY = 'nexo_usage_try', KEY_FIRST = 'nexo_usage_first';
var KEEP_DAYS = 14, RETRY_MS = 60 * 60 * 1000;

function _lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function _lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function _load() { try { var o = JSON.parse(_lsGet(KEY) || '{}'); return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; } }
function _save(o) {
  var keys = Object.keys(o).sort();
  while (keys.length > KEEP_DAYS) delete o[keys.shift()];
  _lsSet(KEY, JSON.stringify(o));
}
/** Día LOCAL del teléfono (AAAA-MM-DD): «ayer» es el de quien lo usa. */
export function usageDayKey(ms) {
  var d = new Date(ms == null ? Date.now() : ms), p = function(n) { return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function _hash(s) { var h = 5381; s = String(s || ''); for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); }
function _day(o, key) { return o[key] || (o[key] = { o: 0, s: 0, r: 0, d: 0, rd: 0, t: {}, c: [] }); }
function _kind(m) { var a = m && m.attachmentType; return !a ? 'texto' : (/^(image|video|audio|file|location|contact)$/.test(a) ? a : 'otro'); }

/** Gancho del almacén: un mensaje NUEVO (kind 'msg') o un cambio de estado de uno propio (kind 'status'). */
function _hook(kind, cid, m, prevStatus) {
  try {
    if (!m || m.hidden) return;
    var o = _load(), day = _day(o, usageDayKey(kind === 'msg' ? (m.timestamp || Date.now()) : Date.now()));
    if (kind === 'msg') {
      if (m._own) day.s++; else day.r++;
      var k = _kind(m); day.t[k] = (day.t[k] || 0) + 1;
      var h = _hash(cid); if (day.c.indexOf(h) < 0) day.c.push(h);
    } else if (kind === 'status' && m._own) {
      var st = m.status;
      if ((st === 'delivered' || st === 'read') && prevStatus !== 'delivered' && prevStatus !== 'read') day.d++;
      if (st === 'read' && prevStatus !== 'read') day.rd++;
    } else return;
    _save(o);
  } catch (e) {}
}

/** Texto del resumen de un día (solo números). */
export function usageSummaryText(key) {
  var d = _load()[key]; if (!d) return null;
  var tipos = ['image', 'video', 'audio', 'file', 'location', 'contact', 'otro'].filter(function(k) { return d.t && d.t[k]; }).map(function(k) { return k + ' ' + d.t[k]; }).join(' · ') || 'ninguno';
  var contactos = 0; try { contactos = (_getBLEContacts() || []).length; } catch (e) {}
  return 'abierta la app: ' + (d.o ? 'sí' : 'no') + '\n' +
    'mensajes enviados: ' + d.s + ' · recibidos: ' + d.r + '\n' +
    'de los enviados: llegaron (✓✓) ' + d.d + ' · leídos ' + d.rd + '\n' + // i18n-ok: texto para el desarrollador
    'por tipo (enviados y recibidos): texto ' + (d.t.texto || 0) + ' · adjuntos: ' + tipos + '\n' +
    'chats con actividad: ' + (d.c ? d.c.length : 0) + ' de ' + contactos + ' contactos';
}

/** Manda el resumen del último día COMPLETO sin enviar (el de hoy no: está a medias). Devuelve el estado, p. ej. 'enviado', 'ya_enviado', 'sin_datos'. */
export function usageMaybeSend(force) {
  var today = usageDayKey(), o = _load(), sentUpTo = _lsGet(KEY_SENT) || '';
  var days = Object.keys(o).filter(function(k) { return k < today && k > sentUpTo; }).sort();
  if (!days.length) return 'sin_datos';
  var key = days[days.length - 1];           // el más reciente sin enviar (si hubo varios días sin abrir, solo ese: lo viejo ya no importa)
  if (!force && Date.now() - (parseInt(_lsGet(KEY_TRY), 10) || 0) < RETRY_MS) return 'espera';
  _lsSet(KEY_TRY, String(Date.now()));
  var text = usageSummaryText(key);
  if (!text) return 'sin_datos';
  var r = autoDiagSendSummary(key, text);
  if (r === 'enviado' || r === 'local') {
    _lsSet(KEY_SENT, key);
    console.log('[USO] resumen de ' + key + ' mandado (' + r + ')');
    if (!_lsGet(KEY_FIRST) && r === 'enviado') { _lsSet(KEY_FIRST, '1'); try { _showToast(t('usage_first_toast', 'Una vez al día se manda al desarrollador un resumen de uso: solo números, sin mensajes ni nombres. Puedes apagarlo en Perfil.'), 'info'); } catch (e) {} }
    return r === 'local' ? 'enviado' : r;
  }
  console.log('[USO] resumen de ' + key + ' no se mandó: ' + r);
  if (r === 'apagado') _lsSet(KEY_SENT, key);   // apagado a propósito: no se junta para después
  return r;
}

/** Arranque (main.js): engancha los contadores, marca el día como «abierta» y, ya con la app en marcha, manda el resumen pendiente. */
export function usageInit() {
  try {
    vaultSetUsageHook(_hook);
    var o = _load(); _day(o, usageDayKey()).o = 1; _save(o);
    setTimeout(function() { usageMaybeSend(false); }, 25000);
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'visible') { var o2 = _load(); _day(o2, usageDayKey()).o = 1; _save(o2); usageMaybeSend(false); }
    });
  } catch (e) {}
}

try { if (typeof window !== 'undefined') window.__nexoUsage = { key: usageDayKey, text: usageSummaryText, send: usageMaybeSend, load: _load, build: autoDiagBuild }; } catch (e) {}
