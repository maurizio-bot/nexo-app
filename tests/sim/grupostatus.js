// #131 (informe del dueño 30-10): al mandar a un GRUPO, la burbuja del emisor se quedaba en ○ (enviando) aunque a un
// miembro ya le había llegado (se escuchaba la notificación). Dos causas en `groups.js` `_onMemberStatus`:
//   (a) STATUS_RANK ponía 'sending'(2) por ENCIMA de 'pending'(1) y 'failed'(0), y la compuerta anti-retroceso bloqueaba
//       el paso sending→failed/pending → un miembro que fallaba se quedaba en 'sending' para siempre.
//   (b) la burbuja era el MÍNIMO de todos los miembros → un miembro atascado en 'sending' (Bluetooth roto/offline) la
//       dejaba en ○ aunque otro ya hubiera entregado (✓✓).
// Debe ser como WhatsApp: ✓ (enviado) en cuanto el mensaje salió para alguien, ✓✓ (entregado) cuando confirman todos los
// alcanzables, y no quedarse en ○ por un miembro inalcanzable.
// Prueba de UNIDAD de groups.js `_onMemberStatus` (no necesita build; importa src/ui/groups.js).
// Uso: node grupostatus.js
'use strict';
const { webcrypto } = require('crypto');
if (!global.crypto) global.crypto = webcrypto;

// window mínimo: addEventListener (el constructor engancha nexo:ble:ackStatus) + dispatchEvent (captura la burbuja)
const listeners = {};
let lastStatus = null;
class CE { constructor(name, init) { this.type = name; this.detail = init && init.detail; } }
global.CustomEvent = CE;
global.window = {
  addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
  dispatchEvent(ev) {
    if (ev && ev.type === 'nexo:groups:status') lastStatus = ev.detail.status;
    (listeners[ev.type] || []).forEach((fn) => { try { fn(ev); } catch (e) {} });
    return true;
  },
};

(async () => {
  const r = { prueba: 'grupostatus' };
  const { Groups } = await import('../../src/ui/groups.js');

  const ME = 'nxaaaaaaa1', B = 'nxbbbbbbb2', C = 'nxccccccc3';
  const g = new Groups({ localNexoId: ME });
  const gr = g.create('Prueba', [B, C]);
  const mid = 'gmtest01';
  const widB = mid + '_' + B.substring(2), widC = mid + '_' + C.substring(2);
  // estado inicial tras despachar: ambos 'sending' (como hace sendText)
  g.st[mid] = { g: gr.id, m: { [B]: 'sending', [C]: 'sending' } };
  const bubble = () => lastStatus;

  // B entrega (Wi-Fi), C sigue 'sending' (Bluetooth roto, reintentando) → la burbuja NO debe quedar en ○
  g._onMemberStatus(widB, 'sent');
  g._onMemberStatus(widB, 'delivered');
  r.b_entregado_c_enviando = bubble();            // deseado: 'sent'
  r.no_atascada_en_sending = bubble() !== 'sending';

  // C falla del todo (ACK timeout). Con B entregado, la burbuja sigue en ✓ (no ✗, no ○)
  g._onMemberStatus(widC, 'failed');
  r.c_registra_failed = g.st[mid].m[C] === 'failed';   // (a) el fallo SÍ se registra (antes se bloqueaba)
  r.c_failed_bubble = bubble();                         // deseado: 'sent'

  // C se reintenta y queda en buzón (store-and-forward) → sigue ✓ (no ⏳ que tape el progreso de B)
  g._onMemberStatus(widC, 'pending');
  r.c_pending_bubble = bubble();                        // deseado: 'sent'

  // C por fin entrega → ✓✓
  g._onMemberStatus(widC, 'delivered');
  r.ambos_entregado = bubble();                         // deseado: 'delivered'

  // Los dos leen → leído
  g._onMemberStatus(widB, 'read');
  g._onMemberStatus(widC, 'read');
  r.ambos_leido = bubble();                             // deseado: 'read'

  // Caso aparte: TODOS fallan (nadie recibe) → ✗ (no ○)
  const mid2 = 'gmtest02', wB2 = mid2 + '_' + B.substring(2), wC2 = mid2 + '_' + C.substring(2);
  g.st[mid2] = { g: gr.id, m: { [B]: 'sending', [C]: 'sending' } };
  g._onMemberStatus(wB2, 'failed');
  g._onMemberStatus(wC2, 'failed');
  r.todos_fallan = bubble();                            // deseado: 'failed'

  // Caso aparte: los dos offline, encolados en el buzón (store-and-forward), nada entregado aún → ⏳ (pending), no ✗
  const mid3 = 'gmtest03', wB3 = mid3 + '_' + B.substring(2), wC3 = mid3 + '_' + C.substring(2);
  g.st[mid3] = { g: gr.id, m: { [B]: 'sending', [C]: 'sending' } };
  g._onMemberStatus(wB3, 'pending');
  g._onMemberStatus(wC3, 'pending');
  r.ambos_pending = bubble();                           // deseado: 'pending'

  const ok = r.b_entregado_c_enviando === 'sent' && r.no_atascada_en_sending &&
    r.c_registra_failed && r.c_failed_bubble === 'sent' &&
    r.c_pending_bubble === 'sent' &&
    r.ambos_entregado === 'delivered' && r.ambos_leido === 'read' &&
    r.todos_fallan === 'failed' && r.ambos_pending === 'pending';
  r.resultado = ok ? 'OK' : 'FAIL';
  console.log('GRUPOSTATUS ' + JSON.stringify(r));
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); process.exit(1); });
