# NEXO — Diseño: entrega a un contacto OFFLINE (store-and-forward + «cita» FCM)

**BORRADOR para revisión** (dueño + Claude del teléfono). 08-11-2026. **Sin código todavía** — primero lo estudiamos y lo cerramos acá.

## 1. El problema
Un archivo (foto, nota de voz, video, archivo grande) a un contacto que está **OFFLINE** (ni Bluetooth, ni Wi-Fi, ni internet alcanzable) hoy:
- No se entrega: queda ⏳ «en espera» en el teléfono del que envía.
- Solo se intenta despertar al otro **al abrir su chat** — NO por lo pendiente.
- Para archivos no hay «buzón»: los relés solo aceptan ~60 KB por evento, y un video/archivo no entra.

Resultado: el archivo puede quedar horas sin llegar aunque el otro prenda el teléfono. (Diagnóstico del dueño 08-11: video 200 KB + foto 50 KB a nx0ed4a8be, horas en espera, sin tocarle la puerta.)

## 2. Qué hace un server (WhatsApp) — y qué de eso YA tenemos
Un server hace 3 cosas simples (confirmado con investigación):
1. **Guarda** el mensaje cifrado en un buzón del destinatario mientras está offline (no lo lee, solo lo guarda).
2. **Toca** el teléfono del otro con el push de Google/Apple (FCM/APNs) para **despertar la app** — el push SOLO despierta, no lleva contenido.
3. El teléfono, ya despierto, **se baja** lo guardado; se borra al confirmar.

NEXO ya replica esto **para texto, sin server propio**:
- **Buzón** = relés públicos de Nostr (siempre prendidos, de terceros).
- **Toque** = el mismo FCM de Google (`net_link._wake`).

Falta hacerlo para **archivos**.

## 3. El diseño: la «cita» (idea del dueño), en dos modos por tamaño

### 3a. Archivos MEDIANOS (foto, nota de voz, video corto — el caso común)
Se guardan **enteros en el buzón**, partidos en pedazos de ≤60 KB (N eventos de relé, numerados).
- Al enviar: se dejan los N pedazos en el buzón del destinatario + se le toca FCM.
- El otro, al despertar: baja los N pedazos, los arma, confirma. **No hace falta que el que envió esté online.**
- **Totalmente desacoplado:** cero dependencia de que coincidan en el tiempo.

### 3b. Archivos ENORMES (ej. 35 MB) — la «cita»
No caben enteros en el buzón, así que:
1. Al enviar: se deja en el buzón del otro **un pedazo + una marca** «hay un archivo grande tuyo esperando» + el token del que envía.
2. Se **toca FCM** al destinatario, **con freno creciente**, hasta que despierte.
3. Al despertar, su app hace **las dos cosas (idea del dueño)**: (a) baja el pedazo ya guardado, y (b) deja en el buzón del que ENVIÓ la señal «estoy online, mandame el resto» + **le toca FCM a ÉL**.
4. El que envió despierta → los dos online → se manda **el grueso directo**, reanudable, por el mejor camino.

El relé + el toque **mutuo** = la «cita»: se despiertan uno al otro hasta coincidir. **Replica al server sin server propio.**

## 4. Seguridad vs velocidad (regla del dueño: lo funcional primero)
Hay **dos** seguridades y **solo una** cuesta velocidad:
- **Contenido (que nadie lea el archivo):** cifrado **E2E**. SIEMPRE, en todos los caminos. **No cuesta velocidad.** No se negocia.
- **Metadata (quién/cuándo/IP):** la esconde **Tor**. **Sí cuesta velocidad.** Es la perilla.

→ El archivo **nunca es menos seguro por ir rápido**. Solo se dializa cuánta metadata se esconde. «Seguro hasta cierto punto» = contenido al máximo siempre; metadata, la perilla.

**Caminos, de más rápido a más privado:**

| Camino | Velocidad | Qué esconde |
|---|---|---|
| Wi-Fi misma red / Wi-Fi Direct | rapidísimo | local (no sale a internet) |
| Relés (directo) | rápido | contenido (E2E); metadata parcial → etiqueta del buzón **rota por día** |
| Tor (relés por Tor / onion directo) | lento | todo (IP + metadata) |
| Bluetooth | local, cerca | contenido (E2E) |

**Regla:** el camino **más rápido que haya; Tor de respaldo, no de arranque. Nunca forzar todo por Tor** (ahí el usuario se va a otra app).
- Buzón (pedacito + toque, chicos): por **relés directos** → rápido, la cita pasa ya.
- Grueso del archivo: **Wi-Fi/Wi-Fi Direct > trozos por relés > Tor-directo solo** si no hay nada mejor.

(Consistente con la decisión del dueño 01-11: «Tor no va por defecto».)

## 5. Fallas posibles y cómo las dejamos al mínimo (el dueño: «no quiero fallas, y si hay, mínima»)

| Falla posible | Mitigación |
|---|---|
| El relé borra lo guardado tras un tiempo (TTL) | re-dejar la marca/pedazos cada tanto mientras siga pendiente; usar **varios relés** a la vez; la **copia local** del que envía queda de respaldo |
| Spamear FCM (batería/cuota del otro) | toque con **freno creciente** (al toque → cada pocos minutos → cada rato); el throttle por par ya existe |
| Falta el token (no se puede despertar) | token en **los dos sentidos**, guardado en la marca del buzón; se re-intercambia en cada saludo |
| Llega dos veces (buzón + directo) | **dedup por msgId** (ya existe) |
| Privacidad del buzón | etiqueta del destinatario **rota por día**; contenido E2E; el toque no lleva contenido |

## 6. Lo que NO se promete en cero (honesto)
- Un archivo **enorme** a un teléfono que **nunca** se prende a la vez que el del que envía: se entrega el pedazo y se sigue insistiendo, pero el **grueso espera una coincidencia**. Sacarle eso del todo pediría un «guardadero de archivos grandes» de terceros (Nostr/Tor file server) — **opción 2**, se evalúa después.
- Un teléfono **apagado para siempre / nunca con internet**: imposible para cualquier app (WhatsApp incluido).

## 7. Fases de implementación (de menor a mayor riesgo)
1. **Fase A (solo JS):** toque-por-pendiente (freno creciente) + token robusto en el buzón → ya hace que **insistamos en despertar** al otro por lo pendiente.
2. **Fase B (solo JS):** **buzón de archivos medianos** (pedazos ≤60 KB en relés) → entrega **desacoplada** del caso común (fotos, notas de voz, videos cortos).
3. **Fase C (JS + quizá nativo):** la **«cita» completa** para enormes (marca + señal de vuelta + stream al coincidir).
4. **Fase D (opcional):** guardadero de archivos grandes de terceros, para enormes sin coincidencia.

## 8. Cómo lo probamos (antes de subir nada)
- sim de los **DOS casos**: (a) contacto alcanzable (ya andaba), (b) contacto **OFFLINE que despierta después** → el archivo llega **sin que el que envía toque nada**.
- toque-por-pendiente con freno (no spamea; backoff correcto).
- token en los dos sentidos presente.
- dedup (buzón + directo no duplica).

---
*Revisión pendiente del dueño y del Claude del teléfono. Cuando esté redondo, se implementa por fases y se prueba cada una con la batería antes de subir.*
