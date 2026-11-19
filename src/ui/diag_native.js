// 3245 (dueño 18-11: «¿por qué no despertó el teléfono de Yael?»): el registro nativo del diagnóstico eran solo las últimas
// 150 líneas, y los latidos del Bluetooth (4 líneas cada 18 s) empujaban fuera justo lo que hacía falta: si llegó el toque
// (FCM), si NEXO volvió sola, cuándo empezó a escuchar internet sin la app. Ahora, de lo anterior a esas 150 líneas, se
// conservan las líneas clave (despertares, arranques, red y sobres), hasta 60.
var NAT_TAIL = 150, NAT_KEY_MAX = 60;
var NAT_KEY = /\[(FCM|VUELVE|AUTO_START|FILE_IO)\]|\[LIFECYCLE\] load|Internet sin la app|escuchando \d+ contacto|sobre de |Red por defecto|No se pudo|\[WARN\]\[NET\]/;
export function nativeDiagText(log) {
  if (!log) return '';
  var lines = String(log).split('\n');
  var tail = lines.slice(-NAT_TAIL);
  var old = lines.slice(0, Math.max(0, lines.length - NAT_TAIL)).filter(function(l) { return NAT_KEY.test(l); }).slice(-NAT_KEY_MAX);
  return '\n===== REGISTRO NATIVO (segundo plano / app cerrada) =====\n' +
    (old.length ? '--- antes: solo despertares, arranques, red y mensajes ---\n' + old.join('\n') + '\n--- últimas líneas ---\n' : '') + // i18n-ok: diagnóstico
    tail.join('\n') + '\n';
}
