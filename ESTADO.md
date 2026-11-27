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
- **DECISIÓN DEL DUEÑO 28-11 ~07:00 México — CONEXIONES SÓLIDAS, UNA A LA VEZ** (tras `docs/AUDITORIA_CONEXIONES_28-11.md`: las 4 áreas
  «parchado/frágil»). Orden aprobado: (0) contrato común de los caminos + diseño del cambio entre caminos EN PAPEL
  (`docs/CONTRATO_CAMINOS_28-11.md`, en curso) → (1) internet → (2) Bluetooth (`docs/PLAN_BLUETOOTH_28-11.md`, en curso) → (3) Wi-Fi
  Direct → (4) Wi-Fi local → (5) programar el cambio entre caminos. Cada fase: plan escrito que revisa el dueño, batería de escenarios
  en tests/sim, APK que funciona, medidas en teléfonos reales; lo viejo que sobra se quita al terminar la fase. Conservar lo que sirve.
  El dueño exige opinión honesta y objetiva (decirle cuando se equivoca, con razones), no darle la razón.
- **28-11 ~01:20 México (Opus): SUBIDA UNA APK CON TODO lo pedido («sube todo» menos lo de Fable): arreglos 1–6 + guía de bienvenida al día
  (10 diapositivas, 5 idiomas) + revisión visual severa a 360 px (archivos con nombre largo, contraste de hora/✓, toques ≥ 44 px, ⋮ que no se
  cerraba) + del plan §6: quién ve mis estados (`estadopriv.js`), mensajes temporales (`chat_disappear.js`, `chatdisappear.js`), encuestas
  (`poll.js`, `polltest.js`) + plan §0 parcial: deslizar abajo en el chat ACTUALIZA, ya no cierra (`chatpull.js`). CI 3164 FALLÓ (8 pruebas: cupo demasiado bajo para archivos grandes, i18n > 1000 líneas, escucha de reservas con relé propio, 3 pruebas a actualizar); arreglado y resubido: 3165 PASÓ. 3166 = + arreglo 1 también para lo que este teléfono guarda para otro y sale por internet (caso exacto del diag. 23:33). **APK 3167 PASÓ (28-11 06:54 México; la 3166 se canceló) — es la buena: arreglos 1–6 + puente por internet + cupo solo de lo pesado + guía + revisión visual + estados privados + temporales + encuestas.** Planes: `docs/AUDITORIA_CONEXIONES_28-11.md`, `docs/CONTRATO_CAMINOS_28-11.md`, `docs/PLAN_BLUETOOTH_28-11.md` (falta: respuestas del dueño a E1–E8 y 9–12; luego fase 1 internet en modo sombra).**
  **Decisiones visuales para el dueño (no tocadas):** ✓✓ celeste poco contraste; nombre de grupo largo con 3 botones se corta; casillas a la
  izquierda vs. derecha en Seguridad (¿interruptores?); hora 12 h vs 24 h; Estados con fondo negro puro y sin título; píldora de llamada en 2
  líneas; insignia «1» del + blanca sobre naranja. **Queda del plan (para el límite fresco):** §0 sincronía completa, §1–5, §6 notas de vídeo,
  ubicación en vivo y quitar X/atrás restantes, §7 traducción; juntar textos en un sobre y avance nativo de Wi-Fi Direct/L2 (con el enrutado).
- **28-11 madrugada (Opus): ARREGLOS 1–6 HECHOS y probados.** Cada uno con prueba:
  1 reenvíos: un trozo de texto que un relé guardó no se republica en 30 min; un calendario (toque, 15→120 s), ⏳ a 10 min (`chat_stream`
  `_netWindowStored`; `reenvionet.js`). 2 puente: 1 envío por internet / 1 reintento por BT y luego su calendario (`ble_relay`, `ble_ack`
  opts; `puentereint.js`). 3 Fénix en vuelo cede al volver la app (`_bgShouldYieldNet`; `fenixfg.js`). 4 cupo: 600 sobres pesados/min (CI 3164: con 90 los archivos grandes por internet se iban a Bluetooth)
  (30 tras un límite), textos sin espera (`net_publish._quotaWait`; `cuporele.js`). **NO hecho del 4: juntar textos pendientes en un
  sobre** (con el 1 ya no se republican; queda para el enrutado del domingo). 5 con datos se escuchan todos (CELL_READ_RELAYS 99) y la app
  escucha los de reserva solo para leer (`r.lo`; `relevo.js` R4 = caso S23 21:53; `datosmoviles.js` adaptado). 6 sin tope de 2 h si
  avanza; Wi-Fi Direct/L2 respaldo a 2 KB/s (corta el nativo por inactividad); buzón: reintenta el trozo mientras avance y sigue desde
  donde iba (`blobreanuda.js`). **Pendiente del 6:** avance nativo de Wi-Fi Direct/L2 hacia JS (hoy no hay evento; corte por inactividad).
  Siguiente: revisión visual severa con capturas a 360 px; domingo 29-11 2:00 (Fable): enrutado por contacto y zombi de la tablet.
