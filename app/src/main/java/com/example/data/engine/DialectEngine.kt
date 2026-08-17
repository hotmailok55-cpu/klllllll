package com.example.data.engine

import com.example.data.model.DifficultyLevel
import com.example.data.model.Language
import com.example.data.model.RegionalAlternative
import com.example.data.model.SupportedLanguages
import com.example.data.model.TranslationResult
import java.util.Locale

object DialectEngine {

    data class PhraseEntry(
        val concept: String,
        val english: String,
        val standardSpanish: String,
        val dialectTranslations: Map<String, DialectDetail>,
        val literalEnglish: String? = null,
        val baseExplanation: String
    )

    data class DialectDetail(
        val text: String,
        val phonetic: String,
        val ipa: String,
        val syllables: List<String>,
        val tips: List<String>,
        val difficulty: DifficultyLevel
    )

    private val DICTIONARY = listOf(
        PhraseEntry(
            concept = "greeting_friend",
            english = "What's up, bro?",
            standardSpanish = "¿Qué tal, amigo?",
            baseExplanation = "Standard street greeting between close friends and peers.",
            dialectTranslations = mapOf(
                "es-DO" to DialectDetail(
                    text = "¡Klk manín! ¿Cómo tú 'tá?",
                    phonetic = "[kay-el-KAY mah-NEEN! CO-mo too TAH?]",
                    ipa = "/ke lo ke maˈniŋ ˈkomo tu ˈta/",
                    syllables = listOf("K-L", "KÉ", "ma", "NÍN", "có", "mo", "tú", "tá"),
                    tips = listOf(
                        "Say 'Klk' ultra fast as one syllable [klk] or [kay-el-kay].",
                        "Drop the 's' in 'está' completely -> say 'tá'.",
                        "Velarize the 'n' in 'manín' to sound like an English -ng."
                    ),
                    difficulty = DifficultyLevel.EXPERT
                ),
                "es-PR" to DialectDetail(
                    text = "¡Wepa broki, dímelo cantando!",
                    phonetic = "[WEH-pah BROH-kee, DEE-meh-lo kahn-TAHN-do!]",
                    ipa = "/ˈwepa ˈbɾoki ˈdimelo kanˈtando/",
                    syllables = listOf("WE", "pa", "bro", "ki", "dí", "me", "lo", "can", "tan", "do"),
                    tips = listOf(
                        "Pronounce 'wepa' with high upbeat energy.",
                        "If pronouncing 'r', keep it soft or substitute with a subtle 'l' sound."
                    ),
                    difficulty = DifficultyLevel.HARD
                ),
                "es-CU" to DialectDetail(
                    text = "¡Asere, ¿qué bolá contigo?!",
                    phonetic = "[ah-SEH-reh, kay boh-LAH kohn-TEE-go?!]",
                    ipa = "/aˈseɾe ke boˈla konˈtiɡo/",
                    syllables = listOf("a", "SE", "re", "qué", "bo", "LÁ"),
                    tips = listOf(
                        "Emphasis heavily on the 'LÁ' in 'bolá'.",
                        "Say 'asere' smoothly with vibrant melodic pitch."
                    ),
                    difficulty = DifficultyLevel.EXPERT
                ),
                "ht" to DialectDetail(
                    text = "Sak pase, monchè? N ap boule!",
                    phonetic = "[sak pah-SAY, mohn-SHEH? NAHP boo-LAY!]",
                    ipa = "/sak paˈse mõˈʃɛ nap buˈle/",
                    syllables = listOf("sak", "pa", "sé", "mon", "chè", "n'ap", "bou", "lé"),
                    tips = listOf(
                        "Nasalize 'mon' like French 'mon'.",
                        "'N ap boule' literally means 'we are burning' (doing great!).",
                        "Sharp accent on 'se' in sak pase."
                    ),
                    difficulty = DifficultyLevel.EXPERT
                ),
                "pap" to DialectDetail(
                    text = "Con ta bai, mi dushi fren?",
                    phonetic = "[KOHN tah BYE, mee DOO-shee frehn?]",
                    ipa = "/kon ta baj mi ˈduʃi fɾɛn/",
                    syllables = listOf("con", "ta", "bai", "mi", "du", "shi"),
                    tips = listOf(
                        "'Dushi' has a soft 'sh' sound like 'shoe'.",
                        "Musical Papiamentu intonation: rise slightly on 'bai'."
                    ),
                    difficulty = DifficultyLevel.HARD
                ),
                "jam" to DialectDetail(
                    text = "Wah gwaan, bredren? Mi deh yah!",
                    phonetic = "[WAH GWAHN, BREH-dren? mee deh YAH!]",
                    ipa = "/wa ɡwaːn ˈbɾɛdɾɛn mi dɛ ja/",
                    syllables = listOf("wah", "gwaan", "bre", "dren", "mi", "deh", "yah"),
                    tips = listOf(
                        "Elongate the vowel in 'gwaan' [gwahn].",
                        "'Mi deh yah' means 'I am right here / doing okay'."
                    ),
                    difficulty = DifficultyLevel.HARD
                ),
                "es-MX" to DialectDetail(
                    text = "¿Qué onda, güey? ¿Qué transa?",
                    phonetic = "[KAY OHN-dah, GWAY? kay TRAHN-sah?]",
                    ipa = "/ke ˈonda ˈweɪ̯ ke ˈtɾansa/",
                    syllables = listOf("qué", "on", "da", "güey", "qué", "tran", "sa"),
                    tips = listOf(
                        "'Güey' is pronounced like English 'way' with a subtle voiced 'g/w'.",
                        "Crisp, clear vowels with standard central Mexican inflection."
                    ),
                    difficulty = DifficultyLevel.INTERMEDIATE
                ),
                "es-CO-carib" to DialectDetail(
                    text = "¡Ajá, mi cuadro! ¿Qué es la vaina?",
                    phonetic = "[ah-HAH, mee KWAH-droh! kay ece lah VYE-nah?]",
                    ipa = "/aˈxa mi ˈkwadɾo ke lah ˈbaɪ̯na/",
                    syllables = listOf("a", "já", "mi", "cua", "dro"),
                    tips = listOf(
                        "The 'j' in 'Ajá' is aspirated softly like an English 'h'.",
                        "Fast rhythmic Caribbean Coast cadence."
                    ),
                    difficulty = DifficultyLevel.HARD
                ),
                "es-VE" to DialectDetail(
                    text = "¿Qué pasó, mi pana? ¿Todo chévere?",
                    phonetic = "[kay pah-SOH, mee PAH-nah? TOH-doh CHEH-veh-reh?]",
                    ipa = "/ke paˈso mi ˈpana ˈtodo ˈt͡ʃebeɾe/",
                    syllables = listOf("qué", "pa", "só", "mi", "pa", "na", "to", "do", "ché", "ve", "re"),
                    tips = listOf(
                        "Say 'pana' with clear open 'a' vowels.",
                        "'Chévere' has soft unstressed 'e' endings."
                    ),
                    difficulty = DifficultyLevel.INTERMEDIATE
                ),
                "es-CL" to DialectDetail(
                    text = "¿Cómo estai, weón? ¿Todo bacán?",
                    phonetic = "[COH-moh eh-STYE, weh-OHN? TOH-doh bah-KAHN?]",
                    ipa = "/ˈkomo ehˈtaj weˈon ˈtodo baˈkan/",
                    syllables = listOf("có", "mo", "es", "tai", "we", "ón"),
                    tips = listOf(
                        "Aspirate the 's' in 'estai' -> sounds like 'eh-tai'.",
                        "Drop final consonants and speak at rapid speed."
                    ),
                    difficulty = DifficultyLevel.EXPERT
                ),
                "qu" to DialectDetail(
                    text = "Allillanchu wauqiy, ¿allillanmi kanki?",
                    phonetic = "[ah-yeel-YAHN-choo WOW-kee, ah-yeel-YAHN-mee KAHN-kee?]",
                    ipa = "/aʎiˈʎant͡ʃu ˈwawqij aʎiˈʎanmi ˈkanki/",
                    syllables = listOf("al", "li", "llan", "chu", "wau", "qiy"),
                    tips = listOf(
                        "'Allillanchu' literally asks 'Are you good/well?'.",
                        "Stress almost always goes on the penultimate (second-to-last) syllable."
                    ),
                    difficulty = DifficultyLevel.EXPERT
                ),
                "nah" to DialectDetail(
                    text = "Niltze notlazohticniu, ¿cualli tonalli?",
                    phonetic = "[NEEL-tseh no-tlah-zo-TEEK-nyoo, KWAH-lee to-NAH-lee?]",
                    ipa = "/ˈniltse no.t͡ɬa.sohˈtik.nju ˈkʷa.lːi toˈna.lːi/",
                    syllables = listOf("neel", "tse", "no", "tla", "zoh", "tic", "niu"),
                    tips = listOf(
                        "The 'tl' affricate is made by releasing air along the sides of the tongue.",
                        "Stress on the second to last syllable."
                    ),
                    difficulty = DifficultyLevel.EXPERT
                ),
                "gn" to DialectDetail(
                    text = "Mba'eichapa che irũ, ¿iporãpa?",
                    phonetic = "[mbah-ay-EE-chah-pah cheh ee-ROO, ee-poh-RAHN-pah?]",
                    ipa = "/mboeˈʃapa ʃe iˈrũ ipoˈrãpa/",
                    syllables = listOf("mba", "'ei", "cha", "pa", "che", "i", "rũ"),
                    tips = listOf(
                        "The apostrophe (') is a 'puso' (glottal stop catch in the throat).",
                        "Nasal tilde (~) creates strong nasal airflow through the nose."
                    ),
                    difficulty = DifficultyLevel.EXPERT
                )
            )
        ),

        PhraseEntry(
            concept = "thats_great",
            english = "That's awesome / fantastic!",
            standardSpanish = "¡Eso es genial / maravilloso!",
            baseExplanation = "Expression of excitement, approval, and celebrating something great.",
            dialectTranslations = mapOf(
                "es-DO" to DialectDetail(
                    text = "¡Eso 'tá bacanísimo / 'tá durísimo!",
                    phonetic = "[EH-so TAH bah-kah-NEE-see-moh / TAH doo-REE-see-moh!]",
                    ipa = "/ˈeso ta bakaˈnisimo/",
                    syllables = listOf("e", "so", "tá", "ba", "ca", "ní", "si", "mo"),
                    tips = listOf(
                        "Drop the 'es-' in 'está' and snap directly to 'tá'.",
                        "'Duro' / 'Durísimo' means something is exceptionally top tier."
                    ),
                    difficulty = DifficultyLevel.HARD
                ),
                "es-PR" to DialectDetail(
                    text = "¡Eso 'tá brutal, papi! ¡De show!",
                    phonetic = "[EH-so TAH broo-TAHL, PAH-pee! deh SHOH!]",
                    ipa = "/ˈeso ta bɾuˈtal ˈpapi de ˈʃow/",
                    syllables = listOf("e", "so", "tá", "bru", "tal", "de", "show"),
                    tips = listOf(
                        "'De show' is pronounced with English 'show' pronunciation.",
                        "Stress the 'tal' in 'brutal' with slight Puerto Rican lilt."
                    ),
                    difficulty = DifficultyLevel.HARD
                ),
                "es-CU" to DialectDetail(
                    text = "¡Eso 'tá volao / tremendo bombazo!",
                    phonetic = "[EH-so TAH voh-LAO / treh-MEN-doh bohm-BAH-zoh!]",
                    ipa = "/ˈeso ta boˈlao tɾeˈmendo bomˈbaso/",
                    syllables = listOf("e", "so", "tá", "vo", "lao"),
                    tips = listOf(
                        "Contract 'volado' into one diphthong 'volao'.",
                        "Crisp Caribbean Cuban bounce."
                    ),
                    difficulty = DifficultyLevel.EXPERT
                ),
                "ht" to DialectDetail(
                    text = "Sa bèl anpil! Sa bon nèt!",
                    phonetic = "[SAH BELL ahn-PEEL! SAH BOHN NET!]",
                    ipa = "/sa bɛl ɑ̃ˈpil sa bɔ̃ nɛt/",
                    syllables = listOf("sa", "bèl", "an", "pil", "sa", "bon", "nèt"),
                    tips = listOf(
                        "'Bèl anpil' means very beautiful/great.",
                        "'Nèt' provides strong exclamation emphasis at the end."
                    ),
                    difficulty = DifficultyLevel.HARD
                ),
                "pap" to DialectDetail(
                    text = "Hopi bon! Bunita mashá!",
                    phonetic = "[HOH-pee BOHN! boo-NEE-tah mah-SHAH!]",
                    ipa = "/ˈhopi bɔn buˈnita maˈʃa/",
                    syllables = listOf("ho", "pi", "bon", "bu", "ni", "ta", "ma", "shá"),
                    tips = listOf(
                        "'Mashá' has a stressed 'shá' sound.",
                        "'Hopi' is the classic ABC Islands word for 'very / a lot'."
                    ),
                    difficulty = DifficultyLevel.HARD
                ),
                "jam" to DialectDetail(
                    text = "Dat irie man! Mad sick and wicked!",
                    phonetic = "[DAHT EYE-ree MAHN! mahd seek ahnd WICK-id!]",
                    ipa = "/dat ˈaɪɾi man mad sɪk and ˈwɪkɪd/",
                    syllables = listOf("dat", "i", "rie", "man"),
                    tips = listOf(
                        "'Irie' represents total peace, excellence, and harmony.",
                        "Say 'dat' with a heavy D replacing English 'th'."
                    ),
                    difficulty = DifficultyLevel.INTERMEDIATE
                ),
                "es-MX" to DialectDetail(
                    text = "¡Está bien chido / con madre!",
                    phonetic = "[eh-STAH bee-EHN CHEE-doh / kohn MAH-dreh!]",
                    ipa = "/esˈta ˈbjen ˈt͡ʃido kon ˈmadɾe/",
                    syllables = listOf("es", "tá", "bien", "chi", "do"),
                    tips = listOf(
                        "Sharp 'ch' in 'chido'.",
                        "Widely used in modern Mexican vernacular."
                    ),
                    difficulty = DifficultyLevel.EASY
                ),
                "es-CO-carib" to DialectDetail(
                    text = "¡Qué vaina tan bacana, cipote elegancia!",
                    phonetic = "[kay VYE-nah tahn bah-KAH-nah, see-POH-teh eh-leh-GAHN-see-ah!]",
                    ipa = "/ke ˈbaɪ̯na tam baˈkana siˈpote eleˈɡansja/",
                    syllables = listOf("qué", "vai", "na", "tan", "ba", "ca", "na"),
                    tips = listOf(
                        "'Bacano/a' means exceptionally good or cool.",
                        "'Cipote' intensifies the phrase (huge/great)."
                    ),
                    difficulty = DifficultyLevel.HARD
                )
            )
        ),

        PhraseEntry(
            concept = "no_way_really",
            english = "No way! Are you serious?",
            standardSpanish = "¡No puede ser! ¿Hablas en serio?",
            baseExplanation = "Surprise, disbelief, or astonishment at shocking news.",
            dialectTranslations = mapOf(
                "es-DO" to DialectDetail(
                    text = "¡Mentira de ahí! ¿Dique verdad?",
                    phonetic = "[men-TEE-rah deh EYE! DEE-kay vehr-DAH?]",
                    ipa = "/menˈtiɾa de aˈi ˈdike beɾˈda/",
                    syllables = listOf("men", "ti", "ra", "de", "ahí", "di", "que", "ver", "dá"),
                    tips = listOf(
                        "'Dique' is the signature Dominican dubitative particle ('allegedly / as if').",
                        "Drop final 'd' in 'verdad' -> 'verdá'."
                    ),
                    difficulty = DifficultyLevel.EXPERT
                ),
                "es-PR" to DialectDetail(
                    text = "¡Acho no me jodas! ¿En serio, pa'?",
                    phonetic = "[AH-choh noh meh HOH-dahs! ehn SEH-ree-oh, PAH?]",
                    ipa = "/ˈat͡ʃo no me ˈxodas en ˈseɾjo pa/",
                    syllables = listOf("a", "cho", "no", "me", "jo", "das", "en", "se", "rio"),
                    tips = listOf(
                        "Start with deep, drawn out 'Aaa-cho'.",
                        "Aspirate the 's' into a breathy 'h'."
                    ),
                    difficulty = DifficultyLevel.HARD
                ),
                "es-CU" to DialectDetail(
                    text = "¡No me descargues esa muela! ¿Qué me dices?",
                    phonetic = "[noh meh dehs-KAHR-gehs EH-sah MWEH-lah! kay meh DEE-sehs?]",
                    ipa = "/no me dehkaɾˈɡeh ˈesa ˈmwela/",
                    syllables = listOf("no", "me", "des", "car", "gues", "e", "sa", "mue", "la"),
                    tips = listOf(
                        "'Muela' means long talk or exaggerated story in Cuban slang.",
                        "Consonants sound double-hit (gemination)."
                    ),
                    difficulty = DifficultyLevel.EXPERT
                ),
                "ht" to DialectDetail(
                    text = "Ou manti! Èske se vre wi?",
                    phonetic = "[oo MAHN-tee! ES-kay say VRAY wee?]",
                    ipa = "/u mãˈti ɛs.ke se vɾe wi/",
                    syllables = listOf("ou", "man", "ti", "ès", "ke", "se", "vre", "wi"),
                    tips = listOf(
                        "'Wi' adds emphatic affirmation at the end.",
                        "'Manti' has nasal 'an' sound."
                    ),
                    difficulty = DifficultyLevel.HARD
                ),
                "pap" to DialectDetail(
                    text = "No por ta! Ta berdad?",
                    phonetic = "[noh pohr TAH! tah behr-DAHD?]",
                    ipa = "/no poɾ ta ta bɛɾˈdat/",
                    syllables = listOf("no", "por", "ta", "ta", "ber", "dad"),
                    tips = listOf(
                        "Quick sharp syllables.",
                        "'No por ta' means 'it cannot be'."
                    ),
                    difficulty = DifficultyLevel.INTERMEDIATE
                ),
                "es-MX" to DialectDetail(
                    text = "¡No manches! ¿Neta me lo dices?",
                    phonetic = "[noh MAHN-chehs! NEH-tah meh loh DEE-sehs?]",
                    ipa = "/no ˈmant͡ʃes ˈneta me lo ˈdises/",
                    syllables = listOf("no", "man", "ches", "ne", "ta", "me", "lo", "di", "ces"),
                    tips = listOf(
                        "'Neta' means pure truth.",
                        "Emphasize the 'MAN' in 'manches'."
                    ),
                    difficulty = DifficultyLevel.EASY
                ),
                "es-CL" to DialectDetail(
                    text = "¡La dura! ¿Estai cuatiquiando?",
                    phonetic = "[lah DOO-rah! eh-STYE kwah-tee-KYAHN-doh?]",
                    ipa = "/la ˈduɾa ehtaj kwatikiˈando/",
                    syllables = listOf("la", "du", "ra", "es", "tai", "cua", "ti", "quian", "do"),
                    tips = listOf(
                        "'La dura' means 'the honest truth'.",
                        "'Cuático' means something weird, wild, or exaggerated."
                    ),
                    difficulty = DifficultyLevel.EXPERT
                )
            )
        ),

        PhraseEntry(
            concept = "lets_hang_out_party",
            english = "Let's hang out and party tonight!",
            standardSpanish = "¡Vamos a salir de fiesta esta noche!",
            baseExplanation = "Inviting friends out for drinks, dancing, music, and socializing.",
            dialectTranslations = mapOf(
                "es-DO" to DialectDetail(
                    text = "¡Vamo' a desacata-no y bebe' romo en el colmado hoy!",
                    phonetic = "[VAH-moh ah deh-sah-kah-TAH-noh ee beh-BEH ROH-moh ehn ehl kohl-MAH-doh OY!]",
                    ipa = "/ˈbamo a desakataˈno i beˈbe ˈromo en el kolˈmado oj/",
                    syllables = listOf("va", "mo", "a", "de", "sa", "ca", "ta", "no"),
                    tips = listOf(
                        "Drop final 's' and 'r' in verbs: 'vamos' -> 'vamo'', 'desacatarnos' -> 'desacata-no'.",
                        "'Romo' is Dominican for rum/alcohol, 'Colmado' is the local bodega dance hub."
                    ),
                    difficulty = DifficultyLevel.EXPERT
                ),
                "es-PR" to DialectDetail(
                    text = "¡Vamo' a jangueal y montar el perreo esta noche!",
                    phonetic = "[VAH-moh ah hahn-geh-AHL ee mohn-TAHR ehl peh-REH-oh EH-stah NOH-cheh!]",
                    ipa = "/ˈbamo a xaŋɡeˈal i monˈtaɾ el peˈreo/",
                    syllables = listOf("va", "mo", "a", "jan", "gue", "al", "per", "re", "o"),
                    tips = listOf(
                        "Lambdacism: turn the 'r' in 'janguear' into an 'l' -> 'jangueal'.",
                        "'Janguear' comes from the English loanword 'hang out'."
                    ),
                    difficulty = DifficultyLevel.HARD
                ),
                "es-CU" to DialectDetail(
                    text = "¡Vamo' pa' la rumba a botar el golpe hoy!",
                    phonetic = "[VAH-moh pah lah ROOM-bah ah boh-TAHR ehl GOHL-peh OY!]",
                    ipa = "/ˈbamo pa la ˈrumba a boˈtaɾ el ˈɡolpe/",
                    syllables = listOf("va", "mo", "pa", "la", "rum", "ba"),
                    tips = listOf(
                        "'Botar el golpe' means to blow off steam and dance hard.",
                        "Fast rhythmic Caribbean Cuban cadence."
                    ),
                    difficulty = DifficultyLevel.HARD
                ),
                "ht" to DialectDetail(
                    text = "Ann al fè fèt epi danse konpa aswè a!",
                    phonetic = "[AHN ahl fay FET eh-pee DAHN-say kohn-PAH ah-SWAY ah!]",
                    ipa = "/ãn al fɛ fɛt e.pi dãˈse kɔ̃ˈpa aswɛ a/",
                    syllables = listOf("ann", "al", "fè", "fèt", "dan", "se", "kon", "pa"),
                    tips = listOf(
                        "'Konpa' (Compas) is Haiti's iconic dance and music style.",
                        "Nasal vowels in 'ann', 'danse', 'konpa'."
                    ),
                    difficulty = DifficultyLevel.EXPERT
                ),
                "jam" to DialectDetail(
                    text = "Mek wi go rave inna di dancehall tunight!",
                    phonetic = "[MEK wee go RAHV in-nah dee DAHNCE-hawl too-NIGHT!]",
                    ipa = "/mɛk wi ɡo ɾeɪ̯v ˈɪna di ˈdansˌhɔːl tuˈnaɪt/",
                    syllables = listOf("mek", "wi", "go", "rave", "in", "na", "di"),
                    tips = listOf(
                        "'Mek wi' means 'let us'.",
                        "'Inna di' = in the."
                    ),
                    difficulty = DifficultyLevel.HARD
                ),
                "tcr" to DialectDetail(
                    text = "Leh we go lime and play mas tonight!",
                    phonetic = "[LEH weh goh LYME ahnd play MAHS too-NIGHT!]",
                    ipa = "/lɛ wi ɡo laɪm and pleɪ mas tuˈnaɪt/",
                    syllables = listOf("leh", "we", "go", "lime"),
                    tips = listOf(
                        "'Limin'' is the beloved Trinidadian art of chilling and hanging out.",
                        "Short relaxed vowels."
                    ),
                    difficulty = DifficultyLevel.INTERMEDIATE
                ),
                "es-MX" to DialectDetail(
                    text = "¡Vamos a pistear y armar el desmadre hoy!",
                    phonetic = "[VAH-mohs ah pees-teh-AHR ee ahr-MAHR ehl dehs-MAH-dreh OY!]",
                    ipa = "/ˈbamos a pisteˈaɾ i aɾˈmaɾ el desˈmadɾe oj/",
                    syllables = listOf("va", "mos", "a", "pis", "te", "ar", "des", "ma", "dre"),
                    tips = listOf(
                        "'Pistear' means drinking alcohol with friends.",
                        "'Desmadre' refers to a wild, energetic party."
                    ),
                    difficulty = DifficultyLevel.INTERMEDIATE
                )
            )
        ),

        PhraseEntry(
            concept = "take_it_easy",
            english = "Take it easy / Relax, everything is good",
            standardSpanish = "Tómalo con calma / Todo está bien",
            baseExplanation = "Reassuring someone to stay calm and not stress.",
            dialectTranslations = mapOf(
                "es-DO" to DialectDetail(
                    text = "¡Coge'lo suave, manín! 'Ta to' chilling.",
                    phonetic = "[KOH-heh-lo SWAH-veh, mah-NEEN! TAH TOH CHEE-ling.]",
                    ipa = "/ˈkoɡelo ˈswabe maˈniŋ ta to ˈt͡ʃiliŋ/",
                    syllables = listOf("co", "ge", "lo", "sua", "ve", "ta", "to"),
                    tips = listOf(
                        "'Ta to'' means 'está todo' (everything is all good).",
                        "Soft aspirated 'g/j' in 'cogelo'."
                    ),
                    difficulty = DifficultyLevel.HARD
                ),
                "es-PR" to DialectDetail(
                    text = "¡Pichea eso y cógelo suave, corillo!",
                    phonetic = "[pee-CHEH-ah EH-soh ee KOH-geh-loh SWAH-veh, koh-REE-lyoh!]",
                    ipa = "/piˈt͡ʃea ˈeso i ˈkoɡelo ˈswabe koˈɾiʎo/",
                    syllables = listOf("pi", "che", "a", "e", "so", "co", "ri", "llo"),
                    tips = listOf(
                        "'Pichear' means to ignore or let something go.",
                        "'Corillo' means the friend group."
                    ),
                    difficulty = DifficultyLevel.HARD
                ),
                "es-CU" to DialectDetail(
                    text = "¡Tranquilo y sin apuro, asere, no te sofoques!",
                    phonetic = "[trahn-KEE-loh ee seen ah-POO-roh, ah-SEH-reh, noh teh soh-FOH-kehs!]",
                    ipa = "/tɾaŋˈkilo i sin aˈpuɾo aˈseɾe/",
                    syllables = listOf("tran", "qui", "lo", "a", "se", "re", "so", "fo", "ques"),
                    tips = listOf(
                        "'No te sofoques' means don't stress or overheat yourself.",
                        "Fast light Cuban rhythm."
                    ),
                    difficulty = DifficultyLevel.HARD
                ),
                "ht" to DialectDetail(
                    text = "Pran san ou, pa gen pwoblèm ditou!",
                    phonetic = "[PRAHN SAHN oo, PAH gehn pwoh-BLEHM dee-TOO!]",
                    ipa = "/pɾã sã u pa ɡɛ̃ pwoˈblɛm diˈtu/",
                    syllables = listOf("pran", "san", "ou", "pa", "gen", "pwob", "lèm"),
                    tips = listOf(
                        "'Pran san ou' literally means 'take your blood' (stay calm).",
                        "'Pa gen pwoblèm' = no problem."
                    ),
                    difficulty = DifficultyLevel.EXPERT
                ),
                "pap" to DialectDetail(
                    text = "Trankil, poco poco tur cos ta bon!",
                    phonetic = "[trahn-KEEL, POH-koh POH-koh TOOR cohs tah BOHN!]",
                    ipa = "/tɾaŋˈkil ˈpoko ˈpoko tuɾ kos ta bɔn/",
                    syllables = listOf("tran", "kil", "po", "co", "po", "co", "tur", "cos"),
                    tips = listOf(
                        "'Poco poco' = take it step by step, slowly.",
                        "'Tur cos' = everything."
                    ),
                    difficulty = DifficultyLevel.INTERMEDIATE
                ),
                "jam" to DialectDetail(
                    text = "Cool runnings, bredda! Nuh worry yuhself!",
                    phonetic = "[COOL RUN-nings, BREH-dah! nuh WUR-ry yuh-SELF!]",
                    ipa = "/kuːl ˈrʌnɪŋz ˈbɾɛda nʌ ˈwʌɾi jʊˈsɛlf/",
                    syllables = listOf("cool", "run", "nings", "bred", "da"),
                    tips = listOf(
                        "'Cool runnings' means smooth traveling / peace.",
                        "'Nuh' replaces English 'don't'."
                    ),
                    difficulty = DifficultyLevel.HARD
                ),
                "es-HN" to DialectDetail(
                    text = "¡Al suave, maje! Tranquilo vos.",
                    phonetic = "[ahl SWAH-veh, MAH-heh! trahn-KEE-loh VOHS.]",
                    ipa = "/al ˈswabe ˈmaxe tɾaŋˈkilo bos/",
                    syllables = listOf("al", "sua", "ve", "ma", "je", "vos"),
                    tips = listOf(
                        "'Al suave' is the quintessential Honduran chill motto.",
                        "'Maje' is the classic Central American peer address."
                    ),
                    difficulty = DifficultyLevel.INTERMEDIATE
                )
            )
        ),

        PhraseEntry(
            concept = "delicious_food",
            english = "This food is delicious and hits the spot!",
            standardSpanish = "¡Esta comida está deliciosa y exquisita!",
            baseExplanation = "Expressing deep appreciation for good cooking.",
            dialectTranslations = mapOf(
                "es-DO" to DialectDetail(
                    text = "¡Este sancocho con mangú 'tá de película!",
                    phonetic = "[EHS-teh sahn-COH-choh kohn mahn-GOO TAH deh peh-LEE-coo-lah!]",
                    ipa = "/ˈeste saŋˈkot͡ʃo kon maŋˈɡu ta de peˈlikula/",
                    syllables = listOf("san", "co", "cho", "man", "gú", "de", "pe", "lí", "cu", "la"),
                    tips = listOf(
                        "Mangú (mashed plantains) and Sancocho (7-meat stew) are national treasures.",
                        "'De película' = Oscar-worthy delicious."
                    ),
                    difficulty = DifficultyLevel.HARD
                ),
                "es-PR" to DialectDetail(
                    text = "¡Este mofongo con tostones 'tá pa' chuparse los de'os!",
                    phonetic = "[EHS-teh moh-FOHN-goh kohn tohs-TOH-nehs TAH pah choo-PAHR-seh lohs DEH-ohs!]",
                    ipa = "/ˈeste moˈfoŋɡo kon tosˈtones ta pa t͡ʃuˈpaɾse loh ˈde.os/",
                    syllables = listOf("mo", "fon", "go", "tos", "to", "nes", "chu", "par", "se"),
                    tips = listOf(
                        "Drop the 'd' in 'dedos' -> 'de'os'.",
                        "Pronounce 'mofongo' with proud Caribbean warmth."
                    ),
                    difficulty = DifficultyLevel.HARD
                ),
                "ht" to DialectDetail(
                    text = "Manje sa a gou anpil! Diri ak djon djon an bon nèt!",
                    phonetic = "[MAHN-jzhay sah ah GOO ahn-PEEL! DEE-ree ahk jzhon jzhon ahn BOHN NET!]",
                    ipa = "/mãˈʒe sa a ɡu ãˈpil ˈdiɾi ak ʒɔ̃ˈʒɔ̃ ã bɔ̃ nɛt/",
                    syllables = listOf("man", "je", "gou", "di", "ri", "djon", "djon"),
                    tips = listOf(
                        "'Gou anpil' = extremely tasty.",
                        "'Djon djon' is Haitian black mushroom rice with rich flavor."
                    ),
                    difficulty = DifficultyLevel.EXPERT
                ),
                "es-MX" to DialectDetail(
                    text = "¡Estos tacos al pastor están de no mames!",
                    phonetic = "[EHS-tohs TAH-cohs ahl pahs-TOHR ehs-TAHN deh noh MAH-mehs!]",
                    ipa = "/ˈestos ˈtakos al pasˈtoɾ esˈtan de no ˈmames/",
                    syllables = listOf("ta", "cos", "pas", "tor", "no", "ma", "mes"),
                    tips = listOf(
                        "Crisp tacos al pastor reference.",
                        "Stress 'TOR' and 'MA'."
                    ),
                    difficulty = DifficultyLevel.INTERMEDIATE
                ),
                "qu" to DialectDetail(
                    text = "Kay mikunaqa ancha misk'imi kachkan!",
                    phonetic = "[KYE mee-koo-NAH-kah AHN-chah MEES-kee-mee katch-KAHN!]",
                    ipa = "/kaj mikuˈnaqa ˈant͡ʃa misˈkʼimi kat͡ʃˈkan/",
                    syllables = listOf("kay", "mi", "ku", "na", "qa", "mis", "k'i", "mi"),
                    tips = listOf(
                        "'Misk'i' features an ejective k' sound (popped with the glottis).",
                        "'Misk'imi' means deeply sweet and savory."
                    ),
                    difficulty = DifficultyLevel.EXPERT
                ),
                "gn" to DialectDetail(
                    text = "Ko tembi'u heteiterei, heterei!",
                    phonetic = "[KOH tehm-bee-OO heh-tay-ee-tay-RAY-ee!]",
                    ipa = "/ko tembiˈʔu heteiteˈɾej/",
                    syllables = listOf("tem", "bi", "'u", "he", "te", "i", "te", "rei"),
                    tips = listOf(
                        "'Heteiterei' expresses supreme flavor richness in Guaraní.",
                        "Glottal catch between 'bi' and 'u'."
                    ),
                    difficulty = DifficultyLevel.EXPERT
                )
            )
        ),

        PhraseEntry(
            concept = "i_love_you",
            english = "I love you with all my heart",
            standardSpanish = "Te amo con todo mi corazón",
            baseExplanation = "Affectionate statement of deep romantic or familial love.",
            dialectTranslations = mapOf(
                "es-DO" to DialectDetail(
                    text = "¡Te quiero con el alma, tú ere' mi vida entera!",
                    phonetic = "[teh KYEH-roh kohn ehl AHL-mah, too EH-reh mee VEE-dah ehn-TEH-rah!]",
                    ipa = "/te ˈkjeɾo kon el ˈalma tu ˈeɾe mi ˈbida enˈteɾa/",
                    syllables = listOf("te", "quie", "ro", "con", "el", "al", "ma", "mi", "vi", "da"),
                    tips = listOf(
                        "Drop final 's' in 'eres' -> 'ere''.",
                        "Spoken with warm passion and melodic cadence."
                    ),
                    difficulty = DifficultyLevel.HARD
                ),
                "ht" to DialectDetail(
                    text = "Mwen renmen ou ak tout kè mwen!",
                    phonetic = "[MWEN rehn-MEN oo ahk TOOT KAY mwen!]",
                    ipa = "/mwɛ̃ ʁɛ̃ˈmɛ̃ u ak tut kɛ mwɛ̃/",
                    syllables = listOf("mwen", "ren", "men", "ou", "ak", "tout", "kè", "mwen"),
                    tips = listOf(
                        "Nasal vowels 'mwen', 'renmen'.",
                        "'Kè' (heart) is pronounced like open French 'cœur'."
                    ),
                    difficulty = DifficultyLevel.EXPERT
                ),
                "pap" to DialectDetail(
                    text = "Mi ta stima bo cu henter mi curason!",
                    phonetic = "[mee tah STEE-mah boh coo hehn-TEHR mee coo-rah-ZOHN!]",
                    ipa = "/mi ta ˈstima bo ku hɛnˈtɛɾ mi kuɾaˈsɔn/",
                    syllables = listOf("mi", "ta", "sti", "ma", "bo", "cu", "ra", "son"),
                    tips = listOf(
                        "'Stima' comes from Papiamento/Portuguese 'estimar' (to love/cherish).",
                        "Warm island intonation."
                    ),
                    difficulty = DifficultyLevel.HARD
                ),
                "qu" to DialectDetail(
                    text = "Tukuy sunquywanmi munakuyki!",
                    phonetic = "[TOO-kooy soon-KOOY-wahn-mee moo-nah-KOOY-kee!]",
                    ipa = "/tuˈkuj suŋˈqujwanmi munaˈkujki/",
                    syllables = listOf("tu", "kuy", "sun", "quy", "wan", "mu", "na", "kuy", "ki"),
                    tips = listOf(
                        "'Sunquy' means heart, 'munakuyki' means I love you.",
                        "Stress on second to last syllable."
                    ),
                    difficulty = DifficultyLevel.EXPERT
                ),
                "nah" to DialectDetail(
                    text = "Nimitztlazohtla ica nochi noyollotl!",
                    phonetic = "[nee-meets-tlah-zoh-TLAH ee-kah NO-chee no-YOH-yoh-tl!]",
                    ipa = "/ni.mits.t͡ɬa.sohˈt͡ɬa i.ka ˈno.t͡ʃi noˈjo.lːot͡ɬ/",
                    syllables = listOf("ni", "mitz", "tla", "zoh", "tla", "no", "yol", "lotl"),
                    tips = listOf(
                        "'Yollotl' is the ancestral heart symbol.",
                        "End with gentle 'tl' click."
                    ),
                    difficulty = DifficultyLevel.EXPERT
                ),
                "gn" to DialectDetail(
                    text = "Rohayhuitepa che korasõ mbytégui!",
                    phonetic = "[roh-hy-HOO-ee-teh-pah cheh koh-rah-SOH mby-TAY-gwee!]",
                    ipa = "/ɾohaɪ̯hu.iˈtepa ʃe koɾaˈsõ mbeˈteɡwi/",
                    syllables = listOf("ro", "hay", "hu", "che", "ko", "ra", "sõ"),
                    tips = listOf(
                        "'Rohayhu' = I love you in Guaraní.",
                        "Rich melodic throat resonance."
                    ),
                    difficulty = DifficultyLevel.EXPERT
                ),
                "yua" to DialectDetail(
                    text = "In yaabilajech yéetel tuláakal in puksi'ik'al!",
                    phonetic = "[EEN yah-bee-LAH-hech YAY-tehl too-LAH-kahl EEN pook-see-EE-k'ahl!]",
                    ipa = "/in jaːbiˈlahet͡ʃ ˈjeːtel tuˈlaːkal in puksiʔiˈkʼal/",
                    syllables = listOf("in", "yaa", "bi", "la", "jech", "puk", "si'i", "k'al"),
                    tips = listOf(
                        "'Puksi'ik'al' is Maya for heart, with glottal stop and glottalized k'.",
                        "High pitch tone on long double vowels 'aa'."
                    ),
                    difficulty = DifficultyLevel.EXPERT
                )
            )
        )
    )

