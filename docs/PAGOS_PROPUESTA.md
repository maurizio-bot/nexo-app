# NEXO — Pagos / "Cobros": cómo implementarlos sin licencia financiera

Pedido del dueño (26-10-2026): "ver cómo implementar la parte de pagos / Cobros". Este documento es **solo
investigación y propuesta**; no toca código. Amplía `docs/PLAN_NEGOCIO.md` §5 con el detalle técnico y legal de
las vías concretas y una recomendación accionable. **Nada de esto es asesoría legal**: lo de pagos hay que
confirmarlo con un abogado de pagos del país de lanzamiento antes de programar una sola línea.

## Resumen (lo esencial)
- La regla de oro es una sola: **lo que exige licencia es la CUSTODIA del dinero** (guardar saldo, recibir dinero
  para entregarlo a otro, "money transmitter"). Si NEXO **nunca toca ni controla los fondos**, no es una entidad
  de pago: es **mensajería de cobros**, como un "Request to Pay" o una factura con un enlace.
- La vía recomendada: NEXO manda en el chat una **"tarjeta de cobro" cifrada de extremo a extremo** (importe,
  concepto y el dato/enlace/QR para pagar de quien cobra, de un proveedor **ya licenciado** — Mercado Pago, PayPal,
  Pix, CLABE/DiMo, QR EPC). El dinero viaja por el banco/pasarela del que paga; NEXO solo lleva el mensaje y el
  comprobante, y lo hace **también sin internet** (Bluetooth, Wi-Fi, Jump) — que es justo la ventaja de NEXO.
- Encaja técnicamente como **un tipo de mensaje más** (igual que foto, ubicación o las acciones `nexo_act`): una
  tarjeta en el chat, sin pantallas de banco dentro de NEXO y sin que el dinero pase por NEXO.
- Cripto no custodial (el usuario tiene sus llaves) también es sin licencia y Google la permite, pero añade riesgo
  de fraude, de marca ("Nexo" cripto, §6 del plan) y de usabilidad: **fase posterior y opcional**, no la primera.
- Lo que **no** se puede sin licencia: saldo dentro de NEXO, "cartera NEXO", vales que pasen de mano en mano,
  cobrar comisión por mover el dinero, o entrar a la cuenta bancaria del usuario con sus claves.

## 1. Las vías y qué implican

| Vía | Qué hace NEXO | ¿Licencia? | Esfuerzo técnico | Experiencia de usuario | Comisiones |
|---|---|---|---|---|---|
| **A. Solicitud de cobro + enlace/QR de un proveedor licenciado** (Mercado Pago, PayPal.me, Pix copia-e-cola, Stripe Payment Links para comercios) | Genera una tarjeta con importe/concepto y el enlace o QR que el que cobra ya tiene; el que paga lo abre | **No** (NEXO no toca fondos; es un mensaje con un enlace) | **Bajo–medio**: tarjeta en el chat + "abrir enlace"/"copiar"/mostrar QR. Opcional: API del proveedor para crear el enlace al vuelo (medio) | Muy buena: un toque abre la app del banco/pasarela del que paga | Las del proveedor (Mercado Pago MX ≈ 3,49 % + 4 MXN + IVA; PayPal ≈ 3,95 % + 4 MXN). NEXO **no** cobra encima |
| **B. "Cobro" peer-to-peer manual** (datos para pagar: CLABE, celular DiMo, alias/QR homologado de Banxico, IBAN con QR EPC; el que paga usa su banco; comprobante en el chat) | Lleva el importe, el concepto, los datos de pago y el comprobante (clave de rastreo/foto); estados pendiente → "pagado (según quien paga)" → "cobrado" | **No** (es exactamente "Request to Pay": mensajería, no un instrumento de pago) | **Bajo**: es solo texto estructurado + estados + botón "copiar"/"abrir mi banco". **Funciona sin internet** sin depender de ninguna API | Buena: el que paga sale a su app de banco; 1 paso más que A, pero sirve para transferencias normales y efectivo | Ninguna (transferencia directa SPEI/Pix suele ser gratis para personas) |
| **C. Wallet cripto / stablecoin NO custodial** (el usuario guarda sus llaves) | Genera una dirección/solicitud de pago; nunca guarda llaves ni fondos | **No** si es estrictamente no custodial (FinCEN 2019: las "unhosted wallets" no son money transmitters; Google exime las no custodiales) | **Alto**: llaves, firmas, nodos/relays, on/off-ramp fiat (eso sí regulado) | Mala para público general LatAm (volatilidad, direcciones, gas, fraude irreversible) | Comisiones de red; ramp fiat con terceros licenciados |
| **D. "Tipo PayPal" con saldo, vía SOCIO licenciado** (IFPE en MX / EMI en UE; NEXO es su proveedor de tecnología) | UX de saldo y pagar a un contacto sin salir de la app, **pero el saldo y la custodia son del socio** | **No propia** (la pone el socio); NEXO firma contrato de proveedor técnico | **Alto**: integración de API, KYC del socio, conciliación, soporte | La mejor (pago dentro de la app) | Parte de la comisión del socio (ingreso para NEXO) |
| **E. Saldo/"cartera NEXO" propia** | NEXO guarda dinero de usuarios | **SÍ** (IFPE/CNBV en MX, EMI en UE, money transmitter en EE. UU.) — **caro y lento; evitar** | Muy alto + capital regulatorio | — | — |