- **27-11 noche (Opus), [skip ci], va en la SIGUIENTE APK:** **responder con un adjunto** (dueño: «deslizo para responder, mando audio y se
  va solo; queda la barra con un mensaje vacío»): nota de voz, foto, archivo (también grande) llevan la cita (`meta.rp`, sellada en `xs`
  por el camino cifrado; `_takeReplyFor` quita la barra; un reenvío no la lleva). `chatactions.js` 1b (voz_*). NOVEDADES: añadir
  «Puedes responder a un mensaje con una nota de voz, foto o archivo» al publicar la 3161.
  **PENDIENTE APROBACIÓN DEL DUEÑO — «no cortar un envío mientras avance»** (le expliqué y propuse): hoy cortan aunque avance:
  (1) `chat_stream` tope duro 2 h desde el inicio (armGlobal + `NET_FILE_AUTORETRY_BUDGET_MS`); (2) `wifi_direct.js` ~405 plazo fijo
  50 s + tamaño a ~100 KB/s; (3) `l2_fast.js` 125/178 plazo fijo a ~20 KB/s (ambos lados); (4) `blob_mailbox.putBlob`: un trozo que
  ningún relé guarda tira TODA la subida y el reintento empieza de cero (sin reanudar). Propuesta: medir velocidad cada ~10 s, cortar solo
  tras ~1 min SIN avance, quedar ⏳ y seguir desde donde iba; tarjeta con velocidad y lo que falta. Lo nativo (soTimeout 30–60 s por
  lectura) y el wakelock de 20 min (se renueva por bloque) ya son por inactividad: bien.
- **APK 3162 CANCELADA por el dueño (27-11 ~00:05 México):** solo traía responder con adjunto + fondo de grupo; él quiere que la siguiente APK
  lleve TAMBIÉN los arreglos (punto 7: reenvíos, Fénix, relés, enrutado; y «no cortar envíos»). NO subir hasta tenerlos hechos y probados.
  Lección: al subir, decir con claridad qué arreglos NO van todavía.
- **DECISIÓN DEL DUEÑO 28-11 ~00:10 México — SIGUIENTE SESIÓN (Opus), hacer y SUBIR YA (sin esperar al domingo), cada uno con su prueba:**
  1 reenvíos controlados (lo guardado por un relé no se republica ×8; un solo calendario por mensaje); 2 puente Jump sin 5 reintentos
  seguidos; 3 Fénix parado con la app a la vista (arranca al salir); 4 cupo por relé + juntar textos pendientes + repartir lo pesado;
  5 quitar CELL_READ_RELAYS=2 y avisar dónde escucha cada uno (publicar donde el otro lee); 6 no cortar envíos que avanzan (corte tras
  ~1 min sin avance y seguir desde donde iba). Casos de prueba: diag 21:53 y 23:33. Diseño: `docs/ENRUTADO_27-11.md`.
  **Para Fable el domingo 29-11 a las 2:00 México:** el enrutado por contacto (qué camino y cuándo cambiar) y el zombi de la tablet (nativo).
  El dueño pidió además una **revisión severa como usuario/analista visual y de ergonomía**: hacerla con capturas a 360 px (Playwright).
- (27-11 ~22:00, LEVANTADO a las 23:50) el dueño pidió no subir nada hasta que lo dijera.
  **Lista de la siguiente APK (problema → solución):**
  1. [hecho, en NEXOCHAT con skip ci] Responder con audio/foto/archivo (arriba).
  2. [propuesto] No cortar un envío mientras avance (arriba).
  3. **Audios al S23 en ✓ sin ✓✓ (diag. S24 21:53–21:56, 3160):** relés del S24 limitando → entran los de RESERVA (`net_relays._spareCheck`)
     y se publica solo en los abiertos sin pausa (`net_publish` 172/226); el S23 con la app a la vista solo lee sus 4 de siempre (el nativo
     en segundo plano lee 9) → lo que va solo por reserva da ✓ y no llega. Solución: la app escucha su buzón también en los de reserva (solo
     lectura, como el nativo) y/o ✓ solo si lo guardó un relé que el otro lee. Confirmar con el diagnóstico del S23 (pedido al dueño).
  4. **Lo que gasta el cupo de los relés:** (a) textos pendientes a un contacto cuya app no confirma (2 a Austin desde 20:14) se reenvían
     por ventana ×8 en cada vuelta a la app → por internet el relé ya los guarda: publicar una vez y esperar, no republicar;
     (b) 6 paquetes de puente (sxmwy5…) ×5 reintentos cada 600 s; (c) Fénix sube ~3 MB de audios justo al volver a la app (que espere a
     que el usuario no esté mandando nada / cupo libre). Primero reproducir en `tests/sim` (relelimita.js de base).
  6. [hecho, skip ci] **Grupo: pulsación larga sobre el fondo** abre la hoja del fondo del grupo (elegir solo para mí, compartir, usar el
     compartido, quitar) (`wallpaper.setGroupWpOpener`, `group_panel`); `gruposadmin.js` (con contraprueba de arrastre). NOVEDADES: «En un grupo,
     mantén presionado el fondo para cambiarlo o compartirlo».
  7. **Plan aprobado 27-11 (dueño): enrutado por contacto con causa** (dónde está el otro, ✓✓ medido por camino, despierto/dormido, dónde
     escucha), reenvíos con UN calendario y cupo por relé, quitar «2 relés con datos», Fénix parado con la app a la vista. Diag. S24 23:33
     (3161) lo confirma: 2 textos pendientes ×8 ventanas + 6 de puente ×5 → damus «banned». Relé de NEXO: organizar el domingo 29-11.
     **Diseño completo: `docs/ENRUTADO_27-11.md` (leerlo entero, es corto). SIGUIENTE SESIÓN: empezar por ahí (reenvíos y Fénix primero).**
  5. **Zombi de la tablet (nx1e29ab2f):** enlace BT medio muerto que se rehace y cae cada ~30 s >7 min (área 3). Sin pérdida de mensajes.
