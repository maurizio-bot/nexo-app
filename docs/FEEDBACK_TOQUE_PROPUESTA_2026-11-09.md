# NEXO — Propuesta: el «feel» de los botones (toque certero + háptica placentera + respuesta visual de calidad)

**Para decidir juntos. Nada implementado todavía.** 09-11-2026. Pedido del dueño: «retroalimentación por vibración y visual…
algo que el user diga: *wow, qué bien se siente*… partiendo desde el toque, dimensionar las áreas sin interferir, vibración
placentera y un efecto visual superlativo. Antes de hacerlo me exponés la idea y decidimos juntos».

## 0. La idea en una frase
Un **sistema único de toque** («NEXO Touch») con tres capas que ocurren **sincronizadas en los primeros ~50 ms** del
contacto: (1) un **área de toque generosa e invisible** (≥48 px; 56 en los botones del pulgar) que **nunca pisa** a la vecina;
(2) **háptica del sistema**, corta y nítida (10–20 ms), que respeta el ajuste del teléfono; (3) una **respuesta visual física**:
entra rápido (≤70 ms), sale con un rebote suave (~220 ms) y con una onda que nace **exactamente donde tocaste**. Todo desde UN
motor (un archivo JS + un método nativo + un bloque CSS), en vez de 25 reglas sueltas.

## 1. Qué hay hoy (medido en el código, no de oído)
- **Visual:** `:active { transform: scale(0.92) }` repetido a mano en ~25 selectores (`critical.css`, `nexo_theme.css`,
  `calls_ui.js`, …) **sin tiempos ni curvas** (salto seco), y `:active` en el WebView de Android **llega tarde** (el navegador
  espera a saber que no es un scroll) o no llega en elementos sin listener de touch. Bien: `-webkit-tap-highlight-color:
  transparent` es global. `prefers-reduced-motion` solo se respeta en gestos.
- **Háptica:** `navigator.vibrate(50)` en gestos (50 ms = **zumbido «buzzy»**, justo lo que Android desaconseja),
  `vibrate(15)` al armar «responder», y la llamada entrante `[400,200,400]` (esa está bien: es atencional). **Nada nativo**:
  no respeta el ajuste «Vibración al tocar» del teléfono, y la Vibration API no controla ni intensidad ni nitidez.
- **Tamaños** (en el WebView 1 CSS px = 1 dp): botones de la barra de escribir **38×38** (adjuntar y enviar/micrófono — los
  más usados de toda la app); cabeceras 40–42; «atrás» 38–40; «+» pequeño de agregar **36**; redondos de escaneo 48 ✓;
  filas de contactos 66 de alto ✓; items del menú «+» 50 de ancho ✓.

**Veredicto honesto:** funciona, pero no «se siente»: la respuesta llega desincronizada del dedo, lo más tocado está por
debajo de las guías, y la vibración es de baja calidad.

## 2. Lo que dice la evidencia
*(Marco qué pude verificar hoy en la fuente y qué es conocimiento previo: los sitios de Material 3, Apple y ACM no son
accesibles desde la red de esta sesión.)*

### 2.1 Toque certero: tamaño, separación, zona del pulgar
- **Material:** 48×48 dp mínimo con **8 dp de separación** entre objetivos (48 dp = 7,6 mm). **Apple:** 44×44 pt (6,9 mm).
  **WCAG 2.2:** 2.5.8 (AA) 24 px mínimo con 24 px de separación si es menor; 2.5.5 (AAA) 44 px. *(verificado)*
- **Investigación con pulgar** (Parhi, Karlson, Bederson, MobileHCI 2006; *Best Historical Paper* 2016): **9,2 mm** para
  toques sueltos y **9,6 mm** para secuencias ≈ **58–60 dp**. El pulgar necesita MÁS que el índice, y en un chat
  enviar/micrófono/adjuntar se tocan con el pulgar y en secuencia. *(verificado)*
