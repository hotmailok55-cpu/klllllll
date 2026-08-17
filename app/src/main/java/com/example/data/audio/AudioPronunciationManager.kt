package com.example.data.audio

import android.content.Context
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.Locale

class AudioPronunciationManager(private val context: Context) : TextToSpeech.OnInitListener {

    private var tts: TextToSpeech? = null
    private var isInitialized = false

    private val _isPlaying = MutableStateFlow(false)
    val isPlaying: StateFlow<Boolean> = _isPlaying.asStateFlow()

    private val _currentUtteranceId = MutableStateFlow<String?>(null)
    val currentUtteranceId: StateFlow<String?> = _currentUtteranceId.asStateFlow()

    init {
        try {
            tts = TextToSpeech(context.applicationContext, this)
        } catch (e: Exception) {
            Log.e("AudioPronunciation", "TTS init error: ${e.message}")
        }
    }

    override fun onInit(status: Int) {
        if (status == TextToSpeech.SUCCESS) {
            isInitialized = true
            tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) {
                    _isPlaying.value = true
                    _currentUtteranceId.value = utteranceId
                }

                override fun onDone(utteranceId: String?) {
                    _isPlaying.value = false
                    _currentUtteranceId.value = null
                }

                @Deprecated("Deprecated in Java")
                override fun onError(utteranceId: String?) {
                    _isPlaying.value = false
                    _currentUtteranceId.value = null
                }

                override fun onError(utteranceId: String?, errorCode: Int) {
                    _isPlaying.value = false
                    _currentUtteranceId.value = null
                }
            })
        }
    }

    fun speak(
        text: String,
        localeCode: String = "es",
        speed: Float = 1.0f,
        pitch: Float = 1.0f,
        utteranceId: String = "vocab_${System.currentTimeMillis()}"
    ) {
        if (!isInitialized || tts == null || text.isBlank()) return

        val locale = when (localeCode.lowercase(Locale.ROOT)) {
            "en" -> Locale.US
            "fr", "ht" -> Locale.FRENCH
            "es-mx" -> Locale("es", "MX")
            "es-do", "es-pr", "es-cu", "es-co-carib", "es-ve", "es-cl", "es-hn", "es-pa" -> Locale("es", "US")
            "pap" -> Locale("es", "US")
            "qu", "nah", "gn", "yua", "gar" -> Locale("es", "US")
            else -> Locale("es", "US")
        }

        try {
            tts?.language = locale
            tts?.setSpeechRate(speed)
            tts?.setPitch(pitch)

            val params = Bundle()
            params.putString(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, utteranceId)
            tts?.speak(text, TextToSpeech.QUEUE_FLUSH, params, utteranceId)
        } catch (e: Exception) {
            Log.e("AudioPronunciation", "Error speaking: ${e.message}")
            _isPlaying.value = false
        }
    }

    fun stop() {
        try {
            tts?.stop()
            _isPlaying.value = false
            _currentUtteranceId.value = null
        } catch (e: Exception) {
            Log.e("AudioPronunciation", "Error stopping: ${e.message}")
        }
    }

    fun shutdown() {
        try {
            tts?.stop()
            tts?.shutdown()
            tts = null
        } catch (e: Exception) {
            Log.e("AudioPronunciation", "Error shutting down: ${e.message}")
        }
    }
}
