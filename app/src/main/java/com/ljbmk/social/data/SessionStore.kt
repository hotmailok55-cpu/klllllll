package com.ljbmk.social.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.runBlocking

private val Context.dataStore by preferencesDataStore(name = "ljbmk_session")

/**
 * Stores the signed-in session token.
 *
 * The token is opaque and server-revocable — it is not a password and carries
 * no user data. It is excluded from Android backup (see xml/backup_rules.xml)
 * so a restored device signs in again rather than inheriting a live session.
 */
class SessionStore(private val context: Context) {

    private val tokenKey = stringPreferencesKey("auth_token")
    private val usernameKey = stringPreferencesKey("username")

    val token: Flow<String?> = context.dataStore.data.map { it[tokenKey] }

    val isSignedIn: Flow<Boolean> = context.dataStore.data.map {
        !it[tokenKey].isNullOrBlank()
    }

    val username: Flow<String?> = context.dataStore.data.map { it[usernameKey] }

    suspend fun save(token: String, username: String?) {
        context.dataStore.edit {
            it[tokenKey] = token
            if (username != null) it[usernameKey] = username
        }
    }

    suspend fun clear() {
        context.dataStore.edit { it.clear() }
    }

    /**
     * Blocking reads, used only by the OkHttp interceptor.
     *
     * OkHttp interceptors run on a background thread and have no coroutine
     * scope, so a blocking read is correct here — it must never be called from
     * the main thread.
     */
    fun tokenBlocking(): String? = runBlocking { token.first() }

    fun clearBlocking() = runBlocking { clear() }
}
