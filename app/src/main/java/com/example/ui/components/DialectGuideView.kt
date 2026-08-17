package com.example.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.ui.viewmodel.AppMode
import com.example.ui.viewmodel.TranslatorViewModel

data class PhoneticPhenomenon(
    val title: String,
    val flag: String,
    val region: String,
    val ruleDescription: String,
    val sampleWord: String,
    val phoneticSpelling: String,
    val standardEquivalent: String,
    val localeCode: String
)

@Composable
fun DialectGuideView(
    viewModel: TranslatorViewModel,
    modifier: Modifier = Modifier
) {
    val phenomena = listOf(
        PhoneticPhenomenon(
            title = "Dominican S-Elision & Aspiration",
            flag = "🇩🇴",
            region = "Dominican Republic",
            ruleDescription = "Syllable-final /s/ is completely dropped or pronounced as a light exhale breath. '¿Cómo estás tú?' becomes '¿Cómo tú 'tá?'.",
            sampleWord = "¡Lo' muchacho' 'tán cansao'!",
            phoneticSpelling = "[loh moo-CHAH-choh TAHN kahn-SAO!]",
            standardEquivalent = "¡Los muchachos están cansados!",
            localeCode = "es"
        ),
        PhoneticPhenomenon(
            title = "Dropping the Intervocalic 'D'",
            flag = "🇩🇴",
            region = "Dominican Republic",
            ruleDescription = "The letter 'd' between vowels (especially in -ado / -ido) is completely omitted: 'cansado' -> 'cansao', 'desbaratado' -> 'desbaratao'.",
            sampleWord = "Toy desbaratao de tanto trabajá",
            phoneticSpelling = "[TOY dehs-bah-rah-TAO deh TAHN-toh trah-bah-HAH]",
            standardEquivalent = "Estoy agotado de tanto trabajar",
            localeCode = "es"
        ),
        PhoneticPhenomenon(
            title = "Cibaeño 'I' Vocalization (Iotaización)",
            flag = "🇩🇴",
            region = "Cibao Region (Santiago / La Vega)",
            ruleDescription = "In the Northern Cibao region, the letters 'R' and 'L' before another consonant turn into an 'i' sound: 'por favor' -> 'poi favoi', 'carne' -> 'caine'.",
            sampleWord = "Poi favoi pásame la caine",
            phoneticSpelling = "[POY fah-VOY PAH-sah-meh lah KYE-neh]",
            standardEquivalent = "Por favor pásame la carne",
            localeCode = "es"
        ),
        PhoneticPhenomenon(
            title = "Velarized Final 'N' (-ng Sound)",
            flag = "🇩🇴",
            region = "Dominican Republic",
            ruleDescription = "Word-final 'n' is articulated in the back of the throat like an English '-ng': 'manín' sounds like [ma-neeng], 'corazón' sounds like [co-ra-zohng].",
            sampleWord = "¡Klk manín, de lo mío!",
            phoneticSpelling = "[kay-el-KAY mah-NEENG, deh loh MEE-oh!]",
            standardEquivalent = "¿Qué tal hermano, mi gente cercana!",
            localeCode = "es"
        ),
        PhoneticPhenomenon(
            title = "Signature Particle: 'Dique' & 'Vaina'",
            flag = "🇩🇴",
            region = "Dominican Republic",
            ruleDescription = "'Dique' expresses skepticism or 'allegedly / so they say'. 'Vaina' is the universal word for any object, situation, or thing.",
            sampleWord = "Dique que él no vio esa vaina",
            phoneticSpelling = "[DEE-kay kay el noh bee-OH EH-sah VYE-nah]",
            standardEquivalent = "Supuestamente él no vio esa cosa",
            localeCode = "es"
        )
    )

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(16.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(
                onClick = { viewModel.setMode(AppMode.TRANSLATE) },
                modifier = Modifier.testTag("guide_back_btn")
            ) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = "Back to Translator"
                )
            }
            Column(modifier = Modifier.padding(start = 4.dp)) {
                Text(
                    text = "Dominican Pronunciation Guide 🇩🇴",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface
                )
                Text(
                    text = "Authentic Dominican vernacular & phonetics (English ⇄ Dominican)",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary
                )
            }
        }

        Spacer(modifier = Modifier.height(14.dp))

        LazyColumn(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            items(phenomena) { item ->
                PhenomenonCard(
                    phenomenon = item,
                    onPlay = {
                        viewModel.speakText(item.sampleWord, item.localeCode)
                    }
                )
            }
        }
    }
}

@Composable
private fun PhenomenonCard(
    phenomenon: PhoneticPhenomenon,
    onPlay: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(text = phenomenon.flag, fontSize = 20.sp, modifier = Modifier.padding(end = 8.dp))
                    Column {
                        Text(
                            text = phenomenon.title,
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                        Text(
                            text = phenomenon.region,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.primary
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = phenomenon.ruleDescription,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                lineHeight = 18.sp
            )

            Spacer(modifier = Modifier.height(10.dp))

            // Sample Box
            Surface(
                shape = RoundedCornerShape(12.dp),
                color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.35f),
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = phenomenon.sampleWord,
                            style = MaterialTheme.typography.bodyLarge,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                        Text(
                            text = phenomenon.phoneticSpelling,
                            style = MaterialTheme.typography.labelSmall,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.tertiary
                        )
                        Text(
                            text = "= ${phenomenon.standardEquivalent}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            fontSize = 11.sp
                        )
                    }

                    FilledTonalButton(
                        onClick = onPlay,
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.filledTonalButtonColors(
                            containerColor = MaterialTheme.colorScheme.primary,
                            contentColor = Color.White
                        ),
                        modifier = Modifier.testTag("guide_play_btn_${phenomenon.title.take(6)}")
                    ) {
                        Icon(imageVector = Icons.Default.VolumeUp, contentDescription = "Play Audio", modifier = Modifier.size(16.dp))
                    }
                }
            }
        }
    }
}
