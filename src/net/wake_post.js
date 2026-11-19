// 3248 (dueño 19-11, diagnóstico del S24 «toque a …: no salió (Failed to fetch)»): el toque (POST al enviador) lo bloqueaba el
// WebView: un POST con «application/json» manda antes una pregunta (OPTIONS) y el servicio la contestaba 405 sin permisos CORS.
// Ahora el POST es «simple» (text/plain: sin pregunta previa; el servicio lee el cuerpo igual). Si el servicio no manda CORS el
// navegador no deja leer la respuesta aunque el toque ya salió: se reintenta en modo opaco para saber si fue la red o solo eso.
// Devuelve { status, opaque }. fetchFn solo para probar.
export function wakePost(url, token, fetchFn) {
  var f = fetchFn || fetch;
  var body = JSON.stringify({ to: token });
  var headers = { 'Content-Type': 'text/plain;charset=UTF-8' };
  return f(url, { method: 'POST', headers: headers, body: body }).then(function(res) {
    return { status: res ? res.status : 0, opaque: false };
  }, function() {
    return f(url, { method: 'POST', mode: 'no-cors', headers: headers, body: body }).then(function() { return { status: 0, opaque: true }; });
  });
}
