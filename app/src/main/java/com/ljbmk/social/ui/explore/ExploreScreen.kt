package com.ljbmk.social.ui.explore

import android.app.Application
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.MusicNote
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.ljbmk.social.data.SessionStore
import com.ljbmk.social.data.api.ApiClient
import com.ljbmk.social.data.api.userMessage
import com.ljbmk.social.data.model.*
import com.ljbmk.social.ui.components.*
import com.ljbmk.social.ui.theme.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * EXPLORE — search plus discovery.
 *
 * With an empty query it shows trending (which is velocity-based, not
 * "most lifetime views") and creators worth discovering. Typing switches it to
 * ranked search results.
 */
class ExploreViewModel(app: Application) : AndroidViewModel(app) {
    private val session = SessionStore(app)
    private val api = ApiClient.get(session)

    data class UiState(
        val loading: Boolean = true,
        val error: String? = null,
        val query: String = "",
        val trending: List<Video> = emptyList(),
        val creators: List<Channel> = emptyList(),
        val sounds: List<Sound> = emptyList(),
        val results: SearchResponse? = null,
        val trendingEmpty: EmptyState? = null,
    )

    private val _state = MutableStateFlow(UiState())
    val state = _state.asStateFlow()

    private var searchJob: Job? = null

    init { loadDiscover() }

    fun loadDiscover() {
        _state.update { it.copy(loading = true, error = null, results = null) }
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val trending = api.trending(18)
                val creators = runCatching { api.suggestedChannels(10).channels }.getOrDefault(emptyList())
                val sounds = runCatching { api.trendingSounds().sounds }.getOrDefault(emptyList())
                _state.update {
                    it.copy(
                        loading = false,
                        trending = trending.videos,
                        trendingEmpty = trending.empty,
                        creators = creators,
                        sounds = sounds,
                    )
                }
            } catch (t: Throwable) {
                _state.update { it.copy(loading = false, error = t.userMessage()) }
            }
        }
    }

    /** Debounced so we don't fire a request per keystroke. */
    fun onQueryChange(query: String) {
        _state.update { it.copy(query = query) }
        searchJob?.cancel()

        if (query.isBlank()) {
            _state.update { it.copy(results = null) }
            return
        }

        searchJob = viewModelScope.launch(Dispatchers.IO) {
            delay(280)
            try {
                _state.update { it.copy(results = api.search(query)) }
            } catch (t: Throwable) {
                _state.update { it.copy(error = t.userMessage()) }
            }
        }
    }
}

@Composable
fun ExploreScreen(
    unreadCount: Int,
    onOpenVideo: (String) -> Unit,
    onOpenChannel: (String) -> Unit,
    onOpenSound: (String) -> Unit,
    onNavigate: (String) -> Unit,
    onNotificationsClick: () -> Unit,
    viewModel: ExploreViewModel = viewModel(),
) {
    val state by viewModel.state.collectAsState()

    Column(Modifier.fillMaxSize()) {
        LjbmkTopBar(
            unreadCount = unreadCount,
            onNotificationsClick = onNotificationsClick,
        )

        OutlinedTextField(
            value = state.query,
            onValueChange = viewModel::onQueryChange,
            placeholder = { Text("Search videos, creators, sounds") },
            leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
            singleLine = true,
            shape = CircleShape,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 8.dp),
        )

        when {
            state.loading -> LoadingView()
            state.error != null && state.results == null ->
                ErrorView(state.error!!, onRetry = viewModel::loadDiscover)
            state.results != null ->
                SearchResults(state.results!!, onOpenVideo, onOpenChannel, onOpenSound)
            else ->
                Discover(state, onOpenVideo, onOpenChannel, onOpenSound, onNavigate)
        }
    }
}

