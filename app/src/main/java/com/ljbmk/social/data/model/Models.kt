package com.ljbmk.social.data.model

import com.squareup.moshi.Json
import com.squareup.moshi.JsonClass

/**
 * The shapes the LJBMK Social backend returns.
 *
 * These mirror the JSON from `backend/src/routes/v1.js` exactly. If you change
 * a field name on the server, change it here too — Moshi maps by name.
 *
 * Every response is wrapped: success is `{ "data": ... }`, failure is
 * `{ "error": { code, message, details } }`. `ApiEnvelope` models that.
 */

@JsonClass(generateAdapter = true)
data class ApiEnvelope<T>(
    val data: T? = null,
    val error: ApiError? = null,
)

@JsonClass(generateAdapter = true)
data class ApiError(
    val code: String = "UNKNOWN",
    val message: String = "Something went wrong.",
    val details: Map<String, String>? = null,
    val requestId: String? = null,
)

// ---------------------------------------------------------------------------
// System / platform state
// ---------------------------------------------------------------------------

@JsonClass(generateAdapter = true)
data class SystemState(
    val platform: PlatformState,
    val features: Features,
    val categories: List<String> = emptyList(),
    val topics: List<String> = emptyList(),
)

@JsonClass(generateAdapter = true)
data class PlatformState(
    val publicVideoCount: Int = 0,
    val creatorCount: Int = 0,
    val userCount: Int = 0,
    /** empty | seedling | growing | established — drives the onboarding copy. */
    val stage: String = "empty",
    val isNewPlatform: Boolean = true,
)

@JsonClass(generateAdapter = true)
data class Features(
    val shorts: Boolean = true,
    val liveStreaming: Boolean = false,
    val monetization: Boolean = false,
    val musicLibrary: Boolean = false,
    val registration: Boolean = true,
)

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

@JsonClass(generateAdapter = true)
data class AuthResponse(
    val user: User,
    val token: String,
    val expiresAt: String? = null,
)

@JsonClass(generateAdapter = true)
data class MeResponse(
    val user: User,
    val channel: Channel? = null,
    val unreadNotifications: Int = 0,
)

@JsonClass(generateAdapter = true)
data class User(
    val id: String,
    val username: String,
    val displayName: String,
    val avatarUrl: String? = null,
    val bio: String = "",
    val isCreator: Boolean = false,
    val verified: Boolean = false,
    val email: String? = null,
    val role: String? = null,
    val onboarded: Boolean = false,
)

@JsonClass(generateAdapter = true)
data class LoginRequest(val email: String, val password: String)

@JsonClass(generateAdapter = true)
data class RegisterRequest(
    val username: String,
    val email: String,
    val password: String,
    val displayName: String? = null,
)

// ---------------------------------------------------------------------------
// Video
// ---------------------------------------------------------------------------

@JsonClass(generateAdapter = true)
data class FeedResponse(
    val videos: List<Video> = emptyList(),
    /** empty_platform | cold_start_user | personalized */
    val mode: String = "personalized",
    val platform: PlatformState? = null,
    val nextCursor: Int? = null,
    val empty: EmptyState? = null,
)

/**
 * Empty-state copy comes FROM THE SERVER, so the app shows the honest message
 * for the situation (brand new platform vs. caught up) without hard-coding it.
 */
@JsonClass(generateAdapter = true)
data class EmptyState(
    val title: String,
    val body: String? = null,
    val action: EmptyAction? = null,
    val secondaryAction: EmptyAction? = null,
)

@JsonClass(generateAdapter = true)
data class EmptyAction(val label: String, val href: String)

