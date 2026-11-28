# 📌 ESTADO ACTUAL DE NEXO — LEER ESTO PRIMERO

> **Este archivo es el punto de encuentro entre el Claude de la compu (Claude Code) y el Claude del teléfono.**
> Quien entre —sea quien sea— lo PRIMERO que hace es leer este archivo para saber en qué punto está el proyecto.
> Vive en GitHub (rama `NEXOCHAT`), así que los dos lo pueden leer desde donde estén.

## ⭐ Regla del dueño (prioridad SIEMPRE)
**Funcional y robustez primero.** El error que aparece se resuelve **en el momento**, no se dejan cabos sueltos.
No preguntar «¿qué priorizo?» cuando hay un error o algo roto: se corrige. (Monetización/entretenimiento van después de que lo funcional esté firme.)

## 🔄 Cómo usar este archivo (la regla)
- **Claude de la compu (yo, Claude Code):** actualizo este archivo al terminar cada bloque de trabajo y lo subo a GitHub. Es lo primero que leo al empezar.
- **Claude del teléfono:** leé este archivo primero (pedí «traé la última versión de `ESTADO.md` de GitHub»). Si hacés algo nuevo:
  1. Anotalo en el apartado **«⚠️ Trabajo del teléfono sin subir»** de abajo.
  2. **Si podés escribir en GitHub:** commiteá tu trabajo a una rama (p. ej. `monetizacion-telefono`) y anotá acá el nombre de la rama. Así el de la compu lo trae.
  3. **Si solo podés leer GitHub:** avisale al dueño que el trabajo quedó en el teléfono, para que lo pegue en la compu. (Si no se sube a GitHub, el otro Claude NO lo puede ver.)
- **Dueño (Maurizio):** si trabajaste en el teléfono y quedó algo sin subir, decímelo en la compu y lo integro.

---

## Dónde estamos (actualizado: 2026-11-26 noche, México)

### TRASPASO (empezar una sesión limpia desde aquí; MÁXIMO ~60 líneas: lo viejo pasa a `docs/historial/`)
- **28-11 20:00 México (Opus) — SOLICITUDES ARRIBA DE LA LISTA (pedido del dueño), en NEXOCHAT con [skip ci]: va en la PRÓXIMA APK.**
  `src/ui/req_cards.js`: la solicitud (y la invitación a grupo) sale arriba de los chats con Aceptar / Eliminar ahí mismo; brilla 3 veces
  (~2,7 s) al llegar y al volver a la app, luego fija con borde (el dueño aceptó: nada de parpadeo continuo); > 3 → «Ver todas (N)»;
  aceptar abre el chat con «Saluda a {nombre} 👋» en la caja («te escribió»: sin saludo; grupo: abre el grupo). Prueba `reqcards.js` en ci.js
  (contraprueba 3172 falla todo). NOVEDADES: bloque 3172 pasado al historial y bloque nuevo con esto.
- **28-11 noche (Opus) — FASE 1, TERCER BLOQUE HECHO y subido a NEXOCHAT en UNA APK (con los 3 arreglos de la 3172).**
  (1a) Módulos puros `src/core/ruta/`: `motivos.js` (listas cerradas A.6/B.2.4/B.4.1 y la respuesta de un relé → ErrorCamino),
  `contacto_ruta.js` (lugar con los 120 s CERCA→LEJOS, despierto APP/NATIVO/DORMIDO, toques degradados, permanencia 60 s y freno de
  oscilación), `calendario.js` (estados B.4.1, esperas con azar completo, ≤ 3 intentos/carril/h y modo lento, OCUPADO sin castigo,
  PAUSADO(SIN_CAMINO) con 0 intentos, toques 0/2/10/30/120 min, republicar solo por RELE_PERDIO/LISTA_NUEVA/CADUCA, plazo de archivo POR
  AVANCE (60 s sin byte nuevo) y `desde`, juntar, cupo ≤ 6 sobres/min por contacto, testigo app/nativo y diario que se une) y
  `reles_puntos.js`. Banco `tests/sim/mundo/` (escenarios 5–10, 20, 21, 26, 29–33, 35 VERDES; contraprueba: sin juntar fallan 9 y 10)
  y vectores `tests/vectores/calendario.json` = `RutaCalendario.kt` (`calvectores.js` y `RutaCalendarioTest.kt`, 9/9 aquí).
  **Ojo:** el calendario y el estado por contacto NO mandan todavía en la app (contrato D.3: primero la sombra en teléfonos reales).
  (1b) EN LA APP: **puntuación de relés** (aceptación, tiempo hasta el OK, castigos 24 h; ordena los destinos; línea «[NET] Puntos de los
  relés» cada 10 min); **cupo a la mitad 1 h tras un límite** (30/min 5 min → 300/min 1 h → vuelve en otra hora; `cupoPorMin`);
  **toques degradados** (el nativo anota si Android bajó el toque a normal, la app lo anuncia `td` en el saludo y quien envía solo
  toca para llamadas y el primer pendiente hasta que él dé señales o 30 min). Del dueño: el retraso del diagnóstico emparejado ya no son
  15 s fijos: espera a que `diag.js` tenga leídos la sesión anterior y el registro nativo (mín. 3 s, tope 15 s). Contrato §B.4.2 corregido.
  **NO HECHO (dicho claro):** juntar textos en UN sobre en el cable (cambia el formato y el nativo debe entenderlo para los avisos con la
  app cerrada: va en su propia APK, con el límite semanal fresco; la lógica ya está en `calendario.juntar`/`RutaCalendario.juntar`);
  «llegó» de la puntuación (falta unir ✓✓ con el relé donde se publicó); quitar el PARCHE del zombi falso (fase 2 Bluetooth); «el
  calendario manda» por internet (después de ver `[RUTA-SOMBRA]` en diagnósticos reales). Qué mirar en los diagnósticos: `[RUTA-SOMBRA]
  resumen` (≥ 95 %), `[NET] Puntos de los relés`, `[WAKE] … DEGRADADOS`, «Cupo de los relés … uno cada» tras un límite.
