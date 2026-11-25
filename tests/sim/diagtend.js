// COLA 11: tendencia de síntomas por build y por hora en diag_stats.js, normalizada por «diagnósticos de ese día» y separando app / externos.
//  T1  con un JSON de ejemplo: el día con 4 diagnósticos (1 resumen) y 3 fallos da 3/4; los resúmenes y «no es un fallo» no cuentan como fallo
//  T2  origen: explícito gana; si falta, «APP…» = app, congelada/ahorro de batería = externo, lo dudoso = sin clasificar
//  T3  build: el campo gana; si falta, se saca de la causa; sin nada = «sin build»
//  T4  por hora: cada fallo pesa 1 / diagnósticos de su día (un día con 10 diagnósticos no pesa más que uno con 2 por pegar más)
//  T5  síntoma por día: «par:zombi» y «zombi» son el mismo síntoma
//  T6  el programa imprime con el JSON de ejemplo y con el real sin romper
// Uso: node diagtend.js   (no necesita build)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const ds = require('./diag_stats');

const ej = { diagnosticos: [
  { dia: '2026-11-20', hora: '10:05', nx: 'a', sintoma: 'zombi', categoria: 'Bluetooth: zombi', causa: 'app del otro congelada o muerta (ahorro de batería / batería baja)' },
  { dia: '2026-11-20', hora: '10:40', nx: 'a', sintoma: 'par:zombi', categoria: 'Bluetooth: zombi', causa: 'APP (3116). Bucle del desempate' , build: 3116 },
  { dia: '2026-11-20', hora: '21:15', nx: 'b', sintoma: 'enlace_abre_cierra', categoria: 'Bluetooth: abre y cierra', causa: 'revisar el enlace (build 3113)' },
  { dia: '2026-11-20', hora: '23:00', nx: 'a', sintoma: 'resumen_diario', categoria: 'Resumen diario (informativo)', causa: 'no es un fallo' },
  { dia: '2026-11-21', hora: '10:10', nx: 'a', sintoma: 'zombi', categoria: 'Bluetooth: zombi', causa: 'Austin con OPTIMIZACIÓN DE BATERÍA ACTIVA (ajuste del teléfono)', origen: 'externo' },
  { dia: '2026-11-21', hora: '10:20', nx: 'a', sintoma: 'resumen_diario', categoria: 'Resumen diario (informativo)', causa: 'SIN FALLO. 2 enviados, 2 ✓✓' },
] };

(() => {
  const r = { prueba: 'diagtend' };
  const t = ds.tendencias(ej.diagnosticos);
  r.T1 = t.dias['2026-11-20'].total === 4 && t.dias['2026-11-20'].fallos === 3 && t.dias['2026-11-21'].total === 2 && t.dias['2026-11-21'].fallos === 1 && t.dias['2026-11-20'].porDiagnostico === 0.75 && t.dias['2026-11-21'].porDiagnostico === 0.5;
  r.T2 = t.dias['2026-11-20'].app === 1 && t.dias['2026-11-20'].externo === 1 && t.dias['2026-11-20'].sinClasificar === 1 && t.dias['2026-11-21'].externo === 1
    && ds.origenDe({ origen: 'app', causa: 'congelada' }) === 'app' && ds.origenDe({ causa: 'algo raro' }) === 'sin clasificar';
  r.T3 = t.builds['3116'] && t.builds['3116'].fallos === 1 && t.builds['3113'] && t.builds['3113'].fallos === 1 && t.builds['sin build'].fallos === 2 && ds.buildDe({ build: 3200, causa: 'build 3113' }) === '3200';
  r.T4 = t.horas['10'].fallos === 3 && Math.abs(t.horas['10'].ponderado - (0.25 + 0.25 + 0.5)) < 1e-9 && Math.abs(t.horas['21'].ponderado - 0.25) < 1e-9 && !t.horas['23'];
  r.T5 = Object.keys(t.sintomas).sort().join() === 'enlace_abre_cierra,zombi' && t.sintomas.zombi['2026-11-20'] === 0.5 && t.sintomas.zombi['2026-11-21'] === 0.5;
  const tmp = path.join(os.tmpdir(), 'diagtend_ej_' + process.pid + '.json');
  fs.writeFileSync(tmp, JSON.stringify(ej));
  try {
    const o1 = execFileSync('node', [path.join(__dirname, 'diag_stats.js'), tmp], { encoding: 'utf8' });
    const o2 = execFileSync('node', [path.join(__dirname, 'diag_stats.js')], { encoding: 'utf8' });
    r.T6 = /TENDENCIA/.test(o1) && /2026-11-20: 3 \/ 4 = 0\.75 · app 1 \/ externos 1 \/ sin clasificar 1/.test(o1) && /Por hora del día/.test(o1) && /TENDENCIA/.test(o2);
    r.T6_muestra = o1.split('TENDENCIA')[1].split('\n').slice(0, 12).join(' | ').slice(0, 600);
  } finally { try { fs.unlinkSync(tmp); } catch (e) {} }
  const ok = Object.keys(r).filter((k) => k !== 'prueba' && k !== 'T6_muestra').every((k) => r[k] === true);
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('DIAGTEND ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})();
