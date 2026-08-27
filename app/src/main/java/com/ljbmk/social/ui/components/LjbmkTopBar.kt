package com.ljbmk.social.ui.components

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.ljbmk.social.R
import com.ljbmk.social.ui.theme.Background
import com.ljbmk.social.ui.theme.OnBackground

/**
 * THE LJBMK SOCIAL TOP BAR.
 *
 * The logo sits top-left, exactly like YouTube's — it is the first thing on
 * screen and it is always the app's own mark, never a page title.
 *
 * Two modes:
 *   - [LjbmkTopBar] over content (Explore, Library…): solid background.
 *   - [LjbmkTopBarOverlay] over the video feed: transparent with a scrim, so
 *     the video reaches the top of the screen but the logo stays readable.
 */

private val BAR_HEIGHT = 52.dp

@Composable
fun LjbmkTopBar(
    modifier: Modifier = Modifier,
    unreadCount: Int = 0,
    onSearchClick: () -> Unit = {},
    onNotificationsClick: () -> Unit = {},
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(Background)
            .statusBarsPadding()
            .height(BAR_HEIGHT)
            .padding(start = 14.dp, end = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        LjbmkLogo()
        Spacer(Modifier.weight(1f))
        TopBarActions(unreadCount, onSearchClick, onNotificationsClick)
    }
}

/**
 * The feed variant. A top-down scrim keeps the logo legible over bright
 * footage without hiding the video behind an opaque bar.
 */
@Composable
fun LjbmkTopBarOverlay(
    modifier: Modifier = Modifier,
    unreadCount: Int = 0,
    onSearchClick: () -> Unit = {},
    onNotificationsClick: () -> Unit = {},
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(
                Brush.verticalGradient(
                    listOf(Color.Black.copy(alpha = 0.55f), Color.Transparent)
                )
            )
            .statusBarsPadding()
            .height(BAR_HEIGHT)
            .padding(start = 14.dp, end = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        LjbmkLogo()
        Spacer(Modifier.weight(1f))
        TopBarActions(unreadCount, onSearchClick, onNotificationsClick)
    }
}

/**
 * The logo itself.
 *
 * The asset is the full wordmark — the gradient play mark plus "LJBMK Social".
 * It is drawn at a fixed height and lets width follow the aspect ratio, so it
 * never distorts on any screen size.
 */
@Composable
fun LjbmkLogo(
    modifier: Modifier = Modifier,
    height: Dp = 26.dp,
) {
    Image(
        painter = painterResource(R.drawable.ic_logo_wordmark),
        contentDescription = stringResource(R.string.logo_content_description),
        modifier = modifier.height(height),
    )
}

@Composable
private fun TopBarActions(
    unreadCount: Int,
    onSearchClick: () -> Unit,
    onNotificationsClick: () -> Unit,
) {
    IconButton(onClick = onNotificationsClick) {
        BadgedBox(
            badge = {
                if (unreadCount > 0) {
                    Badge(
                        containerColor = MaterialTheme.colorScheme.secondary,
                        contentColor = Color.White,
                    ) {
                        Text(if (unreadCount > 99) "99+" else "$unreadCount")
                    }
                }
            }
        ) {
            Icon(
                Icons.Outlined.Notifications,
                contentDescription = "Notifications",
                tint = OnBackground,
            )
        }
    }
    IconButton(onClick = onSearchClick) {
        Icon(Icons.Outlined.Search, contentDescription = "Search", tint = OnBackground)
    }
}
