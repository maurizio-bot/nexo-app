// Dueño 23-11: «primero llega la notificación y luego tarda un poco y llega el audio». El aviso sale al llegar el PUNTERO del buzón de
// archivos, pero el chat no enseñaba nada hasta tener el archivo bajado de los relés. Ahora, al llegar el puntero, el chat abierto ya
// enseña «Recibiendo audio… N %», que avanza por trozos y se quita al terminar (o si no se pudo). Uso: node blobaviso.js [dir_build]
'use strict';
const { importSrc } = require('./srcmod');
(async () => {
  const r = { prueba: 'blobaviso' };
  const ev = [];
  global.window = global; global.CustomEvent = function (n, o) { this.type = n; this.detail = o && o.detail; };
  global.window.dispatchEvent = (e) => { if (e.type === 'nexo:ble:fileProgress') ev.push(e.detail); return true; };
  global.window.addEventListener = () => {}; global.window.removeEventListener = () => {};
  global.document = global.document || { addEventListener() {}, removeEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }), body: { appendChild() {} }, documentElement: { style: {} } };
  const { BLE_BLOB_METHODS: M } = await importSrc('ui/ble_blobs.js');
  const self = Object.assign(Object.create(null), M);
  self._receivedMessageIds = new Set();
  let runs = 0; self._blobRunQueue = () => { runs++; };
  const hex = (i) => (i.toString(16).padStart(2, '0')).repeat(32);
  const ptr = { v: 1, kind: 'file-pointer', alg: 'AES-256-GCM', k: Buffer.alloc(32, 1).toString('base64'), nonce: Buffer.alloc(12, 2).toString('base64'), hash: 'a'.repeat(64),
    size: 8 * 40960, raw: 8 * 40960 - 16, chunk: 40960, expires: Math.floor(Date.now() / 1000) + 3600, relays: ['wss://r1'],
    chunks: Array.from({ length: 8 }, (_, i) => ({ i, id: hex(i + 1), n: 40960 })) };
  self._blobPointerReceived('net:nxaaaaaaaa', 'nxaaaaaaaa', 'msg_audio_1', { attachmentType: 'audio', ptr, meta: { mime: 'audio/mp4' } }, { timestamp: 1 }, null, null);
  const first = ev[0] || {};
  r.aviso_al_momento = first.direction === 'in' && first.fileId === 'msg_audio_1' && first.senderNexoId === 'nxaaaaaaaa' && first.fileType === 'audio' && first.status === 'receiving' && first.percent === 0;
  r.encolado = runs === 1 && self._blobIn.has('msg_audio_1');
  // de grupo: el chat del aviso es el del grupo
  self._blobPointerReceived('net:nxbbbbbbbb', 'nxbbbbbbbb', 'msg_g_1', { attachmentType: 'image', ptr, meta: {} }, { timestamp: 1 }, null, { g: 'grpzzzz', t: 'nexo_grp' });
  r.grupo_en_su_chat = (ev[1] || {}).senderNexoId === 'grpzzzz';
  // progreso y final: _blobProgress con 'done' quita la burbuja
  const j = self._blobIn.get('msg_audio_1');
  self._blobProgress(j, 50, 'receiving'); self._blobProgress(j, 100, 'done');
  r.progreso_y_fin = ev[2].percent === 50 && ev[3].status === 'done';
  // la burbuja del chat se quita con 'done' (render.js)
  const src = require('fs').readFileSync(require('path').join(require('./srcmod').buildDir, 'src/ui/render.js'), 'utf8');
  r.render_quita_al_terminar = /d\.status === 'failed' \|\| d\.status === 'done'\) \{ _removeIncomingPlaceholder/.test(src);
  // el progreso real de la bajada: fetchBlob avisa por trozo (blob_mailbox)
  const bm = require('fs').readFileSync(require('path').join(require('./srcmod').buildDir, 'src/net/blob_mailbox.js'), 'utf8');
  r.bajada_avisa_por_trozo = /o\.progress\(fetched - bad, ptr\.chunks\.length\)/.test(bm);
  r.resultado = Object.keys(r).filter((k) => k !== 'prueba').every((k) => r[k] === true) ? 'OK' : 'FALLO';
  console.log('BLOBAVISO ' + JSON.stringify(r));
  process.exit(r.resultado === 'OK' ? 0 : 1);
})().catch((e) => { console.log('BLOBAVISO ' + JSON.stringify({ prueba: 'blobaviso', error: String(e && e.stack || e).slice(0, 400), resultado: 'FALLO' })); process.exit(1); });
