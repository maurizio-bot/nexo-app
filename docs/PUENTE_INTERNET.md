# Puente a internet por un NEXO cercano (idea del dueño, 13-11)

## La idea (palabras del dueño)
«Mando un mensaje y no tengo internet: sale por Bluetooth a alguien cercano que sí tiene, ese lo sube al buzón y le
llega a mi contacto; la respuesta vuelve por la misma ruta». Solo mensajes: nada de llamadas ni videollamadas.

Y la red: «si el teléfono que hizo de puente ya no está para el regreso, ya no me van a encontrar; hay que rastrear al
menos dos opciones más». La triangulación por ubicación quedó descartada (decisión 13-11, con el dueño):
- no ayuda a entregar: hace falta alguien a pocos metros, y eso ya lo dice el Bluetooth;
- habría que mandar la ubicación a teléfonos ajenos;
- NEXO declara a Google que no usa el Bluetooth para ubicar (`neverForLocation` en el manifiesto).

## Cómo quedó (parte 1, build 3036)
- **El teléfono sin internet (A) usa al vecino con internet (B) como si fuera un relé más.**
  - Para `net_link.js` es una conexión de relé «virtual» (clave `gw:<nexoId de B>`). Su «socket» manda cada frame
    NIP-01 por Bluetooth (o Wi-Fi local) a B.
  - B abre su propia conexión a uno de SUS relés y pasa los frames en los dos sentidos (`src/net/gw_link.js`).
- **Todo lo demás sigue igual por encima:**
  - el sobre va cifrado para el contacto (B no lo puede leer);
  - el ✓ es «un relé lo guardó» y el ✓✓ vuelve cuando lo confirma el contacto;
  - el saludo dice «en línea»;
  - el «toque» que despierta al contacto también lo pide el puente.
- **Hasta 3 puentes a la vez**, cada uno a un relé distinto si se puede. Así el mensaje queda en más de un relé.
- **«Recoge lo mío»:** la respuesta queda en MI buzón de los relés, no en el puente. Cualquier NEXO con internet que
  esté cerca me la baja, porque la suscripción a mis etiquetas va por él. Si el puente de la ida se fue, otro la recoge.
- **Un contacto con Bluetooth directo listo** sigue yendo por su Bluetooth, no «por internet» a través del Bluetooth de
  otro (`canReach` en modo puente).
- **Por el puente no pasan fotos ni archivos** (`net.gwOnly()`: `filesOk` y `mailboxFilesOk` dan no). Quedan ⏳ hasta
  tener internet propio o un camino directo.
- **Vuelve el internet propio** (5 s seguidos): se sueltan los puentes.

## Límites del que presta
- **Qué deja pasar** (`gwAllowUp`):
  - solo eventos de mensajes privados (kind 1059), firmados y de tamaño de texto;
  - su suscripción (kinds 1059 y `#p`);
  - la comprobación de relé, AUTH (NIP-42) y CLOSE.
  - Nada de «tráeme todo» ni del buzón de archivos.
- **Topes:** 40 eventos por minuto por sesión, 1500 por día por teléfono, 4 sesiones a la vez y una por teléfono. Una
  sesión se cierra a los 10 min sin actividad.
- **Cuándo no presta:** solo con la batería baja (regla de Jump). **Sin interruptor** (dueño 13-11: «si alguien escoge
  NEXO es para estar comunicado, no para romper esa red»): todo NEXO con internet presta el suyo, con estos topes.
- **Cuándo funciona:** el que presta tiene que tener la app viva (a la vista o en segundo plano sin congelar). Con la
  app congelada no contesta y A suelta ese puente. El nativo ignora estos paquetes (`BgInbox` → IGNORE).

## Paquetes (`{v:1, type:'ig', op, from, s, …}`)
| De A a B | De B a A |
|---|---|
| `q` ¿me prestas internet? | `a` sí (u: relés que uso) / no (u: []) |
| `o` abre la sesión s con el relé u | `k` abierta (ok:1) / no (ok:0) |
| `f` frame para el relé (d) | `e` frame del relé (d) |
| `c` cierra la sesión | `x` la sesión se cerró |
| `w` «toque» FCM al token t | — |

## Prueba
`tests/sim/puente.js`, con cuatro teléfonos: A sin internet; B1 y B2 cerca y con internet; C lejos, solo con internet.
Comprueba:
- el filtro;
- que A tenga 2 puentes;
- que B2 (Bluetooth directo) no vaya «por internet»;
- A → C con ✓✓;
- C → A;
- que, si B1 se va, siga por B2 en los dos sentidos;
- que los puentes no ven los textos ni pasan archivos.

Contraprueba con la build 3035: nada llega.

## Parte 2 (3043): el regreso cuando el puente de la ida ya se fue
La pregunta del dueño: «si el teléfono que hace de puente ya no está para el regreso, ya no me van a encontrar».

Lo que se vio al probarlo (contraprueba con la 3042):
- **La ida ya funcionaba con desconocidos.** Al mandar sin internet, Jump busca camino y se conecta «de paso» con
  los NEXO cercanos (aunque no sean contactos); la parte 1 les pregunta si tienen internet y el texto sale.
- **El regreso no.** Si ese puente se iba y yo no tenía nada pendiente, nadie buscaba otro: la respuesta se quedaba
  en MI buzón de los relés hasta que yo volviera a mandar algo.

Qué hace la 3043 (`gw_link.js`, `_seekStrangers`): sin internet propio y sin ningún vecino conectado que preste el
suyo, se prueba con NEXO desconocidos cercanos (los 2 de mejor señal; si no hay nadie visto en el último minuto,
escanea primero):
- cada 30 s si hay algo mío esperando (Jump buscó camino para un mensaje mío hace menos de 3 min);
- cada minuto durante 30 min después de usar un puente (espero respuestas);
- cada 10 min si no (para recoger lo mío sin gastar radio en un apagón general, donde nadie tiene internet).

Por teléfono rige además la espera por fallos de Jump (1, 2, 4… hasta 15 min con uno que no conecta; nada a −90 dBm
o peor). La conexión de paso que hace de puente no se cierra por falta de uso mientras presta internet.

Prueba `puente2.js`: A sin internet ni contactos cerca; sin nada pendiente no toca a nadie; manda y sale por un
desconocido S; S se va, C contesta y otro desconocido T que pasa cerca le recoge la respuesta (15 s). Contraprueba
3042: la respuesta sin S no llega.

**Se deja (por ahora) «puentes que GUARDAN la respuesta»:** con «recoge lo mío» por cualquier puente, la respuesta
ya espera en los relés (cifrada, solo para mí) y la recoge cualquier NEXO con internet que pase cerca. Guardarla
además en el teléfono del puente solo ayudaría si ese mismo teléfono me vuelve a ver SIN internet, y obliga a
que los puentes guarden mensajes ajenos. Se retoma si las pruebas del dueño lo piden.

## Falta (parte 3)
- **Parte 3:**
  - fotos pequeñas por el puente;
  - indicador «por puente» en el chat.
- Cambiar la etiqueta del buzón cada cierto tiempo, para que un puente no sepa qué buzón es de quién.