    // Quick predefined dictionary lookup by words or tokens
    fun translate(
        query: String,
        source: Language,
        target: Language
    ): TranslationResult {
        val trimmed = query.trim()
        if (trimmed.isEmpty()) {
            return generateEmptyResult(source, target)
        }

        // 1. Direct matched phrase
        val matchedEntry = findMatchingPhrase(trimmed)
        if (matchedEntry != null) {
            val targetDetail = matchedEntry.dialectTranslations[target.code]
            if (targetDetail != null) {
                return TranslationResult(
                    sourceText = trimmed,
                    translatedText = targetDetail.text,
                    sourceLanguage = source,
                    targetLanguage = target,
                    phoneticSpelling = targetDetail.phonetic,
                    ipaNotation = targetDetail.ipa,
                    syllables = targetDetail.syllables,
                    literalMeaning = matchedEntry.literalEnglish ?: matchedEntry.english,
                    culturalMeaning = "${matchedEntry.baseExplanation} In ${target.name}, this communicates authentic cultural nuance.",
                    pronunciationTips = targetDetail.tips,
                    alternativeDialects = buildAlternatives(matchedEntry, target.code),
                    difficulty = targetDetail.difficulty
                )
            } else if (target.code == "en") {
                return TranslationResult(
                    sourceText = trimmed,
                    translatedText = matchedEntry.english,
                    sourceLanguage = source,
                    targetLanguage = target,
                    phoneticSpelling = generateEnglishPhonetic(matchedEntry.english),
                    ipaNotation = "/${matchedEntry.english.lowercase(Locale.ROOT)}/",
                    syllables = matchedEntry.english.split(" "),
                    literalMeaning = matchedEntry.literalEnglish,
                    culturalMeaning = matchedEntry.baseExplanation,
                    pronunciationTips = listOf("Standard English pronunciation"),
                    alternativeDialects = buildAlternatives(matchedEntry, "en"),
                    difficulty = DifficultyLevel.EASY
                )
            } else if (target.code == "es") {
                return TranslationResult(
                    sourceText = trimmed,
                    translatedText = matchedEntry.standardSpanish,
                    sourceLanguage = source,
                    targetLanguage = target,
                    phoneticSpelling = generateSpanishPhonetic(matchedEntry.standardSpanish),
                    ipaNotation = "/${matchedEntry.standardSpanish.lowercase(Locale.ROOT)}/",
                    syllables = syllabifySpanish(matchedEntry.standardSpanish),
                    literalMeaning = matchedEntry.english,
                    culturalMeaning = matchedEntry.baseExplanation,
                    pronunciationTips = listOf("Standard neutral Latin American Spanish"),
                    alternativeDialects = buildAlternatives(matchedEntry, "es"),
                    difficulty = DifficultyLevel.EASY
                )
            }
        }

        // 2. Slang and word-by-word dialect rule transformation engine
        return synthesizeDialectTranslation(trimmed, source, target)
    }

