// Estadística de los diagnósticos recibidos (docs/diagnosticos.json): por día, por categoría y causas que se repiten, y TENDENCIA de síntomas por
// build y por hora del día (COLA 11 de docs/REDES.md). Uso: node tests/sim/diag_stats.js [archivo.json]
// Los diagnósticos recibidos NO son un ritmo (dependen de cuántos pega el dueño): la tendencia se normaliza por «diagnósticos de ese día»
// (cada fallo pesa 1 / diagnósticos de su día) y separa los de la APP de los externos (ajuste del teléfono, app congelada, versión vieja…).
// Campos opcionales por entrada: `origen` ('app' | 'externo' | 'info') y `build` (número); si faltan se INFIEREN de la causa/categoría (ver origenDe, buildDe).
'use strict';
const path = require('path');

const cuenta = (arr, f) => arr.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});
const r1 = (x) => Math.round(x * 10) / 10;

/** 'app' | 'externo' | 'info' | 'sin clasificar'. Primero el campo explícito; si no, por la causa y la categoría (conservador: ante duda, «sin clasificar»). */
function origenDe(x) {
  if (x.origen === 'app' || x.origen === 'externo' || x.origen === 'info') return x.origen;
  const c = String(x.causa || ''), k = String(x.categoria || '');
  if (x.sintoma === 'resumen_diario' || /informativo|medición|medidas reales/i.test(k) || /^(no es un fallo|SIN FALLO)/i.test(c)) return 'info';
  if (/^(APP\b|FALLO DE LA APP)|arreglado en \d{4}/.test(c) || /^(app\b.*\b)?arreglado en \d{4}/i.test(c)) return 'app'; // «APP …» va en mayúsculas (si no, «app del otro congelada» sería de la app)
  if (/^EXTERNO|AJUSTE DEL TELÉFONO|congelad|ahorro de batería|batería baja|falta de memoria|sin memoria|por memoria|fabricante|PowerGenie|optimización de batería/i.test(c + ' ' + k)) return 'externo';
  return 'sin clasificar';
}
/** Build a la que se refiere la entrada: el campo `build` o, si falta, la primera «build NNNN» / «(NNNN)» / «3NNN» de la causa (puede ser la del otro teléfono: es «mencionada»). */
function buildDe(x) {
  if (x.build != null && /^\d{3,5}$/.test(String(x.build))) return String(x.build);
  const m = /build\s*(\d{4})\b|\((\d{4})[,)]|\b(3\d{3})\b/i.exec(String(x.causa || ''));
  return m ? (m[1] || m[2] || m[3]) : null;
}
const horaDe = (x) => { const m = /^(\d{1,2}):/.exec(String(x.hora || '')); return m ? ('0' + m[1]).slice(-2) : null; };
const sintomaDe = (x) => String(x.sintoma || '?').replace(/^par:/, '');

/** Tendencias ya calculadas (para imprimir y para la prueba). */
function tendencias(d) {
  const porDia = cuenta(d, (x) => x.dia);
  const fallos = d.filter((x) => x.sintoma !== 'resumen_diario' && origenDe(x) !== 'info');
  const peso = (x) => 1 / porDia[x.dia]; // un diagnóstico pesa lo que le toca de su día
  const out = { dias: {}, builds: {}, horas: {}, sintomas: {} };
  Object.keys(porDia).sort().forEach((k) => { out.dias[k] = { total: porDia[k], fallos: 0, app: 0, externo: 0, sinClasificar: 0 }; });
  fallos.forEach((x) => {
    const e = out.dias[x.dia]; e.fallos++;
    const o = origenDe(x); if (o === 'app') e.app++; else if (o === 'externo') e.externo++; else e.sinClasificar++;
  });
  Object.values(out.dias).forEach((e) => { e.porDiagnostico = e.total ? r1(e.fallos / e.total * 100) / 100 : 0; });
  fallos.forEach((x) => {
    const b = buildDe(x) || 'sin build';
    const e = out.builds[b] || (out.builds[b] = { fallos: 0, app: 0, externo: 0, sinClasificar: 0, ponderado: 0 });
    e.fallos++; e.ponderado += peso(x);
    const o = origenDe(x); if (o === 'app') e.app++; else if (o === 'externo') e.externo++; else e.sinClasificar++;
    const h = horaDe(x); if (h) { const eh = out.horas[h] || (out.horas[h] = { fallos: 0, app: 0, externo: 0, sinClasificar: 0, ponderado: 0 }); eh.fallos++; eh.ponderado += peso(x); if (o === 'app') eh.app++; else if (o === 'externo') eh.externo++; else eh.sinClasificar++; }
    const s = sintomaDe(x), es = out.sintomas[s] || (out.sintomas[s] = {});
    es[x.dia] = (es[x.dia] || 0) + peso(x);
  });
  Object.values(out.builds).concat(Object.values(out.horas)).forEach((e) => { e.ponderado = Math.round(e.ponderado * 100) / 100; });
  Object.values(out.sintomas).forEach((es) => Object.keys(es).forEach((k) => { es[k] = Math.round(es[k] * 100) / 100; }));
  return out;
}