- **27-11 17:55 México (Opus): CI 3171 FALLÓ (bigresume, netsilence, netsmall: archivo por internet a quien estaba callado/dormido no
  llegaba nunca). Causa: «republicar el MISMO evento»: el relé no reenvía en vivo un evento que ya tenía. Arreglo: el mismo evento solo
  si NINGÚN relé lo guardó la vez anterior (`republicar.js` `guardado`, `net_link.send`). Subido con los 2 arreglos de abajo = APK siguiente.
- **27-11 17:10 México (Opus): 2 arreglos de diagnósticos de la 3170, en NEXOCHAT con [skip ci] (van en la PRÓXIMA APK, no en la 3171):**
  (a) zombi falso del S23 con el HONOR: el Dedup cerraba el enlace repetido y el ping que iba por él contaba como «medio muerto»
  (`ble_connections.js`; prueba `pingdedup.js`, contraprueba en 6fcb8ad). (b) diagnóstico «par:» pedido con la app recién abierta salía
  sin registro nativo ni sesión anterior: ahora espera 15 s (`autodiag.js` BOOT_WAIT_MS; `diagplus.js` D4b). NOVEDADES no hace falta (interno).
- **27-11 noche (Opus): ENCARGO DEL 27-11 tarde HECHO Y SUBIDO a NEXOCHAT (APK siguiente a la 3170; revisar su CI en una sesión nueva).**
  1. Cabecera «propuesta B»: foto = visor (`chat_info.js` `openPhotoView`; grupo con «Cambiar/Quitar foto» si puede editar); nombre › =
     «Información» (`openChatInfo`: 1-a-1 con nombre editable, NEXO ID y opciones del chat; grupo = `openGroupSettings(gid,{title,extra})`
     con las opciones del chat arriba). Sin rueda (`refreshGroupGear` solo la quita). El bloque del nombre (`#chat-contact-info`) es el
     botón; el `<textarea>` queda de solo lectura. «Cambiar nombre» del ⋮ abre «Información» con el campo listo. Prueba `cabecerachat.js`.
  2. Tarjetas en la lista (`nexo_theme.css`: fondo 4 %, aro 1 px, radio 14, 6 px): a 360 px caben 8 filas (antes 9). Prueba `tarjetaslista.js`.
  3. Tarjeta de un miembro (`member_card.js`): desde su nombre en un mensaje del grupo o en la lista de personas; contacto → Mensaje /
     Llamar / Info; no contacto → Agregar. Pruebas en `gruposadmin.js` y `cabecerachat.js` (M1).
  4. Fase 1 internet, 2.º bloque: **HECHO** modo sombra (`src/core/ruta/elegir.js`, anotado en `ble_send._rutaSombra`: líneas
     «[RUTA-SOMBRA] … elegiría X / se hizo Y» y un resumen con % cada 20) y **republicar el MISMO evento** al reintentar por internet
     (`src/core/ruta/republicar.js` en `net_link.send`; «duplicate» del relé = guardado). Prueba `rutasombra.js`.
     **NO HECHO (decisión técnica, se le explicó al dueño):** juntar textos en un sobre (cambia el formato en el cable) y quitar la red
     de seguridad +10 s y las ventanas ×8 por internet: según el propio contrato (D.2/B.4.5) se quitan cuando el CALENDARIO manda; hoy
     son lo que despierta a un teléfono dormido. Siguen para el bloque del calendario (después de ver la sombra en diagnósticos reales).
  Qué mirar en los diagnósticos de esta APK: líneas `[RUTA-SOMBRA] resumen` (meta ≥ 95 % iguales) y `[NET] reintento … republico el mismo evento`.
