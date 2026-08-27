package com.ljbmk.social.data.api

import com.ljbmk.social.BuildConfig
import com.ljbmk.social.data.SessionStore
import com.ljbmk.social.data.model.ApiEnvelope
import com.ljbmk.social.data.model.ApiError
import com.squareup.moshi.Moshi
import com.squareup.moshi.Types
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.ResponseBody
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Converter
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory
import java.io.IOException
import java.lang.reflect.ParameterizedType
import java.lang.reflect.Type
import java.util.concurrent.TimeUnit

/**
 * Builds the one Retrofit client the app uses.
 *
 * Three responsibilities:
 *   1. attach the session token to every request
 *   2. unwrap the `{ "data": ... }` envelope so call sites get the payload
 *   3. turn `{ "error": ... }` into a typed [ApiException] with a message that
 *      is safe and sensible to show a user
 */
object ApiClient {

    /**
     * Where the backend lives. Set in `app/build.gradle.kts`.
     *
     * The default `10.0.2.2` is the Android emulator's route to your computer's
     * localhost. On a real phone, change it to your machine's LAN IP or your
     * deployed https:// server.
     */
    val baseUrl: String get() = BuildConfig.API_BASE_URL

    private val moshi: Moshi = Moshi.Builder()
        .add(KotlinJsonAdapterFactory())
        .build()

    @Volatile private var api: LjbmkApi? = null

    fun get(session: SessionStore): LjbmkApi =
        api ?: synchronized(this) { api ?: build(session).also { api = it } }

    private fun build(session: SessionStore): LjbmkApi {
        val logging = HttpLoggingInterceptor().apply {
            // Bodies only in debug builds — a release log must never contain
            // tokens or personal data.
            level = if (BuildConfig.DEBUG) HttpLoggingInterceptor.Level.BASIC
                    else HttpLoggingInterceptor.Level.NONE
        }

        val client = OkHttpClient.Builder()
            .addInterceptor(AuthInterceptor(session))
            .addInterceptor(logging)
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            // Uploads of a few hundred MB need room.
            .writeTimeout(10, TimeUnit.MINUTES)
            .retryOnConnectionFailure(true)
            .build()

        return Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(client)
            // Order matters: our envelope converter must see the body first.
            .addConverterFactory(EnvelopeConverterFactory(moshi))
            .addConverterFactory(MoshiConverterFactory.create(moshi))
            .build()
            .create(LjbmkApi::class.java)
    }

    /** Adds `Authorization: Bearer <token>` when the user is signed in. */
    private class AuthInterceptor(private val session: SessionStore) : Interceptor {
        override fun intercept(chain: Interceptor.Chain): okhttp3.Response {
            val token = session.tokenBlocking()
            val request = chain.request().newBuilder().apply {
                if (!token.isNullOrBlank()) header("Authorization", "Bearer $token")
                header("Accept", "application/json")
            }.build()

            val response = chain.proceed(request)

            // The session was revoked or expired — drop it so the UI can
            // prompt a fresh sign-in instead of failing silently forever.
            if (response.code == 401 && !token.isNullOrBlank()) {
                session.clearBlocking()
            }
            return response
        }
    }

    /**
     * Unwraps `{ "data": T }` into `T`, and converts `{ "error": ... }` into a
     * thrown [ApiException].
     *
     * Without this every call site would have to reach through `.data!!` and
     * hand-check for errors.
     */
    private class EnvelopeConverterFactory(private val moshi: Moshi) : Converter.Factory() {
        override fun responseBodyConverter(
            type: Type,
            annotations: Array<out Annotation>,
            retrofit: Retrofit,
        ): Converter<ResponseBody, *> {
            val envelopeType: ParameterizedType =
                Types.newParameterizedType(ApiEnvelope::class.java, type)
            val adapter = moshi.adapter<ApiEnvelope<Any>>(envelopeType)

            return Converter { body ->
                val envelope = adapter.fromJson(body.source())
                    ?: throw ApiException(ApiError(message = "The server returned an empty response."))
                envelope.error?.let { throw ApiException(it) }
                envelope.data
                    ?: throw ApiException(ApiError(message = "The server returned no data."))
            }
        }
    }
}

/**
 * A failed API call, carrying the server's own message.
 *
 * Show `message` to the user directly — the backend already writes these to be
 * understandable ("That email or password is not correct.") rather than
 * technical.
 */
class ApiException(val error: ApiError) : IOException(error.message) {
    val code: String get() = error.code
    val fieldErrors: Map<String, String> get() = error.details ?: emptyMap()
}

/**
 * Turns any thrown exception into a sentence worth showing a user.
 * Network failures get a human explanation instead of a stack trace class name.
 */
fun Throwable.userMessage(): String = when (this) {
    is ApiException -> message ?: "Something went wrong."
    is java.net.UnknownHostException,
    is java.net.ConnectException,
    is java.net.SocketTimeoutException ->
        "Can't reach LJBMK Social. Check your connection and that the server is running."
    else -> message ?: "Something went wrong."
}
