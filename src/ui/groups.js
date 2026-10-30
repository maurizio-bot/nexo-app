/**
 * groups.js v1.0 (ronda 2758, plan del dueño punto 14) — Chats de grupo.
 * Sin servidor (como todo NEXO): un grupo es { id, nombre, miembros } guardado en cada teléfono. Cada mensaje se manda
 * a cada miembro por su chat de siempre (cifrado de extremo a extremo y por cualquier camino: Bluetooth, Jump, Wi-Fi,
 * internet) dentro de un sobre:
 *     { type:'nexo_grp', g:'gr…', n:nombre, m:[NEXO ID de todos], i:id del mensaje, c:texto (o nexo_txt) }
 * Quien lo recibe crea o actualiza el grupo con esos datos (solo si el remitente y él mismo son miembros) y lo guarda en
 * el chat del grupo. El primer mensaje (al crearlo) lleva además k: las tarjetas de los miembros (NEXO ID, nombre y
 * claves, como al compartir contactos): así cada miembro puede escribir cifrado a los demás aunque no se conocieran. El id que viaja a cada miembro es i + '_' + 8 letras del miembro: así las confirmaciones (✓, ✓✓,
 * leído) de cada uno se juntan en la burbuja del grupo (✓✓ cuando les llegó a todos; leído cuando todos lo leyeron).
 * Cada copia queda (oculta) en el chat del miembro: si no está a alcance se reenvía sola como cualquier mensaje.
 * Fotos, notas de voz, ubicación, contactos y archivos (hasta ~1 MB) van igual, dentro del sobre (fase 2, 2758); el
 * vídeo, solo la previa. La copia oculta de cada miembro se borra al confirmarse que le llegó.
 */
import { vaultDeleteMessage } from '../vault/vault_manager.js';
import { _failStatus } from './ble_helpers.js';

var STORE_FILE = 'nexo_groups.json';
var GID_RE = /^gr[0-9a-z]{8}$/;
var NX_RE = /^nx[0-9a-z]{8}$/;
var MAX_MEMBERS = 32;
var STATUS_RANK = { failed: 0, pending: 1, sending: 2, sent: 3, delivered: 4, read: 5 };

