# TRASPASO 26-11 (sacado de ESTADO.md el 27-11)

- **APK 3159 SUBIDA (26-11 ~14:40 México):** la 3158 falló en 2 pruebas (avisoschat: buscaba el texto viejo del menú ⋮; gruposaudit: 40 intentos de firma no bastaban, azar) → arregladas las pruebas, sin cambio de la app.
- **(antes) APK 3158 (26-11 ~12:00, FALLÓ):** la 3157 FALLÓ en «Nada sin definir» (`screen` en `find_ui.js` de la 3345, que nunca había
  pasado por el CI) → arreglado; 3158 = todo lo de la 3157 + la tanda menor + ICONO EVERBEAT F (círculo y latido naranja #ff2301; `nexo-private/negocio/icono_everbeat_final/`).
  El NOMBRE aún dice NEXO en la app (Everbeat pendiente del IMPI). Diagnósticos 26-11: doble enlace a la copia LE Coded → zombi (PARA FABLE, en PENDIENTES).
  LECCIÓN: antes de subir, correr `node tests/sim/undef.js` (tarda 1 s) además de las pruebas cercanas.
- **TANDA MENOR SIGUIENTE (26-11, en `ccr-5f3d29e2-x9z1cz`, [skip ci], SIN subir: el dueño revisa la 3157 y da indicaciones):** batería al PRIMER contacto
  (instalación nueva; `_askBgWhenUseful` en main_chats.js, `welcome.js`); menú ⋮ del contacto con iconos de línea (`ble_ui.js`); adjuntar con nombre bajo cada icono;
  «Agregar contactos» con título 21 px; «Se unió al grupo» ya no suma no-leídos ni avisa (`quiet` en notify.js; era el 1/2/3 de `groups.js`). NOVEDADES: 3157 al historial.
- **SIGUIENTE SESIÓN (26-11, cerrada por contexto al 37 %):** 1) revisar el CI de la **APK 3157** (run 45851189322, arrancó 9:39 México, ~11:05) y, si pasó, pasar
  NOVEDADES al historial como 3157. 2) **DUEÑO 26-11: «junta TODO lo que no es pesado para la siguiente; cuando salga la 3157 la reviso, te doy indicaciones y ya después
  subes esa»** → trabajar en rama con [skip ci] y NO subir a NEXOCHAT hasta sus indicaciones. Lista: (a) permiso de batería DESPUÉS del primer mensaje (aprobado;
  ajustar `welcome.js` y `battery_prompt.js`); (b) resto de B-EST: ventanas emergentes, menús ⋮ y hojas iguales a Chats (medir en navegador como Ajustes); (c) menú
  de adjuntar con texto bajo cada icono la primera vez; (d) `groups.js` «no_leido_A» da 1/2/3 (también antes: ¿prueba o cuenta de más?); (e) del resumen 25-11: 13
  «sin camino» sin ✓✓ y «Wi-Fi local: conectado pero su app no contesta» ×10. Del dueño: nombre en tienda (NEXO/Kinway) y nombre de usuario fijo vs confirmación
  doble. Para la APK de tienda: `VIA_FADE_MS = 1000` (main.js) + auditoría de seguridad. Para Fable: modo concierto nativo, 3c Bluetooth en llamada.
  Pruebas en este contenedor: `PLAYWRIGHT_BROWSERS_PATH` a un enlace de `chromium_headless_shell-1243` (el de tests/sim pide la 1194); `estadovideo.js` falla aquí siempre.
- **TANDA «TODO LO MENOR» (26-11, SUBIDA A NEXOCHAT por orden del dueño; detalle en `docs/PENDIENTES.md` «26-11»; revisar el CI ~85 min):** + botón +, «Chats», botón Estados, símbolo del camino tocable, guía de 7 pasos, Ajustes más humanos; destello de estados nuevos, pantallas parejas
  (Ajustes/Nuevo grupo = Contactos), grupos solo en los ⋮ del contacto, B0 hecho (3345 escondido), guía de 5 pasos, Contactos vacío con botón, voseo fuera.
  **ANTES DE LA APK DE TIENDA:** `VIA_FADE_MS = 1000` en `main.js` (símbolo del camino 1 s) y decidir NOMBRE (NEXO/Kinway; ver FICHA.md). Revisión externa: `docs/REVISION_EXTERNA_26-11.md`.
