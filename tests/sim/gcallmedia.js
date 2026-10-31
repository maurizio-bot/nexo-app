// Medios de la llamada en grupo (#128 incremento 2) — prueba de UNIDAD de call_group_media.js con medios SIMULADOS
// (el audio real —micrófono, WebAudio, codec— solo corre en un navegador de verdad; aquí se prueba la ESTRUCTURA:
// una captura compartida que difunde a todos los tramos, un decodificador por tramo que se reutiliza y se mezcla por
// separado, silenciar solo el micrófono, soltar un tramo y parar todo). Uso: node gcallmedia.js
'use strict';

function makeMk(log) {
  return function (o) {
    var inst = {
      // OJO: createCallMedia DEVUELVE el objeto media directamente → localVideo/remoteCanvas son propiedades DEL propio
      // objeto (no inst.media.*). El mock lo refleja para cazar el bug del «.media» de más (2858).
      opts: o, noCapture: !!o.noCapture, started: false, stopped: false, muted: null, woke: false, played: [], playedV: [],
      cameraArg: null, flipped: false, localVideo: { tag: 'localv' }, remoteCanvas: { tag: 'rc' },
      start: function () { inst.started = true; return Promise.resolve({ codec: 'opus' }); },
      stop: function () { inst.stopped = true; },
      mute: function (on) { inst.muted = on; },
      wake: function () { inst.woke = true; },
      play: function (bytes) { inst.played.push(bytes); },
      playVideo: function (bytes) { inst.playedV.push(bytes); }, // #138
      camera: function (on) { inst.cameraArg = on; }, // #138
      flip: function () { inst.flipped = true; return Promise.resolve('user'); }, // #138
      remoteLive: function () { return true; },
    };
    log.push(inst);
    return inst;
  };
}

(async () => {
  const r = { prueba: 'gcallmedia' };
  const { createGroupMedia } = await import('../../src/ui/call_group_media.js');

  const log = [];
  const packets = [];
  const hub = createGroupMedia({ codecs: 'opus,ulaw', onPacket: function (b) { packets.push(b); }, _mk: makeMk(log) });

  // La PRIMERA instancia es la captura compartida (con micrófono: noCapture false).
  r.cap_es_captura = log.length === 1 && log[0].noCapture === false;

  await hub.start();
  r.start_abre_micro = log[0].started === true;

  // El micrófono saca un paquete → el hub lo DIFUNDE (la malla lo manda a todos los tramos).
  log[0].opts.onPacket(new Uint8Array([1, 2, 3]));
  r.difunde = packets.length === 1 && packets[0][0] === 1;

  // Llega voz de dos tramos (B y C): un decodificador por tramo, SOLO reproducir (noCapture true); el mismo tramo
  // reutiliza su decodificador; cada tramo tiene el suyo (se mezclan por separado).
  hub.play('nxb', new Uint8Array([10]));
  hub.play('nxc', new Uint8Array([20]));
  hub.play('nxb', new Uint8Array([11]));
  const nxb = log[1], nxc = log[2];
  r.un_decoder_por_tramo = log.length === 3 && nxb.noCapture === true && nxc.noCapture === true;
  r.decoder_reutilizado = nxb.played.length === 2 && nxc.played.length === 1;
  r.decoder_arranca = nxb.started === true && nxc.started === true;

  // Silenciar afecta SOLO al micrófono propio, no a lo que se oye de los demás.
  hub.mute(true);
  r.mute_solo_captura = log[0].muted === true && nxb.muted === null;

  // Soltar un tramo cierra su decodificador (los demás siguen); si vuelve, se crea uno nuevo.
  hub.drop('nxb');
  r.drop_cierra = nxb.stopped === true && nxc.stopped === false;
  hub.play('nxb', new Uint8Array([12]));
  r.drop_recrea = log.length === 4 && log[3].noCapture === true;

  // Parar: se cierra la captura y TODOS los decodificadores.
  hub.stop();
  r.stop_todo = log[0].stopped === true && nxc.stopped === true && log[3].stopped === true;
  // Tras parar, no se crean más decodificadores.
  hub.play('nxd', new Uint8Array([99]));
  r.stop_no_crea = log.length === 4;

  // #138 vídeo de grupo: un hub CAPAZ de vídeo (cámara apagada por defecto); encender la cámara, difundir mi imagen y
  // recibir la de un tramo. Hub nuevo para no mezclar con el de audio de arriba.
  const logV = [];
  const videoPackets = [];
  const hubV = createGroupMedia({ codecs: 'opus,ulaw', video: true, onPacket: function () {}, onVideoPacket: function (b) { videoPackets.push(b); }, _mk: makeMk(logV) });
  // La captura compartida es capaz de vídeo pero arranca con la cámara APAGADA (cameraStart:false).
  r.cap_video_capaz = logV[0].opts.video === true && logV[0].opts.cameraStart === false;
  await hubV.start();
  // Encender MI cámara pasa por la captura compartida (sin re-llamar).
  hubV.camera(true);
  r.camara_enciende = logV[0].cameraArg === true;
  // La cámara saca una imagen codificada → el hub la DIFUNDE (la malla la manda a los tramos, por Wi-Fi).
  logV[0].opts.onVideoPacket(new Uint8Array([1, 9, 9]));
  r.difunde_video = videoPackets.length === 1 && videoPackets[0][0] === 1;
  // Imagen recibida de un tramo → se decodifica en el decodificador de ESE tramo (no en la captura).
  hubV.playVideo('nxb', new Uint8Array([7]));
  r.video_por_tramo = logV.length === 2 && logV[1].noCapture === true && logV[1].playedV.length === 1;
  // Voltear cámara (delante/detrás) pasa por la captura.
  await hubV.flip();
  r.flip_ok = logV[0].flipped === true;
  // Elementos para la rejilla: la vista propia es la de la CAPTURA; la imagen de un tramo, la de SU decodificador. (Este es
  // el que caza el bug del «.media» de más: antes localVideo()/remoteCanvas() devolvían null y no se veía nada — 2858.)
  r.local_video_el = hubV.localVideo() === logV[0].localVideo && !!logV[0].localVideo;
  r.remote_canvas_el = hubV.remoteCanvas('nxb') === logV[1].remoteCanvas && !!logV[1].remoteCanvas;
  // Apagar la cámara.
  hubV.camera(false);
  r.camara_apaga = logV[0].cameraArg === false;
  hubV.stop();

  const ok = r.cap_es_captura && r.start_abre_micro && r.difunde && r.un_decoder_por_tramo &&
    r.decoder_reutilizado && r.decoder_arranca && r.mute_solo_captura && r.drop_cierra &&
    r.drop_recrea && r.stop_todo && r.stop_no_crea &&
    r.cap_video_capaz && r.camara_enciende && r.difunde_video && r.video_por_tramo && r.flip_ok && r.camara_apaga &&
    r.local_video_el && r.remote_canvas_el;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('GCALLMEDIA ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('GCALLMEDIA FALLO:', e && e.stack); process.exit(1); });
