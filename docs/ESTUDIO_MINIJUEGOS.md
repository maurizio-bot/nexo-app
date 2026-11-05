# NEXO — Estudio a profundidad de minijuegos (qué engancha de verdad y qué construir)

> **Pedido del dueño (05-11-2026):** los juegos elegidos antes (Conecta 4 + piedra-papel-tijera) lo dejaron
> perplejo. Quiere (a) un **estudio a profundidad de minijuegos actuales de alta dependencia** —los que se
> siguen jugando seguido y de forma adictiva— y (b) una **lista de contactos con puntuaciones** para fomentar
> la competencia.
>
> **Honestidad sobre los datos:** casi no hay estudios serios (revisados por pares, causales) de retención en
> juegos. La mayoría de las cifras vienen de blogs de las propias empresas (reportadas de segunda mano) o de
> proveedores. Abajo marco lo sólido vs. lo débil. La conclusión **no** depende de las cifras finas: depende de
> patrones que se repiten en todas las fuentes. Al final hay fuentes.

---

## 0) Resumen ejecutivo (si leés una sola cosa, es esto)

1. **Lo más adictivo y duradero no es un juego: es un bucle.** Dos bucles ganan sobre todo lo demás y —esto es
   lo importante— **los dos encajan en NEXO sin servidor**:
   - **El reto diario** (modelo *Wordle*): un desafío por día, racha, y resultado que se comparte sin spoilers.
   - **El turno asíncrono «te toca»** (modelo *Words With Friends* / *GamePigeon* de iMessage): jugás contra un
     contacto, cada jugada es un mensaje, y volvés **porque del otro lado hay una persona**, no un sistema.

2. **La ventaja única de NEXO:** en esos dos bucles, *el motivo de volver es una persona real* y **se puede
   jugar sin internet y cifrado** (en un concierto, el metro, un apagón). Eso **no lo tiene nadie**:
   WhatsApp/iMessage/Telegram necesitan señal y servidores. Es nuestro ángulo.

3. **Lo que colapsa (NO copiar):** los juegos *tap-to-earn* de Telegram (Hamster Kombat, Notcoin) explotaron a
   cientos de millones y **perdieron el 85 % de usuarios en 3 meses**. Enganchan por premio en cripto, no por
   jugar. Además chocan con la regla del dueño (nada de cripto). **Moda, no retención.**

4. **El marcador que pediste es correcto y, encima, es nuestro mejor diseño de ranking sin servidor:** el
   resultado de una partida 1-contra-1 lo **firman los dos teléfonos** (ambos la presenciaron), así que **no se
   puede falsear solo**. Un puntaje de un juego en solitario, en cambio, cualquiera lo inventa. → El ranking
   entre contactos se arma con **récords cabeza a cabeza firmados por ambos**, no con puntajes auto-reportados.

5. **Piedra-papel-tijera: tu instinto es correcto, es demasiado flaco.** Conecta 4 **sí sirve**, pero como *uno
   de varios* en un salón de juegos por turnos, no como estrella.

**Recomendación en una línea:** construir el **salón de juegos por turnos** (reusando el motor del tres en raya)
con **Conecta 4 + Gomoko + Damas**, encima un **Reto diario** (Wordle en español) con racha compartida, y atar
todo a un **ranking entre contactos** con récords firmados por ambos. Detalle y orden en §5–6.

---

## 1) Qué hace que un juego «se pegue» (las mecánicas, y el límite ético)

NEXO ya decidió: **nada de anuncios, cajas de botín, moneda comprable ni pay-to-win** (doc de monetización).
Eso nos deja las mecánicas *sanas*, que por suerte son también las que mejor encajan con una app P2P.

