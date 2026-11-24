package com.nexo.ble

// 3321: el puente a internet sin la app (GwServe) con lo del teléfono: los relés de la escucha nativa (NetBgHome) y conexiones propias
// a ese relé (WsClient; con «Usar Tor siempre», por Tor, y si Tor aún no está, «no conecta»: nunca directo).
internal fun gwServeFor(me: () -> String, link: OutboxBle.Link, relayOk: () -> Boolean): GwServe = GwServe(
    me = me,
    urls = { NetBgHome.peek()?.openUrls() ?: emptyList() },
    wifi = { NetBgHome.peek()?.onWifi() == true },
    link = link,
    relayOk = relayOk,
    wake = { tok -> NetBgHome.peek()?.wakeToken(tok) == true },
    sockOf = { url, onText, onClose ->
        val via = try { TorRoute.route() } catch (e: TorRoute.WaitTor) { null }
        if (via == null && TorRoute.always) null else {
            val ws = WsClient(url, onText, { _ -> onClose() }, proxy = via)
            ws.connect()
            object : GwServe.Sock {
                override fun send(text: String) = ws.send(text)
                override fun close() = ws.close()
            }
        }
    },
)
