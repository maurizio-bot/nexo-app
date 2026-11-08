# NEXO — Diagnóstico: lentitud en Bluetooth (dueño, 07-11-2026)

Fuente: diagnóstico del teléfono del dueño `NX1N36C283` (Samsung SM-S928B = S24 Ultra, Android 16),
copiado 2026-11-07T21:41. Síntoma reportado: **con los dos teléfonos conectados por Bluetooth a <3 m, los
mensajes NO son instantáneos.**

## Hallazgo principal (grounded en el registro)

**El envío NO es el problema.** El mensaje se cifra y sale en milisegundos. Lo que tarda es que vuelva la
confirmación (ACK), porque la **radio Bluetooth está saturada** por trabajo de fondo.

Prueba, del propio registro:
- Radio libre: `[SEND] Texto entregado en 261 ms (cifrar 137 ms, salir por Bluetooth 1 ms, reintentos 0)`.
- Radio saturada: `Texto entregado en 4391 ms (… reintentos 2)`, luego `11014 ms (… reintentos 5)` y
  `11088 ms (… reintentos 5)`, siempre con `salir por Bluetooth 1–4 ms`. → sale al instante; lo que cuesta
  son los reintentos esperando el ACK.

## Qué satura la radio (3 causas, con evidencia)

1. **El respaldo Fénix martilla el BLE, y un enlace está ATASCADO.**
   - `sendFile … type=fenix bytes(b64)=114809 to=65916ff3aabc` (≈84 KB) repetido muchas veces, con copias
     del MISMO segmento (`fxs_dmvu3q8led44904_8e98/_98c6/_665a/_7f4b`), cada una terminando en
     `Max window retries alcanzado` → `sendFile FAIL … Abortado` y arrancando la siguiente. Minutos de radio
     por un solo segmento.
   - El contacto `65916ff3aabc` está atascado: `Cola llena para 65916ff3aabc: el mensaje espera` (decenas de
     veces) y `Write fallo para 65916ff3aabc durante ~6 s (enlace congestionado/atascado): mensaje descartado
     entero (17 trozos)` (3+ veces). Es un enlace muerto/atascado que Fénix NO deja de reintentar por BT.
   - `Cola de escritura llena para 65916ff3aabc (1)` en bucle (`ChatStream Envio nativo fallo chunk 1/2/3`).

2. **Backlog grande de pendientes + vaivén primer plano/segundo plano.**
   - `Resume: 6 outgoing para nx09acdb61`, `3 outgoing para nx1793e595`, etc. (muchos contactos con cola).
   - `Flush global pending`: 11 contactos con 1–3 pendientes cada uno.
   - La app entra y sale de segundo plano repetidamente (`handleOnPause`/`handleOnResume`,
     `App de vuelta en primer plano`), y cada vuelta dispara `Re-búsqueda de contactos [11 ids]` + re-encola
     todo (`Resume: …`). Mucho escaneo/encolado compitiendo por la radio.

3. **Varias conexiones a la vez, incluso al MISMO NEXO.**
   - 4 enlaces activos (`Supervisor: … 7C:10:15:4B:37:52, 44:CB:74:FB:2D:D6, 63:31:45:F0:73:71,
     6E:D5:AB:4C:66:A1`).
   - Los 4 resuelven al MISMO contacto `nx1e50c95d` (`Conexión existente recuperada al arrancar: <MAC>
     nx1e50c95d` ×4; `Peer ready dup ignorado: nx1e50c95d` en bucle) — por el ID Bluetooth rotativo se
     mantienen conexiones paralelas a una sola persona.

## Parte que NO es de nuestro lado (honestidad)

El contacto `nx1e50c95d` estaba `en línea por internet (datos móviles)` y a ratos con la app en segundo
plano, así que su teléfono también tarda en responder el ACK. Pero la causa DOMINANTE y arreglable es la
congestión por Fénix + el enlace atascado.

## Plan de arreglo (método: reproducir en tests/sim, corregir, batería verde, subir)

1. **Fénix cede la radio al chat interactivo.** Si hay textos esperando o ACKs pendientes, el respaldo Fénix
   pausa o va mucho más lento. (Amplía 2905/2947/scanfenix, que ya hacen que Fénix ceda el ESCANEO; falta que
   ceda los ENVÍOS de segmentos frente al chat.)
2. **Enlace atascado = soltar rápido y re-rutear.** Un contacto cuya cola de escritura está llena de forma
   repetida (`onWriteDropped`) se marca congestionado y sus segmentos Fénix van por internet o se aplazan, en
   vez de reintentar por BT durante minutos. (Enlaza con «internet antes que un BT muerto».)
3. **Dedup de conexiones al mismo NEXO.** No mantener 4 enlaces GATT a una sola persona (juntar las
   direcciones rotativas).

## Relación con pendientes existentes
- #129 (Bluetooth MTU 23: «Cola de escritura llena», pacing).
- 2905 (Fénix cede la radio a la actividad del usuario), 2947 (anti-abuso Fénix), scanfenix (Fénix no pausa
  el escaneo). Este diagnóstico pide el paso que falta: Fénix cede también los ENVÍOS, y el enlace atascado se
  suelta.

## Avance (builds 2951–2956)
- **2951** — plan punto 1 (al ELEGIR): `_fenixSkipHolder` salta a un custodio por cooldown tras un fallo o si
  su único camino es un Bluetooth muerto. **2952** — regla del dueño «el usuario primero»: con la app en
  primer plano los envíos pesados de respaldo esperan. **2954** — al REANUDAR: `resumeOutgoingTransfers`
  (`_resumeRunOne`) aplaza un respaldo Fénix si el usuario tiene la radio o el enlace está atascado.
- **2956 — plan punto 2 cerrado para un stream YA en marcha (diags. 08-11 00:47 y 01:07).** Faltaba este
  hueco: 2951/2952/2954 frenan al elegir/reanudar, pero un respaldo Fénix **ya corriendo** a un enlace
  atascado seguía martillando la cola nativa («Cola de escritura llena») hasta ~5 min por segmento
  (`BUSY_MAX_WAITS=150`), tapando la radio → un audio por internet tardaba ~1 min y la UI parecía clavada.
  Arreglo (solo JS, `ble_ack.js`): `_fenixYieldBle` (pura) + `_bgShouldYieldBle` consultados en el bucle de
  trozos (`_sendWindow`/`_retransmitWindow`) → un respaldo de FONDO (`meta.type==='fenix'`) por Bluetooth ya
  marcado atascado (`_bleCongested`) se rinde al toque (`_giveUpPending`, queda pendiente; la redundancia de
  Fénix y el resume lo cubren). Lo del usuario mantiene la paciencia de #129. Prueba `fenixyield.js`.
- **Pendiente (el otro síntoma del diagnóstico, más de fondo):** los **archivos grandes por internet** se
  parten en **miles** de trozos con confirmación uno por uno; por Tor eso es muy lento y los de 26–34 MB
  agotan reintentos y muestran «reintentar». Arreglarlo bien probablemente pide un cambio mayor (mandar el
  archivo cifrado **entero** a un relé/buzón y que el otro lo baje, en vez de trozo a trozo con ACK por
  ventana). Queda para una ronda aparte, con cuidado.
- **Plan punto 3 (dedup de conexiones al mismo NEXO por el ID rotativo):** sigue pendiente, delicado, después
  de la prueba física del dueño.