- **Zona del pulgar** (Hoober 2013; ~49 % usa una mano): lo cómodo es la franja baja y central; **las esquinas superiores
  son lo más difícil**. Los bordes de la pantalla son «infinitos» para la ley de Fitts: un botón pegado al borde no se puede
  errar hacia ese lado. *(verificado en fuentes secundarias)*
- La **separación manda** más que el número exacto: 24 px con 2 px de gap sigue fallando. *(verificado)*

### 2.2 Tiempo (latencia)
- Nielsen Norman Group: el estado «presionado» tiene que aparecer en **≤100–150 ms** para leerse como instantáneo. Guías de
  micro-interacción: presión casi instantánea (**50–80 ms**) y **soltar más lento que presionar** (así se sienten los
  botones físicos). *(verificado)*
- Latencia háptica (Kaaresoja, Brewster y Lantz, ACM TAP 2014 — no pude abrir el PDF; por conocimiento previo): lo táctil y
  lo sonoro se perciben «simultáneos» solo en los primeros **~50–70 ms**; lo visual tolera algo más (**~85–100 ms**). Pasado
  eso la **calidad percibida cae** aunque la función ande. Android lo dice a su manera: «un háptico desincronizado hace creer
  al usuario que el motor está roto». *(este último, verificado)*

### 2.3 Háptica que se siente bien (páginas oficiales de Android, verificadas hoy)
- **«Menos es más»**: la vibración excesiva molesta y entumece. Tres categorías: **clear** (nítida, ligada a un evento
  discreto — la preferida), **rich** (texturas; solo en motores buenos) y **buzzy** (zumbido con cola). Regla literal:
  *«Entre un háptico buzzy y ninguno para el toque, elegí ninguno»* (salvo llamadas/notificaciones).
- Un **clic válido dura 10–20 ms**; el motor puede seguir sonando 20–50 ms más. **Evitar** `createOneShot` /
  `vibrate(ms)` — que es exactamente lo que hace `navigator.vibrate`.
- **Priorizar `View.performHapticFeedback(HapticFeedbackConstants.X)`**: respeta por defecto el ajuste «Vibración al tocar»
  del sistema, **no pide permiso**, y trae el fallback afinado por el fabricante (Samsung y Pixel afinan sus efectos).
  Constantes que nos sirven: `VIRTUAL_KEY` (pulsar tecla), `CONFIRM` (confirmación corta y ligera, Android 11+), `REJECT`
  (fallo, más fuerte, 11+), `LONG_PRESS`, `CONTEXT_CLICK`, `CLOCK_TICK`/`SEGMENT_TICK` (snaps), `GESTURE_THRESHOLD_ACTIVATE`
  (14+), `TOGGLE_ON/OFF` (14+).
- Intensidad según **frecuencia e importancia**: lo frecuente, sutilísimo; «enviar un formulario debe sentirse más que mover
  un toggle».
- Cadena de fallback oficial: constantes → efectos predefinidos (10+) → composición de primitivas (11+, **sin fallback**: si
  una primitiva no está soportada no vibra nada; soporte completo desde Android 12) → *«si no hay un efecto bueno, mejor
  nada que uno discordante»*.

### 2.4 Apple (citas verificadas + conocimiento previo)
- *«Usar la háptica consistentemente: una relación causal clara entre cada háptico y la acción que lo causa»*. *«El mejor
  háptico suele ser el que la gente no nota, pero extraña cuando se apaga»*. No interferir con cámara, micrófono ni
  giroscopio. Impactos light/medium/heavy/rigid/soft, notificaciones success/warning/error, selección.

### 2.5 Visual (Material 3 — valores de la especificación por conocimiento previo, a confirmar; el sitio no era accesible)
- **State layer** (velo) sobre el elemento al presionar: **10–12 %** del color del contenido (M3 10 %, M2 12 %; dragged 16 %);
  **ripple** acotado al contorno y que **nace en el punto de toque**.
- Duraciones: *short* 50–200 ms, *medium* 250–400 ms. Easing estándar `cubic-bezier(0.2, 0, 0, 1)`; *emphasized decelerate*
  `cubic-bezier(0.05, 0.7, 0.1, 1)`.
