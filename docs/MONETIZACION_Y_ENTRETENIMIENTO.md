# NEXO — Plan de rentabilidad y modo entretenimiento

> **Origen:** trabajo que el dueño avanzó en el teléfono (03-11-2026) e integró al repo el 04-11 (antes vivía fuera de GitHub).
> Consolida `docs/PLAN_NEGOCIO.md`, `docs/RENTABILIDAD_MX.md` y `docs/DICIEMBRE.md`, recortado al presupuesto real.
> **Las cifras de ingresos son ejemplos para decidir, no previsiones.**

## En resumen
La app sigue **gratis**. El primer dinero sale de un **pago único «Fundador NEXO»** y de un **piloto con papelerías**, sin gastar más de ~25 USD antes de tener ingresos. **Nada de anuncios, saldo dentro de la app ni cripto.**

- **Rentabilidad, tres fuentes en orden:** 1) Pase **Fundador** (pago único 199 MXN, desde diciembre). 2) **NEXO Negocios** (149 MXN/mes por local) tras un piloto gratis en enero. 3) **Plus**, cuando haya usuarios.
- **Entretenimiento para el 15-nov:** una **sala de juegos** en el chat con **Conecta 4** y **piedra-papel-tijera**, con marcador y racha por contacto. Reutiliza el motor del tres en raya (`src/ui/ttt.js`). El muro (Stream) y la batalla naval quedan para después.
- **Gasto hasta diciembre:** 0 MXN obligatorio. Los 25 USD de Google Play solo si se publica ahí.

## Cómo gana dinero NEXO sin invertir (orden: de lo cobrable ya a lo que necesita usuarios/terceros)
| # | Fuente | Quién paga | Precio ej. | Costo empezar | Desde | Voto |
|---|---|---|---|---|---|---|
| 1 | **Pase Fundador** (insignia, packs de stickers/fondos extra, juegos extra, nombre corto) | Primeros fans | 199 MXN única vez | 0 | Dic-2026 | **Sí, primero** |
| 2 | Donativos («Apoya NEXO» con GitHub Sponsors/Ko-fi) | Quien quiera | Libre | 0 | Ya | Sí, junto al 1 |
| 3 | **NEXO Negocios** (perfil de local, cola de impresión PDF, Cobros Pro) | Papelerías/cafeterías cerca de una universidad | 149 MXN/mes por local (gratis en piloto) | 0 (tu tiempo) | Piloto ene-2027, cobro mar-2027 | **Sí, el que más rinde** |
| 4 | NEXO Plus (suscripción personal) | Usuarios intensivos | 49 MXN/mes o 399 MXN/año | 25 USD (Play) | Con ~5.000 usuarios | Después |
| 5 | Subvenciones (NLnet, OpenSats) | Fundaciones | 5.000–50.000 € | 0, piden código libre | Al decidir licencia | Opcional |
| 6 | Comisión de pagos con socio con licencia | Comercios | Parte de la comisión | Abogado + socio | 2027+ | No por ahora |
| 7 | Equipos y SDK (obras, eventos, otras apps) | Empresas | 3 USD/usuario/mes | Ventas y soporte | 2027–2028 | No por ahora |

**Pase Fundador sin servidor:** el comprador paga con enlace de Mercado Pago (comisión ~3,49 % + 4 MXN + IVA por venta); se le manda un **código firmado con la clave privada** y la app lo comprueba **sin internet** (reutiliza la firma que la app ya usa).

**Cobro según dónde se instale [a verificar]:** APK de GitHub (como hoy) → Mercado Pago/transferencia, sin comisión de Google. Google Play → lo digital desbloqueado dentro de la app pasa por el cobro de Google (15 %); lo físico (impresión) y los pagos entre personas quedan fuera.

**Ejemplo primer año:** 300 Fundadores (199 MXN) ≈ 54.000 MXN + 30 locales (149 MXN × 9 meses) ≈ 40.000 MXN → ~94.000 MXN. Cubre la Mac y la cuenta de Apple sin poner dinero propio.

**No hacer:** anuncios en los chats, vender datos, guardar saldo de usuarios (en México exige licencia CNBV, multas hasta 12,6 M MXN) ni criptomoneda propia.

