git add src/ui/BLEInterface.js
git commit -m "FIX [NORDIC_010] v2.3.4: Escaneo BLE conectado a plugin nativo

- Dummy mode solo cuando no hay plugin nativo ni bleMesh
- toggleScan() usa NexoBLE.startScan()/stopScan() directamente
- Nuevo _setupNativeScanListeners() escucha onDeviceFound/onScanFailed nativos
- connect/disconnect/loadConnectedDevices/updateStatus: nativo primero
- Evita duplicados de listeners cuando hay plugin nativo disponible"
git pull origin main
git push origin main
