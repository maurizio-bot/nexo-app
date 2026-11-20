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
- **Forma de trabajo (dueño 20-11, «eficaz y eficiente», su límite SEMANAL es lo que frena; plan Max, no sube a Ultra):**
  ver CLAUDE.md «Gasto». Leer SOLO este bloque + la lista 🔴 de `docs/AREAS.md`; lo demás, a demanda con grep.
- **Publicado:** APK 3111 (3251 servidor GATT al abrir, 3252 «fallido» momentáneo, 3253 solo diagnósticos de la última versión).
  El dueño debe actualizar SU teléfono primero (el filtro usa su build).
- **EN CI (20-11): 3254 = Bluetooth en el servicio, FASE 1** (#87): con NEXO vuelta sola (reinicio, actualización, cierre del sistema, toque
  FCM) y sin la app en el proceso, el servicio anuncia (NEXO ID y clave del código rotativo guardados CIFRADOS, `nexo_ble_sinapp.json`) y
  abre su servidor GATT: buzón + ✓✓ firmado + aviso + pong + «quién soy» (`SinAppCore.kt`, puro, 9 pruebas JVM `SinAppCoreTest`;
  `BleSinApp.kt` = servidor y avisos; `BleService.startSinApp`; relevo al abrir la app en `takeOverFromClosed` → `BleSinApp.stopForApp`).
  El Kotlin de Android (BleSinApp/BleService) NO se compiló aquí: si el CI falla al compilar, corregir. En el registro nativo sale
  «[BT_SINAPP] Bluetooth sin la app: anunciando y recibiendo (tras …)». PRUEBA DEL DUEÑO: reiniciar un teléfono (sin abrir NEXO),
  desbloquearlo, y desde otro cercano SIN internet mandarle un texto: debe sonar el aviso y quedar ✓✓; al abrir, el mensaje está.
  FASES SIGUIENTES (sin hacer): 2) que el servidor GATT viva SIEMPRE en el servicio (también con la app abierta: sin relevos);
  3) conexiones salientes y reenvío de pendientes desde el servicio; 4) conexiones a demanda (tope ~7). Ojo: los «Foreground kill» de
  Motorola a la hora en punto parecen un cierre forzoso (ni alarma ni FCM la reviven: Roberto 4 h): eso no lo arregla el código, falta
  detectarlo y explicárselo al usuario.
- **Enlace repetido que se reabre (S24↔Austin), INVESTIGADO SIN ARREGLAR (20-11):** el escaneo no es (ya tiene guarda). Lo visto: el enlace
  que el desempate cierra (p. ej. 54c9 a las 14:52:04) vuelve ~63 s después por `_seedNativeConnections` («Conexión existente recuperada
  al arrancar»): el nativo lo sigue listando tras `disconnectDevice({server:true})`, entra sin MTU conocido (23) y eso deja reconectar la
  otra dirección → bucle. Falta saber POR QUÉ el nativo lo sigue teniendo (¿cancelConnection no corta?, ¿el otro reconecta solo?): hace
  falta el registro NATIVO de esos segundos. 3255 (en la rama `ccr-45654f1b-mrooyc`, SIN subir a NEXOCHAT): solo registro (papel y MTU de
  cada enlace al cerrar; «cerrada por repetida hace N s» al recuperarla). Sube con la próxima APK. No arreglar a ciegas.
- **20-11 22:05 (México): APK 3113 PUBLICADA, CI en verde** (3254 Bluetooth en el servicio fase 1, 3255 registro del enlace repetido). La 3112 solo
  falló al compilar (`notifyMessage`). PRUEBA DEL DUEÑO pendiente: reiniciar un teléfono, desbloquearlo SIN abrir NEXO y desde otro cercano SIN
  internet mandarle un texto: debe sonar el aviso y salir ✓✓; en su diagnóstico buscar «[BT_SINAPP] Bluetooth sin la app: anunciando y recibiendo».
 los de la última build; se apuntan en `docs/diagnosticos.json` (`node tests/sim/diag_stats.js`).
  La tarea de cada hora (canal directo) ya filtra las viejas.
- **Problemas grandes:** lista 🔴 en `docs/AREAS.md`. N.º 1 = app dormida/muerta que no vuelve sola (#87) → Bluetooth en el servicio nativo.
- **Nombres:** dueño = S24 (nx1n36c283) · Cari = S23 Ultra (nx1e50c95d) · Roberto = Motorola edge 40 neo (nx0g6ef54e) · Austin = Honor
  (nx1905c1ee) · Marcos (nx01992876) · Zhelowsky (nx0x4029e6) · Yael = Redmi (nx16386482) · Katy = Honor (nx126df3f4) · Vivo Y03
  (nx09acdb61) · tablet A7 Lite (nx1e29ab2f).
- **Reglas vivas:** español, breve, horas de México; nunca esperar permiso para seguir; reproducir en `tests/sim` antes de arreglar;
  NOVEDADES solo en español; no compilar Kotlin aquí (lo compila el CI, ~85 min por APK: juntar cambios en UNA subida).
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
