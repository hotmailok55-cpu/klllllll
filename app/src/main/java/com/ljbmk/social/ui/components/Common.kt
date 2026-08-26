package com.ljbmk.social.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.ljbmk.social.data.model.EmptyState
import com.ljbmk.social.ui.theme.*
import kotlin.math.abs

/**
 * Shared pieces used across screens: empty states, loading, errors, avatars,
 * and the gradient button that carries the brand.
 */

/**
 * Renders an empty state.
 *
 * The copy comes from the SERVER ([EmptyState]) wherever possible, so the app
 * shows the honest message for the actual situation — "No videos yet, be one of
 * the first creators" on a brand-new platform vs "You're all caught up" when
 * the viewer has simply seen everything.
 */
@Composable
fun EmptyStateView(
    state: EmptyState?,
    icon: String = "✨",
    onAction: (String) -> Unit = {},
    modifier: Modifier = Modifier,
) {
    if (state == null) return
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(horizontal = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(icon, fontSize = 44.sp)
        Spacer(Modifier.height(14.dp))
        Text(
            state.title,
            style = MaterialTheme.typography.headlineMedium,
            textAlign = TextAlign.Center,
            color = OnBackground,
        )
        state.body?.let {
            Spacer(Modifier.height(8.dp))
            Text(
                it,
                style = MaterialTheme.typography.bodyMedium,
                color = TextMuted,
                textAlign = TextAlign.Center,
            )
        }
        state.action?.let { action ->
            Spacer(Modifier.height(22.dp))
            GradientButton(
                text = action.label,
                onClick = { onAction(action.href) },
                modifier = Modifier.fillMaxWidth(0.8f),
            )
        }
        state.secondaryAction?.let { action ->
            Spacer(Modifier.height(10.dp))
            OutlinedButton(
                onClick = { onAction(action.href) },
                modifier = Modifier.fillMaxWidth(0.8f),
                shape = CircleShape,
            ) { Text(action.label) }
        }
    }
}

/** The brand gradient as a button — used for the one primary action per screen. */
@Composable
fun GradientButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    Box(
        modifier = modifier
            .clip(CircleShape)
            .background(if (enabled) BrandGradient else androidx.compose.ui.graphics.SolidColor(SurfaceHigh))
            .clickable(enabled = enabled, onClick = onClick)
            .padding(vertical = 14.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text,
            color = if (enabled) Color.White else TextFaint,
            fontWeight = FontWeight.SemiBold,
            fontSize = 15.sp,
        )
    }
}

@Composable
fun LoadingView(message: String = "Loading…", modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        CircularProgressIndicator(color = BrandPurple, strokeWidth = 2.5.dp)
        Spacer(Modifier.height(14.dp))
        Text(message, color = TextMuted, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
fun ErrorView(message: String, onRetry: (() -> Unit)? = null, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(horizontal = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text("⚠️", fontSize = 40.sp)
        Spacer(Modifier.height(12.dp))
        Text(
            "Something went wrong",
            style = MaterialTheme.typography.titleLarge,
            color = OnBackground,
        )
        Spacer(Modifier.height(6.dp))
        Text(
            message,
            style = MaterialTheme.typography.bodyMedium,
            color = TextMuted,
            textAlign = TextAlign.Center,
        )
        if (onRetry != null) {
            Spacer(Modifier.height(20.dp))
            GradientButton("Try again", onRetry, Modifier.fillMaxWidth(0.7f))
        }
    }
}

/**
 * An avatar that falls back to a coloured initial.
 *
 * The colour is derived from the name, so the same person always gets the same
 * colour and the fallback still reads as an identity rather than a grey blob.
 */
@Composable
fun Avatar(
    url: String?,
    name: String?,
    size: Dp = 42.dp,
    modifier: Modifier = Modifier,
) {
    val shape = CircleShape
    if (!url.isNullOrBlank()) {
        AsyncImage(
            model = url,
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = modifier
                .size(size)
                .clip(shape)
                .background(SurfaceHigh),
        )
    } else {
        val initial = (name?.trim()?.firstOrNull() ?: '?').uppercaseChar()
        val hue = abs((name ?: "").hashCode() % 360).toFloat()
        Box(
            modifier = modifier
                .size(size)
                .clip(shape)
                .background(Color.hsl(hue, 0.55f, 0.42f)),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                initial.toString(),
                color = Color.White,
                fontWeight = FontWeight.Bold,
                fontSize = (size.value * 0.4f).sp,
            )
        }
    }
}

/** A thumbnail tile, used in the Explore and Library grids. */
@Composable
fun VideoThumbnail(
    thumbnailUrl: String?,
    views: Int,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .aspectRatio(9f / 16f)
            .clip(RoundedCornerShape(6.dp))
            .background(SurfaceHigh)
            .clickable(onClick = onClick),
    ) {
        if (!thumbnailUrl.isNullOrBlank()) {
            AsyncImage(
                model = thumbnailUrl,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("🎬", fontSize = 26.sp)
            }
        }
        Text(
            "▶ ${formatCount(views)}",
            color = Color.White,
            fontSize = 11.5.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(6.dp),
        )
    }
}

/** 1234 -> "1.2K". Keeps counts readable in the tight action rail. */
fun formatCount(n: Int): String = when {
    n < 1_000 -> n.toString()
    n < 1_000_000 -> String.format("%.1fK", n / 1_000f).replace(".0", "")
    n < 1_000_000_000 -> String.format("%.1fM", n / 1_000_000f).replace(".0", "")
    else -> String.format("%.1fB", n / 1_000_000_000f).replace(".0", "")
}
