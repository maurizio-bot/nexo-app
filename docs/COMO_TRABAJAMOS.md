# NEXO — Cómo trabajamos: lo que Claude ve y cómo mejorarlo

Pedido del dueño (10-11-2026), después de pedirle a Claude una opinión sin matices sobre él y sobre el desarrollo: «tienes
razón en muchos aspectos y lo reconozco […] espero me puedas apoyar buscando soluciones a problemas que yo no estoy
resolviendo […] esos análisis deberías tomarlos en cuenta y apuntarlos para pensar cómo resolverlos».

**Estado (10-11): el dueño aceptó P2, P3, P4 y el modelo de delegación (P8, secciones 5 y 6). P1 y P5 a P7 siguen pendientes de su OK;
lo pendiente no se aplica** (se marca en la tabla).
**Instrucción para Claude en cada sesión:** leer este documento después de `ESTADO.md`, aplicar lo aceptado, no aplicar lo
no aceptado, y actualizar la sección 4.

## 1. Lo que el dueño reconoce (sus palabras)
- Se aburre con lo que no le interesa y lo aplaza por pereza; sabe que debería tener más disciplina con eso.
- Tiene muchos pendientes atrasados que «sí o sí se tendrán que ver».
- Le gusta este tipo de análisis porque le muestra dónde mejorar. Quiere que Claude lo apoye con soluciones.

## 2. Lo que Claude observa (resumen de la opinión dada el 10-11)
**Del dueño**
- Fortalezas: constancia (desde dic-2025), disciplina de método (no subir sin batería en verde, no afirmar sin comprobar),
  buen olfato de producto (usuario primero, no premiar invitaciones, el diagnóstico automático), franqueza.
- Puntos débiles: abarca demasiado a la vez; lo que no le emociona se aplaza (limpiar, simplificar, publicar); decisiones
  suyas pendientes que tardan semanas; casi único probador; poca experiencia comercial (lo reconoce).

**Del desarrollo**
- Ancho contra hondo: llamadas de grupo, juegos, pagos, stickers, Stream, Fénix, Jump y Tor, con una entrega que sigue en
  62,5 de 110 de índice de robustez.
- Parches locales sobre archivos grandes: unas 32.000 líneas en `src`; el mayor, `ble_ack.js`, ronda las 2.500 líneas y
  `ble_messages.js` las 1.500.
- Simulador contra realidad: lo importante lo han encontrado los diagnósticos de teléfonos reales, no el simulador.
- Seguridad: un mensajero cifrado hecho por una persona y una IA sin revisión de un experto humano. Hace falta auditoría
  externa antes de vender a empresas (ya figura en `PLAN_NEGOCIO.md`).
- Memoria: Claude no recuerda entre sesiones; todo vive en estos documentos.
- Uso: poco uso real, poca comunicación de los usuarios, poco testeo físico (ver `PENDIENTES.md` ⭐).

**De Claude (sus propias fallas, para corregirlas)**
- Afirmó cosas sin comprobar: que el diagnóstico era automático de punta a punta (el último tramo era copiar y pegar) y que
  unas ideas eran nuevas cuando ya estaban en `PLAN_NEGOCIO.md`.
- Leyó mal una frase del dueño y lo subestimó.
- Tiende a arreglar casos sueltos en vez de mirar el conjunto, y a escribir de más.

## 3. Propuestas (el dueño marca cuáles acepta)
La idea de fondo: **el aburrimiento no se arregla con fuerza de voluntad, se rodea con un sistema.**

