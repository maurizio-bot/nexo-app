/**
 * NEXO — Compartir contactos (sacado de main.js en la ronda 2752, sin cambios en su código): hoja para elegir
 * contactos, envío como tarjeta y la tarjeta en el chat. _sendAttachment lo da main.js con shareContactsUse().
 */
import { _closeAttachMenu } from './ui_bits.js';
import { _getCurrentContactId, _normId } from './chat_format.js';
import { vaultLoadContacts } from '../vault/vault_manager.js';
import { ratchetPeerBundle } from '../vault/e2e_ratchet.js';

// [pegamento] Lo que usa del resto de la app (main.js lo da al arrancar)
var _sendAttachment;
export function shareContactsUse(d) { _sendAttachment = d._sendAttachment; } // [/pegamento]


// ===================== v9.9.33: compartir contactos =====================
export function _contactsStyles() {
  if (document.getElementById('nexo-share-styles')) return;
  var st = document.createElement('style');
  st.id = 'nexo-share-styles';
  st.textContent = '@keyframes nexoNewContact{0%,100%{background:rgba(0,200,255,0.05);box-shadow:none}50%{background:rgba(0,200,255,0.25);box-shadow:0 0 12px rgba(0,200,255,0.6)}}' +
    '.ble-contact-new{animation:nexoNewContact 1.2s ease-in-out infinite;border-radius:12px}' +
    '.nexo-pick-row{display:flex;align-items:center;gap:12px;padding:12px 8px;border-bottom:1px solid rgba(255,255,255,0.08);cursor:pointer}' +
    '.nexo-pick-row input{width:22px;height:22px;accent-color:#00c8ff;flex-shrink:0}' +
    '.nexo-card-row{display:flex;align-items:center;gap:8px;padding:6px 0;border-top:1px solid rgba(255,255,255,0.1)}';
  document.head.appendChild(st);
}

export function _handleShareContacts() {
  _closeAttachMenu();
  _contactsStyles();
  var current = _normId(_getCurrentContactId());
  var all = (vaultLoadContacts() || []).filter(function(c) {
    var id = _normId(c.nexoId || c.deviceUUID);
    return id && id !== current && /^nx[0-9a-z]{8}$/.test(id);
  });
  var old = document.getElementById('nexo-share-sheet');
  if (old) old.remove();
  var sheet = document.createElement('div');
  sheet.id = 'nexo-share-sheet';
  sheet.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:#0a0a15;color:#fff;display:flex;flex-direction:column;padding:16px;box-sizing:border-box;';
  sheet.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">' +
    '<button id="nexo-share-cancel" style="background:rgba(255,255,255,0.12);color:#fff;border:none;border-radius:18px;padding:8px 14px;font-size:14px;">Cancelar</button>' +
    '<div style="font-size:18px;font-weight:700;">Enviar contactos</div><div style="width:70px"></div></div>' +
    '<input id="nexo-share-search" placeholder="Buscar..." style="background:rgba(255,255,255,0.08);border:none;border-radius:10px;padding:10px 12px;color:#fff;font-size:15px;margin-bottom:8px;">' +
    '<div id="nexo-share-list" style="flex:1;overflow-y:auto;"></div>' +
    '<button id="nexo-share-send" disabled style="background:linear-gradient(135deg,#00c8ff,#a855f7);color:#fff;border:none;border-radius:12px;padding:14px;font-size:16px;font-weight:600;margin-top:8px;opacity:0.5;">Enviar</button>';
  document.body.appendChild(sheet);
  var listEl = sheet.querySelector('#nexo-share-list');
  var sendBtn = sheet.querySelector('#nexo-share-send');
  var chosen = {};
  function refreshBtn() {
    var n = Object.keys(chosen).length;
    sendBtn.disabled = n === 0;
    sendBtn.style.opacity = n ? '1' : '0.5';
    sendBtn.textContent = n ? 'Enviar (' + n + ')' : 'Enviar';
  }
  function render(filter) {
    listEl.innerHTML = '';
    var f = String(filter || '').toLowerCase();
    var shown = all.filter(function(c) { return !f || String(c.name || '').toLowerCase().indexOf(f) >= 0 || _normId(c.nexoId || c.deviceUUID).indexOf(f) >= 0; });
    if (!shown.length) {
      var empty = document.createElement('div');
      empty.style.cssText = 'opacity:0.6;padding:24px;text-align:center;';
      empty.textContent = all.length ? 'Sin resultados' : 'No tienes otros contactos para enviar';
      listEl.appendChild(empty);
    }
    shown.forEach(function(c) {
      var id = _normId(c.nexoId || c.deviceUUID);
      var row = document.createElement('label');
      row.className = 'nexo-pick-row';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!chosen[id];
      cb.onchange = function() {
        if (cb.checked) {
          chosen[id] = { nexoId: id.toUpperCase(), name: c.name || '', publicKey: c.publicKey || '' };
          // v9.9.41: su paquete de claves del protocolo 2 (si es de su clave aceptada)
          var b2 = c.publicKey && !c.pendingKey ? ratchetPeerBundle(id) : null;
          if (b2 && b2.ik === c.publicKey) chosen[id].b2 = b2;
          if (c.ss && c.publicKey && !c.pendingKey) chosen[id].ss = 1; // v9.9.49: entiende el remitente sellado
          if (c.nt && c.publicKey && !c.pendingKey) chosen[id].nt = 1; // v9.9.51: e internet por relés
        } else delete chosen[id];
        refreshBtn();
      };
      var txt = document.createElement('div');
      var nm = document.createElement('div'); nm.style.cssText = 'font-size:16px;'; nm.textContent = c.name || id.toUpperCase();
      var sub = document.createElement('div'); sub.style.cssText = 'font-size:12px;opacity:0.6;'; sub.textContent = id.toUpperCase();
      txt.appendChild(nm); txt.appendChild(sub);
      row.appendChild(cb); row.appendChild(txt);
      listEl.appendChild(row);
    });
  }
  render('');
  sheet.querySelector('#nexo-share-search').oninput = function() { render(this.value); };
  sheet.querySelector('#nexo-share-cancel').onclick = function() { sheet.remove(); };
  sendBtn.onclick = function() {
    var list = Object.keys(chosen).map(function(k) { return chosen[k]; });
    if (!list.length) return;
    sheet.remove();
    console.log('[ATTACH] Compartiendo ' + list.length + ' contacto(s)');
    _sendAttachment('contact', String(list.length), { contacts: list });
  };
}