**Por qué A/B/C/D no necesitan licencia y E sí**: la línea la marca la **posesión o el control de los fondos**.
En la UE, el proveedor "técnico" que nunca entra en posesión de los fondos queda fuera de PSD2 (art. 3, exención
del *technical service provider*); basta con poder *disponer* del dinero —aunque sea un instante— para caer dentro.
En EE. UU., FinCEN trata al software no custodial como **no** transmisor de dinero. En México, administrar o
transmitir "fondos de pago electrónico" (un saldo) exige ser **IFPE** autorizada por la CNBV (Ley Fintech art. 22;
multas de hasta 12,6 M de pesos y hasta 15 años de prisión). El concepto clave, probado por el esquema europeo
**SEPA Request-to-Pay**: *una solicitud de cobro no es un instrumento de pago ni un sistema de pago, es un servicio
de mensajería* — el dinero se mueve después, por el banco del que paga. Eso es lo que NEXO puede hacer hoy.

**Aviso: la línea se está estrechando.** Hay comentaristas y algún caso en EE. UU. (Samourai Wallet) en que se
acusó de transmisión de dinero sin licencia a software "no custodial" porque había una **infraestructura central
que facilitaba las transacciones**. Lección para NEXO: no montar un servidor que "case" pagos ni que los liquide;
quedarse en mensajería pura y en enlaces a terceros licenciados. Confirmar con abogado (ver §4).

## 2. Recomendación para NEXO

**NEXO como "mensajería de cobros" no custodial.** Combinar **B** (cobro P2P con datos/enlace/QR, el músculo
propio que funciona sin internet) con **A** (enlace/QR de un proveedor licenciado para un toque). El dinero nunca
pasa por NEXO. Es coherente con `PLAN_NEGOCIO.md` §5 y con la marca (privacidad, sin tocar las cuentas del usuario).

### Plan por fases
- **Fase 1 — "Cobros" en el chat (sin licencia, sin servidor, sin API externa).** Un tipo de mensaje nuevo:
  tarjeta con importe, moneda, concepto y el método de pago que el que cobra ya tiene (CLABE/celular DiMo, su
  enlace de Mercado Pago o PayPal, Pix copia-e-cola, o QR EPC con IBAN en Europa). Botones: "copiar datos", "abrir
  mi banco", "mostrar QR". Estados: **solicitado → pagado (según quien paga, con referencia/foto) → cobrado**
  (lo confirma quien cobra). Historial de cobros por contacto. **Viaja cifrado por Bluetooth/Wi-Fi/Jump e internet,
  igual que un texto** — llega sin datos y el pago real se hace cuando el que paga tiene conexión (o en efectivo, y
  se marca "cobrado"). **Prohibido en esta fase**: saldos, comisión por pago, vales transferibles, entrar a cuentas
  bancarias. Caso papelería (del plan): PDF → imprime → "Cobro: 12 MXN, impresión" → paga por transferencia/DiMo/
  efectivo → "cobrado".
- **Fase 2 — un toque de verdad, con proveedor licenciado.** Para comercios de NEXO Negocios: crear el enlace/QR
  al vuelo con la **API del proveedor** (Mercado Pago "marketplace" con `marketplace_fee` —cada vendedor conecta su
  cuenta y NEXO cobra su parte—, Clip u Openpay; en Brasil, Pix por API devuelve `ticket_url`, QR en Base64 y
  copia-e-cola). Aquí aparece el **ingreso** de NEXO: una parte de la comisión a comercios. El saldo (si se quiere
  "tipo PayPal", vía D) lo lleva el socio con licencia; NEXO es su proveedor técnico. **Ojo: Stripe no sirve para
  pagos entre personas** (solo cobros a comercios).
