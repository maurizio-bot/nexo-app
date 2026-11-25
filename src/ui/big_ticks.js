/**
 * NEXO — Palomitas de un archivo grande propio (dueño 24-11, 3b-a). La ✓✓ del mensaje es del aviso/puntero (el otro recibió «hay un
 * archivo»), no del archivo: mientras el archivo grande no haya llegado, la marca se queda en ✓ (enviado); al llegar (bigFiles
 * 'done') se pone la que el otro ya había confirmado (✓✓).
 */
var _held = {};   // msgId → 'delivered' | 'read' (lo que el otro confirmó y se retuvo)
var _apply = null;
var _watching = false;

function _bigIdOf(messageId) {
  try {
    var el = document.querySelector('.msg-status[data-msg-id="' + messageId + '"]');
    var msg = el && el.closest('.message');
    var card = msg && msg.querySelector('.file-attachment[data-big-id][data-big-own="1"]');
    return card ? card.dataset.bigId : null;
  } catch (e) { return null; }
}

// ¿Se retiene esta marca? Devuelve la que se debe poner (la misma o 'sent').
export function bigTickCap(messageId, status) {
  if (status !== 'delivered' && status !== 'read') { if (status === 'sent' || status === 'sending') return status; return status; }
  var id = _bigIdOf(messageId);
  if (!id) return status;
  var b = typeof window !== 'undefined' && window.bleInterface && window.bleInterface.bigFiles, s = b && b.state && b.state(id);
  if (s && s.state === 'done') return status;
  _held[messageId] = (_held[messageId] === 'read' || status === 'read') ? 'read' : status;
  _watch();
  return 'sent';
}

export function bigTicksSetApply(fn) { _apply = fn; }

function _watch() {
  if (_watching || typeof window === 'undefined') return;
  _watching = true;
  window.addEventListener('nexo:big', function(ev) {
    var d = ev && ev.detail;
    if (!d || d.state !== 'done' || d.dir === 'in') return;
    Object.keys(_held).forEach(function(mid) {
      if (_bigIdOf(mid) !== d.id) return;
      var st = _held[mid]; delete _held[mid];
      if (_apply) _apply(mid, st);
    });
  });
}
