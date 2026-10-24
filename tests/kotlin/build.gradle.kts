// Pruebas en JVM del código Kotlin del plugin que no depende de Android (cifrado en reposo).
// Uso: cd tests/kotlin && gradle --no-daemon test
plugins { kotlin("jvm") version "2.0.21" }
repositories { mavenCentral() }
dependencies { implementation("org.json:json:20240303"); testImplementation(kotlin("test")) }
kotlin { jvmToolchain(21) }
sourceSets {
    main { kotlin.srcDir("../../plugins/nexo-ble/android/src/main/java/com/nexo/ble").also { kotlin.include("AtRestStore.kt", "LanHub.kt", "LanBeacon.kt", "UnreadBook.kt", "Secp256k1.kt", "WsClient.kt", "NetBg.kt", "BinFrame.kt", "RidToken.kt", "BigFile.kt", "BgInbox.kt") } }
}
tasks.test { testLogging { events("passed", "failed"); showStandardStreams = true; exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL } }
