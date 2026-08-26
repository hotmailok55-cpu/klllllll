package com.ljbmk.social.ui.feed

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.VerticalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.MusicNote
import androidx.compose.material.icons.outlined.Reply
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.ljbmk.social.data.model.Video
import com.ljbmk.social.ui.components.*
import com.ljbmk.social.ui.theme.*

/**
 * THE FEED — the app's main surface.
 *
 * A [VerticalPager] gives the one-video-per-swipe feel natively, with proper
 * fling physics. Only the current page plays: ExoPlayer instances for other
 * pages are released, so memory stays flat no matter how far you scroll.
 */
@Composable
fun FeedScreen(
    unreadCount: Int,
    onOpenComments: (Video) -> Unit,
    onOpenChannel: (String) -> Unit,
    onOpenSound: (String) -> Unit,
    onShare: (Video) -> Unit,
    onNavigate: (String) -> Unit,
    onSearchClick: () -> Unit,
    onNotificationsClick: () -> Unit,
    viewModel: FeedViewModel = viewModel(),
) {
    val state by viewModel.state.collectAsState()

    Box(Modifier.fillMaxSize().background(Color.Black)) {

        when {
            state.loading -> LoadingView("Finding something good…")

            state.error != null ->
                ErrorView(state.error!!, onRetry = viewModel::refresh)

            state.videos.isEmpty() ->
                EmptyStateView(
                    state = state.empty,
                    icon = if (state.mode == "empty_platform") "🌱" else "🎉",
                    onAction = onNavigate,
                )

            else -> FeedPager(
                state = state,
                viewModel = viewModel,
                onOpenComments = onOpenComments,
                onOpenChannel = onOpenChannel,
                onOpenSound = onOpenSound,
                onShare = onShare,
            )
        }

        // The logo sits on top of everything, exactly like YouTube's.
        LjbmkTopBarOverlay(
            modifier = Modifier.align(Alignment.TopCenter),
            unreadCount = unreadCount,
            onSearchClick = onSearchClick,
            onNotificationsClick = onNotificationsClick,
        )
    }
}

@Composable
private fun FeedPager(
    state: FeedViewModel.UiState,
    viewModel: FeedViewModel,
    onOpenComments: (Video) -> Unit,
    onOpenChannel: (String) -> Unit,
    onOpenSound: (String) -> Unit,
    onShare: (Video) -> Unit,
) {
    val pagerState = rememberPagerState(pageCount = { state.videos.size })

    // Page in more videos before the viewer reaches the end, so the scroll
    // never stops on them.
    LaunchedEffect(pagerState.currentPage, state.videos.size) {
        if (pagerState.currentPage >= state.videos.size - 3) viewModel.loadMore()
    }

    VerticalPager(
        state = pagerState,
        modifier = Modifier.fillMaxSize(),
        // Keep one page either side warm so the next video starts instantly.
        beyondViewportPageCount = 1,
        key = { index -> state.videos.getOrNull(index)?.id ?: index },
    ) { page ->
        val video = state.videos.getOrNull(page) ?: return@VerticalPager

        FeedItem(
            video = video,
            isActive = pagerState.currentPage == page && !pagerState.isScrollInProgress,
            onWatched = { watchMs, replayed -> viewModel.reportWatch(video.id, watchMs, replayed) },
            onLike = { viewModel.toggleLike(video) },
            onSave = { viewModel.toggleSave(video) },
            onFollow = { viewModel.toggleFollow(video) },
            onComments = { onOpenComments(video) },
            onShare = { viewModel.share(video); onShare(video) },
            onChannel = { video.channel?.handle?.let(onOpenChannel) },
            onSound = { video.sound?.id?.let(onOpenSound) },
        )
    }
}

