package com.example.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

private val DarkColorScheme =
  darkColorScheme(
    primary = GoogleBlueDark,
    onPrimary = Color(0xFF002F6C),
    primaryContainer = GoogleBlueContainerDark,
    onPrimaryContainer = Color(0xFFD3E3FD),
    secondary = TropicalTeal,
    onSecondary = Color.White,
    secondaryContainer = Color(0xFF004F47),
    onSecondaryContainer = Color(0xFF70F6E2),
    tertiary = TropicalAmber,
    onTertiary = Color.Black,
    background = GoogleSurfaceDark,
    onBackground = TextPrimaryDark,
    surface = GoogleSurfaceDark,
    onSurface = TextPrimaryDark,
    surfaceVariant = GoogleSurfaceVariantDark,
    onSurfaceVariant = TextSecondaryDark,
    outline = OutlineDark,
  )

private val LightColorScheme =
  lightColorScheme(
    primary = GoogleBlue,
    onPrimary = Color.White,
    primaryContainer = GoogleBlueContainerLight,
    onPrimaryContainer = Color(0xFF041E49),
    secondary = TropicalTeal,
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFC3EFE8),
    onSecondaryContainer = Color(0xFF00201C),
    tertiary = TropicalCoral,
    onTertiary = Color.White,
    background = GoogleSurfaceLight,
    onBackground = TextPrimaryLight,
    surface = Color.White,
    onSurface = TextPrimaryLight,
    surfaceVariant = GoogleSurfaceVariantLight,
    onSurfaceVariant = TextSecondaryLight,
    outline = OutlineLight,
  )

@Composable
fun MyApplicationTheme(
  darkTheme: Boolean = isSystemInDarkTheme(),
  dynamicColor: Boolean = false,
  content: @Composable () -> Unit,
) {
  val colorScheme =
    when {
      dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
        val context = LocalContext.current
        if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
      }
      darkTheme -> DarkColorScheme
      else -> LightColorScheme
    }

  MaterialTheme(colorScheme = colorScheme, typography = Typography, content = content)
}