| Mecánica | Qué hace | Fuerza de la evidencia | ¿Sana o patrón oscuro? |
|---|---|---|---|
| **Turno asíncrono «te toca»** | Volvés porque un amigo movió; reciprocidad real | Media (lo social es el mejor predictor de permanencia en varios estudios) | **La más sana para NEXO**: el aviso es de una persona, no fabricado |
| **Reto diario + escasez** | Un puzzle por día; «volvé mañana»; nunca es grind | Débil en cifras, pero patrón universal (Wordle) | **Sana**: tiene final natural, respeta tu tiempo |
| **Racha (streak)** | Aversión a perder lo acumulado | Débil-media (correlación, no causa) | **Sana** si es amable (perdón/freeze, sin culpa); **oscura** si hay shaming o «tu racha va a morir» |
| **Comparación social / ranking** | Competir contra otros te hace volver | Media (Duolingo Leagues: D1 +1 %, D7 +2 %, D14 +3 % — su única cifra *propia*) | **Sana** en grupos chicos de amigos con reinicio semanal; **oscura** si humilla al último o castiga con descensos |
| **Elo / escalera** | Sensación de progreso medible | Hipótesis (sin cifras verificadas) | Sana si **no castiga** (rango que no baja o decae suave) |
| **Recompensa variable** | El clásico «Skinner box» | Media en tragaperras, débil en juegos de habilidad | **Oscura** si es azar-con-premio atado a dinero; sana si la variedad viene de la habilidad/el rival |
| **Notificaciones** | Traen de vuelta | Correlacional y auto-seleccionado | Sana: **solo por hecho real** (tu contacto movió/te retó); oscura: recordatorios inventados, nocturnos, con culpa |

**Prueba ética simple (criterio nuestro):** ¿el jugador estaría de acuerdo si viera cómo funciona la mecánica?
¿Puede **parar sin castigo**? ¿Gana *la persona* o gana *la métrica*? Si falla alguna, es patrón oscuro.

**Las 4-5 mecánicas a usar (sanas y de alto impacto):** turno asíncrono «te toca» · reto diario compartido ·
racha **de pareja** con perdón · marcador/Elo privado cabeza a cabeza · avisos solo por evento real.
**A evitar:** cajas de botín, azar-con-premio, moneda comprable, racha con culpa, FOMO con cuenta atrás,
descensos que castigan, near-miss simulados, notificaciones inventadas.

---

## 2) Qué se juega hoy: lo que DURA vs lo que es MODA (2024-2026)

Ranking por **durabilidad de la retención** (de más a menos), con escala aproximada y veredicto:

1. **Puzzles diarios del NYT (Wordle, Connections, Strands, Spelling Bee)** — Wordle ~**11,5 M jugadas/día**
   (en baja lenta desde su pico; el NYT hasta hará una serie de TV para recuperar lapsos). Connections ~9 M/día.
   Sesión ~3-10 min, 1 vez/día. **Durable.** El bucle *diario + racha + resultado compartible* es lo más
   probado — **y no necesita servidor** (el puzzle del día se deriva de la fecha). *[cifras: NYT vía Fast
   Company/Axios — sólidas; estimaciones de terceros para Connections — medias]*

2. **Match-3 (Candy Crush 13 años; Royal Match ~$1,75 B en 2025, ~55 M MAU)** — **Durable**, PERO depende de
   *live-ops* continuo, miles de niveles y backend de servidor. **No es copiable en una app sin servidor.**

3. **Hiper/híper-casual (Block Blast ~368 M descargas 2025; Subway Surfers)** — género durable, pero **retención
   superficial** (Block Blast D30 ~1 %). Vive del volumen de instalaciones, no de lealtad. Monetiza por
   anuncios → choca con NEXO.

4. **.io y navegador (Poki/CrazyGames ~30-120 M visitas/mes)** — **categoría** durable, **títulos** moda.

5. **Discord Activities** — social y en-chat (lo más cercano a nuestro caso), pero **sin datos de retención
   duros**. No probado.

6. **Tap-to-earn de Telegram (Hamster Kombat, Notcoin, Catizen)** — Hamster: ~**300 M** usuarios (ago-2024) →
   **-85 % en 3 meses**. El interés por «tap to earn» cayó ~80 % en 2024. **El ejemplo más claro de MODA.**
   Enganche por airdrop de cripto, no por jugar. **No copiar** (y va contra la regla de nada-cripto).