- **SIGUIENTE SESIÓN (27-11 ~21:50 México, cerrada por contexto al 25 %):** 1) revisar el CI de la **APK 3161** (commit e810a05 en
  NEXOCHAT, subido 20:53, ~22:20) y, si pasó, NOVEDADES al historial como 3161 (si falló: qué prueba). 2) Empezar **`docs/PLAN_CAPACIDAD_27-11.md`**
  (TODO aprobado por el dueño; leerlo entero, es corto): 0 sincronía de chats al entrar/deslizar abajo (1 a 1 y grupos, en su lugar,
  archivos salvo borrados) y QUITAR «deslizar abajo cierra el chat»; 1 sin tope de 2000 mensajes (por tamaño, 1 GB) + búsqueda en todo;
  2 archivos grandes por internet directo; 3 llamadas de grupo por internet (vídeo 9, voz 30); 4 Wi-Fi Direct listo por intención (B);
  5 grupos de 100; 6 baratos (botones de atrás que quedan, lista de estados, mensajes que desaparecen, notas de vídeo, encuestas,
  ubicación en vivo); 7 traducción. Lo pesado (1–4) con el límite fresco: se reinicia el domingo 29-11 a las 2:00 México.
  Comparativa con las demás apps: `docs/COMPARATIVA_APPS.md`.
- **APK 3161 SUBIDA (27-11, Opus): los 4 detalles del dueño en la 3160** (grupo «Pura gente del señor Nexo»). Revisar el CI (~85 min) y, si pasa,
  NOVEDADES al historial como 3161.
  1. **Historial de grupo:** imagen mandada desde «Archivo» ('file', png con nombre, > 200 KB) va como FOTO reducida (JPEG) en vez de «📎 Archivo
     grande no incluido» (`group_history._isImageFile`; `grupohistorial.js` H2c, contraprueba). Sigue el aviso para archivos a disco (> 5 MB,
     `meta.big`) y para lo que no es imagen; mandar el puntero del buzón para esos queda por hacer (no pedido).
  2. **Un aviso por teléfono al entrar alguien:** el que entra solo «Te agregaron» (ya no «Nuevo en el grupo: tú», también al volver tras salir
     o ser expulsado); los demás «Nuevo en el grupo: X» y el «✅ Se unió» de X ya no se muestra donde salió ese aviso (`g.addN` en `group_admin`).
     Al crear un grupo sigue saliendo «Se unió» (es el único aviso ahí; I3 de grupoinvita). `grupohistorial.js` H1b (contraprueba).
  3. **Ajustes del grupo y sus pantallas sin X:** atrás de Android cierra la `.nx-panel` de más arriba (`chat_nav.__nexoHandleBack`). `gruposadmin.js`.
  4. **Botón Estados = flecha →**; al tocarlo, letrero «Desliza la pantalla hacia la izquierda para ver los estados» encima de Estados, 3,5 s,
     las 3 primeras veces (`estados_screen._btnHint`). `estadospantalla.js` E11 (flecha, letrero, se quita).
  **PRUEBAS DEL DUEÑO:** (a) mandar un png grande como Archivo al grupo y que alguien nuevo pida «Ver mensajes anteriores»; (b) agregar a alguien:
  un solo aviso en cada teléfono; (c) Ajustes del grupo → un integrante → atrás, atrás; (d) tocar la flecha de Estados.