    private fun findMatchingPhrase(input: String): PhraseEntry? {
        val lower = input.lowercase(Locale.ROOT).replace(Regex("[¡!¿?,.]"), "").trim()
        for (entry in DICTIONARY) {
            if (lower.contains(entry.concept) ||
                lower.contains(entry.english.lowercase(Locale.ROOT).replace(Regex("[¡!¿?,.]"), "")) ||
                lower.contains(entry.standardSpanish.lowercase(Locale.ROOT).replace(Regex("[¡!¿?,.]"), ""))
            ) {
                return entry
            }
            for ((_, detail) in entry.dialectTranslations) {
                val detailClean = detail.text.lowercase(Locale.ROOT).replace(Regex("[¡!¿?,.]"), "")
                if (lower.contains(detailClean) || detailClean.contains(lower)) {
                    return entry
                }
            }
        }
        return null
    }

    private fun synthesizeDialectTranslation(
        input: String,
        source: Language,
        target: Language
    ): TranslationResult {
        // Dialect rule transformer
        val transformed = applyDialectRules(input, target)
        val phonetics = generatePhoneticsForDialect(transformed, target)
        val ipa = generateIpaForDialect(transformed, target)
        val syllables = syllabify(transformed)
        val tips = getPhoneticTipsForLanguage(target)

        return TranslationResult(
            sourceText = input,
            translatedText = transformed,
            sourceLanguage = source,
            targetLanguage = target,
            phoneticSpelling = phonetics,
            ipaNotation = ipa,
            syllables = syllables,
            literalMeaning = "Dynamic dialect adaptation for '$input'",
            culturalMeaning = "Phonetically and lexically adapted to ${target.name} (${target.region.label}). Rules applied: ${target.phoneticSummary}.",
            pronunciationTips = tips,
            alternativeDialects = generateQuickAlternatives(input, target.code),
            difficulty = target.difficulty
        )
    }

