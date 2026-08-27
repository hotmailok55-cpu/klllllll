# The Android app

**LJBMK Social** for Android — a native Kotlin + Jetpack Compose app that talks
to the same backend as the web version.

It is a real Android Studio project. Open it, press Run, and you get an APK.

---

## Why there is no APK in this repo (and how to get one in ~15 minutes)

An APK is a **build artifact**, not source code. Nobody commits one, for three
reasons that matter to you specifically:

1. **It must be signed with YOUR key.** Google Play ties your app's identity to
   a keystore only you should ever hold. An APK I built would be signed with a
   key you don't have — you could never update the app.
2. **It has to point at YOUR server.** The backend URL is compiled in. Until
   you've deployed the backend somewhere, any APK would point at nothing.
3. **Play wants an AAB, not an APK.** New apps upload an Android App Bundle.

So the deliverable is the project. Below is exactly how to turn it into an
installable app.

---

## 1. Open it

1. Install [Android Studio](https://developer.android.com/studio) (free).
2. **File → Open** → select the repository's **root folder** (the one with
   `settings.gradle.kts`), not the `app/` folder.
3. Android Studio will say "Gradle sync" and download the SDK, Kotlin, Compose
   and ExoPlayer. First sync takes a few minutes; after that it's fast.

If it prompts to install a missing SDK platform or build-tools, accept.

---

## 2. Point it at your backend

The app needs to know where the LJBMK Social server is. That lives in one line
of `app/build.gradle.kts`:

```kotlin
buildConfigField("String", "API_BASE_URL", "\"http://10.0.2.2:4000/\"")
```

| Where you're testing | What to put |
|---|---|
| **Android emulator**, backend on your computer | `http://10.0.2.2:4000/` (the default — `10.0.2.2` is the emulator's alias for your machine's localhost) |
| **Real phone**, backend on your computer | `http://192.168.1.20:4000/` — your computer's LAN IP. Both devices must be on the same Wi-Fi. |
| **Production** | `https://your-domain.com/` |

Two matching steps for a real phone on your LAN:

- Start the backend so it accepts outside connections:
  `cd backend && HOST=0.0.0.0 npm start`
- Add your IP to `app/src/main/res/xml/network_security_config.xml` — Android
  blocks plain HTTP by default, and that file is where the exception goes. It
  matches **exact hosts**, not IP ranges, so put the real address in.

Find your IP with `ip addr` (Linux), `ipconfig` (Windows), or
`ipconfig getifaddr en0` (macOS).

---

## 3. Run it

Pick a device in the toolbar, press **▶ Run**.

- **Emulator**: Device Manager → Create Device → any phone → a recent system
  image.
- **Real phone**: enable Developer Options (tap Build Number 7 times in
  Settings → About), turn on USB Debugging, plug it in.

That build produces a debug APK at:

```
app/build/outputs/apk/debug/app-debug.apk
```

You can share that file directly — anyone can install it by enabling
"Install unknown apps". **It is not for the Play Store**, only for testing.

From the command line instead of the IDE:

```bash
./gradlew assembleDebug
```

---

## 4. Sign it for release

Do this **once**, and never lose the file it creates. Losing your keystore
means you can never update your app on Play again.

```bash
keytool -genkey -v -keystore ljbmk-upload-key.jks \
  -keyalg RSA -keysize 2048 -validity 10000 -alias upload
```

Keep `ljbmk-upload-key.jks` somewhere safe and backed up. It is already in
`.gitignore` — **never commit it**.

Then build, passing the passwords as environment variables so they stay out of
the repo:

```bash
export KEYSTORE_PATH=/absolute/path/to/ljbmk-upload-key.jks
export STORE_PASSWORD='the password you chose'
export KEY_PASSWORD='the key password you chose'
export KEY_ALIAS=upload

./gradlew bundleRelease     # -> the .aab for Google Play
./gradlew assembleRelease   # -> a signed .apk, for sideloading
```

Outputs:

```
app/build/outputs/bundle/release/app-release.aab    <- upload this to Play
app/build/outputs/apk/release/app-release.apk       <- direct install
```

---

## 5. Publish to Google Play