- **APK DE EMERGENCIA (26-11 noche, Opus; el dueño eligió esperar al estilo parejo para que vaya TODO junto) — **APK 3160 PUBLICADA (26-11 20:09 México; CI en verde a la primera)**:**
  1. **Relés que limitan** (diag. 26-11 17:10 y 18:21, S24 → S23, «!»): **3347** no se reintenta 5 veces en 10 s (⏳, no «!»); **3348** relé que
     limita/castiga/no deja publicar queda EN PAUSA para publicar (rate 20 s→10 min; banned 10 min→2 h; web of trust/pago/PoW 6 h; se sigue leyendo),
     en pausa = caído para la reserva (entra otro), con todos en pausa queda pendiente SIN mandar nada, tras un límite lo pesado (≥ 4000) sale con
     1,2 s de respiro y lo pequeño sin esperar (`net_publish.js`, nota en `net_relays._onRelayMsg` aunque otro ya dijera OK); **nota de voz de
     grupo al buzón** (`send.js`: era el adjunto de ~260 KB EN LÍNEA a cada miembro); **3350** Fénix cede internet mientras los relés limitan
     (`chat_stream._bgShouldYieldNet`). Pruebas: `relelimita.js` (L1–L7, contraprueba), `blobfan.js --audio` (contraprueba 0 trozos).
  2. **Fondo de grupo solo para mí**, compartir opcional (cualquiera que escriba); uno compartido NO pisa el que elegí (queda «Usar el fondo que
     compartió X» en ⚙️ → Fondo del grupo); sí cambia uno que también llegó compartido (`wallpaper.js` from/oferta, `group_admin` gwp). `gruposadmin.js`.
  3. **Historial de grupo (3349):** foto > 200 KB → copia reducida (lienzo ≤ 1280) o su miniatura, ya no el aviso «no incluido»; no viajan marcas
     locales (thumbOnly/fullRef/blobPtr). `grupohistorial.js` H2b (contraprueba). Fotos ≤ 200 KB ya llegaban (probado).
  4. **Menores:** estadística («su app no contesta» ya no es fallo del Wi-Fi; «sin camino» que pasa directo a leído cuenta); **B-EST hecho** (commit 096e5df: hojas que suben = «Opciones del chat», avisos centrados `.nx-ask` con `.nx-btn`, Ajustes del grupo y
     sus pantallas con filas de icono; la hoja común queda encima del botón +; medido a 360 px; OJO `critical.css` esconde clases con «log/toast/debug/rem-»).
     Fuera: los `window.confirm` nativos, `#nexo-pin-menu` (opaco cian, dueño 24-11) y pantallas de diseño propio (juegos, editor de stickers, bienvenida…).
  **PRUEBAS DEL DUEÑO:** (a) los 3 en la misma Wi-Fi, mandar varios textos seguidos al S23: ⏳ si un relé limita, nunca «!», y llegan; (b) nota de voz
  en el grupo; (c) poner un fondo de grupo propio y que otro comparta el suyo: el tuyo se queda; (d) alguien nuevo en un grupo con fotos grandes
  pide «Ver mensajes anteriores»: ve las fotos. **Sin hacer:** que lo grande vaya por Bluetooth/Wi-Fi en vez de relés cuando ambos existen (el
  enrutador ya los prefiere; no se tocó). Fable (fuera): modo concierto nativo, 3c Bluetooth en llamada, doble enlace LE Coded → zombi.
  Límite semanal en aviso (se reinicia el domingo 29-11 a las 2:00 México).
- **Viejo (3157–3159, tanda menor, lista del 26-11):** en `docs/historial/ESTADO_traspaso_hasta_2026-11-26.md`. LECCIÓN: antes de subir, `node tests/sim/undef.js`.
  Playwright aquí: `PLAYWRIGHT_BROWSERS_PATH` a una carpeta con `chromium_headless_shell-1194/chrome-linux/headless_shell` → el de la 1243.
- **DESPUÉS DE ESA APK (25-11, [skip ci], va en la SIGUIENTE):** **3336** adjunto atorado de raíz: con la app congelada la escucha nativa de
  internet guarda en DISCO los trozos de archivo ('f') de un contacto (`NetChunkSpool.kt`, `nexo_netbg_chunks/`, tope 48 MB) y confirma
  SOLO lo guardado con el mismo 'ba' que la app; la app los recoge primero en netBgDrain (JVM `NetChunkSpoolTest` 6, con relé local).
  El archivo lo arma la app al volver. **3337** 3b en GRUPOS: el grupo reintenta cada 15 s a los miembros que esperan su Wi-Fi
  (`group_media.bigToGroup`), la tarjeta dice «Esperando…» (`grupoesperawifi.js`, contraprueba falla; en ci.js).
  **3338** oír al contacto por INTERNET ya no «protege» su enlace Bluetooth mudo con un envío atascado (`ble_ack.hasActiveTransfer`;
  `xferstuck.js` caso 6; diag. S24 3154 10:32, Zhelowsky 25 min). **3339** «sr» vencida (entró del segundo plano): se ignora y se vuelve a
  pedir la sincronía una vez (`srvencida.js`). GOOGLE PLAY (25-11): cuenta de desarrollador creada (personal, «MauBot»), identidad enviada,
  «no comerciante»; falta que Google apruebe y el teléfono. Ficha/privacidad/permisos: `nexo-private/negocio/PLAY_FICHA/`.
- **LA LISTA QUE MANDA (25-11 noche): `nexo-private/negocio/RUTA_LANZAMIENTO.md`** (tienda, código pendiente y negocio; marcar [x] ahí).
  **ANTES DE LA PRÓXIMA APK (B0, barato):** esconder la 3345 — quitar «Buscar a X entre la gente» del menú de los chats (`chat_menu.js`)
  y que se ignore la acción 'fnd' (`chat_actions.js`); el código se queda para el modo concierto. Google Play: identidad VERIFICADA (25-11 19:12).
  **ESTILO PAREJO (dueño 25-11, «muy importante»):** Ajustes, «Nuevo grupo», botones y ventanas emergentes con el estilo de la pantalla de
  Contactos (referencia); antes de las capturas de Play. Detalle: B-EST en la ruta.
- **MODO CONCIERTO (25-11 noche): DISEÑO ACORDADO CON EL DUEÑO, SIN EMPEZAR** → `docs/MODO_CONCIERTO.md` (leerlo antes de tocar nada).
  Lo de 3345 (`find_ui.js`, `find_near.js`, «Buscar a X» en el menú de cualquier chat) está en la rama SIN APK y NO debe salir así: se
  reutiliza dentro del modo concierto según ese documento. Lo grande (nativo) después del reinicio semanal (dueño: 76 % el miércoles).
