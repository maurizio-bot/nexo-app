import com.nexo.ble.UpdateSpec
import org.junit.Test
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse

// Lógica PURA del actualizador automático (10-11): qué lanzamiento es «el último», cuándo ofrecer, qué URL se acepta.
class UpdateSpecTest {
    private val base = "https://github.com/maurizio-bot/nexo-app/releases/download"

    @Test fun parseaElNumeroDeBuild() {
        assertEquals(2984, UpdateSpec.parseBuild("nightly-2984"))
        assertNull(UpdateSpec.parseBuild("nightly-"))
        assertNull(UpdateSpec.parseBuild("v1.2.3"))
        assertNull(UpdateSpec.parseBuild("nightly-12a"))
        assertNull(UpdateSpec.parseBuild("nightly-99999999"))
        assertNull(UpdateSpec.parseBuild(null))
    }

    @Test fun soloOfreceUnoEstrictamenteMasNuevoConNumeroPropio() {
        assertTrue(UpdateSpec.isNewer(2984, 2985))
        assertFalse(UpdateSpec.isNewer(2985, 2985))
        assertFalse(UpdateSpec.isNewer(2986, 2985))
        assertFalse(UpdateSpec.isNewer(null, 2985))   // compilación local/«dev»: nunca se ofrece
        assertFalse(UpdateSpec.isNewer(2984, null))
    }

    @Test fun urlDePartidaSoloDeEsteRepositorio() {
        assertTrue(UpdateSpec.isAllowedStartUrl("$base/nightly-2985/nexo-nightly-2985-abc1234.apk"))
        assertFalse(UpdateSpec.isAllowedStartUrl("http://github.com/maurizio-bot/nexo-app/releases/download/nightly-2985/a.apk"))      // sin https
        assertFalse(UpdateSpec.isAllowedStartUrl("https://github.com/otro/nexo-app/releases/download/nightly-2985/a.apk"))             // otro repositorio
        assertFalse(UpdateSpec.isAllowedStartUrl("https://evil.com/maurizio-bot/nexo-app/releases/download/nightly-2985/a.apk"))      // otro host
        assertFalse(UpdateSpec.isAllowedStartUrl("https://github.com.evil.com/maurizio-bot/nexo-app/releases/download/nightly-1/a.apk"))
        assertFalse(UpdateSpec.isAllowedStartUrl("https://github.com/maurizio-bot/nexo-app/releases/download/nightly-2985/a.zip"))    // no es .apk
        assertFalse(UpdateSpec.isAllowedStartUrl("https://user@github.com/maurizio-bot/nexo-app/releases/download/nightly-1/a.apk"))  // con usuario
        assertFalse(UpdateSpec.isAllowedStartUrl("https://github.com:8443/maurizio-bot/nexo-app/releases/download/nightly-1/a.apk"))  // con puerto
        assertFalse(UpdateSpec.isAllowedStartUrl("$base/nightly-1/../../x.apk"))
        assertFalse(UpdateSpec.isAllowedStartUrl(null))
        assertFalse(UpdateSpec.isAllowedStartUrl("no es una url"))
    }

    @Test fun redireccionesSoloAHostsDeGithubPorHttps() {
        assertTrue(UpdateSpec.isAllowedRedirect("https://objects.githubusercontent.com/github-production-release-asset/abc?x=1"))
        assertTrue(UpdateSpec.isAllowedRedirect("https://release-assets.githubusercontent.com/github-production-release-asset/abc"))
        assertFalse(UpdateSpec.isAllowedRedirect("http://objects.githubusercontent.com/abc"))
        assertFalse(UpdateSpec.isAllowedRedirect("https://objects.githubusercontent.com.evil.com/abc"))
        assertFalse(UpdateSpec.isAllowedRedirect("https://evil.com/abc"))
        assertFalse(UpdateSpec.isAllowedRedirect(null))
    }

    private fun rel(tag: String, name: String = "nexo-$tag.apk", size: Long = 25_000_000, draft: Boolean = false, url: String? = null, body: String? = null): String {
        val u = url ?: "$base/$tag/$name"
        val b = if (body == null) "" else ",\"body\":" + org.json.JSONObject.quote(body)
        return """{"tag_name":"$tag","draft":$draft,"prerelease":true$b,"assets":[{"name":"$name","size":$size,"browser_download_url":"$u"}]}"""
    }

