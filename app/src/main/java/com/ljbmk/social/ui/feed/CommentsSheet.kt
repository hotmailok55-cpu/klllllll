package com.ljbmk.social.ui.feed

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.ljbmk.social.data.SessionStore
import com.ljbmk.social.data.api.ApiClient
import com.ljbmk.social.data.api.userMessage
import com.ljbmk.social.data.model.Comment
import com.ljbmk.social.data.model.CommentRequest
import com.ljbmk.social.data.model.Video
import com.ljbmk.social.ui.components.*
import com.ljbmk.social.ui.theme.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Comments, in a bottom sheet over the feed.
 *
 * A sheet rather than a screen on purpose: the video keeps playing behind it,
 * so reading comments does not interrupt what you were watching.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CommentsSheet(
    video: Video,
    onDismiss: () -> Unit,
    onRequireSignIn: () -> Unit,
) {
    val context = LocalContext.current
    val session = remember { SessionStore(context) }
    val api = remember { ApiClient.get(session) }
    val scope = rememberCoroutineScope()

    var comments by remember { mutableStateOf<List<Comment>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var draft by remember { mutableStateOf("") }
    var posting by remember { mutableStateOf(false) }

    suspend fun load() {
        loading = true
        runCatching { withContext(Dispatchers.IO) { api.comments(video.id) } }
            .onSuccess { comments = it.comments; error = null }
            .onFailure { error = it.userMessage() }
        loading = false
    }

    LaunchedEffect(video.id) { load() }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = Surface,
        dragHandle = { BottomSheetDefaults.DragHandle() },
    ) {
        Column(Modifier.fillMaxWidth().heightIn(min = 320.dp, max = 620.dp)) {

            Text(
                "${formatCount(video.stats.comments)} comments",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            )
            HorizontalDivider(color = Divider)

            Box(Modifier.weight(1f)) {
                when {
                    loading -> LoadingView("Loading comments…")
                    error != null -> ErrorView(error!!, onRetry = { scope.launch { load() } })
                    comments.isEmpty() -> EmptyStateView(
                        state = com.ljbmk.social.data.model.EmptyState(
                            "No comments yet.",
                            "Be the first to start the conversation.",
                        ),
                        icon = "💬",
                    )
                    else -> LazyColumn(contentPadding = PaddingValues(horizontal = 16.dp)) {
                        items(comments, key = { it.id }) { comment ->
                            CommentRow(comment)
                            comment.replies.forEach { reply ->
                                CommentRow(reply, indent = 42.dp)
                            }
                        }
                    }
                }
            }

            HorizontalDivider(color = Divider)
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(12.dp)
                    .navigationBarsPadding()
                    .imePadding(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedTextField(
                    value = draft,
                    onValueChange = { draft = it },
                    placeholder = { Text("Add a comment…") },
                    modifier = Modifier.weight(1f),
                    maxLines = 3,
                )
                Button(
                    enabled = draft.isNotBlank() && !posting,
                    onClick = {
                        scope.launch {
                            // Signed out? Send them to sign-in rather than
                            // failing with a 401 they can do nothing about.
                            if (session.token.first() == null) {
                                onDismiss(); onRequireSignIn(); return@launch
                            }
                            posting = true
                            runCatching {
                                withContext(Dispatchers.IO) {
                                    api.postComment(video.id, CommentRequest(draft.trim()))
                                }
                            }.onSuccess { draft = ""; load() }
                                .onFailure { error = it.userMessage() }
                            posting = false
                        }
                    },
                ) { Text(if (posting) "…" else "Post") }
            }
        }
    }
}

@Composable
private fun CommentRow(comment: Comment, indent: androidx.compose.ui.unit.Dp = 0.dp) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(start = indent, top = 10.dp, bottom = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Avatar(comment.author.avatarUrl, comment.author.displayName, size = 32.dp)
        Column(Modifier.weight(1f)) {
            Text(
                "@${comment.author.username}",
                style = MaterialTheme.typography.bodySmall,
                color = TextMuted,
                fontWeight = FontWeight.SemiBold,
            )
            Text(comment.body, style = MaterialTheme.typography.bodyMedium, color = OnBackground)
            if (comment.likes > 0) {
                Text(
                    "♥ ${formatCount(comment.likes)}",
                    style = MaterialTheme.typography.bodySmall,
                    color = TextFaint,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
        }
    }
}
