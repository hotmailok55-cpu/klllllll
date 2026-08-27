package com.ljbmk.social.ui.upload

import android.app.Application
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.ljbmk.social.data.SessionStore
import com.ljbmk.social.data.api.ApiClient
import com.ljbmk.social.data.api.userMessage
import com.ljbmk.social.data.model.CreateUploadRequest
import com.ljbmk.social.data.model.UpdateVideoRequest
import com.ljbmk.social.ui.components.GradientButton
import com.ljbmk.social.ui.components.LjbmkTopBar
import com.ljbmk.social.ui.theme.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody
import okio.BufferedSink
import okio.source

/**
 * UPLOAD.
 *
 * Mirrors the web flow, and for the same reason: the draft is created on the
 * server BEFORE any bytes are sent, so an interrupted upload is recoverable
 * rather than lost. Every pipeline stage is shown to the creator using the
 * server's own wording, so nobody is left wondering whether it broke.
 */
class UploadViewModel(app: Application) : AndroidViewModel(app) {
    private val session = SessionStore(app)
    private val api = ApiClient.get(session)
    private val context = app

    data class UiState(
        val videoId: String? = null,
        val stage: Stage = Stage.PickFile,
        val statusMessage: String = "",
        val progress: Int = 0,
        val error: String? = null,
        val canPublish: Boolean = false,
        val copyrightNote: String? = null,
        val published: Boolean = false,
    )

    enum class Stage { PickFile, Uploading, Processing, Ready, Failed }

    private val _state = MutableStateFlow(UiState())
    val state = _state.asStateFlow()

    fun upload(uri: Uri, fallbackTitle: String) {
        _state.update {
            it.copy(stage = Stage.Uploading, statusMessage = "Starting upload…", error = null)
        }

        viewModelScope.launch(Dispatchers.IO) {
            try {
                // 1. Create the draft FIRST — the upload is recoverable from here.
                val draft = api.createUpload(CreateUploadRequest(title = fallbackTitle, kind = "short"))
                _state.update { it.copy(videoId = draft.videoId, progress = 10) }

                // 2. Stream the file. `streamRequestBody` never loads the whole
                //    video into memory, so a 500MB upload does not OOM.
                _state.update { it.copy(statusMessage = "Uploading…", progress = 25) }
                api.uploadFile(draft.videoId, streamRequestBody(uri))

                // 3. Poll the pipeline and show the server's own wording.
                _state.update { it.copy(stage = Stage.Processing, progress = 45) }
                pollStatus(draft.videoId)

            } catch (t: Throwable) {
                _state.update {
                    it.copy(
                        stage = Stage.Failed,
                        error = t.userMessage(),
                        statusMessage = "Upload failed",
                    )
                }
            }
        }
    }

    private suspend fun pollStatus(videoId: String) {
        repeat(150) {                      // ~5 minutes at 2s intervals
            delay(2000)
            val status = runCatching { api.uploadStatus(videoId) }.getOrNull() ?: return@repeat

            _state.update {
                it.copy(
                    statusMessage = status.message,
                    progress = status.progress,
                    canPublish = status.canPublish,
                    copyrightNote = if (status.copyrightStatus == "pending")
                        "Copyright check is still pending — that does not block publishing."
                    else null,
                )
            }

            when (status.status) {
                "ready" -> {
                    _state.update { it.copy(stage = Stage.Ready) }
                    return
                }
                "failed" -> {
                    _state.update {
                        it.copy(stage = Stage.Failed, error = status.error ?: status.message)
                    }
                    return
                }
            }
        }
    }

    fun publish(title: String, description: String, visibility: String) {
        val videoId = _state.value.videoId ?: return
        _state.update { it.copy(statusMessage = "Publishing…") }

        viewModelScope.launch(Dispatchers.IO) {
            try {
                api.updateVideo(
                    videoId,
                    UpdateVideoRequest(
                        title = title.ifBlank { "Untitled" },
                        description = description,
                        visibility = visibility,
                    ),
                )
                _state.update { it.copy(published = true, statusMessage = "Published") }
            } catch (t: Throwable) {
                _state.update { it.copy(error = t.userMessage()) }
            }
        }
    }

    fun reset() { _state.value = UiState() }

    /**
     * Streams a content:// URI straight to the network.
     *
     * `writeTo` is called with the sink, so bytes go from the file to the
     * socket without ever being fully buffered in RAM.
     */
    private fun streamRequestBody(uri: Uri): RequestBody = object : RequestBody() {
        override fun contentType() = "application/octet-stream".toMediaType()

        override fun contentLength(): Long =
            runCatching {
                context.contentResolver.openAssetFileDescriptor(uri, "r")?.use { it.length }
            }.getOrNull() ?: -1L

        override fun writeTo(sink: BufferedSink) {
            context.contentResolver.openInputStream(uri)?.use { input ->
                sink.writeAll(input.source())
            } ?: throw IllegalStateException("Could not read that video file.")
        }
    }
}

