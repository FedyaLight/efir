plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val webAssets =
    tasks.register<Sync>("copyWeb") {
        from("../../web") { exclude("**/.*", "**/README.md", "netlify.toml", "vendor/peerjs.min.js") }
        into(layout.buildDirectory.dir("generated/assets/web"))
    }

android {
    namespace = "app.efir.android"
    compileSdk = 35
    buildFeatures { buildConfig = true }
    defaultConfig {
        applicationId = "app.efir.android"
        minSdk = 26
        targetSdk = 35
        versionCode = 6
        versionName = "1.3.2"
        testInstrumentationRunner = "app.efir.android.EfirTestRunner"
    }
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/assets"))
    signingConfigs {
        create("localRelease") {
            val key = System.getenv("EFIR_KEYSTORE")
            if (key != null) {
                storeFile = file(key)
                storePassword = System.getenv("EFIR_STORE_PASSWORD")
                keyAlias = System.getenv("EFIR_KEY_ALIAS") ?: "efir"
                keyPassword = System.getenv("EFIR_KEY_PASSWORD") ?: storePassword
            }
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            if (System.getenv("EFIR_KEYSTORE") != null)
                signingConfig = signingConfigs.getByName("localRelease")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    packaging {
        resources.excludes +=
            setOf("META-INF/LICENSE*", "META-INF/NOTICE*", "META-INF/DEPENDENCIES")
    }
}

tasks.named("preBuild").configure { dependsOn(webAssets) }

dependencies {
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("androidx.webkit:webkit:1.13.0")
    implementation("org.nanohttpd:nanohttpd:2.3.1")
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
    implementation("com.google.zxing:core:3.5.3")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test:rules:1.6.1")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
}
