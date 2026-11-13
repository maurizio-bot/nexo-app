package com.nexo.ble

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.util.Base64
import android.util.Log
import androidx.core.app.NotificationCompat
import java.io.ByteArrayOutputStream

/**
 * 13-11 (dueño): COMPARTIR PANTALLA en la videollamada (parte 1: 1-a-1).
 *
 * El usuario da el permiso de Android (aviso del sistema, cada vez: NexoBlePlugin.screenShareStart). Con ese permiso este
 * servicio, en primer plano y de tipo mediaProjection (Android lo exige mientras se captura), copia la pantalla en una
 * pantalla virtual pequeña (lado largo maxLong) y como mucho `fps` veces por segundo saca la imagen como JPEG y se la pasa a
 * la app (listener → onScreenFrame). La app la manda por la videollamada en lugar de la cámara (cifrada como siempre).
 * Si la pantalla no cambia, Android no da imagen nueva y no se manda nada nuevo (la app repite la última cada segundo).
 * Se para con screenShareStop, al colgar o cuando Android corta la captura (onScreenShareStopped).
 */
class ScreenShareService : Service() {

    companion object {
        private const val TAG = "ScreenShare"
        private const val CHANNEL_ID = "nexo_screen_share"
        private const val NOTIFICATION_ID = 1003
        private const val MAX_JPEG = 350_000
        @Volatile var listener: ((String, Int, Int) -> Unit)? = null
        @Volatile var onStopped: (() -> Unit)? = null
        @Volatile var running = false
        @Volatile var frames = 0L

        fun stop(ctx: Context) {
            try { ctx.stopService(Intent(ctx, ScreenShareService::class.java)) } catch (e: Throwable) { Log.w(TAG, "stop: ${e.message}") }
        }
    }

    private var projection: MediaProjection? = null
    private var display: VirtualDisplay? = null
    private var reader: ImageReader? = null
    private var thread: HandlerThread? = null
    private var handler: Handler? = null
    private var width = 0
    private var height = 0
    private var everyMs = 200L
    private var stopping = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent == null || running) return START_NOT_STICKY
        val code = intent.getIntExtra("code", 0)
        @Suppress("DEPRECATION")
        val data: Intent? = intent.getParcelableExtra("data")
        val maxLong = intent.getIntExtra("maxLong", 960).coerceIn(240, 1920)
        val fps = intent.getIntExtra("fps", 5).coerceIn(1, 15)
        everyMs = (1000L / fps).coerceAtLeast(66L)
        // Android 10+: el servicio tiene que estar en primer plano (tipo mediaProjection) ANTES de pedir la proyección
        if (!startFg()) { finish("sin servicio en primer plano"); return START_NOT_STICKY }
        if (data == null) { finish("sin permiso"); return START_NOT_STICKY }
        try {
            val mpm = getSystemService(MediaProjectionManager::class.java)
            val mp = mpm.getMediaProjection(code, data)
            if (mp == null) { finish("Android no dio la proyección"); return START_NOT_STICKY }
            projection = mp
            thread = HandlerThread("nexo-screen").also { it.start() }
            handler = Handler(thread!!.looper)
            // Android 14+: el aviso de parada se registra ANTES de crear la pantalla virtual (si no, lanza una excepción)
            mp.registerCallback(object : MediaProjection.Callback() {
                override fun onStop() { Log.i(TAG, "Android paró la captura"); finish("parada por el sistema") }
            }, handler)
            val dm = resources.displayMetrics
            val sw = dm.widthPixels.coerceAtLeast(1)
            val sh = dm.heightPixels.coerceAtLeast(1)
            val k = minOf(1.0, maxLong.toDouble() / maxOf(sw, sh))
            width = ((sw * k).toInt() / 2 * 2).coerceAtLeast(2)
            height = ((sh * k).toInt() / 2 * 2).coerceAtLeast(2)
            val r = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2)
            reader = r
            display = mp.createVirtualDisplay("nexo-screen", width, height, dm.densityDpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, r.surface, null, handler)
            running = true; frames = 0
            Log.i(TAG, "Compartiendo pantalla ${width}x$height, cada $everyMs ms")
            handler?.postDelayed(tick, everyMs)
        } catch (e: Throwable) {
            Log.e(TAG, "No se pudo empezar a capturar: ${e.javaClass.simpleName} ${e.message}")
            finish("error al empezar")
        }
        return START_NOT_STICKY
    }

    private val tick: Runnable = object : Runnable {
        override fun run() {
            if (!running) return
            try { grab() } catch (e: Throwable) { Log.w(TAG, "imagen: ${e.message}") }
            handler?.postDelayed(this, everyMs)
        }
    }

    private fun grab() {
        val img = reader?.acquireLatestImage() ?: return // sin cambios en la pantalla: nada nuevo
        try {
            val plane = img.planes[0]
            val pixelStride = plane.pixelStride
            val rowStride = plane.rowStride
            val padW = rowStride / pixelStride
            val bmp = Bitmap.createBitmap(padW, height, Bitmap.Config.ARGB_8888)
            bmp.copyPixelsFromBuffer(plane.buffer)
            val out = if (padW != width) Bitmap.createBitmap(bmp, 0, 0, width, height) else bmp
            var q = 62
            var bytes: ByteArray
            do {
                val bos = ByteArrayOutputStream()
                out.compress(Bitmap.CompressFormat.JPEG, q, bos)
                bytes = bos.toByteArray()
                q -= 12
            } while (bytes.size > MAX_JPEG && q >= 26)
            if (out !== bmp) out.recycle()
            bmp.recycle()
            frames++
            listener?.invoke(Base64.encodeToString(bytes, Base64.NO_WRAP), width, height)
        } finally {
            img.close()
        }
    }

    private fun startFg(): Boolean {
        return try {
            val nm = getSystemService(NotificationManager::class.java)
            if (Build.VERSION.SDK_INT >= 26 && nm?.getNotificationChannel(CHANNEL_ID) == null) {
                nm?.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Compartir pantalla", NotificationManager.IMPORTANCE_LOW))
            }
            val n: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_menu_share)
                .setContentTitle("NEXO")
                .setContentText("Compartiendo tu pantalla en la videollamada")
                .setOngoing(true)
                .build()
            if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
            else startForeground(NOTIFICATION_ID, n)
            true
        } catch (e: Throwable) {
            Log.e(TAG, "startForeground (mediaProjection) falló: ${e.javaClass.simpleName} ${e.message}")
            false
        }
    }

    private fun finish(why: String) {
        if (stopping) return
        stopping = true
        val was = running
        running = false
        Log.i(TAG, "Dejo de compartir la pantalla ($why, $frames imágenes)")
        try { display?.release() } catch (e: Throwable) {}
        try { reader?.close() } catch (e: Throwable) {}
        try { projection?.stop() } catch (e: Throwable) {}
        display = null; reader = null; projection = null
        try { thread?.quitSafely() } catch (e: Throwable) {}
        try { stopForeground(STOP_FOREGROUND_REMOVE) } catch (e: Throwable) {}
        if (was || why != "detenido") try { onStopped?.invoke() } catch (e: Throwable) {}
        stopSelf()
    }

    override fun onDestroy() {
        finish("detenido")
        super.onDestroy()
    }
}
