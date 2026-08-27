package com.ljbmk.social

import android.app.Application
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Menu
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.ljbmk.social.data.SessionStore
import com.ljbmk.social.data.api.ApiClient
import com.ljbmk.social.data.model.Video
import com.ljbmk.social.ui.auth.AuthScreen
import com.ljbmk.social.ui.explore.ExploreScreen
import com.ljbmk.social.ui.feed.CommentsSheet
import com.ljbmk.social.ui.feed.FeedScreen
import com.ljbmk.social.ui.library.LibraryScreen
import com.ljbmk.social.ui.notifications.NotificationsScreen
import com.ljbmk.social.ui.theme.*
import com.ljbmk.social.ui.upload.UploadScreen
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/** The Application class. Somewhere to hang process-wide setup later. */
class LjbmkApplication : Application()

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            LjbmkTheme { LjbmkApp() }
        }
    }
}

/** The routes the app can be on. */
object Routes {
    const val FEED = "feed"
    const val EXPLORE = "explore"
    const val UPLOAD = "upload"
    const val NOTIFICATIONS = "notifications"
    const val LIBRARY = "library"
    const val SIGN_IN = "signin"
}

@Composable
fun LjbmkApp() {
    val navController = rememberNavController()
    val context = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()

    val session = remember { SessionStore(context) }
    var unreadCount by remember { mutableIntStateOf(0) }

    // Which video's comments are open, if any. Held here so the sheet can be
    // shown above whatever screen is underneath.
    var commentsFor by remember { mutableStateOf<Video?>(null) }

    // Keep the inbox badge current, but only while signed in.
    LaunchedEffect(Unit) {
        scope.launch(Dispatchers.IO) {
            runCatching {
                if (session.token.first() != null) {
                    unreadCount = ApiClient.get(session).me().unreadNotifications
                }
            }
        }
    }

    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route

    /** Maps a web-style href from the API's empty states onto a route. */
    fun navigateHref(href: String) {
        when {
            href.startsWith("/upload") -> navController.navigate(Routes.UPLOAD)
            href.startsWith("/explore") -> navController.navigate(Routes.EXPLORE)
            href.startsWith("/signin") -> navController.navigate(Routes.SIGN_IN)
            else -> navController.navigate(Routes.FEED)
        }
    }

    Scaffold(
        containerColor = Background,
        // The feed is full-bleed, so it draws its own chrome and gets no
        // scaffold padding.
        contentWindowInsets = WindowInsets(0),
        bottomBar = {
            if (currentRoute != Routes.SIGN_IN && currentRoute != Routes.NOTIFICATIONS) {
                LjbmkBottomBar(
                    currentRoute = currentRoute,
                    unreadCount = unreadCount,
                    onNavigate = { route ->
                        navController.navigate(route) {
                            popUpTo(Routes.FEED) { saveState = true }
                            launchSingleTop = true
                            restoreState = true
                        }
                    },
                )
            }
        },
    ) { padding ->

        NavHost(
            navController = navController,
            startDestination = Routes.FEED,
            modifier = Modifier
                .fillMaxSize()
                // Only the bottom inset — the feed paints under the status bar.
                .padding(bottom = padding.calculateBottomPadding()),
        ) {
            composable(Routes.FEED) {
                FeedScreen(
                    unreadCount = unreadCount,
                    onOpenComments = { commentsFor = it },
                    onOpenChannel = { /* channel screen — see docs/ANDROID.md */ },
                    onOpenSound = { /* sound screen — see docs/ANDROID.md */ },
                    onShare = { video -> shareVideo(context, video) },
                    onNavigate = ::navigateHref,
                    onSearchClick = { navController.navigate(Routes.EXPLORE) },
                    onNotificationsClick = { navController.navigate(Routes.NOTIFICATIONS) },
                )
            }

            composable(Routes.EXPLORE) {
                ExploreScreen(
                    unreadCount = unreadCount,
                    onOpenVideo = { navController.navigate(Routes.FEED) },
                    onOpenChannel = { },
                    onOpenSound = { },
                    onNavigate = ::navigateHref,
                    onNotificationsClick = { navController.navigate(Routes.NOTIFICATIONS) },
                )
            }

            composable(Routes.UPLOAD) {
                UploadScreen(
                    unreadCount = unreadCount,
                    onDone = { navController.navigate(Routes.LIBRARY) },
                    onNotificationsClick = { navController.navigate(Routes.NOTIFICATIONS) },
                )
            }

            composable(Routes.NOTIFICATIONS) {
                NotificationsScreen(
                    onBack = { navController.popBackStack() },
                    onSignIn = { navController.navigate(Routes.SIGN_IN) },
                    onOpenLink = { navController.navigate(Routes.FEED) },
                )
            }

            composable(Routes.LIBRARY) {
                LibraryScreen(
                    unreadCount = unreadCount,
                    onOpenVideo = { navController.navigate(Routes.FEED) },
                    onSignIn = { navController.navigate(Routes.SIGN_IN) },
                    onNavigate = ::navigateHref,
                    onNotificationsClick = { navController.navigate(Routes.NOTIFICATIONS) },
                )
            }

            composable(Routes.SIGN_IN) {
                AuthScreen(
                    onSignedIn = {
                        navController.navigate(Routes.FEED) {
                            popUpTo(Routes.FEED) { inclusive = true }
                        }
                    },
                    onSkip = { navController.popBackStack() },
                )
            }
        }
    }

    commentsFor?.let { video ->
        CommentsSheet(
            video = video,
            onDismiss = { commentsFor = null },
            onRequireSignIn = { navController.navigate(Routes.SIGN_IN) },
        )
    }
}

