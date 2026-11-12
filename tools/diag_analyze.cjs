#!/usr/bin/env node
// Analizador de diagnósticos de NEXO (3020, plan del dueño 12-11: «más claro el diagnóstico, mejor lo puedes arreglar»).
// Pre-digiere lo que llega por el canal directo (tools/diag_reader.cjs --json) o un diagnóstico pegado a mano (texto):
//  - cabecera de cada uno: síntoma, build, hora UTC, zona horaria del teléfono, teléfono (batería/red/Doze…),
//  - caminos por contacto (sección ESTADO de la 3020) y los mensajes con problemas (lentos, atascados en sending/pending),
//  - BUCLES: líneas compactadas «↳ ×N» y, en diagnósticos viejos sin compactar, las líneas más repetidas,
//  - FIRMAS CONOCIDAS con la build que las arregló: si un teléfono con esa build o más nueva la tiene, es que REAPARECE
//    (grave: el arreglo no alcanzó); con una build anterior, solo falta actualizar.
// Privacidad: los NEXO ID se acortan a «…» + 4 últimos y las direcciones MAC se tapan. Nada sale de esta sesión.
// Uso: node tools/diag_reader.cjs --json --hora-anterior > /tmp/d.json && node tools/diag_analyze.cjs /tmp/d.json
//      node tools/diag_analyze.cjs diagnostico_pegado.txt      (o por la entrada estándar)
// Última línea: «AVISAR: sí (motivo)» o «AVISAR: no» (la tarea programada manda aviso al teléfono solo con «sí»).
'use strict';
const fs = require('fs');

// Firmas conocidas: patrón en el registro → qué es y en qué build se arregló (docs/ROBUSTEZ.md / PROGRESO.md)
const FIRMAS = [
  { id: 'busqueda_frenada_net', re: /Re-búsqueda aplazada: transferencia en curso/, min: 8, que: 'búsqueda Bluetooth frenada por un envío por internet', arreglo: 3016 },
  { id: 'reenvio_sin_pausa', re: /Pending OK:/, min: 60, que: 'reenvío de pendientes sin pausa (muchos «Pending OK» en 30 min)', arreglo: 3016 },
  { id: 'no_confirma_reenvio', re: /no confirma lo reenviado/, min: 3, que: 'el contacto no confirma lo reenviado (espera creciente activa; mirar su diagnóstico emparejado)', arreglo: null },
  { id: 'openchat_mac_vieja', re: /openChat: forcing connectToDevice/, min: 3, que: 'abrir un chat forzaba la dirección Bluetooth vieja', arreglo: 3017 },
  { id: 'enlace_repetido_bucle', re: /Dedup: cierro enlace repetido/, min: 3, que: 'enlace Bluetooth repetido que se abre y se cierra (escaneo)', arreglo: 3019 },
  { id: 'contacto_reinstalado', re: /se llama igual que .* reinstalado|contacto_duplicado/, min: 1, que: 'contacto duplicado por reinstalación', arreglo: 3018 },
  { id: 'sin_internet', re: /sin internet anunciado/, min: 1, que: 'contacto sin «tiene internet» guardado: no se lee su buzón (normal si su app es muy vieja; desde la 3020 se guarda al agregarlo)', arreglo: null, soloEstado: true, info: true },
  { id: 'blob_rechazado', re: /\[BLOB\] Puntero .* rechazado/, min: 1, que: 'archivo del buzón rechazado (versión/algoritmo)', arreglo: null },
  { id: 'gatt_133', re: /status[= ]133|GATT_ERROR|BT_ERR/, min: 5, que: 'errores GATT 133 repetidos (radio Bluetooth del teléfono)', arreglo: null },
  { id: 'reles_caidos', re: /\[NET\] Sin relés: internet no disponible/, min: 3, que: 'relés de internet que se caen varias veces', arreglo: null },
  { id: 'error_codigo', re: /\[ERROR\]|\[PROMESA\]/, min: 1, que: 'error de código', arreglo: null },
];
// Síntomas graves por sí mismos (aviso al teléfono aunque no sean nuevos)
const GRAVES = /^(error|promesa|par:error)$/;

const mask = (s) => String(s || '')
  .replace(/\b(?:[0-9A-F]{2}:){5}[0-9A-F]{2}\b/gi, '··:··')
  .replace(/\b[0-9a-f]{12}\b/gi, '··:··')
  .replace(/\bnx([0-9a-z]{8})\b/gi, (m, x) => '…' + x.slice(-4).toLowerCase());

function leerEntrada(arg) {
  const raw = arg ? fs.readFileSync(arg, 'utf8') : fs.readFileSync(0, 'utf8');
  try {
    const j = JSON.parse(raw);
    if (j && Array.isArray(j.list)) return j.list.map((e) => ({ sym: e.sym || '?', info: e.info || '', build: e.build || '?', at: e.at || (e.created_at ? e.created_at * 1000 : 0), text: String(e.text || '') }));
  } catch (e) { /* texto */ }
  const m = /síntoma: ([^\s(·]+)(?: \(([^)]*)\))? · build (\S+)/.exec(raw);
  const b = /\nBuild: (\S+)/.exec(raw);
  return [{ sym: m ? m[1] : 'manual', info: m ? (m[2] || '') : '', build: m ? m[3] : (b ? b[1] : '?'), at: 0, text: raw }];
}

