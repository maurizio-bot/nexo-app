# Calendario y orden de trabajo (21-11, de la plática del dueño con Claude)

> **⚠ 21-11 noche: las fechas y el orden de abajo quedaron VIEJOS.** Mandan las «DECISIONES DEL DUEÑO 21-11 noche» de `PLAN_ENTREGA.md`: lo funcional primero (Bluetooth/zombis incluidos), una sola APK al final de lo funcional + estético, prueba cerrada de Play a más tardar el 1-12, servidor de paga lo antes posible, iOS después.

Lee este documento junto con `docs/PLAN_ENTREGA.md` y `docs/COLA.md`. Lo que aquí aparece como fecha es objetivo, no compromiso: se corre si cambian las horas o aparece un bloqueo.

## Supuestos
- Horas de trabajo del dueño: 30 a 40 por semana como mínimo (15 a 20 entre semana, 8 a 12 cada día del fin de semana). Puede trabajar más, así que las fechas pueden adelantarse.
- Navidad y fin de año bajan las horas. Se toman en cuenta del 24 de diciembre al 2 de enero.
- Hoy es sábado 21 de noviembre de 2026. El límite semanal se reinicia el domingo 22.
- Fecha fija: EDC México en febrero de 2027. La app cerrada debe funcionar igual que la abierta.

## Cadena de dependencias (ruta crítica)
Ola 0 (orden de documentos) → Ola 1 (bloqueantes) → Ola 2 y 3 (Wi-Fi Direct, tablero, Bluetooth pulido, grupos) → build de robustez → Ola 4 (auditoría) → Ola 5 (servicio nativo: app cerrada igual que abierta) → Ola 6 (servidor mínimo) → build final → prueba cerrada en tienda (12 probadores, 14 días) → EDC → lanzamiento público.

Paralelo, no bloquea a los builds:
- Nombre, identificador de paquete y logo: se deciden antes de la primera subida a tienda (no antes de programar).
- Búsqueda de marca (IMPI, Play, Galaxy Store): en paralelo con la ola 3.

## Hitos objetivo
| Hito | Fecha objetivo | Qué lo cumple |
|---|---|---|
| Ola 0: documentos ordenados e inventario único | domingo 22 o lunes 23 de noviembre | Sesión corta, lectura de PENDIENTES, ROBUSTEZ, AREAS (🔴) y COMO §8 |
| Build de robustez (olas 1 a 3) | primera semana de diciembre | Un solo build tras simulador completo y JVM en verde |
| Auditoría de seguridad (ola 4) | mediados de diciembre | Lista de hallazgos con corrección por cada uno |
| Servicio nativo, app cerrada igual que abierta (ola 5) | antes de Navidad si sobran horas; si no, primera semana de enero | Prueba real en dos teléfonos con la app cerrada |
| Servidor mínimo (ola 6) | mediados de enero | Documento de datos antes de programar |
| Prueba cerrada en tienda | empieza alrededor del 15 de enero, con 12+ probadores confirmados antes del 10 ⚠ choca con la fecha límite dura del 18-12 de PLAN_DE_BATALLA: ver la revisión al inicio de PLAN_ENTREGA.md | 14 días de prueba |
| EDC México | febrero de 2027 (fecha exacta por confirmar) | Prueba de campo con los probadores |
| Lanzamiento público | después de EDC, si la prueba cerrada sale limpia | Ficha de tienda con nombre y logo definitivos |

## Decisiones del dueño, con fecha límite
- Confirmar la fecha exacta de EDC: esta semana.
- Grupo: confirmar los supuestos de 4b (un expulsado puede volver si alguien con permiso lo agrega): antes del 1 de diciembre.
- Wi-Fi Direct: ¿grupo caliente o solo al enviar? Antes del 1 de diciembre.
- Política de datos del servidor (qué puede ver y para qué): antes del 15 de diciembre.
- Nombre, identificador de paquete y logo: antes del 15 de diciembre.
- Cuántas personas probarán 14 días (mínimo 12, según Google para cuentas personales nuevas): lista confirmada antes del 10 de enero.
- Pista de prueba o publicación pública primero: antes del 1 de enero.
- Modelo de cobro (para equipos o usuarios): después de EDC, con datos del piloto.

## Pruebas reales que faltan (las hace el dueño, cuando pueda)
- Mismo archivo por Bluetooth y por Wi-Fi Direct, con batería de los dos antes y después.
- Prueba de Bluetooth sin la app (3254).
- Videollamada de 20 min con batería al 100 % y sin cargador en los dos teléfonos, a la misma temperatura.

## Orden de trabajo para mañana (domingo 22)
0. ANTES: leer la «REVISIÓN 21-11 noche» al inicio de `PLAN_ENTREGA.md` (orden, fecha de la prueba cerrada y builds, a confirmar por el dueño).
1. Ola 0: un ayudante barato (Haiku/Sonnet) recorre `PENDIENTES.md` y `ROBUSTEZ.md` CON GREP (440 KB: nunca enteros en la sesión principal), la lista 🔴 de `AREAS.md` y la sección 8 de `COMO_TRABAJAMOS.md`.
2. Crear un inventario único (`docs/INVENTARIO.md`) con la cola, los pendientes de esos documentos y los problemas abiertos de los diagnósticos, sin repetidos.
3. Mover lo obsoleto a `docs/historial/` con fecha y motivo, y dejar en cada documento activo solo lo vigente.
4. Ola 1 (bloqueantes), con las tareas y niveles de `PLAN_ENTREGA.md`.

## Reglas
- Una sola subida con APK por ola, para no gastar 85 min de CI en cada arreglo.
- Ningún ayudante toca un archivo que esté usando otro (sobre todo `ble_connections.js`, `ble_helpers.js` y el nativo).
- Un ítem solo se marca terminado con prueba en el simulador, CI en verde y prueba real si es Bluetooth o Wi-Fi Direct.
- Si el dueño dice un hecho de una prueba real, se toma como verdadero.
