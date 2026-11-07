# NEXO — ¿Qué tan atacable es? Análisis de infiltración y rumbo pro‑IA / anti‑IA (07‑11‑2026)

> Pedido del dueño (07‑11): (1) contra un ataque real de gente experta, ¿qué probabilidad hay de que se
> infiltren en NEXO y roben datos reales? (2) que NEXO sea **pro‑IA** (que la IA del propio usuario pueda
> usar NEXO fácil y rápido) y **anti‑IA** (que ninguna IA pueda meterse, hackearlo o dañarlo); (3) un
> análisis muy específico: **cómo me infiltraría yo en un teléfono que tenga NEXO**.
>
> Este informe está aterrizado en el **código real** (archivo:línea verificados el 07‑11 contra la build ~2944),
> cruzando las cuatro rondas de `docs/AUDITORIA.md`, `docs/AUDITORIA_ZIP_03-11.md`, `docs/AUDITORIA_COMPLETA_03-11.md`,
> `docs/INVESTIGACION_RED_2026-11-07.md` y el catálogo `tests/sim/robustez.json`. Es un ejercicio **defensivo**
> (red‑team de la propia app para blindarla): describe rutas de ataque y cómo cerrarlas, **no** entrega exploits.

---

## 0. Resumen en tres frases (lo que me preguntaste)

1. **Robar el CONTENIDO de los mensajes atacando la red o el cifrado de NEXO es muy poco probable**, incluso para
   expertos: el núcleo criptográfico es sólido y la superficie de red está endurecida. Las dos formas reales de
   entrar son **(a) un «hombre en el medio» en el instante exacto del primer contacto** si el usuario no verifica el
   número de seguridad, y **(b) adueñarse del teléfono** (malware, acceso físico, un fallo 0‑day de Android) — y eso
   último derrota a **cualquier** app de mensajería, no solo a NEXO.
2. **Pro‑IA y anti‑IA no se contradicen** si la frontera es el **dispositivo + el consentimiento**: la IA *del usuario*,
   corriendo *en su teléfono*, con permiso explícito y sin tocar las claves, puede manejar NEXO; cualquier IA *de afuera*
   (por la red, como par o atacante) choca con el mismo cifrado que frena a un humano — **falta** sumar fricción
   anti‑automatización (hoy no hay ninguna).
3. **La ruta más realista para meterme en un teléfono con NEXO es el propio teléfono y el usuario** (un APK falso de
   «actualización de NEXO», otra app, acceso físico), no romper el cifrado; la segunda es el **MITM del primer contacto**.

---

## 1. ¿Qué tan probable es que un experto robe datos reales?

No hay un número único honesto: la probabilidad depende de **quién** ataca y de **cómo se comporta el usuario**. Lo
honesto es separarlo por tipo de atacante.

### 1.1. Lo que está SÓLIDO (robar contenido por aquí ≈ no pasa)

- **Cifrado de extremo a extremo (Protocolo 2, el actual):** Double Ratchet + X3DH + AAD + poscuántico ML‑KEM‑768.
  El AAD liga remitente|destino|id (`e2e_ratchet.js:378`): no se puede cambiar el `from`/`to`/`id` ni repetir con otro
  id. Antes de cualquier bucle hay topes anti‑DoS (`_parse` rechaza `n/pn>1e7` en `e2e_ratchet.js:375`; `_skip`
  acota `MAX_SKIP` en `:382`), descifra sobre copia (`:396`) y hay anti‑rebaja poscuántica (`pqSeen`) y anti‑repetición
  del X3DH (`seenEk`). **Leer mensajes en el aire es inviable.**
- **Parseo y memoria nativos (no se cae con un paquete):** `SafeJson.kt:9-30` (tope 16 MB y profundidad 48 antes de
  parsear nada ajeno), saludo Wi‑Fi acotado a 8 KB (`LanHub.kt:49`), avalancha de conexiones acotada
  (`MAX_PREAUTH=64`, `LanHub.kt:52`), inundación de escaneo acotada (`LanBeacon.kt:38-40`), trozos acotados
  (`MAX_CHUNKS=300000`, `ble_ack.js:669`). La clase «un solo paquete tumba la app» está **cerrada**.