    // 3105 (dueño 15-11): novedades de cada versión (descripción del lanzamiento, formato de Google Play por idioma)
    @Test fun novedadesSoloEnFormatoDeGooglePlay() {
        val play = "<es-419>\n- Dos llamadas a la vez\n</es-419>\n<en-US>\n- Two calls at once\n</en-US>"
        val json = "[" + listOf(rel("nightly-3060", body = play), rel("nightly-3059", body = "**Full Changelog**: https://github.com/x/y/compare/a...b")).joinToString(",") + "]"
        val l = UpdateSpec.pickLatest(json)!!
        assertEquals(3060, l.build)
        assertTrue(l.notes.contains("Dos llamadas a la vez"))
        assertEquals("", UpdateSpec.notesOf(json, 3059))          // notas automáticas de GitHub: no son para el usuario
        assertTrue(UpdateSpec.notesOf(json, 3060).contains("Two calls"))
        assertEquals("", UpdateSpec.notesOf(json, 3001))          // no está en la lista
        assertEquals("", UpdateSpec.notesOf(json, null))
        assertEquals("", UpdateSpec.cleanNotes(null))
        assertEquals(UpdateSpec.MAX_NOTES_CHARS, UpdateSpec.cleanNotes("<es>" + "x".repeat(9000)).length)  // recortada
        assertFalse(UpdateSpec.cleanNotes("<es>\u0007hola\r\n</es>").contains("\u0007"))                  // sin caracteres de control
        assertEquals("", UpdateSpec.pickLatest("[" + rel("nightly-3061") + "]")!!.notes)                     // sin descripción
    }

    @Test fun eligeElNightlyDeNumeroMasAlto() {
        val json = "[" + listOf(rel("nightly-2983"), rel("nightly-2985"), rel("nightly-2984")).joinToString(",") + "]"
        val l = UpdateSpec.pickLatest(json)!!
        assertEquals(2985, l.build)
        assertEquals("nightly-2985", l.tag)
        assertEquals(25_000_000L, l.size)
        assertTrue(l.url.endsWith("/nightly-2985/nexo-nightly-2985.apk"))
    }

    @Test fun ignoraBorradoresEtiquetasAjenasYAdjuntosRaros() {
        assertNull(UpdateSpec.pickLatest("[" + rel("nightly-3000", draft = true) + "]"))                                  // borrador
        assertNull(UpdateSpec.pickLatest("[" + rel("v9") + "]"))                                                            // etiqueta ajena
        assertNull(UpdateSpec.pickLatest("[" + rel("nightly-3000", name = "x.zip") + "]"))                                  // sin .apk
        assertNull(UpdateSpec.pickLatest("[" + rel("nightly-3000", size = UpdateSpec.MAX_APK_BYTES + 1) + "]"))             // demasiado grande
        assertNull(UpdateSpec.pickLatest("[" + rel("nightly-3000", size = 0) + "]"))                                        // sin tamaño
        assertNull(UpdateSpec.pickLatest("[" + rel("nightly-3000", url = "https://evil.com/a.apk") + "]"))                  // URL de otro lado
        // uno malo con número alto no tapa a uno bueno
        val l = UpdateSpec.pickLatest("[" + rel("nightly-3000", url = "https://evil.com/a.apk") + "," + rel("nightly-2985") + "]")!!
        assertEquals(2985, l.build)
    }

    @Test fun jsonRotoOVacioNoRompe() {
        assertNull(UpdateSpec.pickLatest(null))
        assertNull(UpdateSpec.pickLatest(""))
        assertNull(UpdateSpec.pickLatest("{no es json"))
        assertNull(UpdateSpec.pickLatest("{}"))
        assertNull(UpdateSpec.pickLatest("[]"))
        assertNull(UpdateSpec.pickLatest("[1,2,null,\"x\"]"))
        assertNull(UpdateSpec.pickLatest("[" + "x".repeat(UpdateSpec.MAX_JSON_BYTES + 1) + "]"))
    }
}
