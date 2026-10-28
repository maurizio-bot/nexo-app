// NEXO — Enviador de «toques» FCM (despertador tipo WhatsApp, #87, Fase 2).
//
// Lo ÚNICO que guarda la llave de Google (service account). Recibe «despierta al token X» y llama a FCM.
// NUNCA ve el contenido del mensaje: solo el token (la «dirección» del teléfono). El mensaje real sigue
// yendo por el camino normal de NEXO (Bluetooth/Wi-Fi o el buzón del relé), cifrado de punta a punta.
// Ver docs/FCM.md.
//
// Manda un mensaje SOLO-DATOS de ALTA prioridad: así Android ejecuta NexoFcmService.onMessageReceived
// aunque la app esté cerrada o congelada (un mensaje de «notificación» no ejecutaría nuestro código).
//
// Despliegue (el dueño, una vez): ver push-sender/README.md. En Cloud Functions, firebase-admin se
// autentica solo con la cuenta de servicio del proyecto; no hay que pegar ninguna llave en el código.

const { onRequest } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');

initializeApp();

// Antiabuso v1 (el token solo lo conocen los contactos, se comparte cifrado): límite de frecuencia por
// token, best-effort EN MEMORIA (se reinicia en un arranque en frío; para algo duradero, Firestore — ver
// README). Evita que, si un token se filtrara, se use para martillear el teléfono con despertares.
const WINDOW_MS = 5 * 60 * 1000; // 5 min
const MAX_PER_WINDOW = 8;        // como mucho 8 toques por token en 5 min
const MAX_TRACKED = 5000;        // tope de tokens vigilados (poda sencilla)
const hits = new Map();          // token -> [timestamps]

function rateLimited(token) {
  const now = Date.now();
  const arr = (hits.get(token) || []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= MAX_PER_WINDOW) { hits.set(token, arr); return true; }
  arr.push(now);
  hits.set(token, arr);
  if (hits.size > MAX_TRACKED) { // poda: quita los más viejos
    for (const k of hits.keys()) { if (hits.size <= MAX_TRACKED) break; hits.delete(k); }
  }
  return false;
}

// POST /wake  body: { "to": "<token FCM>" }  ->  { ok, id } | { error, gone? }
exports.wake = onRequest({ cors: false, region: 'us-central1' }, async (req, res) => {
  try {
    if (req.method !== 'POST') { res.status(405).json({ error: 'usa POST' }); return; }
    const body = req.body || {};
    const token = (body.to == null ? '' : String(body.to)).trim();
    if (token.length < 20 || token.length > 4096) { res.status(400).json({ error: 'falta "to" (token FCM)' }); return; }
    if (rateLimited(token)) { res.status(429).json({ error: 'demasiados toques para ese token; espera' }); return; }

    const id = await getMessaging().send({
      token,
      // SOLO datos (sin "notification"): obliga a Android a ejecutar NexoFcmService con la app cerrada.
      data: { t: 'wake' },
      android: {
        priority: 'high', // exención temporal para arrancar servicio en primer plano desde segundo plano
        ttl: 60 * 1000,   // si no se entrega en 1 min, que caduque (el mensaje real ya está en el buzón)
      },
    });
    res.json({ ok: true, id });
  } catch (e) {
    // Token caducado/desregistrado o inválido: 404 para que la app lo descarte y pida uno nuevo.
    const code = (e && e.errorInfo && e.errorInfo.code) || (e && e.code) || 'error';
    const gone = String(code).includes('registration-token-not-registered') ||
                 String(code).includes('invalid-argument') ||
                 String(code).includes('invalid-registration-token');
    res.status(gone ? 404 : 500).json({ error: String(code), gone });
  }
});
