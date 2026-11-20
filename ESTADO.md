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

## Dónde estamos (actualizado: 2026-11-10)

### TRASPASO (empezar una sesión limpia desde aquí; MÁXIMO ~60 líneas: lo viejo pasa a `docs/historial/`)
- **Forma de trabajo (dueño 20-11; su límite SEMANAL es lo que frena, plan Max, no sube a Ultra):** ver CLAUDE.md «GASTO». Leer SOLO este bloque + la
  lista 🔴 de `docs/AREAS.md`; lo demás, con grep. Una sesión = un tema; una APK por tanda; sin reloj de ausencia.
- **PRINCIPIO (CLAUDE.md):** NEXO = TODOS los caminos; nunca recortar caminos. Wi-Fi Direct: pendiente reproducir «No se pudo crear el grupo» en `tests/sim` y decidir
  con el dueño A (pasar siempre a Wi-Fi Direct con Bluetooth) o B (dejarlo listo y usarlo con tráfico pesado); preferencia de Claude: B.
- **PUBLICADO:** APK 3111 (3251–3253) y **3113 (20-11 22:05 México): 3254 Bluetooth en el servicio FASE 1** (con NEXO vuelta sola —reinicio, actualización, cierre del sistema,
  toque FCM— el servicio anuncia y recibe por Bluetooth sin la app: `SinAppCore.kt` puro con 9 pruebas JVM, `BleSinApp.kt`, `BleService.startSinApp`, relevo en
  `takeOverFromClosed`; NEXO ID y clave rotativa guardados CIFRADOS en `nexo_ble_sinapp.json`) + 3255 (registro del enlace repetido que vuelve).
  **PRUEBA DEL DUEÑO PENDIENTE:** reiniciar un teléfono, desbloquearlo SIN abrir NEXO y desde otro cercano SIN internet mandarle un texto: debe sonar el aviso y salir ✓✓;
  en su diagnóstico: «[BT_SINAPP] Bluetooth sin la app: anunciando y recibiendo». El dueño debe actualizar SU teléfono primero (el filtro de diagnósticos usa su build).
- **PUBLICADO: APK 3116 (20-11 02:54 México) = 3256–3260** (batería/temperatura en llamadas, enlace repetido, medidas de Wi-Fi Direct, tablero por red `docs/REDES.md`, Wi-Fi Direct en archivos grandes). Las 3114 y 3115
  fallaron SOLO por reglas de estilo (textos fijos 26>25; diccionarios 1.001>1.000 líneas): antes de subir correr `tamano.js` e `i18n_audit.js`. Primer CI donde compila lo nativo nuevo (PluginLog.kt, PluginWifiDirect.kt): OK.
  FALTA: llamadas de GRUPO con batería/temperatura, «cronómetro de actividades», prueba corta del dueño Bluetooth vs Wi-Fi Direct (batería de ambos lados) y primer cuello de botella: preparar archivo grande ≈ 5 MB/s.
- **3257 (PUBLICADO en la 3116):** causa del bucle «enlace repetido» con el vivo (diagnóstico del dueño 20-11 22:22, build 3113): 3019 reabre un
  enlace de cliente (mtu517) si el que hay va a MTU 23, y el desempate de 3027 (soy el ID mayor → conserva el de SERVIDOR) lo vuelve a cerrar; los dos viven ~20–80 s. Arreglo:
  `_newClientWouldBeClosed` (ble_helpers.js) + rama en `ble_connections.js` (no reabre si el enlace que hay es el que conserva el desempate). Prueba pura en `bledup.js`; cercanas
  (dupserver, dupscan, reconndedup, dedupreenlaza, vivoarriba) OK. Queda: el enlace conservado va a MTU 23 (lento por Bluetooth con el vivo Y03; internet/Wi-Fi local lo cubren).