## Ideas de monetización, de más a menos probable (precios de prueba)
1. **Pase Fundador** — 199 MXN única vez. Alta. Desde dic-2026.
2. **Packs de stickers/fondos/temas** — 15–29 MXN/pack. Alta (modelo LINE/Telegram; ya hay stickers y fondos). Packs de temporada (Navidad, 14-feb, Día de Muertos). Desde ene-2027.
3. **Regalos en el chat** (animado que queda en el perfil, como Telegram) — 5–25 MXN. Media-alta. Desde feb-2027.
4. **NEXO Negocios** — 149 MXN/mes. Alta en el nicho. Piloto ene, cobro mar-2027.
5. **Avisos a clientes cercanos** (opt-in) — 29 MXN/100 avisos (0,29 MXN c/u). Media. Extra de Negocios, abr-2027.
6. **NEXO Plus** semanal/mensual/anual — 15/49/399 MXN. Media (necesita usuarios). Con ~5.000 activos.
7. **Kit para eventos** (bodas, ferias, conciertos, escuelas) — 299–999 MXN/evento. Media. Desde 2027.
8. **Monedas NEXO** que se ganan jugando (no se venden, no se transfieren, no se cambian por dinero → no son dinero electrónico). Gancho tipo Orbs de Discord. Desde ene-2027.
9. **Invita y gana** (3 amigos → 1 semana de Plus). Trae usuarios sin publicidad. Desde dic-2026.
10. **Donativos** (GitHub Sponsors/Ko-fi). Baja-media. Desde ya.

## Modo entretenimiento para el 15-nov («Sala de juegos» en el chat)
Juegos de dos jugadores entre contactos, **sin internet**, con marcador. Es lo que nadie más tiene: jugar con tu contacto en un concierto, el metro o un apagón.

**Ya existe (build 2900):** tres en raya (`ttt.js`), juego secreto «Defensor NEXO» (`nexo_game.js`), stickers + editor, reacciones, estados 24 h, fondos.

**Alcance mínimo para el 15-nov:**
1. Botón **«Jugar»** en el chat, con lista de juegos y revancha en un toque.
2. **Conecta 4** — mismo motor que el tres en raya (cada jugada lleva el tablero entero, cifrada y validada al llegar). Es el candidato #123.
3. **Piedra-papel-tijera** al mejor de 3 — cada uno manda su jugada **sellada** y luego la abre (anti-trampa).
4. **Marcador y racha por contacto** («Ana 5, tú 3», «racha de 4 días»). Es lo que hace volver cada día.
5. Textos es/it/en + pruebas en el simulador.

**Terminado cuando:** una partida completa de cada juego llega bien entre los dos teléfonos por Bluetooth y por Wi-Fi, y una jugada hecha con el otro desconectado llega al volver.

**Fuera de esta entrega:** Stream/muro (el gancho más fuerte, pero el más grande → enero), batalla naval (ocultar tablero), damas, juegos en grupo.

## Calendario
| Fechas | Qué | Gasto |
|---|---|---|
| 4–7 nov | Botón «Jugar» + Conecta 4 | 0 |
| 8–10 nov | Piedra-papel-tijera + marcador y rachas | 0 |
| 11–12 nov | Botón «Apoya NEXO» + extras del Fundador bloqueados con interruptor local (sin cobrar) | 0 |
| 13–14 nov | Pruebas en los dos teléfonos (juegos + `PRUEBAS_FISICAS.md`) | 0 |
| 15 nov | Entrega del modo entretenimiento + decisiones | 0 |
| Diciembre | Activar Pase Fundador (Mercado Pago + código firmado); alta en SAT | 0 (comisión solo al vender) |
| Ene–feb 2027 | Piloto gratis de Negocios (5–10 papelerías/cafeterías) | Tiempo + alguna impresión |
| Marzo 2027 | Cobrar Negocios (149 MXN/mes) | 0 |

**Gastos aplazables:** Google Play 25 USD (solo si se publica; cuentas nuevas piden prueba cerrada ~12 testers × 14 días [a verificar]); marca IMPI ~3.000 MXN/clase (antes de publicidad o Play, porque «Nexo» ya es marca de cripto); Apple Developer 99 USD/año; Mac reacondicionada desde ~10.800 MXN; abogado de pagos (solo antes de la fase con socio).

## ⬜ Lo que SOLO el dueño puede decidir (checklist)
- [ ] ¿Arranco ya con **Conecta 4** y la sala de juegos? (para el 15, hay que empezar el **4-nov**).
- [ ] ¿**Google Play** o seguir con la **APK de GitHub**? (decide el 15 % de Google). Voto: APK en diciembre para el Fundador, Play en 2027.
- [ ] **Precio del Pase Fundador:** ¿199 MXN, otro, o solo donativos?
- [ ] **Universidad y papelerías** del piloto de enero: ¿cuáles tenés cerca?
- [ ] ¿**Licencia libre** del código? (abre subvenciones; NLnet la exige, pero cualquiera podría copiarlo).
- [ ] ¿La **Mac** va ahora o espera a los primeros ingresos? Voto: esperar a dic/ene salvo que ya la tengas.
- [ ] ¿Ya estás **dado de alta en el SAT** para facturar/recibir pagos?

_No cambia código ni contacta a nadie: es el plan para decidir._
