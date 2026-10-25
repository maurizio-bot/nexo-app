# NEXO — Plan de negocio: cómo gana dinero la competencia y cómo puede ganarlo NEXO

Pedido del dueño (25-10-2026): investigar cómo ganan dinero las apps en general y las de mensajería de la competencia,
y armar un plan para NEXO que incluya los pagos (aún no hechos) solo en una versión **sin licencia financiera**, "algo
parecido a PayPal, algo que no hace transferencias a bancos directamente".

Cómo se hizo: búsquedas en internet el 25-10-2026. Las cifras llevan su fuente al lado; lo que viene de una fuente
secundaria o no se pudo comprobar va marcado **(sin confirmar)**. Las propuestas de precios y los escenarios de
ingresos son ejemplos para decidir, no previsiones. **Nada de esto es asesoría legal**: lo de pagos hay que confirmarlo
con un abogado del país elegido antes de programarlo.

## Resumen
1. El dinero de las apps viene de **suscripciones, compras dentro de la app, publicidad y servicios a empresas**. En
   2025, por primera vez, las apps que no son juegos facturaron más que los juegos.
2. Las apps de mensajería grandes ganan con **las empresas** (WhatsApp cobra por mensaje a los negocios), con
   **suscripciones** (Telegram Premium, Snapchat+) y con **publicidad**. Las privadas sin servidores propios viven de
   donativos y subvenciones, **no les alcanza** (Signal gasta más de lo que recibe) y acaban cobrando algo
   (Signal, copias de seguridad; Threema, versión para empresas).
3. Las de "sin internet" (FireChat, Bridgefy, bitchat) tienen **picos de uso en crisis que no se quedan**. Bridgefy
   (mexicana) pasó a vender a empresas y su SDK. La visión de NEXO, **utilidad diaria en "núcleos"** (universidad,
   papelería, cafetería), es justo lo que les faltó.
4. NEXO tiene una ventaja de costes enorme: **sin servidores, cada usuario cuesta casi cero** (Signal calcula unos
   50 millones de dólares al año de operación).
5. Propuesta: **la app gratis siempre** (mensajes, llamadas, sin internet, cifrado). Se cobra por lo que es extra o
   es para negocios: **NEXO Plus** (personas), **NEXO Negocios** (locales de los núcleos), **NEXO Equipos** (empresas
   en lugares sin cobertura), más adelante un **SDK** (licencia de la malla) y **comisión de pagos** a comercios con un
   socio con licencia. Sin anuncios en los chats y sin vender datos.
6. **Pagos sin licencia**: NEXO **no puede guardar saldo** (eso es un fondo de pago electrónico y en México exige
   autorización de la CNBV; multas de hasta 12,6 millones de pesos y hasta 15 años de prisión). Lo que sí se puede:
   **"Cobros"** dentro del chat (solicitud de cobro, abrir la app del banco o de Mercado Pago/PayPal del que paga,
   comprobante), que además **viaja sin internet** por Bluetooth y Jump. La experiencia "tipo PayPal" con saldo dentro
   de NEXO llega en la fase 2 **con un socio que tenga la licencia** (NEXO como proveedor de tecnología).
7. **Riesgo de marca**: "Nexo" es una empresa de criptomonedas con marcas registradas en finanzas. Antes de la tienda
   y de los pagos: búsqueda de marca y **no llamar al módulo "NEXO Pay"**.

## 1. Cómo ganan dinero las apps (en general)

