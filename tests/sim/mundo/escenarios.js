// Escenarios de la FASE 1 (internet) del contrato de los caminos (docs/CONTRATO_CAMINOS_28-11.md §C y §D.3: «pasa con escenarios 5–10,
// 20, 21, 26, 29–33, 35 verdes»), sobre el banco tests/sim/mundo/mundo.js con los módulos puros nuevos (src/core/ruta/: calendario,
// contacto_ruta, motivos, politica_reles, reles_puntos). Cada escenario anota sus medidas y si cumple el umbral del contrato.
// Uso: node mundo/escenarios.js [dir_build]
'use strict';
const path = require('path');
const { importSrc } = require('../srcmod');
const { Mundo } = require('./mundo');

(async () => {
  const r = { prueba: 'mundo' };
  const fallos = [];
  const ok = (k, v, info) => { r[k] = v === true ? true : (info || v); if (v !== true) fallos.push(k + (info ? ' ' + info : '')); };
  const M = {
    C: await importSrc('core/ruta/calendario.js'), R: await importSrc('core/ruta/contacto_ruta.js'), MO: await importSrc('core/ruta/motivos.js'),
    P: await importSrc('core/ruta/politica_reles.js'), PU: await importSrc('core/ruta/reles_puntos.js'),
  };
  const RL = ['wss://r1', 'wss://r2', 'wss://r3', 'wss://r4', 'wss://r5', 'wss://r6'];
  const mundo = (o) => { const w = new Mundo(M, o); RL.forEach((u) => w.rele(u)); return w; };
  const p90 = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * 0.9))] : Infinity; };

  // 5 — Lejos, los dos con internet y despiertos: relés de su lista; ≤ 2 sobres/mensaje; ✓ solo tras OK de uno suyo; ✓✓ p90 < 10 s
  {
    const w = mundo(); const A = w.telefono('A', { lee: RL.slice(0, 3) }), B = w.telefono('B', { lee: RL.slice(2, 5) });
    A.mios = RL.slice(0, 4); B.anunciar('A');
    const t = [];
    for (let i = 0; i < 20; i++) { const t0 = w.t; A.escribir('B', 'm5_' + i); w.correr(30000); const g = A.cal.get('m5_' + i); t.push(g.entregadoAt - t0); }
    const sobres = Math.max.apply(null, Array.from({ length: 20 }, (_, i) => w.escriturasDe('m5_' + i)));
    const fuera = RL.filter((u) => B.lee.indexOf(u) < 0).reduce((n, u) => n + w.reles[u].escrituras.length, 0);
    r.e5 = { sobres_max: sobres, a_reles_que_no_lee: fuera, p90_ms: p90(t) };
    ok('e5_lejos_despierto', sobres <= 2 && fuera === 0 && p90(t) < 10000, JSON.stringify(r.e5));
  }
  // 6 — Caso 21:53: mis relés limitan, él lee sus 4, mis reservas abiertas: 0 ✓ falsos y llega al vencer la pausa
  {
    const w = mundo(); const A = w.telefono('A', { lee: RL.slice(0, 2), soloLeer: RL.slice(4, 6) }), B = w.telefono('B', { lee: RL.slice(0, 4) });
    A.mios = RL.slice(0, 2); B.anunciar('A');
    w.reles['wss://r1'].limitaHasta = w.reles['wss://r2'].limitaHasta = w.t + 5 * 60000;
    A.escribir('B', 'm6'); w.correr(2000);
    const falso = A.cal.get('m6').estado === 'GUARDADO';
    const reservas = w.reles['wss://r5'].escrituras.length + w.reles['wss://r6'].escrituras.length;
    w.correr(12 * 60000);
    const g = A.cal.get('m6');
    r.e6 = { falso_check: falso, a_reservas: reservas, estado: g.estado, sobres: w.escriturasDe('m6'), en_pausa: w.enPausa() };
    ok('e6_caso_2153', !falso && reservas === 0 && g.estado === 'ENTREGADO' && w.enPausa() === 0, JSON.stringify(r.e6));
  }
  // 7 — Un relé castiga por IP con la app oculta: el nativo respeta la pausa compartida (0 sobres al castigado)
  {
    const w = mundo(); const A = w.telefono('A', { lee: RL.slice(0, 2) }), B = w.telefono('B', { lee: RL.slice(0, 2) });
    B.anunciar('A');
    w.reles['wss://r1'].castigaHasta = w.t + 30 * 60000;
    A.escribir('B', 'm7a'); w.correr(3000);                 // la app recibe el «banned» de r1 (pausa 10 min) y lo guarda r2
    const antes = w.reles['wss://r1'].escrituras.length;
    A.ocultar();
    for (let i = 0; i < 5; i++) { A.escribir('B', 'm7b' + i); w.correr(60000); }
    const despues = w.reles['wss://r1'].escrituras.length - antes;
    r.e7 = { a_r1_con_app_oculta: despues, en_pausa: w.enPausa(), entregados: [0, 1, 2, 3, 4].filter((i) => A.nat.get('m7b' + i).estado === 'ENTREGADO').length };
    ok('e7_nativo_respeta_pausa', despues === 0 && w.enPausa() === 0 && r.e7.entregados === 5, JSON.stringify(r.e7));
  }
  // 8 — Contacto dormido: 1 publicación + toques 0/2/10 min; 0 republicaciones en 30 min; ✓✓ < 5 s tras abrir él la app
  {
    const w = mundo(); const A = w.telefono('A', { lee: RL.slice(0, 2) }), B = w.telefono('B', { lee: RL.slice(0, 2), toqueDespierta: false });
    B.anunciar('A'); B.dormir();
    A.escribir('B', 'm8'); w.correr(30 * 60000);
    const sob = w.escriturasDe('m8'), toq = A.toquesPor['m8'] || 0, est = A.cal.get('m8').estado;
    const t0 = w.t; B.despertar(true); w.correr(5000);
    const g = A.cal.get('m8');
    r.e8 = { sobres: sob, toques: toq, estado_30min: est, republicados: A.republicados, entregado_tras_abrir_ms: g.entregadoAt ? g.entregadoAt - t0 : null };
    ok('e8_dormido', sob <= 2 && toq >= 3 && toq <= 4 && A.republicados === 0 && est === 'GUARDADO' && g.estado === 'ENTREGADO' && g.entregadoAt - t0 < 5000, JSON.stringify(r.e8));
  }
  // 9 — Caso 23:33: 2 textos pendientes y volver a la app 8 veces: se juntan; nada se republica; ≤ 2 sobres en total (hoy ~70)
  {
    const w = mundo(); const A = w.telefono('A', { lee: RL.slice(0, 2) }), B = w.telefono('B', { lee: RL.slice(0, 2), fcm: false });
    B.anunciar('A'); B.dormir();
    A.escribir('B', 'm9a'); A.escribir('B', 'm9b'); w.correr(2000);
    for (let i = 0; i < 8; i++) { A.ocultar(); w.correr(60000); A.mostrar(); w.correr(30000); }
    const tot = w.escrituras();
    r.e9 = { escrituras_total: tot, republicados: A.republicados, estados: [A.cal.get('m9a').estado, A.cal.get('m9b').estado] };
    ok('e9_caso_2333', tot <= 2 && A.republicados === 0, JSON.stringify(r.e9));
  }
  // 10 — Ráfaga de 30 textos a uno lejano: juntado y cupo: 0 rate-limited; sobres/min ≤ cupo (6)
  {
    const w = mundo(); RL.forEach((u) => { w.reles[u].limitePorMin = 20; });
    const A = w.telefono('A', { lee: RL.slice(0, 2) }), B = w.telefono('B', { lee: RL.slice(0, 2) });
    B.anunciar('A');
    for (let i = 0; i < 30; i++) { A.escribir('B', 'm10_' + i); w.correr(1000); }
    w.correr(120000);
    const por = {}; w.reles['wss://r1'].escrituras.forEach((e) => { const k = Math.floor((e.at - w.t0) / 60000); por[k] = (por[k] || 0) + 1; });
    const maxMin = Math.max.apply(null, Object.values(por));
    const ent = Array.from({ length: 30 }, (_, i) => A.cal.get('m10_' + i).estado).filter((s) => s === 'ENTREGADO').length;
    r.e10 = { rate_limited: A.rateLimited, sobres_por_min_max: maxMin, entregados: ent };
    ok('e10_rafaga', A.rateLimited === 0 && maxMin <= M.C.CAL.SOBRES_MIN && ent === 30, JSON.stringify(r.e10));
  }
  // 20 — App oculta: texto a lejano; vuelve la app: el nativo lo publicó; la app une el diario: 0 republicaciones al volver
  {
    const w = mundo(); const A = w.telefono('A', { lee: RL.slice(0, 2) }), B = w.telefono('B', { lee: RL.slice(0, 2) });
    B.anunciar('A'); B.dormir();
    A.ocultar(); A.escribir('B', 'm20'); w.correr(5000);
    const porNat = w.escriturasDe('m20');
    A.mostrar(); w.correr(120000);
    const despues = w.escriturasDe('m20') - porNat;
    r.e20 = { por_nativo: porNat, al_volver: despues, estado_app: A.cal.get('m20') && A.cal.get('m20').estado };
    ok('e20_nativo_y_vuelve', porNat >= 1 && despues === 0 && /^(GUARDADO|ENTREGADO)$/.test(r.e20.estado_app), JSON.stringify(r.e20));
  }
  // 21 — Se oculta la app a mitad de un envío por internet: el testigo pasa al nativo; 1 solo ejecutor; 0 duplicados
  {
    const w = mundo(); const A = w.telefono('A', { lee: RL.slice(0, 2) }), B = w.telefono('B', { lee: RL.slice(0, 2) });
    B.anunciar('A');
    A.escribir('B', 'm21');
    A.cal.salir('m21', 'net.relay', w.t, 'wss://r1');       // la app lo sacó y aún no tiene la respuesta del relé
    A.ocultar();                                            // … y se oculta
    w.correr(4000);
    const nat = A.nat.diario.filter((e) => e.msgId === 'm21' && e.ev === 'salir' && e.por === 'nativo').length;
    w.correr(60000);
    r.e21 = { ejecutor: A.testigo.ejecutor, salidas_nativo_en_plazo: nat, dups_receptor: B.dups };
    ok('e21_un_ejecutor', A.testigo.ejecutor === 'nativo' && nat === 0 && B.dups === 0, JSON.stringify(r.e21));
  }
  // 26 — Sin ningún camino 2 h; luego aparece uno: PAUSADO(SIN_CAMINO), 0 intentos en 2 h; sale < 2 s tras LISTO
  {
    const w = mundo(); RL.forEach((u) => { w.reles[u].caido = true; });
    const A = w.telefono('A', { lee: RL.slice(0, 2) }), B = w.telefono('B', { lee: RL.slice(0, 2) });
    A.escribir('B', 'm26'); w.correr(2000);
    const int0 = A.cal.get('m26').intentos.length, est = A.cal.get('m26').estado + ':' + A.cal.get('m26').motivo;
    w.correr(2 * 3600000, 10000);
    const int2h = A.cal.get('m26').intentos.length;
    RL.forEach((u) => { w.reles[u].caido = false; });
    const t0 = w.t; A.cal.avisar('camino_listo', 'B', w.t); w.correr(2000);
    const g = A.cal.get('m26');
    r.e26 = { estado: est, intentos_2h: int2h - int0, sale_ms: g.intentos.length ? g.intentos[g.intentos.length - 1].at - t0 : null };
    ok('e26_sin_camino', est === 'PAUSADO:SIN_CAMINO' && int2h === int0 && g.intentos.length === int0 + 1 && g.intentos[g.intentos.length - 1].at - t0 < 2000, JSON.stringify(r.e26));
  }
  // 29 — Relé contesta «blocked: policy»: fuera 6 h para publicar; no cuenta como fallo del contacto
  {
    const w = mundo(); w.reles['wss://r1'].politica = true;
    const A = w.telefono('A', { lee: RL.slice(0, 2) }), B = w.telefono('B', { lee: RL.slice(0, 2) });
    B.anunciar('A');
    A.escribir('B', 'm29'); w.correr(5000);
    const pz = A.pausas['wss://r1'], g = A.cal.get('m29');
    const err = M.MO.deRele(false, 'blocked: Policy violated and pubkey is not in our web of trust').error;
    A.escribir('B', 'm29b'); w.correr(5000);
    r.e29 = { pausa_h: pz ? Math.round((pz.hasta - pz.at) / 3600000) : 0, fallos_contacto: g.fallos['net.relay'] || 0, tipo: err.tipo, cuenta_fallo: M.MO.cuentaComoFallo(err.causa), r1_despues: w.reles['wss://r1'].escrituras.length };
    ok('e29_politica', r.e29.pausa_h === 6 && r.e29.fallos_contacto === 0 && err.tipo === 'NO_REINTENTAR' && !r.e29.cuenta_fallo && r.e29.r1_despues === 1 && g.estado === 'ENTREGADO', JSON.stringify(r.e29));
  }
  // 30 — Archivo 20 MB por internet a 50 KB/s que avanza; luego 70 s parado: no se corta mientras avanza; SIN_AVANCE a los 60 s; reanuda desde el trozo
  {
    const C = new M.C.Calendario({ rnd: () => 0.5 }); let now = 1800000000000;
    C.crear({ msgId: 'f30', nx: 'B', tipo: 'ARCH_GRANDE', chars: 20e6 }, now); C.salir('f30', 'net.relay', now);
    let bytes = 0, cortado = false;
    for (let s = 0; s < 300; s++) { now += 1000; bytes += 50000; C.avance('f30', bytes, now); if (C.vencer(now).length) cortado = true; }
    const enCamino = C.get('f30').estado, hasta = bytes;
    let venceA = null; for (let s = 1; s <= 70; s++) { now += 1000; if (C.vencer(now).length && venceA === null) venceA = s; }
    const g = C.get('f30');
    r.e30 = { cortado_avanzando: cortado, estado_5min: enCamino, sin_avance_a_s: venceA, desde: C.desde('f30'), confirmados: hasta, causa: C.diario.filter((e) => e.ev === 'rechazo').map((e) => e.causa).join(',') };
    ok('e30_avance', !cortado && enCamino === 'EN_CAMINO' && venceA === 60 && C.desde('f30') === hasta && g.estado === 'CREADO' && r.e30.causa === 'SIN_AVANCE', JSON.stringify(r.e30));
  }
  // 31 — Toques FCM degradados en el receptor: se detecta y se anuncia; solo llamadas y el primer pendiente tocan; toques/mensaje ≤ 1
  {
    const w = mundo(); const A = w.telefono('A', { lee: RL.slice(0, 2) }), B = w.telefono('B', { lee: RL.slice(0, 2), fcmDegradado: true });
    B.anunciar('A'); B.dormir();
    for (let i = 0; i < 5; i++) { A.escribir('B', 'm31_' + i); w.correr(20000); }
    w.correr(3 * 3600000, 10000);
    const porMsg = Object.values(A.toquesPor), total = porMsg.reduce((a, b) => a + b, 0);
    const deg = M.R.toqueDegradado(2, 1) && !M.R.toqueDegradado(1, 1);
    const cr = M.R.nuevo('B'); cr.fcm = { tiene: true, degradado: true }; cr.despierto = 'DORMIDO';
    r.e31 = { detecta: deg, toques_total: total, mensajes_con_toque: porMsg.length, llamada_toca: M.R.tocar(cr, 'llamada', false), no_primero_no_toca: !M.R.tocar(cr, 'texto', false) };
    ok('e31_toques_degradados', deg && r.e31.llamada_toca && r.e31.no_primero_no_toca && total / 5 <= 1, JSON.stringify(r.e31));
  }
  // 32 — Contacto nuevo sin anuncio: los míos; al llegar el anuncio, solo los suyos
  {
    const w = mundo(); const A = w.telefono('A', { lee: RL.slice(0, 3) }), B = w.telefono('B', { lee: RL.slice(2, 4) });
    A.mios = RL.slice(0, 3);
    B.despertar(); // B escucha r3, r4
    A.escribir('B', 'm32a'); w.correr(5000);
    const sinAn = w.escrituras();
    B.anunciar('A');
    const base = {}; RL.forEach((u) => { base[u] = w.reles[u].escrituras.length; });
    A.escribir('B', 'm32b'); w.correr(5000);
    const fuera = RL.filter((u) => B.lee.indexOf(u) < 0).reduce((n, u) => n + w.reles[u].escrituras.length - base[u], 0);
    r.e32 = { sin_anuncio_escrituras: sinAn, tras_anuncio_a_reles_que_no_lee: fuera, estado_b: A.cal.get('m32b').estado };
    ok('e32_sin_anuncio', sinAn >= 1 && fuera === 0 && A.cal.get('m32b').estado === 'ENTREGADO', JSON.stringify(r.e32));
  }
  // 33 — Él anuncia una lista nueva sin el relé donde quedó GUARDADO: republica el MISMO evento en uno suyo (LISTA_NUEVA); 1 republicación
  {
    const w = mundo(); const A = w.telefono('A', { lee: RL.slice(0, 3) }), B = w.telefono('B', { lee: ['wss://r1'] });
    A.mios = RL.slice(0, 3); B.anunciar('A'); B.dormir();
    A.escribir('B', 'm33'); w.correr(3000);
    const idEv = A.eventos['m33'] && A.eventos['m33'].id;
    B.lee = ['wss://r2']; B.anunciar('A');
    A.cal.republicar('m33', 'LISTA_NUEVA', w.t); w.correr(3000);
    const idEv2 = A.eventos['m33'] && A.eventos['m33'].id;
    const r2 = w.reles['wss://r2'].escrituras.filter((e) => e.ids.indexOf('m33') >= 0).length;
    // el relé viejo ve «duplicate» si lo recibe otra vez
    const dupViejo = w.publicar('wss://r1', A.eventos['m33'], A).msg;
    r.e33 = { mismo_evento: idEv === idEv2, republicados: A.republicados, en_r2: r2, viejo: dupViejo.split(':')[0] };
    ok('e33_lista_nueva', idEv && idEv === idEv2 && A.republicados === 1 && r2 === 1 && /^duplicate/.test(dupViejo), JSON.stringify(r.e33));
  }
  // 35 — Ráfaga de cambios de red propia (Wi-Fi ↔ datos cada 20 s) durante 10 min: ≤ 1 cambio COSTE por minuto (permanencia + freno)
  {
    const cr = M.R.nuevo('B'); let now = 1800000000000, hechos = [], fij = '';
    for (let s = 0; s < 600; s += 20) {
      now += 20000; const a = (s / 20) % 2 ? 'lan' : 'net.relay';
      const p = M.R.puedeCambiar(cr, 'TEXTO', 'COSTE', now);
      if (p.ok) { hechos.push(now); const f = M.R.anotarCambio(cr, 'TEXTO', 'x', a, 'COSTE', now); if (f) fij = f; }
    }
    const porMin = {}; hechos.forEach((t) => { const k = Math.floor((t - 1800000000000) / 60000); porMin[k] = (porMin[k] || 0) + 1; });
    const cai = M.R.puedeCambiar(cr, 'TEXTO', 'CAIDA', now).ok;
    r.e35 = { cambios: hechos.length, max_por_min: Math.max.apply(null, Object.values(porMin)), fijado: fij, caida_rompe: cai };
    ok('e35_red_propia', r.e35.max_por_min <= 1 && fij === 'FIJADO_ANTIOSCILACION' && cai, JSON.stringify(r.e35));
  }
  // Lugar y despierto (B.1): CERCA → LEJOS solo tras 120 s sin verlo; LEJOS → CERCA al momento
  {
    const cr = M.R.nuevo('B'), t = 1800000000000;
    M.R.ponerLugar(cr, { bleAt: t, netAt: t }, t); const l1 = cr.lugar;
    M.R.ponerLugar(cr, { bleAt: t, netAt: t + 60000 }, t + 100000); const l2 = cr.lugar;
    M.R.ponerLugar(cr, { bleAt: t, netAt: t + 60000 }, t + 125000); const l3 = cr.lugar;
    M.R.ponerLugar(cr, { bleAt: t + 130000, netAt: t + 60000 }, t + 130000); const l4 = cr.lugar;
    M.R.ponerLugar(cr, { lan: true }, t + 131000); const l5 = cr.lugar;
    M.R.ponerDespierto(cr, { appAt: t, nativoAt: t, fcm: true }, t + 100000); const d1 = cr.despierto;
    M.R.ponerDespierto(cr, { appAt: t, nativoAt: t, fcm: true }, t + 200000); const d2 = cr.despierto;
    M.R.ponerDespierto(cr, { appAt: t, nativoAt: t, fcm: true }, t + 700000); const d3 = cr.despierto;
    r.lugar = [l1, l2, l3, l4, l5, d1, d2, d3].join(',');
    ok('B1_lugar_y_despierto', r.lugar === 'CERCA,CERCA,LEJOS,CERCA,MISMA_WIFI,APP,NATIVO,DORMIDO', r.lugar);
  }
  r.fallos = fallos;
  r.resultado = fallos.length ? 'FALLO' : 'OK';
  console.log('MUNDO ' + JSON.stringify(r));
  process.exit(fallos.length ? 1 : 0);
})().catch((e) => { console.log('MUNDO ' + JSON.stringify({ prueba: 'mundo', resultado: 'FALLO', error: String(e && e.stack).slice(0, 600) })); process.exit(1); });
