package com.example.data.model

data class Language(
    val code: String,
    val name: String,
    val nativeName: String,
    val flag: String,
    val region: RegionCategory,
    val phoneticSummary: String,
    val difficulty: DifficultyLevel,
    val commonSlangExamples: List<String>,
    val audioTtsLocale: String = "es"
)

enum class DifficultyLevel(val label: String, val stars: Int, val description: String) {
    EASY("Moderate", 2, "Standard phonetics with slight accent"),
    INTERMEDIATE("Tricky", 3, "Notable consonant drops and rhythmic shifts"),
    HARD("High Difficulty", 4, "Heavy slang, lambdacism, or unique intonation"),
    EXPERT("Master Level", 5, "Distinct phonology, creole/indigenous roots or heavy elision")
}

enum class RegionCategory(val label: String) {
    CARIBBEAN("Caribbean"),
    CENTRAL_AMERICA("Central America"),
    SOUTH_AMERICA("South America"),
    INDIGENOUS_CREOLE("Indigenous & Creoles"),
    STANDARD("Standard Languages")
}

object SupportedLanguages {
    val ALL_LANGUAGES = listOf(
        Language(
            code = "en",
            name = "English",
            nativeName = "English",
            flag = "🇺🇸",
            region = RegionCategory.STANDARD,
            phoneticSummary = "Standard American & International English",
            difficulty = DifficultyLevel.EASY,
            commonSlangExamples = listOf("What's up", "Bro", "Cool", "Let's go"),
            audioTtsLocale = "en"
        ),
        Language(
            code = "es-DO",
            name = "Dominican",
            nativeName = "Español Dominicano",
            flag = "🇩🇴",
            region = RegionCategory.CARIBBEAN,
            phoneticSummary = "Dominican vernacular: Aspiration of final 's', dropping 'd' in '-ado', 'i' vocalization in Cibao, lightning cadence",
            difficulty = DifficultyLevel.EXPERT,
            commonSlangExamples = listOf("Klk manín", "De lo mío", "Ta to", "Dique", "Vaina", "Manso", "Concho", "Qué lo qué"),
            audioTtsLocale = "es"
        )
    )

    fun getByCode(code: String): Language {
        return ALL_LANGUAGES.find { it.code.equals(code, ignoreCase = true) }
            ?: ALL_LANGUAGES.first { it.code == "es-DO" }
    }
}