- **M3 Expressive (2025):** muelles (spring) para que «viva» — *spatial fast* ≈ damping 0,6 / stiffness 800 (rebote leve),
  *default* 0,8 / 380 — y recomienda **acompañar los muelles con háptica nativa**.

## 3. La propuesta: «NEXO Touch»

### 3.1 Capa 1 — Toque certero (áreas de toque)
**Regla:** lo visible puede quedar como está (o crecer poco); **lo que crece es el área de toque, invisible**, con un
pseudo-elemento (`::before` extendido alrededor; la técnica «hit slop»/`TouchDelegate`). **Regla dura:** un área ampliada
**nunca pisa a la vecina** (mínimo 8 px entre áreas; si no hay lugar, se amplía solo hacia el lado libre o hacia el borde).

| Control | Hoy (visible) | Visible propuesto | Área de toque | Por qué |
|---|---|---|---|---|
| **Enviar / micrófono** | 38 | **44** | **56×56** | pulgar + en serie (Parhi 58); crece hacia el borde derecho |
| Adjuntar «+» | 38 | 42 | 52×56 | hacia el borde izquierdo |
| «Atrás» (chat y paneles) | 38–40 | 40 | **48 ancho × 56 alto, pegado al borde** | borde = ancho infinito (Fitts) |
| Cabecera (llamar, video, ⋮, perfil, grupo) | 40–42 | 42 | 48×48 con gap ≥ 6 | están en la zona difícil: área plena |
| «+» pequeño de agregar | 36 | 40 | 48 | |
| Items del menú «+» | 50 de ancho | igual | la celda completa | |
| Filas de contactos / menús | 66 de alto | igual | la fila completa | ✓ ya cumple |
| Pestañas de navegación | icono 22 + padding | igual | la columna completa, ≥ 48 de alto | |
| Celdas de juegos y stickers | — | igual | la celda (gap ≥ 4) | |

Además: `touch-action: manipulation` en todo lo tocable (sin retraso de doble toque), `user-select: none`, y
**cancelación por deslizamiento**: si el dedo se mueve más de **12 px** (touch slop de Android = 8 dp, con margen) o arranca
el scroll, el botón se «despresiona» **sin disparar** — como los botones nativos.

### 3.2 Capa 2 — Háptica placentera (tres sensaciones; nunca más que eso)
**Nativa**: un método nuevo en nuestro plugin Kotlin (`haptic({ kind })` → `webView.performHapticFeedback(constante)`), con
`navigator.vibrate` solo como suplente en navegador/simulador.

| Sensación | Cuándo | Android | Fallback (versiones viejas) |
|---|---|---|---|
| **tick** (nítido, 10–20 ms) | al **presionar** cualquier botón (`pointerdown`) | `VIRTUAL_KEY` | `KEYBOARD_TAP` |
| **confirm** (corto, un poco más presente) | **momentos de verdad**: mensaje enviado · nota de voz grabada · foto tomada · solicitud/contacto aceptado · llamada contestada o colgada | `CONFIRM` (11+) | `CONTEXT_CLICK` → `KEYBOARD_TAP` |
| **reject** (distinto, más fuerte) | error de verdad: no se pudo enviar, permiso denegado, importe inválido | `REJECT` (11+) | efecto predefinido `EFFECT_DOUBLE_CLICK` (10+) → nada |
| gesto armado | «responder» por deslizar llega al umbral · menú por pulsación larga | `GESTURE_THRESHOLD_ACTIVATE` (14+) / `LONG_PRESS` | `CONTEXT_CLICK` |
| snap | cambio de página de stickers, selectores | `SEGMENT_TICK` (14+) / `CLOCK_TICK` | nada |

Reglas: (1) **una sola sensación por gesto** — el *tick* de presionar y el *confirm* no se pisan: el *confirm* va al soltar y
solo en esos cinco momentos; (2) **nunca por píxel** de scroll o arrastre; (3) nunca dos ticks en menos de 40 ms (ráfagas);
(4) **respeta el ajuste del sistema** solo (lo hace `performHapticFeedback` automáticamente) y además un ajuste propio en
Perfil → Ajustes: «Vibración al tocar: *como el sistema* / siempre / nunca»; (5) la llamada entrante conserva su patrón largo
(es atencional: la excepción que el propio Android permite). Se **eliminan** los `vibrate(50)` zumbones de los gestos.

