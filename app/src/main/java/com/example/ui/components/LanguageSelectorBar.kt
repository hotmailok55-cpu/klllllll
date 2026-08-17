package com.example.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.RecordVoiceOver
import androidx.compose.material.icons.filled.School
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.data.model.Language

@Composable
fun GoogleTranslateBottomBar(
    sourceLanguage: Language,
    targetLanguage: Language,
    onSourceClick: () -> Unit,
    onTargetClick: () -> Unit,
    onSwapClick: () -> Unit,
    onLiveTranslateClick: () -> Unit,
    onCameraClick: () -> Unit,
    onPracticeClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    var rotationState by remember { mutableFloatStateOf(0f) }
    val animatedRotation by animateFloatAsState(
        targetValue = rotationState,
        animationSpec = spring(),
        label = "swap_rotation"
    )

    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(Color(0xFF0F1414))
            .padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        // Drag handle line
        Box(
            modifier = Modifier
                .width(42.dp)
                .height(4.dp)
                .clip(RoundedCornerShape(2.dp))
                .background(Color(0xFF3F4848))
        )

        Spacer(modifier = Modifier.height(14.dp))

        // Language Selector Row (Exact Google Translate dark rounded pills)
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            // Source Language Pill
            Surface(
                modifier = Modifier
                    .weight(1f)
                    .height(56.dp)
                    .clip(RoundedCornerShape(16.dp))
                    .clickable { onSourceClick() }
                    .testTag("source_language_pill"),
                shape = RoundedCornerShape(16.dp),
                color = Color(0xFF1B2222)
            ) {
                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier.padding(horizontal = 12.dp)
                ) {
                    Text(
                        text = sourceLanguage.name,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = Color(0xFFE1E3E3),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }

            // Swap Button
            IconButton(
                onClick = {
                    rotationState += 180f
                    onSwapClick()
                },
                modifier = Modifier
                    .padding(horizontal = 8.dp)
                    .size(44.dp)
                    .testTag("swap_languages_button")
            ) {
                Icon(
                    imageVector = Icons.Default.SwapHoriz,
                    contentDescription = "Swap Languages",
                    tint = Color(0xFFE1E3E3),
                    modifier = Modifier
                        .size(26.dp)
                        .rotate(animatedRotation)
                )
            }

            // Target Language Pill
            Surface(
                modifier = Modifier
                    .weight(1f)
                    .height(56.dp)
                    .clip(RoundedCornerShape(16.dp))
                    .clickable { onTargetClick() }
                    .testTag("target_language_pill"),
                shape = RoundedCornerShape(16.dp),
                color = Color(0xFF1B2222)
            ) {
                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier.padding(horizontal = 12.dp)
                ) {
                    Text(
                        text = targetLanguage.name,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = Color(0xFFE1E3E3),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(20.dp))

        // 3 Action Buttons: Live translate, Camera, Practice (with Beta badge)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(bottom = 12.dp),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.Top
        ) {
            GoogleBottomActionButton(
                icon = Icons.Default.RecordVoiceOver,
                label = "Live translate",
                onClick = onLiveTranslateClick,
                testTag = "action_live_translate"
            )

            GoogleBottomActionButton(
                icon = Icons.Default.CameraAlt,
                label = "Camera",
                onClick = onCameraClick,
                testTag = "action_camera"
            )

            GoogleBottomActionButton(
                icon = Icons.Default.School,
                label = "Practice",
                badge = "Beta",
                onClick = onPracticeClick,
                testTag = "action_practice"
            )
        }
    }
}

@Composable
private fun GoogleBottomActionButton(
    icon: ImageVector,
    label: String,
    badge: String? = null,
    onClick: () -> Unit,
    testTag: String
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier
            .clickable { onClick() }
            .testTag(testTag)
            .padding(horizontal = 12.dp)
    ) {
        Box(contentAlignment = Alignment.TopEnd) {
            Box(
                modifier = Modifier
                    .size(56.dp)
                    .clip(CircleShape)
                    .background(Color(0xFF222B2B)),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = label,
                    tint = Color(0xFFC0C9C9),
                    modifier = Modifier.size(24.dp)
                )
            }

            if (badge != null) {
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = Color(0xFF7C71FA),
                    modifier = Modifier.offset(x = 6.dp, y = (-2).dp)
                ) {
                    Text(
                        text = badge,
                        color = Color.White,
                        fontSize = 9.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(horizontal = 5.dp, vertical = 2.dp)
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(8.dp))

        Text(
            text = label,
            fontSize = 12.sp,
            fontWeight = FontWeight.Medium,
            color = Color(0xFFC0C9C9),
            textAlign = TextAlign.Center
        )
    }
}