- **APK 3156 PUBLICADA (25-11 19:57 México; CI en verde a la primera)** = foto del grupo en la lista se abre en grande (`grupofoto.js`) · **3343** el puente no se suelta al volver a la app (gracia 8 s) y rechazo de relés por texto = pendiente · **3344** relé del puente que se cae enseguida 2 veces → otro relé por el mismo puente (`puenterele.js`). PRUEBA: sin Wi-Fi ni datos, salir y volver a NEXO: el internet prestado sigue.
- **APK 3155 PUBLICADA (25-11 16:00 México; CI en verde a la primera)** = 3336 (trozos de archivo a disco con la app congelada) · 3337 (grupos esperan Wi-Fi) · 3338 · 3339 ·
  **3340** ping de antes de congelarse no rehace un enlace sano (`pingcongelado.js`) · **3341** archivo grande por Wi-Fi local sobre la red de un
  grupo de Wi-Fi Direct: no se monta otro grupo encima (`wdsobregrupo.js`) ni se desmonta mientras va (nativo `BigLanBusy`) · **3342** internet
  prestado: sin red, puente a los 1,5 s; relé que no abre → otro por el mismo puente al momento (`puenterele.js` 33 s → 3 s); NET_REJECTED =
  pendiente · tienda: diagnóstico pregunta antes. PRUEBAS DEL DUEÑO: sin Wi-Fi ni datos con NEXO cerca, mandar texto: sale en segundos.
- **APK 3154 PUBLICADA (25-11 9:05 México; nightly-3154; CI en verde a la primera) (tanda «Bluetooth nativo + logo + pendientes», Opus alto)** = logo B2 + Wi-Fi Direct híbrido (f7fbfbb7) + **3333** con la
  app CONGELADA el nativo guarda en el buzón en disco (`frozenKeep`) ANTES de su ✓✓ y lo entrega al volver (`frozenDeliver` en handleOnResume)
  o al reabrir: antes, si Android mataba el proceso, se perdía con ✓✓ · **3334** toque FCM con la app viva → `onWakeTouch` → la app
  comprueba y repide a sus relés (en sim la app oculta ya se cura sola: NO probado que arregle el adjunto atorado; falta la recepción nativa
  de trozos de archivo y avisar al emisor) · **3335** WebView sin «gesto para sonar» (`mediaPlaybackRequiresUserGesture=false`): llamada muda
  5–10 s al arrancar · videollamada (gestos aprobados, zoom 1–4× solo del otro, PiP solo la llamada, barra que vuelve + diag «botones»;
  `call_gestos.js`, `llamadagestos.js`) · actualización espera a colgar · archivo grande con Wi-Fi del otro apagado: «Esperando el Wi-Fi
  del otro», reintenta solo, ✓✓ solo al llegar (`big_ticks.js`, `wdesperawifi.js`; en GRUPO no cubierto). Sin hacer: 3c (frenar el vaivén
  del Bluetooth en llamada: medir primero). PRUEBAS DEL DUEÑO: icono; videollamada (pellizco, dos toques, ventanita desde Ajustes, botones
  tras varias ventanitas); contestar desde el aviso y oír desde el primer segundo; archivo grande con el Wi-Fi del otro apagado y encenderlo.
- **LOGO DEFINIDO (dueño 25-11), METIDO EN LA APP SIN APK ([skip ci]; va en la próxima tanda):** burbuja con cola + órbita + UN cubo (opción «B2»), dibujo
  sencillo sobre la imagen de arranque (que es la definitiva). Res de `android/app/src/main/res/`: icono adaptativo (primer plano 432 + capa de una tinta
  `ic_nexo_monochrome` para Android 13+), iconos de antes de Android 8, aviso `ic_stat_message` (silueta de burbuja + cubo; antes «burbuja + N»). Maestros SVG,
  generador y ficha de Play en el PRIVADO `negocio/icono_final_v2/`. El dueño duda si dejar la órbita (por ahora sí). PRUEBA al salir la APK: ver el icono en
  la pantalla de inicio (redondo y cuadrado), con tema de iconos (Android 13+), el aviso de un mensaje y que compile (no hay aapt aquí: lo valida el CI).
- **APK 3153 PUBLICADA (25-11 00:12 México; nightly-3153; lanzada a mano)** = invitación a grupo + historial para los nuevos + 3331 (puente sin
  duplicado) + 3332 (conexiones de paso repetidas, Alex) + arreglo de tamaño. `binary.js` falló una vez en el CI usando L2CAP con noL2Payload (sin explicar).
- **SESIÓN DE PLÁTICA 24/25-11 (cerrada por contexto, 25-11 noche):** diagnósticos de la prueba sin internet y de las videollamadas
  (S23/S24/vivo, 3150) analizados y anotados en `docs/PENDIENTES.md` (bloques «Videollamada 24-11 22:10» y «Videollamada: 3 fallos de
  pantalla» con los GESTOS APROBADOS por el dueño) y en `docs/diagnosticos.json`. Todo para UNA sola APK; nada subido. Causa confirmada del
  adjunto atorado: el toque FCM no despierta la parte que recibe archivos. **PLÁTICA DEL PRODUCTO (EDC) A RETOMAR:** pregunta abierta al
  dueño: «¿qué es lo primero que quieres que una persona logre con NEXO cuando no hay señal?» (encontrar a su grupo / aviso rápido a todos /
  pedir ayuda). Después: lista de pruebas físicas cortas, una por una. Plazo 7-dic de la cuenta de Google Play detenido: falta el nombre.
