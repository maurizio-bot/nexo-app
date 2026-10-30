/**
 * NEXO — Rendimiento (ronda 2808, pedido del dueño «rendimiento api de nexo»): mide y muestra el rendimiento REAL
 * de la app en la sesión actual: latencia (ping ida y vuelta), mensajes entregados, tiempo de confirmación de entrega
 * y tiempo de transferencia de archivos, más cuántos contactos están en línea.
 *
 * PASIVO por diseño: escucha eventos que la app YA emite (`nexo:ble:ackStatus`, `nexo:ble:fileProgress`) y lee el RTT
 * que el supervisor YA mide (`bleInterface._supervisorStates`). No cambia el núcleo de mensajería (salvo una línea en
 * ble_messages.js que registra cada RTT medido). Todo en memoria, de la sesión; nada se guarda ni se envía.
 */
'use strict';

import { t } from './i18n.js';

var MAX = 80; // muestras por métrica (ventana deslizante)
var _s = { rtt: [], entrega: [], transfer: [] }; // rtt(ms), confirmación de entrega(ms), transferencia(s)
var _sentSet = Object.create(null); // msgId -> ts del inicio ('sending'/'sent') para la ida y vuelta
var _doneSet = Object.create(null); // msgId -> ya contado como entregado (evita doble conteo delivered/read)
var _txStart = Object.create(null); // fileId -> ts de inicio del envío
var _count = { enviados: 0, entregados: 0, archivos: 0 };

function _push(arr, v) { arr.push(v); if (arr.length > MAX) arr.shift(); }

// Registro genérico (lo usa también el gancho de RTT en ble_messages.js vía window.nexoPerf.record)
function record(kind, value) {
  if (!_s[kind] || typeof value !== 'number' || !isFinite(value) || value < 0 || value > 36e5) return;
  _push(_s[kind], value);
}

function _stats(arr) {
  if (!arr || !arr.length) return null;
  var a = arr.slice().sort(function (x, y) { return x - y; });
  var sum = 0; for (var i = 0; i < a.length; i++) sum += a[i];
  return {
    n: a.length, min: a[0], max: a[a.length - 1],
    med: a[Math.floor(a.length / 2)],
    p95: a[Math.min(a.length - 1, Math.floor(a.length * 0.95))],
    avg: sum / a.length
  };
}

// RTT por dispositivo que el supervisor ya mide (lectura pasiva, sin tocar nada)
function liveRtt() {
  var out = [];
  try {
    var m = window.bleInterface && window.bleInterface._supervisorStates;
    if (m && typeof m.forEach === 'function') m.forEach(function (st) { if (st && typeof st.rtt === 'number' && st.rtt >= 0) out.push(st.rtt); });
  } catch (e) {}
  return out;
}

function summary() {
  var live = liveRtt();
  var liveAvg = live.length ? Math.round(live.reduce(function (s, x) { return s + x; }, 0) / live.length) : null;
  return {
    rtt: _stats(_s.rtt), entrega: _stats(_s.entrega), transfer: _stats(_s.transfer),
    enviados: _count.enviados, entregados: _count.entregados, archivos: _count.archivos,
    tasa: _count.enviados ? Math.round(100 * Math.min(_count.entregados, _count.enviados) / _count.enviados) : null,
    rtt_vivo: liveAvg, en_linea: live.length
  };
}

