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

## 7. Registro (Claude lo actualiza)
- 10-11-2026: documento creado.
- 10-11-2026: el dueño acepta P2, P3, P4 y el modelo de delegación (P8): «una tarea aburrida al día» y las preguntas ¿para qué?, ¿qué
  resuelve?, ¿para quién?. Aclara que no toma el análisis como regaño sino como crítica constructiva. Se describe como
  impulsivo con las ideas que le llegan, y pide que Claude lo guíe, lo corrija y le dé opciones.