    private fun applyDialectRules(input: String, target: Language): String {
        var text = input.trim()
        when (target.code) {
            "es-DO" -> {
                // Dominican transformations
                text = text.replace(Regex("(?i)\\bestá\\b"), "'tá")
                    .replace(Regex("(?i)\\bestoy\\b"), "'toy")
                    .replace(Regex("(?i)\\bamigo\\b"), "manín")
                    .replace(Regex("(?i)\\bhermano\\b"), "manín")
                    .replace(Regex("(?i)\\bcosa\\b"), "vaina")
                    .replace(Regex("(?i)\\bcasa\\b"), "casa")
                    .replace(Regex("(?i)\\btodo bien\\b"), "ta to'")
                    .replace(Regex("(?i)\\bqué pasa\\b"), "klk")
                    .replace(Regex("(?i)\\bque pasa\\b"), "klk")
                    .replace(Regex("(?i)\\bwhat's up\\b"), "klk")
                    .replace(Regex("(?i)\\bbro\\b"), "manín")
                    .replace(Regex("(?i)\\bcool\\b"), "chévere")
                    .replace(Regex("(?i)ado\\b"), "ao")
                    .replace(Regex("(?i)ada\\b"), "á")
                    .replace(Regex("(?i)para la\\b"), "pa' la")
                    .replace(Regex("(?i)para el\\b"), "pa'l")
            }
            "es-PR" -> {
                // Puerto Rican transformations
                text = text.replace(Regex("(?i)\\bamigo\\b"), "broki")
                    .replace(Regex("(?i)\\bestá\\b"), "'tá")
                    .replace(Regex("(?i)\\bgenial\\b"), "brutal")
                    .replace(Regex("(?i)\\bcool\\b"), "nítido")
                    .replace(Regex("(?i)\\bwhat's up\\b"), "dímelo")
                    .replace(Regex("(?i)\\bbro\\b"), "broki")
                    .replace(Regex("(?i)\\bhermano\\b"), "broki")
                    .replace(Regex("(?i)\\bfiesta\\b"), "jangueo")
                    .replace(Regex("(?i)para\\b"), "pa'")
                    .replace(Regex("(?i)r(?=[bcdfghjklmnpqstvwxyz])"), "l") // Lambdacism
            }
            "es-CU" -> {
                // Cuban transformations
                text = text.replace(Regex("(?i)\\bamigo\\b"), "asere")
                    .replace(Regex("(?i)\\bhermano\\b"), "ecobio")
                    .replace(Regex("(?i)\\bqué tal\\b"), "¿qué bolá?")
                    .replace(Regex("(?i)\\bwhat's up\\b"), "¿qué bolá asere?")
                    .replace(Regex("(?i)\\btrabajo\\b"), "pincha")
                    .replace(Regex("(?i)\\bdinero\\b"), "baro")
                    .replace(Regex("(?i)\\bautobús\\b"), "guagua")
                    .replace(Regex("(?i)ado\\b"), "ao")
            }
            "ht" -> {
                // Haitian Creole approximate mappings
                text = text.replace(Regex("(?i)\\bhola\\b|\\bhello\\b"), "Bonjou")
                    .replace(Regex("(?i)\\bgracias\\b|\\bthanks\\b"), "Mèsi anpil")
                    .replace(Regex("(?i)\\bamigo\\b|\\bfriend\\b"), "Monchè")
                    .replace(Regex("(?i)\\bhow are you\\b|\\bcómo estás\\b"), "Kijan ou ye?")
                    .replace(Regex("(?i)\\bwhat's up\\b"), "Sak pase?")
                    .replace(Regex("(?i)\\bi love you\\b|\\bte amo\\b"), "Mwen renmen ou")
                    .replace(Regex("(?i)\\bgood\\b|\\bbien\\b"), "Bon")
            }
            "pap" -> {
                // Papiamento transformations
                text = text.replace(Regex("(?i)\\bhola\\b|\\bhello\\b"), "Bon bini")
                    .replace(Regex("(?i)\\bgracias\\b|\\bthanks\\b"), "Danki hopi")
                    .replace(Regex("(?i)\\bamigo\\b|\\bfriend\\b"), "Fren")
                    .replace(Regex("(?i)\\bcariño\\b|\\bsweet\\b"), "Dushi")
                    .replace(Regex("(?i)\\bhow are you\\b|\\bcómo estás\\b"), "Con ta bai?")
                    .replace(Regex("(?i)\\bmuy bien\\b|\\bvery good\\b"), "Hopi bon")
            }
            "jam" -> {
                // Jamaican Patois
                text = text.replace(Regex("(?i)\\bhello\\b|\\bhola\\b"), "Wah gwaan")
                    .replace(Regex("(?i)\\bfriend\\b|\\bamigo\\b"), "Bredren")
                    .replace(Regex("(?i)\\bthanks\\b|\\bgracias\\b"), "Give thanks")
                    .replace(Regex("(?i)\\bi am good\\b"), "Mi deh yah")
                    .replace(Regex("(?i)\\beverything is good\\b"), "Everything irie")
            }
            "es-MX" -> {
                // Mexican slang
                text = text.replace(Regex("(?i)\\bamigo\\b"), "güey")
                    .replace(Regex("(?i)\\bhermano\\b"), "carnal")
                    .replace(Regex("(?i)\\bgenial\\b"), "chido")
                    .replace(Regex("(?i)\\bqué tal\\b"), "¿qué onda?")
                    .replace(Regex("(?i)\\btrabajo\\b"), "chamba")
                    .replace(Regex("(?i)\\bde verdad\\b"), "la neta")
            }
            "es-CO-carib" -> {
                // Colombian Costeño
                text = text.replace(Regex("(?i)\\bamigo\\b"), "cuadro")
                    .replace(Regex("(?i)\\bgenial\\b"), "bacano")
                    .replace(Regex("(?i)\\bqué tal\\b"), "¡ajá!")
                    .replace(Regex("(?i)\\bcosa\\b"), "vaina")
            }
            "es-CL" -> {
                // Chilean
                text = text.replace(Regex("(?i)\\bentendiste\\b"), "¿cachai?")
                    .replace(Regex("(?i)\\bamigo\\b"), "weón")
                    .replace(Regex("(?i)\\bgenial\\b"), "bacán")
                    .replace(Regex("(?i)\\brápido\\b"), "al tiro")
                    .replace(Regex("(?i)\\bnovio\\b"), "pololo")
            }
            "qu" -> {
                text = text.replace(Regex("(?i)\\bhola\\b|\\bhello\\b"), "Allillanchu")
                    .replace(Regex("(?i)\\bgracias\\b|\\bthanks\\b"), "Sulpayki")
                    .replace(Regex("(?i)\\bamigo\\b"), "Wauqiy")
                    .replace(Regex("(?i)\\badiós\\b|\\bgoodbye\\b"), "Tupananchiskama")
            }
            "nah" -> {
                text = text.replace(Regex("(?i)\\bhola\\b|\\bhello\\b"), "Niltze")
                    .replace(Regex("(?i)\\bgracias\\b|\\bthanks\\b"), "Tlazohcamati")
                    .replace(Regex("(?i)\\bbuenos días\\b"), "Cualli tonalli")
            }
            "gn" -> {
                text = text.replace(Regex("(?i)\\bhola\\b|\\bhello\\b"), "Mba'eichapa")
                    .replace(Regex("(?i)\\bgracias\\b|\\bthanks\\b"), "Aguyje")
                    .replace(Regex("(?i)\\bmuy bien\\b"), "Iporãite")
            }
            else -> {}
        }
        return text
    }

