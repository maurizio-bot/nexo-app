# NEXO — Cómo trabajamos: lo que Claude ve y cómo mejorarlo

Pedido del dueño (10-11-2026), después de pedirle a Claude una opinión sin matices sobre él y sobre el desarrollo: «tienes
razón en muchos aspectos y lo reconozco […] espero me puedas apoyar buscando soluciones a problemas que yo no estoy
resolviendo […] esos análisis deberías tomarlos en cuenta y apuntarlos para pensar cómo resolverlos».

**Estado: PROPUESTAS. Nada de la sección 3 se aplica hasta que el dueño diga cuáles acepta** (se marca abajo).
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
| P2 | **Lo aburrido lo carga Claude por defecto.** La cola de `COLA_DE_PULIDO.md` y las limpiezas (textos, archivos grandes, documentación) son de Claude; al dueño solo le toca probar 2 o 3 cosas cortas | Pereza con lo aburrido | pendiente |
| P3 | **Una tarea aburrida por sesión.** Cada vez que el dueño pida algo, Claude cierra además una tarea pequeña de la cola y lo dice al final | Que lo aplazado nunca se vea | pendiente |
| P4 | **Regla de alcance:** mientras el índice de robustez esté por debajo de 70, cada función nueva grande se discute primero con una frase: ¿para quién es y qué problema resuelve? Lo que no la tenga, espera | Abarcar demasiado | pendiente |
| P5 | **Fase de simplificar** cada cierto tiempo: Claude propone una limpieza acotada (por ejemplo partir `ble_ack.js` en módulos) con pruebas antes y después, sin cambiar el comportamiento | Parches sobre parches | pendiente |
| P6 | **Más ojos humanos:** programa corto de probadores con una misión concreta por semana («mandá una foto de 5 MB», «llamá desde el sótano»), y plan de auditoría de seguridad externa | Casi único probador; falta de revisión humana | pendiente |
| P7 | **Resumen de arranque.** Al empezar cada sesión Claude muestra en 5 líneas: lo urgente, las 3 decisiones que esperan, lo que quedó probado y lo que no | Memoria entre sesiones | pendiente |

**Reglas que Claude se aplica desde ya** (corrección propia, no necesitan aprobación):
1. Antes de proponer una idea de negocio o de producto, leer lo que ya existe en los documentos.
2. Decir siempre qué está **construido y probado**, qué está **construido sin probar** y qué es solo una **idea**.
3. No llamar «automático» a algo sin decir qué tramo sigue siendo manual.
4. Ante una frase del dueño que parezca floja, preguntar antes de corregirla.

## 4. Registro (Claude lo actualiza)
- 10-11-2026: documento creado; ninguna propuesta aceptada todavía.
