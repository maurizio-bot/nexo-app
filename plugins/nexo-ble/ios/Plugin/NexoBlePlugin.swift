import Foundation
import Capacitor
import LocalAuthentication
import Photos
import UIKit

/**
 * NEXO — plugin iOS (fase 0, 27-10). Equivalente en Swift del plugin Android (Kotlin, NexoBlePlugin.kt).
 * Esta fase cubre lo que la app necesita para CORRER en un iPhone:
 *   - Persistencia de archivos (saveToFile/loadFromFile/deleteFile) — la app guarda TODO por acá (contactos, mensajes, claves, ajustes).
 *   - Biometría / Face ID (biometricStatus/biometricAuth) — en iOS Face ID y Touch ID son fuertes (no hay Clase 2 como Android), así que allowWeak no aplica.
 *   - Guardar foto/vídeo en la galería (saveToGallery) — pedido del dueño (#92).
 * El Bluetooth (anunciar/escanear/conectar/enviar) queda como stub que no rompe la app; se implementa en fase 2
 * (hay que rediseñar el descubrimiento: iOS no permite «manufacturer data» en el anuncio — ver docs/IOS_PROPUESTA.md).
 */
@objc(NexoBlePlugin)
public class NexoBlePlugin: CAPPlugin {

    // MARK: - Persistencia de archivos (sandbox de la app; iOS lo cifra con Data Protection cuando el teléfono está bloqueado)
    private func docURL(_ filename: String) throws -> URL {
        let docs = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let safe = filename.replacingOccurrences(of: "/", with: "_")
        return docs.appendingPathComponent(safe)
    }

    @objc func saveToFile(_ call: CAPPluginCall) {
        guard let filename = call.getString("filename"), let content = call.getString("content") else {
            call.reject("filename y content requeridos"); return
        }
        do {
            try content.write(to: try docURL(filename), atomically: true, encoding: .utf8)
            call.resolve(["success": true])
        } catch {
            call.reject("No se pudo guardar: \(error.localizedDescription)")
        }
    }

    @objc func loadFromFile(_ call: CAPPluginCall) {
        guard let filename = call.getString("filename") else { call.reject("filename requerido"); return }
        do {
            let url = try docURL(filename)
            if !FileManager.default.fileExists(atPath: url.path) { call.resolve(["exists": false]); return }
            let content = try String(contentsOf: url, encoding: .utf8)
            call.resolve(["exists": true, "content": content])
        } catch {
            call.resolve(["exists": false])
        }
    }

    @objc func deleteFile(_ call: CAPPluginCall) {
        guard let filename = call.getString("filename") else { call.reject("filename requerido"); return }
        if let url = try? docURL(filename) { try? FileManager.default.removeItem(at: url) }
        call.resolve(["success": true])
    }

    // MARK: - Biometría (Face ID / Touch ID). En iOS son fuertes; allowWeak (#103) no aplica, se deja pasar.
    @objc func biometricStatus(_ call: CAPPluginCall) {
        let ctx = LAContext()
        var err: NSError?
        let can = ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &err)
        call.resolve(["available": can, "code": can ? 0 : (err?.code ?? -1)])
    }

    @objc func biometricAuth(_ call: CAPPluginCall) {
        let reason = call.getString("title") ?? "Desbloquear NEXO"
        let ctx = LAContext()
        var err: NSError?
        guard ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &err) else {
            call.resolve(["ok": false, "reason": err?.localizedDescription ?? "sin biometría ni PIN"]); return
        }
        ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { success, error in
            DispatchQueue.main.async {
                if success { call.resolve(["ok": true]) }
                else { call.resolve(["ok": false, "reason": error?.localizedDescription ?? "cancelado"]) }
            }
        }
    }

    // MARK: - Guardar foto/vídeo en la galería (#92)
    @objc func saveToGallery(_ call: CAPPluginCall) {
        guard let b64 = call.getString("base64"), let data = Data(base64Encoded: b64) else {
            call.reject("base64 requerido"); return
        }
        let mime = call.getString("mime") ?? ""
        let isVideo = mime.hasPrefix("video")
        PHPhotoLibrary.requestAuthorization { status in
            guard status == .authorized || status == .limited else {
                call.resolve(["saved": false, "reason": "permiso"]); return
            }
            PHPhotoLibrary.shared().performChanges({
                if isVideo {
                    let ext = mime.contains("quicktime") ? "mov" : "mp4"
                    let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("nexo_\(Int(Date().timeIntervalSince1970)).\(ext)")
                    do { try data.write(to: tmp); PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: tmp) } catch {}
                } else if let img = UIImage(data: data) {
                    PHAssetChangeRequest.creationRequestForAsset(from: img)
                }
            }, completionHandler: { success, error in
                DispatchQueue.main.async {
                    call.resolve(["saved": success, "reason": success ? "" : (error?.localizedDescription ?? "error")])
                }
            })
        }
    }

    // MARK: - Estado (iOS cifra el sandbox por defecto con Data Protection)
    @objc func atRestStatus(_ call: CAPPluginCall) {
        call.resolve(["active": true])
    }

    // iOS no tiene FLAG_SECURE como Android; tapar capturas necesita otro truco (fase posterior). No rompe nada.
    @objc func setSecureScreen(_ call: CAPPluginCall) { call.resolve(["success": true]) }

    // MARK: - Bluetooth (STUB fase 0; real en fase 2 con el descubrimiento rediseñado). No rompe la app.
    @objc func initialize(_ call: CAPPluginCall) { call.resolve(["userId": call.getString("userId") ?? ""]) }
    @objc func startScan(_ call: CAPPluginCall) { call.resolve() }
    @objc func stopScan(_ call: CAPPluginCall) { call.resolve() }
    @objc func startAdvertising(_ call: CAPPluginCall) { call.resolve() }
    @objc func stopAdvertising(_ call: CAPPluginCall) { call.resolve() }
    @objc func disconnect(_ call: CAPPluginCall) { call.resolve() }
    @objc func getMtu(_ call: CAPPluginCall) { call.resolve(["mtu": 0]) }
    @objc func connect(_ call: CAPPluginCall) { call.reject("Bluetooth aún no disponible en iOS (fase 2)") }
    @objc func sendMessage(_ call: CAPPluginCall) { call.reject("Bluetooth aún no disponible en iOS (fase 2)") }
}