/** One full-screen video with its overlay. */
@Composable
private fun FeedItem(
    video: Video,
    isActive: Boolean,
    onWatched: (Long, Boolean) -> Unit,
    onLike: () -> Unit,
    onSave: () -> Unit,
    onFollow: () -> Unit,
    onComments: () -> Unit,
    onShare: () -> Unit,
    onChannel: () -> Unit,
    onSound: () -> Unit,
) {
    Box(Modifier.fillMaxSize().background(Color.Black)) {

        VideoPlayer(
            videoUrl = video.videoUrl,
            thumbnailUrl = video.thumbnailUrl,
            isActive = isActive,
            onWatched = onWatched,
            modifier = Modifier.fillMaxSize(),
        )

        // Bottom scrim so white overlay text stays readable over any footage.
        Box(
            Modifier
                .fillMaxWidth()
                .fillMaxHeight(0.45f)
                .align(Alignment.BottomCenter)
                .background(
                    Brush.verticalGradient(
                        listOf(Color.Transparent, Color.Black.copy(alpha = 0.75f))
                    )
                )
        )

        Row(
            modifier = Modifier
                .fillMaxSize()
                .navigationBarsPadding()
                .padding(bottom = 12.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            VideoInfo(
                video = video,
                onChannel = onChannel,
                onSound = onSound,
                modifier = Modifier
                    .weight(1f)
                    .padding(start = 14.dp, bottom = 14.dp, end = 8.dp),
            )
            ActionRail(
                video = video,
                onLike = onLike,
                onSave = onSave,
                onFollow = onFollow,
                onComments = onComments,
                onShare = onShare,
                onChannel = onChannel,
                modifier = Modifier.padding(end = 8.dp, bottom = 14.dp),
            )
        }
    }
}

/** Creator, caption and the tappable sound chip. */
@Composable
private fun VideoInfo(
    video: Video,
    onChannel: () -> Unit,
    onSound: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var expanded by remember { mutableStateOf(false) }

    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            "@${video.channel?.handle ?: "unknown"}",
            color = Color.White,
            fontWeight = FontWeight.Bold,
            fontSize = 16.sp,
            modifier = Modifier.clickable(onClick = onChannel),
        )

        Text(
            video.title,
            color = Color.White,
            fontSize = 14.5.sp,
            lineHeight = 20.sp,
            maxLines = if (expanded) 8 else 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.clickable { expanded = !expanded },
        )

        // The sound chip. Tapping it opens that sound's own page — which is
        // what turns audio into a discovery surface of its own.
        video.sound?.let { sound ->
            Row(
                modifier = Modifier
                    .clip(CircleShape)
                    .background(Color.Black.copy(alpha = 0.55f))
                    .clickable(onClick = onSound)
                    .padding(horizontal = 12.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Icon(
                    Icons.Outlined.MusicNote,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(14.dp),
                )
                Text(
                    buildString {
                        append(sound.title)
                        if (sound.artist.isNotBlank()) append(" · ${sound.artist}")
                    },
                    color = Color.White,
                    fontSize = 13.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

/** The right-hand rail: avatar + follow, like, comment, save, share. */
@Composable
private fun ActionRail(
    video: Video,
    onLike: () -> Unit,
    onSave: () -> Unit,
    onFollow: () -> Unit,
    onComments: () -> Unit,
    onShare: () -> Unit,
    onChannel: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val viewer = video.viewerState

    Column(
        modifier = modifier.width(72.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        // Avatar with the follow badge underneath it.
        Box(contentAlignment = Alignment.BottomCenter) {
            Avatar(
                url = video.channel?.avatarUrl,
                name = video.channel?.name,
                size = 46.dp,
                modifier = Modifier.clickable(onClick = onChannel),
            )
            if (viewer?.isOwner != true) {
                Box(
                    modifier = Modifier
                        .offset(y = 10.dp)
                        .size(21.dp)
                        .clip(CircleShape)
                        .background(if (viewer?.following == true) Success else BrandMagenta)
                        .clickable(onClick = onFollow),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        if (viewer?.following == true) "✓" else "+",
                        color = Color.White,
                        fontSize = if (viewer?.following == true) 11.sp else 15.sp,
                        fontWeight = FontWeight.Bold,
                    )
                }
            }
        }

        Spacer(Modifier.height(2.dp))

        ActionButton(
            icon = if (viewer?.liked == true) Icons.Filled.Favorite else Icons.Outlined.FavoriteBorder,
            label = formatCount(video.stats.likes),
            tint = if (viewer?.liked == true) BrandMagenta else Color.White,
            onClick = onLike,
            contentDescription = "Like",
        )
        ActionButton(
            icon = Icons.Outlined.ChatBubbleOutline,
            label = formatCount(video.stats.comments),
            onClick = onComments,
            contentDescription = "Comments",
        )
        ActionButton(
            icon = if (viewer?.saved == true) Icons.Filled.Bookmark else Icons.Outlined.BookmarkBorder,
            label = formatCount(video.stats.saves),
            tint = if (viewer?.saved == true) Warning else Color.White,
            onClick = onSave,
            contentDescription = "Save",
        )
        ActionButton(
            icon = Icons.Outlined.Reply,
            label = formatCount(video.stats.shares),
            onClick = onShare,
            contentDescription = "Share",
        )
    }
}

@Composable
private fun ActionButton(
    icon: ImageVector,
    label: String,
    onClick: () -> Unit,
    contentDescription: String,
    tint: Color = Color.White,
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(3.dp),
        modifier = Modifier.clickable(
            interactionSource = remember { MutableInteractionSource() },
            indication = null,
            onClick = onClick,
        ),
    ) {
        Icon(icon, contentDescription = contentDescription, tint = tint, modifier = Modifier.size(31.dp))
        Text(label, color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
    }
}
