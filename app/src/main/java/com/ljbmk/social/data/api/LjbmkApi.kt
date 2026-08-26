package com.ljbmk.social.data.api

import com.ljbmk.social.data.model.*
import okhttp3.RequestBody
import retrofit2.http.*

/**
 * The LJBMK Social HTTP API, as Retrofit sees it.
 *
 * Mirrors `backend/src/routes/v1.js` one-for-one. Every response comes wrapped
 * in `{ "data": ... }`, which `EnvelopeConverterFactory` unwraps so the calls
 * here return the payload directly.
 *
 * NOTE: no API keys anywhere in this file, or anywhere in the app. The phone
 * only ever talks to OUR backend; the backend is what holds credentials and
 * talks to copyright / music / moderation providers.
 */
interface LjbmkApi {

    // --- System ---------------------------------------------------------

    @GET("api/v1/system/state")
    suspend fun systemState(): SystemState

    // --- Auth -----------------------------------------------------------

    @POST("api/v1/auth/login")
    suspend fun login(@Body body: LoginRequest): AuthResponse

    @POST("api/v1/auth/register")
    suspend fun register(@Body body: RegisterRequest): AuthResponse

    @POST("api/v1/auth/logout")
    suspend fun logout(): GenericResponse

    @GET("api/v1/auth/me")
    suspend fun me(): MeResponse

    @POST("api/v1/users/me/interests")
    suspend fun setInterests(@Body body: InterestsRequest): Map<String, List<String>>

    // --- Feed & discovery ------------------------------------------------

    @GET("api/v1/feed")
    suspend fun feed(
        @Query("kind") kind: String = "short",
        @Query("limit") limit: Int = 8,
        @Query("cursor") cursor: Int = 0,
    ): FeedResponse

    @GET("api/v1/trending")
    suspend fun trending(@Query("limit") limit: Int = 20): TrendingResponse

    @GET("api/v1/search")
    suspend fun search(
        @Query("q") query: String,
        @Query("type") type: String = "all",
        @Query("limit") limit: Int = 20,
    ): SearchResponse

    @GET("api/v1/channels")
    suspend fun suggestedChannels(@Query("limit") limit: Int = 10): ChannelsResponse

    @GET("api/v1/me/subscriptions")
    suspend fun subscriptions(): SubscriptionsResponse

    // --- Video ------------------------------------------------------------

    @GET("api/v1/videos/{id}")
    suspend fun video(@Path("id") id: String): VideoDetailResponse

    @POST("api/v1/videos/{id}/like")
    suspend fun like(@Path("id") id: String): ReactionResponse

    @POST("api/v1/videos/{id}/save")
    suspend fun save(@Path("id") id: String): SaveResponse

    @POST("api/v1/videos/{id}/share")
    suspend fun share(@Path("id") id: String): ShareResponse

    /**
     * The watch heartbeat. Sent when a video scrolls out of view.
     * This is what feeds view counting AND teaches the recommendation engine.
     */
    @POST("api/v1/videos/{id}/watch")
    suspend fun watch(@Path("id") id: String, @Body body: WatchRequest): WatchResponse

    @PATCH("api/v1/videos/{id}")
    suspend fun updateVideo(@Path("id") id: String, @Body body: UpdateVideoRequest): VideoResponse

    // --- Channels ---------------------------------------------------------

    @GET("api/v1/channels/{handle}")
    suspend fun channel(@Path("handle") handle: String): ChannelDetailResponse

    @POST("api/v1/channels/{id}/follow")
    suspend fun follow(@Path("id") id: String): FollowResponse

    // --- Comments ---------------------------------------------------------

    @GET("api/v1/videos/{id}/comments")
    suspend fun comments(
        @Path("id") videoId: String,
        @Query("sort") sort: String = "top",
    ): CommentsResponse

    @POST("api/v1/videos/{id}/comments")
    suspend fun postComment(
        @Path("id") videoId: String,
        @Body body: CommentRequest,
    ): CommentResponse

    @POST("api/v1/comments/{id}/like")
    suspend fun likeComment(@Path("id") id: String): CommentLikeResponse

    // --- Sounds -----------------------------------------------------------

    @GET("api/v1/sounds/popular")
    suspend fun popularSounds(): SoundsResponse

    @GET("api/v1/sounds/trending")
    suspend fun trendingSounds(): SoundsResponse

    // --- Notifications / library -------------------------------------------

    @GET("api/v1/notifications")
    suspend fun notifications(): NotificationsResponse

    @POST("api/v1/notifications/read")
    suspend fun markNotificationsRead(@Body body: Map<String, String> = emptyMap()): Map<String, Int>

    @GET("api/v1/me/saved")
    suspend fun saved(): SavedResponse

    // --- Upload -------------------------------------------------------------

    @POST("api/v1/uploads")
    suspend fun createUpload(@Body body: CreateUploadRequest): CreateUploadResponse

    /**
     * The raw video bytes. The backend validates the FILE SIGNATURE (not the
     * filename), so a renamed .sh will be rejected here.
     */
    @POST("api/v1/uploads/{id}/file")
    suspend fun uploadFile(
        @Path("id") videoId: String,
        @Body body: RequestBody,
    ): UploadFileResponse

    @GET("api/v1/uploads/{id}/status")
    suspend fun uploadStatus(@Path("id") videoId: String): UploadStatus
}