- **Forma de trabajo:** CLAUDE.md «GASTO» (leer SOLO este bloque + 🔴 de `docs/AREAS.md`; lo demás con grep). Todo el detalle de 3266–3311:
  `docs/historial/ESTADO_traspaso_hasta_2026-11-23.md` (y los anteriores). PRINCIPIO: NEXO = todos los caminos; nunca recortar caminos.
- **APK 3125 PUBLICADA (23-11 15:55 México; build 3314)** = 3309 (vista previa real por Tor, toque sellado 14A, «sr» firmado N10,
  limpieza) + 3310–3313. NOVEDADES: 3125 y 3123 ya en el historial (el bloque de la 3123 había quedado pegado y salió también en la
  descripción de la 3125); el de la próxima APK lleva texto provisional. Sin avisos programados activos.
- **APK 3127 PUBLICADA (23-11 19:57 México; nightly-3127) = puente nativo completo** (3315 paquetes Jump, 3315b «¿quién llega a X?»,
  3315c, 3316 textos largos y archivos por tubería; lo reenviado no se le pasa a la app dormida). Pruebas del dueño: S24 → Cari sin
  internet en ninguno, con el Vivo en medio con la app cerrada (y Cari lejos del S24): un texto, un texto largo y una foto deben llegar
  con ✓✓; lo mismo con el Vivo con la pantalla apagada un rato largo. Queda: JS vivo y nativo pueden reenviar los dos un paquete corto
  guardado (duplicado inofensivo).
- **3332 (diag. S24 17:23, build 3150, Alex con 4 enlaces):** las conexiones de paso identificadas por el nativo con la app detrás perdían
  la marca «de paso» y no se cerraban; ahora marca aparte 5 min + cierre en el repaso + 2.ª vuelta al sembrar (`ble_relay_anon.js`;
  `anondup.js` caso 7, y anondup entra al CI). Resubida con 3331 (se canceló la 3151; la invitación y el historial van en la nueva).
- **CI 3152 (b897e019):** 1.ª vuelta falló `binary.js` (en el CI los archivos salieron por el canal rápido L2CAP aunque la prueba pone
  noL2Payload; aquí pasa 4/4: SIN EXPLICAR, mirar si se repite); 2.ª vuelta pasó esa y falló `tamano.js` (ble_relay 1003, ble_ui 1007,
  i18n 1005). Arreglado: textos de invitación/historial a `*_b.js`, `group_invite_row.js`, `ble_relay_pass.js`. Se resube la tanda.
- **3331 (24-11 18:30 México, SIN APK; va en la próxima):** fin del duplicado del puente (COLA 1): la app viva y el nativo ya no reenvían los
  dos el mismo paquete Jump guardado (`OutboxBle.appSent`, llamado desde `sendMessageImpl`; `JumpNativeTest` 3 casos nuevos). CI 3151
  (invitación + historial) en curso, termina ~19:00 México.
- **24-11 tarde (dueño), HECHO SIN APK (commit [skip ci]):** (a) cabecera del chat: el símbolo del camino va ENTRE la foto y el nombre
  (`main.js` _viaSlot, `#chat-via-ico`) y sin «En línea»; debajo solo «señal débil»/«Conectando…». Jump y Bluetooth-internet (gw) con
  símbolo PROVISIONAL (tres puntos con saltos / ᛒ+globo; captura dada al dueño): FALTA que elija símbolo y NOMBRE de la conexión
  Bluetooth-internet (propuse «Internet prestado»). (b) La respuesta (y la edición) empezada se quedaba al cambiar de chat: ahora es solo
  de ese chat (`chat_actions._chatChanged`; `chatactions.js` resp_*, contraprueba HEAD falla).
- **APK 3150 PUBLICADA (24-11 17:06 México; nightly-3150)** = bloqueo + cabecera (símbolo junto al nombre, sin «En línea») + respuesta solo de su
  chat + 3330 + menú de la burbuja. EN LA APK DE LAS ~17:40 (invitación + historial): INVITACIÓN A GRUPO (Aceptar/Rechazar, `grupoinvita.js`; pruebas de grupos ajustadas: aceptan
  al momento). HECHO SIN APK: HISTORIAL PARA NUEVOS (`group_history.js`, `grupohistorial.js`; dueño 24-11, opción B: interruptor del creador en Opciones del grupo, activado de entrada; 30 días /
  500 mensajes; textos, fotos, audios y archivos chicos). `fotocalidad.js` falla también en la 3148 aquí (no es de esto).
- **3330 (diag. S24↔Austin 14:55, los dos 3148):** enlace recuperado al volver la app = «sin comprobar»: ping ya y 1 sin respuesta lo rehace
  (`ble_connections` _unverified; zombivuelta.js 50 s → 14 s, umbral 25). Va en la APK de la tarde con cabecera + respuesta. Símbolos: el dueño
  acepta los provisionales («no me convence el último pero es lo más lógico»); NOMBRE de Bluetooth-internet aún abierto.
