package com.example.ui.viewmodel

import android.app.Application
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.example.data.audio.AudioPronunciationManager
import com.example.data.audio.VoiceRecorderManager
import com.example.data.db.AppDatabase
import com.example.data.db.SavedTranslationEntity
import com.example.data.db.VoiceRecordingEntity
import com.example.data.engine.DialectEngine
import com.example.data.model.Language
import com.example.data.model.SupportedLanguages
import com.example.data.model.TranslationResult
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.util.UUID

enum class AppMode {
    TRANSLATE,
    CONVERSATION,
    CAMERA,
    VOICE_STUDIO,
    SAVED,
    DIALECT_GUIDE
}

enum class LanguageSelectionTarget {
    SOURCE,
    TARGET
}

class TranslatorViewModel(application: Application) : AndroidViewModel(application) {

    private val db = AppDatabase.getInstance(application)
    private val dao = db.translationDao()

    val audioManager = AudioPronunciationManager(application)
    val voiceRecorder = VoiceRecorderManager(application)

    // Current Navigation / Mode
    private val _currentMode = MutableStateFlow(AppMode.TRANSLATE)
    val currentMode: StateFlow<AppMode> = _currentMode.asStateFlow()

    // Active languages
    private val _sourceLanguage = MutableStateFlow(SupportedLanguages.getByCode("en"))
    val sourceLanguage: StateFlow<Language> = _sourceLanguage.asStateFlow()

    private val _targetLanguage = MutableStateFlow(SupportedLanguages.getByCode("es-DO"))
    val targetLanguage: StateFlow<Language> = _targetLanguage.asStateFlow()

    // Input & Translation state
    private val _inputText = MutableStateFlow("")
    val inputText: StateFlow<String> = _inputText.asStateFlow()

    private val _translationResult = MutableStateFlow<TranslationResult?>(null)
    val translationResult: StateFlow<TranslationResult?> = _translationResult.asStateFlow()

    private val _isTranslating = MutableStateFlow(false)
    val isTranslating: StateFlow<Boolean> = _isTranslating.asStateFlow()

    // UI Dialog & Sheet states
    private val _showLanguagePicker = MutableStateFlow(false)
    val showLanguagePicker: StateFlow<Boolean> = _showLanguagePicker.asStateFlow()

    private val _pickerTarget = MutableStateFlow(LanguageSelectionTarget.TARGET)
    val pickerTarget: StateFlow<LanguageSelectionTarget> = _pickerTarget.asStateFlow()

    private val _showFullscreenTranslation = MutableStateFlow(false)
    val showFullscreenTranslation: StateFlow<Boolean> = _showFullscreenTranslation.asStateFlow()

    private val _showVoiceRecordDialog = MutableStateFlow(false)
    val showVoiceRecordDialog: StateFlow<Boolean> = _showVoiceRecordDialog.asStateFlow()

    private val _voiceRecordingPhrase = MutableStateFlow("")
    val voiceRecordingPhrase: StateFlow<String> = _voiceRecordingPhrase.asStateFlow()

    private val _voiceRecordingNotes = MutableStateFlow("")
    val voiceRecordingNotes: StateFlow<String> = _voiceRecordingNotes.asStateFlow()

    // Saved Translations and Voice Recordings Flows from DB
    val historyItems: StateFlow<List<SavedTranslationEntity>> = dao.getAllHistory()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val favoriteItems: StateFlow<List<SavedTranslationEntity>> = dao.getFavorites()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val voiceRecordings: StateFlow<List<VoiceRecordingEntity>> = dao.getAllVoiceRecordings()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    // Conversation Mode states
    private val _conversationMessages = MutableStateFlow<List<ConversationMessage>>(emptyList())
    val conversationMessages: StateFlow<List<ConversationMessage>> = _conversationMessages.asStateFlow()

    init {
        // Pre-populate with iconic starter translation
        setInputText("What's up, bro?")
        performTranslation("What's up, bro?")
    }

    fun setMode(mode: AppMode) {
        _currentMode.value = mode
    }

    fun setInputText(text: String) {
        _inputText.value = text
        if (text.isBlank()) {
            _translationResult.value = null
        } else {
            performTranslation(text)
        }
    }

