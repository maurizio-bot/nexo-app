/**
 * call_group_media.js (#128 incremento 2, build 2847+): MEDIOS REALES de la llamada en grupo (malla).
 *
 * La malla (group_call.js) manda TU voz, ya codificada, a cada tramo, y recibe la de cada uno por su tramo. Aquí:
 *   - UNA captura de micrófono compartida (una instancia de call_media.js) → su `onPacket` es el paquete que la malla
 *     difunde a TODOS los tramos (no se codifica una vez por tramo: se codifica una vez y se reparte).
 *   - UN decodificador por tramo (instancia `noCapture` de call_media.js, solo reproduce): la voz de cada participante
 *     va a su propio AudioContext y el sistema MEZCLA las salidas (igual que dos pestañas sonando a la vez). Así se oye
 *     a todos a la vez sin un mezclador propio y sin romper el decodificador opus (que es por-flujo).
 *
 * Reusa call_media.js tal cual (codec Opus/μ-law, filtros de voz, cancelación de eco): nada de audio nuevo que mantener.
 * Audio-only (Fase 1); el vídeo en grupo es el incremento 3. El audio real solo se puede probar en un navegador de verdad
 * (el simulador no tiene micrófono ni WebAudio), así que la estructura se prueba con `tests/sim/gcallmedia.js` (medios
 * simulados) y la voz de verdad la confirma el dueño en los teléfonos.
 */
import { createCallMedia } from './call_media.js';

export function createGroupMedia(opts) {
  opts = opts || {};
  var onPacket = typeof opts.onPacket === 'function' ? opts.onPacket : function() {};
  var codecs = opts.codecs || 'opus,ulaw';
  var mk = opts._mk || createCallMedia; // inyectable para pruebas (en producción, call_media.js real)
  var stopped = false;

  // Captura compartida: un micrófono, un codificador → cada paquete va a TODOS los tramos (lo difunde group_call).
  var cap = mk({ codecs: codecs, video: false, voiceFx: opts.voiceFx, onPacket: function(bytes) { try { onPacket(bytes); } catch (e) {} } });

  var decoders = new Map(); // nx (tramo) → instancia que SOLO reproduce
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
    // Abre el micrófono una sola vez (la malla ya está activa cuando se llama).
    start: function() { return cap && cap.start ? cap.start() : Promise.resolve(false); },
    // Voz de un tramo recibida (ya descifrada por group_call): se reproduce en el decodificador de ese tramo. `bytes`
    // es el MISMO formato empaquetado que produce call_media (lo entiende d.play, que hace unpackCallPacket).
    play: function(nx, bytes) { if (stopped || !nx || !bytes) return; var d = decoderFor(nx); if (d && d.play) { try { d.play(bytes); } catch (e) {} } },
    // Silenciar/activar el micrófono propio (no afecta a lo que se oye de los demás).
    mute: function(on) { try { if (cap && cap.mute) cap.mute(on); } catch (e) {} },
    // La app vuelve al primer plano: reavivar el audio.
    wake: function() { try { if (cap && cap.wake) cap.wake(); } catch (e) {} decoders.forEach(function(d) { try { if (d.wake) d.wake(); } catch (e) {} }); },
    // Un tramo se fue: se cierra su decodificador (los demás siguen).
    drop: function(nx) { var d = decoders.get(nx); if (d) { try { if (d.stop) d.stop(); } catch (e) {} decoders.delete(nx); } },
    stop: function() { stopped = true; try { if (cap && cap.stop) cap.stop(); } catch (e) {} decoders.forEach(function(d) { try { if (d.stop) d.stop(); } catch (e) {} }); decoders.clear(); },
  };
}
