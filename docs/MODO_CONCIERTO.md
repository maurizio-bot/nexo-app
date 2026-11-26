# Modo concierto — diseño acordado con el dueño (25-11-2026 noche, México)

**Estado: DISEÑO CERRADO, SIN EMPEZAR.** Antes de programar nada, leer esto entero. Si algo no está aquí, se pregunta al dueño.
Meta: EDC México (feb 2027). Es lo que diferencia a NEXO: tiene que funcionar perfecto la primera vez que alguien lo usa en un concierto.

## Por qué (lección del 25-11)
La 3345 («Buscar a X entre la gente» en el menú de CUALQUIER chat) se hizo sin consultar y tiene tres fallos de fondo:
sin modo que activar; cualquier contacto podía hacer vibrar tu teléfono aunque tuvieras el chat silenciado (iglesia, hospital, junta);
y era una herramienta de rastreo sin consentimiento (un ex que siga en tus contactos te podía seguir). **No debe salir así.**
Su código (`find_near.js` medición de señal/distancia/rumbo; `find_ui.js` pantalla) se REUTILIZA dentro del modo concierto.

## Decisiones del dueño
1. **Es un modo que se activa.** Sin activar, no existe: ni buscar ni ser buscado.
2. **Dónde:** «Nuevo grupo» → en su menú un interruptor **apagado por defecto**, «Modo concierto» con su descripción debajo
   (texto bonito; idea: «Tú y los integrantes del grupo podrán buscarse entre la gente mientras dure el grupo»).
   El menú de «Nuevo grupo» hay que mejorarlo de paso (el dueño: «se ve muy feo»).
3. **Doble aviso:** al encender el interruptor sale un **letrero amarillo aparte** que lo repite («Estás activando el modo concierto: las
   personas que agregues podrán buscarte y tú a ellas durante …»). Quien no leyó la descripción, lee esto.
4. **Elegir y crear:** se eligen las personas → «Crear grupo» → a cada una le llega una **invitación** (con el mismo aviso amarillo) que
   acepta o rechaza. Nadie entra a la fuerza. Con que acepte UNA, el grupo existe (de 2). Se reutilizan las invitaciones de grupo (24-11).
5. **Duración del grupo:** 12 h como máximo, **renovable**. Al vencer se acaba solo. Cualquiera puede salirse cuando quiera (corta al instante).
6. **Dentro del grupo cualquiera busca a cualquiera SIN pedir permiso cada vez** (en un concierto no se oye ni se siente el teléfono;
   el consentimiento se dio al aceptar). Cualquiera puede también pedir que lo busquen.
7. **Quien es buscado lo ve reflejado en su teléfono** (aviso fijo y silencioso «Ana te está buscando»; no tiene que hacer nada).
8. **Una búsqueda dura 20 min** (batería) y termina por tiempo o **al encontrarse**: los dos teléfonos se detectan muy cerca por
   Bluetooth → «¡Ya lo encontraste! ¿Terminar la búsqueda?» (como «Llegaste» de Google Maps).
9. Lo técnico, a criterio de Claude; la triangulación con desconocidos, NO (ver abajo).

## Reglas contra el abuso (propuestas por Claude, aceptadas)
- Recíproco: solo busca quien también puede ser buscado (está en el grupo con el modo).
- Transparente: el buscado siempre lo sabe (punto 7).
- Sin historial: al terminar la búsqueda no queda ninguna ubicación guardada. Nunca a un contacto bloqueado (sale del grupo).
- Todo vence solo (grupo 12 h, búsqueda 20 min).

## Lo que vive el usuario
Nuevo grupo → enciende «Modo concierto» → aviso amarillo → elige amigos → Crear → ellos aceptan (aviso amarillo) → en el concierto se
separan → abre el grupo → toca al amigo → «Buscar» → de lejos: distancia y flecha; de cerca: señal (muy cerca / cerca / lejos y
«te acercas / te alejas») → «¡Ya lo encontraste!».

## Cómo se hace (técnico)
- **De cerca (≈ 30–80 m): señal Bluetooth** del teléfono buscado (mediana de 4 s, niveles y tendencia: `find_near.js`, ya hecho). Funciona
  con la app cerrada y el teléfono en el bolsillo (el servicio nativo sigue anunciando). Durante la búsqueda, el buscado anuncia más seguido.
- **De lejos: GPS del buscado, que su teléfono manda SOLO** cada ~15 s mientras lo buscan. **Pieza grande que falta: en el NATIVO**
  (el buscado tendrá la app congelada; hoy la ubicación solo la manda la app abierta). Cifrada, solo a quien lo busca, solo durante la búsqueda.
- **Camino:** internet si hay; en un concierto los datos se saturan, así que también por saltos entre teléfonos NEXO (Jump).
- **Fin al encontrarse:** «muy cerca» sostenido ~10 s en los dos lados.
- **Batería:** solo los 20 min de búsqueda suben Bluetooth y GPS; fuera de la búsqueda el grupo no gasta nada.
- **Fase 2 (en vez de triangulación):** si OTRO miembro del mismo grupo (nunca desconocidos) ve al buscado por Bluetooth, cuenta como
  «visto cerca de Luis hace 1 min» y marca la zona.

## Qué cambia de la 3345
Se quita «Buscar a X» del menú de los chats normales y la reacción a 'fnd' fuera de un grupo de concierto activo; «hacer sonar» deja de
mandar mensaje con sonido y pasa a ser el aviso silencioso del punto 7; la ubicación ya no la comparte el usuario a mano: la manda su
teléfono mientras lo buscan dentro del grupo. Lo nuevo: interruptor y avisos, grupo con vencimiento, envío nativo de ubicación,
«¡Ya lo encontraste!».