@JsonClass(generateAdapter = true)
data class Video(
    val id: String,
    val title: String,
    val description: String = "",
    val kind: String = "short",
    val category: String = "other",
    val tags: List<String> = emptyList(),
    val durationMs: Long = 0,
    val width: Int? = null,
    val height: Int? = null,
    val videoUrl: String? = null,
    val thumbnailUrl: String? = null,
    val renditions: List<Rendition> = emptyList(),
    val publishedAt: String? = null,
    val createdAt: String? = null,
    val stats: VideoStats = VideoStats(),
    val channel: VideoChannel? = null,
    val sound: VideoSound? = null,
    val viewerState: ViewerState? = null,
    // Owner-only fields
    val visibility: String? = null,
    val processingStatus: String? = null,
    val copyrightStatus: String? = null,
    val moderationStatus: String? = null,
)

@JsonClass(generateAdapter = true)
data class Rendition(val quality: String, val url: String, val bitrate: Int? = null)

@JsonClass(generateAdapter = true)
data class VideoStats(
    val views: Int = 0,
    val likes: Int = 0,
    val dislikes: Int = 0,
    val comments: Int = 0,
    val shares: Int = 0,
    val saves: Int = 0,
)

@JsonClass(generateAdapter = true)
data class VideoChannel(
    val id: String,
    val handle: String? = null,
    val name: String? = null,
    val avatarUrl: String? = null,
    val followerCount: Int = 0,
)

@JsonClass(generateAdapter = true)
data class VideoSound(
    val id: String,
    val title: String = "Original sound",
    val artist: String = "",
)

@JsonClass(generateAdapter = true)
data class ViewerState(
    val liked: Boolean = false,
    val disliked: Boolean = false,
    val saved: Boolean = false,
    val following: Boolean = false,
    val isOwner: Boolean = false,
)

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------

@JsonClass(generateAdapter = true)
data class ReactionResponse(
    val liked: Boolean = false,
    val disliked: Boolean = false,
    val likes: Int = 0,
    val dislikes: Int = 0,
)

@JsonClass(generateAdapter = true)
data class SaveResponse(val saved: Boolean = false)

@JsonClass(generateAdapter = true)
data class FollowResponse(val following: Boolean = false, val followerCount: Int = 0)

@JsonClass(generateAdapter = true)
data class ShareResponse(val shares: Int = 0)

/**
 * The watch heartbeat. The app reports how long the video was watched; the
 * SERVER decides whether that counts as a view. The client never asserts one.
 */
@JsonClass(generateAdapter = true)
data class WatchRequest(
    val watchMs: Long,
    val source: String = "feed",
    val replayed: Boolean = false,
)

@JsonClass(generateAdapter = true)
data class WatchResponse(val counted: Boolean = false, val views: Int = 0)

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

@JsonClass(generateAdapter = true)
data class CommentsResponse(
    val comments: List<Comment> = emptyList(),
    val empty: EmptyState? = null,
)

@JsonClass(generateAdapter = true)
data class Comment(
    val id: String,
    val videoId: String? = null,
    val parentId: String? = null,
    val depth: Int = 0,
    val body: String,
    val likes: Int = 0,
    val replyCount: Int = 0,
    val createdAt: String? = null,
    val editedAt: String? = null,
    val author: CommentAuthor,
    val replies: List<Comment> = emptyList(),
    val hasMoreReplies: Boolean = false,
    val viewerState: CommentViewerState? = null,
)

@JsonClass(generateAdapter = true)
data class CommentAuthor(
    val id: String,
    val username: String,
    val displayName: String,
    val avatarUrl: String? = null,
    val verified: Boolean = false,
)

@JsonClass(generateAdapter = true)
data class CommentViewerState(val liked: Boolean = false, val isAuthor: Boolean = false)

@JsonClass(generateAdapter = true)
data class CommentRequest(val body: String, val parentId: String? = null)

@JsonClass(generateAdapter = true)
data class CommentResponse(val comment: Comment)

@JsonClass(generateAdapter = true)
data class CommentLikeResponse(val liked: Boolean = false, val likes: Int = 0)

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

@JsonClass(generateAdapter = true)
data class TrendingResponse(
    val videos: List<Video> = emptyList(),
    val empty: EmptyState? = null,
)

