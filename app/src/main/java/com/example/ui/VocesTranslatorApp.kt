package com.example.ui

import androidx.compose.animation.Crossfade
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.example.ui.components.CameraTranslateView
import com.example.ui.components.ConversationView
import com.example.ui.components.DialectGuideView
import com.example.ui.components.FullscreenTranslationView
import com.example.ui.components.GoogleTranslateBottomBar
import com.example.ui.components.GoogleTranslateMainCanvas
import com.example.ui.components.LanguagePickerDialog
import com.example.ui.components.SavedTranslationsView
import com.example.ui.components.VoiceRecorderDialog
import com.example.ui.components.VoiceStudioView
import com.example.ui.viewmodel.AppMode
import com.example.ui.viewmodel.LanguageSelectionTarget
import com.example.ui.viewmodel.TranslatorViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VocesTranslatorApp(
    viewModel: TranslatorViewModel = viewModel()
) {
    val currentMode by viewModel.currentMode.collectAsState()
    val sourceLanguage by viewModel.sourceLanguage.collectAsState()
    val targetLanguage by viewModel.targetLanguage.collectAsState()
    val inputText by viewModel.inputText.collectAsState()
    val translationResult by viewModel.translationResult.collectAsState()

    val showLanguagePicker by viewModel.showLanguagePicker.collectAsState()
    val pickerTarget by viewModel.pickerTarget.collectAsState()
    val showVoiceRecordDialog by viewModel.showVoiceRecordDialog.collectAsState()
    val showFullscreenTranslation by viewModel.showFullscreenTranslation.collectAsState()
    val voiceRecordingPhrase by viewModel.voiceRecordingPhrase.collectAsState()

    Scaffold(
        topBar = {
            if (currentMode == AppMode.TRANSLATE) {
                // Top Bar matching Google Translate
                TopAppBar(
                    navigationIcon = {
                        IconButton(
                            onClick = { viewModel.setMode(AppMode.SAVED) },
                            modifier = Modifier.testTag("top_saved_star_btn")
                        ) {
                            Icon(
                                imageVector = Icons.Default.Star,
                                contentDescription = "Saved translations",
                                tint = Color(0xFFC0C9C9),
                                modifier = Modifier.size(24.dp)
                            )
                        }
                    },
                    title = {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            // "Google Translate" Title
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.Center
                            ) {
                                Text(
                                    text = "Google ",
                                    style = MaterialTheme.typography.titleLarge,
                                    fontWeight = FontWeight.SemiBold,
                                    color = Color.White
                                )
                                Text(
                                    text = "Translate",
                                    style = MaterialTheme.typography.titleLarge,
                                    fontWeight = FontWeight.Normal,
                                    color = Color(0xFFE1E3E3)
                                )
                            }

                            Spacer(modifier = Modifier.height(2.dp))

                            // "Advanced" Pill
                            Surface(
                                shape = RoundedCornerShape(16.dp),
                                color = Color(0xFF1E2828),
                                modifier = Modifier
                                    .clickable {
                                        viewModel.setMode(AppMode.DIALECT_GUIDE)
                                    }
                                    .testTag("top_advanced_pill")
                            ) {
                                Text(
                                    text = "Advanced",
                                    color = Color(0xFFC0C9C9),
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Medium,
                                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 3.dp)
                                )
                            }
                        }
                    },
                    actions = {
                        // User Profile avatar (L in green circle)
                        Box(
                            modifier = Modifier
                                .padding(end = 12.dp)
                                .size(36.dp)
                                .clip(CircleShape)
                                .background(Color(0xFF7CB342))
                                .clickable {
                                    viewModel.setMode(AppMode.VOICE_STUDIO)
                                }
                                .testTag("top_user_avatar"),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = "L",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Bold,
                                color = Color.White
                            )
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(
                        containerColor = Color(0xFF0F1414)
                    )
                )
            }
        },
        bottomBar = {
            if (currentMode == AppMode.TRANSLATE) {
                // Bottom Bar matching the user's screenshot
                GoogleTranslateBottomBar(
                    sourceLanguage = sourceLanguage,
                    targetLanguage = targetLanguage,
                    onSourceClick = {
                        viewModel.openLanguagePicker(LanguageSelectionTarget.SOURCE)
                    },
                    onTargetClick = {
                        viewModel.openLanguagePicker(LanguageSelectionTarget.TARGET)
                    },
                    onSwapClick = {
                        viewModel.swapLanguages()
                    },
                    onLiveTranslateClick = {
                        viewModel.setMode(AppMode.CONVERSATION)
                    },
                    onCameraClick = {
                        viewModel.setMode(AppMode.CAMERA)
                    },
                    onPracticeClick = {
                        viewModel.setMode(AppMode.VOICE_STUDIO)
                    }
                )
            }
        },
        containerColor = Color(0xFF0F1414)
    ) { innerPadding ->
        Crossfade(
            targetState = currentMode,
            label = "mode_crossfade",
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
        ) { mode ->
            when (mode) {
                AppMode.TRANSLATE -> {
                    GoogleTranslateMainCanvas(
                        inputText = inputText,
                        onTextChange = { viewModel.setInputText(it) },
                        onClearClick = { viewModel.clearInput() },
                        sourceLanguage = sourceLanguage,
                        targetLanguage = targetLanguage,
                        translationResult = translationResult,
                        onSpeakSource = {
                            viewModel.speakText(inputText, sourceLanguage.code)
                        },
                        onSpeakResult = { speed ->
                            translationResult?.let { res ->
                                viewModel.speakText(res.translatedText, res.targetLanguage.code, speed = speed)
                            }
                        },
                        onCopyResult = {
                            translationResult?.let { res ->
                                viewModel.copyToClipboard(res.translatedText, "Translated Text")
                            }
                        },
                        onFavoriteToggle = {
                            viewModel.toggleFavoriteCurrentResult()
                        },
                        onMicClick = {
                            if (inputText.isBlank()) {
                                viewModel.setInputText("How are you doing, friend?")
                            } else {
                                viewModel.speakText(inputText, sourceLanguage.code)
                            }
                        },
                        modifier = Modifier.fillMaxSize()
                    )
                }

                AppMode.CONVERSATION -> {
                    ConversationView(viewModel = viewModel)
                }

                AppMode.CAMERA -> {
                    CameraTranslateView(
                        sourceLanguage = sourceLanguage,
                        targetLanguage = targetLanguage,
                        onClose = {
                            viewModel.setMode(AppMode.TRANSLATE)
                        },
                        onTextExtracted = { text ->
                            viewModel.setInputText(text)
                            viewModel.setMode(AppMode.TRANSLATE)
                        },
                        onSpeak = { text, langCode ->
                            viewModel.speakText(text, langCode)
                        }
                    )
                }

                AppMode.VOICE_STUDIO -> {
                    VoiceStudioView(viewModel = viewModel)
                }

                AppMode.SAVED -> {
                    SavedTranslationsView(viewModel = viewModel)
                }

                AppMode.DIALECT_GUIDE -> {
                    DialectGuideView(viewModel = viewModel)
                }
            }
        }
    }

    // Language Picker Bottom Sheet
    if (showLanguagePicker) {
        LanguagePickerDialog(
            title = if (pickerTarget == LanguageSelectionTarget.SOURCE) "Translate from" else "Translate into",
            selectedLanguage = if (pickerTarget == LanguageSelectionTarget.SOURCE) sourceLanguage else targetLanguage,
            onLanguageSelected = { selected ->
                if (pickerTarget == LanguageSelectionTarget.SOURCE) {
                    viewModel.selectSourceLanguage(selected)
                } else {
                    viewModel.selectTargetLanguage(selected)
                }
            },
            onDismiss = { viewModel.closeLanguagePicker() }
        )
    }

    // Voice Recorder Modal Dialog
    if (showVoiceRecordDialog) {
        VoiceRecorderDialog(
            phrase = voiceRecordingPhrase,
            targetLanguage = targetLanguage,
            viewModel = viewModel,
            onDismiss = { viewModel.closeVoiceRecorder() }
        )
    }

    // Fullscreen view
    if (showFullscreenTranslation && translationResult != null) {
        FullscreenTranslationView(
            result = translationResult!!,
            onSpeak = {
                translationResult?.let { res ->
                    viewModel.speakText(res.translatedText, res.targetLanguage.code)
                }
            },
            onDismiss = { viewModel.toggleFullscreen(false) }
        )
    }
}