/** Hands the video to the Android share sheet. */
private fun shareVideo(context: android.content.Context, video: Video) {
    val url = "https://ljbmk.social/#/watch/${video.id}"
    val intent = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_SUBJECT, video.title)
        putExtra(Intent.EXTRA_TEXT, "${video.title}\n$url")
    }
    context.startActivity(Intent.createChooser(intent, "Share via"))
}

/**
 * The bottom bar. Create sits in the middle carrying the brand gradient, so the
 * primary action on the whole app is the visual centre.
 */
@Composable
private fun LjbmkBottomBar(
    currentRoute: String?,
    unreadCount: Int,
    onNavigate: (String) -> Unit,
) {
    NavigationBar(
        containerColor = Surface,
        contentColor = OnBackground,
        modifier = Modifier.height(64.dp + WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()),
    ) {
        NavItem(Routes.FEED, currentRoute, Icons.Outlined.Home, Icons.Filled.Home, "Home", onNavigate)
        NavItem(Routes.EXPLORE, currentRoute, Icons.Outlined.Search, Icons.Outlined.Search, "Explore", onNavigate)

        // Create — the gradient button.
        NavigationBarItem(
            selected = currentRoute == Routes.UPLOAD,
            onClick = { onNavigate(Routes.UPLOAD) },
            icon = {
                Box(
                    Modifier
                        .size(width = 42.dp, height = 28.dp)
                        .clip(androidx.compose.foundation.shape.RoundedCornerShape(9.dp))
                        .background(BrandGradient),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Outlined.Add, contentDescription = "Create", tint = Color.White)
                }
            },
            colors = NavigationBarItemDefaults.colors(indicatorColor = Color.Transparent),
        )

        NavigationBarItem(
            selected = currentRoute == Routes.NOTIFICATIONS,
            onClick = { onNavigate(Routes.NOTIFICATIONS) },
            icon = {
                BadgedBox(badge = {
                    if (unreadCount > 0) {
                        Badge(containerColor = BrandMagenta, contentColor = Color.White) {
                            Text(if (unreadCount > 99) "99+" else "$unreadCount")
                        }
                    }
                }) {
                    Icon(Icons.Outlined.FavoriteBorder, contentDescription = "Inbox")
                }
            },
            label = { Text("Inbox") },
            colors = navColors(),
        )

        NavItem(Routes.LIBRARY, currentRoute, Icons.Outlined.Menu, Icons.Outlined.Menu, "You", onNavigate)
    }
}

@Composable
private fun RowScope.NavItem(
    route: String,
    currentRoute: String?,
    icon: ImageVector,
    selectedIcon: ImageVector,
    label: String,
    onNavigate: (String) -> Unit,
) {
    val selected = currentRoute == route
    NavigationBarItem(
        selected = selected,
        onClick = { onNavigate(route) },
        icon = { Icon(if (selected) selectedIcon else icon, contentDescription = label) },
        label = { Text(label) },
        colors = navColors(),
    )
}

@Composable
private fun navColors() = NavigationBarItemDefaults.colors(
    selectedIconColor = OnBackground,
    selectedTextColor = OnBackground,
    unselectedIconColor = TextFaint,
    unselectedTextColor = TextFaint,
    indicatorColor = SurfaceHigh,
)