## Decisiones del dueño (25-11 noche, 2.ª parte)
10. **Una sola forma de crear grupo.** Se quitan los dos botones «Todos participan» / «Personalizado» del principio (los pidió el dueño el
    23-11; ahora ve que «Personalizado» con todo en «Todos» es el grupo normal). Todo empieza en «todos pueden todo»; quien quiera
    otra cosa la ajusta (las mismas opciones ya existen en «Ajustes del grupo»).
11. **Una sola pantalla «Nuevo grupo»**, de arriba abajo: interruptor «Modo concierto» (arriba, apagado, con descripción; al encenderlo el
    aviso amarillo) → nombre («Grupo N» por defecto) → contactos con la MISMA estética de la lista de contactos (foto, nombre, colores y
    letra; palomita a la derecha) → «Crear grupo». El menú de ahora se ve aparte de la app: incongruente.
12. **El modo concierto es un INTERRUPTOR del grupo, no otro tipo de grupo.** A las 12 h se apaga solo el modo; el grupo, sus mensajes y sus
    integrantes se quedan como grupo normal. Se vuelve a encender para otro concierto.
13. **También en un grupo que ya existe** (dueño: «si los amigos ya tienen su grupo, no tienen por qué hacer otro»): se enciende desde sus
    ajustes y a cada integrante le llega la invitación con el aviso amarillo; solo quien acepta entra al modo.

## Decisiones del dueño (25-11 noche, 3.ª parte; lo demás de Claude, aceptado «en general»)
14. **Permisos al crear: NO aparecen** (opción B): el grupo nace «todos pueden todo»; se cambia después en «Ajustes del grupo».
15. **Encender el modo en un grupo existente: cualquier integrante**; cada uno acepta o no con el aviso amarillo.
16. **Renovar las 12 h: cada quien la suya.** ~15 min antes: «¿Sigues en modo concierto?»; si no contesta, se le apaga solo a él.
17. **Salirse solo del modo, cuando quiera, sin salirse del grupo** (dueño: de 5 amigos, 2 se van antes): botón claro «Salir del modo
    concierto» en el grupo; deja de poder buscar y de ser buscado al instante; el chat del grupo sigue igual.
18. **El buscado ve «Ana te está buscando»** (silencioso). CORREGIDO por el dueño: NADA de «Ya voy» (si los dos se mueven no se encuentran)
    ni «Ya no me busques» (no tiene sentido si te buscan). Respuestas rápidas que el usuario completa: **«Estoy cerca de …»** (estoy aquí,
    ven), **«Te veo en …»** (punto de encuentro) y **«Me quedo aquí»** (uno se queda quieto y el otro va; aceptada). Son TRES botones y
    debajo la barra para escribir un mensaje distinto.
19. **Se puede buscar a alguien del grupo que no es tu contacto** (aceptó el modo en ese grupo).
20. **Vista «¿Dónde están todos?»**: con el modo activo, junto al nombre de cada integrante una **esfera de color** (nada de metros ni de
    «niveles de señal»: la gente normal no lo entiende). Del más cercano al más lejano:
    🔵 azul = juntos · 🟢 verde = cerca · 🟡 amarillo = intermedio · 🔴 rojo = muy lejos · ⚪ gris = no se le alcanza (no se detecta).
    **Qué guía en cada color (dueño 25-11, cerrado):** 🔴 rojo = lejos, guía el **GPS** (flecha con brújula y distancia; de cerca el error
    del GPS, 5–15 m, es mayor que la distancia y la flecha gira sin sentido); 🟡 amarillo, 🟢 verde y 🔵 azul = guía el **Bluetooth**
    (la pantalla dice «ya está cerca: sigue el color»). ⚪ gris = ni Bluetooth ni ubicación. En la vista de todos (sin búsqueda) los colores
    salen solo del Bluetooth (sin gasto); el rojo por GPS aparece en una búsqueda. Medir en campo qué señal y qué distancia es cada color.
    El Bluetooth no da dirección (solo más cerca / más lejos); la dirección es del GPS + brújula. Brújula: los altavoces grandes la desvían
    cerca del escenario → si no responde bien, pedir «mueve el teléfono en forma de 8» (como Google Maps).
21. **Mapa: NO** (dueño: los conciertos son espacios abiertos, no aporta; y sin internet habría que descargarlo). **Radar: SÍ, 2.ª fase**:
    círculo con uno en el centro y cada integrante como punto de su color en su dirección y lejanía (mismos datos que la flecha).
    La pantalla de búsqueda usa los MISMOS colores (hoy `find_ui.js` usa naranja/ámbar/cian/verde: cambiarlos).

## Riesgo técnico a resolver primero (Claude, 25-11)
- **Google Play y la ubicación:** mandar la ubicación con la app cerrada suele exigir ubicación en SEGUNDO PLANO (Google la revisa con lupa,
  pide justificación y a veces video). Camino más limpio a estudiar: arrancar el servicio con permiso de ubicación EN EL MOMENTO de activar
  el modo (app abierta: Android lo permite y lo conserva mientras el servicio vive) y pedir GPS solo durante los 20 min de una búsqueda.
  Esto decide si Google pone trabas: revisarlo antes de programar lo nativo.
- **Cómo se comunica:** «encontrarte con tus amigos», nunca «rastrear» (usuario y tienda).

## Abierto
- Texto final de la descripción y del aviso amarillo (lo ve el dueño).
- Rediseño del menú de «Nuevo grupo».
