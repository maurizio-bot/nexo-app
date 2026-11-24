// 3317 (COLA 3, Wi-Fi Direct): preparar (cifrar a disco) un archivo grande era el cuello de botella (153 MB en ~30 s, el viaje por Wi-Fi
// Direct 6 s): se leía un pedazo, se esperaba al nativo y recién entonces se leía el siguiente. Ahora el siguiente se lee mientras el nativo
// cifra el anterior. Se comprueba: el archivo llega entero y en orden, 'last' solo en el último, nunca más de 2 pedazos en vuelo, la lectura
// se solapa con el cifrado (más rápido que uno tras otro) y un fallo del nativo a medias se nota (sin seguir mandando).
// Uso: node bigprep.js
'use strict';
const { importSrc } = require('./srcmod');

(async () => {
  const r = { prueba: 'bigprep' };
  const noop = () => {};
  global.window = global; global.window.addEventListener = noop; global.window.removeEventListener = noop; global.window.dispatchEvent = noop;
  global.CustomEvent = global.CustomEvent || function (n, o) { this.type = n; this.detail = o && o.detail; };
  const READ_MS = 30, ENC_MS = 30;
  global.FileReader = function () {};
  global.FileReader.prototype.readAsDataURL = function (blob) {
    const self = this;
    blob.arrayBuffer().then((ab) => setTimeout(() => { self.result = 'data:application/octet-stream;base64,' + Buffer.from(ab).toString('base64'); self.onload(); }, READ_MS));
  };
  const m = await importSrc('ui/big_file.js');
  m.BIG_SLICE; // 512 KB
  const caso = async (size, failAt) => {
    const got = [], lasts = []; let inFlight = 0, maxIn = 0, n = 0;
    window.Capacitor = { Plugins: { NexoBLE: {
      bigBegin: () => Promise.resolve({ ok: true }),
      bigAppend: (o) => { const k = n++; inFlight++; maxIn = Math.max(maxIn, inFlight);
        return new Promise((res, rej) => setTimeout(() => { inFlight--; if (failAt === k) return rej(new Error('disco lleno'));
          if (failAt !== undefined && k > failAt) return rej(new Error('sin preparar'));
          got.push(Buffer.from(o.data, 'base64')); lasts.push(!!o.last); res({ bytes: 0 }); }, ENC_MS)); },
    } } };
    const src = Buffer.alloc(size); for (let i = 0; i < size; i++) src[i] = (i * 7 + 3) & 255;
    const bf = Object.create(m.BigFiles.prototype); bf.st = {}; bf.ble = {};
    const t0 = Date.now(); let err = null;
    try { await bf.prepare(new Blob([src]), 'big_test'); } catch (e) { err = e; }
    return { ms: Date.now() - t0, ok: !err && Buffer.concat(got).equals(src), lasts, maxIn, err, slices: Math.ceil(size / (512 * 1024)), calls: n };
  };
  const a = await caso(10 * 512 * 1024 + 1234); // 11 pedazos
  r.entero_y_en_orden = a.ok;
  r.last_solo_al_final = a.lasts.filter(Boolean).length === 1 && a.lasts[a.lasts.length - 1] === true;
  r.max_2_en_vuelo = a.maxIn <= 2 && a.maxIn >= 1;
  const serie = a.slices * (READ_MS + ENC_MS);
  r.ms = a.ms; r.ms_uno_tras_otro = serie;
  r.solapa = a.ms < serie * 0.8;
  const b = await caso(512 * 1024 - 5); // un solo pedazo
  r.un_pedazo = b.ok && b.lasts.length === 1 && b.lasts[0] === true;
  const c = await caso(6 * 512 * 1024, 2);
  r.fallo_se_nota = !!c.err && c.calls <= 5;
  r.resultado = r.entero_y_en_orden && r.last_solo_al_final && r.max_2_en_vuelo && r.solapa && r.un_pedazo && r.fallo_se_nota ? 'OK' : 'FALLO';
  console.log('BIGPREP ' + JSON.stringify(r));
  process.exit(r.resultado === 'OK' ? 0 : 1);
})().catch((e) => { console.log('BIGPREP ' + JSON.stringify({ prueba: 'bigprep', error: String(e && e.stack || e).slice(0, 400), resultado: 'FALLO' })); process.exit(1); });
