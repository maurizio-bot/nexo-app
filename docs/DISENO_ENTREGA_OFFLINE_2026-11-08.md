# NEXO — Diseño: entrega eficiente y robusta (offline + fan-out + reenvío)

**BORRADOR v2 (consolidado)** — ideas del dueño + optimizaciones y endurecimiento de Claude. 08-11-2026. **Sin código todavía.** Para revisión del dueño y del Claude del teléfono.

## 1. El problema (qué falla hoy)
- Un archivo a un contacto **OFFLINE** no llega: queda ⏳ en el teléfono del que envía; solo se intenta despertar al otro **al abrir su chat**, no por lo pendiente; y los relés solo aceptan ~60 KB, así que los archivos **no tienen buzón**.
- **Fan-out (a varios / grupos):** hoy NEXO cifra y sube **una vez por destinatario** → a 15 personas = 15 cifrados + 15 copias + 15 subidas. Con N grande + archivo grande → puede **crashear** (memoria, como #2941) o **trabarse** (todo a la vez, como #2887).
- **Reenvío:** reenviar un archivo ya enviado **re-sube de cero** (no reusa nada).

## 2. Qué hace un server (WhatsApp) — y qué YA tenemos
Un server hace 3 cosas: **guarda** el cifrado en un buzón, **toca** el teléfono (FCM/APNs) para despertarlo, y el otro **se baja** lo guardado. NEXO ya lo replica **para texto, sin server propio**: buzón = relés Nostr (de terceros, siempre prendidos); toque = FCM (`net_link._wake`). Falta para **archivos** y falta **optimizar el fan-out/reenvío**.

## 3. Principios (del dueño)
1. **Funcional > seguro, pero seguro hasta cierto punto.** De nada sirve seguro si no funciona.
2. **Contenido E2E siempre** (cifrar es gratis en tiempo). **Metadata = perilla** → Tor de respaldo, no de arranque.
3. **Subir una vez; repartir y reenviar por referencia**, no re-subir desde el teléfono.

## 4. Diseño base (cita + cifrar-una-vez + blob compartido)
- **4a. Cifrar una vez.** El archivo se cifra UNA vez con una **llave al azar K** (sobre/envelope), leyendo del disco → **un solo blob cifrado**, identificado por su **huella** (hash).
- **4b. Subir una vez.** El blob va UNA vez al **buzón** (trozos ≤60 KB en relés) o al **guardadero** (enormes). A cada destinatario se le manda solo **(K + huella + ubicación)** cifrado con SU clave: mensajitos chiquitos.
- **4c. La cita (idea del dueño).** Si el otro está dormido: dejar la marca en su buzón + **tocarlo FCM con freno creciente** hasta que despierte; al despertar, (a) baja lo guardado y (b) deja en el buzón del que envió «ya estoy, mandá el resto» + **lo toca a él**. Se despiertan mutuamente hasta coincidir.
- **4d. Reenvío / fan-out por referencia (idea del dueño).** El blob queda **cacheado por su huella**. Reenviar/repartir el MISMO archivo = mandar solo (K + puntero) → **instantáneo, sin re-subir**.
- **4e. Grupos = consumidor principal.** Un mensaje/archivo de grupo es fan-out puro. **Media de grupo → protocolo nuevo ya** (gran ganancia). **Texto de grupo → como hoy por ahora** (de a pares, barato); la «llave de grupo» (sender keys) = mejora mayor futura, con cuidado por el re-llaveo al entrar/salir alguien.

## 5. Optimizaciones y robustez (lo que agrego yo)
- **5.1 Content-addressing VERIFICADO (crítico, seguridad).** El blob vive en un **relé público**: un relé malicioso podría servir bytes **cambiados** o un archivo **distinto**. Por eso la huella del blob viaja **cifrada E2E** en el puntero, y el que recibe **rechaza** todo lo que no coincida con esa huella. Sin esto, el diseño ingenuo tiene un agujero. (Bonus: la huella da **dedup** y **resume** gratis.)
- **5.2 Trozos con árbol de huellas (Merkle).** El blob se parte en trozos, cada uno con su huella. Esto permite: **bajar de VARIOS relés en paralelo** (más rápido), **re-bajar solo el trozo malo/faltante** (no todo el archivo), y **resume** natural.
- **5.3 Redundancia en relés.** Cada trozo se guarda en **varios relés** (replicación); si uno se cae o expira, el archivo no se pierde. (Erasure coding tipo Reed-Solomon = opción avanzada para después: menos espacio que replicar, misma tolerancia.)
- **5.4 Staging inteligente (no subir siempre).** Si el otro está **alcanzable ya por Wi-Fi/Wi-Fi Direct** → va **directo** (más rápido y más privado, sin pasar por el relé). El buzón/relé se usa para **offline / solo-internet / varios destinatarios**. Así no cargamos el relé al pedo.
- **5.5 «De corrido» con checkpoints (idea del dueño, afinada).** Sobre un socket confiable (Tor-directo/Wi-Fi/WD) se **stremea continuo** (sin el trozo-a-trozo-con-ACK de BLE), **leyendo del disco** (anti-OOM) y con **marcas de resume** cada tanto por si se corta.
- **5.6 Prioridades (lecciones «usuario primero» 2952).** Las transferencias grandes de blob corren en **2.º plano y CEDEN** a lo interactivo (textos, acks, llamadas). Un archivote nunca congela el chat.
- **5.7 Dedup local por huella.** Antes de bajar, el que recibe mira su propia caché: si **ya tiene** ese archivo (un meme reenviado mil veces), **no baja nada**.
- **5.8 Borrar del relé al confirmar + TTL corto.** Cuando **todos** confirmaron, se borra el blob del relé (privacidad + cortesía con el relé); TTL corto por las dudas.
- **5.9 Forward secrecy + «ver una vez».** K viaja por el ratchet (forward secret). Para media **sensible / ver-una-vez**, **no se sube al relé** — solo directo, para no dejar copia.

## 6. Invariantes anti-crash (reglas duras — lecciones de Bluetooth, generalizadas)
Reglas que el código DEBE cumplir siempre (y que se prueban):
1. **Nunca** el archivo entero en memoria → siempre **stream del disco**.
2. **Nunca** cifrar el mismo archivo más de una vez (una K, un blob).
3. **Tope de concurrencia** (MAX_CONCURRENT, ej. 3) → el resto en cola.
4. **Cada destinatario independiente**: uno atascado/offline **no frena ni crashea** a los demás (se va a buzón+cita).
5. **Caché de blobs con tope** (LRU, se evicta lo viejo) y **ritmo por relé acotado** (no floodear un relé).

## 7. Estados y UX (honesto — «experiencia perfecta»)
- ⏳ **«esperando que se conecte»**, nunca ✗ «fallido», para lo que es store-and-forward (va a llegar).
- En grupos, **progreso por miembro** (✓ al primero, ✓✓ cuando todos — como #131).

## 8. Lo que NO se promete en cero (honesto)
- Un archivo **enorme** a un teléfono que **nunca** coincide online con el del que envía: se entrega el pedazo y se insiste, pero el grueso espera una coincidencia (o el guardadero de terceros, opción 2).
- Teléfono **apagado para siempre / sin internet nunca**: imposible para cualquier app.

## 9. Fases (de menor a mayor riesgo)
- **A (JS):** toque-por-pendiente (freno creciente) + token robusto en el buzón.
- **B (JS):** buzón de archivos **medianos** (trozos ≤60 KB en relés, con huellas y redundancia) → entrega desacoplada del caso común.
- **C (JS):** **cifrar-una-vez + blob compartido + reenvío/fan-out por referencia** (dedup por huella). Aplica a **grupos**.
- **D (JS):** la **cita completa** para enormes (marca + señal de vuelta + stream al coincidir).
- **E (opcional):** guardadero de archivos grandes de terceros; erasure coding; sender keys de grupo.

## 10. Plan de prueba ADVERSARIAL (demostrar robustez, no «parece que anda»)
sim que fuerce lo peor y verifique que **no crashea, no bloquea, y entrega**:
1. Relé que se **cae a mitad** de la bajada → se re-baja solo lo que falta, llega.
2. El archivo llega por **dos vías** (buzón + directo) → **dedup**, se arma una sola vez.
3. Archivo **enorme** → **sin OOM** (se stremea del disco, no se materializa entero).
4. **N destinatarios**, algunos offline → los online llegan ya; los offline por buzón+cita; **ninguno frena a otro**.
5. **Miembro entra/sale** del grupo a mitad del fan-out → consistente.
6. Relé que **expira** el blob antes de que el otro despierte → se re-sube (sin re-cifrar) o se espera; no se pierde.
7. El que **envía se va** a mitad del fan-out → lo que ya está en el buzón se entrega solo; el resto reanuda al volver.
8. **Relé malicioso** mete bytes cambiados → la huella no coincide → **se rechaza** (no se muestra basura).

---
*Revisión pendiente del dueño y del Claude del teléfono. Al cerrar, se implementa por fases y se prueba CADA fase con la batería (incluido el plan adversarial de §10) antes de subir.*