- **APK 3170 PASÓ (27-11 13:34 México)** con todo lo de abajo (fase 1 relés + ráfagas + fotos con ajuste + eliminar para todos en grupos + lo de Austin).
- **28-11 (Opus) — FASE 1 INTERNET, PRIMER BLOQUE HECHO (relés):** política de relés ÚNICA app/nativo
  (`src/core/ruta/politica_reles.js` = `RelayPolicy.kt`, mismos vectores `tests/vectores/politica_reles.json`; `politicareles.js` y
  `RelayPolicyTest.kt`). (a) **anuncio cifrado de dónde leo** en el saludo (`lr`, app y nativo; se guarda en `state.peerLee`, caduca 24 h, solo
  relés de mi pool); (b) **a un contacto se le publica solo en los relés que él lee** (también una reserva que yo solo escucho) y el ✓ sale
  solo de ellos; con los suyos en pausa/cerrados queda ⏳ sin mandar («en espera», `_resendWaitErr`); sin anuncio, como antes (`leeen.js`,
  caso 21:53); (c) **el nativo escucha TODOS** (se quitó `CELL_READ_RELAYS = 2`, ahora 99 como la app) y también los de reserva que la app solo
  escucha (`lo`); (d) **el nativo respeta el «OK false»** (pausa por relé como la app) y **las pausas se comparten** en los dos sentidos
  (`cool` en netBgConfig y en netBgDrain); (e) el nativo publica con la misma política (`targetsFor`; `NetBgRelesTest.kt`). NOVEDADES escrito.
  **Y del dueño 28-11 (misma sesión):** fotos de perfil y de grupo con AJUSTE (mover, acercar, alejar hasta verla entera; fuera, la
  foto desenfocada; 384 px, ≤ 60 000 car.: `avatar_crop.js`, `fotoajuste.js`); **eliminar para todos en grupos** (acción con `g` a cada
  miembro, solo vale si lo escribió él, también si llega antes que el mensaje: `editar.js` E11). Fotos del chat sin tocar (1280–1600 px, sin recorte).
  **Diags 27-11 09:45–09:47 (3167):** los «no» de una RÁFAGA de sobres contaban uno por uno («banned 37.ª vez → 7200 s», primal «210.ª
  vez»): ahora cuentan como uno (`LIMIT_BURST_MS` 5 s, en JS y Kotlin; también destapaba el fallo intermitente de `acuses.js` G).
  **Austin (nx1905c1ee), diag 09:46:** había perdido a sus contactos (solo 1): confirma sin firma al S24 y sus fotos al grupo quedan sin clave
  para 4 miembros. HECHO (dueño 28-11 «agrega lo de Austin»): `ack_lostme.js` pide el kx (≤1/10 min) y avisa al usuario 1 vez/día; `lostme.js`.
  **Falta de la fase 1** (contrato §D.3 1a/1b): módulos `contacto_ruta/elegir/calendario` + banco `tests/sim/mundo/` + modo sombra
  `[RUTA-SOMBRA]`; republicar el MISMO evento (no re-cifrar); juntar textos en un sobre; el calendario manda en lo de internet (quitar
  red de seguridad +10 s y ventanas ×8 por internet); puntuación de relés; cupo que baja a la mitad 1 h tras un límite; toques FCM degradados.
- **PREGUNTAS DEL DUEÑO SIN RESPONDER (página de privacidad de Nexbeat, de la sesión cerrada del 26-11):** (1) correo público de contacto
  (uno solo para la app); (2) crear repo público `nexbeat` en GitHub (luego Settings → Pages → `main`/raíz) y avisar para subir la página;
  (3) ¿pasar `docs/diagnosticos.json` (con NEXO ID) al repo privado? Recomendado: sí (la política dice que se guardan en privado).
- **DECISIÓN DEL DUEÑO 28-11 ~07:00 México — CONEXIONES SÓLIDAS, UNA A LA VEZ** (tras `docs/AUDITORIA_CONEXIONES_28-11.md`: las 4 áreas
  «parchado/frágil»). Orden aprobado: (0) contrato común de los caminos + diseño del cambio entre caminos EN PAPEL
  (`docs/CONTRATO_CAMINOS_28-11.md`, en curso) → (1) internet → (2) Bluetooth (`docs/PLAN_BLUETOOTH_28-11.md`, en curso) → (3) Wi-Fi
  Direct → (4) Wi-Fi local → (5) programar el cambio entre caminos. Cada fase: plan escrito que revisa el dueño, batería de escenarios
  en tests/sim, APK que funciona, medidas en teléfonos reales; lo viejo que sobra se quita al terminar la fase. Conservar lo que sirve.
  El dueño exige opinión honesta y objetiva (decirle cuando se equivoca, con razones), no darle la razón.
