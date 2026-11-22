# NEXO — panorama de cada red (para pulir, no solo arreglar)

Pedido del dueño (20-11): cuando los diagnósticos bajen, el trabajo pasa de «resolver problemas» a **pulir, robustecer y hacer más eficiente cada camino**
(Bluetooth, Wi-Fi local, Wi-Fi Direct, internet, puente…). Para eso, de cada camino hay que tener claros cuatro números: **velocidad de conexión**,
**velocidad de transporte**, **capacidad** y **fallas que se repiten**. Principio (CLAUDE.md): se mide para MEJORAR cada camino, nunca para cerrar ninguno.
Este archivo es el tablero: qué sabemos (con fecha y fuente), qué falta medir y cuál es el siguiente cuello de botella. Se actualiza con cada tanda.

## Qué mide hoy el diagnóstico (por camino)

| | conexión lista | transporte (archivos) | entrega de mensajes (✓✓) | capacidad | fallas con causa |
|---|---|---|---|---|---|
| Bluetooth | ✓ media/mín/máx (3081) | ✓ KB/s de extremo a extremo (3081) | ✓ por camino al salir (3259) | ✗ | síntomas (zombi, abre/cierra…) por día (3259) |
| Wi-Fi local | ✓ | ✓ | ✓ (3259, junto con Wi-Fi Direct) | ✗ | síntomas |
| Wi-Fi Direct | ✓ (3258) | ✓ de extremo a extremo + PURA + del lado que recibe (3258) | ✓ (como Wi-Fi) | ✗ (grupo ≈ 1 por teléfono) | ✓ 12 causas, reintentos del sistema y código (3258) |
| internet (relés) | ✓ | ✓ buzón de archivos e internet directo | ✓ | ✗ | parcial (relés caídos, rechazos) |
| puente Jump | ✗ | ✗ | ✓ (como «puente de otro NEXO») | ✗ | síntomas |
| Tor | ✗ | ✗ | ✗ | ✗ | ✗ |

Se mide también: batería y temperatura por llamada (3256) y por transferencia de Wi-Fi Direct (3258), tiempo de preparar un archivo grande (3258),
efecto de Wi-Fi Direct sobre el Wi-Fi normal (3258) y por qué se eligió o no Wi-Fi Direct para cada archivo (3258).

## Lo que sabemos hoy (datos reales; fuente: diagnósticos del 19-11, build 3113 salvo que se diga)

**Bluetooth (GATT; L2CAP aparte)**
- Conexión lista: S24 0,4 s de media (84 veces, de 0 a 1,2 s); vivo 1,4 s (19 veces, hasta 4,7 s); S23 6,3 s (73 veces, **máximo 377 s**: la media engaña, hacen falta percentiles).
- Transporte: ≈ 17–18 KB/s de extremo a extremo para una foto de 40 KB con MTU 512 (el dueño midió igual el 12-11: 143 K letras en 8 s).
- MTU: 517 normal; **23** en enlaces recuperados tras reabrir la app (arreglado en 3251) y en el enlace de servidor del vivo Y03 (que no negocia). Con MTU 23 una foto son minutos.
- Fallas (84 diagnósticos registrados): zombi 23, enlaces repetidos 9, servidor GATT rehecho al abrir 4 (3251), enlace viejo tras apagar el Bluetooth 3 (3250).
  Causa más común: la app del otro congelada o muerta por ahorro de batería (13). Pendiente: el bucle abrir/cerrar con el vivo (3257, en la próxima APK).
- Capacidad: sin medir. Android suele dar 5–7 enlaces; no sabemos cuántos llegan a haber a la vez en el uso real.

**Wi-Fi local (mDNS / mismo Wi-Fi)**
- Conexión lista: S24 0,8 s (8 veces, de 0,3 a 2,2 s); vivo 26 s de media (5 veces, **hasta 74 s**: otra media que engaña).
- Transporte: sin cifra propia limpia (un grupo de Wi-Fi Direct también aparece como «Wi-Fi local»; ver «Menores» abajo).

