# NEXO — Enviador de «toques» (push-sender) · FCM Fase 2

El **enviador diminuto** del despertador tipo WhatsApp (#87). Es lo ÚNICO que guarda la **llave de Google**
(cuenta de servicio) y puede pedirle a FCM que **despierte** un teléfono. **Nunca ve el contenido** de los
mensajes: solo recibe un **token** (la «dirección» de un teléfono) y manda un «toque» de «despierta». El
mensaje de verdad sigue yendo por el camino normal de NEXO (Bluetooth/Wi-Fi o el buzón del relé), cifrado de
punta a punta. Ver `docs/FCM.md`.

Es una **Cloud Function de Firebase**. El uso entra de sobra en el plan gratis (millones de invocaciones/mes),
así que el coste real ≈ **$0**.

> **Estado:** escrito y listo para desplegar. **NO está desplegado todavía** (lo despliega el dueño con su
> cuenta de Google). El código de la app que lo llamará es la **Fase 2b** (aún por hacer): compartir el token
> FCM cifrado entre contactos y disparar el «toque» al mandar a alguien que está offline.

---

## Qué hace

`POST /wake` con cuerpo JSON `{ "to": "<token FCM del teléfono a despertar>" }`
→ manda un mensaje **solo-datos de alta prioridad** a ese token y responde `{ "ok": true, "id": "..." }`.

- **Solo-datos** (sin `notification`): así Android ejecuta `NexoFcmService.onMessageReceived` **aunque la app
  esté cerrada o congelada**. (La consola de Firebase solo manda mensajes de *notificación*, que NO ejecutan
  nuestro código; por eso hace falta este enviador para probar el despertar de verdad.)
- **Alta prioridad**: le da a NEXO permiso temporal para arrancar su servicio en segundo plano (como WhatsApp).
- Si el token está caducado/desregistrado, responde **404** (`gone: true`) para que la app lo descarte.

---

## Desplegar (el dueño, ~10 min, una vez)

Requisitos: Node 20 y la CLI de Firebase (`npm i -g firebase-tools`).

```bash
cd push-sender
firebase login                 # con la cuenta de Google del proyecto nexo-7994a
npm install
firebase deploy --only functions
```

Al terminar, la CLI imprime la **URL** de la función, algo como:
`https://us-central1-nexo-7994a.cloudfunctions.net/wake`
(o una URL de Cloud Run `…run.app` con 2ª gen). Esa URL es la que usará la app en la Fase 2b. **Pásamela**
cuando la tengas.

> **Nota de facturación (honesta):** desde 2020, *desplegar* Cloud Functions pide el plan **Blaze**
> (pago por uso). Hay que poner una tarjeta, **pero el uso de esto no cobra nada** (entra en la cuota gratis);
> puedes ponerle un **presupuesto/alerta de $1** para quedarte tranquilo. Si prefieres no activar Blaze, hay
> alternativas (un servidorcito en otro hosting gratis), pero Firebase es lo más simple porque la llave de
> Google se maneja sola.

---

## Probar el despertar de la Fase 1 (sin la app aún)

Con el enviador desplegado puedes probar el **despertar de verdad** del build 2816, que la consola de Firebase
no permite (ella solo manda notificaciones). Toma el `Token FCM:` del diagnóstico del teléfono (Perfil → Copiar
diagnóstico) y:

```bash
curl -X POST https://us-central1-nexo-7994a.cloudfunctions.net/wake \
  -H 'Content-Type: application/json' \
  -d '{"to":"<PEGA_AQUI_EL_TOKEN_FCM>"}'
```

Con NEXO **cerrada**, el teléfono debería despertar y mostrar el aviso «Mensaje nuevo» (lo pone
`NexoFcmService`). Eso confirma el camino completo del despertador.

---

## Seguridad / antiabuso

- **El token es la credencial.** Solo los contactos lo conocen (en la Fase 2b se comparte **cifrado** en el
  intercambio de claves / buzón). Quien no tenga el token no puede pedir el despertar.
- **Límite de frecuencia por token**: v1 lo hace *best-effort en memoria* (8 toques / 5 min por token). Se
  reinicia en un arranque en frío; para un límite duradero, cámbialo a **Firestore** (apunte por token). El
  despertar no filtra contenido pase lo que pase (solo es un «toque»).
- **Endurecimiento futuro (v2):** exigir que el que pide el despertar pruebe que es contacto (p. ej. una firma
  con el secreto de la pareja), además del secreto del token. Pendiente para cuando la Fase 2b esté probada.

---

## Archivos

- `index.js` — la función `wake` (FCM HTTP v1 vía `firebase-admin`).
- `package.json` — dependencias (`firebase-admin`, `firebase-functions`) y runtime Node 20.
- `firebase.json`, `.firebaserc` — apuntan al proyecto `nexo-7994a`.

Esta carpeta es **independiente**: no entra en la APK ni en el build de NEXO (nada en `src/` la importa).

> Si al desplegar alguna versión de `firebase-admin`/`firebase-functions` diera guerra, súbela a la última
> mayor; el código usa la API modular (`firebase-admin/app`, `firebase-admin/messaging`,
> `firebase-functions/v2/https`).