- **SIGUIENTE (pedido del dueño 24-11): INVITACIÓN A GRUPO con Aceptar/Rechazar.** Hoy `groups.receive` mete al contacto en el grupo solo
  con el primer sobre. Plan: grupo nuevo (o me agregan) → `pending:true`, no sale en la lista, aviso «X te agregó a «Y»» en Solicitudes con
  Aceptar/Rechazar; lo que llegue mientras se guarda oculto y aparece al aceptar; Aceptar → mensaje de grupo «se unió»; Rechazar → salida
  firmada «rechazó la invitación». El nativo (NetBgSaved.groupNames) no debe avisar como grupo uno pendiente. Prueba nueva en tests/sim.
  Luego UNA APK con todo (bloqueo ya va en el CI de f73063ca; se sube otra vez con esto).
- **BLOQUEAR CONTACTO HECHO (24-11, SIN APK aún; va con el menú de la burbuja sin «Copiar»).** `src/ui/bloqueo.js` (núcleo: localStorage +
  copia cifrada `nexo_blocked.json`; `msgWhileBlocked`: lo que mandó mientras, no entra al desbloquear) y `bloqueo_ui.js` (hoja, barra del chat,
  lista en Ajustes → Seguridad → Privacidad). Filtros: entrada `ble_receive._handlePayload` y trozos `ble_ack_resume` (sin ✓✓); salida
  `ble_send.sendChatMessage` (BLOCKED) y `_contactIds` de estados/foto/datos; `net_link._hello` y `_bgConfig` (sin su clave nativa); llamadas
  `calls_ui._startCall`. Grupos siguen. Nativo: `MutedChats` (lista `blocked` en setMutedChats, cifrada) + `BgInbox.classify` → IGNORE;
  `NetBgHome.notifyMessage`; `BleSinApp.start` la carga. Pruebas: `tests/sim/bloqueo.js` (K1–K7, contraprueba NEXO_OLD_BLOCK=1 falla K5),
  JVM `BlockedContactsTest`, tipos Android OK. Límite honesto: de cerca por Bluetooth el enlace sigue (hace de puente) y él puede verme «cerca».
  NOVEDADES: bloque limpio (estaba pegado con los anteriores y la descripción de la APK salía con todo). Siguiente: subir la APK con esto.
- **APK 3148 PUBLICADA (24-11 12:50 México; nightly-3148) = 3327 + 3328 + 3329.** 3327 = ACUERDO EXPLÍCITO de enlaces repetidos (🔴 1, zombis S24↔Roberto/Alex/
  Zhelowsky): decide SOLO el de NEXO ID menor y se queda el enlace MÁS RECIENTE (el de después de volver la app); el mayor no cierra
  (salvo todos muertos o el menor > 3 min sin hacerlo); lo que el menor cerró hace < 10 min no gana por «nuevo» (sin vaivén); el chat
  abierto no frena al que decide; quitado el freno 3257 (el mayor ya puede abrir un cliente nuevo para salir de un servidor viejo).
  Pruebas: `bledup.js`, `dupserver.js` (rehecha) y vecinas OK. 3328 = con los relés limitando («rate-limited») el reenvío de pendientes
  espera 15 s → 2 min (`reenviolimite.js`). 3329 (dueño 24-11): franja del fijado: un toque salta y pasa al siguiente; pulsación larga = «Quitar» (`fijarmsg.js`). PRUEBA DEL DUEÑO: S24 con Roberto/Alex cerca, salir y volver a NEXO varias veces → sin
  «zombi» automático. Siguiente: (2) pruebas del dueño de la 3146; (3) logo A/B/C; (4) auditoría final (una).
- **APK 3146 PUBLICADA (24-11 10:25 México; nightly-3146; AAB nexo-tienda-1.0.0-3146 ✓, 16 KB OK)** = 3142 + 3324 Tor nunca se apaga
  (cierres SIGABRT del S24), 3325 enlace del puente no «muerto», 3326 sincronía firmada con varios números, pulido (esfera del audio con
  el color de la burbuja, menú del fijado arriba, menú «+» compacto con pestañita). NOMBRE: el dueño se queda con NEXO (compañeros);
  «NEXO Chat» se ve libre (falta IMPI). Zombi S24↔Roberto (desempate a MTU 23) → con el Bluetooth en el servicio nativo (🔴 1).
- **APK 3142 PUBLICADA (24-11 05:15 México; nightly-3142)** = 3317–3323 + Play (1.0.0, AAB «nexo-tienda-1.0.0-3142.aab» ✓, 16 KB OK)
  + fijados, hover, «Recibiendo…», notas de voz, menú «+», arranque con la imagen del dueño. Variantes de logo (A/B/C) dadas al dueño:
  falta que elija el ícono. Siguiente: auditoría final (una) tras sus pruebas.
- **24-11 (prueba del dueño, solo Bluetooth): 3321 PUENTE A INTERNET NATIVO** (`GwServe.kt`, la tablet dormida/cerrada presta su
  internet: antes solo la app) y **3322** (conexión de paso del Vivo cerrada «sin uso» aunque ya era el contacto). Van en la APK resubida
  24-11 ~23:40 México. **3323 RECIPROCIDAD** (decisión B del dueño): por el puente, textos a cualquiera; fotos/audios solo a quien
  me ayudó en 30 días (`gw_helpers.js`, libreta local; nativo vía netBgConfig gwHelp). El Vivo sigue en 3119: actualizarlo. Prueba: S24 sin Wi-Fi ni datos, tablet con Wi-Fi y app cerrada, S23 lejos.