- **28-11 ~01:20 México (Opus): SUBIDA UNA APK CON TODO lo pedido («sube todo» menos lo de Fable): arreglos 1–6 + guía de bienvenida al día
  (10 diapositivas, 5 idiomas) + revisión visual severa a 360 px (archivos con nombre largo, contraste de hora/✓, toques ≥ 44 px, ⋮ que no se
  cerraba) + del plan §6: quién ve mis estados (`estadopriv.js`), mensajes temporales (`chat_disappear.js`, `chatdisappear.js`), encuestas
  (`poll.js`, `polltest.js`) + plan §0 parcial: deslizar abajo en el chat ACTUALIZA, ya no cierra (`chatpull.js`). CI 3164 FALLÓ (8 pruebas: cupo demasiado bajo para archivos grandes, i18n > 1000 líneas, escucha de reservas con relé propio, 3 pruebas a actualizar); arreglado y resubido: 3165 PASÓ. 3166 = + arreglo 1 también para lo que este teléfono guarda para otro y sale por internet (caso exacto del diag. 23:33). **APK 3167 PASÓ (28-11 06:54 México; la 3166 se canceló) — es la buena: arreglos 1–6 + puente por internet + cupo solo de lo pesado + guía + revisión visual + estados privados + temporales + encuestas.** Planes: `docs/AUDITORIA_CONEXIONES_28-11.md`, `docs/CONTRATO_CAMINOS_28-11.md`, `docs/PLAN_BLUETOOTH_28-11.md` **Respuestas del dueño YA DADAS (en el §E del contrato).** SIGUIENTE SESIÓN (nueva, contexto limpio): **FASE 1 — INTERNET**: leer `docs/CONTRATO_CAMINOS_28-11.md` §A, §B.4–B.5, §C y §D.3 (fase 1); empezar por el modo sombra (el enrutador calcula y anota «[RUTA]» sin mandar), la política de relés única que el nativo recibe ya calculada (NetBg.kt: hoy 2 relés con datos, sin reservas, ignora OK:false/castigos), anunciar dónde leo (cifrado), ✓ solo si lo guardó un relé que el otro lee, el banco `tests/sim/mundo/` con los escenarios de internet. Archivos grandes lejos: WebRTC directo (Tor solo respaldo).**
  **Decisiones visuales para el dueño (no tocadas):** ✓✓ celeste poco contraste; nombre de grupo largo con 3 botones se corta; casillas a la
  izquierda vs. derecha en Seguridad (¿interruptores?); hora 12 h vs 24 h; Estados con fondo negro puro y sin título; píldora de llamada en 2
  líneas; insignia «1» del + blanca sobre naranja. **Queda del plan (para el límite fresco):** §0 sincronía completa, §1–5, §6 notas de vídeo,
  ubicación en vivo y quitar X/atrás restantes, §7 traducción; juntar textos en un sobre y avance nativo de Wi-Fi Direct/L2 (con el enrutado).
- Lo anterior (arreglos 1–6 del 28-11 madrugada y más viejo): `docs/historial/ESTADO_traspaso_hasta_2026-11-28.md`.

## ✅ Trabajo del teléfono — YA INTEGRADO
> Acá se anota lo que se hizo en el teléfono y se trajo al repo.

- **[✅ 04-11] Monetización + entretenimiento** — el dueño avanzó el plan en el teléfono; se integró a `nexo-private/negocio/MONETIZACION_Y_ENTRETENIMIENTO.md`. Tiene las fuentes de ingreso (Fundador 199 MXN, Negocios, etc.), el modo entretenimiento para el **15-nov** (sala de juegos: Conecta 4 + piedra-papel-tijera) y una **checklist de decisiones del dueño**.

---

## Documentos de referencia (el detalle largo)
- `docs/PROGRESO.md` — historial completo de builds.
- `docs/PENDIENTES.md` — todo lo que falta + reglas del dueño.
- `docs/ROBUSTEZ.md` — índice de robustez, mediciones y rutina diaria.
- `nexo-private/seguridad/AUDITORIA_FINAL_2026-11-23.md` — última auditoría completa (anterior: `AUDITORIA_COMPLETA_03-11.md`).
- `CLAUDE.md` — instrucciones del proyecto.
