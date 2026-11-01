// P6 (diagnóstico real 01-11, dueño): el MISMO mensaje llega por dos caminos (Bluetooth troceado + internet). El buffer
// de reensamblado BLE quedaba a medias y caducaba a los 120 s con «[BleAckSystem] Assembly timeout» (en el log, 2 de 3
// ya estaban ✓✓ por internet minutos antes) → un falso «fallo» de un mensaje que SÍ llegó. Arreglo: dedup entre
// transportes. (1) `dropAssembly(msgId)` cierra el reensamblado BLE a medias cuando el mensaje llega entero por otra vía
// (lo llama ble_messages.onPayloadReceived). (2) un trozo BLE tardío de un msgId ya recibido (dedup central
// `ble._receivedMessageIds`) NO reabre buffer: se acusa recibo y se descarta. Prueba determinista (sin DOM/nativo).
// Uso: node dedupe.js
'use strict';
const { importSrc } = require('./srcmod');
(async () => {
  const r = { prueba: 'dedupe' };
  const { BleAckSystem } = await importSrc('ui/ble_ack.js');

  function mkAck() {
    const ble = { _receivedMessageIds: new Set(), _sendMessageNative: () => Promise.resolve(), _resolveNexoId: () => 'nxb0000002' };
    const ack = new BleAckSystem(ble);
    // aislar de nativo/DOM: solo nos interesa la decisión de (no) abrir buffer y el acuse final
    const finalAcks = [];
    ack._sendFinalAck = (d, m, n) => { finalAcks.push({ d, m, n }); };
    ack._sendNack = () => {};
    ack._sendBlockAck = () => {};
    ack._scheduleBlockAck = () => {};
    ack._reportIncomingProgress = () => {};
    ack._finalAcks = finalAcks;
    if (ack._cleanupTimer) clearInterval(ack._cleanupTimer);
    return { ack, ble, finalAcks };
  }

  // --- 1) dropAssembly: cierra un reensamblado BLE a medias y cancela su temporizador ---
  {
    const { ack } = mkAck();
    let caducó = false;
    ack.incomingBuffers.set('msgX', { chunks: new Map([[0, 'a']]), total: 3, assemblyTimer: setTimeout(() => { caducó = true; }, 150) });
    const cerrado = ack.dropAssembly('msgX');
    r.dropAssembly_cierra = cerrado === true && ack.incomingBuffers.has('msgX') === false;
    await new Promise((res) => setTimeout(res, 250));
    r.dropAssembly_cancela_timer = caducó === false; // el «Assembly timeout» ya no salta
    r.dropAssembly_desconocido_false = ack.dropAssembly('no-existe') === false;
  }

  // --- 2) trozo BLE tardío de un msgId ya recibido por otra vía → NO reabre buffer; acusa recibo ---
  {
    const { ack, ble, finalAcks } = mkAck();
    ble._receivedMessageIds.add('msgY'); // ya llegó entero por internet/Jump/BLE corto
    ack._handleIncomingChunk('net:nxb0000002', { m: 'msgY', i: 0, n: 3, d: 'abc', fr: 'nxb0000002' }, 'c', Date.now());
    r.tardio_no_reabre = ack.incomingBuffers.has('msgY') === false;
    r.tardio_acusa = finalAcks.some((f) => f.m === 'msgY');
  }

  // --- 3) (control) un trozo de un msgId NO recibido todavía SÍ abre buffer (no se rompe lo normal) ---
  {
    const { ack } = mkAck();
    ack._handleIncomingChunk('net:nxb0000003', { m: 'msgZ', i: 0, n: 3, d: 'abc', fr: 'nxb0000003' }, 'c', Date.now());
    r.normal_abre_buffer = ack.incomingBuffers.has('msgZ') === true;
    ack.dropAssembly('msgZ'); // limpiar el temporizador del buffer recién creado
  }

  const ok = r.dropAssembly_cierra && r.dropAssembly_cancela_timer && r.dropAssembly_desconocido_false &&
    r.tardio_no_reabre && r.tardio_acusa && r.normal_abre_buffer;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('DEDUPE ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('DEDUPE FALLO:', e && e.stack); process.exit(1); });