| # | Propuesta | Qué problema ataca | ¿Aceptada? |
|---|---|---|---|
| P1 | **Decisiones con plazo y valor por defecto.** Cada decisión pendiente del dueño se lista con una recomendación de Claude y una fecha. Si pasa la fecha sin respuesta, se aplica la recomendación (salvo en seguridad, dinero o cosas irreversibles, donde nunca se asume) | Decisiones que esperan semanas | pendiente |
| P2 | **Lo aburrido lo carga Claude por defecto.** La cola de `COLA_DE_PULIDO.md` y las limpiezas (textos, archivos grandes, documentación) son de Claude; al dueño solo le toca probar 2 o 3 cosas cortas | Pereza con lo aburrido | **aceptada 10-11** |
| P3 | **Una tarea aburrida por sesión.** Cada vez que el dueño pida algo, Claude cierra además una tarea pequeña de la cola y lo dice al final | Que lo aplazado nunca se vea | **aceptada 10-11** |
| P4 | **Regla de alcance:** mientras el índice de robustez esté por debajo de 70, cada función nueva grande se discute primero con una frase: ¿para quién es y qué problema resuelve? Lo que no la tenga, espera | Abarcar demasiado | **aceptada 10-11** |
| P5 | **Fase de simplificar** cada cierto tiempo: Claude propone una limpieza acotada (por ejemplo partir `ble_ack.js` en módulos) con pruebas antes y después, sin cambiar el comportamiento | Parches sobre parches | pendiente |
| P6 | **Más ojos humanos:** programa corto de probadores con una misión concreta por semana («mandá una foto de 5 MB», «llamá desde el sótano»), y plan de auditoría de seguridad externa | Casi único probador; falta de revisión humana | pendiente |
| P7 | **Resumen de arranque.** Al empezar cada sesión Claude muestra en 5 líneas: lo urgente, las 3 decisiones que esperan, lo que quedó probado y lo que no | Memoria entre sesiones | pendiente |
| P8 | **Modelo de delegación («CEO y ejecución»).** El dueño decide lo importante; Claude ejecuta y decide lo pequeño; Claude además guía: corrige, da opciones y frena con una pregunta cuando llega una idea impulsiva | Perder la visión completa por ideas que llegan de repente | **aceptada 10-11** |

**Reglas que Claude se aplica desde ya** (corrección propia, no necesitan aprobación):
1. Antes de proponer una idea de negocio o de producto, leer lo que ya existe en los documentos.
2. Decir siempre qué está **construido y probado**, qué está **construido sin probar** y qué es solo una **idea**.
3. No llamar «automático» a algo sin decir qué tramo sigue siendo manual.
4. Ante una frase del dueño que parezca floja, preguntar antes de corregirla.

## 4. Reparto de decisiones (modelo de delegación aceptado el 10-11)
Dicho por el dueño: «en una empresa grande hay un CEO que toma las decisiones importantes y lo demás lo delega; yo me dedicaría a
decidir y tú a la ejecución; y tú también estás para corregirme y darme opciones».

| Quién | Qué |
|---|---|
| **Decide el dueño** | Dirección del producto y del negocio; dinero y precios; nombre y marca; país; publicar en tiendas; qué datos se recogen de las personas y cómo se avisa; cambios de diseño en seguridad o cifrado; aceptar un riesgo; cualquier cosa pública o irreversible |
| **Claude propone y el dueño aprueba con una palabra** | Funciones nuevas; cambios que el usuario nota mucho; cambios de protocolo (afectan a versiones viejas); permisos o envíos de datos nuevos; abrir salida de red del entorno de Claude |
| **Claude decide y avisa después** | Arreglo de fallos; pulido visual menor; textos y traducciones; pruebas; limpiezas sin cambio de comportamiento con la batería en verde; documentación; el orden de la cola de pulido |

**Formato de las decisiones para el dueño** (para que decidir sea barato): una línea de qué hay que decidir, 2 o 3 opciones, la
recomendación de Claude y qué pasa si se espera. El dueño contesta con una letra. Claude no empuja decisiones que no sean suyas.

**Límite honesto:** Claude ejecuta pero no es infalible. Lo delegado se comprueba con la batería, con las pruebas cortas del
dueño en su teléfono y, para seguridad, con una auditoría humana externa.

## 5. Estacionamiento de ideas (para las ideas que llegan de repente)
La idea no se descarta ni se construye al momento: **se anota en `docs/IDEAS.md` con tres preguntas** (¿para quién?, ¿qué
problema resuelve?, ¿cómo sabremos que funcionó?), Claude da su opinión y una opción de tamaño, y el dueño decide si pasa a la
cola, se pospone o se descarta. Si el dueño dice «urgente», se hace primero sin trámite.

## 6. Una tarea aburrida al día
Aceptada. Mientras no haya sesión automática, Claude cierra **una tarea de `COLA_DE_PULIDO.md` en cada sesión** y lo dice al
final. Falta decidir si se programa una sesión diaria que lo haga sola (ver la decisión D1 en `ESTADO.md`).

## 8. Modo adelanto (autorización permanente del dueño, 10-11-2026)
Dicho por el dueño: «cuando yo estoy ocupado y no puedo estar contigo, tú te adelantas con cualquier pendiente que tengas que
resolver; así avanzamos sí o sí. Si algo requiere demasiados tokens, me lo preguntas primero. Si estamos llegando al límite de una
sesión y me voy a dormir, ese tiempo se perdería: tomas la delantera y lo aprovechas hasta donde se pueda».

