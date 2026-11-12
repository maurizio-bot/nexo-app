# Pruebas físicas pendientes (dueño 12-11: «la lista de las pruebas físicas que hacen falta»)

Con la **3033 (nightly-3030) o posterior en TODOS los teléfonos** (el actualizador de Perfil → Ajustes lo hace solo).
Si algo falla: **Perfil → Copiar diagnóstico** en los dos teléfonos y pegármelo. Cada prueba dice qué tiene que pasar.
Se marca aquí lo confirmado (✅) o lo que falló (❌ + diagnóstico).

## A. Lo arreglado hoy (12-11) — rápidas, 2–3 min cada una
1. **Foto de perfil (3028).** En tu teléfono: Roberto y Marcos salen con sus iniciales, no con tu foto. Toca la foto de
   un contacto: se abre grande **sin** botón de guardar. En otro teléfono, Perfil → poner TU foto: la rechaza con
   «es la foto de perfil de …».
2. **Enlaces que se abren y cierran (3027).** Dos teléfonos juntos con la app abierta 5 min: el chat entre ellos sigue
   en Bluetooth sin cortes (no llega el aviso automático «enlace_abre_cierra»).
3. **Reenvío sin fin (3026 + 3029).** Deja los teléfonos juntos 30 min con la app en segundo plano: el respaldo Fénix no
   repite el mismo envío (no llega el aviso «reintentos» de un `fxs_…`).
4. **Bluetooth con un teléfono que no responde (3025).** Uno con el Bluetooth del otro apagado 5 min: el primero deja de
   insistir (en su diagnóstico sale «pausa» y no 20 líneas «no_service» seguidas).

4a. **Pausa de Bluetooth (3033).** S24 y Motorola juntos 10 min con la app abierta: si sale «pauso Bluetooth» en el
   diagnóstico del S24, debe salir UNA vez (no 15–20 seguidas) y los mensajes siguen por Wi-Fi/internet.
4d. **Mensajes al volver (3033).** Deja tu app en segundo plano 5 min; que otro te escriba 3 mensajes por internet (lejos). Al tocar
   el aviso, los 3 ya están en el chat al abrirlo (no aparecen después).
4c. **Foto de perfil (3033).** En el Honor: tu foto se ve en tu contacto y la copia del otro contacto sale con iniciales.

4b. **Estados v3 (3032).** Publica 3 estados (uno con foto grande): en otro teléfono salen «(3)», se recorren con ‹ ›, la foto
   carga al abrirla. Dale me gusta y comenta uno: en «Mis estados» del dueño se ve quién y el comentario. En Contactos, desliza
   hacia abajo: «Actualizando estados…». Mantén pulsado un sticker propio que te mandaron → «Agregar a mis stickers».

## B. Cambio de camino y archivos
5. **Wi-Fi que se corta (3022/3023).** Los dos en el mismo Wi-Fi, chat abierto; apaga el Wi-Fi de uno y escribe enseguida:
   el texto llega en 2–5 s por Bluetooth. Vuelve a encenderlo: sigue por Wi-Fi.
6. **Foto a alguien lejos (solo internet).** Manda una foto a un contacto que NO esté cerca: llega una sola vez y no se
   queda «enviando» por Bluetooth.
7. **Wi-Fi Direct (abierto).** Los dos con el **Wi-Fi ENCENDIDO** (sin estar en la misma red), cerca, manda un vídeo de
   1–5 MB. Diagnóstico de los dos aunque funcione (líneas `[WIFI-DIRECT]`).
8. **Archivo grande por Wi-Fi.** En el mismo Wi-Fi, un vídeo o APK de 20–25 MB: avanza hasta el final.

## C. Avisos
9. **Avisos fantasma (3012).** Durante un día normal: ¿sale algún aviso de NEXO sin mensaje nuevo al abrir el chat? Si
   sale, diagnóstico del teléfono que lo mostró en ese momento.
10. **Pantalla apagada.** Un teléfono con la pantalla apagada 3 min; mándale un texto: suena el aviso y en el que manda
    sale ✓✓. Repite con la app quitada de recientes.
11. **Tocar el aviso** abre el chat de quien escribió (también con Ajustes o un perfil abiertos encima).

## D. Llamadas (lo más viejo sin confirmar)
12. **Voz con altavoz en habitaciones distintas:** ¿eco? ¿se cortan al hablar los dos? Diagnóstico de los dos (`[CALL]`).
13. **Videollamada** Vivo ↔ S24 tres veces seguidas: imagen y voz en las dos; contestar con la pantalla bloqueada.
14. **Llamada con la app cerrada:** llamar a un teléfono con NEXO quitado de recientes: suena a pantalla completa.

## E. Agregar y actualizar
15. **«Agregar»** con 3 teléfonos cerca: salen todos con su nombre en segundos (también uno con la app en segundo plano).
16. **Actualizador:** Perfil → Ajustes → Actualizaciones en un teléfono atrasado: descarga e instala la última.

---
La lista anterior (de la build 2899) quedó en el historial de git (`git show 24dca8f8:docs/PRUEBAS_FISICAS.md`); lo suyo que sigue vigente está arriba.