function seccion(text, titulo) {
  const i = text.indexOf('===== ' + titulo); if (i < 0) return '';
  const j = text.indexOf('\n=====', i + 6);
  return text.substring(i, j < 0 ? text.length : j);
}

function analizar(d) {
  const t = d.text, lines = t.split('\n'), out = [], alerts = [];
  const build = /^\d+$/.test(String(d.build)) ? Number(d.build) : null;
  out.push('■ ' + d.sym + (d.info ? ' (' + mask(d.info) + ')' : '') + ' · build ' + d.build + (d.at ? ' · ' + new Date(d.at).toISOString().substring(0, 16).replace('T', ' ') + ' UTC' : ''));
  const est = seccion(t, 'ESTADO');
  const zona = /Zona horaria: (.*)/.exec(est); const tel = /Teléfono: (.*)/.exec(est);
  if (zona) out.push('  zona ' + zona[1]); else out.push('  (sin sección ESTADO: build anterior a la 3020)');
  if (tel) out.push('  teléfono: ' + mask(tel[1]));
  // contactos
  const filas = est.split('\n').filter((l) => /^ {2}…[0-9a-z]{4}: /.test(l));
  filas.forEach((l) => out.push('  ' + mask(l.trim())));
  // mensajes con problemas
  const msgs = est.split('\n').filter((l) => /^ {2}\S{8} → /.test(l));
  const malos = msgs.filter((l) => /\[LENTO\]/.test(l) || !/(delivered|read)/.test(l));
  if (msgs.length) out.push('  mensajes: ' + msgs.length + ' recientes, ' + malos.length + ' con problema');
  malos.slice(0, 6).forEach((l) => out.push('    ' + mask(l.trim()).substring(0, 220)));
  // bucles: compactadas (3020) y, sin compactar, las más repetidas
  const loops = [];
  for (let i = 1; i < lines.length; i++) {
    const m = /↳ ×(\d+) más iguales hasta (\S+)/.exec(lines[i]);
    if (m && Number(m[1]) >= 10) loops.push({ n: Number(m[1]) + 1, l: lines[i - 1], hasta: m[2] });
  }
  if (!loops.length) {
    const cnt = new Map();
    lines.forEach((l) => { const k = mask(l).replace(/^\d{2}:\d{2}:\d{2}\.\d{3}\s*/, '').replace(/\d+/g, '#').substring(0, 140); if (k.length > 12) cnt.set(k, (cnt.get(k) || 0) + 1); });
    [...cnt.entries()].filter((e) => e[1] >= 25).sort((a, b) => b[1] - a[1]).slice(0, 4).forEach((e) => loops.push({ n: e[1], l: e[0] }));
  }
  loops.sort((a, b) => b.n - a.n).slice(0, 5).forEach((x) => out.push('  BUCLE ×' + x.n + (x.hasta ? ' (hasta ' + x.hasta + ')' : '') + ': ' + mask(x.l).substring(0, 160)));
  // firmas conocidas
  FIRMAS.forEach((f) => {
    const src = f.soloEstado ? est : t;
    const n = src.split('\n').filter((l) => f.re.test(l)).length;
    if (n < f.min) return;
    let estado;
    if (f.info) estado = 'informativo';
    else if (f.arreglo == null) estado = 'abierto (sin arreglo aún)';
    else if (build == null) estado = 'arreglado en ' + f.arreglo + ' (build desconocida)';
    else if (build >= f.arreglo) { estado = 'REAPARECE: arreglado en ' + f.arreglo + ' y este teléfono tiene la ' + build; alerts.push(f.id + ' reaparece en ' + build); }
    else estado = 'ya arreglado en ' + f.arreglo + ': este teléfono tiene la ' + build + ' (falta actualizar)';
    out.push('  firma ' + f.id + ' ×' + n + ': ' + f.que + ' → ' + estado);
  });
  if (GRAVES.test(d.sym)) alerts.push('síntoma grave ' + d.sym);
  return { out, alerts };
}

function main() {
  const lista = leerEntrada(process.argv[2]);
  if (!lista.length) { console.log('Sin diagnósticos.'); console.log('AVISAR: no'); return; }
  const porSym = {};
  lista.forEach((d) => { porSym[d.sym] = (porSym[d.sym] || 0) + 1; });
  console.log('DIAGNÓSTICOS: ' + lista.length + ' · ' + Object.keys(porSym).map((k) => k + ' ×' + porSym[k]).join(', '));
  const alerts = [];
  lista.forEach((d) => { const r = analizar(d); console.log(r.out.join('\n')); r.alerts.forEach((a) => { if (alerts.indexOf(a) < 0) alerts.push(a); }); });
  console.log(alerts.length ? 'AVISAR: sí (' + alerts.join('; ') + ')' : 'AVISAR: no');
}

module.exports = { analizar, leerEntrada, FIRMAS, mask };
if (require.main === module) main();
