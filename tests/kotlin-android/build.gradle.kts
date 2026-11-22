// Comprobación de TIPOS del Kotlin del plugin (plugins/nexo-ble) sin el SDK de Android ni Google Maven (aquí no se alcanzan):
// compila TODO el plugin contra las clases de Android de Robolectric (android-all, en Maven Central), el núcleo de Capacitor
// (AAR de Maven Central) y unos sustitutos mínimos de AndroidX / Firebase (carpeta stubs/, solo firmas). No genera nada que se use:
// sirve para cazar errores de compilación ANTES de gastar un CI de ~85 min.   Uso: cd tests/kotlin-android && gradle --no-daemon compileKotlin
plugins { kotlin("jvm") version "2.0.21" }
repositories { mavenCentral() }
val aar by configurations.creating
dependencies {
    compileOnly("org.robolectric:android-all:16-robolectric-13921718")
    aar("com.capacitorjs:core:5.7.8@aar")
    compileOnly("org.json:json:20240303")
    compileOnly("info.guardianproject:jtorctl:0.4.5.7")
    compileOnly("org.jetbrains.kotlin:kotlin-stdlib")
}
val aarJars = layout.buildDirectory.dir("aar-jars")
val extractAar by tasks.registering(Copy::class) {
    from(aar.map { zipTree(it).matching { include("classes.jar") } })
    into(aarJars)
}
dependencies { compileOnly(files(aarJars.map { it.file("classes.jar") }).builtBy(extractAar)) }
kotlin { jvmToolchain(21) }
// Los sustitutos se compilan aparte (solo Java) y el plugin los ve como una biblioteca más
val stubs by sourceSets.creating { java.srcDir("stubs") }
dependencies {
    "stubsCompileOnly"("org.robolectric:android-all:16-robolectric-13921718")
    "stubsCompileOnly"("info.guardianproject:jtorctl:0.4.5.7")
    compileOnly(stubs.output)
}
sourceSets { main { kotlin.srcDir("../../plugins/nexo-ble/android/src/main/java") } }
tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile> { compilerOptions { suppressWarnings.set(true) } }
