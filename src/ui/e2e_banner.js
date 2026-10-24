/**
 * NEXO — Aviso de cifrado del chat (sacado de main.js en la ronda 2752, sin cambios): estado del cifrado (poscuántico,
 * número de seguridad, clave cambiada) y verificación con QR.
 */
import { isGroupId } from './groups.js';
import { _getCurrentContactId, _normId } from './chat_format.js';
import { _showInfoToast } from './ui_bits.js';
import { safetyQrPayload, checkSafetyQr, showSafetyQr, openQrScanner } from './qr_verify.js';
import { ratchetSafetyNumber, ratchetSessionPq } from '../vault/e2e_ratchet.js';
import { vaultLoadContacts } from '../vault/vault_manager.js';


// v9.9.36: aviso de cifrado al principio del chat (pulsar: huellas para comparar en persona)
export function _renderE2EBanner() {
  var mc = document.getElementById('messages-container');
  var cid = _normId(_getCurrentContactId());
  if (!mc || !cid) return;
  var c = (vaultLoadContacts() || []).find(function(x) { return _normId(x.nexoId || x.deviceUUID) === cid; }) || {};
  var name = c.name || cid.toUpperCase();
  var b = document.getElementById('e2e-banner');
  if (!b) {
    b = document.createElement('div');
    b.id = 'e2e-banner';
    mc.insertBefore(b, mc.firstChild);
  }
  b.innerHTML = '';
  // Ronda 2763: en un grupo no hay "clave del contacto" (cada mensaje va cifrado para cada persona); antes decía
  // "Esperando la clave de cifrado de GR…"
  if (isGroupId(cid)) {
    b.style.cssText = 'margin:8px auto 12px;max-width:300px;padding:8px 12px;border-radius:10px;font-size:12px;text-align:center;white-space:pre-line;';
    b.onclick = null;
    b.textContent = '🔒 Mensajes del grupo cifrados de extremo a extremo: cada mensaje va cifrado para cada persona del grupo.';
    return;
  }
  b.style.cssText = 'margin:8px auto 12px;max-width:300px;padding:8px 12px;border-radius:10px;font-size:12px;text-align:center;cursor:pointer;white-space:pre-line;' +
    (c.pendingKey ? 'background:rgba(255,59,48,0.15);color:#ff8a80;' : 'background:rgba(255,200,0,0.12);color:#ffd76a;');
  var bi = window.bleInterface;
  var txt;
  if (c.pendingKey) {
    // v9.9.40 (seguridad): clave nueva sin aceptar: puede ser un reinstalación o un impostor
    var held = (bi && typeof bi.heldCount === 'function') ? bi.heldCount(cid) : 0;
    txt = '⚠️ La clave de seguridad de ' + name + ' cambió (' + new Date(c.keyChangedAt || Date.now()).toLocaleString() + ').' +
      (held ? ' ' + held + (held === 1 ? ' mensaje retenido.' : ' mensajes retenidos.') : '') +
      ' Hasta que la aceptes no se muestran sus mensajes nuevos ni se le envía nada.' +
      ' Si no reinstaló NEXO, puede ser un impostor: comparad las huellas en persona.';
  } else if (c.publicKey && c.verified === c.publicKey) txt = '🔒✔ Cifrado de extremo a extremo. Verificaste el número de seguridad de ' + name + '.';
  else if (c.publicKey && c.keyAcceptedAt) txt = '🔒 Cifrado de extremo a extremo. Aceptaste una clave nueva de ' + name + ' (' + new Date(c.keyAcceptedAt).toLocaleString() + '). Toca para verificar.';
  else if (c.publicKey) txt = '🔒 Mensajes cifrados de extremo a extremo. Nadie fuera de este chat puede leerlos. Toca para verificar.';
  else txt = '⏳ Esperando la clave de cifrado de ' + name + ': tus mensajes saldrán cifrados en cuanto conecte.';
  // v9.9.49: sesión empezada con el acuerdo poscuántico (ML-KEM): protegida también ante ordenadores cuánticos
  if (c.publicKey && !c.pendingKey && ratchetSessionPq(cid, c.publicKey)) txt += ' Protección poscuántica activa.';
  var t = document.createElement('div');
  t.className = 'e2e-text';
  t.textContent = txt;
  b.appendChild(t);
  var fp = document.createElement('div');
  fp.className = 'e2e-fp';
  fp.style.cssText = 'margin-top:6px;font-family:monospace;';
  b.appendChild(fp);
  // v9.9.41: número de seguridad de 60 cifras (como Signal): el mismo en los dos teléfonos; comparadlo en persona
  var me = _normId(window.bleInterface && window.bleInterface.localNexoId);
  var showFp = function() {
    if (fp.dataset.shown) return;
    fp.dataset.shown = '1';
    fp.textContent = 'Calculando…';
    Promise.all([c.publicKey ? ratchetSafetyNumber(me, cid, c.publicKey) : Promise.resolve(''), c.pendingKey ? ratchetSafetyNumber(me, cid, c.pendingKey) : Promise.resolve('')]).then(function(n) {
      var fmt = function(x) { var g = x.split(' '); return g.slice(0, 4).join(' ') + '\n' + g.slice(4, 8).join(' ') + '\n' + g.slice(8).join(' '); };
      fp.textContent = c.pendingKey
        ? 'Número de seguridad con la clave anterior:\n' + (n[0] ? fmt(n[0]) : '—') + '\nCon la clave NUEVA:\n' + fmt(n[1])
        : (n[0] ? 'Número de seguridad (debe ser idéntico en el teléfono de ' + name + '):\n' + fmt(n[0]) : 'Sin clave aún');
      if (!c.pendingKey && c.publicKey && bi && typeof bi.setContactVerified === 'function') {
        var on = c.verified === c.publicKey;
        var vb = document.createElement('button');
        vb.className = 'e2e-verify';
        vb.textContent = on ? 'Quitar verificado' : 'Marcar como verificado';
        vb.style.cssText = 'display:block;margin:8px auto 0;padding:6px 10px;border-radius:8px;border:none;font-size:12px;cursor:pointer;background:' + (on ? 'rgba(255,255,255,0.15)' : '#00c8ff') + ';color:#fff;';
        vb.onclick = function(ev) { ev.stopPropagation(); bi.setContactVerified(cid, !on); };
        fp.appendChild(vb);
        // v9.9.49: o por QR (como Signal): uno lo muestra y el otro lo escanea desde este mismo chat
        var qrow = document.createElement('div');
        qrow.style.cssText = 'display:flex;gap:8px;justify-content:center;margin-top:8px;';
        var qb = function(label, cls, fn) {
          var x = document.createElement('button');
          x.className = cls;
          x.textContent = label;
          x.style.cssText = 'padding:6px 10px;border-radius:8px;border:none;font-size:12px;cursor:pointer;background:rgba(255,255,255,0.15);color:#fff;';
          x.onclick = function(ev) { ev.stopPropagation(); fn(); };
          qrow.appendChild(x);
        };
        qb('Mostrar mi QR', 'e2e-qr-show', function() {
          showSafetyQr(safetyQrPayload(me, cid, n[0]), 'Que ' + name + ' lo escanee desde su chat contigo\n(Escanear su QR)');
        });
        qb('Escanear su QR', 'e2e-qr-scan', function() { openQrScanner(function(text) { _onSafetyQr(cid, name, text); }, 'Apunta al QR que muestra ' + name); });
        fp.appendChild(qrow);
      }
    }).catch(function() { fp.textContent = ''; delete fp.dataset.shown; });
  };
  b.onclick = showFp;
  if (c.pendingKey) {
    showFp();
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;justify-content:center;margin-top:8px;';
    var mk = function(label, cls, fn) {
      var btn = document.createElement('button');
      btn.className = cls;
      btn.textContent = label;
      btn.style.cssText = 'padding:6px 10px;border-radius:8px;border:none;font-size:12px;cursor:pointer;' + (cls === 'e2e-accept' ? 'background:#00c8ff;color:#fff;' : 'background:rgba(255,255,255,0.15);color:#fff;');
      btn.onclick = function(ev) { ev.stopPropagation(); fn(); };
      return btn;
    };
    row.appendChild(mk('Aceptar clave nueva', 'e2e-accept', function() { if (bi && bi.acceptContactKey) bi.acceptContactKey(cid); }));
    row.appendChild(mk('Rechazar', 'e2e-reject', function() { if (bi && bi.rejectContactKey) bi.rejectContactKey(cid); }));
    b.appendChild(row);
  }
}

