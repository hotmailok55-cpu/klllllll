package com.example.data.audio

import android.content.Context
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.os.Build
import android.util.Log
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.File

class VoiceRecorderManager(private val context: Context) {

    private var mediaRecorder: MediaRecorder? = null
    private var mediaPlayer: MediaPlayer? = null
    private var currentRecordingFile: File? = null
    private var recordStartTime: Long = 0

    private val _isRecording = MutableStateFlow(false)
    val isRecording: StateFlow<Boolean> = _isRecording.asStateFlow()

    private val _isPlayingCustomVoice = MutableStateFlow(false)
    val isPlayingCustomVoice: StateFlow<Boolean> = _isPlayingCustomVoice.asStateFlow()

    private val _currentPlayingPath = MutableStateFlow<String?>(null)
    val currentPlayingPath: StateFlow<String?> = _currentPlayingPath.asStateFlow()

    private val recordingsDir: File by lazy {
        val dir = File(context.filesDir, "voice_recordings")
        if (!dir.exists()) {
            dir.mkdirs()
        }
        dir
    }

    fun startRecording(phraseKey: String): File? {
        try {
            stopPlayback()
            val safeName = phraseKey.replace(Regex("[^a-zA-Z0-9_]"), "_").take(30)
            val file = File(recordingsDir, "rec_${safeName}_${System.currentTimeMillis()}.m4a")
            currentRecordingFile = file

            mediaRecorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                MediaRecorder(context)
            } else {
                @Suppress("DEPRECATION")
                MediaRecorder()
            }.apply {
                setAudioSource(MediaRecorder.AudioSource.MIC)
                setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                setAudioEncodingBitRate(128000)
                setAudioSamplingRate(44100)
                setOutputFile(file.absolutePath)
                prepare()
                start()
            }

            recordStartTime = System.currentTimeMillis()
            _isRecording.value = true
            return file
        } catch (e: Exception) {
            Log.e("VoiceRecorder", "Start recording error: ${e.message}")
            _isRecording.value = false
            currentRecordingFile = null
            return null
        }
    }

    fun stopRecording(): RecordingResult? {
        if (!_isRecording.value) return null
        return try {
            mediaRecorder?.apply {
                stop()
                release()
            }
            mediaRecorder = null
            _isRecording.value = false

            val durationSec = ((System.currentTimeMillis() - recordStartTime) / 1000f).coerceAtLeast(0.5f)
            val file = currentRecordingFile
            if (file != null && file.exists() && file.length() > 0) {
                RecordingResult(
                    filePath = file.absolutePath,
                    durationSeconds = durationSec,
                    fileName = file.name
                )
            } else {
                null
            }
        } catch (e: Exception) {
            Log.e("VoiceRecorder", "Stop recording error: ${e.message}")
            mediaRecorder?.release()
            mediaRecorder = null
            _isRecording.value = false
            null
        }
    }

    fun playRecording(filePath: String, onFinished: () -> Unit = {}) {
        try {
            stopPlayback()
            val file = File(filePath)
            if (!file.exists()) return

            mediaPlayer = MediaPlayer().apply {
                setDataSource(filePath)
                prepare()
                setOnCompletionListener {
                    _isPlayingCustomVoice.value = false
                    _currentPlayingPath.value = null
                    it.release()
                    mediaPlayer = null
                    onFinished()
                }
                start()
            }
            _isPlayingCustomVoice.value = true
            _currentPlayingPath.value = filePath
        } catch (e: Exception) {
            Log.e("VoiceRecorder", "Play audio error: ${e.message}")
            _isPlayingCustomVoice.value = false
            _currentPlayingPath.value = null
        }
    }

    fun stopPlayback() {
        try {
            mediaPlayer?.let {
                if (it.isPlaying) {
                    it.stop()
                }
                it.release()
            }
            mediaPlayer = null
            _isPlayingCustomVoice.value = false
            _currentPlayingPath.value = null
        } catch (e: Exception) {
            Log.e("VoiceRecorder", "Stop playback error: ${e.message}")
        }
    }

    fun release() {
        try {
            mediaRecorder?.release()
            mediaRecorder = null
            mediaPlayer?.release()
            mediaPlayer = null
        } catch (e: Exception) {
            Log.e("VoiceRecorder", "Release error: ${e.message}")
        }
    }

    data class RecordingResult(
        val filePath: String,
        val durationSeconds: Float,
        val fileName: String
    )
}