@Composable
private fun Discover(
    state: ExploreViewModel.UiState,
    onOpenVideo: (String) -> Unit,
    onOpenChannel: (String) -> Unit,
    onOpenSound: (String) -> Unit,
    onNavigate: (String) -> Unit,
) {
    if (state.trending.isEmpty() && state.creators.isEmpty()) {
        EmptyStateView(
            state = state.trendingEmpty ?: EmptyState(
                title = "Nothing to explore yet.",
                body = "Once people start posting, this is where you'll find what's taking off.",
                action = EmptyAction("Post a video", "/upload"),
            ),
            icon = "🌱",
            onAction = onNavigate,
        )
        return
    }

    LazyColumn(
        contentPadding = PaddingValues(bottom = 90.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (state.trending.isNotEmpty()) {
            item {
                SectionHeader(
                    "🔥 Trending now",
                    "Ranked by how fast something is growing, not by lifetime views.",
                )
            }
            item {
                // A fixed-height grid inside a LazyColumn: the row count is
                // known, so this cannot grow unbounded.
                val rows = (state.trending.size + 2) / 3
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
                    items(state.trending, key = { it.id }) { video ->
                        VideoThumbnail(video.thumbnailUrl, video.stats.views) { onOpenVideo(video.id) }
                    }
                }
            }
        }

        if (state.creators.isNotEmpty()) {
            item {
                SectionHeader(
                    "✨ Creators to discover",
                    "A mix of new and established — not just the biggest accounts.",
                )
            }
            items(state.creators, key = { it.id }) { channel ->
                ChannelRow(channel) { onOpenChannel(channel.handle) }
            }
        }

        if (state.sounds.isNotEmpty()) {
            item { SectionHeader("🎵 Sounds people are using", null) }
            items(state.sounds, key = { it.id }) { sound ->
                SoundRow(sound) { onOpenSound(sound.id) }
            }
        }
    }
}

@Composable
private fun SearchResults(
    results: SearchResponse,
    onOpenVideo: (String) -> Unit,
    onOpenChannel: (String) -> Unit,
    onOpenSound: (String) -> Unit,
) {
    if (results.total == 0) {
        EmptyStateView(
            state = results.empty ?: EmptyState("No results found.", "Try another search."),
            icon = "🔍",
        )
        return
    }

    LazyColumn(contentPadding = PaddingValues(bottom = 90.dp)) {
        if (results.channels.isNotEmpty()) {
            item { SectionHeader("Creators", null) }
            items(results.channels, key = { it.id }) { channel ->
                ChannelRow(channel) { onOpenChannel(channel.handle) }
            }
        }
        if (results.sounds.isNotEmpty()) {
            item { SectionHeader("Sounds", null) }
            items(results.sounds, key = { it.id }) { sound ->
                SoundRow(sound) { onOpenSound(sound.id) }
            }
        }
        if (results.videos.isNotEmpty()) {
            item { SectionHeader("Videos", null) }
            item {
                val rows = (results.videos.size + 2) / 3
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
                    items(results.videos, key = { it.id }) { video ->
                        VideoThumbnail(video.thumbnailUrl, video.stats.views) { onOpenVideo(video.id) }
                    }
                }
            }
        }
    }
}

@Composable
private fun SectionHeader(title: String, subtitle: String?) {
    Column(Modifier.padding(start = 14.dp, end = 14.dp, top = 16.dp, bottom = 6.dp)) {
        Text(title, style = MaterialTheme.typography.titleMedium, color = OnBackground)
        subtitle?.let {
            Text(it, fontSize = 12.5.sp, color = TextFaint, modifier = Modifier.padding(top = 2.dp))
        }
    }
}

@Composable
private fun ChannelRow(channel: Channel, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Avatar(channel.avatarUrl, channel.name)
        Column(Modifier.weight(1f)) {
            Text(
                channel.name,
                fontWeight = FontWeight.SemiBold,
                color = OnBackground,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                "@${channel.handle} · ${formatCount(channel.followerCount)} followers · ${channel.videoCount} videos",
                fontSize = 12.5.sp,
                color = TextMuted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun SoundRow(sound: Sound, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            Modifier
                .size(42.dp)
                .clip(CircleShape)
                .background(SurfaceHigh),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Outlined.MusicNote, contentDescription = null, tint = BrandMagenta)
        }
        Column(Modifier.weight(1f)) {
            Text(
                sound.title,
                fontWeight = FontWeight.SemiBold,
                color = OnBackground,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                "${sound.artist.ifBlank { "Original" }} · ${formatCount(sound.useCount)} videos",
                fontSize = 12.5.sp,
                color = TextMuted,
            )
        }
    }
}
