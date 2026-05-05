package com.nexo.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class NexoReconnectReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val serviceIntent = Intent(context, NexoKeepAliveService::class.java)
        context.startForegroundService(serviceIntent)
    }
}

