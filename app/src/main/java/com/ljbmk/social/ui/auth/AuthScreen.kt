package com.ljbmk.social.ui.auth

import android.app.Application
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.ljbmk.social.data.SessionStore
import com.ljbmk.social.data.api.ApiClient
import com.ljbmk.social.data.api.ApiException
import com.ljbmk.social.data.api.userMessage
import com.ljbmk.social.data.model.LoginRequest
import com.ljbmk.social.data.model.RegisterRequest
import com.ljbmk.social.ui.components.GradientButton
import com.ljbmk.social.ui.components.LjbmkLogo
import com.ljbmk.social.ui.theme.Danger
import com.ljbmk.social.ui.theme.TextFaint
import com.ljbmk.social.ui.theme.TextMuted
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

class AuthViewModel(app: Application) : AndroidViewModel(app) {
    private val session = SessionStore(app)
    private val api = ApiClient.get(session)

    data class UiState(
        val isSignUp: Boolean = false,
        val busy: Boolean = false,
        val error: String? = null,
        val fieldErrors: Map<String, String> = emptyMap(),
        val success: Boolean = false,
    )

    private val _state = MutableStateFlow(UiState())
    val state = _state.asStateFlow()

    fun toggleMode() = _state.update {
        it.copy(isSignUp = !it.isSignUp, error = null, fieldErrors = emptyMap())
    }

    fun submit(email: String, password: String, username: String, displayName: String) {
        _state.update { it.copy(busy = true, error = null, fieldErrors = emptyMap()) }

        viewModelScope.launch(Dispatchers.IO) {
            try {
                val result = if (_state.value.isSignUp) {
                    api.register(
                        RegisterRequest(
                            username = username.trim(),
                            email = email.trim(),
                            password = password,
                            displayName = displayName.trim().ifBlank { username.trim() },
                        )
                    )
                } else {
                    api.login(LoginRequest(email = email.trim(), password = password))
                }
                session.save(result.token, result.user.username)
                _state.update { it.copy(busy = false, success = true) }
            } catch (t: Throwable) {
                _state.update {
                    it.copy(
                        busy = false,
                        error = t.userMessage(),
                        fieldErrors = (t as? ApiException)?.fieldErrors ?: emptyMap(),
                    )
                }
            }
        }
    }
}

@Composable
fun AuthScreen(
    onSignedIn: () -> Unit,
    onSkip: () -> Unit,
    viewModel: AuthViewModel = viewModel(),
) {
    val state by viewModel.state.collectAsState()

    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var username by remember { mutableStateOf("") }
    var displayName by remember { mutableStateOf("") }

    LaunchedEffect(state.success) { if (state.success) onSignedIn() }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .systemBarsPadding()
            .padding(horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(56.dp))

        // The logo, big, as the first thing you see.
        LjbmkLogo(height = 44.dp)

        Spacer(Modifier.height(10.dp))
        Text(
            "Where a first video can find its audience.",
            style = MaterialTheme.typography.bodyMedium,
            color = TextMuted,
            textAlign = TextAlign.Center,
        )

        Spacer(Modifier.height(30.dp))

        if (state.isSignUp) {
            Field(
                value = username,
                onValueChange = { username = it },
                label = "Username",
                supporting = "Letters, numbers, dots and underscores. This becomes your @handle.",
                error = state.fieldErrors["username"],
            )
            Field(
                value = displayName,
                onValueChange = { displayName = it },
                label = "Display name",
                error = state.fieldErrors["displayName"],
            )
        }

        Field(
            value = email,
            onValueChange = { email = it },
            label = "Email",
            keyboardType = KeyboardType.Email,
            error = state.fieldErrors["email"],
        )
        Field(
            value = password,
            onValueChange = { password = it },
            label = "Password",
            keyboardType = KeyboardType.Password,
            isPassword = true,
            supporting = if (state.isSignUp) "At least 10 characters." else null,
            error = state.fieldErrors["password"],
            imeAction = ImeAction.Done,
        )

        state.error?.let {
            Spacer(Modifier.height(6.dp))
            Text(it, color = Danger, style = MaterialTheme.typography.bodySmall)
        }

        Spacer(Modifier.height(20.dp))

        GradientButton(
            text = when {
                state.busy && state.isSignUp -> "Creating…"
                state.busy -> "Signing in…"
                state.isSignUp -> "Create account"
                else -> "Sign in"
            },
            onClick = { viewModel.submit(email, password, username, displayName) },
            enabled = !state.busy && email.isNotBlank() && password.isNotBlank(),
            modifier = Modifier.fillMaxWidth(),
        )

        Spacer(Modifier.height(10.dp))

        OutlinedButton(
            onClick = viewModel::toggleMode,
            enabled = !state.busy,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(if (state.isSignUp) "I already have an account" else "Create an account instead")
        }

        Spacer(Modifier.height(18.dp))

        TextButton(onClick = onSkip) {
            Text("Browse without an account", color = TextFaint)
        }

        Spacer(Modifier.height(40.dp))
    }
}

@Composable
private fun Field(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    keyboardType: KeyboardType = KeyboardType.Text,
    isPassword: Boolean = false,
    supporting: String? = null,
    error: String? = null,
    imeAction: ImeAction = ImeAction.Next,
) {
    Column(Modifier.fillMaxWidth().padding(bottom = 12.dp)) {
        OutlinedTextField(
            value = value,
            onValueChange = onValueChange,
            label = { Text(label) },
            singleLine = true,
            isError = error != null,
            visualTransformation = if (isPassword) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
            keyboardOptions = KeyboardOptions(keyboardType = keyboardType, imeAction = imeAction),
            modifier = Modifier.fillMaxWidth(),
        )
        val helper = error ?: supporting
        if (helper != null) {
            Text(
                helper,
                style = MaterialTheme.typography.bodySmall,
                color = if (error != null) Danger else TextFaint,
                modifier = Modifier.padding(start = 14.dp, top = 4.dp),
            )
        }
    }
}