- **3258 (PUBLICADO en la 3116): medidas de Wi-Fi Direct en el diagnóstico** (pedido del dueño 20-11: que cuando entre WD «sí o sí» salgan datos reales).
  `usage_stats.js` (`usageNoteWd`, líneas dentro de «Velocidad de hoy por camino»): intentos y salidos por lado (envía/recibe), fallos con causa, crear grupo (con reintentos y código del
  sistema), unirse, velocidad PURA, tiempo trabajando, Wi-Fi normal (seguía/cambió de canal/se cayó), por qué sí/no se eligió WD (`_whyNot`); `wifi_direct.js` los anota y deja una línea de
  batería y temperatura por transferencia (≥ 5 s); «conexión lista» de WD entra en la tabla. Nativo (`PluginWifiDirect.kt`, NO compilado aquí): `groupMs/attempts/reasons/apStart` al montar el
  grupo, `apStart/apJoined` al unirse, `apMhz` al recibir (frecuencia del Wi-Fi normal, 0 = sin Wi-Fi). Pruebas: `wdmedidas.js` (en ci.js) y `wifidirect.js` (de punta a punta, local).
  Con eso se decide Wi-Fi Direct A/B con números del dueño; falta una prueba corta de archivo Bluetooth vs Wi-Fi Direct entre dos teléfonos (él la hace; los números salen solos).
- **3259 (PUBLICADO en la 3116): tablero por red** (dueño 20-11: «revisar red por red… ya no es resolver, es pulir»). Nuevo `docs/REDES.md` (qué se mide, datos reales con fecha,
  cuellos de botella ordenados y qué falta). Código: `usage_stats.js` (`usageNoteSent/Delivered/Symptom`: mensajes por camino al salir con ✓✓ y tiempo en cubetas, síntomas del día por tipo) y
  gancho en `diag_state.js`; prueba `redesmedidas.js`. Primer cuello de botella a trabajar: preparar archivo grande ≈ 5 MB/s (30 s para 153 MB). OJO: en `diag_stats.js` los fallos
  NO bajan por día (1, 5, 23, 29 del 16 al 19-11), pero cuenta lo que se pega/registra, no un ritmo; medir síntomas por hora de uso y build.
- **3260 (PUBLICADO en la 3116): Wi-Fi Direct en archivos grandes** (dueño 20-11: «con el vivo, en los de 160 MB no vi Wi-Fi Direct; por arriba de 5 MB sí o sí debe entrar»). Verificado
  en los registros: los 3 envíos (5,4/23/153 MB) SÍ fueron por WD («[BIG] Enviando … por Wi-Fi Direct», el vivo «Grupo creado»), pero la tarjeta solo decía «(Wi-Fi Direct)» durante «Enviando» (~6 s) y en «Preparando»
  (30 s) no decía nada: el grupo se monta y se baja en cada envío (nombre y clave nuevos), por eso no «se mantiene». Cambios: la tarjeta termina con «Enviado por Wi-Fi Direct · X MB/s»; `big_file.route` ya no deja
  que un castigo por fallo reciente cierre WD a un archivo grande (`canReach(nx, true)`); cada envío grande anota «por WD» o POR QUÉ no (`_noteRoute`/`_whyNot(dev, bytes, true)`). Si el dueño quiere el grupo
  siempre arriba (opción A), falta el «grupo caliente» nativo (paso 2 de wifi_direct.js, hoy vacío). Pruebas: `wdmedidas.js` (M7), bigroute/bigsend/big/wdoff OK.
- **PRUEBA DEL DUEÑO (noche del 20-11):** videollamada S24→S23 de 20–30 min con la 3116 en los DOS; en casa con Wi-Fi, más calor que la mañana (13 °C). Referencia WhatsApp (S24 Ultra, mañana): ≈ 0,31 %/min (19 %/h; él estima 25 %/h);
  su recuerdo de NEXO: 1 % cada ~7 min (0,14 %/min) = entre 1/3 y 1/2 de WhatsApp. El diagnóstico de cada teléfono trae %/h, temperatura máxima y estado térmico: comparar con eso y anotar el ambiente en `docs/AREAS.md`.