**Lección central:** la retención *durable* no viene del gráfico ni del premio. Viene de **(a)** un ritual
diario con final (Wordle) o **(b)** una **persona del otro lado** (Words With Friends). NEXO puede hacer las dos
sin servidor; no puede (ni debería) competir con el *live-ops* de Candy Crush ni con el humo de tap-to-earn.

---

## 3) El bucle social asíncrono (por qué es *nuestro* juego)

El formato probado para una app de mensajes es el **turno asíncrono**: cada jugada se manda como mensaje, el
otro no necesita estar en línea, y vuelve cuando le avisás **«te toca»**.

- **Words With Friends**: vivo hace **15+ años**, ~**4 M jugadores/día**, ~25 mil millones de fichas puestas en
  12 meses. Es *la prueba* de que el bucle «tu turno» retiene por años. *(Dato interesante: agregaron modos en
  solitario/diarios; ~70 % de las sesiones arrancan en solo. Lección: el 1-contra-1 puro conviene acompañarlo de
  una capa diaria. → por eso recomendamos también el Reto diario.)*
- **GamePigeon (iMessage)**: ~25-30 juegos; los más jugados: **8-Ball (pool), Word Hunt, Batalla naval (Sea
  Battle), Anagramas, Cup Pong**; también **Gomoku, Damas, Conecta-4**. Funcionó por **fricción cero**: es parte
  del chat, sin cuenta ni instalar del otro lado. **Es exactamente el molde de NEXO.**
- **Draw Something**: subió a ~14 M/día y **se desplomó** → un juego de dibujar necesita mucho contenido y es
  incómodo mandar los trazos cifrados. **Lo descartamos.**
- **Facebook Messenger Instant Games**: Messenger los sacó para mantener la app «liviana y simple». **Lección:
  los juegos tienen que ser una capa fina y opcional, no una plataforma que engorde la app.**

**Anti-trampa según el tipo de juego** (clave para elegir qué construir primero):
- **Información perfecta** (Conecta 4, Gomoku, Damas, Reversi, Puntos-y-cajas, ajedrez): **no necesitan
  anti-trampa**, solo validar que la jugada del otro sea legal (ambos tienen el tablero entero). → **Lo más
  barato y robusto. Empezar por acá.**
- **Información oculta** (Batalla naval, grilla de letras con fichas ocultas): necesitan **compromiso-revelación**
  (*commit-reveal*: mandás el hash de tu tablero al inicio, lo revelás al final) **+ regla de tiempo/abandono**
  para que el perdedor no desaparezca. → Más trabajo, pero alto atractivo (Batalla naval es top en GamePigeon).
- **Puntaje en solitario** (Word Hunt, «Defensor NEXO»): el puntaje **se puede falsear**. Solo sirve para
  *picarse* en confianza, no para un ranking serio, salvo que se mande la jugada para verificar localmente.

---

## 4) El ranking entre contactos (lo que pediste) — diseño sin servidor y a prueba de trampa

**Requisito del dueño:** lista de contactos con puntuaciones, para competir. Bien pensado, **es también el mejor
diseño posible sin servidor**, porque se apoya en algo que ya tenemos: dos teléfonos que presenciaron la partida.

**Cómo se arma el puntaje (a prueba de trampa):**
- Cada partida terminada produce un **resultado firmado por los DOS teléfonos** (ganador, perdedor, fecha,
  juego). Como ambos la vieron y ambos firman, **nadie lo puede inventar solo** — habría que confabularse con un
  amigo, y en un ranking solo-de-contactos el costo de eso es social, no plata. *(Precedente técnico: feeds
  firmados estilo Secure Scuttlebutt; mezcla sin conflictos con CRDT.)*
- Los resultados **se propagan de contacto en contacto** (*gossip*): cuando dos NEXO se cruzan, se intercambian
  los resultados firmados que les falten. El ranking **converge sin servidor** y se pone al día offline.
- Un puntaje en solitario (tipo arcade) **no** entra al ranking competitivo (se puede falsear). Queda como
  marcador personal.

