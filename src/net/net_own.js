import { OWN_RELAYS, OWN_BAD_MS, OWN_ANNOUNCE_GAP_MS, UP_MS, _relaySafe, _relayHost, _nid } from './net_link_shared.js';
// Métodos de NetLink: RELÉ PROPIO (3151, dueño 16-11: servidor de relé de NEXO, de pago; los públicos quedan de respaldo).
// Con OWN_RELAYS vacío (y en el simulador sin window.NEXO_OWN_RELAYS) nada de esto cambia nada: _ownList() es [] y cada método
// devuelve «como siempre» (suscribirse a todos, publicar en todos).
//
// Lo que se eligió (docs/SERVIDOR_PROPIO.md):
//  - CONECTAR: el propio va primero en la lista; junto a él, OWN_PUBLIC_BACKUP públicos (los demás, a la reserva de 3114).
//  - LEER: con el propio SANO (abierto y con su suscripción confirmada: EOSE) se lee de él y de UN público, el «lector» (el primero
//    abierto de la lista, el mismo en los dos teléfonos). Los demás públicos siguen abiertos solo para publicar: lo que antes llegaba
//    repetido por 4 relés llega por 2. El lector cubre a los contactos que publican solo en públicos (versión sin propio, o con su
//    propio caído) y a un propio que muere sin cerrarse (los mensajes siguen entrando por el lector mientras se detecta).
//  - Si el propio cae (se cierra o se da por muerto): al momento se vuelven a suscribir TODOS los públicos abiertos (como hoy) y se
//    avisa con un saludo a quien sabía que yo leía del propio. Se reintenta como mucho cada OWN_RETRY_MAX_MS; al volver sano, se
//    sueltan las suscripciones de los públicos (menos el lector) y se saluda por él a quien se saludó sin él.
//  - PUBLICAR: mensajes y saludos van a TODOS los abiertos (propio + públicos). Lo PESADO (partes de llamada, trozos de un archivo
//    en vivo) va SOLO al propio cuando el otro dijo en su saludo que lee del propio ('ro'); si el propio no lo guarda, a todos.
//  - BUZÓN DE ARCHIVOS: con el propio sano, cada trozo se sube solo a él (una copia: en datos móviles no se paga 3 veces el archivo)
//    y OWN_BLOB_PAR a la vez; el puntero lo pone primero. Si un trozo no entra en el propio, ese y los siguientes van a los públicos.
export const netOwn = {
  // Relés propios en uso. Pruebas: window.NEXO_OWN_RELAYS; una lista de relés de prueba (NEXO_NET_RELAYS) sin NEXO_OWN_RELAYS = sin propio
  _ownList() {
    var w = (typeof window !== 'undefined') ? window : {};
    var own = w.NEXO_OWN_RELAYS !== undefined ? w.NEXO_OWN_RELAYS : (w.NEXO_NET_RELAYS !== undefined ? [] : OWN_RELAYS);
    return (Array.isArray(own) ? own : []).filter(_relaySafe);
  },
  ownRelayUrls() { return this._ownList(); },
  _isOwn(url) { var own = this._ownList(); return own.length > 0 && own.indexOf(url) >= 0; },
  _ownOpenUrls() { var self = this; return this._ownList().filter(function(u) { var r = self.relays.get(u); return !!(r && r.open && r.ws); }); },
  // Sano = abierto y su suscripción ya confirmada (EOSE) en esta conexión
  _ownHealthy() { var self = this; return this._ownList().some(function(u) { var r = self.relays.get(u); return !!(r && r.open && r.ws && r.eoseOnce); }); },
  // Para mandarle algo SOLO al propio: sano y sin un fallo reciente
  ownOk() { return this._ownHealthy() && Date.now() >= (this._ownBadUntil || 0); },
  ownMarkBad(why) {
    if (!this._ownList().length) return;
    if (Date.now() >= (this._ownBadUntil || 0)) console.warn('[NET] Relé propio: ' + (why || 'no guardó un envío') + '; ' + Math.round(OWN_BAD_MS / 1000) + ' s todo va también a los públicos'); // i18n-ok: registro
    this._ownBadUntil = Date.now() + OWN_BAD_MS;
    try { this._probeRelays('el propio no guardó un envío', 0); } catch (e) {}
  },
  // El público «lector»: el primero abierto de la lista (propio + públicos + reserva en uso), el mismo orden en los dos teléfonos
  _readerUrl() {
    var self = this, out = null;
    this.relayUrls().some(function(u) { if (self._isOwn(u)) return false; var r = self.relays.get(u); if (r && r.open && r.ws && !r.gw) { out = u; return true; } return false; });
    return out;
  },
  // ¿Esta conexión debe tener la suscripción del buzón? Sin propio: siempre (como hasta ahora)
  _subWanted(r) {
    if (!r || r.gw || !this._ownList().length || !this._ownHealthy()) return true;
    return this._isOwn(r.url) || r.url === this._readerUrl();
  },
  // Pone cada suscripción donde toca y avisa a los contactos cuando el propio pasa a sano o deja de estarlo
  _ownSync() {
    if (!this._ownList().length) return;
    var self = this, healthy = this._ownHealthy();
    this.relays.forEach(function(r) {
      if (!r.open || !r.ws) return;
      var want = self._subWanted(r);
      if (want && !r.sub && !r.needSub) self._subscribe(r);
      else if (!want && r.sub) { self._send(r, ['CLOSE', r.sub]); r.sub = null; }
    });
    if (healthy === !!this._ownOn) return;
    this._ownOn = healthy;
    var rd = this._readerUrl();
    if (healthy) console.log('[NET] Relé propio ' + this._ownOpenUrls().map(_relayHost).join(', ') + ' listo: leo de él' + (rd ? ' y de ' + _relayHost(rd) : '') + '; los demás públicos, solo para publicar'); // i18n-ok: registro
    else console.log('[NET] Relé propio no disponible: leo de todos los públicos abiertos hasta que vuelva'); // i18n-ok: registro
    this._ownAnnounce();
  },
  // Saludo a quien deba saber el cambio: al caer, a quien saludé diciendo «leo del propio» (me mandaba lo pesado solo ahí); al volver,
  // a quien saludé sin el propio (lo mío puede haber ido a un público que no es su lector). Como mucho cada OWN_ANNOUNCE_GAP_MS.
  _ownAnnounce() {
    var self = this, wait = Math.max(0, (this._ownAnnAt || 0) + OWN_ANNOUNCE_GAP_MS - Date.now());
    clearTimeout(this._ownAnnT);
    this._ownAnnT = setTimeout(function() {
      self._ownAnnAt = Date.now();
      if (!self.online()) return;
      var on = self._ownHealthy(), now = Date.now();
      self._netContacts().forEach(function(c) {
        var nx = _nid(c.nexoId || c.deviceUUID), p = self.peers.get(nx);
        if (!p || !p.helloAt) return; // aún sin saludar: lo hace el saludo normal
        if (on ? !p.helloOwn : (p.helloOwn && now - (p.lastRx || 0) < UP_MS)) self._hello(nx);
      });
    }, wait);
  },
  // Lo pesado para `nx` va solo al propio si los dos leemos de él; null = a todos
  _ownOnlyFor(nx) {
    if (!this.ownOk()) return null;
    var p = this.peers.get(nx);
    if (!p || !p.ro || !p.up || p.gw || Date.now() - (p.roT || 0) > UP_MS) return null;
    var own = this._ownOpenUrls();
    return own.length ? own : null;
  },
  _publishOwn(ev, only) {
    var self = this;
    if (!only || !only.length) return this._publish(ev);
    return this._publish(ev, only).catch(function() { self.ownMarkBad('no contestó a un envío'); return self._publish(ev); });
  },
  // Buzón de archivos: relés a los que subir los trozos (solo el propio, sano) o null (todos los abiertos, como siempre)
  blobTargets() {
    if (!this._ownList().length || this.gwOnly() || !this.ownOk()) return null;
    var own = this._ownOpenUrls();
    return own.length ? own : null;
  },
};
