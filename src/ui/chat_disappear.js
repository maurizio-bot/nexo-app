/**
 * 3360 (plan del dueño 27-11, docs/PLAN_CAPACIDAD_27-11.md §6): MENSAJES TEMPORALES por chat (desactivado / 24 h / 7 días / 90 días).
 * - Se elige en las opciones del chat (tocar la foto de la cabecera) y vale para los DOS (o todo el grupo): viaja como acción oculta
 *   { act:'dsp', ttl, ts } (en un grupo con g). Gana el cambio más nuevo (ts); un cambio viejo que llega tarde no pisa uno nuevo.
 * - Se borran (de los dos teléfonos, cada uno el suyo) los mensajes de ese chat escritos DESPUÉS de activarlo y más viejos que el plazo.
 *   Lo anterior a activarlo se queda (como en las demás apps). Se revisa al abrir la app, al abrir el chat y cada minuto.
 * - Guardado en el teléfono (localStorage); sin red, el cambio sale cuando haya camino (como cualquier mensaje oculto).
 */
import { t } from './i18n.js';
import { _sendTextTo } from './send.js';
import { _normId, _myNexoId, _getCurrentContactId } from './chat_format.js';
import { vaultLoadMessages, vaultDeleteMessage } from '../vault/vault_manager.js';
import { _showInfoToast } from './ui_bits.js';

var KEY = 'nexo_disappear';
export var DSP_TTLS = [0, 86400000, 7 * 86400000, 90 * 86400000];
var SWEEP_MS = 60000;
var _sweepT = null;

function _all() { try { var o = JSON.parse(localStorage.getItem(KEY) || '{}'); return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; } }
function _saveAll(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {} }
function _groups() { return window.bleInterface && window.bleInterface.groups; }

export function disappearOf(cid) { var e = _all()[_normId(cid)]; return e && e.ttl > 0 ? e : null; }
export function disappearLabel(ttl) {
  if (ttl >= 90 * 86400000) return t('dsp_90d', '90 días');
  if (ttl >= 7 * 86400000) return t('dsp_7d', '7 días');
  if (ttl > 0) return t('dsp_24h', '24 horas');
  return t('dsp_off', 'Desactivados');
}

function _apply(cid, ttl, ts, by) {
  var all = _all(), cur = all[cid];
  if (cur && cur.ts >= ts) return false;
  all[cid] = { ttl: ttl, ts: ts, by: by || '' };
  _saveAll(all);
  return true;
}

function _send(cid, ttl, ts) {
  var act = { type: 'nexo_act', act: 'dsp', ttl: ttl, ts: ts }, gs = _groups(), g = gs && gs.isGroup && gs.isGroup(cid) ? gs.get(cid) : null, me = _myNexoId(), n = 0;
  if (g) {
    if (g.left) return 0;
    act.g = g.id;
    var wire = JSON.stringify(act);
    (g.members || []).forEach(function(nx) { var k = _normId(nx); if (k && k !== me) { _sendTextTo(k, wire, '', true); n++; } });
    return n;
  }
  _sendTextTo(cid, JSON.stringify(act), '', true);
  return 1;
}

// Elegir el plazo en este chat (lo manda al otro / al grupo)
export function setDisappear(cid, ttl) {
  cid = _normId(cid);
  if (!cid || DSP_TTLS.indexOf(ttl) < 0) return false;
  var cur = _all()[cid], ts = Math.max(Date.now(), ((cur && cur.ts) || 0) + 1);
  _apply(cid, ttl, ts, _myNexoId());
  _send(cid, ttl, ts);
  console.log('[DSP] Mensajes temporales en ' + cid + ': ' + (ttl ? Math.round(ttl / 3600000) + ' h' : 'desactivados')); // i18n-ok: registro
  try { window.dispatchEvent(new CustomEvent('nexo:disappear', { detail: { cid: cid, ttl: ttl } })); } catch (e) {}
  sweepChat(cid);
  return true;
}

// Llega el cambio del otro (o de un miembro del grupo)
export function disappearOnAction(senderId, act) {
  var from = _normId(senderId);
  if (!act || DSP_TTLS.indexOf(act.ttl) < 0 || typeof act.ts !== 'number' || act.ts <= 0) return;
  var ts = Math.min(act.ts, Date.now() + 60000), cid = from;
  if (act.g) {
    var gs = _groups(), g = gs && gs.get ? gs.get(String(act.g)) : null;
    if (!g || !(g.members || []).some(function(nx) { return _normId(nx) === from; })) return; // solo un miembro cambia el de su grupo
    cid = _normId(g.id);
  }
  if (!_apply(cid, act.ttl, ts, from)) return;
  console.log('[DSP] ' + from + ' cambió los mensajes temporales de ' + cid + ': ' + (act.ttl ? Math.round(act.ttl / 3600000) + ' h' : 'desactivados')); // i18n-ok: registro
  if (_normId(_getCurrentContactId()) === cid) _showInfoToast(t('dsp_changed', 'Mensajes temporales') + ': ' + disappearLabel(act.ttl), 2600);
  try { window.dispatchEvent(new CustomEvent('nexo:disappear', { detail: { cid: cid, ttl: act.ttl } })); } catch (e) {}
  sweepChat(cid);
}

// Borra lo caducado de un chat (solo lo escrito después de activarlo). Devuelve cuántos borró.
export async function sweepChat(cid, now) {
  cid = _normId(cid);
  var e = disappearOf(cid);
  if (!e) return 0;
  now = now || Date.now();
  var msgs = [];
  try { msgs = await vaultLoadMessages(cid); } catch (x) { return 0; }
  var gone = (msgs || []).filter(function(m) { var ts = Number(m.timestamp) || 0; return ts >= e.ts && now - ts >= e.ttl; });
  for (var i = 0; i < gone.length; i++) {
    var id = gone[i].msgId || gone[i].messageId;
    if (!id) continue;
    try { await vaultDeleteMessage(cid, id); } catch (x) {}
    try { var el = document.querySelector('.message[data-msg-id="' + id + '"]'); if (el) el.remove(); } catch (x) {}
  }
  if (gone.length) console.log('[DSP] ' + cid + ': ' + gone.length + ' mensaje(s) temporales caducados, borrados'); // i18n-ok: registro
  return gone.length;
}
export function sweepAll() { Object.keys(_all()).forEach(function(cid) { sweepChat(cid); }); }

// Hoja para elegir el plazo
export function openDisappearSheet(cid, openSheet) {
  cid = _normId(cid);
  var cur = disappearOf(cid), curTtl = cur ? cur.ttl : 0;
  return openSheet('nexo-dsp-sheet', t('dsp_title', 'Mensajes temporales'), t('dsp_note', 'Los mensajes nuevos de este chat se borran solos de los dos teléfonos al pasar el plazo.'),
    DSP_TTLS.map(function(ttl) { return { label: (ttl === curTtl ? '✓ ' : '') + disappearLabel(ttl), cls: 'dsp-' + (ttl / 3600000), fn: function() { setDisappear(cid, ttl); } }; })
      .concat([{ label: t('chat_cancel', 'Cancelar'), cls: 'mm-cancel', fn: function() {} }]));
}

export function installDisappear() {
  if (_sweepT) return;
  _sweepT = setInterval(sweepAll, SWEEP_MS);
  setTimeout(sweepAll, 5000);
  window.addEventListener('nexo:ble:openChat', function() { setTimeout(function() { var c = _normId(_getCurrentContactId()); if (c) sweepChat(c); }, 300); });
  window.NEXO_setDisappear = setDisappear; window.NEXO_disappearOf = disappearOf; window.NEXO_sweepChat = sweepChat;
}
