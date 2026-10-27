#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

// Registra el plugin con Capacitor y expone a JavaScript los métodos de NexoBlePlugin.swift.
// El nombre "NexoBLE" DEBE coincidir con el de Android (@CapacitorPlugin(name="NexoBLE")) y con lo que llama la app.
CAP_PLUGIN(NexoBlePlugin, "NexoBLE",
  CAP_PLUGIN_METHOD(initialize, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(saveToFile, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(loadFromFile, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(deleteFile, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(biometricStatus, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(biometricAuth, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(saveToGallery, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(atRestStatus, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(setSecureScreen, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(getMtu, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(startScan, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(stopScan, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(startAdvertising, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(stopAdvertising, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(connect, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(disconnect, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(sendMessage, CAPPluginReturnPromise);
)