- **Fase 3 — opcional y más adelante.** Aprovechar el QR homologado de Banxico (si la especificación permite que
  una app de terceros lo genere: **sin confirmar**) para pago de un toque desde cualquier banco; wallet cripto no
  custodial (vía C) si hay demanda real; o licencia propia (IFPE) solo si el volumen lo justifica (`PLAN_NEGOCIO.md`
  §5.4).

## 3. Cómo encaja técnicamente en NEXO

NEXO ya tiene todo lo necesario; un "cobro" es **un tipo de mensaje más**, no un subsistema.

- **Patrón a seguir — el de las acciones de chat que YA existen** (`src/ui/chat_actions.js`): los mensajes
  estructurados son JSON con un campo `type` (`nexo_txt`, `nexo_act` para editar/reaccionar/eliminar), se mandan
  con `_sendTextTo(cid, JSON.stringify({…}), '', true)` **cifrados de extremo a extremo**, viajan por cualquier vía
  (Bluetooth, Wi-Fi, internet, Jump) y se guardan/renderizan vía `vault_manager.js`. La compatibilidad con builds
  viejas ya está resuelta con `_peerUnderstands(cid)` (si el otro no entiende el tipo nuevo, degrada a texto).
- **Propuesta**: un tipo `nexo_cobro` (o adjunto tipo tarjeta, como ubicación) con los campos de la fase 1
  (importe, moneda, concepto, método, datos/enlace/QR, estado). Se dibuja como **tarjeta en el chat** (hay sitio
  claro: ya existen burbujas de foto/vídeo/archivo/voz/ubicación). Los cambios de estado (pagado/cobrado) pueden
  ir por el mismo molde `nexo_act` (como "editar"/"reaccionar"), firmados E2E, y persistir en el vault.
- **El dinero NO pasa por NEXO**: la tarjeta solo **lleva datos y abre apps externas** (intent al banco, abrir URL
  del proveedor, copiar al portapapeles, generar un QR localmente). Ninguna pantalla de banco vive dentro de NEXO y
  NEXO no tiene credenciales de pago de nadie.
- **Hallazgo del código actual (importante)**: existe un **prototipo latente** en `src/app/nexo_app.js`
  (`_sendPayment`, `_showPaymentModal`, tipos `payment`/`transfer`/`payment_response`, con "Aceptar/Rechazar" y una
  firma **falsa** `_signPayment` que devuelve `'SIG_'+…`). Lo importa `main.js`, pero **nada dispara nunca** el
  evento `nexo:payment:request`, así que no es una función viva. Ese prototipo modela justo el camino **equivocado**
  (parece que NEXO *media/transfiere* dinero, estilo custodial, con firma inventada). **Recomendación: no
  construir sobre él; retirarlo o dejarlo fuera del build** y hacer "Cobros" con el patrón `nexo_act`/vault descrito
  arriba. (Dejarlo como está no rompe nada hoy, pero conviene limpiarlo antes de la tienda; en la build 2744 ya se
  tuvo que "escapar" el contenido de esas tarjetas de pago en los registros.)

## 4. Riesgos y qué consultar con un abogado
- **Regulatorio (el grande)**: confirmar que el flujo de la fase 1 es "mensajería/solicitud de cobro" y **no**
  transmisión de dinero ni emisión de dinero electrónico en el país de lanzamiento. En México, aclarar si generar
  un QR de SPEI/CoDi o un cobro con alias homologado **exige registro en Banxico** (sin confirmar) y si hay que
  declararse ante la CNBV por algo. No montar nada que "case" o liquide pagos en un servidor de NEXO (riesgo tipo
  Samourai). No cobrar comisión por el movimiento de dinero en la fase 1.
- **Tiendas (Google Play)**: los **bienes y servicios físicos** (imprimir, un café) y los **pagos entre personas**
  **no** usan la facturación de Google Play (y no pagan su comisión); lo que sí la exige son los **bienes digitales**
  dentro de la app (ahí NEXO Plus, por ejemplo, sí usa Play Billing). Hay que declarar bien las **"funciones
  financieras"** en la ficha de Play, la política de privacidad y la sección de seguridad de datos. Si en la fase 3
  se añade wallet cripto, revisar la política de "Cryptocurrency Exchanges and Software Wallets" (las **no
  custodiales están exentas** de la exigencia de licencia desde la aclaración de Google de 2025, pero hay que
  cumplir el resto).
- **Marca**: "Nexo" es una plataforma de criptomonedas con marcas en finanzas (`PLAN_NEGOCIO.md` §6). **No llamar al
  módulo "NEXO Pay" ni "NEXO Card"**; usar "Cobros". Búsqueda de marca antes de la tienda y de los pagos.