**Wi-Fi Direct** (primeros datos, S24 ↔ vivo sin ninguna red, 19-11 23:22–23:25)
- Montar el grupo 0,3–0,4 s; unirse 2,2–2,8 s; 5,4 MB en 3 s; 23 MB en 3,1 s; 153 MB en 6,3–7 s (≈ 22–24 MB/s con el montaje, ≈ 39 MB/s puros).
- ≈ 1 500 veces más rápido que el Bluetooth bueno para archivos grandes. Sin medir aún: batería, cuántos teléfonos a la vez, efecto sobre el Wi-Fi normal.
- Menores: tras bajar el grupo el módulo de Wi-Fi local escribe «este teléfono no tiene Wi-Fi» (falso) y el vivo reintenta la IP del grupo caído (ENETUNREACH).

**Internet (relés) y buzón de archivos**
- Conexión lista: 2,1 s de media (26 veces, de 0,3 a 9,5); al abrir el chat 6 s (10 veces, de 0,7 a 20,9).
- Texto: ✓✓ típico en 0–2 s (línea de tiempo del dueño 19-11).
- Archivos: buzón enviados 15, media 24,5 KB/s (de 4,1 a 129,5); recibidos 19, media 213 KB/s (de 12 a 675); por internet directo 6,8–7,1 KB/s (2 muestras).
- Datos repetidos de los relés: 968 de 1 747 eventos «ya vistos» (55 %) en 88 min = 5,7 MB; el S24 movió 1 632 MB en el día (1 242 por Wi-Fi). 3249 ya recortó el margen al reconectar.
- Fallas conocidas: un relé castigó por rate-limit al pasar una copia grande; el toque (despertador) fallaba por CORS (arreglado, 3248/3107).
- «Presto internet» (puente a internet): 2 sesiones, 72 subidos, 4 rechazados en un día del S24.

**Puente Jump (multi-salto por Bluetooth)** — funciona (un chat de 23 KB por el puente de Austin en 5 s); sin métricas propias. Débil: un contacto con la app en segundo plano contesta pings pero no reenvía; un paquete de puente reintentando sin confirmar durante horas.

**Tor** — «Tor listo» en ≈ 3,5 s al llamar (S23); sin más datos.

## Cuellos de botella detectados (ordenados por cuánto le duelen al usuario)

1. **Preparar (cifrar a disco) un archivo grande: ≈ 5 MB/s.** 153 MB tardan 30–34 s en prepararse y 6–7 s en viajar por Wi-Fi Direct: el usuario espera 5 veces más en la preparación que en el envío. (3258 deja el tiempo en el registro.)
2. **Bluetooth a ≈ 17 KB/s** para archivos medianos cuando no hay Wi-Fi Direct ni Wi-Fi: ¿se usa L2CAP (más rápido) en esos casos? Por revisar.
3. **MTU 23** en ciertos enlaces/teléfonos: hay que saltarlo (L2CAP para lo grande, o preferir el enlace donde NEXO es cliente) y contar cuántas veces ocurre por contacto/modelo.
4. **Repetidos de los relés** (55 % de los eventos): datos y batería gastados sin motivo.
5. **Medias que engañan**: conexión lista con picos de 74 y 377 s; falta mediana y percentil 90 para ver lo típico y lo peor por separado.
6. **App del otro congelada por el fabricante**: el nativo ya contesta pings; falta que confirme y reenvíe sin la página.

## Medido desde el 22-11 (COLA 7–11)
- Mediana y percentiles por camino en «conexión lista» (p90) y en velocidades (p10: lo malo de una velocidad es lo lento), con ≥ 10 muestras (hasta 200 por camino y día); la media sigue saliendo.
- Fallas con causa en Wi-Fi local, internet, Jump y Tor (se cuentan desde el registro, sin tocar los caminos): «fallos con causa por camino hoy: …».
- Capacidad: pico de enlaces Bluetooth a la vez (cada 45 s, con la app a la vista) y pico de transferencias de Wi-Fi Direct a la vez.
- Cronómetro de actividades: de soltar una foto/archivo/vídeo/audio a su ✓✓, por tipo y camino.
- Batería y temperatura también en la llamada de grupo.
- Tablero: `node tests/sim/diag_stats.js` da la TENDENCIA por día, por build, por hora y síntoma por día (campos opcionales `origen` y `build` en `docs/diagnosticos.json`).

## Siguiente en medir (no hecho)
- Clientes reales del grupo de Wi-Fi Direct (el nativo aún no los da a la app).
- Prueba corta del dueño: el mismo archivo por Bluetooth y por Wi-Fi Direct entre dos teléfonos, batería de ambos lados (los números salen solos en «Copiar diagnóstico»).