- **Datos en reposo (teléfono robado/bloqueado):** vault cifrado AES‑256‑GCM con clave no exportable en el Keystore
  de Android (`AtRestStore.kt:15-47`), con guardia anti‑salida‑de‑directorio (`:66`); bloqueo por huella/PIN
  (`app_lock.js` + `AuthPlugin.kt`); **sin copia a la nube** (`AndroidManifest.xml` `allowBackup="false"`,
  `fullBackupContent="false"`); opción de bloquear capturas (`setSecureScreen`, `NexoBlePlugin.kt:2894`).
- **Inyección de código por contenido recibido (XSS):** todo lo que manda el otro se pinta con `textContent` o
  escapado; CSP presente (`index.html:14`). **Sin XSS conocido.**
- **Metadatos de contenido y de identidad:** etiqueta por pareja que **rota a diario** en los relés (el relé no sabe
  quién es A ni B), remitente **sellado** en Jump (`e2e_crypto.js:159-168`, clave efímera por sobre), **ID Bluetooth
  rotativo** (`RidToken.kt:13`), y opción de **Tor directo** entre los dos (oculta las IP a los relés).

### 1.2. Los HUECOS reales (por donde sí se podría)

| Hueco | Qué permite | Límite real | Dónde |
|---|---|---|---|
| **MITM del primer contacto por ID (SEC‑2)** | Quien conoce tu NEXO ID (semi‑público) forja un `acc`; si tenías una solicitud saliente pendiente, **te agrega su clave en silencio** → puede leer ESE chat. | Solo al **primer** contacto; se detecta comparando el número de seguridad; no cambia una clave ya establecida. | `net_link.js:110-112,411`, `ble_links.js:191-198` |
| **Confianza ciega en la primera clave (H3, TOFU)** | La primera clave de un contacto (tarjeta, Bluetooth, creación de grupo) se fija **sin verificar**. | Igual que arriba: solo la primera; la verificación por QR/número existe pero es **opcional**. | `ble_keys.js:64` |
| **Reuso de nonce del ratchet tras restaurar (P0‑1)** | No es un ataque activo: al **restaurar** un estado viejo (pasar la cuenta, recuperar con Fénix, un backup, dejar el teléfono viejo encendido) se **repite (clave, IV)** sobre texto distinto → catástrofe criptográfica. El IV se deriva determinista del `mk` sin contador anti‑rollback. | Lo dispara el **uso normal**, no un atacante; **no hay prueba** que lo vigile. | `e2e_ratchet.js:100-108` |
| **E1 legado sin AAD (S‑1)** | Para un contacto aún en Protocolo 1, un mensaje capturado se puede **reinyectar** con otro msgId (repetición/duplicado). | Se achica a medida que los contactos migran a proto‑2. | `e2e_crypto.js:138-143` |
| **Metadatos a los relés sin Tor** | El relé ve la **IP y la hora** de conexión de cada teléfono (no el contenido ni quién habla con quién). Las firmas Nostr no se verifican al recibir (mitigado: lo alterado no descifra, y `created_at` está acotado, `net_link.js:379`). | Se cierra encendiendo Tor. | `net_link.js:13,375` |
| **Control sin autenticar (M5/M6/F6)** | Forjar `kx`/`ni` re‑apunta el enrutado o re‑etiqueta un contacto sin nombre; `ss` hace reenviar lo propio (ya cifrado) y filtra el último nº de secuencia; `nexo_call offer` falso hace **sonar/encender la pantalla** y renueva el wakelock. | **Molestia, batería, inferencia de presencia** — nunca contenido ni audio real (eso exige E2E). | `ble_messages.js:202-242,326,561-576`; `BgInbox.kt:48-51` |
| **Recuperación Fénix suplantable (H4)** | La petición de recuperación llega **sin autenticar**; el `from`/nombre son del atacante. Cada custodio engañado filtra **un** fragmento. | Hace falta engañar a **6 de 10** custodios (barrera social fuerte). | `fenix.js:723-740,39` |
| **Sin defensa anti‑automatización (anti‑bot)** | No hay límite de tasa, ni prueba de trabajo, ni resistencia Sybil en **ninguna** parte: un adversario con scripts puede inundar solicitudes de contacto, spamear recuperaciones Fénix, o crear identidades/relés falsos a máquina. | Los topes nativos (arriba) evitan el crash, pero no el **volumen**. | (ausente en todo el código) |