- **Cierres nativos del S24 (18:24 y 21:26, SIGABRT):** causa aún desconocida; esta APK guarda en el diagnóstico el hilo que cayó y el mensaje
  del abort (tombstone). Con el siguiente cierre se ve la causa. A vigilar también: ✓✓ de Cari «sin firma válida» y un paquete de puente que reintenta horas.
- **También en esta APK (23-11 noche, pedidos del dueño):** quitar un fijado tocando la franja (también si se borró), «hover» pegado en la
  lista de contactos, «Recibiendo audio… N %» al llegar el aviso del buzón de archivos, notas de voz con barra/bolita para adelantar y
  marca de «sin escuchar» en las recibidas. Pruebas del dueño: recibir 3 audios y ver cuál falta; arrastrar la bolita; quitar un fijado borrado.
- **PLAY (hecho 23-11 noche, en esta APK):** versión 1.0.0, variante de tienda sin REQUEST_INSTALL_PACKAGES, paquete AAB firmado con la
  llave de subida (artefacto del CI «nexo-tienda-1.0.0-N.aab»). DUEÑO: poner en GitHub los secrets NEXO_UPLOAD_KEYSTORE_BASE64 y
  NEXO_UPLOAD_KEY_PASS (se los di en archivos; guardar copia fuera). Huella SHA-256 de la llave de subida: F2:C2:25:1A:…:47:C8:69:D7.
  Falta: 16 KB si el CI avisa, 5 idiomas al final, auditoría final tras la APK.
- **VAN EN LA 3125 (build 3314):** 3310 menú de la burbuja sin «Responder» (se responde
  deslizando) y «Editar» arriba; 3311 «Copiar» en la barra de la multiselección; 3312 (COLA 13) con enlace a MTU 23 los archivos desde ~6 KB
  van por el canal rápido L2CAP (`l2_fast.js`, `l2mediano.js` caso mtu23); 3313 (COLA 25) videollamada contestada desde el aviso: la cámara
  cortada se reabre aunque el WebView siga «oculto» si Android ya dice primer plano (`call_media.js`, `callmedia.js` 9b).
- **DUEÑO, PENDIENTE DE ÉL:** (1) publicar `worker.js` + secreto `WAKE_KEY` en Cloudflare (pasos: `push-sender/cloudflare/README.md` §14A;
  más adelante `ONLY_SEALED=1`); (2) icono final (solo en el privado `negocio/icono_final/`); (3) Google Play: cuenta, id de paquete,
  privacidad, 12 probadores, teléfono Android 15/16; (4) Kinway: IMPI, dominios, redes; (5) Wi-Fi Direct: DECIDIDO 25-11 el híbrido (ver `docs/COLA.md` 3), ya no es A/B.
- **PRUEBAS DEL DUEÑO pendientes:** 3123 (arranque y nº de build, mensaje con la app del otro cerrada y sin internet, «Solicitudes», «ver una vez»
  sin captura, grupos/ruedita, S24 cerca de Alex sin «enlace repetido»); 3309 (vista previa de un contacto y de quien no lo es, aviso al abrir
  un dominio raro, que NEXO siga despertando con la app cerrada); tarjeta «silencia» en Honor/Vivo/Motorola; canal rápido L2CAP; WD «cancelar».
- **SIGUIENTE:** `docs/COLA.md` (ORDENADA 23-11 13:45; lo viejo en `docs/historial/COLA_hasta_2026-11-23.md`). Los fallos menores (A) ya
  estaban hechos (15, 27, 28, 34, 35, 36) o se hicieron hoy (13, 25 imagen propia). Queda: (1) LO GRANDE con Fable tras el reinicio semanal:
  Bluetooth entero en el servicio nativo = puente con la app dormida + que vuelva sola (🔴 1); (2) Wi-Fi Direct real; (3) llamadas: datos por
  relés; (4) Play: targetSdk 35/36; (5) auditoría final (una).
- **Herramientas:** `CI_ONLY='a.js|b.js|texto' node ci.js builds/wip`; `tests/kotlin-android` (tipos) y `tests/kotlin` (JVM); `multitud.js` (Chromium, no va en el
  CI). Ayudantes: copia aparte con `git worktree add /home/user/wt/<n> -b ayudante-<n> NEXOCHAT` + enlaces a `tests/sim/node_modules` y `.deps`. `estadovideo.js`
  falla en este contenedor (HEVC) pero pasa en el CI. Sin avisos programados activos (el del CI de la 3119 ya no hace falta).- **Nombres:** dueño = S24 (nx1n36c283) · Cari = S23 Ultra (nx1e50c95d) · Roberto = Motorola (nx0g6ef54e) · Austin = Honor (nx1905c1ee) · Marcos (nx01992876) ·
  Zhelowsky (nx0x4029e6) · Yael = Redmi (nx16386482) · Katy = Honor (nx126df3f4) · Vivo Y03 (nx09acdb61) · tablet A7 Lite (nx1e29ab2f).- **Reglas vivas:** español, breve, horas de México; reproducir en `tests/sim` antes de arreglar; NOVEDADES solo en español; el Kotlin no se compila aquí (lo
  compila el CI, ~85 min): UNA subida por tanda; decisiones al dueño en forma A/B con lo que vive el usuario.

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