// --- Escucha pasiva de lo que la app ya emite ---
function _onStatus(e) {
  var d = (e && e.detail) || {}, id = d.msgId, st = d.status;
  if (!id) return;
  // El inicio puede llegar como 'sending' o 'sent' según el camino (BLE directo, relé, Jump)
  if ((st === 'sending' || st === 'sent') && !(id in _sentSet)) { _sentSet[id] = Date.now(); _count.enviados++; }
  else if ((st === 'delivered' || st === 'read') && !(id in _doneSet)) {
    _doneSet[id] = 1;
    if (id in _sentSet) record('entrega', Date.now() - _sentSet[id]); // ida y vuelta de la confirmación
    else _count.enviados++; // entregado sin haber visto el inicio: cuéntalo igual (tasa ≤ 100%)
    _count.entregados++;
  }
}
function _onFile(e) {
  var d = (e && e.detail) || {}, id = d.fileId;
  if (!id || d.direction !== 'out') return;
  var pct = typeof d.percent === 'number' ? d.percent : 0;
  if (pct > 0 && pct < 100 && !(id in _txStart)) _txStart[id] = Date.now();
  if ((d.status === 'delivered' || pct >= 100) && (id in _txStart)) {
    var secs = (Date.now() - _txStart[id]) / 1000;
    if (secs > 0.03) record('transfer', secs);
    _count.archivos++; delete _txStart[id];
  }
}

export function initPerf() {
  try {
    window.addEventListener('nexo:ble:ackStatus', _onStatus);
    window.addEventListener('nexo:ble:fileProgress', _onFile);
    window.nexoPerf = { record: record, summary: summary, liveRtt: liveRtt };
  } catch (e) {}
}

// --- Panel «Rendimiento» (se incrusta en Ajustes, igual que la sección de Seguridad) ---
export function perfSectionHtml() {
  return '<div class="nx-card"><div class="nx-h"><span class="nx-ico">⚡</span>' + t('prof_perf_title', 'Rendimiento') + '</div>' +
    '<div class="nx-sub">' + t('prof_perf_sub', 'Medido en vivo mientras usas NEXO (esta sesión). Latencia = ping de ida y vuelta con tus contactos. Nada se guarda ni se envía.') + '</div>' +
    '<div id="nexo-perf-rows"></div>' +
    '<button id="nexo-perf-refresh" class="nx-btn" style="margin-top:8px;">' + t('prof_perf_refresh', 'Actualizar') + '</button></div>';
}

function _fmtMs(v) { return v == null ? '—' : (v < 1000 ? Math.round(v) + ' ms' : (v / 1000).toFixed(2) + ' s'); }
function _fmtS(v) { return v == null ? '—' : (v < 1 ? Math.round(v * 1000) + ' ms' : v.toFixed(2) + ' s'); }

export function renderPerfSection() {
  var box = document.getElementById('nexo-perf-rows');
  if (!box) return;
  var s = summary();
  var rows = [];
  rows.push([t('prof_perf_latency', 'Latencia (ping ida y vuelta)'),
    s.rtt ? (_fmtMs(s.rtt.med) + ' · p95 ' + _fmtMs(s.rtt.p95)) : (s.rtt_vivo != null ? _fmtMs(s.rtt_vivo) + t('prof_perf_now', ' (ahora)') : t('prof_perf_nodata', 'sin datos aún'))]);
  rows.push([t('prof_perf_online', 'Contactos en línea'), String(s.en_linea)]);
  rows.push([t('prof_perf_delivered', 'Mensajes entregados'),
    s.enviados ? (s.entregados + t('prof_net_of', ' de ') + s.enviados + (s.tasa != null ? ' · ' + s.tasa + '%' : '')) : t('prof_perf_nodata', 'sin datos aún')]);
  rows.push([t('prof_perf_ack', 'Confirmación de entrega'),
    s.entrega ? (_fmtMs(s.entrega.med) + ' · p95 ' + _fmtMs(s.entrega.p95)) : t('prof_perf_nodata', 'sin datos aún')]);
  rows.push([t('prof_perf_transfer', 'Transferencia de archivos'),
    s.transfer ? (t('prof_perf_typical', 'tiempo típico ') + _fmtS(s.transfer.med) + ' · ' + s.archivos + t('prof_perf_files', ' archivo(s)')) : t('prof_perf_nodata', 'sin datos aún')]);
  box.innerHTML = rows.map(function (r) {
    return '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.08);font-size:14px;">' +
      '<span style="opacity:0.85;">' + r[0] + '</span><b style="text-align:right;">' + r[1] + '</b></div>';
  }).join('');
}
