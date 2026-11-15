import com.nexo.ble.InviteLink
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

// 3129: enlace de invitación — solo nuestras direcciones, ID y código bien formados (la pantalla principal está exportada)
class InviteLinkTest {
    @Test fun aceptaLaPaginaYElEsquema() {
        assertEquals(Pair("nx1n36c283", "K7F3Q9WZ"), InviteLink.parse("https://maurizio-bot.github.io/nexo-app/i#NX1N36C283-K7F3Q9WZ"))
        assertEquals(Pair("nx1n36c283", "K7F3Q9WZ"), InviteLink.parse("https://maurizio-bot.github.io/nexo-app/i.html#nx1n36c283-k7f3q9wz"))
        assertEquals(Pair("nx1n36c283", "K7F3Q9WZ"), InviteLink.parse("https://Maurizio-Bot.github.io/nexo-app/i/?x=1#NX1N36C283-K7F3Q9WZ"))
        assertEquals(Pair("nx1n36c283", "K7F3Q9WZ"), InviteLink.parse("nexo://i/NX1N36C283-K7F3Q9WZ"))
        assertEquals(Pair("nx1n36c283", ""), InviteLink.parse("nexo://i/NX1N36C283"))
    }
    @Test fun rechazaLoAjeno() {
        assertNull(InviteLink.parse("https://otro.github.io/nexo-app/i#NX1N36C283-K7F3Q9WZ"))
        assertNull(InviteLink.parse("https://maurizio-bot.github.io.malo.com/nexo-app/i#NX1N36C283-K7F3Q9WZ"))
        assertNull(InviteLink.parse("https://maurizio-bot.github.io/otra/i#NX1N36C283-K7F3Q9WZ"))
        assertNull(InviteLink.parse("http://maurizio-bot.github.io/nexo-app/i#NX1N36C283-K7F3Q9WZ"))
        assertNull(InviteLink.parse("https://maurizio-bot.github.io/nexo-app/i#NX1N36C283-K7F3Q9W0")) // 0 no está en el alfabeto
        assertNull(InviteLink.parse("https://maurizio-bot.github.io/nexo-app/i#NX1N36C28-K7F3Q9WZ"))  // ID corto
        assertNull(InviteLink.parse("nexo://i/NX1N36C283-K7F3Q9WZ<script>"))
        assertNull(InviteLink.parse("nexo://x/NX1N36C283"))
        assertNull(InviteLink.parse(null))
        assertNull(InviteLink.parse("nexo://i/" + "A".repeat(400)))
    }
}