**Cuándo se activa:** el dueño dice que se va, que está ocupado o que se duerme; o la sesión va a cerrarse por el límite y el
tiempo se perdería. No hace falta que lo repita cada vez.

**Qué se hace, en este orden:**
1. Las tareas de la sección A de `COLA_DE_PULIDO.md`.
2. Pendientes que el reparto de decisiones (§4) marca como «Claude decide y avisa después».
3. Preparar, sin decidir, lo que es del dueño: diseño, borradores, pruebas y las opciones con recomendación, para que decida con
   una letra.

**Límites (cambiables por el dueño):**
- **Tamaño:** solo tareas pequeñas o medianas (cabe una batería completa). Las grandes se dejan preparadas y se le preguntan
  primero; si el dueño no puede contestar, no se empiezan.
- **Entrega:** solo se sube con la batería en verde, como siempre. Las tareas «Claude decide» van directo a `NEXOCHAT`; lo que
  sea «Claude propone» espera en la rama `pulido` hasta que el dueño diga «mézclala». Cuando exista el actualizador
  automático, TODO lo que llegue a `NEXOCHAT` pasará antes por esa rama.
- **Si algo falla o se complica:** se detiene, se anota en `ESTADO.md` y no se fuerza nada.
- **No se toca sin el dueño:** dinero, marca, publicar, datos de usuarios, cifrado y seguridad, nada irreversible, ni abrir salida
  de red del entorno de Claude.
- **Informe al volver:** cinco líneas: qué se hizo, qué quedó, qué necesita su decisión y qué probar.

**Reloj de ausencia (idea del dueño, 10-11): para cuando no puede avisar que se va.** Claude no siente pasar el tiempo entre
turnos, así que lo mide con un mensaje programado:
1. Al terminar cada respuesta, Claude programa con `send_later` un aviso para dentro de **5 minutos** (valor inicial; el dueño
   puede cambiarlo) y guarda su identificador en el espacio temporal (`reloj_ausencia.id`).
2. Si el dueño escribe antes, Claude borra ese aviso al empezar su turno y programa uno nuevo al terminar.
3. Si el aviso llega y **no hay ningún mensaje del dueño posterior a mi última respuesta**, el dueño está ausente: Claude entra en
   modo adelanto (arriba), toma la primera tarea sin hacer de la sección A de `COLA_DE_PULIDO.md`, la termina con el método de
   siempre y programa otro aviso. Si sí hubo un mensaje del dueño, ignora el aviso.
4. El dueño puede decir **«sin adelanto»** para apagarlo en esa sesión, o **«estoy aquí»** para posponerlo.
5. Costes y límites: cada aviso que dispara un turno gasta tokens aunque no haga nada, por eso se borra el pendiente cuando el
   dueño vuelve. Si el dueño tarda en escribir mensajes largos y Claude empieza a trabajar mientras tanto, su mensaje llega igual
   a mitad de la tarea y Claude lo atiende; si interrumpe demasiado, se sube el plazo. Si la sesión se cierra por el límite de
   uso, el aviso puede no entregarse: no está probado.

**Cómo funciona (honesto):**
1. *Dentro de la sesión abierta:* si el dueño dice «me voy», Claude sigue trabajando la cola mientras queden recursos.
2. *Sesión programada:* Claude puede programar una continuación (por ejemplo cuando se reinicie el límite). Se prueba una noche
   y se compara.
3. *Lo que Claude no sabe:* cuánto le queda al plan del dueño ni cómo cuenta una sesión programada. Por eso se empieza con una
   sola tarea por noche y se ajusta con lo que se vea.

## 7. Registro (Claude lo actualiza)
- 10-11-2026: documento creado.
- 10-11-2026: el dueño acepta P2, P3, P4 y el modelo de delegación (P8): «una tarea aburrida al día» y las preguntas ¿para qué?, ¿qué
  resuelve?, ¿para quién?. Aclara que no toma el análisis como regaño sino como crítica constructiva. Se describe como
  impulsivo con las ideas que le llegan, y pide que Claude lo guíe, lo corrija y le dé opciones.
- 10-11-2026: el dueño autoriza de forma permanente el **modo adelanto** (§8) y señala que esto debió ofrecerse desde el principio;
  Claude lo reconoce. La decisión D1 queda resuelta con el esquema mixto de §8.
- 10-11-2026: el dueño pide medir la ausencia sin que tenga que avisar: pasados 5 minutos sin respuesta, Claude empieza con la cola.
  Se implementa como «reloj de ausencia» (§8) con mensajes programados de la sesión; primera prueba real ese mismo día.