- **SIGUIENTE (tras el reinicio semanal del límite; el dueño iba al 96 % el 20-11):** 1) preparar archivo grande a ≈ 5 MB/s (cifrar a disco); 2) llamadas de grupo con batería/temperatura y «cronómetro de actividades»; 3) leer la prueba de la noche y
  el diagnóstico con la 3116 (síntomas por día, entrega por camino, Wi-Fi Direct); 4) Bluetooth en el servicio fases 2–4; 5) decisión Wi-Fi Direct A/B con los números de batería; 6) mediana/p90 y capacidad en el tablero (`docs/REDES.md`).
  Regla del dueño: lo que él reporta de pruebas reales es un HECHO (CLAUDE.md). Antes de subir: correr `tamano.js` e `i18n_audit.js`.
- **FASES SIGUIENTES del Bluetooth (sin hacer):** 2) servidor GATT SIEMPRE en el servicio (también con la app abierta); 3) conexiones salientes y reenvío desde el servicio; 4) conexiones
  a demanda (tope ~7); luego auditoría posterior y modo vagón. Los «Foreground kill» de Motorola a la hora en punto no los arregla el código: detectarlos y explicárselo al usuario.
- **Enlace repetido que se reabre (S24↔Austin), INVESTIGADO SIN ARREGLAR:** el enlace que el desempate cierra vuelve ~63 s después por `_seedNativeConnections` («Conexión existente
  recuperada al arrancar»), el nativo lo sigue listando tras `disconnectDevice({server:true})`, entra sin MTU y deja reconectar la otra dirección. Falta saber por qué lo sigue teniendo:
  hace falta el registro NATIVO de esos segundos (3255 ya añade papel/MTU al cerrar y «cerrada hace N s»). No arreglar a ciegas.
- **Diagnósticos:** solo los de la última build (3253); se apuntan en `docs/diagnosticos.json` (`node tests/sim/diag_stats.js`). Abiertos de la app: mensaje atorado durante una
  videollamada (S23→S24 21:28), datos repetidos al abrir en frío, enlace repetido; costumbres del teléfono: quitar NEXO de recientes corta la recepción (Cari), Honor/Vivo congelan la app.
- **Videollamada del dueño 19-11 (83 min, caminando, «de las mejores»):** anotada en AREAS (Llamadas); batería/calor son percepción: medirlos con 3256.
- **Nombres:** dueño = S24 (nx1n36c283) · Cari = S23 Ultra (nx1e50c95d) · Roberto = Motorola (nx0g6ef54e) · Austin = Honor (nx1905c1ee) · Marcos (nx01992876) · Zhelowsky (nx0x4029e6) ·
  Yael = Redmi (nx16386482) · Katy = Honor (nx126df3f4) · Vivo Y03 (nx09acdb61) · tablet A7 Lite (nx1e29ab2f).
- **Reglas vivas:** español, breve, horas de México; reproducir en `tests/sim` antes de arreglar; NOVEDADES solo en español; el Kotlin no se compila aquí (lo compila el CI, ~85 min):
  juntar cambios en UNA subida; decisiones al dueño en forma A/B con lo que vive el usuario.
- Historial anterior: `docs/historial/ESTADO_hasta_2026-11-19.md`.

## ✅ Trabajo del teléfono — YA INTEGRADO
> Acá se anota lo que se hizo en el teléfono y se trajo al repo.

- **[✅ 04-11] Monetización + entretenimiento** — el dueño avanzó el plan en el teléfono; se integró a `nexo-private/negocio/MONETIZACION_Y_ENTRETENIMIENTO.md`. Tiene las fuentes de ingreso (Fundador 199 MXN, Negocios, etc.), el modo entretenimiento para el **15-nov** (sala de juegos: Conecta 4 + piedra-papel-tijera) y una **checklist de decisiones del dueño**.

---

## Documentos de referencia (el detalle largo)
- `docs/PROGRESO.md` — historial completo de builds.
- `docs/PENDIENTES.md` — todo lo que falta + reglas del dueño.
- `docs/ROBUSTEZ.md` — índice de robustez, mediciones y rutina diaria.
- `nexo-private/seguridad/AUDITORIA_COMPLETA_03-11.md` — última auditoría completa.
- `CLAUDE.md` — instrucciones del proyecto.
