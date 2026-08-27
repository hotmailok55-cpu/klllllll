package com.ljbmk.social.ui.theme

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.view.WindowCompat

/**
 * LJBMK Social theme.
 *
 * The palette is taken from the logo: the play mark runs blue -> purple ->
 * magenta, and that gradient is the app's accent.
 */

// --- Brand ---------------------------------------------------------------
val BrandBlue = Color(0xFF1E6BFF)
val BrandPurple = Color(0xFF8B2BFF)
val BrandMagenta = Color(0xFFC026F0)

/** The logo gradient, for buttons and accents that should feel like the mark. */
val BrandGradient = Brush.linearGradient(listOf(BrandBlue, BrandPurple, BrandMagenta))

// --- Surfaces -------------------------------------------------------------
val Background = Color(0xFF0A0A0C)
val Surface = Color(0xFF16161B)
val SurfaceHigh = Color(0xFF22222A)
val OnBackground = Color(0xFFF5F5F7)
val TextMuted = Color(0xFFA1A1AA)
val TextFaint = Color(0xFF6B6B76)
val Divider = Color(0x1AFFFFFF)

val Success = Color(0xFF22C55E)
val Warning = Color(0xFFF59E0B)
val Danger = Color(0xFFEF4444)

/**
 * The app commits to a dark scheme in both system modes.
 *
 * This is a deliberate product decision, not an oversight: the main surface is
 * full-bleed video, and a light chrome around it washes the video out and makes
 * the white overlay text unreadable.
 */
private val LjbmkColors = darkColorScheme(
    primary = BrandPurple,
    onPrimary = Color.White,
    primaryContainer = BrandBlue,
    onPrimaryContainer = Color.White,
    secondary = BrandMagenta,
    onSecondary = Color.White,
    background = Background,
    onBackground = OnBackground,
    surface = Surface,
    onSurface = OnBackground,
    surfaceVariant = SurfaceHigh,
    onSurfaceVariant = TextMuted,
    error = Danger,
    onError = Color.White,
    outline = Divider,
)

private val LjbmkTypography = Typography(
    headlineMedium = TextStyle(fontSize = 24.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.5).sp),
    titleLarge = TextStyle(fontSize = 19.sp, fontWeight = FontWeight.Bold),
    titleMedium = TextStyle(fontSize = 16.sp, fontWeight = FontWeight.SemiBold),
    bodyLarge = TextStyle(fontSize = 15.sp, lineHeight = 21.sp),
    bodyMedium = TextStyle(fontSize = 14.sp, lineHeight = 20.sp),
    bodySmall = TextStyle(fontSize = 12.5.sp, lineHeight = 17.sp),
    labelLarge = TextStyle(fontSize = 14.sp, fontWeight = FontWeight.SemiBold),
    labelSmall = TextStyle(fontSize = 11.sp, fontWeight = FontWeight.SemiBold),
)

@Composable
fun LjbmkTheme(
    // Accepted so the signature is familiar, but the app is dark either way.
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            // Draw behind the system bars so video reaches the screen edges.
            WindowCompat.setDecorFitsSystemWindows(window, false)
            WindowCompat.getInsetsController(window, view).apply {
                isAppearanceLightStatusBars = false
                isAppearanceLightNavigationBars = false
            }
        }
    }

    MaterialTheme(
        colorScheme = LjbmkColors,
        typography = LjbmkTypography,
        content = content,
    )
}