function imprimir(d) {
  const fallos = d.filter((x) => x.sintoma !== 'resumen_diario');
  console.log('Total: ' + d.length + ' (fallos ' + fallos.length + ', resúmenes ' + (d.length - fallos.length) + ')');
  console.log('\nPor día (fallos / total):');
  const dias = [...new Set(d.map((x) => x.dia))].sort();
  dias.forEach((k) => console.log('  ' + k + ': ' + fallos.filter((x) => x.dia === k).length + ' / ' + d.filter((x) => x.dia === k).length));
  console.log('\nFallos por categoría:');
  Object.entries(cuenta(fallos, (x) => x.categoria)).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log('  ' + n + ' · ' + k));
  console.log('\nCausas:');
  Object.entries(cuenta(fallos, (x) => x.causa)).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log('  ' + n + ' · ' + k));
  console.log('\nTeléfonos con más fallos:');
  Object.entries(cuenta(fallos, (x) => x.nx)).sort((a, b) => b[1] - a[1]).slice(0, 6).forEach(([k, n]) => console.log('  ' + n + ' · ' + k));
  const t = tendencias(d);
  console.log('\nTENDENCIA (normalizada: lo recibido no es un ritmo; cada fallo pesa 1 / diagnósticos de su día; «info» = resúmenes y avisos sin fallo, no cuentan):');
  console.log('  Por día: fallos reales / diagnósticos del día = proporción · de la app / externos / sin clasificar');
  Object.keys(t.dias).forEach((k) => { const e = t.dias[k]; console.log('    ' + k + ': ' + e.fallos + ' / ' + e.total + ' = ' + e.porDiagnostico.toFixed(2) + ' · app ' + e.app + ' / externos ' + e.externo + ' / sin clasificar ' + e.sinClasificar); });
  console.log('  Por build mencionada (en el campo build o en la causa; «sin build» = no se sabe):');
  Object.keys(t.builds).sort().forEach((b) => { const e = t.builds[b]; console.log('    ' + b + ': ' + e.fallos + ' fallos (ponderado ' + e.ponderado.toFixed(2) + ') · app ' + e.app + ' / externos ' + e.externo + ' / sin clasificar ' + e.sinClasificar); });
  console.log('  Por hora del día (México; ponderado):');
  Object.keys(t.horas).sort().forEach((h) => { const e = t.horas[h]; console.log('    ' + h + ' h: ' + e.fallos + ' fallos (ponderado ' + e.ponderado.toFixed(2) + ') · app ' + e.app + ' / externos ' + e.externo + ' / sin clasificar ' + e.sinClasificar); });
  console.log('  Síntoma por día (ponderado; ¿bajan?, ¿vuelven?):');
  Object.keys(t.sintomas).sort().forEach((s) => console.log('    ' + s + ': ' + Object.keys(t.sintomas[s]).sort().map((k) => k.slice(5) + ' ' + t.sintomas[s][k].toFixed(2)).join(' · ')));
}

module.exports = { tendencias, origenDe, buildDe };
if (require.main === module) {
  const f = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '../../docs/diagnosticos.json');
  imprimir(require(f).diagnosticos || []);
}