    fun clearInput() {
        _inputText.value = ""
        _translationResult.value = null
    }

    fun swapLanguages() {
        val prevSource = _sourceLanguage.value
        val prevTarget = _targetLanguage.value

        _sourceLanguage.value = prevTarget
        _targetLanguage.value = prevSource

        val currentResult = _translationResult.value
        if (currentResult != null && currentResult.translatedText.isNotBlank()) {
            _inputText.value = currentResult.translatedText
            performTranslation(currentResult.translatedText)
        } else if (_inputText.value.isNotBlank()) {
            performTranslation(_inputText.value)
        }
    }

    fun openLanguagePicker(target: LanguageSelectionTarget) {
        _pickerTarget.value = target
        _showLanguagePicker.value = true
    }

    fun closeLanguagePicker() {
        _showLanguagePicker.value = false
    }

    fun selectLanguage(language: Language) {
        if (_pickerTarget.value == LanguageSelectionTarget.SOURCE) {
            _sourceLanguage.value = language
        } else {
            _targetLanguage.value = language
        }
        _showLanguagePicker.value = false
        if (_inputText.value.isNotBlank()) {
            performTranslation(_inputText.value)
        }
    }

    fun selectSourceLanguage(language: Language) {
        _sourceLanguage.value = language
        _showLanguagePicker.value = false
        if (_inputText.value.isNotBlank()) {
            performTranslation(_inputText.value)
        }
    }

    fun selectTargetLanguage(language: Language) {
        _targetLanguage.value = language
        _showLanguagePicker.value = false
        if (_inputText.value.isNotBlank()) {
            performTranslation(_inputText.value)
        }
    }

    fun performTranslation(text: String) {
        if (text.isBlank()) return
        _isTranslating.value = true
        val result = DialectEngine.translate(text, _sourceLanguage.value, _targetLanguage.value)
        _translationResult.value = result
        _isTranslating.value = false

        // Automatically save to local history
        viewModelScope.launch {
            try {
                dao.insertTranslation(
                    SavedTranslationEntity(
                        sourceText = result.sourceText,
                        translatedText = result.translatedText,
                        sourceCode = result.sourceLanguage.code,
                        targetCode = result.targetLanguage.code,
                        sourceName = result.sourceLanguage.name,
                        targetName = result.targetLanguage.name,
                        targetFlag = result.targetLanguage.flag,
                        phonetic = result.phoneticSpelling,
                        culturalMeaning = result.culturalMeaning,
                        isFavorite = false
                    )
                )
            } catch (_: Exception) {}
        }
    }

    fun toggleFavorite(item: SavedTranslationEntity) {
        viewModelScope.launch {
            dao.updateTranslation(item.copy(isFavorite = !item.isFavorite))
        }
    }

    fun toggleFavoriteCurrentResult() {
        val res = _translationResult.value ?: return
        viewModelScope.launch {
            dao.insertTranslation(
                SavedTranslationEntity(
                    sourceText = res.sourceText,
                    translatedText = res.translatedText,
                    sourceCode = res.sourceLanguage.code,
                    targetCode = res.targetLanguage.code,
                    sourceName = res.sourceLanguage.name,
                    targetName = res.targetLanguage.name,
                    targetFlag = res.targetLanguage.flag,
                    phonetic = res.phoneticSpelling,
                    culturalMeaning = res.culturalMeaning,
                    isFavorite = true
                )
            )
            Toast.makeText(getApplication(), "Saved to favorites! ⭐", Toast.LENGTH_SHORT).show()
        }
    }

    fun deleteHistoryItem(item: SavedTranslationEntity) {
        viewModelScope.launch {
            dao.deleteTranslation(item)
        }
    }

    fun clearAllHistory() {
        viewModelScope.launch {
            dao.clearAllHistory()
            Toast.makeText(getApplication(), "History cleared", Toast.LENGTH_SHORT).show()
        }
    }

    fun speakText(text: String, languageCode: String, speed: Float = 1.0f) {
        audioManager.speak(
            text = text,
            localeCode = languageCode,
            speed = speed
        )
    }