@Composable
fun UploadScreen(
    unreadCount: Int,
    onDone: () -> Unit,
    onNotificationsClick: () -> Unit,
    viewModel: UploadViewModel = viewModel(),
) {
    val state by viewModel.state.collectAsState()

    var title by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var visibility by remember { mutableStateOf("public") }

    val picker = rememberLauncherForActivityResult(
        ActivityResultContracts.PickVisualMedia()
    ) { uri: Uri? ->
        if (uri != null) {
            val fallback = "My video"
            if (title.isBlank()) title = fallback
            viewModel.upload(uri, fallback)
        }
    }

    LaunchedEffect(state.published) { if (state.published) { viewModel.reset(); onDone() } }

    Column(Modifier.fillMaxSize()) {
        LjbmkTopBar(unreadCount = unreadCount, onNotificationsClick = onNotificationsClick)

        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
                .padding(bottom = 90.dp),
        ) {
            Text(
                "New video",
                style = MaterialTheme.typography.headlineMedium,
                modifier = Modifier.padding(vertical = 14.dp),
            )

            when (state.stage) {
                UploadViewModel.Stage.PickFile -> PickFileCard {
                    picker.launch(
                        androidx.activity.result.PickVisualMediaRequest(
                            ActivityResultContracts.PickVisualMedia.VideoOnly
                        )
                    )
                }

                else -> {
                    ProgressCard(
                        message = state.statusMessage,
                        progress = state.progress,
                        error = state.error,
                        note = state.copyrightNote,
                        failed = state.stage == UploadViewModel.Stage.Failed,
                        onRetry = viewModel::reset,
                    )

                    // Details become editable as soon as the file is accepted,
                    // so the creator fills them in while processing runs.
                    if (state.videoId != null && state.stage != UploadViewModel.Stage.Failed) {
                        Spacer(Modifier.height(16.dp))

                        OutlinedTextField(
                            value = title,
                            onValueChange = { title = it },
                            label = { Text("Title") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        Spacer(Modifier.height(12.dp))
                        OutlinedTextField(
                            value = description,
                            onValueChange = { description = it },
                            label = { Text("Description") },
                            minLines = 3,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        Spacer(Modifier.height(12.dp))

                        Text("Who can see this", style = MaterialTheme.typography.labelLarge)
                        Spacer(Modifier.height(6.dp))
                        VisibilityPicker(visibility) { visibility = it }

                        Spacer(Modifier.height(20.dp))
                        GradientButton(
                            text = if (state.canPublish) "Publish" else "Waiting for processing…",
                            onClick = { viewModel.publish(title, description, visibility) },
                            enabled = state.canPublish,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun PickFileCard(onPick: () -> Unit) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Surface),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(vertical = 44.dp, horizontal = 20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("🎬", fontSize = 40.sp)
            Spacer(Modifier.height(10.dp))
            Text("Choose a video", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(4.dp))
            Text(
                "MP4, WebM or MOV · up to 512MB",
                style = MaterialTheme.typography.bodySmall,
                color = TextMuted,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(18.dp))
            GradientButton("Pick from gallery", onPick, Modifier.fillMaxWidth(0.8f))
        }
    }
}

@Composable
private fun ProgressCard(
    message: String,
    progress: Int,
    error: String?,
    note: String?,
    failed: Boolean,
    onRetry: () -> Unit,
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Surface),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(16.dp)) {
            Text(message, style = MaterialTheme.typography.titleMedium)

            error?.let {
                Spacer(Modifier.height(6.dp))
                Text(it, color = Danger, style = MaterialTheme.typography.bodySmall)
            }
            note?.let {
                Spacer(Modifier.height(6.dp))
                Text(it, color = Warning, style = MaterialTheme.typography.bodySmall)
            }

            Spacer(Modifier.height(14.dp))
            LinearProgressIndicator(
                progress = { progress / 100f },
                color = if (failed) Danger else BrandPurple,
                trackColor = SurfaceHigh,
                modifier = Modifier.fillMaxWidth().height(6.dp),
            )

            if (failed) {
                Spacer(Modifier.height(16.dp))
                OutlinedButton(onClick = onRetry, modifier = Modifier.fillMaxWidth()) {
                    Text("Try again")
                }
            }
        }
    }
}

@Composable
private fun VisibilityPicker(selected: String, onSelect: (String) -> Unit) {
    val options = listOf(
        "public" to "Public — anyone can find and watch",
        "unlisted" to "Unlisted — only people with the link",
        "private" to "Private — only you",
    )
    Column {
        options.forEach { (value, label) ->
            Row(
                Modifier.fillMaxWidth().padding(vertical = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                RadioButton(selected = selected == value, onClick = { onSelect(value) })
                Text(label, style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}