**Qué se muestra:**
1. **Cabeza a cabeza por contacto:** «**Vos vs Ana: 5-3**», racha de días jugados juntos. Es lo más confiable
   (lo firman los dos) y lo más barato (no necesita *gossip*). **Empezar por esto.**
2. **Tabla semanal entre tus contactos:** por partidas ganadas/puntos de la semana, **se reinicia el lunes**.
   Cohorte naturalmente chica (tus contactos). Fase 2.

**Reglas para que motive y NO se vuelva tóxico** (esto es lo que hace Duolingo bien y lo que la evidencia marca):
- **Cohortes chicas de amigos + reinicio semanal** → nadie queda atrás para siempre.
- **Mostrar también el progreso personal** (mejor marca propia, no solo el puesto) y los **rangos cercanos**, no
  una lista que humilla al último.
- **Opt-out** (poder esconderse de la tabla) y **sin notificaciones** de «te superaron».
- **Rangos que no castigan** (sin zona de descenso dolorosa) y **racha con perdón** (freeze gratis).
- **Puntuar solo actividad firmada y difícil de falsear, con tope por día** (que no empuje a jugar sin parar).

**Límite honesto:** sin servidor, dos amigos confabulados o un teléfono clonado pueden inflar un récord. En un
ranking solo-de-contactos eso es un problema social, no de seguridad. Lo aceptamos.

---

## 5) Qué encaja en NEXO — lista corta rankeada (retención × encaje × esfuerzo)

Reusa el motor que **ya existe** (`ttt.js`: cada jugada lleva el tablero entero, cifrado y validado; `nexo_game.js`
para arcade solitario). Eso hace que varios de estos sean casi gratis.

| # | Juego / modo | Retención | Encaje P2P/sin servidor | Esfuerzo | Anti-trampa | Veredicto |
|---|---|---|---|---|---|---|
| 1 | **Reto diario NEXO** (Wordle en español): mismo puzzle del día para vos y tu contacto, se compara intentos/tiempo, **racha de pareja**, resultado compartible sin spoiler | **Alta** (ritual diario) | Perfecto (puzzle derivado de la fecha) | Medio (hace falta lista de palabras es/it/en) | Baja (amistoso; se puede mandar la jugada) | ⭐ **Estrella de retención** |
| 2 | **Salón por turnos «te toca»** con **Conecta 4 + Gomoku + Damas** (parallelo por contacto, revancha en 1 toque, aviso «te toca») | **Alta** (bucle social) | Perfecto (reusa `ttt.js`) | **Bajo** (info perfecta, sin anti-trampa) | No necesita | ⭐ **Núcleo social** |
| 3 | **Ranking entre contactos** (cabeza a cabeza firmado → tabla semanal) | Alta (competencia) | Bueno (resultados firmados + gossip) | Medio | Firmado por ambos | ⭐ **Lo que pediste** |
| 4 | **Batalla naval** | Alta (muy social, top GamePigeon) | Bueno, con *commit-reveal* + timeout | **Alto** (info oculta) | Compromiso-revelación + abandono | Fase 2 (alto valor) |
| 5 | Reversi / Puntos-y-cajas | Media | Perfecto (info perfecta) | Bajo | No necesita | Relleno barato del salón |
| 6 | Word Hunt / Anagramas (carrera con misma grilla) | Media | Bueno | Medio | Puntaje falsificable | Opcional |
| — | Conecta 4 **solo** / piedra-papel-tijera | Baja | — | — | — | **No como estrella** (PPT casi se cae) |
| — | Draw Something, Match-3, tap-to-earn, grupos | — | Malo / moda | — | — | **Descartar / mucho después** |

---

## 6) Recomendación concreta y plan revisado

**La apuesta:** NEXO no gana imitando Candy Crush (necesita servidor) ni copiando modas (tap-to-earn colapsó).
Gana con **lo único que es suyo**: jugar con una persona de verdad, **offline y cifrado**, con un marcador que
pica. Dos bucles sanos (reto diario + «te toca») y un ranking honesto sin servidor.

**Plan por fases (reusando lo que ya hay):**

