import { _plugin, _nid } from './net_link_shared.js';
// Métodos de NetLink: TOR: cuándo usarlo, encenderlo y el camino directo por Tor.
// Reestructuración 15-11: movidos TAL CUAL desde net_link.js, que los une a la clase (como métodos normales).
export const netTor = {
  // Tor es MÁS LENTO que los relés: por defecto NO corre (pedido del dueño 01-11: «no quiero Tor por defecto siendo más
  // lento»). Se enciende de dos formas: (1) el usuario lo activa a mano en Ajustes para ocultar su IP siempre
  // (state.tor === true); (2) BAJO DEMANDA (_torNeeded) cuando una videollamada o un archivo grande van por internet, que
  // solo pueden ir por Tor directo (los relés no pueden). Si state.tor === false, el usuario lo apagó aposta: ni a demanda.
  torWanted() { return this.state.tor === true || (this.state.tor !== false && !!this._torNeeded); },
  setTor(on) {
    this.state.tor = !!on; this._saveState();
    var pl = _plugin();
    if (!on && pl && typeof pl.torStop === 'function') { this._torNeeded = false; pl.torStop().catch(function() {}); this.tor.ready = false; this.tor.onion = ''; this.peers.forEach(function(p) { p.torUp = p.torOk = false; }); }
    else this.tick();
  },
  // 3046 (diagnóstico S24 APK 3033 13-11: videollamada por internet sin imagen y ni una línea de Tor en el registro): estado
  // de Tor en palabras, para el diagnóstico (cabecera ESTADO y línea de la llamada)
  torState() {
    var t = this.tor || {};
    if (this.state && this.state.tor === false) return 'APAGADO en Ajustes';
    if (t.ready) return 'listo';
    if (t.starting) return 'arrancando';
    if (t.error) return 'falló (' + String(t.error).slice(0, 60) + ')';
    return this.torWanted() ? 'pedido' : 'sin usar';
  },
  // Pide Tor para ESTA sesión (vídeo/archivo grande por internet). No hace nada si el usuario lo apagó a mano. Devuelve si
  // ya está listo; si no, lo intenta arrancar (tarda unos segundos la 1ª vez) y los caminos que lo necesitan esperan a via==='tor'.
  ensureTor() { if (this.state.tor === false) return false; this._torNeeded = true; this.tick(); return this.tor.ready; },
  // ¿El usuario encendió Tor A MANO (privacidad siempre)? El interruptor de Ajustes refleja ESTO, no el arranque bajo
  // demanda (_torNeeded), para que la casilla no se «palomee» sola por una videollamada. Por defecto apagado (#dueño 01-11).
  torManual() { return this.state.tor === true; },
  // ¿Preferir Tor para ESTE envío? Solo si el usuario lo encendió a mano (privacidad siempre), si no hay relés (offline,
  // Tor es el único camino) o si el que llama lo pide (opts.tor: vídeo/archivo grande por internet, que los relés no
  // pueden). Lo NORMAL online → false → relés (rápido). Extraído para poder probarlo. #dueño 01-11.
  _preferTor(opts) { return (this.state.tor === true) || !this.online() || !!(opts && opts.tor); },
  // #dueño 06-11: un ARCHIVO GRANDE por internet prefiere Tor DIRECTO (sin relés: los relés no aguantan ~25 MB). El que
  // ENVÍA marca al contacto con preferTorFor al arrancar el envío (y arranca Tor a demanda); el que RECIBE arranca Tor
  // (ensureTor) al recibir bloques de un archivo grande. Así, con los dos despiertos (latido 2930/2931), se forma el Tor
  // directo y el archivo viaja por ahí. Dura un rato (TTL): mientras dura el envío. No hace nada si el usuario apagó Tor
  // (ensureTor respeta state.tor===false). send() lee _torPreferred para preferir Tor para ese contacto.
  preferTorFor(nexoId, ttlMs) {
    try {
      var nx = _nid(nexoId); if (!nx) return;
      if (!this._torPref) this._torPref = new Map();
      this._torPref.set(nx, Date.now() + (ttlMs || 600000)); // 10 min por defecto (lo que suele durar un envío grande)
      this.ensureTor();
    } catch (e) {}
  },
  _torPreferred(nexoId) { try { var t = this._torPref && this._torPref.get(_nid(nexoId)); return !!t && t > Date.now(); } catch (e) { return false; } },
  _torTick() {
    var pl = _plugin(), now = Date.now();
    if (!pl || typeof pl.torStart !== 'function' || !this.torWanted() || this.tor.ready || this.tor.starting) return;
    // Con Wi-Fi para la privacidad automática (arrancar Tor gasta datos); pero BAJO DEMANDA (_torNeeded: el usuario
    // arrancó un vídeo/archivo grande por internet) se permite también con datos, porque lo pidió él. Siempre hace falta
    // tener contactos con los que usarlo; reintento cada 10 min.
    if ((!this.wifi && !this._torNeeded) || !this.inTags.size || now - (this.tor.triedAt || 0) < 600000) return;
    this.tor.starting = true; this.tor.triedAt = now;
    console.log('[NET] Arrancando Tor…');
    var self = this;
    pl.torStart({ nexoId: this.me() }).catch(function(e) { self.tor.starting = false; self.tor.error = (e && e.message) || 'error'; });
  },
  _onTorReady(ev) {
    this.tor.starting = false;
    if (!ev || ev.error || !ev.onion) { this.tor.error = (ev && ev.error) || 'error'; console.warn('[NET] Tor no disponible: ' + this.tor.error); return; }
    this.tor.ready = true; this.tor.onion = ev.onion; this.tor.port = Number(ev.port) || 0; this.tor.error = '';
    console.log('[NET] Tor listo (dirección .onion propia)');
    this._helloAll(true); // los contactos reciben la dirección y se conectan
    var self = this;
    this.peers.forEach(function(p, nx) { self._torDial(nx); });
  },
  _torDial(nx) {
    var p = this._peer(nx), pl = _plugin(), now = Date.now();
    if (!this.tor.ready || !p.onion || p.torUp || now - (p.torDialAt || 0) < 60000 || !pl || typeof pl.torConnect !== 'function') return;
    p.torDialAt = now;
    pl.torConnect({ host: p.onion, port: p.torPort || this.tor.port }).catch(function() {});
  },
  async _onTorMessage(ev) {
    var nx = _nid(ev && ev.nx), p = this._peer(nx);
    var o = await this._open(nx, ev && ev.content);
    if (!o) {
      // No es de ese contacto (o no tenemos su clave): fuera
      console.warn('[NET] Conexión Tor de "' + nx + '" que no se puede comprobar: se cierra');
      var pl = _plugin(); if (pl && typeof pl.torDrop === 'function') pl.torDrop({ nx: nx }).catch(function() {});
      p.torUp = false; p.torOk = false;
      return;
    }
    if (!p.torOk) { p.torOk = true; console.log('[NET] ' + nx + ' conectado por Tor (directo, sin relés)'); }
    this._deliver(nx, o);
  },
};