### 1.3. Probabilidad honesta, por tipo de atacante

- **Espía en la red o radio cercano (oportunista):** robar contenido ≈ **muy baja**. Solo logra molestia (batería,
  presencia) por los paquetes de control sin autenticar. No lee mensajes.
- **Experto que logra estar «en el medio» justo al agregarte y el usuario NO compara el número de seguridad:**
  **baja‑media**, y **solo para ese contacto** (SEC‑2/H3). Es la vía de ataque experto más realista contra el cifrado.
  Si el usuario compara el número de seguridad una vez, se cae a casi cero.
- **Adversario con muchos recursos que apunta a TU teléfono (tipo Pegasus / 0‑day):** compromete el **aparato**, y
  ahí **ninguna** app lo protege (tampoco Signal): leen la pantalla, el teclado, todo. La probabilidad depende de si
  eres un objetivo de ese nivel; para un usuario común es **baja**, para un objetivo de alto valor es el riesgo real
  — y es del teléfono, no de NEXO.
- **Teléfono robado y bloqueado:** **baja** (reposo cifrado + bloqueo + sin backup).

**Conclusión de la parte 1:** en lo criptográfico, NEXO juega en la liga de las apps serias. Lo que falta cerrar para
decir «un experto no entra» no es el cifrado, son **tres cosas concretas**: (1) el **primer contacto** (H3/SEC‑2),
(2) el **rollback del ratchet** (P0‑1, el más peligroso aunque sea latente) y (3) la **ausencia de defensa
anti‑automatización** (clave para lo «anti‑IA» de abajo). Lo demás que entra, entra por el **teléfono**, no por NEXO.

---

## 2. NEXO pro‑IA y anti‑IA

### 2.1. La idea en una frase

La frontera no es «¿es una IA?» — es **«¿está en el dispositivo del usuario y con su permiso?»**. La IA **tuya**, en
**tu** teléfono, con tu consentimiento, puede manejar NEXO. Cualquier IA **de afuera** es, para NEXO, un atacante más,
y la frena el mismo cifrado que frena a un humano (no tiene tus claves) **más** la fricción anti‑automatización que hay
que agregar.

### 2.2. Pro‑IA — que la IA del usuario use NEXO fácil (hoy: no existe; es tu idea #127)

Rumbo propuesto, un **«contrato de acceso» local y consentido**:

1. **Solo en el teléfono, solo lo local.** La IA actúa COMO el usuario a través de una interfaz en el aparato (una API
   local / intents / accesibilidad), nunca por la red. Las claves de identidad **nunca** salen ni se le entregan en
   crudo (hoy ya viven cifradas en el Keystore; eso no cambia).
2. **Permiso explícito y por alcance.** El usuario concede capacidades concretas y revocables: leer tal chat, redactar,
   enviar, resumir, avisar. Nada «todo o nada».
3. **Todo queda registrado y es reversible.** Cada acción de la IA se anota (quién, qué, cuándo) y se puede revocar el
   acceso de golpe.
4. **Con límite de tasa propio.** Incluso la IA del usuario pasa por un límite (para que un error en bucle no mande mil
   mensajes).

Con eso NEXO es de los pocos mensajeros «manejables por tu asistente» sin abrir un agujero.

### 2.3. Anti‑IA — que ninguna IA ajena entre, hackee o dañe

Una «IA atacante» es un **experto rápido, a escala y automatizado**. Contra eso:

- **Lo que YA la frena** (sirve igual contra humano y contra IA): el E2E (no tiene claves → no lee ni falsifica
  contenido), los topes nativos anti‑crash (`SafeJson`, `MAX_PREAUTH`, `MAX_CHUNKS`…), y el descarte de lo que no
  descifra.
