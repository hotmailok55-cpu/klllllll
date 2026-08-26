package com.ljbmk.social.ui.notifications

import android.app.Application
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.ljbmk.social.data.SessionStore
import com.ljbmk.social.data.api.ApiClient
import com.ljbmk.social.data.api.userMessage
import com.ljbmk.social.data.model.EmptyAction
import com.ljbmk.social.data.model.EmptyState
import com.ljbmk.social.data.model.Notification
import com.ljbmk.social.ui.components.*
import com.ljbmk.social.ui.theme.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

class NotificationsViewModel(app: Application) : AndroidViewModel(app) {
    private val session = SessionStore(app)
    private val api = ApiClient.get(session)

    data class UiState(
        val loading: Boolean = true,
        val signedIn: Boolean = false,
        val items: List<Notification> = emptyList(),
        val empty: EmptyState? = null,
        val error: String? = null,
    )

    private val _state = MutableStateFlow(UiState())
    val state = _state.asStateFlow()

    init { load() }

    fun load() {
        _state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch(Dispatchers.IO) {
            if (session.token.first() == null) {
                _state.update { it.copy(loading = false, signedIn = false) }
                return@launch
            }
            try {
                val result = api.notifications()
                _state.update {
                    it.copy(
                        loading = false,
                        signedIn = true,
                        items = result.notifications,
                        empty = result.empty,
                    )
                }
                // Mark read on view — the badge should clear once seen.
                if (result.unread > 0) runCatching { api.markNotificationsRead() }
            } catch (t: Throwable) {
                _state.update { it.copy(loading = false, error = t.userMessage()) }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NotificationsScreen(
    onBack: () -> Unit,
    onSignIn: () -> Unit,
    onOpenLink: (String) -> Unit,
    viewModel: NotificationsViewModel = viewModel(),
) {
    val state by viewModel.state.collectAsState()

    Column(Modifier.fillMaxSize().statusBarsPadding()) {
        TopAppBar(
            title = { Text("Notifications") },
            navigationIcon = {
                TextButton(onClick = onBack) { Text("←", fontSize = 20.sp) }
            },
            colors = TopAppBarDefaults.topAppBarColors(containerColor = Background),
        )

        when {
            state.loading -> LoadingView()

            !state.signedIn -> EmptyStateView(
                state = EmptyState(
                    title = "Sign in to see notifications",
                    action = EmptyAction("Sign in", "/signin"),
                ),
                icon = "🔔",
                onAction = { onSignIn() },
            )

            state.error != null -> ErrorView(state.error!!, onRetry = viewModel::load)

            state.items.isEmpty() -> EmptyStateView(
                state = state.empty ?: EmptyState(
                    "You're all caught up.",
                    "New likes, comments, and followers will show up here.",
                ),
                icon = "🎉",
            )

            else -> LazyColumn(contentPadding = PaddingValues(bottom = 90.dp)) {
                items(state.items, key = { it.id }) { notification ->
                    NotificationRow(notification) {
                        notification.link?.let(onOpenLink)
                    }
                }
            }
        }
    }
}

@Composable
private fun NotificationRow(notification: Notification, onClick: () -> Unit) {
    val icon = when (notification.type) {
        "like" -> "♥"
        "comment" -> "💬"
        "reply" -> "↩"
        "follow" -> "👤"
        "upload" -> "🎬"
        "moderation" -> "⚠️"
        "security" -> "🔒"
        else -> "•"
    }

    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 10.dp, vertical = 3.dp)
            .clip(RoundedCornerShape(10.dp))
            // Unread rows get a tint so they are findable at a glance.
            .background(if (notification.read) Background else BrandPurple.copy(alpha = 0.12f))
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            Modifier.size(40.dp).clip(CircleShape).background(SurfaceHigh),
            contentAlignment = Alignment.Center,
        ) { Text(icon, fontSize = 17.sp) }

        Column(Modifier.weight(1f)) {
            Text(notification.title, style = MaterialTheme.typography.bodyLarge, color = OnBackground)
            if (notification.body.isNotBlank()) {
                Text(
                    notification.body,
                    style = MaterialTheme.typography.bodySmall,
                    color = TextMuted,
                    maxLines = 2,
                )
            }
        }
    }
}