| Dato | Cifra | Fuente |
|---|---|---|
| Gasto en compras dentro de apps, 2025 | ≈ 167 mil millones de dólares (+10,6 %); las apps que no son juegos (≈ 85,6 mil M) superan por primera vez a los juegos | [Sensor Tower, 21-ene-2026](https://sensortower.com/press/press-release-boosted-by-gen-ai-services-consumers-spent-more-money-in-apps-than-games-for-first-time) |
| Otra medición del mismo año | 155,8 mil M (+21,6 %); las descargas bajan por quinto año (106,9 mil M) | [Appfigures, 15-ene-2026](https://dataconomy.com/2026/01/15/appfigures-mobile-app-spending-hits-record-155-8-billion/) |
| Publicidad en apps | Sigue siendo la mayor fuente (≈ 381 mil M) **(sin confirmar: no se ve la metodología)** | [Statista](https://www.statista.com/statistics/267112/global-app-market-size/) |
| Cuántos pagan en una app gratuita con extras de pago | Mediana 2,1–2,2 % (con muro de pago desde el inicio, 10,7–12,1 %) | [RevenueCat](https://www.revenuecat.com/state-of-subscription-apps) |
| Latinoamérica | 6,9 % del ingreso mundial por suscripciones; ingreso mediano por suscriptor en un año: México 17,6 dólares; el 60 % del ingreso en la región viene de planes semanales (2025) | [Adapty 2026](https://adapty.io/blog/fastest-growing-app-markets-2026/) |
| Precios que paga la gente en México (al mes) | Spotify 139 MXN (estudiantes 74), YouTube Premium 159 (Lite y estudiantes 99), Telegram Premium 99–119 (precios de 2022) | [Récord](https://www.record.com.mx/contra/otra-vez-spotify-sube-precios-para-2026-aqui-todos-los-detalles), [Hipertextual](https://hipertextual.com/internet/youtube-premium-sube-precio-mexico-plan-individual/), [Xataka](https://www.xataka.com.mx/aplicaciones/dependiendo-como-te-suscribas-puedes-ahorrar-16-tarifa-telegram-premium-aqui-te-explicamos-opciones) |

**Google Play**: las suscripciones pagan un 15 % a Google; las compras sueltas, 15 % del primer millón de dólares al año
y 30 % después. Google anunció un esquema nuevo más barato (10 % + 5 % si se cobra con Play) en EE. UU., Europa y Reino
Unido desde el 30-jun-2026 y en el resto del mundo, México incluido, a más tardar el 30-sep-2027
([Google](https://android-developers.googleblog.com/2026/06/play-expanded-billing.html); detalles **sin confirmar**).
**Muy importante para NEXO**: el cobro de Google Play **no se debe usar** para bienes o servicios físicos (imprimir en
la papelería, un café) ni para pagos entre personas: esos no pagan comisión a Google
([política de Play](https://support.google.com/googleplay/android-developer/answer/10281818)).

## 2. Cómo ganan dinero las apps de mensajería

| App | De dónde sale el dinero | Cifras |
|---|---|---|
| **WhatsApp** (Meta) | Las empresas pagan por cada mensaje de plantilla (desde el 1-jul-2025); anuncios que abren un chat; desde 2025, anuncios en Estados y suscripciones a canales (los chats siguen sin anuncios); pagos en India (UPI) y Brasil (Pix) | "Otros ingresos" de Meta (sobre todo WhatsApp de pago): 1.097 millones de dólares en el 3.er trimestre de 2026 (+59 %) ([SEC](https://www.sec.gov/Archives/edgar/data/0001326801/000162828026066773/meta-20260930.htm), [NBC](https://www.nbcnews.com/news/amp/rcna213357)) |
| **Telegram** | Premium (≈ 5 dólares/mes, más de 12 millones de suscriptores en dic-2024), anuncios (reparte el 50 % con los canales), Stars (moneda para lo digital), acuerdos con TON (cripto) | 2024: 1.400 M de ingresos y primer beneficio, ≈ 540 M. 1.er semestre de 2025: 870 M de ingresos, pero pérdida neta por la caída de su cripto ([liga.net/FT](https://finance.liga.net/en/personal/news/telegram-received-its-first-profit-of-540-million-and-is-preparing-to-issue-bonds), [Cryptodnes](https://cryptodnes.bg/en/telegram-posts-870m-revenue-in-h1-2025-as-toncoin-losses-mount/)) |
| **Signal** | Donativos (fundación sin ánimo de lucro); primer producto de pago en sep-2025: copia de seguridad de 100 GB por 1,99 dólares/mes | 2024: ingresos 29,4 M (21,8 M en donativos) y gastos 38,0 M ([Form 990](https://www.roundpaper.com/nonprofits/org/signal-technology-foundation-824506840), [TechCrunch](https://techcrunch.com/2025/09/08/signal-introduces-free-and-paid-backup-plans-for-your-chats)) |
| **Threema** | App de pago único y, sobre todo, Threema Work para empresas: 3 o 5 francos suizos por usuario al mes | Comprada por un fondo (Comitis Capital, cierre ene-2026) ([Threema](https://threema.com/en/work/preise), [heise](https://www.heise.de/en/news/Comitis-Capital-acquires-Threema-11138748.html)) |
| **Viber** (Rakuten) | Publicidad, llamadas a teléfonos (Viber Out), stickers, Viber Plus (1,99 dólares/mes, sin anuncios) | Sin desglose público ([PhoneArena](https://www.phonearena.com/news/viber-plus-price-features_id148909)) |
| **LINE** | Publicidad, stickers (≈ 50 % para el creador), cuentas oficiales de empresas; cerró LINE Pay en Japón (abr-2025) | ([LY Corp](https://filingreader.com/news-wire/tokyo/2026-05-11/ly-corporation-hits-record-revenue-and-profits-for-fiscal-2025), [PayPay](https://about.paypay.ne.jp/en/pr/20250127/01/)) |
| **WeChat** (Tencent) | Pagos (WeChat Pay, con licencia propia), miniapps y publicidad | 2025: servicios financieros y a empresas 229,4 mil M de yuanes ([Tencent](https://en.prnasia.com/releases/apac/tencent-announces-2025-annual-and-fourth-quarter-results-525781.shtml)) |
| **Discord** / **Snapchat** | Suscripciones (Nitro 9,99 dólares/mes; Snapchat+ con 14 M de suscriptores a fines de 2024) y anuncios | ([SEC Snap](https://www.sec.gov/Archives/edgar/data/1564408/000156440825000016/q42024investorletterfina.htm)) |
| **Zello** (walkie-talkie para equipos) | Zello Work: 6,80–12,75 dólares por usuario al mes | ([Zello](https://zello.com/pricing/)) |
| **Bridgefy** (mexicana, sin internet) | Licencia de su SDK según usuarios activos al mes, empresas, alianzas con la ONU | Más de 12 M de descargas; ronda semilla de 1,4 M de dólares (2023) ([Bridgefy](https://bridgefy.notion.site/Bridgefy-SDK-Pricing-22cf443f5ef680039882cd88cedac706), [Alchemist](https://www.alchemistaccelerator.com/blog/bridgefy-the-offline-messaging-app-revolutionizing-crisis-communication-worldwide)) |
| **bitchat** (Jack Dorsey) | Ninguno: código libre, pagado por Dorsey **(sin confirmar)** | Picos en crisis: Nepal de 3.300 a 48.000 descargas en una semana (sep-2025) ([Sacra](https://sacra.com/c/bitchat/), [Cryptopolitan](https://www.cryptopolitan.com/bitchat-downloads-surge/)) |
| **Briar**, **Berty** | Subvenciones (OTF, NLnet…) y donativos | ([Briar](https://en.wikipedia.org/wiki/Briar_(software))) |
| **goTenna** | Dejó al público y vende a gobiernos y defensa; comprada por Forterra (oct-2025) | ([Breaking Defense](https://breakingdefense.com/2025/10/forterra-acquires-networking-company-gotenna/)) |
| **Session** | Session Pro (desde 2,99 dólares/mes) convertido en su token | ([Session](https://getsession.org/zh-CN/pro)) |

**Lo que enseña la competencia**
- **Las empresas pagan; las personas pagan poco** (≈ 2 % de los usuarios, y en México menos dinero por persona). Los que
  viven solo de donativos no llegan (Signal).
- **Sin internet no basta para quedarse**: FireChat (10,8 M de dólares levantados) cerró sin explicación en 2020;
  Bridgefy y bitchat crecen en protestas y apagones y no hay datos de que la gente se quede.
- **La seguridad se audita en público**: los fallos de Bridgefy en 2020 le costaron su reputación. NEXO necesita una
  auditoría externa antes de presumir de seguridad.
- **Las criptomonedas son un riesgo**: Telegram tuvo pérdida neta en 2025 por su cripto.

## 3. Qué tiene NEXO para vender
- Funciona **sin internet ni datos** (en Latinoamérica los datos son caros): textos, fotos, archivos grandes, **llamadas
  y videollamadas** sin internet (ninguna otra lo hace, ver `COMPARATIVA.md`).
- Sin número de teléfono, cifrado al nivel de Signal y poscuántico, copia de la cuenta en tus contactos (Fénix).
- **Sin servidores**: casi sin costes por usuario; se puede vender barato y ganar margen.
- La visión de los **núcleos** (universidades, papelerías, cafeterías, eventos, tiendas): utilidad diaria cerca, no
  solo en emergencias.

## 4. Modelo propuesto
Principios: **la app es gratis** y lo esencial nunca se cobra (mensajes, llamadas, sin internet, cifrado, Fénix
básico); **sin anuncios en los chats y sin vender datos** (la marca es la privacidad); se cobra lo que es extra, lo que
es para negocios y, con socio, una comisión a los comercios.

| Fuente | Para quién | Qué incluye | Precio propuesto (a validar) | Cuándo |
|---|---|---|---|---|
| **NEXO Plus** | Personas | Temas y aspecto, stickers propios, nombre corto (en vez de NX…), Fénix ampliado (copia de fotos y archivos en tus contactos), videollamada en alta calidad, mensajes programados | 49 MXN/mes o 399 MXN/año (por Google Play: 15 %) | 2027 |
| **NEXO Negocios** | Locales de los núcleos: papelerías, cafeterías, tiendas cerca de escuelas | Perfil verificado, catálogo, **cola de impresión** (recibir PDF y marcarlos "listo"), avisos a clientes cercanos **que lo aceptaron**, cobros, estadísticas | 149 MXN/mes por local; los primeros meses gratis en el piloto | Piloto en 2027 |
| **NEXO Equipos** | Empresas sin cobertura: obras, minas, eventos y festivales, cruceros, protección civil | Panel para dar de alta al equipo, grupos, alerta de socorro, ubicación del equipo, malla Jump | 3 dólares por usuario al mes (Zello: 6,80; Threema Work: 3–5 francos) o paquete por evento | 2027 |
| **SDK de la malla** | Otras apps (eventos, juegos) | Mensajes sin internet dentro de su app | Licencia por usuarios activos, como Bridgefy | 2028 |
| **Comisión de pagos** | Comercios | Parte de la comisión del socio con licencia (por ejemplo, `marketplace_fee` de Mercado Pago) | Según el socio | Fase 2 de pagos |
| **Subvenciones y donativos** | — | NLnet (5.000–50.000 €, exige licencia libre), OTF (10.000–900.000 dólares; su financiación de 2026 **sin confirmar**), OpenSats (proyectos Nostr), botón "Apoya NEXO" | — | Desde ya |

**No hacer**: anuncios en los chats, vender o analizar datos, emitir una criptomoneda propia, guardar dinero de usuarios
sin licencia.

### Cuánto podría dar (escenarios de ejemplo, con supuestos a la vista)
- **100.000 usuarios activos en México**, 1,5 % pagan Plus, 17,6 dólares al año cada uno (mediana mexicana), menos
  15 % de Google: ≈ **22.000 dólares al año**.
- **300 locales** con NEXO Negocios a 149 MXN/mes: ≈ **536.000 MXN al año**.
- **20 empresas con 50 usuarios** en NEXO Equipos a 3 dólares: ≈ **36.000 dólares al año**.
- Costes: casi sin servidores; lo grande es el desarrollo, la auditoría, lo legal y la cuenta de Google Play (pago
  único de 25 dólares). Lo que más rinde por usuario son **los negocios y los equipos**, no las personas.

## 5. Pagos sin licencia financiera

### 5.1 Qué exige licencia (y por qué un "PayPal" con saldo no se puede sin ella)
- **México**: emitir, administrar o transmitir "fondos de pago electrónico" (un saldo en cuentas dentro de la app,
  como el de PayPal o Mercado Pago) solo lo puede hacer una **Institución de Fondos de Pago Electrónico (IFPE)**
  autorizada por la CNBV ([Ley Fintech, art. 22](https://mley.mx/LRITF/articulo/22/)); operar sin autorización:
  multas de 422 mil a 12,6 millones de pesos y hasta 15 años de prisión
  ([Expansión](https://expansion.mx/tecnologia/2019/10/07/fintech-no-autorizada-cnbv-pagara-hasta-12-6-millones-pesos)).
  Recibir dinero para entregarlo a otro es de **transmisor de dinero** (registro en la CNBV).
- **Unión Europea**: lo mismo (dinero electrónico o servicios de pago); queda fuera quien es **solo proveedor técnico
  y nunca toca los fondos** ([PSD2, art. 3](https://www.legislation.gov.uk/eudr/2015/2366/article/3/data.html)).
- **EE. UU.**: licencias de transmisor de dinero estado por estado.
- **Cómo lo hicieron los chats**: WhatsApp en India (sobre UPI con bancos socios) y en Brasil (desde 2024 con Pix: el
  comercio da su clave Pix y el cliente paga desde su banco, gratis; [Tecnoblog](https://tecnoblog.net/noticias/whatsapp-ganha-integracao-com-pix-veja-como-sera/));
  WeChat Pay con licencia propia; LINE Pay cerró en Japón. **El modelo de WhatsApp con Pix es el más parecido a lo
  que NEXO puede hacer sin licencia.**

### 5.2 Fase 1 — "Cobros" en NEXO (sin licencia: NEXO nunca toca el dinero)
1. **Tarjeta de cobro en el chat**: importe, concepto y los datos para pagar de quien cobra (en México: CLABE o
   celular de DiMo, su enlace de Mercado Pago o PayPal; en Europa: código QR EPC con su IBAN; en Brasil: Pix
   copia-e-cola). Un botón **abre la app del banco del que paga** o copia los datos.
2. **Comprobante**: el que paga adjunta la referencia (clave de rastreo SPEI); la tarjeta pasa a "pagado (según quien
   paga)" y, cuando el que cobra lo confirma, a "cobrado".
3. **Sin internet** (la visión de NEXO): la solicitud y el comprobante viajan cifrados por Bluetooth, Wi-Fi o Jump; el
   pago de verdad se hace cuando el que paga tiene datos (o en efectivo, y se marca "cobrado").
4. **Caso papelería**: el estudiante manda el PDF → la papelería imprime y le manda "Cobro: 12 MXN, impresión" → el
   estudiante paga por transferencia, DiMo o en efectivo → la papelería marca "cobrado". Historial de cobros por
   contacto.
5. **Prohibido en esta fase**: saldos, guardar dinero, cuentas a nombre de NEXO, cobrar comisión por pago, vales que se
   pasen de mano en mano (podrían contar como dinero electrónico) y entrar a las cuentas bancarias del usuario.
6. **Antes de lanzarlo**: consulta con un abogado de pagos (en México, si generar un cobro CoDi o el QR de SPEI exige
   registrarse en Banxico **(sin confirmar)**), la declaración de "funciones financieras" de Google Play y la búsqueda
   de marca.
7. **Oportunidad 2026**: Banxico obliga a los bancos a aceptar transferencias por alias, celular y QR homologados antes
   del 14-dic-2026 ([El Financiero](https://www.elfinanciero.com.mx/economia/2026/06/18/banxico-publica-nuevas-reglas-para-pagos-digitales-como-te-afectan-y-que-cambia-en-tus-transferencias/));
   si la especificación permite que una app de terceros genere ese QR **(sin confirmar)**, la tarjeta de cobro de NEXO
   podría llevarlo y el pago sería de un toque desde cualquier banco.

### 5.3 Fase 2 — "Tipo PayPal" con un socio que tiene la licencia (6–18 meses)
La experiencia que pide el dueño (saldo dentro de NEXO, pagar a un contacto o a un comercio sin salir de la app) **sí
se puede sin licencia propia si el saldo lo lleva una entidad con licencia** y NEXO es su proveedor de tecnología:
- **México**: una IFPE con servicio por API (hay unas 87; en 2025 se autorizaron, por ejemplo, Finco Pay y Fintoc;
  [El CEO](https://elceo.com/fintech/cnbv-autoriza-a-finco-pay-como-fintech/), [Chócale](https://chocale.cl/2025/08/fintoc-obtiene-licencia-en-mexico-como-institucion-de-fondos-de-pago-electronico-regulada/)).
  Para comercios: Mercado Pago "marketplace" (cada vendedor conecta su cuenta y NEXO cobra su parte con
  `marketplace_fee`; [documentación](https://www.mercadopago.com.mx/developers/en/docs/checkout-api-payments/how-tos/integrate-marketplace.md)),
  Clip u Openpay. **Stripe no sirve para pagos entre personas** (solo cobros a comercios;
  [Stripe](https://support.stripe.com/questions/prohibited-and-restricted-businesses-list-faqs)).
- **Europa**: Mangopay (dinero electrónico, supervisada en Luxemburgo) o Lemonway (Francia).
- **Pagos sin internet con límite** (como UPI Lite en India: tope por pago y por saldo, recarga solo con conexión;
  [DT Next](https://www.dtnext.in/news/business/upi-lite-rbi-raises-limit-of-wallet-to-rs-5000-per-transaction-to-rs-1000-813798)):
  solo si el socio asume el riesgo del doble gasto.
- Aquí entra el ingreso: una parte de la comisión a comercios (en México, Mercado Pago cobra 3,49 % + 4 MXN + IVA;
  PayPal 3,95 % + 4 MXN).

### 5.4 Fase 3 — Licencia propia (más de 18 meses, si el volumen lo justifica)
IFPE en México (o el "sandbox" de la Ley Fintech, autorización temporal de hasta 2 años), entidad de pago en Europa
(con las reglas nuevas, PSD3, hacia 2028) o licencias en EE. UU. Solo con licencia propia: saldo propio o efectivo
digital sin conexión con chip seguro.

### 5.5 Cripto (no recomendado ahora)
Una cartera sin custodia (el usuario tiene sus llaves) no exige licencia en la UE y Google Play la permite, pero
comprar y vender cripto sí está regulado, el fraude no se puede deshacer y acercaría a NEXO a la marca de criptomonedas
"Nexo" (ver §6). Para un público general en Latinoamérica, mejor las transferencias de siempre.

## 6. Riesgo de marca: "Nexo"
- **Nexo** (Nexo Inc., Islas Caimán) es una plataforma de criptomonedas con marcas registradas en clases 9 (software),
  36 (finanzas) y 42, limitadas a cripto-activos ([UK IPO, oct-2025](https://www.ipo.gov.uk/t-tmj/tm-journals/2025-041/WO0000001877157.html));
  volvió a EE. UU. en feb-2026 y litiga mucho ([Decrypt](https://decrypt.co/358078/nexo-us-return-after-sec-settlement)).
  Hay otras marcas "nexo" en pagos (nexo standards). No se encontraron demandas suyas contra otros "Nexo"
  **(sin confirmar)**.
- **Recomendación**: búsqueda de marca en el IMPI (México) en las clases 9, 38, 42 y 36 antes de Google Play;
  registrar "NEXO" para mensajería si está libre; **para los pagos, otro nombre** ("Cobros", no "NEXO Pay" ni "NEXO
  Card").

## 7. Plan por etapas

| Etapa | Cuándo | Qué | Cómo se mide |
|---|---|---|---|
| 0. Certeza técnica y salida | Hasta dic-2026 | Robustez (índice ≥ 70, `ROBUSTEZ.md`), pruebas con 3–4 teléfonos, auditoría externa, empresa constituida, búsqueda de marca, Google Play (política de privacidad, seguridad de datos, declaración financiera "ninguna"); pedir subvenciones (OTF, NLnet si hay licencia libre, OpenSats) | Mensajes entregados ≥ 99 %, sin cierres, primeras 1.000 instalaciones |
| 1. Núcleos y cobros | Ene–mar 2027 | "Cobros" sin licencia; piloto de NEXO Negocios en 5–10 locales junto a una universidad (papelería, cafetería); botón "Apoya NEXO" | Locales activos, cobros por semana, usuarios que siguen a los 30 días |
| 2. Ingresos | Abr–sep 2027 | NEXO Plus; NEXO Equipos (piloto en un evento y una obra); socio de pagos para comercios | % que paga Plus, usuarios de Equipos, comisión cobrada |
| 3. Escala | 2028 | iPhone (sin él no hay adopción masiva), SDK, licencia propia de pagos si hace falta | Ingreso recurrente al mes |

## 8. Decisiones del dueño
1. **País de lanzamiento** (México parece lo natural): define la ley de pagos, el socio y los precios.
2. **¿Código abierto?** El repositorio es público pero sin licencia. Una licencia libre da confianza (Signal y Briar lo
   son) y abre subvenciones (NLnet la exige); a cambio, cualquiera puede copiarlo.
3. **Constituir la empresa** (necesaria para Google Play como negocio, socios de pagos y contratos con empresas).
4. **Nombre del módulo de pagos** y búsqueda de marca.
5. **Qué incluye NEXO Plus y a qué precio** (propuesta: 49 MXN/mes, 399 MXN/año).
6. **Stream** (sigue sin decidir): si se hace, podría dar ingresos a creadores sin anuncios en los chats.

## Fuentes adicionales
- Gasto en apps: [TechCrunch, 21-ene-2026](https://techcrunch.com/2026/01/21/consumers-spent-more-on-mobile-apps-than-games-in-2025-driven-by-ai-app-adoption)
- Google Play, excepciones del cobro: [ayuda de Play](https://support.google.com/googleplay/android-developer/answer/9858738), [pagos](https://play.google.com/about/monetization-ads/payments)
- Telegram, reparto de publicidad: [TechCrunch, 2024](https://techcrunch.com/2024/02/28/telegram-is-launching-ad-revenue-sharing-next-month-using-toncoin)
- Signal, costes: [blog de Signal, 2023](https://signal.org/blog/signal-is-expensive/)
- FireChat: [TechCrunch, 2014](https://techcrunch.com/2014/12/18/open-garden-raises-10-8m-series-a-round-to-double-down-on-its-off-grid-firechat-messenger), [Wikipedia](https://en.wikipedia.org/wiki/FireChat)
- Bridgefy, auditoría de seguridad: [USENIX Security 2022](https://www.usenix.org/conference/usenixsecurity22/presentation/albrecht)
- Subvenciones: [NLnet](https://nlnet.nl/news/2026/20260601-call.html), [OTF](https://www.gc4hr.org/resource/internet-freedom-fund-otf/), [OpenSats](https://opensats.org/blog/2025-year-in-review)
- Pagos en México: [Ley Fintech, compendio 2025](https://sdv.com.mx/compendio/ley-para-regular-las-instituciones-de-tecnologia-financiera/articulo-22/), [transmisores de dinero](https://mley.mx/LGOAAC/articulo/81-a-bis/), [DiMo](https://www.elfinanciero.com.mx/mis-finanzas/2023/03/01/dimo-asi-funciona-la-plataforma-de-banxico-para-transferir-dinero-desde-el-celular/), [comisiones de Mercado Pago](https://www.mercadopago.com.mx/blog/hot-sale-integra-mercado-pago), [comisiones de PayPal](https://www.paypal.com/mx/webapps/mpp/merchant-fees)
- Pagos en Europa: [QR EPC](https://europeanpaymentscouncil.eu/sites/default/files/kb/file/2022-09/EPC069-12%20v3.0%20Quick%20Response%20Code%20-%20Guidelines%20to%20Enable%20the%20Data%20Capture%20for%20the%20Initiation%20of%20an%20SCT_0.pdf), [PSD3, acuerdo nov-2025](https://www.taylorwessing.com/en/insights-and-events/insights/2025/11/eu-lawmakers-strike-a-deal-on-payments-reforms)
- Google Play y cripto: [Decrypt, ago-2025](https://decrypt.co/335134/google-non-custodial-wallets-exempt-new-crypto-app-rules-play-store)
