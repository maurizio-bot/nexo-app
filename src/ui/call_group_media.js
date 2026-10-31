/**
 * call_group_media.js (#128 incremento 2, build 2847+): MEDIOS REALES de la llamada en grupo (malla).
 *
 * La malla (group_call.js) manda TU voz/imagen, ya codificada, a cada tramo, y recibe la de cada uno por su tramo. Aquí:
 *   - UNA captura de micrófono+cámara compartida (una instancia de call_media.js) → su `onPacket` (voz) y `onVideoPacket`
 *     (imagen) son lo que la malla difunde a TODOS los tramos (no se codifica una vez por tramo: se codifica una vez y se
 *     reparte).
 *   - UN decodificador por tramo (instancia `noCapture` de call_media.js, solo reproduce): la voz de cada participante va
 *     a su propio AudioContext y el sistema MEZCLA las salidas; su imagen se decodifica a su propio canvas (`remoteCanvas`).
 *
 * Reusa call_media.js tal cual (codec Opus/μ-law + VP8, filtros de voz, cancelación de eco): nada de audio/vídeo nuevo que
 * mantener. #138 (dueño 31-10): la llamada de grupo es CAPAZ de vídeo pero empieza con la cámara apagada (`cameraStart:false`
 * en la captura); `camera(on)` la enciende y entonces `onVideoPacket` difunde la imagen (solo por Wi-Fi, lo limita la malla).
 * El audio/vídeo real solo se puede probar en un navegador de verdad (el simulador no tiene micrófono/cámara ni WebAudio/
 * WebCodecs), así que la estructura se prueba con `tests/sim/gcallmedia.js` (medios simulados) y lo de verdad lo confirma
 * el dueño en los teléfonos.
 */
import { createCallMedia } from './call_media.js';

export function createGroupMedia(opts) {
  opts = opts || {};
  var onPacket = typeof opts.onPacket === 'function' ? opts.onPacket : function() {};
  var onVideoPacket = typeof opts.onVideoPacket === 'function' ? opts.onVideoPacket : function() {};
  var codecs = opts.codecs || 'opus,ulaw';
  var video = !!opts.video; // capaz de vídeo (la cámara empieza apagada: cameraStart:false)
  var mk = opts._mk || createCallMedia; // inyectable para pruebas (en producción, call_media.js real)
  var stopped = false;

  // Captura compartida: un micrófono + (si procede) una cámara, un codificador → cada paquete va a TODOS los tramos.
  var cap = mk({
    codecs: codecs, video: video, cameraStart: false, voiceFx: opts.voiceFx,
    onPacket: function(bytes) { try { onPacket(bytes); } catch (e) {} },
    onVideoPacket: function(bytes) { try { onVideoPacket(bytes); } catch (e) {} },
  });

  var decoders = new Map(); // nx (tramo) → instancia que SOLO reproduce (voz + imagen)
  function decoderFor(nx) {
    var d = decoders.get(nx);
    if (!d) {
      d = mk({ codecs: codecs, video: false, noCapture: true, onPacket: function() {} });
      decoders.set(nx, d);
      if (!stopped && d.start) { try { Promise.resolve(d.start()).catch(function() {}); } catch (e) {} }
    }
    return d;
  }

  return {
    // Abre el micrófono una sola vez (la malla ya está activa cuando se llama). La cámara NO: empieza apagada.
    start: function() { return cap && cap.start ? cap.start() : Promise.resolve(false); },
    // Voz de un tramo recibida (ya descifrada por group_call): se reproduce en el decodificador de ese tramo. `bytes`
    // es el MISMO formato empaquetado que produce call_media (lo entiende d.play, que hace unpackCallPacket).
    play: function(nx, bytes) { if (stopped || !nx || !bytes) return; var d = decoderFor(nx); if (d && d.play) { try { d.play(bytes); } catch (e) {} } },
    // #138: imagen de un tramo recibida → se decodifica en el canvas de ese tramo (d.playVideo dibuja en su remoteCanvas).
    playVideo: function(nx, bytes) { if (stopped || !nx || !bytes) return; var d = decoderFor(nx); if (d && d.playVideo) { try { d.playVideo(bytes); } catch (e) {} } },
    // #138: encender/apagar MI cámara (la captura compartida). Al encenderla, onVideoPacket empieza a difundir mi imagen.
    camera: function(on) { try { if (cap && cap.camera) cap.camera(!!on); } catch (e) {} },
    // #138: cámara de delante/detrás (devuelve promesa con la orientación final).
    flip: function() { try { return cap && cap.flip ? Promise.resolve(cap.flip()) : Promise.resolve(); } catch (e) { return Promise.resolve(); } },
    // #138: elementos para pintar la rejilla de vídeo (los coloca groupcall_ui): mi vista y la imagen de cada tramo.
    localVideo: function() { return cap && cap.media ? cap.media.localVideo : null; },
    remoteCanvas: function(nx) { var d = decoders.get(nx); return (d && d.media) ? d.media.remoteCanvas : null; },
    remoteLive: function(nx) { var d = decoders.get(nx); return !!(d && d.remoteLive && d.remoteLive()); },
    // Silenciar/activar el micrófono propio (no afecta a lo que se oye de los demás).
    mute: function(on) { try { if (cap && cap.mute) cap.mute(on); } catch (e) {} },
    // La app vuelve al primer plano: reavivar el audio/vídeo.
    wake: function() { try { if (cap && cap.wake) cap.wake(); } catch (e) {} decoders.forEach(function(d) { try { if (d.wake) d.wake(); } catch (e) {} }); },
    // Un tramo se fue: se cierra su decodificador (los demás siguen).
    drop: function(nx) { var d = decoders.get(nx); if (d) { try { if (d.stop) d.stop(); } catch (e) {} decoders.delete(nx); } },
    stop: function() { stopped = true; try { if (cap && cap.stop) cap.stop(); } catch (e) {} decoders.forEach(function(d) { try { if (d.stop) d.stop(); } catch (e) {} }); decoders.clear(); },
  };
}
