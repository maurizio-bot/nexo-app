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

## Abierto
- Texto final de la descripción y del aviso amarillo (lo ve el dueño).
- Rediseño del menú de «Nuevo grupo».