1. Pay the one-time **$25** developer registration at
   [play.google.com/console](https://play.google.com/console).
2. **Create app** → name it *LJBMK Social*.
3. Upload `app-release.aab` to a **Closed testing** track first. Do not go
   straight to production — testing tracks let you fix things without a public
   bad review.
4. Fill in the store listing. You already have the assets:
   - **App icon** (512×512): `app/src/main/play-store-icon.png`
   - **Feature graphic** (1024×500): you'll need to make this one
   - **Screenshots**: at least 2 phone screenshots — take them from a running
     emulator with Ctrl+S
5. Complete the required declarations: privacy policy URL, data safety form,
   content rating questionnaire, target audience.

**Two things Play will hold you to for a social app**, so plan for them:

- A **privacy policy at a public URL**. Required, not optional.
- **User-generated content moderation**: a way to report content, a way to
  block users, and a stated moderation policy. The backend already implements
  all three (reporting, blocking, and the moderation queue) — you need to
  describe them in the listing and publish the policy text.

Version bumps for every upload, in `app/build.gradle.kts`:

```kotlin
versionCode = 2        // must increase by at least 1, every single time
versionName = "1.1"    // what users see
```

---

## What's in the app

```
app/src/main/java/com/ljbmk/social/
  MainActivity.kt              app shell, navigation, bottom bar
  data/
    SessionStore.kt            the auth token (DataStore)
    api/LjbmkApi.kt            every endpoint, as Retrofit sees it
    api/ApiClient.kt           auth header, envelope unwrapping, error mapping
    model/Models.kt            the JSON shapes, mirroring the backend
  ui/
    theme/Theme.kt             brand colours taken from your logo
    components/LjbmkTopBar.kt  THE LOGO BAR
    components/Common.kt       empty states, avatars, gradient button
    feed/FeedScreen.kt         the vertical scrolling feed
    feed/VideoPlayer.kt        ExoPlayer, one instance at a time
    feed/FeedViewModel.kt      paging, watch reporting, optimistic likes
    feed/CommentsSheet.kt      comments over the playing video
    explore/ExploreScreen.kt   search + trending + creator discovery
    auth/AuthScreen.kt         sign in / sign up
    upload/UploadScreen.kt     pick, upload, watch the pipeline, publish
    library/LibraryScreen.kt   profile, saved, subscriptions
    notifications/             the inbox
```

### The logo bar

`ui/components/LjbmkTopBar.kt`. Two variants:

- `LjbmkTopBar` — solid, used on Explore / Library / Upload.
- `LjbmkTopBarOverlay` — transparent with a scrim, used over the feed so video
  stays full-bleed while the logo stays readable.

The asset is `res/drawable-xxhdpi/ic_logo_wordmark.png`, generated from your
logo file. To change it, drop in a new PNG at the same path (roughly 120px tall,
transparent background).

### Why the feed doesn't run out of memory

Only the page currently on screen holds an `ExoPlayer`. When a video scrolls
away its player is released and its watch time is reported. Without that,
scrolling 200 videos would leave 200 video decoders alive and Android would
kill the app.

### Watch time

The app reports **how long a video was watched**. It never claims a view — the
server decides whether that watch counts, using the rules in
[DATABASE.md](DATABASE.md#view-counting). That's what stops a modified client
from inflating view counts.

---

## Things worth doing next

The app covers the main surfaces. These are deliberately left for you:

- **Channel and sound screens** — the backend endpoints exist
  (`GET /channels/:handle`, `GET /sounds/:id`); the taps are wired to no-ops in
  `MainActivity.kt` with a comment marking the spot.
- **In-app recording** — currently you pick an existing video. CameraX is
  already in the version catalog if you want to add capture.
- **Push notifications** — needs Firebase Cloud Messaging plus a server-side
  sender in `backend/src/integrations/notifications/`.
- **Offline caching** — Room is in the catalog; caching the last feed page
  would make cold starts feel instant.

---

## Troubleshooting

**"Gradle sync failed"** — usually a missing SDK component. Read the error; it
normally names exactly what to install and offers a link.

**App opens but the feed is empty / "Can't reach LJBMK Social"** — the app can't
see your backend. Check in order:
1. Is the backend actually running? `curl http://localhost:4000/api/v1/system/health`
2. Is `API_BASE_URL` right for how you're testing? (emulator vs real phone)
3. On a real phone: is the backend on `HOST=0.0.0.0`, is your IP in
   `network_security_config.xml`, are both devices on the same Wi-Fi?

**Videos don't play** — the app streams from whatever `videoUrl` the backend
returns. If `CDN_URL` is unset the backend serves them itself; make sure that
host is reachable from the phone, not just from your computer.

**"INSTALL_FAILED_UPDATE_INCOMPATIBLE"** — you have a version installed that was
signed with a different key. Uninstall it first.
