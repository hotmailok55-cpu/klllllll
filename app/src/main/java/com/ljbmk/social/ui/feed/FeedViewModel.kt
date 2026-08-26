package com.ljbmk.social.ui.feed

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.ljbmk.social.data.SessionStore
import com.ljbmk.social.data.api.ApiClient
import com.ljbmk.social.data.api.userMessage
import com.ljbmk.social.data.model.EmptyState
import com.ljbmk.social.data.model.Video
import com.ljbmk.social.data.model.WatchRequest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * State and behaviour for the scrolling feed.
 *
 * Responsibilities:
 *   - load pages from `/api/v1/feed` and append them, so scrolling never ends
 *   - report watch time when a video is scrolled away from
 *   - apply like/save optimistically so the UI answers instantly
 */
class FeedViewModel(app: Application) : AndroidViewModel(app) {

    private val session = SessionStore(app)
    private val api = ApiClient.get(session)

    data class UiState(
        val videos: List<Video> = emptyList(),
        val loading: Boolean = true,
        val loadingMore: Boolean = false,
        val error: String? = null,
        val empty: EmptyState? = null,
        /** empty_platform | cold_start_user | personalized */
        val mode: String = "personalized",
        val endReached: Boolean = false,
    )

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    private var cursor = 0

    init { refresh() }

    fun refresh() {
        cursor = 0
        _state.update { it.copy(loading = true, error = null, endReached = false) }
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val page = api.feed(kind = "short", limit = 8, cursor = 0)
                cursor = page.nextCursor ?: 0
                _state.update {
                    it.copy(
                        videos = page.videos,
                        loading = false,
                        empty = page.empty,
                        mode = page.mode,
                        endReached = page.nextCursor == null,
                        error = null,
                    )
                }
            } catch (t: Throwable) {
                _state.update { it.copy(loading = false, error = t.userMessage()) }
            }
        }
    }

    /**
     * Load the next page as the viewer approaches the end.
     * Called from the pager when they are within a couple of items of the last.
     */
    fun loadMore() {
        val current = _state.value
        if (current.loadingMore || current.endReached || current.loading) return

        _state.update { it.copy(loadingMore = true) }
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val page = api.feed(kind = "short", limit = 8, cursor = cursor)
                cursor = page.nextCursor ?: cursor
                _state.update {
                    it.copy(
                        videos = it.videos + page.videos,
                        loadingMore = false,
                        endReached = page.nextCursor == null || page.videos.isEmpty(),
                    )
                }
            } catch (_: Throwable) {
                // Silent: the viewer still has videos to scroll. The next
                // scroll retries.
                _state.update { it.copy(loadingMore = false) }
            }
        }
    }

    /**
     * Report how long a video was watched.
     *
     * The app never claims a view — it reports time, and the SERVER decides
     * whether that counts. That is what makes view counts resistant to a
     * scripted client.
     */
    fun reportWatch(videoId: String, watchMs: Long, replayed: Boolean) {
        if (watchMs < 300) return
        viewModelScope.launch(Dispatchers.IO) {
            runCatching {
                api.watch(videoId, WatchRequest(watchMs = watchMs, source = "feed", replayed = replayed))
            }
        }
    }

    /** Like/unlike, applied optimistically then reconciled with the server. */
    fun toggleLike(video: Video) {
        val wasLiked = video.viewerState?.liked == true
        updateVideo(video.id) { v ->
            v.copy(
                viewerState = (v.viewerState ?: com.ljbmk.social.data.model.ViewerState())
                    .copy(liked = !wasLiked),
                stats = v.stats.copy(likes = v.stats.likes + if (wasLiked) -1 else 1),
            )
        }

        viewModelScope.launch(Dispatchers.IO) {
            runCatching { api.like(video.id) }
                .onSuccess { result ->
                    updateVideo(video.id) { v ->
                        v.copy(
                            viewerState = (v.viewerState ?: com.ljbmk.social.data.model.ViewerState())
                                .copy(liked = result.liked, disliked = result.disliked),
                            stats = v.stats.copy(likes = result.likes, dislikes = result.dislikes),
                        )
                    }
                }
                .onFailure {
                    // Roll the optimistic change back so the UI never lies.
                    updateVideo(video.id) { v ->
                        v.copy(
                            viewerState = (v.viewerState ?: com.ljbmk.social.data.model.ViewerState())
                                .copy(liked = wasLiked),
                            stats = v.stats.copy(likes = v.stats.likes + if (wasLiked) 1 else -1),
                        )
                    }
                }
        }
    }

    fun toggleSave(video: Video) {
        val wasSaved = video.viewerState?.saved == true
        updateVideo(video.id) { v ->
            v.copy(
                viewerState = (v.viewerState ?: com.ljbmk.social.data.model.ViewerState())
                    .copy(saved = !wasSaved)
            )
        }
        viewModelScope.launch(Dispatchers.IO) {
            runCatching { api.save(video.id) }.onFailure {
                updateVideo(video.id) { v ->
                    v.copy(
                        viewerState = (v.viewerState ?: com.ljbmk.social.data.model.ViewerState())
                            .copy(saved = wasSaved)
                    )
                }
            }
        }
    }

    fun toggleFollow(video: Video) {
        val channelId = video.channel?.id ?: return
        val wasFollowing = video.viewerState?.following == true

        // Apply to EVERY video from this creator, not just the visible one.
        _state.update { s ->
            s.copy(videos = s.videos.map { v ->
                if (v.channel?.id == channelId) {
                    v.copy(
                        viewerState = (v.viewerState ?: com.ljbmk.social.data.model.ViewerState())
                            .copy(following = !wasFollowing)
                    )
                } else v
            })
        }

        viewModelScope.launch(Dispatchers.IO) {
            runCatching { api.follow(channelId) }.onFailure {
                _state.update { s ->
                    s.copy(videos = s.videos.map { v ->
                        if (v.channel?.id == channelId) {
                            v.copy(
                                viewerState = (v.viewerState ?: com.ljbmk.social.data.model.ViewerState())
                                    .copy(following = wasFollowing)
                            )
                        } else v
                    })
                }
            }
        }
    }

    fun share(video: Video) {
        viewModelScope.launch(Dispatchers.IO) { runCatching { api.share(video.id) } }
    }

    private fun updateVideo(id: String, transform: (Video) -> Video) {
        _state.update { s ->
            s.copy(videos = s.videos.map { if (it.id == id) transform(it) else it })
        }
    }
}