- **Lo que FALTA (es el corazón de «anti‑IA»):** hoy **no hay** límite de tasa, prueba de trabajo ni resistencia Sybil
  en ninguna parte (verificado: ausente en todo el código). Una IA puede **inundar** solicitudes de contacto, **spamear**
  recuperaciones Fénix, **forjar** barato los paquetes de control sin autenticar, o **crear identidades/relés falsos** a
  velocidad de máquina. Hay que agregar: límite de tasa por origen a las solicitudes entrantes, un **costo** (prueba de
  trabajo pequeña) en operaciones caras como «agregar por ID» y la recuperación, autenticar el control (M5/M6/F6/H4), y
  hacer la verificación del número de seguridad **más difícil de saltar** para que un MITM automatizado no funcione.

**La tensión honesta:** «fácil para la IA del usuario» y «imposible para la IA atacante» tiran para lados opuestos. Se
resuelve **solo** con la frontera dispositivo+consentimiento: adentro, fácil y con permiso; afuera, la misma puerta
cerrada para todos, con fricción que el atacante a escala no puede pagar barato.

---

## 3. Cómo me infiltraría yo en un teléfono con NEXO (red‑team, de más fácil a más difícil)

Ordenado por lo que de verdad funcionaría. La lección de fondo: **casi nadie entra por el cifrado; se entra por el
teléfono y por el usuario.**

1. **El teléfono y la persona, no la app (lo más fácil).** Te haría instalar un **APK falso de «actualización de
   NEXO»**: como NEXO se instala de fuera de la tienda (APK nightly), un «nuevo NEXO 2944, instálalo» es un señuelo
   creíble; ese APK sería mío y leería todo. Variantes: otra app con permisos en tu teléfono, acceso físico unos
   segundos con el teléfono desbloqueado, o un fallo 0‑day de Android/WebView. **Una vez que el teléfono es mío, toda
   app cae, NEXO incluido.** Defensa de NEXO: build de producción, sin backup, reposo cifrado, bloqueo, capturas
   bloqueables. **Hueco propio de NEXO:** el hábito de instalar APKs → hay que dar una forma de **verificar la firma**
   (el repo ya fija el SHA‑256 de la llave) y avisar fuerte contra APKs de terceros.
2. **«Hombre en el medio» al agregarte por ID (SEC‑2).** Me pongo en el camino cuando me agregas por NEXO ID y, si
   tenías una solicitud saliente pendiente, mi clave entra **sola y en silencio** (`ble_links.js:191-198`). A partir de
   ahí leo ese chat. **Lo detiene:** comparar el número de seguridad (hoy opcional) → hay que hacerlo prominente y que
   «agregar por ID» **no** agregue en silencio.
3. **Molestia a escala (F6 + SEC‑3).** Con un relé o a distancia de radio te **hago sonar el teléfono, enciendo la
   pantalla y te dreno la batería** con ofertas de llamada falsas sin autenticar (`BgInbox.kt:48-51`) — nunca conecto
   audio, pero es trivial de automatizar y molesta. **Lo detiene:** autenticar antes de sonar/despertar.
4. **Catástrofe por restauración (P0‑1).** No «ataco»: espero a que **pases la cuenta, recuperes con Fénix o restaures
   un backup** y el ratchet repita (clave, IV) → ahí el cifrado de ese tramo se vuelve frágil. **Lo detiene:** un
   contador anti‑rollback y una prueba que lo vigile (hoy no existe). **Es el más peligroso de la lista aunque sea
   latente.**
5. **Suplantar una recuperación Fénix (H4).** Forjo una petición de recuperación con tu nombre y engaño a tus
   custodios. **Barrera:** necesito **6 de 10** confirmaciones manuales — difícil, pero el solicitante es suplantable y
   no se avisa «este teléfono no tiene historial de claves contigo».
