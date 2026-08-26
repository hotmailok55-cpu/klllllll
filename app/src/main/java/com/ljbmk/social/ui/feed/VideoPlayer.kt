package com.ljbmk.social.ui.feed

import android.view.ViewGroup
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.LifecycleEventObserver
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import coil.compose.AsyncImage
import com.ljbmk.social.ui.theme.SurfaceHigh
import com.ljbmk.social.ui.theme.TextFaint
import kotlinx.coroutines.delay

/**
 * A single video in the feed.
 *
 * Two things make this behave correctly at scale:
 *
 *  1. **Only the active page holds an ExoPlayer.** When a video scrolls out of
 *     view its player is released. Without that, scrolling 200 videos would
 *     leave 200 decoders alive and the app would be killed for memory.
 *
 *  2. **Watch time is measured in real elapsed time**, not from the playback
 *     position, because a looping video's position resets. That number is
 *     reported when the video goes inactive — one request per video rather
 *     than a heartbeat every second.
 */
@UnstableApi
@Composable
fun VideoPlayer(
    videoUrl: String?,
    thumbnailUrl: String?,
    isActive: Boolean,
    onWatched: (watchMs: Long, replayed: Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current

    // Nothing to play — the video is still processing, or has no file.
    if (videoUrl.isNullOrBlank()) {
        ProcessingPlaceholder(thumbnailUrl, modifier)
        return
    }

    var isPaused by remember(videoUrl) { mutableStateOf(false) }
    var showPauseIcon by remember(videoUrl) { mutableStateOf(false) }

    // Accumulated watch time, and whether the video looped at least once.
    val watchedMs = remember(videoUrl) { mutableLongStateOf(0L) }
    val replayed = remember(videoUrl) { mutableStateOf(false) }

    // The player exists ONLY while this page is the active one.
    val player = remember(videoUrl, isActive) {
        if (!isActive) null else ExoPlayer.Builder(context).build().apply {
            setMediaItem(MediaItem.fromUri(videoUrl))
            repeatMode = Player.REPEAT_MODE_ONE   // shorts loop
            playWhenReady = true
            volume = 1f
            prepare()
        }
    }

    // Count a loop restart as a replay — a strong positive signal that the
    // recommendation engine weighs separately from a plain view.
    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onPositionDiscontinuity(
                oldPosition: Player.PositionInfo,
                newPosition: Player.PositionInfo,
                reason: Int,
            ) {
                if (reason == Player.DISCONTINUITY_REASON_AUTO_TRANSITION) {
                    replayed.value = true
                }
            }
        }
        player?.addListener(listener)
        onDispose { player?.removeListener(listener) }
    }

    // Accumulate real elapsed time while playing.
    LaunchedEffect(player, isPaused) {
        if (player == null || isPaused) return@LaunchedEffect
        var last = System.currentTimeMillis()
        // `while (true)`, not `while (isActive)`: the composable's own
        // `isActive` parameter would shadow CoroutineScope.isActive here.
        // delay() throws on cancellation, which ends the loop correctly.
        while (true) {
            delay(250)
            val now = System.currentTimeMillis()
            if (player.isPlaying) watchedMs.longValue += (now - last)
            last = now
        }
    }

    // Pause when the app goes to the background; resume when it returns.
    DisposableEffect(lifecycleOwner, player) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_PAUSE -> player?.pause()
                Lifecycle.Event.ON_RESUME -> if (!isPaused) player?.play()
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    // Release the player and report the watch when this page goes inactive.
    DisposableEffect(player) {
        onDispose {
            onWatched(watchedMs.longValue, replayed.value)
            player?.release()
        }
    }

    Box(modifier.background(Color.Black), contentAlignment = Alignment.Center) {

        // The poster stays underneath until the first frame renders, so the
        // screen is never an empty black rectangle.
        if (!thumbnailUrl.isNullOrBlank()) {
            AsyncImage(
                model = thumbnailUrl,
                contentDescription = null,
                contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize(),
            )
        }

        if (player != null) {
            AndroidView(
                factory = { ctx ->
                    PlayerView(ctx).apply {
                        useController = false          // the feed has its own controls
                        resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
                        layoutParams = ViewGroup.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.MATCH_PARENT,
                        )
                        setShutterBackgroundColor(android.graphics.Color.TRANSPARENT)
                    }
                },
                update = { view -> view.player = player },
                modifier = Modifier.fillMaxSize(),
            )
        }

        // Tap anywhere to pause/resume.
        Box(
            Modifier
                .fillMaxSize()
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                ) {
                    player ?: return@clickable
                    if (player.isPlaying) { player.pause(); isPaused = true }
                    else { player.play(); isPaused = false }
                    showPauseIcon = true
                }
        )

        if (showPauseIcon) {
            LaunchedEffect(isPaused, showPauseIcon) {
                delay(500)
                showPauseIcon = false
            }
            Box(
                Modifier
                    .size(72.dp)
                    .background(Color.Black.copy(alpha = 0.5f), shape = androidx.compose.foundation.shape.CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Text(if (isPaused) "❚❚" else "▶", color = Color.White, fontSize = 26.sp)
            }
        }
    }
}

/**
 * Shown when a video has no playable file yet.
 * Never a silent black screen — the viewer is told what is happening.
 */
@Composable
private fun ProcessingPlaceholder(thumbnailUrl: String?, modifier: Modifier = Modifier) {
    Box(modifier.background(SurfaceHigh), contentAlignment = Alignment.Center) {
        if (!thumbnailUrl.isNullOrBlank()) {
            AsyncImage(
                model = thumbnailUrl,
                contentDescription = null,
                contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize(),
            )
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text("🎬", fontSize = 34.sp)
            Spacer(Modifier.height(8.dp))
            Text("This video is still processing", color = TextFaint, fontSize = 14.sp)
        }
    }
}