    private fun generatePhoneticsForDialect(text: String, target: Language): String {
        val words = text.split(" ")
        val phoneticsList = words.map { word ->
            val clean = word.replace(Regex("[^a-zA-ZáéíóúÁÉÍÓÚñÑüÜ'\\-]"), "")
            if (clean.isEmpty()) return@map word
            when (target.code) {
                "es-DO" -> "[${clean.uppercase(Locale.ROOT).replace("S", "h").replace("LL", "Y")}]"
                "es-PR" -> "[${clean.uppercase(Locale.ROOT).replace("R", "L").replace("S", "h")}]"
                "ht" -> "[${clean.uppercase(Locale.ROOT).replace("OU", "OO").replace("AN", "AHN")}]"
                "pap" -> "[${clean.uppercase(Locale.ROOT).replace("SH", "SH").replace("CH", "CH")}]"
                "jam" -> "[${clean.uppercase(Locale.ROOT).replace("TH", "D")}]"
                "qu" -> "[${clean.uppercase(Locale.ROOT).replace("Q", "K").replace("LL", "Y")}]"
                "nah" -> "[${clean.uppercase(Locale.ROOT).replace("TL", "TLAH")}]"
                "gn" -> "[${clean.uppercase(Locale.ROOT).replace("'", "·")}]"
                else -> "[${clean.uppercase(Locale.ROOT)}]"
            }
        }
        return phoneticsList.joinToString(" ")
    }

