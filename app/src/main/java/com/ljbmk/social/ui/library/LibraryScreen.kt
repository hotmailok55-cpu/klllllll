package com.ljbmk.social.ui.library

import android.app.Application
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.ljbmk.social.data.SessionStore
import com.ljbmk.social.data.api.ApiClient
import com.ljbmk.social.data.api.userMessage
import com.ljbmk.social.data.model.EmptyAction
import com.ljbmk.social.data.model.EmptyState
import com.ljbmk.social.data.model.MeResponse
import com.ljbmk.social.data.model.Video
import com.ljbmk.social.ui.components.*
import com.ljbmk.social.ui.theme.OnBackground
import com.ljbmk.social.ui.theme.TextMuted
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * YOU — the signed-in user's own space: profile, saved videos, and the videos
 * from creators they follow.
 */
class LibraryViewModel(app: Application) : AndroidViewModel(app) {
    private val session = SessionStore(app)
    private val api = ApiClient.get(session)

    data class UiState(
        val loading: Boolean = true,
        val signedIn: Boolean = false,
        val me: MeResponse? = null,
        val saved: List<Video> = emptyList(),
        val savedEmpty: EmptyState? = null,
        val subscriptions: List<Video> = emptyList(),
        val subscriptionsEmpty: EmptyState? = null,
        val error: String? = null,
    )

    private val _state = MutableStateFlow(UiState())
    val state = _state.asStateFlow()

    init { load() }

    fun load() {
        _state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch(Dispatchers.IO) {
            val signedIn = session.token.first() != null
            if (!signedIn) {
                _state.update { it.copy(loading = false, signedIn = false) }
                return@launch
            }
            try {
                val me = api.me()
                val saved = runCatching { api.saved() }.getOrNull()
                val subs = runCatching { api.subscriptions() }.getOrNull()
                _state.update {
                    it.copy(
                        loading = false,
                        signedIn = true,
                        me = me,
                        saved = saved?.videos ?: emptyList(),
                        savedEmpty = saved?.empty,
                        subscriptions = subs?.videos ?: emptyList(),
                        subscriptionsEmpty = subs?.empty,
                    )
                }
            } catch (t: Throwable) {
                _state.update { it.copy(loading = false, error = t.userMessage()) }
            }
        }
    }

    fun signOut(onDone: () -> Unit) {
        viewModelScope.launch(Dispatchers.IO) {
            runCatching { api.logout() }
            session.clear()
            _state.update { UiState(loading = false, signedIn = false) }
            onDone()
        }
    }
}

@Composable
fun LibraryScreen(
    unreadCount: Int,
    onOpenVideo: (String) -> Unit,
    onSignIn: () -> Unit,
    onNavigate: (String) -> Unit,
    onNotificationsClick: () -> Unit,
    viewModel: LibraryViewModel = viewModel(),
) {
    val state by viewModel.state.collectAsState()

    Column(Modifier.fillMaxSize()) {
        LjbmkTopBar(unreadCount = unreadCount, onNotificationsClick = onNotificationsClick)

        when {
            state.loading -> LoadingView()

            !state.signedIn -> EmptyStateView(
                state = EmptyState(
                    title = "Sign in to see your library",
                    body = "Saved videos and the creators you follow all live here.",
                    action = EmptyAction("Sign in", "/signin"),
                ),
                icon = "📚",
                onAction = { onSignIn() },
            )

            state.error != null -> ErrorView(state.error!!, onRetry = viewModel::load)

            else -> LazyColumn(contentPadding = PaddingValues(bottom = 90.dp)) {

                item { ProfileHeader(state, viewModel, onSignIn) }

                item { SectionTitle("Saved") }
                if (state.saved.isNotEmpty()) {
                    item { VideoGrid(state.saved, onOpenVideo) }
                } else {
                    item {
                        InlineEmpty(state.savedEmpty ?: EmptyState(
                            "Nothing saved yet.",
                            "Tap the bookmark on any video to keep it here.",
                        ))
                    }
                }

                item { SectionTitle("From creators you follow") }
                if (state.subscriptions.isNotEmpty()) {
                    item { VideoGrid(state.subscriptions, onOpenVideo) }
                } else {
                    item {
                        InlineEmpty(state.subscriptionsEmpty ?: EmptyState(
                            "You aren't following any creators yet.",
                            "Discover creators you might like.",
                        ))
                    }
                }
            }
        }
    }
}

@Composable
private fun ProfileHeader(
    state: LibraryViewModel.UiState,
    viewModel: LibraryViewModel,
    onSignedOut: () -> Unit,
) {
    val user = state.me?.user ?: return
    val channel = state.me.channel

    Column(
        Modifier.fillMaxWidth().padding(20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Avatar(user.avatarUrl, user.displayName, size = 78.dp)
        Spacer(Modifier.height(10.dp))
        Text(user.displayName, style = MaterialTheme.typography.titleLarge, color = OnBackground)
        Text("@${user.username}", style = MaterialTheme.typography.bodyMedium, color = TextMuted)

        if (channel != null) {
            Spacer(Modifier.height(14.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(28.dp)) {
                Stat(formatCount(channel.followerCount), "Followers")
                Stat(formatCount(channel.videoCount), "Videos")
                Stat(formatCount(channel.totalViews), "Views")
            }
        }

        Spacer(Modifier.height(18.dp))
        OutlinedButton(
            onClick = { viewModel.signOut(onSignedOut) },
            modifier = Modifier.fillMaxWidth(),
        ) { Text("Sign out") }
    }
}

@Composable
private fun Stat(value: String, label: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, style = MaterialTheme.typography.titleMedium, color = OnBackground)
        Text(label, style = MaterialTheme.typography.bodySmall, color = TextMuted)
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.titleMedium,
        color = OnBackground,
        modifier = Modifier.padding(start = 14.dp, top = 18.dp, bottom = 8.dp),
    )
}

@Composable
private fun VideoGrid(videos: List<Video>, onOpenVideo: (String) -> Unit) {
    val shown = videos.take(12)
    val rows = (shown.size + 2) / 3
    LazyVerticalGrid(
        columns = GridCells.Fixed(3),
        modifier = Modifier
            .fillMaxWidth()
            .height((rows * 190).dp)
            .padding(horizontal = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
        userScrollEnabled = false,
    ) {
        items(shown, key = { it.id }) { video ->
            VideoThumbnail(video.thumbnailUrl, video.stats.views) { onOpenVideo(video.id) }
        }
    }
}

@Composable
private fun InlineEmpty(state: EmptyState) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 20.dp)) {
        Text(state.title, style = MaterialTheme.typography.bodyLarge, color = OnBackground)
        state.body?.let {
            Text(it, style = MaterialTheme.typography.bodyMedium, color = TextMuted)
        }
    }
}