@JsonClass(generateAdapter = true)
data class SearchResponse(
    val query: String = "",
    val videos: List<Video> = emptyList(),
    val channels: List<Channel> = emptyList(),
    val sounds: List<Sound> = emptyList(),
    val total: Int = 0,
    val empty: EmptyState? = null,
)

@JsonClass(generateAdapter = true)
data class Channel(
    val id: String,
    val handle: String,
    val name: String,
    val description: String = "",
    val avatarUrl: String? = null,
    val bannerUrl: String? = null,
    val followerCount: Int = 0,
    val videoCount: Int = 0,
    val totalViews: Int = 0,
    val ownerId: String? = null,
    val viewerState: ChannelViewerState? = null,
)

@JsonClass(generateAdapter = true)
data class ChannelViewerState(
    val following: Boolean = false,
    val notify: Boolean = false,
    val isOwner: Boolean = false,
)

@JsonClass(generateAdapter = true)
data class ChannelsResponse(val channels: List<Channel> = emptyList())

@JsonClass(generateAdapter = true)
data class ChannelDetailResponse(
    val channel: Channel,
    val videos: List<Video> = emptyList(),
)

@JsonClass(generateAdapter = true)
data class Sound(
    val id: String,
    val title: String,
    val artist: String = "",
    val source: String = "original",
    val coverUrl: String? = null,
    val durationMs: Long = 0,
    val audioUrl: String? = null,
    val useCount: Int = 0,
    val isOriginal: Boolean = false,
    val rightsStatus: String? = null,
    val usable: Boolean? = null,
)

@JsonClass(generateAdapter = true)
data class SoundsResponse(val sounds: List<Sound> = emptyList())

// ---------------------------------------------------------------------------
// Notifications / library
// ---------------------------------------------------------------------------

@JsonClass(generateAdapter = true)
data class NotificationsResponse(
    val notifications: List<Notification> = emptyList(),
    val unread: Int = 0,
    val empty: EmptyState? = null,
)

@JsonClass(generateAdapter = true)
data class Notification(
    val id: String,
    val type: String,
    val title: String,
    val body: String = "",
    val link: String? = null,
    val read: Boolean = false,
    val createdAt: String? = null,
)

@JsonClass(generateAdapter = true)
data class SavedResponse(
    val videos: List<Video> = emptyList(),
    val empty: EmptyState? = null,
)

@JsonClass(generateAdapter = true)
data class SubscriptionsResponse(
    val videos: List<Video> = emptyList(),
    val empty: EmptyState? = null,
)

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

@JsonClass(generateAdapter = true)
data class CreateUploadRequest(val title: String? = null, val kind: String = "short")

@JsonClass(generateAdapter = true)
data class CreateUploadResponse(
    val videoId: String,
    val channelId: String? = null,
    val status: String = "draft",
)

@JsonClass(generateAdapter = true)
data class UploadFileResponse(
    val videoId: String,
    val status: String,
    val bytes: Long = 0,
    val format: String? = null,
)

/** The pipeline status the creator sees, worded by the server. */
@JsonClass(generateAdapter = true)
data class UploadStatus(
    val videoId: String,
    val status: String,
    val message: String,
    val progress: Int = 0,
    val error: String? = null,
    val copyrightStatus: String? = null,
    val moderationStatus: String? = null,
    val canPublish: Boolean = false,
)

@JsonClass(generateAdapter = true)
data class UpdateVideoRequest(
    val title: String? = null,
    val description: String? = null,
    val category: String? = null,
    val visibility: String? = null,
)

@JsonClass(generateAdapter = true)
data class VideoResponse(val video: Video)

@JsonClass(generateAdapter = true)
data class VideoDetailResponse(
    val video: Video,
    val related: List<Video> = emptyList(),
)

@JsonClass(generateAdapter = true)
data class InterestsRequest(val topics: List<String>)

@JsonClass(generateAdapter = true)
data class GenericResponse(
    @Json(name = "signedOut") val signedOut: Boolean? = null,
    val deleted: Boolean? = null,
)