    private fun generateIpaForDialect(text: String, target: Language): String {
        val clean = text.lowercase(Locale.ROOT).replace(Regex("[¡!¿?,.]"), "")
        return when (target.code) {
            "es-DO" -> "/${clean.replace("s", "h").replace("r", "ɾ")}/"
            "es-PR" -> "/${clean.replace("r", "l").replace("s", "h")}/"
            "ht" -> "/${clean.replace("ou", "u").replace("an", "ã")}/"
            "es-CU" -> "/${clean.replace("r", "l")}/"
            "qu" -> "/${clean.replace("ll", "ʎ")}/"
            "nah" -> "/${clean.replace("tl", "t͡ɬ")}/"
            "gn" -> "/${clean.replace("'", "ʔ")}/"
            else -> "/$clean/"
        }
    }

    private fun syllabify(text: String): List<String> {
        val clean = text.replace(Regex("[¡!¿?,.]"), "")
        val words = clean.split(" ").filter { it.isNotBlank() }
        val result = mutableListOf<String>()
        for (w in words) {
            if (w.length <= 3) {
                result.add(w.uppercase(Locale.ROOT))
            } else {
                val half = w.length / 2
                result.add(w.substring(0, half).uppercase(Locale.ROOT))
                result.add(w.substring(half).uppercase(Locale.ROOT))
            }
        }
        return result
    }