// Tarjeta de contactos compartidos en la burbuja (todo como texto: los datos vienen de otro teléfono)
export function _renderContactCard(container, meta, msg) {
  _contactsStyles();
  var list = Array.isArray(meta.contacts) ? meta.contacts.filter(function(c) { return c && /^NX[0-9A-Z]{8}$/i.test(String(c.nexoId || '')); }) : [];
  var card = document.createElement('div');
  card.className = 'contact-card';
  card.style.cssText = 'min-width:200px;max-width:260px;padding:10px 12px;';
  var title = document.createElement('div');
  title.style.cssText = 'font-weight:700;margin-bottom:6px;';
  title.textContent = '👤 ' + (list.length === 1 ? 'Contacto' : list.length + ' contactos');
  card.appendChild(title);
  var bi = window.bleInterface || (window.NEXO.app && window.NEXO.app.bleInterface);
  function isMine(id) { return (vaultLoadContacts() || []).some(function(c) { return _normId(c.nexoId || c.deviceUUID) === _normId(id); }); }
  function isMe(id) { return bi && _normId(bi.localNexoId) === _normId(id); }
  var rows = [];
  list.forEach(function(c) {
    var row = document.createElement('div');
    row.className = 'nexo-card-row';
    var txt = document.createElement('div');
    txt.style.cssText = 'flex:1;min-width:0;';
    var nm = document.createElement('div'); nm.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'; nm.textContent = String(c.name || '').substring(0, 40) || String(c.nexoId).toUpperCase();
    var sub = document.createElement('div'); sub.style.cssText = 'font-size:11px;opacity:0.6;'; sub.textContent = String(c.nexoId).toUpperCase();
    txt.appendChild(nm); txt.appendChild(sub);
    var go = document.createElement('button');
    go.className = 'contact-card-write';
    go.style.cssText = 'background:rgba(0,200,255,0.25);color:#fff;border:none;border-radius:8px;padding:4px 8px;font-size:12px;';
    go.textContent = 'Escribir';
    go.onclick = function(e) { e.stopPropagation(); if (bi && bi.openChat) bi.openChat(_normId(c.nexoId)).catch(function() {}); };
    row.appendChild(txt); row.appendChild(go);
    card.appendChild(row);
    rows.push({ c: c, go: go });
  });
  function refresh() { rows.forEach(function(r) { r.go.style.display = (!isMe(r.c.nexoId) && isMine(r.c.nexoId)) ? 'inline-block' : 'none'; }); }
  refresh();
  if (!msg._own && list.length) {
    var addBtn = document.createElement('button');
    addBtn.className = 'contact-card-add';
    addBtn.style.cssText = 'width:100%;margin-top:8px;background:linear-gradient(135deg,#00c8ff,#a855f7);color:#fff;border:none;border-radius:10px;padding:8px;font-size:14px;font-weight:600;';
    var pending = list.filter(function(c) { return !isMine(c.nexoId) && !isMe(c.nexoId); }).length;
    addBtn.textContent = pending ? 'Agregar a contactos' : 'Ya en tus contactos ✓';
    var doAdd = function(e) {
      if (e) e.stopPropagation();
      if (!bi || typeof bi.addSharedContacts !== 'function') return;
      var r = bi.addSharedContacts(list, msg.senderNexoId);
      addBtn.textContent = r.added.length ? ('Agregados: ' + r.added.length + ' ✓') : 'Ya en tus contactos ✓';
      refresh();
    };
    addBtn.onclick = doAdd;
    card.onclick = doAdd; // pulsar la tarjeta también los agrega
    card.appendChild(addBtn);
  }
  container.appendChild(card);
}
