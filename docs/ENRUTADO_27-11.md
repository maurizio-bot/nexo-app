# Enrutado por contacto con causa (aprobado por el dueño 27-11-2026 noche)

PORQUÉ (dueño): «todos los caminos» no es probarlos todos sin orden. Cada cambio de camino necesita una causa medida y un orden que dependa de
dónde está el otro. Tampoco hay que autolimitarse (escuchar solo 2 relés con datos móviles). Que el mensaje llegue manda sobre el ahorro.

## Cómo está hoy (revisado 27-11)
- `ble_startup._resolveDeviceIdForNexoId`: lista fija (Wi-Fi local → internet → Bluetooth), sin medir cómo le va a cada camino con ese contacto.
- Internet cuenta como UN camino: no sabe en qué relés escucha el otro (`net_publish.publishEach/_publishNow`: a todos los abiertos sin pausa).
- 4 mecanismos de reenvío sin ponerse de acuerdo: ventana de `chat_stream` (×8 en cada vuelta), `ble_send._armDeliverySafetyNet`,
  `ble_outbox._outboxSync`, `net_relays.resync`; más el puente (Jump) con 5 reintentos por paquete.
- Diag. S24 23:33 (3161): 2 textos pendientes ×8 ventanas (~70 sobres de 8 KB en 85 s) + 6 de puente ×5 → damus «banned».

## Diseño
1. **Estado por contacto:** dónde está (misma Wi-Fi comprobada / cerca por Bluetooth / lejos), por camino: tiempo típico hasta ✓✓ con
   ese contacto (mediana de los últimos N) y fallos recientes; despierto o dormido (cualquier paquete suyo reciente); dónde escucha por
   internet (lo avisa en el saludo y en el toque).
2. **Elegir por lugar:** misma Wi-Fi → Wi-Fi local (respaldo: Wi-Fi Direct archivos / Bluetooth textos). Cerca sin Wi-Fi común → internet
   si los dos tienen, Wi-Fi Direct lo grande, Bluetooth si no hay internet. Lejos → SOLO variantes de internet: relés que él escucha →
   Tor directo → puente por NEXO cercano (si yo no tengo internet) → relé de NEXO (cuando exista). Nunca Bluetooth/WD a uno lejano.
3. **Cambiar solo con causa:** enlace caído (evento real); despierto y sin ✓✓ en ~3× su tiempo típico por ese camino; relé que rechaza o
   limita → otro relé que él escuche (no otro tipo de camino); aparece uno mejor → se pasa con ~30 s estable y nunca a mitad de archivo.
   NO se cambia por un pico ni porque el otro está dormido (dormido = toque y esperar).
4. **Reenvíos:** un solo calendario por mensaje. Lo que un relé ya guardó no se republica: se espera ✓✓, luego el toque; se republica en
   otro relé solo con causa. Cupo por relé (contar sobres/min y no acercarse al límite); juntar textos pendientes a un contacto en un sobre;
   lo pesado repartido en el tiempo. Puente: sin 5 reintentos seguidos por paquete.
5. **Relés:** quitar «2 relés con datos» (CELL_READ_RELAYS): escuchar todos los abiertos + los que avise cada contacto; luego medir datos
   y bajar repetidos (no cerrar puertas).
6. **Fénix:** con la app a la vista, parado por cualquier camino; arranca al salir de la app y se para al volver (hoy solo cede con relés
   limitando: `chat_stream._bgShouldYieldNet`).

## Pruebas (`tests/sim`) antes de la APK
Caso 21:53 (lejos, internet, relés limitando), misma Wi-Fi con corte breve, contacto dormido, entrar a la Wi-Fi a mitad de archivo,
y el de las 23:33 (pendientes al volver a la app: cuántos sobres salen). Medir: llega, solo cambia con causa, cuántos envíos gasta.

Relé de NEXO: el dueño lo quiere; organizarlo el domingo 29-11 después de lo fuerte (opciones de servidor con costo mensual).