// Lo escaneado se compara con el número que calcula ESTE teléfono ahora (con la clave guardada en este momento)
export function _onSafetyQr(cid, name, text) {
  var bi = window.bleInterface;
  var me = _normId(bi && bi.localNexoId);
  var c = (vaultLoadContacts() || []).find(function(x) { return _normId(x.nexoId || x.deviceUUID) === cid; });
  if (!c || !c.publicKey || c.pendingKey) { _showInfoToast('Primero acepta o rechaza la clave nueva de ' + name, 3500); return; }
  ratchetSafetyNumber(me, cid, c.publicKey).then(function(num) {
    var r = checkSafetyQr(text, me, cid, num);
    console.log('[E2E] QR del número de seguridad de ' + cid + ': ' + r);
    if (r === 'ok') {
      if (bi && typeof bi.setContactVerified === 'function') bi.setContactVerified(cid, true);
      _showInfoToast('✔ Número de seguridad verificado: ' + name + ' es quien dice ser', 3500);
    } else if (r === 'mismatch') {
      _showInfoToast('⚠️ El número NO coincide: la clave de ' + name + ' no es la que tienes guardada. Puede haber un impostor: no lo marques como verificado.', 7000);
    } else if (r === 'other') _showInfoToast('Ese QR es de otro contacto, no de ' + name, 3500);
    else if (r === 'notme') _showInfoToast('Ese QR es para otra persona: pide a ' + name + ' que lo abra en su chat contigo', 4000);
    else _showInfoToast('No es un QR de número de seguridad de NEXO', 3000);
  }).catch(function() { _showInfoToast('No se pudo calcular el número de seguridad', 3000); });
}