    private fun syllabifySpanish(text: String): List<String> {
        return syllabify(text)
    }

    private fun generateEnglishPhonetic(text: String): String {
        return "[${text.uppercase(Locale.ROOT)}]"
    }

    private fun generateSpanishPhonetic(text: String): String {
        return "[${text.uppercase(Locale.ROOT)}]"
    }

    private fun getPhoneticTipsForLanguage(target: Language): List<String> {
        return when (target.code) {
            "es-DO" -> listOf(
                "Final 's' is aspirated or completely silent (e.g., 'gracia' instead of 'gracias').",
                "Drop 'd' between vowels (e.g., 'cansado' -> 'cansao').",
                "Fast, syncopated rhythm like merengue or bachata."
            )
            "es-PR" -> listOf(
                "Lambdacism: Replace 'r' before consonants with 'l' ('Puelto Lico').",
                "Soft aspiration of syllable-final 's'.",
                "Sing-song melodic tone rise at sentence midpoints."
            )
            "es-CU" -> listOf(
                "Gemination: consonants right after 'r' sound duplicated ('porque' -> 'poqque').",
                "High-pitch expressive cadence.",
                "Short and tight vowel articulations."
            )
            "ht" -> listOf(
                "Nasalize vowels ending in 'n' (an, en, on).",
                "'Ou' is pronounced like 'oo' in 'boot'.",
                "No gender agreements on adjectives, follow rhythmic beat."
            )
            "pap" -> listOf(
                "'Dushi' sounds like 'DOO-shee' (meaning sweet/darling).",
                "Vowels are rich, influenced by Portuguese and Papiamento tonal roots.",
                "Smooth rhythmic island cadence."
            )
            "jam" -> listOf(
                "Replace 'th' with 'd' or 't' ('the' -> 'di', 'thing' -> 'ting').",
                "Vowel rounding: 'man' -> 'mahn', 'gwaan' -> 'gwahn'.",
                "Dynamic reggae cadence."
            )
            "qu" -> listOf(
                "Stress almost always falls on the second-to-last syllable.",
                "Distinctive ejective consonants (k', p', t') made with brief breath holding.",
                "Suffixes combine logically onto word stems."
            )
            "nah" -> listOf(
                "The lateral affricate 'tl' is pronounced by releasing breath on sides of tongue.",
                "Vowels have long and short acoustic lengths.",
                "Stress falls on the penultimate syllable."
            )
            "gn" -> listOf(
                "Puso (') is a sharp glottal stop in the vocal cords.",
                "Tildes (~) over vowels create nasal vocal resonance.",
                "Flowing musical Guarani cadence."
            )
            else -> listOf(
                "Pronounce vowels clearly and openly: A [ah], E [eh], I [ee], O [oh], U [oo].",
                "Listen to the native voice guide for intonation details."
            )
        }
    }