6. **Cadena de suministro (el de más impacto, por eso lo nombro para blindarlo, no para hacerlo).** Si alguien
   comprometiera el repositorio o el servidor de compilación (CI) y su llave de firma, podría publicar un **APK con
   puerta trasera para TODOS** los usuarios de golpe. Es el riesgo de mayor impacto de cualquier app. **Defensa:**
   proteger los secretos de CI y de firma, compilaciones reproducibles, y el SHA‑256 de la firma fijo y verificable.

(Secundario, nivel molestia: forjar `kx`/`ni`/`ss` para estorbar el enrutado o filtrar el nº de secuencia — M5/M6,
`ble_messages.js:202-242,326`. No roba contenido.)

---

## 4. Plan de blindaje priorizado (qué construir y en qué orden)

**P1 — cerrar lo que de verdad abre contenido:**
- **Primer contacto (H3/SEC‑2):** que «agregar por ID» **no** fije clave en silencio (pedir un toque), avisar «clave
  nueva sin verificar» y hacer el número de seguridad prominente. Toca el estado de claves → con cuidado y prueba en
  los dos teléfonos.
- **Rollback del ratchet (P0‑1):** contador monótono anti‑rollback para que nunca se repita (clave, IV) tras restaurar;
  con su prueba. **Es el más peligroso de todos.**

**P2 — autenticar y poner fricción (sirve doble: seguridad + anti‑IA):**
- Autenticar el control (M5/M6) y las ofertas de llamada/despertar (F6), y la recuperación Fénix (H4).
- **Capa anti‑automatización:** límite de tasa por origen y costo (prueba de trabajo pequeña) en solicitudes de
  contacto, recuperación y suscripción a relés; fricción Sybil en «agregar por ID». (El núcleo de «anti‑IA».)
- Verificar la firma Schnorr de los eventos Nostr (defensa en profundidad).
- Migrar los contactos que queden en E1 a proto‑2 / darle AAD a E1 (S‑1).