    fun stopAudio() {
        audioManager.stop()
        voiceRecorder.stopPlayback()
    }

    fun copyToClipboard(text: String, label: String = "Translation") {
        val clipboard = getApplication<Application>().getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val clip = ClipData.newPlainText(label, text)
        clipboard.setPrimaryClip(clip)
        Toast.makeText(getApplication(), "Copied to clipboard! 📋", Toast.LENGTH_SHORT).show()
    }

    fun toggleFullscreen(show: Boolean) {
        _showFullscreenTranslation.value = show
    }

    // Voice Practice & Recording Studio Actions
    fun openVoiceRecorder(phrase: String, defaultNotes: String = "") {
        _voiceRecordingPhrase.value = phrase
        _voiceRecordingNotes.value = defaultNotes
        _showVoiceRecordDialog.value = true
    }

    fun closeVoiceRecorder() {
        if (voiceRecorder.isRecording.value) {
            voiceRecorder.stopRecording()
        }
        _showVoiceRecordDialog.value = false
    }

    fun setRecordingNotes(notes: String) {
        _voiceRecordingNotes.value = notes
    }

    fun startVoiceRecording() {
        val phrase = _voiceRecordingPhrase.value.ifBlank { _translationResult.value?.translatedText ?: "phrase" }
        voiceRecorder.startRecording(phrase)
    }

    fun stopVoiceRecording() {
        val res = voiceRecorder.stopRecording()
        if (res != null) {
            val phrase = _voiceRecordingPhrase.value.ifBlank { _translationResult.value?.translatedText ?: "phrase" }
            val currentTarget = _targetLanguage.value
            viewModelScope.launch {
                dao.insertVoiceRecording(
                    VoiceRecordingEntity(
                        id = UUID.randomUUID().toString(),
                        phrase = phrase,
                        dialectCode = currentTarget.code,
                        dialectName = currentTarget.name,
                        filePath = res.filePath,
                        durationSeconds = res.durationSeconds,
                        notes = _voiceRecordingNotes.value.ifBlank { "Recorded for ${currentTarget.name}" }
                    )
                )
                Toast.makeText(getApplication(), "Voice pronunciation saved! 🎙️", Toast.LENGTH_SHORT).show()
            }
        }
    }

    fun deleteVoiceRecording(recording: VoiceRecordingEntity) {
        viewModelScope.launch {
            dao.deleteVoiceRecording(recording)
            Toast.makeText(getApplication(), "Recording deleted", Toast.LENGTH_SHORT).show()
        }
    }

    fun playUserVoice(filePath: String) {
        voiceRecorder.playRecording(filePath)
    }

    // Conversation Mode actions
    fun addConversationMessage(speaker: ConversationSpeaker, text: String) {
        if (text.isBlank()) return
        val sourceLang = if (speaker == ConversationSpeaker.SPEAKER_1) _sourceLanguage.value else _targetLanguage.value
        val targetLang = if (speaker == ConversationSpeaker.SPEAKER_1) _targetLanguage.value else _sourceLanguage.value

        val translation = DialectEngine.translate(text, sourceLang, targetLang)
        val msg = ConversationMessage(
            id = UUID.randomUUID().toString(),
            speaker = speaker,
            originalText = text,
            translatedText = translation.translatedText,
            phonetic = translation.phoneticSpelling,
            sourceLang = sourceLang,
            targetLang = targetLang
        )
        _conversationMessages.value = _conversationMessages.value + msg

        // Speak translated output automatically in conversation mode
        audioManager.speak(
            text = translation.translatedText,
            localeCode = targetLang.code
        )
    }

    fun clearConversation() {
        _conversationMessages.value = emptyList()
    }

    override fun onCleared() {
        super.onCleared()
        audioManager.shutdown()
        voiceRecorder.release()
    }
}

enum class ConversationSpeaker {
    SPEAKER_1,
    SPEAKER_2
}

data class ConversationMessage(
    val id: String,
    val speaker: ConversationSpeaker,
    val originalText: String,
    val translatedText: String,
    val phonetic: String,
    val sourceLang: Language,
    val targetLang: Language,
    val timestamp: Long = System.currentTimeMillis()
)
