import { wakePost } from './wake_post.js';
import { DEFAULT_SENDER, _nid, CALL_WAKE_MIN_MS, WAKE_MIN_MS, XFER_WAKE_MIN_MS, _plugin } from './net_link_shared.js';
// Métodos de NetLink: DESPERTAR: el toque (FCM) a un teléfono dormido y mantenerlo despierto en una transferencia.
// Reestructuración 15-11: movidos TAL CUAL desde net_link.js, que los une a la clase (como métodos normales).
var SEAL_ASK_MS = 6 * 3600000, SEAL_LOOK_MS = [20000, 120000], WAKE_DEG_MS = 30 * 60000;
export const netWake = {

  // 14A (decisión del dueño 23-11, auditoría T-P1): el «toque» sellado. Lo que se comparte con los contactos para despertar este
  // teléfono es su SELLO (s1.…, el token cifrado por el enviador), no el token: el enviador manda el sello SOLO al propio teléfono (por
  // FCM, lo guarda el nativo) y, cuando exija toques sellados, nadie que no sea contacto podrá gastarle batería. Sin sello aún (enviador
  // viejo, sin red), se sigue con el token como siempre y se pide el sello como mucho cada 6 h: nunca se deja de poder despertar.
  _wakeSeal(ft) {
    var self = this;
    if (ft && typeof ft.deg === 'boolean') self._setFcmDeg(ft.deg);
    if (!ft || !ft.token) return;
    if (ft.sealed) { if (self.fcmToken !== ft.sealed) { self.fcmToken = ft.sealed; console.log('[NET] Toque sellado: a los contactos va el sello, no el token'); } return; } // i18n-ok: registro
    self.fcmToken = ft.token;
    var url = self.senderUrl(), now = Date.now(), st = self.state || {};
    if (!url || now - (Number(st.sealAskAt) || 0) < SEAL_ASK_MS) return;
    st.sealAskAt = now; if (typeof self._saveState === 'function') self._saveState();
    var f = (typeof self.wakeFetch === 'function' && self.wakeFetch()) || (typeof fetch === 'function' ? fetch : null);
    if (!f) return;
    Promise.resolve().then(function() { return f(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify({ seal: ft.token }) }); })
      .then(function(res) { console.log('[NET] Sello del toque pedido al enviador (' + ((res && res.status) || '?') + '): llega por FCM al nativo'); }, function() {}); // i18n-ok: registro
    SEAL_LOOK_MS.forEach(function(ms) {
      setTimeout(function() {
        var pl = _plugin();
        if (!pl || typeof pl.getFcmToken !== 'function' || self.fcmToken !== ft.token) return;
        Promise.resolve(pl.getFcmToken()).then(function(x) { if (x && x.token === ft.token && x.sealed) self._wakeSeal(x); }, function() {});
      }, ms);
    });
  },

  // FCM «despertador» (#87, Fase 2): URL del enviador (Cloud Function del dueño). Por defecto la estándar del proyecto;
  // se puede cambiar (setSender) si el despliegue da otra. Vacía = despertador apagado (no se piden toques).
  // Fase 1 (contrato B.5.6): ¿los toques de ESTE teléfono llegan degradados? (lo mide el nativo al recibirlos). Se anuncia en el saludo (td).
  _setFcmDeg(deg) {
    deg = !!deg; if (deg === !!this.fcmDeg) return;
    this.fcmDeg = deg;
    console.log('[WAKE] Mis toques FCM ' + (deg ? 'llegan DEGRADADOS (Android los bajó a prioridad normal): se lo digo a mis contactos' : 'vuelven a llegar con prioridad alta')); // i18n-ok: registro
  },
  senderUrl() { return (this.state.senderUrl != null) ? this.state.senderUrl : DEFAULT_SENDER; },
  setSender(url) { this.state.senderUrl = String(url == null ? '' : url); this._saveState(); },
  // Pide al enviador que dispare el «toque» de Google al token del contacto. SOLO viaja el token (nunca el contenido);
  // el mensaje ya va cifrado por el camino normal. Defensivo: si no hay token/enviador o falla la red, no pasa nada.
  _wake(nx, isCall, why) {
    try {
      var peer = this.peers.get(_nid(nx)); if (!peer || !peer.fcmToken) return;
      var url = this.senderUrl(); if (!url) return;
      if (typeof fetch !== 'function') return;
      var viaGw = this.gwOnly(); // sin internet propio: el «toque» lo pide el puente (gw_link.js)
      // M1 (auditoría 28-10): throttle por par — como mucho un toque cada WAKE_MIN_MS (una ráfaga de textos despierta
      // una sola vez; NetBg ya baja el resto en esa sesión). #130 (dueño 30-10): una llamada tiene su propio throttle
      // (CALL_WAKE_MIN_MS), más corto y aparte, para que SIEMPRE despierte aunque un texto reciente haya gastado el de
      // textos (el informe «al llamar no siempre despierta»); dos ofertas pegadas siguen pidiendo un solo toque.
      var now = Date.now();
      if (isCall) {
        if (peer._callWakeAt && (now - peer._callWakeAt) < CALL_WAKE_MIN_MS) return;
        peer._callWakeAt = now;
      } else {
        if (peer._wakeAt && (now - peer._wakeAt) < WAKE_MIN_MS) return;
        // Fase 1 (contrato B.5.6): sus toques llegan degradados → solo el PRIMER pendiente toca: tras un toque, no otro hasta que él
        // dé señales (lastRx nuevo) o pasen 30 min. Cada toque de más gasta su cupo de FCM y empeora los siguientes (también las llamadas).
        if (peer.fcmDeg && peer._wakeAt && (peer.lastRx || 0) < peer._wakeAt && now - peer._wakeAt < WAKE_DEG_MS) return;
        peer._wakeAt = now;
      }
      var self = this;
      if (why) console.log('[WAKE] toque a ' + _nid(nx) + ' (' + why + '): que su app esté despierta antes de que salga algo pesado'); // i18n-ok
      if (viaGw) { this.gw.wake(peer.fcmToken); return; }
      wakePost(url, peer.fcmToken, typeof this.wakeFetch === 'function' ? this.wakeFetch() : undefined)
        .then(function(res) {
          // 3245 (dueño 18-11): que el diagnóstico diga si el toque salió de verdad (antes no quedaba rastro)
          if (why) console.log('[WAKE] toque a ' + _nid(nx) + (res.opaque ? ': salió (el enviador no deja leer su respuesta)' : ': el enviador contestó ' + res.status)); // i18n-ok
          // 404 = token caducado/desregistrado: lo olvidamos para pedir uno nuevo en el próximo saludo
          if (res && res.status === 404) { peer.fcmToken = ''; if (self.state.peerFcm) { delete self.state.peerFcm[_nid(nx)]; self._saveState(); } }
        })
        .catch(function(e) { if (why) console.warn('[WAKE] toque a ' + _nid(nx) + ': no salió (' + ((e && e.message) || 'red') + ')'); }); // i18n-ok
    } catch (e) {}
  },

  // #dueño 06-11 — LATIDO de despertador para un archivo grande por internet. Mientras una transferencia por internet
  // está EN CURSO pero NO avanza (típico: el que recibe tiene la app dormida y por eso no confirma los trozos), se le
  // re-dispara el «toque» para que su app vuelva, siga recibiendo y confirme. Tiene su PROPIO throttle (XFER_WAKE_MIN_MS,
  // bucket _xferWakeAt), aparte del de textos y del de llamadas: como mucho un toque cada 15 s, así que es barato (no
  // gasta la cuota de FCM) y, en cuanto el envío vuelve a fluir, deja de haber timeouts → deja de haber toques. SOLO el
  // token viaja (como _wake), nunca el contenido. Lo llama ble_ack.js en cada window-timeout de un archivo por net:.
  wakeKeepAlive(nexoId) {
    try {
      var nx = _nid(nexoId);
      var peer = this.peers.get(nx); if (!peer || !peer.fcmToken) return false;
      var url = this.senderUrl(); if (!url) return false;
      if (typeof fetch !== 'function') return false;
      var minMs = (typeof window !== 'undefined' && Number(window.NEXO_XFER_WAKE_MS)) || XFER_WAKE_MIN_MS;
      var now = Date.now();
      if (peer._xferWakeAt && (now - peer._xferWakeAt) < minMs) return false;
      peer._xferWakeAt = now;
      var self = this;
      wakePost(url, peer.fcmToken, typeof this.wakeFetch === 'function' ? this.wakeFetch() : undefined)
        .then(function(res) {
          if (res && res.status === 404) { peer.fcmToken = ''; if (self.state.peerFcm) { delete self.state.peerFcm[nx]; self._saveState(); } }
        })
        .catch(function() {});
      return true;
    } catch (e) { return false; }
  },

  // #dueño 06-11 (paso 2b del envío de 25 MB): mientras RECIBO un archivo GRANDE por internet, le pido al nativo que me
  // mantenga despierto de CORRIDO (wakelock + Wi-Fi) para no dormirme a mitad del envío largo con la pantalla apagada;
  // y lo suelto al completarlo. Guardado: si no hay plugin nativo (simulador/navegador) o no tiene el método, es un
  // no-op silencioso. El nativo tiene un tope DURO de seguridad (XferAwake.MAX_HOLD_MS) por si no llega el «soltar».
  xferKeepAwake(on) {
    try {
      var pl = _plugin();
      if (pl && typeof pl.xferKeepAwake === 'function') pl.xferKeepAwake({ on: !!on });
    } catch (e) {}
  },

  // P2 (dueño 01-11): «toque» FCM A PETICIÓN (p.ej. al ABRIR el chat), para despertar a un contacto dormido por internet
  // ANTES de que el usuario escriba — así el 1er mensaje no espera ni se pierde, el enlace se forma antes y aparece el tipo
  // de conexión. Solo si tenemos su token FCM y hay internet (relés abiertos). Reusa el throttle de _wake (una ráfaga de
  // aperturas no spamea). Devuelve true si hay a quién/por dónde despertar, para que la interfaz muestre «Conectando…».
  wakeFor(nexoId, why) {
    try {
      var nx = _nid(nexoId);
      var peer = this.peers.get(nx);
      if (!peer || !peer.fcmToken) return false;
      if (!this.senderUrl() || !this.online()) return false;
      this._wake(nx, false, why);
      return true;
    } catch (e) { return false; }
  },
};