**Por qué así y no con una librería:** ya tenemos plugin nativo; `performHapticFeedback` es **lo mismo que usan el teclado y
los botones del propio Android**, así que el usuario ya conoce la sensación y la controla desde los Ajustes del teléfono (en
Samsung hasta la intensidad de «interacción táctil»). En un motor pobre (vivo Y03) el sistema da el mejor efecto posible o
nada — nunca un zumbido. En uno bueno (S24 Ultra) se siente como el teclado de Samsung: nítido.

### 3.3 Capa 3 — Respuesta visual «superlativa» (pero sobria)
Un motor (`src/ui/press.js`, ~150 líneas, **UN listener delegado** para toda la app — así cubre también lo que se crea por
JS) + un bloque CSS. Tres cosas a la vez, sincronizadas con el dedo:
1. **Hundirse:** `scale(0.96)` (filas y tarjetas 0.985; iconos redondos 0.92) en **≤70 ms** con `cubic-bezier(0.2, 0, 0, 1)`.
   Entra en `pointerdown`, **no** en `:active`: es la diferencia entre «responde al dedo» y «responde después».
2. **Velo + onda:** capa de estado del **10–12 %** del color del contenido y una **onda circular que nace exactamente donde
   tocaste** y llena el contorno en ~250 ms (acotada, como Material). Es lo que comunica «sé dónde tocaste».
3. **Soltar con vida:** vuelve en ~220 ms con un muelle suave (`cubic-bezier(0.34, 1.56, 0.64, 1)`, sobrepaso ~2 %), y en
   los **iconos redondos** un **«pulso NEXO»**: un anillo cian (`#00c8ff` al 25 %) que se expande de 1,0 a 1,35 y se
   desvanece en 300 ms. Sutil, de marca, una sola vez.

Detalles que hacen la diferencia: el estado presionado se **sostiene al menos 120 ms** aunque el toque sea fulminante (si no,
el ojo no lo ve); al cancelar por deslizamiento se desvanece rápido y **sin pulso**; con `prefers-reduced-motion` no hay
escala ni onda, solo el velo en 80 ms; todo con `transform`/`opacity` (GPU, sin relayout: **cero impacto en la radio**). Se
**retiran las ~25 reglas `:active` sueltas** (quedan como fallback para ratón).

**Presupuesto de tiempos** — dedo toca → +0 ms `pointerdown` → +≤10 ms clase `.is-pressed` + onda + *tick* pedido al nativo
(~10–30 ms hasta el motor) → +70 ms hundido → suelta → +220 ms recuperado → +300 ms termina el pulso. Todo dentro de las
ventanas de §2.2.