    private fun buildAlternatives(entry: PhraseEntry, excludeCode: String): List<RegionalAlternative> {
        val list = mutableListOf<RegionalAlternative>()
        for ((code, detail) in entry.dialectTranslations) {
            if (code != excludeCode) {
                val lang = SupportedLanguages.getByCode(code)
                list.add(
                    RegionalAlternative(
                        regionName = lang.name,
                        flag = lang.flag,
                        phrase = detail.text,
                        phonetic = detail.phonetic
                    )
                )
            }
        }
        return list.take(6)
    }

    private fun generateQuickAlternatives(input: String, excludeCode: String): List<RegionalAlternative> {
        val targets = listOf("es-DO", "es-PR", "es-CU", "ht", "es-MX", "jam")
            .filter { it != excludeCode }
            .take(4)

        return targets.map { code ->
            val lang = SupportedLanguages.getByCode(code)
            val translated = applyDialectRules(input, lang)
            val phonetic = generatePhoneticsForDialect(translated, lang)
            RegionalAlternative(
                regionName = lang.name,
                flag = lang.flag,
                phrase = translated,
                phonetic = phonetic
            )
        }
    }

    private fun generateEmptyResult(source: Language, target: Language): TranslationResult {
        return TranslationResult(
            sourceText = "",
            translatedText = "",
            sourceLanguage = source,
            targetLanguage = target,
            phoneticSpelling = "",
            ipaNotation = "",
            culturalMeaning = "",
            pronunciationTips = emptyList(),
            alternativeDialects = emptyList()
        )
    }
}
