# NEXO — Despertador tipo WhatsApp (FCM) para cerrar el #87

**Objetivo:** que NEXO reciba mensajes y llamadas **aunque esté cerrada** y el fabricante (Vivo, Samsung…)
la congele — como WhatsApp — **sin perder la privacidad** (sin servidores que vean el contenido).

El dueño autorizó armarlo (28-10: «sí armalo»).

## Principio (lo que lo hace privado)

WhatsApp no se mantiene despierta: la despierta **Google (FCM)**, un canal del sistema que Android nunca
apaga. NEXO hará lo mismo, pero **por Google solo pasa un «toque» de "despierta", nunca el mensaje**:

1. Mandas un mensaje/foto → va por el **camino normal** de NEXO (Wi-Fi/Bluetooth, o al **buzón del relé** si el
   otro no está) — **cifrado de punta a punta, como ahora**.
2. Además, NEXO pide que se mande un **"despierta al teléfono X"** por FCM (≤ unos bytes, sin contenido).
3. Google **despierta NEXO** en el otro teléfono (aunque esté cerrado/congelado).
4. NEXO, ya despierto, **baja el mensaje del camino normal** (el buzón ya cifrado) y lo muestra.

Google solo ve «este teléfono recibió un toque». **Jamás el contenido.** El cifrado E2E no cambia.

## Arquitectura (3 piezas)

1. **App que RECIBE** (cada teléfono):
   - Al abrir, pide su **token FCM** (SDK de Firebase).
   - Comparte ese token con sus contactos (en el intercambio de claves / buzón), para que puedan despertarlo.
   - `FirebaseMessagingService`: al llegar un "despierta", arranca el servicio de NEXO y busca lo pendiente en
     el buzón (la vía nativa `NetBg` que ya existe) y muestra el aviso.

2. **App que ENVÍA** (cada teléfono):
   - Al mandar a un contacto **que no está en línea** (el mensaje va al buzón del relé), pide además un
     "despierta al token del contacto".

3. **Enviador diminuto** («push sender»):
   - Lo único que guarda la **llave de Google** (service account) — **no puede ir en los teléfonos** (se robaría).
   - Recibe «despierta al token X» y llama a la **API HTTP v1 de FCM**. **Nunca ve el contenido** (solo el token).
   - Vive en un **Worker de Cloudflare** (plan gratis: 100.000 pedidos/día; sin tarjeta) → **coste ≈ $0**. (Se pensó
     primero en una Cloud Function de Firebase, pero Firebase Functions exige el plan **Blaze** = tarjeta/prepago; el
     Worker hace lo mismo firmando con la misma cuenta de servicio del proyecto `nexo-7994a`. Ver `push-sender/cloudflare/`.)
   - Antiabuso v1: el token solo lo conocen los contactos (se comparte cifrado), así que solo un contacto puede
     pedir el despertar; + límite de frecuencia por token.

## Privacidad / coste

- **Contenido:** nunca pasa por Google. Sigue P2P y E2E.
- **Lo que Google ve:** que un token recibió un toque (metadato mínimo), igual que con cualquier app con push.
- **Coste:** FCM gratis e ilimitado; la Cloud Function entra en el plan gratis. Sin servidor de pago.
- **Requisito del teléfono:** Google Play Services (el **Vivo lo tiene** → por fin funcionaría en él).

## Fases

- **Fase 0 — proyecto Firebase (SOLO el dueño; su cuenta Google).** Crear el proyecto + registrar la app
  `com.nexo.app` → bajar **`google-services.json`**. (Más adelante, una **llave de service account** para el
  enviador.) *Yo no puedo crear cuentas Google; esto va atado a la cuenta del dueño (llaves, continuidad).*
- **Fase 1 — RECIBIR** (necesita `google-services.json`): SDK de FCM en el Android de NEXO (`com.nexo.app`),
  obtener el token y `FirebaseMessagingService` que despierta y busca en el buzón. Prueba: mandar un "despierta"
  de prueba (desde la consola de Firebase o el enviador) y ver que NEXO cerrado se despierta y baja el mensaje.
- **Fase 2 — ENVIAR** (necesita la llave del service account + desplegar): intercambio del token FCM entre
  contactos (en el kx/relé), el enviador (Cloud Function) y disparar el "despierta" al mandar a un contacto
  offline. La plomería de NEXO (intercambio de token, disparo al postear al buzón, dedup) se valida en
  `tests/sim` con un FCM de mentira; el push real se prueba en los dos teléfonos.

## Qué necesito del dueño (Fase 0, una sola vez, ~10 min)

1. Entra en **console.firebase.google.com** con tu cuenta de Google → **«Crear un proyecto»** (nómbralo p. ej. «NEXO»).
2. Dentro del proyecto, icono de **Android** → **Nombre del paquete: `com.nexo.app`** (exacto) → Registrar app.
3. **Descarga `google-services.json`** y pásamelo (ese archivo no es secreto: es la config pública del app).
4. (Para la Fase 2, después) **Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada**
   → ese JSON **SÍ es secreto**: no lo pegues en el chat tal cual; lo metemos en el entorno del enviador.

Con el `google-services.json` ya engancho el SDK de FCM en el Android y probamos el "despierta" en los teléfonos.

## Estado

- 28-10: autorizado por el dueño («sí armalo»).
- **Fase 0 — HECHA.** El dueño creó el proyecto Firebase `nexo-7994a` y registró la app `com.nexo.app`;
  `google-services.json` está en `android/app/` (config pública, no secreta).
