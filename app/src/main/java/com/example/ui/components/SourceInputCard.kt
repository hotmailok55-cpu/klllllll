package com.example.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.ContentPaste
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.data.model.Language
import com.example.data.model.TranslationResult

@Composable
fun GoogleTranslateMainCanvas(
    inputText: String,
    onTextChange: (String) -> Unit,
    onClearClick: () -> Unit,
    sourceLanguage: Language,
    targetLanguage: Language,
    translationResult: TranslationResult?,
    onSpeakSource: () -> Unit,
    onSpeakResult: (speed: Float) -> Unit,
    onCopyResult: () -> Unit,
    onFavoriteToggle: () -> Unit,
    onMicClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val clipboardManager = LocalClipboardManager.current
    var isFavorite by remember { mutableStateOf(false) }

    val samplePhrases = listOf(
        "What's up, bro?",
        "That's awesome!",
        "No way! Are you serious?",
        "Let's hang out tonight",
        "Take it easy / Relax",
        "This food is delicious!"
    )

    Surface(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(bottomStart = 32.dp, bottomEnd = 32.dp)),
        color = Color(0xFF131717),
        shape = RoundedCornerShape(bottomStart = 32.dp, bottomEnd = 32.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 20.dp, vertical = 12.dp)
        ) {
            // Main Input Area & Result
            Column(
                modifier = Modifier
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
            ) {
                // Source Input Box
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 8.dp)
                ) {
                    if (inputText.isEmpty()) {
                        Text(
                            text = "Translate text",
                            style = TextStyle(
                                fontSize = 28.sp,
                                fontWeight = FontWeight.Normal,
                                color = Color(0xFF8A9393)
                            ),
                            modifier = Modifier.padding(top = 2.dp)
                        )
                    }

                    BasicTextField(
                        value = inputText,
                        onValueChange = onTextChange,
                        textStyle = TextStyle(
                            fontSize = if (inputText.length > 60) 20.sp else 26.sp,
                            fontWeight = FontWeight.Normal,
                            color = Color(0xFFE1E3E3),
                            lineHeight = 32.sp
                        ),
                        cursorBrush = SolidColor(Color(0xFF00E5BF)),
                        modifier = Modifier
                            .fillMaxWidth()
                            .testTag("source_text_input")
                    )
                }

                // If input has text, show source action icons (TTS & Clear)
                if (inputText.isNotBlank()) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 8.dp),
                        horizontalArrangement = Arrangement.End,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        IconButton(
                            onClick = onSpeakSource,
                            modifier = Modifier
                                .size(36.dp)
                                .testTag("speak_source_btn")
                        ) {
                            Icon(
                                imageVector = Icons.Default.VolumeUp,
                                contentDescription = "Listen source",
                                tint = Color(0xFF8A9393),
                                modifier = Modifier.size(22.dp)
                            )
                        }

                        IconButton(
                            onClick = onClearClick,
                            modifier = Modifier
                                .size(36.dp)
                                .testTag("clear_input_button")
                        ) {
                            Icon(
                                imageVector = Icons.Default.Clear,
                                contentDescription = "Clear input",
                                tint = Color(0xFF8A9393),
                                modifier = Modifier.size(22.dp)
                            )
                        }
                    }

                    // Divider and Translation Result
                    if (translationResult != null) {
                        Spacer(modifier = Modifier.height(12.dp))
                        HorizontalDivider(
                            color = Color(0xFF222B2B),
                            thickness = 1.dp
                        )
                        Spacer(modifier = Modifier.height(16.dp))

                        // Target Translated Text
                        Text(
                            text = translationResult.translatedText,
                            style = TextStyle(
                                fontSize = if (translationResult.translatedText.length > 60) 22.sp else 28.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = Color(0xFF55DBCB),
                                lineHeight = 34.sp
                            ),
                            modifier = Modifier
                                .fillMaxWidth()
                                .testTag("translated_result_text")
                        )

                        Spacer(modifier = Modifier.height(6.dp))

                        // Phonetic transcription / Pronunciation tip
                        Text(
                            text = translationResult.phoneticSpelling,
                            style = TextStyle(
                                fontSize = 14.sp,
                                fontWeight = FontWeight.Normal,
                                color = Color(0xFF8A9393),
                                letterSpacing = 0.5.sp
                            )
                        )

                        Spacer(modifier = Modifier.height(12.dp))

                        // Result Action Icons (Speak, Slow Speak, Copy, Star)
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.Start,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            // Normal Speech
                            IconButton(
                                onClick = { onSpeakResult(1.0f) },
                                modifier = Modifier
                                    .size(40.dp)
                                    .testTag("speak_result_btn")
                            ) {
                                Icon(
                                    imageVector = Icons.Default.VolumeUp,
                                    contentDescription = "Speak translation",
                                    tint = Color(0xFFE1E3E3),
                                    modifier = Modifier.size(22.dp)
                                )
                            }

                            // Slow Speech (0.7x)
                            Surface(
                                shape = RoundedCornerShape(12.dp),
                                color = Color(0xFF1E2828),
                                modifier = Modifier
                                    .clickable { onSpeakResult(0.7f) }
                                    .padding(horizontal = 4.dp)
                            ) {
                                Text(
                                    text = "0.7x",
                                    color = Color(0xFFC0C9C9),
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold,
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                                )
                            }

                            Spacer(modifier = Modifier.width(8.dp))

                            // Copy
                            IconButton(
                                onClick = onCopyResult,
                                modifier = Modifier
                                    .size(40.dp)
                                    .testTag("copy_result_btn")
                            ) {
                                Icon(
                                    imageVector = Icons.Default.ContentCopy,
                                    contentDescription = "Copy",
                                    tint = Color(0xFF8A9393),
                                    modifier = Modifier.size(20.dp)
                                )
                            }

                            // Favorite
                            IconButton(
                                onClick = {
                                    isFavorite = !isFavorite
                                    onFavoriteToggle()
                                },
                                modifier = Modifier
                                    .size(40.dp)
                                    .testTag("favorite_result_btn")
                            ) {
                                Icon(
                                    imageVector = if (isFavorite) Icons.Default.Star else Icons.Default.StarBorder,
                                    contentDescription = "Star favorite",
                                    tint = if (isFavorite) Color(0xFFF9AB00) else Color(0xFF8A9393),
                                    modifier = Modifier.size(22.dp)
                                )
                            }
                        }
                    }
                } else {
                    // Quick sample chips when empty
                    Spacer(modifier = Modifier.height(16.dp))
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        samplePhrases.forEach { sample ->
                            AssistChip(
                                onClick = { onTextChange(sample) },
                                label = { Text(sample, fontSize = 12.sp, color = Color(0xFFC0C9C9)) },
                                colors = AssistChipDefaults.assistChipColors(
                                    containerColor = Color(0xFF1C2222)
                                ),
                                shape = RoundedCornerShape(12.dp)
                            )
                        }
                    }
                }
            }

            // Bottom controls inside the upper card (Paste, Pen, Big Cyan Mic FAB)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 8.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Paste Button (Left)
                Surface(
                    shape = RoundedCornerShape(18.dp),
                    color = Color.Transparent,
                    modifier = Modifier
                        .clickable {
                            val clip = clipboardManager.getText()?.text
                            if (!clip.isNullOrBlank()) {
                                onTextChange(clip)
                            }
                        }
                        .testTag("paste_button")
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            imageVector = Icons.Default.ContentPaste,
                            contentDescription = "Paste",
                            tint = Color(0xFFC0C9C9),
                            modifier = Modifier.size(20.dp)
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            text = "Paste",
                            style = MaterialTheme.typography.labelLarge,
                            fontWeight = FontWeight.Medium,
                            color = Color(0xFFC0C9C9)
                        )
                    }
                }

                // Right controls: Edit/Draw pen + Big Teal Mic FAB
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    IconButton(
                        onClick = {
                            if (inputText.isEmpty()) {
                                onTextChange("¡Qué lo qué!")
                            }
                        },
                        modifier = Modifier
                            .size(40.dp)
                            .testTag("pen_handwriting_button")
                    ) {
                        Icon(
                            imageVector = Icons.Default.Edit,
                            contentDescription = "Handwriting / Edit",
                            tint = Color(0xFFC0C9C9),
                            modifier = Modifier.size(22.dp)
                        )
                    }

                    // Bright Cyan/Teal Mic FAB (Exact Google Translate circle)
                    Box(
                        modifier = Modifier
                            .size(56.dp)
                            .clip(CircleShape)
                            .background(Color(0xFF00E5BF))
                            .clickable { onMicClick() }
                            .testTag("mic_fab_button"),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.Mic,
                            contentDescription = "Voice Input",
                            tint = Color(0xFF003732),
                            modifier = Modifier.size(28.dp)
                        )
                    }
                }
            }
        }
    }
}