- **Protección al usuario y fraude**: dejar claro en la UI que NEXO **no garantiza** el pago ni lo custodia (es como
  mandar los datos de tu banco por WhatsApp, pero cifrado y sin internet); anti-spam de solicitudes; no mostrar
  "cobrado" sin que lo confirme quien cobra.
- **Qué llevar al abogado**: país; el flujo exacto de la fase 1 (con capturas); si se usa API de un proveedor, su
  contrato; el texto de la declaración financiera de Google Play; y la pregunta de Banxico/QR homologado.

## 5. Fuentes
**La línea custodia = licencia / no custodia = sin licencia**
- Non-custodial generalmente fuera del money transmitter (vendor, verificar): https://www.dynamic.xyz/blog/everything-remittance-companies-need-to-know-about-stablecoin-licensing
- "El fin del no custody, no problem" (comentario, verificar): https://faisalkhan.com/resources/magazine/regulation-licensing/the-end-of-the-no-custody-no-problem-era-how-regulators-are-redefining-money-transmission
- Caso Samourai Wallet / riesgo de infraestructura central (comentario): https://bastion.com/blog/the-implications-of-the-samourai-wallet-case-self-custody-and-money-transmission
- UE, PSD2 art. 3 (texto): https://www.legislation.gov.uk/eudr/2015/2366/article/3/data.html
- UE, exención "technical service provider" (poder *disponer* de fondos = dentro): https://paytechlaw.com/en/lets-distinguish-technical-service-provider-or-payment-initiation-service/ · https://ixopay.com/blog/ixopay-as-a-technical-service-provider-within-psd2
- México, Ley Fintech art. 22 (IFPE) y sanciones: https://mley.mx/LRITF/articulo/22/ · https://expansion.mx/tecnologia/2019/10/07/fintech-no-autorizada-cnbv-pagara-hasta-12-6-millones-pesos

**"Solicitud de cobro" = mensajería, no un pago (el modelo de NEXO)**
- SEPA Request-to-Pay: "ni instrumento ni sistema de pago, un servicio de mensajería": https://paytechlaw.com/en/sepa-request-to-pay-srtp/ · https://jasshah.substack.com/p/under-the-hood-how-sepa-request-to

**Enlaces/QR de proveedores licenciados**
- Stripe Payment Links (solo comercios; no sirve P2P): https://docs.stripe.com/payment-links · https://docs.stripe.com/payments/no-code · lista de prohibidos/P2P: https://support.stripe.com/questions/prohibited-and-restricted-businesses-list-faqs
- PayPal.Me (el que cobra necesita cuenta; el que paga no): https://www.paypal.com/us/webapps/mpp/paypal-me-personal
- Mercado Pago "marketplace" (`marketplace_fee`): https://www.mercadopago.com.mx/developers/en/docs/checkout-api-payments/how-tos/integrate-marketplace.md · Pix por API (`ticket_url`, QR Base64, copia-e-cola): https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/payment-integration/pix
- México: DiMo/CLABE y QR homologado de Banxico (antes del 14-dic-2026): https://www.elfinanciero.com.mx/economia/2026/06/18/banxico-publica-nuevas-reglas-para-pagos-digitales-como-te-afectan-y-que-cambia-en-tus-transferencias/
- Europa: QR EPC (IBAN): https://europeanpaymentscouncil.eu/sites/default/files/kb/file/2022-09/EPC069-12%20v3.0%20Quick%20Response%20Code%20-%20Guidelines%20to%20Enable%20the%20Data%20Capture%20for%20the%20Initiation%20of%20an%20SCT_0.pdf

**Tiendas y cripto**
- Google Play, qué exige/exime su facturación (bienes físicos exentos): https://support.google.com/googleplay/android-developer/answer/10281818 · excepciones: https://support.google.com/googleplay/android-developer/answer/9858738 · https://play.google.com/about/monetization-ads/payments
- Google exime las wallets cripto **no custodiales**: https://thedefiant.io/news/regulation/google-reverses-course-says-non-custodial-crypto-wallets-stay-on-play-store-87fb8b2a · https://decrypt.co/335134/google-non-custodial-wallets-exempt-new-crypto-app-rules-play-store

**Dentro del repo**: `docs/PLAN_NEGOCIO.md` §5 (pagos sin licencia) y §6 (marca); `src/ui/chat_actions.js`
(patrón `nexo_act`/`nexo_txt`, E2E, `_peerUnderstands`); `src/app/nexo_app.js` (prototipo custodial latente a
retirar).
