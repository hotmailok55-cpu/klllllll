package com.example.data.db

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "saved_translations")
data class SavedTranslationEntity(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    val sourceText: String,
    val translatedText: String,
    val sourceCode: String,
    val targetCode: String,
    val sourceName: String,
    val targetName: String,
    val targetFlag: String,
    val phonetic: String,
    val culturalMeaning: String,
    val isFavorite: Boolean = false,
    val timestamp: Long = System.currentTimeMillis()
)

@Entity(tableName = "voice_recordings")
data class VoiceRecordingEntity(
    @PrimaryKey
    val id: String,
    val phrase: String,
    val dialectCode: String,
    val dialectName: String,
    val filePath: String,
    val durationSeconds: Float,
    val createdAt: Long = System.currentTimeMillis(),
    val notes: String = "",
    val speakerTag: String = "My Voice"
)