**P3 — endurecer bordes:**
- Guía y verificación de la **firma del APK** (contra el señuelo de «actualización falsa»).
- Acotar el FileProvider (F7), leer por flujo los 40 MB de Wi‑Fi Direct (F8), cifrar en reposo el mapa ID→MAC
  (ZIP #13), y ofrecer **Tor por defecto** para quien priorice ocultar la IP.
- Cadena de suministro: proteger CI/firma, compilaciones reproducibles.

**Transversal — pro‑IA:** diseñar el **contrato de acceso local** (#127) con la frontera dispositivo+consentimiento de
la parte 2.

---

## Apéndice — Veredicto por superficie (verificado 07‑11 contra build ~2944)

| # | Superficie | Veredicto | Evidencia |
|---|---|---|---|
| 1 | Intercambio de claves / identidad | **HUECO** (TOFU sin verificación obligatoria) | `ble_keys.js:64`, `ble_links.js:191-198`, `net_link.js:411` |
| 2 | Núcleo cripto (Double Ratchet + X3DH + AAD + ML‑KEM) | **SÓLIDO**; dos huecos: E1 **PARCIAL** (`e2e_crypto.js:138-143`), rollback **HUECO** (`e2e_ratchet.js:100-108`) | AAD sólido en `e2e_ratchet.js:378` |
| 3 | Paquetes de control sin autenticar | **HUECO, bajo impacto** (molestia/metadatos, no contenido) | `ble_messages.js:202-242,326,561-576`; `BgInbox.kt:48-51` |
| 4 | Parseo / memoria nativos (DoS) | **SÓLIDO** | `SafeJson.kt:9-30`, `LanHub.kt:49-52`, `LanBeacon.kt:38-40`, `ble_ack.js:669` |
| 5 | Ejecución de contenido recibido | **SÓLIDO** (XSS) / **PARCIAL** (FileProvider F7) | `render.js`, `index.html:14`; `file_paths.xml` |
| 6 | En reposo / dispositivo | **SÓLIDO** | `AtRestStore.kt:15-66`, `app_lock.js`, `AndroidManifest.xml` |
| 7 | Metadatos / red | **PARCIAL** (IP+hora a los relés sin Tor; firmas Nostr sin verificar) | `net_link.js:13,375`; sellado `e2e_crypto.js:159`; RID `RidToken.kt:13` |
| 8 | Recuperación Fénix (H4) | **HUECO**, atenuado por 6‑de‑10 confirmaciones manuales | `fenix.js:723-740,39` |
| 9 | Anti‑automatización / anti‑bot | **HUECO** (no existe en ninguna parte) | (ausente) |

**Nota de método:** este informe es defensivo y describe rutas + defensas, no exploits. Lo criptográfico de transporte
y el endurecimiento nativo son fuertes; lo que queda abierto es, por orden de importancia real: **P0‑1 (rollback),
H3/SEC‑2 (primer contacto), la ausencia de anti‑automatización, y luego M5/M6/F6/H4/E1/F7/F8**. Pendiente: que el
dueño decida qué entra como build (varios tocan el núcleo del protocolo y exigen prueba en los dos teléfonos).

---

## 5. Ejecución del blindaje — hecho y plan (07‑11, «no pares hasta terminar»)

### Ya hecho y subido (método: reproducido en el simulador + batería verde)
- **Build 2946 — anti‑automatización / anti‑IA (el hueco nº 9, el que no existía):** `_reqFlood` en `ble_links.js` frena
  una inundación de solicitudes de contacto (por origen y global). Prueba `antiflood.js`. Es la base de «anti‑IA»: una IA
  atacante es un atacante rápido y a escala; ahora el buzón de solicitudes tiene tope.
- **Build 2947 — anti‑abuso fase 2 + F7:** tope por ventana a las peticiones de recuperación Fénix (`_recWindowOk`: no se
  puede spamear al custodio; mitiga el nag y frena el goteo de fragmentos de H4), prueba `recflood.js`; y **F7** cerrado
  (el FileProvider ya solo expone `cacheDir/nexo_open`, no las raíces).

### Lo que falta, con el plan (necesitan tu visto bueno y/o prueba en los dos teléfonos: tocan el núcleo)

**P0‑1 — rollback del ratchet (lo más peligroso).** El IV de AES‑GCM se deriva determinista de la clave de mensaje
(`e2e_ratchet.js:100‑108`); si se RESTAURA un estado viejo (pasar la cuenta, Fénix, un backup, o seguir en el teléfono
viejo) se repite (clave, IV) sobre texto distinto → catástrofe. No es un ataque activo: lo dispara el uso normal. Plan:
(1) marca de agua local, en un archivo que NO se copia con la cuenta, con el nº de mensaje más alto por sesión; antes de
cifrar, si el nº actual ≤ la marca → rollback → se arranca sesión nueva (X3DH fresco) en vez de reusar. En el camino
normal nunca se dispara. (2) al pasar la cuenta / Fénix, forzar re‑clave de todas las sesiones de envío (cierra el clon).
No lo subí ya porque el caso clon no se reproduce limpio en el simulador sin meterle un gancho de recarga al cifrado;
propongo agregar ese gancho de prueba acotado, implementar la marca de agua, y que lo pruebes en los dos teléfonos.
**Dime si le doy.**

**SEC‑2 / H3 — primer contacto (MITM).** Que «agregar por ID» no fije la clave en silencio (un toque de confirmación) y
hacer el número de seguridad prominente. Es un intercambio seguridad/comodidad: ¿aceptas un toque extra al agregar por ID
a cambio de cerrar el MITM silencioso? Si sí, lo hago con prueba (`reqadd.js`) y lo validas en los teléfonos.

**M5/M6/F6 — control sin autenticar (molestia).** Ignorar `ss`/`sr`/`nm` de un desconocido y no sonar por una oferta de
llamada sin autenticar. Bajo impacto, testeable; con cuidado de no romper la reconexión/llamadas legítimas.

**Otros (menor urgencia):** verificar la firma de los eventos de internet (defensa en profundidad), migrar los contactos
que queden en el cifrado viejo E1 (S‑1), leer por flujo los 40 MB de Wi‑Fi Direct (F8), cifrar en reposo el mapa
ID→dirección.
