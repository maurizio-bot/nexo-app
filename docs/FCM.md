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
   - Vive en una **Cloud Function de Firebase** (plan gratis: millones de invocaciones/mes) → **coste ≈ $0**.
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
  (token caducado) lo olvida. Probado en `tests/sim/fcmwake.js` (intercambio + disparo + privacidad). **Falta (del
  dueño):** desplegar `push-sender/` con su cuenta y, si el URL del despliegue difiere del estándar, pasármelo para
  `net.setSender(url)`. El disparo real por Google y el despertar del teléfono cerrado se prueban en el móvil.

## Endurecimiento pendiente (auditoría 28-10)
- ✅ **M1 (arreglado 2820):** el «toque» se pedía en CADA envío por relé (cada trozo de un archivo = miles de toques →
  cuota de FCM agotada, batería del par). Ahora solo por **mensaje nuevo** (primer trozo/texto) y con throttle por par
  (8 s). Probado en `fcmwake.js`.
- ✅ **G1 (arreglado 2820):** `startForeground` al despertar por FCM podía lanzar excepción en Android 12+/14+ y
  **cuelgar el proceso**; ahora va protegido (reintenta sin tipo y, si no, `stopSelf`). Se confirma en el teléfono.
- ⏳ **SEC-3 (pendiente, al desplegar):** el endpoint `/wake` es **público y sin autenticar**: quien tenga el token de la
  víctima (sus contactos, o quien reciba un diagnóstico compartido) puede hacerla despertar (spam/batería, tope 8/5 min).
  Antes de usarlo de verdad, **autenticar el disparo** en `push-sender/` (App Check o un HMAC por token). Y, una vez
  confirmada la Fase 1, **quitar el token entero del diagnóstico** (`NexoFcmService`/`NexoBlePlugin` lo apuntan hoy a
  propósito para que el dueño mande un «toque» de prueba a ese token; ya no hará falta). El token no es un secreto fuerte
  (se comparte con los contactos por diseño), pero no conviene dejarlo en un texto que se pueda compartir.