function _nid(id) { return (id || '').toString().toLowerCase().trim(); }
function _plugin() { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; }
function _rnd(n) { var a = new Uint8Array(n); crypto.getRandomValues(a); return Array.from(a).map(function(b) { return (b % 36).toString(36); }).join(''); }
function _emit(name, detail) { try { window.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (e) {} }

export function isGroupId(id) { return GID_RE.test(_nid(id)); }

// Contenido de un mensaje de grupo: si es un adjunto (foto, audio, archivo…), el objeto; si no, null
export function groupAttachment(content) {
  if (typeof content !== 'string' || content.charAt(0) !== '{' || content.indexOf('"attachmentType"') < 0) return null;
  try { var a = JSON.parse(content); return a && a.type === 'attachment' && a.attachmentType ? a : null; } catch (e) { return null; }
}

// ¿Es un sobre de grupo? Devuelve el objeto o null
export function parseGroupEnvelope(content) {
  if (typeof content !== 'string' || content.indexOf('"nexo_grp"') < 0) return null;
  try {
    var o = JSON.parse(content);
    if (!o || o.type !== 'nexo_grp' || !GID_RE.test(_nid(o.g)) || !Array.isArray(o.m) || typeof o.c !== 'string') return null;
    return o;
  } catch (e) { return null; }
}

export class Groups {
  constructor(ble) {
    this.ble = ble;
    this.list = {};          // id → { id, name, members, createdBy, createdAt, lastMessage, lastMessageAt, unreadCount, left }
    this.st = {};            // id del mensaje del grupo → { g: grupo, m: { miembro: estado } } (propios recientes)
    this.senders = new Map(); // id recibido → NEXO ID del remitente (para mandarle el "leído")
    this.ready = this._load();
    var self = this;
    window.addEventListener('nexo:ble:ackStatus', function(e) { var d = e && e.detail; if (d && d.msgId) self._onMemberStatus(d.msgId, d.status); });
  }

  _load() {
    var self = this, pl = _plugin();
    if (!pl || typeof pl.loadFromFile !== 'function') return Promise.resolve();
    return pl.loadFromFile({ filename: STORE_FILE }).then(function(r) {
      if (r && r.exists && r.content) {
        var o = JSON.parse(r.content) || {};
        self.list = Object.assign(o.groups || {}, self.list);
        self.st = Object.assign(o.st || {}, self.st);
      }
    }).catch(function() {}).then(function() { _emit('nexo:groups', {}); });
  }
  _save() {
    var pl = _plugin();
    // Solo los estados de los 200 últimos mensajes propios
    var ids = Object.keys(this.st);
    if (ids.length > 200) ids.slice(0, ids.length - 200).forEach(function(k) { delete this.st[k]; }, this);
    if (pl && typeof pl.saveToFile === 'function') pl.saveToFile({ filename: STORE_FILE, content: JSON.stringify({ groups: this.list, st: this.st }) }).catch(function() {});
  }
  _me() { return _nid(this.ble && this.ble.localNexoId); }

  isGroup(id) { return isGroupId(id) && !!this.list[_nid(id)]; }
  get(id) { return this.list[_nid(id)] || null; }
  all() { var l = this.list; return Object.keys(l).map(function(k) { return l[k]; }).filter(function(g) { return !g.left; }); }

  // Crear un grupo con estos contactos (el propio NEXO ID se añade solo)
  create(name, members) {
    var me = this._me();
    var m = [me].concat((members || []).map(_nid)).filter(function(x, i, a) { return NX_RE.test(x) && a.indexOf(x) === i; });
    if (m.length < 2) throw new Error('Elige al menos un contacto');
    if (m.length > MAX_MEMBERS) throw new Error('Máximo ' + MAX_MEMBERS + ' personas');
    var id = 'gr' + _rnd(8);
    var g = { id: id, name: String(name || '').trim().substring(0, 60) || 'Grupo', members: m, createdBy: me, createdAt: Date.now(), lastMessageAt: Date.now(), unreadCount: 0 };
    this.list[id] = g;
    this._save();
    _emit('nexo:groups', { id: id });
    console.log('[GROUP] Creado ' + id + ' con ' + m.length + ' personas');
    return g;
  }

  // Salir: se avisa al resto (mensaje "salió del grupo") y deja de recibirse
  leave(id) {
    var g = this.get(id);
    if (!g) return;
    var me = this._me();
    var others = g.members.filter(function(x) { return x !== me; });
    this.sendText(id, JSON.stringify({ type: 'nexo_txt', t: '👋 Salió del grupo', gl: 1 }), null, null, others);
    g.left = true;
    g.members = others;
    this._save();
    _emit('nexo:groups', { id: id });
  }

  // Mandar un texto (wire: texto o nexo_txt) a todos los miembros. Devuelve el id del mensaje del grupo.
  sendText(gid, wire, msgId, seq, onlyTo, cards) {
    var self = this, g = self.get(gid), bi = self.ble, me = self._me();
    if (!g || !bi || typeof bi.sendChatMessage !== 'function') return null;
    msgId = msgId || ('gm' + Date.now() + _rnd(6));
    var to = (onlyTo || g.members).filter(function(x) { return x !== me; });
    var envO = { type: 'nexo_grp', g: g.id, n: g.name, m: g.members, i: msgId, c: wire };
    if (cards && cards.length) envO.k = cards;
    var env = JSON.stringify(envO);
    self.st[msgId] = { g: g.id, m: {} };
    to.forEach(function(nx) { self.st[msgId].m[nx] = 'sending'; });
    self._save();
    to.forEach(function(nx) {
      var wid = msgId + '_' + nx.substring(2);
      var s = typeof seq === 'number' ? seq : (typeof bi.getNextSeq === 'function' ? bi.getNextSeq() : 0);
      // Copia oculta en el chat del miembro: la cola de reenvío de ese contacto la reintenta si no está a alcance
      var vm = { msgId: wid, messageId: wid, contactNexoId: nx, content: env, _own: true, status: 'sending', timestamp: Date.now(), seq: s, hidden: true };
      if (window.vaultAppendMessage) window.vaultAppendMessage(nx, vm).catch(function() {});
      // Ronda 2763: el id del grupo va por fuera del sobre (directo) para el aviso con la app cerrada (ble_messages.js)
      bi._groupOut = bi._groupOut || new Map(); bi._groupOut.set(wid, g.id);
      if (bi._groupOut.size > 500) bi._groupOut.delete(bi._groupOut.keys().next().value);
      bi.sendChatMessage(nx, env, wid, s).then(function() {
        self._onMemberStatus(wid, 'sent');
      }).catch(function(err) {
        self._onMemberStatus(wid, _failStatus(err));
      });
    });
    console.log('[GROUP] ' + msgId + ' a ' + to.length + ' persona(s) del grupo ' + g.id);
    return msgId;
  }

  // Estado de la copia de un miembro → estado de la burbuja del grupo (el menor de todos)
  _onMemberStatus(wid, status) {
    var mm = /^(gm[0-9a-z]+)_([0-9a-z]{8})$/.exec(String(wid || ''));
    if (!mm || !this.st[mm[1]] || !(status in STATUS_RANK)) return;
    var per = this.st[mm[1]].m, gid = this.st[mm[1]].g, nx = 'nx' + mm[2];
    if (!(nx in per)) return;
    // #131 (informe del dueño 30-10): un miembro en 'sending' puede pasar a CUALQUIER resultado (sent/pending/failed).
    // Antes, como 'sending'(2) rankeaba por encima de 'pending'(1) y 'failed'(0), la compuerta anti-retroceso bloqueaba
    // sending→failed/pending y el miembro con el Bluetooth roto/offline se quedaba «enviando» para siempre → la burbuja
    // del grupo clavada en ○. Solo se bloquea un retroceso REAL desde un estado ya confirmado (p. ej. delivered→sent).
    if ((STATUS_RANK[status] || 0) <= (STATUS_RANK[per[nx]] || 0) && !(per[nx] === 'failed' && status !== 'failed') && per[nx] !== 'sending') return;
    per[nx] = status;
    // Ya le llegó: la copia oculta de su chat sobra (con fotos o archivos ocuparía el tamaño una vez por miembro)
    if (STATUS_RANK[status] >= STATUS_RANK.delivered) vaultDeleteMessage(nx, wid).catch(function() {});
    // #131: la burbuja del grupo muestra el MEJOR progreso común, como WhatsApp — NO el mínimo crudo (un miembro
    // inalcanzable, atascado en 'sending'/'pending'/'failed', dejaba la burbuja en ○ aunque a otro ya le hubiera llegado).
    // ✓✓ (entregado) solo cuando TODOS confirman; ✓ (enviado) en cuanto salió para alguien; ○/⏳ solo mientras no ha
    // salido para nadie; ✗ solo si falló para todos.
    var all = Object.keys(per).map(function(k) { return per[k]; });
    var rk = function(s) { return STATUS_RANK[s] || 0; };
    var min;
    if (all.every(function(s) { return s === 'read'; })) min = 'read';
    else if (all.every(function(s) { return rk(s) >= STATUS_RANK.delivered; })) min = 'delivered';
    else if (all.some(function(s) { return rk(s) >= STATUS_RANK.sent; })) min = 'sent';
    else if (all.some(function(s) { return s === 'sending'; })) min = 'sending';
    else if (all.some(function(s) { return s === 'pending'; })) min = 'pending';
    else min = 'failed';
    this._save();
    _emit('nexo:groups:status', { msgId: mm[1], gid: gid, status: min, per: per });
  }

  // Lo recibido: sobre de grupo de 'from' → { gid, content } (o null si no vale: remitente o yo fuera del grupo)
  receive(env, from, wireId) {
    var me = this._me(), nx = _nid(from);
    var members = env.m.map(_nid).filter(function(x, i, a) { return NX_RE.test(x) && a.indexOf(x) === i; }).slice(0, MAX_MEMBERS);
    var gid = _nid(env.g);
    if (!me || members.indexOf(nx) < 0) return null;
    var g = this.list[gid];
    var leaving = false;
    try { var inner = JSON.parse(env.c); leaving = !!(inner && inner.gl); } catch (e) {}
    if (!g) {
      if (members.indexOf(me) < 0) return null;
      g = this.list[gid] = { id: gid, name: String(env.n || 'Grupo').substring(0, 60), members: members, createdBy: nx, createdAt: Date.now(), lastMessageAt: 0, unreadCount: 0 };
      console.log('[GROUP] Nuevo grupo ' + gid + ' (de ' + nx + ', ' + members.length + ' personas)');
    } else {
      if (g.left) return null;
      if (g.members.indexOf(nx) < 0) return null; // quien no es miembro no cambia el grupo
      // Auditoría (ronda 2774): un sobre NO reescribe la lista de un grupo ya conocido. Antes `g.members = members`
      // dejaba que cualquier miembro cambiara la lista entera (echar a otros, meter desconocidos) y, con ella, colar
      // claves de terceros por env.k. La lista se fija al crear el grupo (no hay forma en la app de añadir después);
      // la única baja es que uno se vaya (gl). Renombrar sigue siendo de cualquier miembro (función del chat).
      if (leaving) g.members = g.members.filter(function(x) { return x !== nx; });
      else if (env.n) g.name = String(env.n).substring(0, 60);
    }
    // Tarjetas de los miembros (solo de miembros de la lista y no la propia): ayudan a tener su clave para escribirles.
    // Al no poder ampliarse la lista de un grupo ya conocido desde un sobre (ver arriba), un atacante ya no puede colar
    // la clave de un tercero que no sea miembro de verdad. (Riesgo residual en la creación: ver H3 en docs/AUDITORIA.md.)
    if (Array.isArray(env.k) && this.ble && typeof this.ble.addSharedContacts === 'function') {
      var cards = env.k.filter(function(c) { var id = _nid(c && c.nexoId); return id !== me && id !== nx && g.members.indexOf(id) >= 0; });
      if (cards.length) this.ble.addSharedContacts(cards, nx, { quiet: true });
    }
    if (wireId) { this.senders.set(wireId, nx); if (this.senders.size > 500) this.senders.delete(this.senders.keys().next().value); }
    this._save();
    _emit('nexo:groups', { id: gid });
    return { gid: gid, content: env.c };
  }

  senderOf(wireId) { return this.senders.get(wireId) || null; }

  // Cambiar el nombre (desde la cabecera del chat): los demás lo ven con el siguiente mensaje
  rename(id, name) {
    var g = this.get(id), n = String(name || '').trim().substring(0, 60);
    if (!g || !n) return;
    g.name = n;
    this._save();
    _emit('nexo:groups', { id: g.id });
  }

  // Lista de chats: último mensaje y no leídos (como en ble_contacts.js)
  noteMessage(gid, preview, ts) {
    var g = this.get(gid);
    if (!g) return;
    g.lastMessage = String(preview || '').substring(0, 80);
    g.lastMessageAt = Math.max(g.lastMessageAt || 0, ts || Date.now());
    this._save();
    _emit('nexo:groups', { id: g.id });
  }
  bumpUnread(gid) { var g = this.get(gid); if (!g) return 0; g.unreadCount = (g.unreadCount || 0) + 1; this._save(); _emit('nexo:groups', { id: g.id }); return g.unreadCount; }
  clearUnread(gid) { var g = this.get(gid); if (!g || !g.unreadCount) return; g.unreadCount = 0; this._save(); _emit('nexo:groups', { id: g.id }); }
  unreadList() { return this.all().filter(function(g) { return g.unreadCount > 0; }).map(function(g) { return { chatId: g.id, count: g.unreadCount }; }); }

  // Nombre corto de un miembro (contacto guardado o su NEXO ID)
  memberName(nx) {
    var c = window.vaultFindContactByNexoId ? window.vaultFindContactByNexoId(nx) : null;
    return (c && (c.name || c.displayName)) || String(nx || '').toUpperCase();
  }
}

export function createGroups(ble) { return new Groups(ble); }
