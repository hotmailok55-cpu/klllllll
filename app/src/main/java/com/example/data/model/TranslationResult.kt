package com.example.data.model

data class TranslationResult(
    val sourceText: String,
    val translatedText: String,
    val sourceLanguage: Language,
    val targetLanguage: Language,
    val phoneticSpelling: String,
    val ipaNotation: String,
    val syllables: List<String> = emptyList(),
    val literalMeaning: String? = null,
    val culturalMeaning: String,
    val pronunciationTips: List<String> = emptyList(),
    val alternativeDialects: List<RegionalAlternative> = emptyList(),
    val difficulty: DifficultyLevel = DifficultyLevel.HARD,
    val timestamp: Long = System.currentTimeMillis()
)

data class RegionalAlternative(
    val regionName: String,
    val flag: String,
    val phrase: String,
    val phonetic: String
)

data class VoiceRecording(
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

data class SavedTranslation(
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
