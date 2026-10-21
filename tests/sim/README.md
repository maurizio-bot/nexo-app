# Simulador de dos teléfonos

Ejecuta el bundle web **real** de la APK en dos "teléfonos" (jsdom) unidos por `native_mock.js`,
una réplica de `plugins/nexo-ble/.../NexoBlePlugin.kt` (campos que lee cada método, troceo por MTU,
reensamblado JSON de `processReceivedChunk`, eventos y su orden).

```bash
cd tests/sim && npm install          # una vez (jsdom)
./build.sh            # compila el árbol de trabajo en builds/wip
node run.js builds/wip --content-fallback
./build.sh 04960e2 && node run.js builds/04960e2   # comparar con otra versión
```

Escenario (todo por la interfaz: botones, input, menú de adjuntos):
1. A busca a B y lo añade; A abre el chat y envía un texto corto y uno largo (>180).
2. B abre el chat y responde; A envía otro con el chat de B abierto (debe llegar a "leído").
3. A envía un archivo (misma transferencia que las fotos).
4. B y A cierran y reabren el chat: el historial guardado debe mostrar todo con su estado.
5. B se aleja, A escribe, B vuelve: debe llegar una sola vez.
6. B se aleja, A escribe y **reinicia la app**, B vuelve: debe llegar y guardar su estado.

La línea `RESULTADO` resume cada comprobación. Los logs de ambos teléfonos quedan en `last_logs_*.txt`.

Límites: no simula la radio real (alcance, interferencias, direcciones aleatorias de Android entre
escaneo y conexión), ni la cámara/canvas, ni el código Kotlin en sí (solo su comportamiento).
