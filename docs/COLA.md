# Cola de trabajo (ordenada 23-11 13:45; lo anterior, con el detalle de cada punto: `docs/historial/COLA_hasta_2026-11-23.md`)

Regla: una sesión = un tema; una APK por tanda; antes de subir `tamano.js`, `i18n_audit.js` y las pruebas nuevas. Tallas: [c] chico, [m] medio, [g] grande.

## Abierto (en orden)
1. [g] **Puente nativo con la app dormida** (🔴 1 y 5; DUEÑO 23-11 14:14: se hace YA con Opus, no se espera al reinicio del domingo;
   ritmo ~6–7 % semanal por día; el 10 % de Fable se guarda para revisar el nativo antes de la APK). «Vuelve sola» ya existe (3189/3192:
   arranque, actualización, alarma ~15 min); fases 2–4 hechas. FALTA: un paquete Jump para OTRO ('to' ≠ yo) que llega al nativo con la
   app dormida/cerrada hoy no recibe custodia ('rk') → el que lo manda reintenta ×8 y queda ⏳ (vivo nx09acdb61, PENDIENTES 14-11).
   Diseño a cerrar al empezar (leer solo esto): `ble_relay.js` cabecera (custodia 'rk', cola, ack de punta a punta) · `SinAppCore.kt`
   (qué hace hoy con lo que llega) · `NetOutbox.kt` (¿puede subir un paquete ya cifrado para un NEXO que NO es contacto?) · `OutboxBle.kt`.
   **HECHO 3315 (23-11, sin APK aún):** el nativo (plugin con la app dormida/cerrada y BleSinApp sin la app) REENVÍA por Bluetooth el paquete
   Jump (chat, sx, ack, read_receipt; 'to' ≠ yo, ≤ 8 saltos) tal cual por el enlace de su destino; sin enlace lo guarda 10 min y sale en
   cuanto ese enlace hable; a un contacto mío solo por enlace comprobado (reto 3A); batería como canRelay. SIN custodia 'rk' (decidido:
   la custodia hace que el emisor suelte la bandeja de internet; sin ella nada queda peor que antes). El destino, sin ruta de vuelta, manda
   su ✓✓ también por el enlace por donde llegó (`ble_ack.js` _sendRouted). Pruebas: `JumpNativeTest` (9) y `jumpdormido.js`.
   Descartado el «por internet» del paso 1: el nativo solo puede sellar para SUS contactos (clave de pareja). FALTA (paso 2): que el nativo
   conteste 'rq' (¿quién llega a X?) si X tiene enlace con él → **HECHO 3315b** (solo a contactos: el 'rp' lleva mi NEXO ID, regla 12A;
   solo último salto, no sigue preguntando). FALTA: los flujos (textos largos/archivos en trozos 'dt') por un puente dormido; y
   ANTES DE LA APK, la revisión del nativo con Fable (`OutboxBle.kt` parte 3315). Pruebas del dueño al salir: ver ESTADO.
2. [m] **13 MTU 23** (Vivo Y03, Katy): 3312 — con el enlace a MTU 23 el canal rápido L2CAP entra desde ~6 KB (antes ~45 KB); `l2mediano.js` caso `mtu23`.
3. [m] **Wi-Fi Direct en teléfonos reales** (🔴 6): pruebas del dueño + «grupo siempre montado» si elige B (A/B pendiente de él).
4. [m] **Llamadas**: gasto de datos por relés. «Sin imagen propia al contestar desde el aviso»: 3313 (la cámara se reabre aunque el WebView siga «oculto» si Android ya dice primer plano; `callmedia.js` 9b), por probar. Eco de grupo hecho (3301), por oír.
5. [m] **23 entrega con app CERRADA y pantalla APAGADA**: en vigilancia (23-11 Vivo→S24 llegó en 1 s y sonó).
6. [g] **26 Google Play**: parte web hecha (`NEXO_STORE`); falta targetSdk 35/36 y lo del dueño (cuenta, paquete, privacidad, 12 probadores).
7. [g] **Auditoría de seguridad final** (una, al privado) antes de la tienda.

## En vigilancia (hecho; solo mirar en los diagnósticos que lleguen)
16/16b/16c enlaces repetidos y desempate · 15 «ocupado» 201 (3262) · 27 Wi-Fi sin internet (3266, 3270) · 28 (cerrado: lo cubre 3016) ·
34 deslizar para actualizar (de raíz) · 35 «→ ?» · 36 enlace que se cierra (3267) · 17 texto atorado (3299) · 18 hueco al cambiar de red (3300) ·
22 tarjeta «silencia» · 24 datos repetidos (cerrado 23-11: es redundancia) · 29/29b · 3261 WD por tiempo · 7–12 medición · multitud (3284, 3285).

## Hecho y sin vigilancia especial
Grupos G1–G9 · 30 fondos · 31 vista previa real (3309) · 32 letra grande · 33 Apariencia · WD «cancelar» (3287) · 14 L2CAP mediano (3288).
