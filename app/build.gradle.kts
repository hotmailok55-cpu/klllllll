plugins {
  alias(libs.plugins.android.application)
  alias(libs.plugins.kotlin.android)
  alias(libs.plugins.kotlin.compose)
}

android {
  namespace = "com.ljbmk.social"
  compileSdk = 35

  defaultConfig {
    // This is the ID Google Play uses. It can NEVER be changed after your first
    // upload, so it is worth being happy with it now.
    applicationId = "com.ljbmk.social"
    minSdk = 24            // Android 7.0 — ~98% of active devices
    targetSdk = 35
    versionCode = 1        // bump by 1 for EVERY Play Store upload
    versionName = "1.0"    // what users see, e.g. "1.0", "1.1"

    testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

    // Where the app looks for the LJBMK Social backend.
    //
    // 10.0.2.2 is how the Android EMULATOR reaches "localhost" on your computer.
    // On a REAL phone this must be your machine's LAN IP (e.g. 192.168.1.20)
    // or your deployed server's https:// address.
    buildConfigField("String", "API_BASE_URL", "\"http://10.0.2.2:4000/\"")
  }

  signingConfigs {
    // Release signing. Google Play requires a signed AAB.
    //
    // Create your key once:
    //   keytool -genkey -v -keystore ljbmk-upload-key.jks \
    //     -keyalg RSA -keysize 2048 -validity 10000 -alias upload
    //
    // Then set these environment variables before building, so the passwords
    // are never committed to git:
    //   KEYSTORE_PATH, STORE_PASSWORD, KEY_PASSWORD
    create("release") {
      val keystorePath = System.getenv("KEYSTORE_PATH") ?: "${rootDir}/ljbmk-upload-key.jks"
      val keystore = file(keystorePath)
      if (keystore.exists()) {
        storeFile = keystore
        storePassword = System.getenv("STORE_PASSWORD")
        keyAlias = System.getenv("KEY_ALIAS") ?: "upload"
        keyPassword = System.getenv("KEY_PASSWORD")
      }
    }
  }

  buildTypes {
    release {
      isMinifyEnabled = true
      isShrinkResources = true
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
      // Only sign if the keystore is actually present, so a plain
      // `./gradlew assembleDebug` still works on a fresh clone.
      signingConfig = signingConfigs.getByName("release").takeIf { it.storeFile?.exists() == true }
    }
    debug {
      applicationIdSuffix = ".debug"
      versionNameSuffix = "-debug"
    }
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
  kotlinOptions {
    jvmTarget = "17"
    freeCompilerArgs += listOf(
      // Media3's PlayerView/ExoPlayer surface is marked @UnstableApi. It is
      // the standard, shipping API — opting in once here keeps the annotation
      // out of every composable that touches a player.
      "-opt-in=androidx.media3.common.util.UnstableApi",
      "-opt-in=androidx.compose.material3.ExperimentalMaterial3Api",
      "-opt-in=androidx.compose.foundation.ExperimentalFoundationApi",
    )
  }

  buildFeatures {
    compose = true
    buildConfig = true
  }

  packaging {
    resources { excludes += "/META-INF/{AL2.0,LGPL2.1}" }
  }
}

dependencies {
  implementation(platform(libs.androidx.compose.bom))

  // Compose UI
  implementation(libs.androidx.activity.compose)
  implementation(libs.androidx.compose.material3)
  implementation(libs.androidx.compose.material.icons.core)
  implementation(libs.androidx.compose.material.icons.extended)
  implementation(libs.androidx.compose.ui)
  implementation(libs.androidx.compose.ui.graphics)
  implementation(libs.androidx.compose.ui.tooling.preview)
  implementation(libs.androidx.navigation.compose)

  // Lifecycle / ViewModel
  implementation(libs.androidx.core.ktx)
  implementation(libs.androidx.lifecycle.runtime.ktx)
  implementation(libs.androidx.lifecycle.runtime.compose)
  implementation(libs.androidx.lifecycle.viewmodel.compose)

  // Video playback — this is what makes the scrolling feed feel right.
  implementation(libs.androidx.media3.exoplayer)
  implementation(libs.androidx.media3.ui)
  implementation(libs.androidx.media3.common)

  // Networking against the LJBMK Social backend
  implementation(libs.retrofit)
  implementation(libs.converter.moshi)
  implementation(libs.moshi.kotlin)
  implementation(libs.okhttp)
  implementation(libs.logging.interceptor)

  // Images
  implementation(libs.coil.compose)

  // Session storage (the auth token)
  implementation(libs.androidx.datastore.preferences)

  implementation(libs.kotlinx.coroutines.android)

  debugImplementation(libs.androidx.compose.ui.tooling)
  debugImplementation(libs.androidx.compose.ui.test.manifest)

  testImplementation(libs.junit)
  androidTestImplementation(libs.androidx.junit)
  androidTestImplementation(libs.androidx.espresso.core)
  androidTestImplementation(platform(libs.androidx.compose.bom))
  androidTestImplementation(libs.androidx.compose.ui.test.junit4)
}
