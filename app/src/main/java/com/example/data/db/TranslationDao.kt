package com.example.data.db

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

@Dao
interface TranslationDao {

    @Query("SELECT * FROM saved_translations ORDER BY timestamp DESC")
    fun getAllHistory(): Flow<List<SavedTranslationEntity>>

    @Query("SELECT * FROM saved_translations WHERE isFavorite = 1 ORDER BY timestamp DESC")
    fun getFavorites(): Flow<List<SavedTranslationEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertTranslation(translation: SavedTranslationEntity): Long

    @Update
    suspend fun updateTranslation(translation: SavedTranslationEntity)

    @Delete
    suspend fun deleteTranslation(translation: SavedTranslationEntity)

    @Query("DELETE FROM saved_translations")
    suspend fun clearAllHistory()

    // Voice recordings
    @Query("SELECT * FROM voice_recordings ORDER BY createdAt DESC")
    fun getAllVoiceRecordings(): Flow<List<VoiceRecordingEntity>>

    @Query("SELECT * FROM voice_recordings WHERE phrase = :phrase LIMIT 1")
    suspend fun getVoiceRecordingForPhrase(phrase: String): VoiceRecordingEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertVoiceRecording(recording: VoiceRecordingEntity)

    @Delete
    suspend fun deleteVoiceRecording(recording: VoiceRecordingEntity)
}