- **Fase A — Núcleo social (lo más barato y de mayor efecto):**
  1. **Salón de juegos** en el chat: botón «Jugar», lista, revancha en 1 toque, aviso «te toca».
  2. Juegos de **información perfecta** sobre el motor `ttt.js`: **Conecta 4** (ya casi listo) + **Gomoku** +
     **Damas**. Sin anti-trampa, baratos.
  3. **Cabeza a cabeza por contacto** («Vos vs Ana 5-3» + racha), con resultado **firmado por ambos**.

- **Fase B — Retención diaria:**
  4. **Reto diario NEXO** (Wordle es/it/en, puzzle derivado de la fecha), **racha de pareja** con perdón,
     resultado compartible sin spoiler.
  5. **Tabla semanal** entre contactos (reinicio lunes, cohorte = tus contactos, opt-out, sin humillar).

- **Fase C — Alto valor, más trabajo:**
  6. **Batalla naval** con compromiso-revelación + regla de abandono.
  7. Más juegos de relleno (Reversi, Puntos-y-cajas) según enganche.

**Qué cambia respecto al plan viejo del 15-nov:** se **mantiene** Conecta 4 y el marcador/racha; se **baja**
piedra-papel-tijera (demasiado flaco); se **agrega** el bucle «te toca» con varios juegos y, sobre todo, el
**Reto diario** como ancla de retención y el **ranking firmado** como capa de competencia.

**Antes de construir, falta tu decisión** (es producto, lo decidís vos): §7 del checklist.

---

## 7) Lo que tenés que decidir vos

- [ ] ¿Arrancamos por la **Fase A** (salón + Conecta 4/Gomoku/Damas + cabeza a cabeza)? Es lo más barato y ya.
- [ ] ¿Te cierra el **Reto diario tipo Wordle** como ancla de retención (Fase B)? Es lo más adictivo *sano*.
- [ ] **Batalla naval**: ¿la querés sí o sí (es top social) aunque cueste más (Fase C), o la dejamos para después?
- [ ] Ranking: ¿**cabeza a cabeza** primero (simple) y **tabla semanal** después, o las dos juntas?
- [ ] ¿Algún juego que *vos* tengas en la cabeza y que no esté acá?

---

## 8) Fuentes (las principales; el resto, en el historial de la investigación)

- Wordle/NYT: Fast Company `91539885`, Axios 2024-01-29; Connections: WordsRated.
- Tap-to-earn colapso: yellow.com (Hamster -85 %), nftnewstoday 2024-12, cryptonews.com.au.
- Block Blast / hiper-casual: blog.udonis.co, singular.net; Royal Match: mobilegamer.biz, naavik.co.
- Words With Friends: zynga.com/about, wordswithfriends.com (4 M DAU); GamePigeon: Wikipedia, lilachbullock.com.
- Draw Something: TechCrunch 2012-05-09, VentureBeat; Messenger Instant Games: Engadget 2019-07, TechCrunch 2022-08.
- Duolingo Leagues (D1 +1 %/D7 +2 %/D14 +3 %): Lenny's Newsletter (resumen); patrón de ligas: deconstructoroffun.com.
- Ranking/comparación social: CHI 2019 field experiment (tamaño de grupo), reviews de leaderboards en educación.
- Sin servidor / firma / CRDT: Secure Scuttlebutt (ssbc.github.io, paper de Tarr), CRDT grow-only (dicg-workshop 2022).
- Anti-trampa info oculta: ZK Battleship (MIT 65610, Circom), compromiso-revelación.
- Rachas/ética: Yu-kai Chou (diseño de rachas), taxonomía de patrones oscuros Zagal/Björk/Lewis 2013, arXiv 2412.05039.

> **Nota de método:** muchas cifras de retención son de blogs de empresa o proveedores, no verificadas de forma
> independiente. La recomendación se apoya en patrones repetidos entre fuentes, no en una cifra puntual. Lo
> correcto es **medir en NEXO** (D1/D7/D30, cuántos silencian avisos) en vez de confiar en estos números.