- **Fase 1 (recibir) — HECHA y compilada (build 2816).** Firebase (solo mensajería) en el Android:
  plugin `google-services` 4.5.0 (único compatible con AGP 9.4), Firebase BOM 34.3.0 + `firebase-messaging`
  en `plugins/nexo-ble`, `NexoFcmService` (arranca el servicio y avisa al llegar el toque; token en `onNewToken`),
  registrado en el manifest, y `NexoBlePlugin.load` apunta el token en el diagnóstico. No se puede simular: se
  compiló antes en una rama de prueba (`workflow_dispatch`, APK artifact OK) para no romper la nightly de NEXOCHAT;
  Firebase + AGP 9 compiló a la primera. **Falta la prueba en el teléfono:** instalar, abrir NEXO, copiar
  diagnóstico (línea `Token FCM: …`) y mandar un «toque» de prueba a ese token (consola de Firebase o `curl`) para
  ver que el Vivo cerrado despierta.
  - Nota técnica: el despertar REAL (que corra `onMessageReceived` con la app cerrada) necesita un mensaje
    **solo-datos** de **alta prioridad**; la consola de Firebase manda mensajes de *notificación* (sirven para
    confirmar que FCM llega al teléfono cerrado, pero no ejecutan nuestro código). El toque solo-datos se prueba
    del todo con el enviador de la Fase 2 (o un `curl` con credenciales).
- **Fase 2 — plomería de la app HECHA y probada (28-10); falta desplegar.** El Android expone el token
  (`getFcmToken`); la app lo comparte con cada contacto en el saludo cifrado (`body.f` en `net_link.js`), lo guarda
  (sobrevive al reinicio), y al mandar un mensaje por el buzón de los relés pide el «toque» al enviador
  (`_wake` → `POST {to: token}` al `senderUrl`, por defecto la Cloud Function estándar del proyecto; `setSender(url)`
  para cambiarla). Por el «toque» va **SOLO el token, nunca el contenido**; un saludo no dispara toque; un 404
  (token caducado) lo olvida. Probado en `tests/sim/fcmwake.js` (intercambio + disparo + privacidad).
- **Fase 2 — DESPLEGADA (03-11) en Cloudflare Workers.** Como Firebase Functions exigía el plan Blaze (tarjeta +
  prepago, y además dio errores de facturación OR-CBAT), se desplegó el enviador equivalente en **Cloudflare Workers**
  (gratis, sin tarjeta): `push-sender/cloudflare/worker.js` (mismo contrato `POST {to} → toque solo-datos de alta
  prioridad`, firma RS256 del OAuth de Google con la cuenta de servicio del proyecto, probada en `test_sign.mjs`). El
  dueño lo publicó en `https://nexo-wake.maurizioamistani.workers.dev` y guardó la llave como secreto `SA_B64`. **Credenciales
  verificadas con `curl`** (token de prueba → `{"error":"fcm","status":400}`, es decir Google aceptó la llave y solo
  rechazó el token falso = la firma/OAuth funciona). La app ya apunta ahí por defecto (`DEFAULT_SENDER` en `net_link.js`).
  **Falta:** la prueba del despertar real en el teléfono cerrado (token real → `{"ok":true}` y el móvil despierta).

## Endurecimiento pendiente (auditoría 28-10)
- ✅ **M1 (arreglado 2820):** el «toque» se pedía en CADA envío por relé (cada trozo de un archivo = miles de toques →
  cuota de FCM agotada, batería del par). Ahora solo por **mensaje nuevo** (primer trozo/texto) y con throttle por par
  (8 s). Probado en `fcmwake.js`.
- ✅ **G1 (arreglado 2820):** `startForeground` al despertar por FCM podía lanzar excepción en Android 12+/14+ y
  **cuelgar el proceso**; ahora va protegido (reintenta sin tipo y, si no, `stopSelf`). Se confirma en el teléfono.
- **SEC-3 (03-11): endurecido de forma proporcionada.** Primero, el daño real: un «toque» solo DESPIERTA al teléfono
  (arranca NEXO, que busca en el buzón cifrado y muestra lo que haya o se vuelve a dormir). Un toque espurio → el teléfono
  despierta, no encuentra nada y se duerme. O sea: el único daño del spam de toques es **batería** (NO una filtración ni un
  mensaje falso: el contenido siempre viene E2E del buzón, autenticado). Con eso en mente:
  - ✅ **Token fuera del diagnóstico (build 2898).** `NexoFcmService.onNewToken` y `NexoBlePlugin.logFcmToken` ya **no**
    escriben el token completo al diagnóstico, solo un prefijo + largo (`djG9qoyyTreG... (142 car.)`). Así, un diagnóstico
    compartido (con soporte, un foro, conmigo) ya **no** deja a nadie despertar ese teléfono. Era la vía de fuga real hacia
    NO-contactos (el token sí se comparte con los contactos, cifrado, por diseño — lo necesitan para despertarte).
  - ✅ **Tope en el enviador:** el Worker ya limita 8 toques / 5 min por token (best-effort en memoria), que acota el gasto
    de batería incluso si un contacto quisiera molestar.
  - ⏳ **Diferido (fase mayor, solo si hace falta): autenticación por pareja** (que SOLO un contacto real pueda despertarte,
    con firma). Requiere que el Worker guarde estado por usuario (una base tipo KV/Durable Objects) + un alta con prueba de
    propiedad del token. Dado que el daño es **solo batería** (no hay brecha), esa complejidad no se justifica ahora; queda
    documentada por si el abuso real lo pide. App Check (atestiguar que el pedido viene de la app genuina) es otra opción
    para frenar scripts, pero no frena a un contacto malicioso.