### 3.4 Qué NO va en este bloque
Sonidos de toque (pendiente #111, decisión aparte); rediseño de iconos; cambios grandes de layout.

## 4. Cómo se prueba (antes de subir, como siempre)
- **Sim (`tests/sim/press.js`)** con eventos pointer sintéticos: la clase aparece en el mismo tick del `pointerdown`; se
  sostiene ≥120 ms; cancela a los 12 px; el origen de la onda es el punto de toque; **un** tick por toque y **cero** en scroll;
  *confirm* solo en los momentos de verdad; respeta reduced-motion. **Áreas:** función pura que calcula el hit-slop de cada
  control **sin solaparse** con sus vecinos, probada con la geometría real de la barra de escribir y de la cabecera.
- **JVM:** mapeo `kind → constante` por nivel de API (fallbacks).
- **Físico (dueño):** S24 (motor bueno) y vivo (motor pobre): «¿se siente nítido o zumba?»; con «Vibración al tocar» del
  sistema apagada **no debe vibrar nada**; tocar rápido 10 veces seguidas (cero ráfagas); deslizar desde un botón (no dispara).

## 5. Plan por builds (si aprobás)
1. **Build 1:** motor visual + háptica nativa + áreas en lo más tocado (barra de escribir, cabeceras, «atrás», listas) + quitar
   los `vibrate(50)`.
2. **Build 2:** el resto (menús, hojas, cámara, juegos, stickers) + retiro de los `:active` sueltos + ajuste en Perfil.
3. **Build 3:** afinado con tu prueba (escala, intensidad, pulso sí/no).

## 6. Decisiones para tomar juntos
1. ¿**Tick al presionar en TODOS los botones**? — Recomiendo **sí**: es la sensación del teclado de Android y sigue el ajuste
   del teléfono (quien lo tiene apagado, no lo siente).
2. La lista de **momentos de verdad** con *confirm* (§3.2): ¿agregás o quitás alguno? — Recomiendo esos cinco y nada más.
3. Estilo visual: **A** onda Material sobria · **B** «pulso NEXO» cian en los iconos redondos · **C** ambos — Recomiendo **C**,
   con el pulso solo en los redondos.
4. Barra de escribir: **visible 44 + área 56** (la barra crece ~6 px) o **visible igual + solo área** — Recomiendo lo primero:
   enviar/micrófono es el botón más usado de la app.
5. Ajuste propio «Vibración al tocar» en Perfil — Recomiendo **sí**, por defecto «como el sistema».

## Fuentes consultadas hoy
- Android: [Haptics design principles](https://developer.android.com/develop/ui/views/haptics/haptics-principles) ·
  [Add haptic feedback to events](https://developer.android.com/develop/ui/views/haptics/haptic-feedback) ·
  [Haptics API reference](https://developer.android.google.cn/develop/ui/views/haptics/haptics-apis)
- Apple: [Playing haptics (HIG)](https://developer.apple.com/design/human-interface-guidelines/playing-haptics) (no renderizó;
  citas vía [uxcel](https://app.uxcel.com/courses/apple-hig/accessibility-inclusion-standards-812/audio-and-haptic-feedback-0671)) ·
  [UIImpactFeedbackGenerator.FeedbackStyle](https://developer.apple.com/tutorials/data/documentation/uikit/uiimpactfeedbackgenerator/feedbackstyle.md)
- Tamaños: [Touch Target Size for Mobile: 24px, 44pt & 48dp](https://www.weaccess.ai/blogs/mobile-touch-target-size) ·
  [WCAG 2.5.8 guide](https://testparty.ai/blog/wcag-target-size-guide) · [TetraLogical — target sizes](https://tetralogical.com/blog/2022/12/20/foundations-target-size/) ·
  [Parhi, Karlson, Bederson 2006](https://www.microsoft.com/en-us/research/?p=155150) ([UMD](https://lccd.umiacs.umd.edu/node/12181))
- Pulgar: [Hoober — How Do Users Really Hold Mobile Devices?](https://uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php) ·
  [The Thumb Zone (Smashing)](https://smashingmagazine.com/2016/09/the-thumb-zone-designing-for-mobile-users)
- Tiempos: [NN/g — Button States](https://www.nngroup.com/articles/button-states-communicate-interaction/) ·
  [Button press & :active states](https://modern-css-layouts.com/css-only-micro-interactions-animations/hover-focus-state-design/button-press-and-active-states/) ·
  [Kaaresoja, Brewster, Lantz 2014](https://www.researchgate.net/publication/263735996_Towards_the_Temporally_Perfect_Virtual_Button_Touch-Feedback_Simultaneity_and_Perceived_Quality_in_Mobile_Touchscreen_Press_Interactions) (no accesible hoy)
- Web: [MDN — Navigator.vibrate()](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/vibrate) ·
  [W3C Vibration API — implementation report](https://w3c.github.io/vibration/reports/implementation.html) ·
  [@capacitor/haptics](https://capacitorjs.com/docs/apis/haptics) · [mwc-ripple (opacidades)](https://cdn.jsdelivr.net/npm/wc-range-datepicker@1.3.0/node_modules/@material/mwc-ripple/README.md)
