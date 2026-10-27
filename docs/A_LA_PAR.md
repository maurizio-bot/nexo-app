# NEXO — Qué falta para estar «a la par» de la competencia (para decidir)

Pedido del dueño (27-10-2026): saber qué falta implementar para, como mínimo, estar a la par de WhatsApp / Telegram /
Signal, y decidir en qué avanzar. Construye sobre `docs/COMPARATIVA.md`. Sin humo: marco lo chico, lo grande y lo que
no es «código que falta» sino decisión/licencia.

## 0. Dónde ya estás a la par o MEJOR (base, no hay que hacer nada)
Mensajería y privacidad P2P: **sin internet (Bluetooth), malla/Jump, Wi-Fi local/Direct, cifrado de extremo a extremo +
poscuántico, sin número de teléfono, ID que rota, copia de seguridad Fénix (sin servidor), archivos hasta 1 GB en local,
llamadas de voz y videollamada en local, grupos con medios, foto de perfil, responder/reenviar/reaccionar/editar/eliminar,
notas de voz, ubicación, compartir contacto, «Cobros»**. En lo de «funciona sin señal + privacidad» NEXO va **por delante**.

## 1. Chicos / rápidos (se hacen en 1–2 builds)
- **Autocorrecto y sugerencias del teclado** — hoy están **apagados** a propósito en el campo de mensaje
  (`spellcheck="false"`). Activarlos es «jalarlos»: `spellcheck="true"` + autocapitalización. Es de Android/Gboard, sí.
- **Moneda del «Cobro» automática por país** — hoy la lista arranca fija en **ARS**; detectar el país por el idioma/región
  del teléfono y poner la moneda por defecto (MXN en México, etc.).
- **Buscar dentro de un chat** (lupa) — WhatsApp/Telegram/Signal lo tienen; NEXO **no**. Buscar texto en el chat abierto.
- **Mensajes que se borran solos** (temporales) — opción por chat; la competencia lo tiene.
- Detalles sueltos que ya están en `PENDIENTES.md`: botón de descarga de foto/vídeo (#92), aviso con solo icono (#89),
  «ver una vez» (#94).

## 2. Medianos
- **Buscar en TODOS los chats** (buscador global) — además del buscador dentro de un chat.
- **Estados / historias** — la competencia los tiene; en NEXO es parte del **Stream** (#95, aún SIN DECIDIR, ver
  `docs/STREAM_PROPUESTA.md`).
- **Archivar / silenciar / fijar chats y mensajes** — gestión de la lista de chats como la competencia.
- **Bluetooth inestable con algunos teléfonos** (el «○ + Reintentar»): el MTU cae a 23 y se reconecta cada pocos segundos.
  Es nativo; mejora la fiabilidad real (no es una función, es robustez).

## 3. Grandes (cada uno es un proyecto)
- **Internet de verdad (lo que ya priorizaste):**
  - **#2 Archivos grandes por internet** (APK, fotos/vídeos pesados) a trozos por Tor.
  - **#3 Videollamada por internet** (y llamada de voz por internet) — hoy solo en local.
  WhatsApp hace TODO por internet; esto es lo que más se nota con un contacto lejano.
- **App para iPhone (iOS)** — hoy NEXO es **solo Android**. Sin iOS queda fuera medio mercado. Es casi otra app (el plugin
  nativo es Kotlin/Android; iOS necesita su propio desarrollo). **Es lo más grande de toda la lista.**
- **Publicar en Play Store** — hoy se instala por APK (fuera de la tienda). Estar en la tienda = alcance y confianza
  reales; implica cumplir requisitos de Google (permisos, políticas, revisión). Mediano en esfuerzo, importante para «a la par».
- **Medir y optimizar la batería** en segundo plano (hoy sin medir) y **#87** (recibir con la app cerrada): confianza.
- **Auditoría externa** y uso a gran escala (muchos teléfonos a la vez): para que se pueda confiar de verdad (largo plazo).

## 4. Pagos — aclaración importante (no es «código que falta», es decisión/licencia)
Lo que pediste —**una cuenta con saldo, agregar dinero desde el banco y transferir dinero de verdad**— es una
**billetera** (NEXO guardaría/movería tu dinero). Eso es **custodia de dinero** y en México (y casi en todos lados)
**exige licencia financiera** (ser una ITF bajo la Ley Fintech, supervisada por CNBV/Banxico) **o** usar un **socio con
licencia** (Mercado Pago, un banco). Es un proyecto legal y grande, no un pendiente de programación.

Por eso lo que hay hoy —**«Cobros»**— está hecho a propósito **sin saldo**: es «mensajería de cobros» (como mandar una
factura con tu alias/CoDi/QR), el dinero va **por fuera** (SPEI/CoDi/Mercado Pago entre las cuentas de ustedes), y así
NEXO **no necesita licencia**. Es la **Fase 1** del plan (`docs/PAGOS_PROPUESTA.md`, `docs/RENTABILIDAD_MX.md`).

Caminos para lo que pides (billetera con saldo):
- **Fase 2 — socio con licencia** (p. ej. Mercado Pago / CoDi de Banxico): NEXO pone el chat y la interfaz; el socio pone
  la cuenta, el saldo y «agregar dinero desde el banco». Meses, con acuerdo comercial.
- **Fase 3 — licencia propia (ITF):** control total, pero caro y lento (trámite CNBV), solo si el volumen lo justifica.
- Mejora rápida mientras tanto: la moneda automática por país (arriba) y dejar el «Cobro» bien pulido.

## 5. Mi sugerencia de orden (para discutir)
1. **Rápidos** que más se notan y dan imagen de «app seria»: **autocorrecto**, **moneda automática**, **buscar en el chat**.
2. **Internet de verdad** (#2 archivos grandes, luego #3 videollamada): es lo que te falló con el contacto lejano.
3. **Decidir Estados/Stream** (sí/no) — define una parte grande de la hoja de ruta.
4. **Distribución**: Play Store primero (más barato), iOS después (lo más caro) — cuando el núcleo esté sólido.
5. **Pagos con saldo**: solo si decides ir por un **socio** (Fase 2); si no, dejamos «Cobros» pulido.

> Para avanzar necesito que elijas: ¿atacamos primero **los rápidos** (autocorrecto, moneda, buscar), o prefieres que
> siga con **internet de verdad** (#2/#3) como habíamos quedado? Y para pagos: ¿quieres que explore un **socio con
> licencia** (Mercado Pago/CoDi) o por ahora dejamos los «Cobros» sin saldo?
