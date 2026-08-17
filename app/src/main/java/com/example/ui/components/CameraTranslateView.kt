package com.example.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.FlashOn
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.data.model.Language

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CameraTranslateView(
    sourceLanguage: Language,
    targetLanguage: Language,
    onClose: () -> Unit,
    onTextExtracted: (String) -> Unit,
    onSpeak: (String, String) -> Unit,
    modifier: Modifier = Modifier
) {
    var detectedSampleIndex by remember { mutableStateOf(0) }
    var isFlashOn by remember { mutableStateOf(false) }

    val sampleScannedSigns = listOf(
        "¡Bienvenido! Prohibido parquear aquí mi gente." to "Welcome! No parking here, folks.",
        "Menú del día: Mofongo con camarones y tostones." to "Daily Special: Mofongo with shrimp and fried plantains.",
        "Aviso: La guagua pasa cada media hora." to "Notice: The bus passes every half hour.",
        "Oferta especial: Aguacates criollos a 2 por 5." to "Special Offer: Fresh local avocados, 2 for 5."
    )

    val currentScan = sampleScannedSigns[detectedSampleIndex % sampleScannedSigns.size]

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(Color(0xFF0F1414))
    ) {
        // Viewfinder simulation
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(20.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            // Top Action Bar
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 16.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(
                    onClick = onClose,
                    modifier = Modifier
                        .size(44.dp)
                        .clip(CircleShape)
                        .background(Color(0x66000000))
                        .testTag("camera_back_button")
                ) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                        contentDescription = "Back",
                        tint = Color.White
                    )
                }

                Surface(
                    shape = RoundedCornerShape(20.dp),
                    color = Color(0x991E2424)
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "${sourceLanguage.flag} ${sourceLanguage.name}  ➔  ${targetLanguage.flag} ${targetLanguage.name}",
                            style = MaterialTheme.typography.labelMedium,
                            fontWeight = FontWeight.Bold,
                            color = Color.White
                        )
                    }
                }

                IconButton(
                    onClick = { isFlashOn = !isFlashOn },
                    modifier = Modifier
                        .size(44.dp)
                        .clip(CircleShape)
                        .background(if (isFlashOn) Color(0xFFF9AB00) else Color(0x66000000))
                        .testTag("camera_flash_button")
                ) {
                    Icon(
                        imageVector = Icons.Default.FlashOn,
                        contentDescription = "Flash",
                        tint = if (isFlashOn) Color.Black else Color.White
                    )
                }
            }

            Spacer(modifier = Modifier.weight(1f))

            // Scanner Targeting Frame
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(280.dp)
                    .clip(RoundedCornerShape(24.dp))
                    .border(2.dp, Color(0xFF00E5BF), RoundedCornerShape(24.dp))
                    .background(Color(0x33102020)),
                contentAlignment = Alignment.Center
            ) {
                Column(
                    modifier = Modifier.padding(20.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Surface(
                        shape = RoundedCornerShape(12.dp),
                        color = Color(0xDD000000),
                        modifier = Modifier.padding(bottom = 12.dp)
                    ) {
                        Text(
                            text = "Instant Dialect OCR Scanner",
                            style = MaterialTheme.typography.labelSmall,
                            color = Color(0xFF00E5BF),
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp)
                        )
                    }

                    // Scanned overlay
                    Surface(
                        shape = RoundedCornerShape(16.dp),
                        color = Color(0xEE1E2828),
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable {
                                onTextExtracted(currentScan.first)
                            }
                    ) {
                        Column(modifier = Modifier.padding(14.dp)) {
                            Text(
                                text = "Detected: \"${currentScan.first}\"",
                                style = MaterialTheme.typography.bodyMedium,
                                color = Color(0xFFE3E3E3),
                                fontWeight = FontWeight.SemiBold
                            )
                            Spacer(modifier = Modifier.height(6.dp))
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = "➔ ${currentScan.second}",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = Color(0xFF4DE1D5),
                                    fontWeight = FontWeight.Bold,
                                    modifier = Modifier.weight(1f)
                                )
                                IconButton(
                                    onClick = {
                                        onSpeak(currentScan.second, targetLanguage.code)
                                    },
                                    modifier = Modifier.size(32.dp)
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.VolumeUp,
                                        contentDescription = "Speak",
                                        tint = Color(0xFF4DE1D5),
                                        modifier = Modifier.size(18.dp)
                                    )
                                }
                            }
                        }
                    }

                    Spacer(modifier = Modifier.height(10.dp))
                    Text(
                        text = "Tap box to import to translator • Point at text or signs",
                        style = MaterialTheme.typography.labelSmall,
                        color = Color(0xAAFFFFFF)
                    )
                }
            }

            Spacer(modifier = Modifier.weight(1f))

            // Bottom Shutter Controls
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 32.dp),
                horizontalArrangement = Arrangement.SpaceEvenly,
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Import / Gallery
                IconButton(
                    onClick = {
                        detectedSampleIndex++
                    },
                    modifier = Modifier
                        .size(52.dp)
                        .clip(CircleShape)
                        .background(Color(0xFF222B2B))
                        .testTag("camera_sample_next_btn")
                ) {
                    Icon(
                        imageVector = Icons.Default.Image,
                        contentDescription = "Next sample image",
                        tint = Color.White
                    )
                }

                // Main Shutter Button
                Box(
                    modifier = Modifier
                        .size(80.dp)
                        .clip(CircleShape)
                        .border(4.dp, Color.White, CircleShape)
                        .padding(6.dp)
                        .clip(CircleShape)
                        .background(Color(0xFF00E5BF))
                        .clickable {
                            onTextExtracted(currentScan.first)
                        }
                        .testTag("camera_shutter_button"),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.CameraAlt,
                        contentDescription = "Capture",
                        tint = Color(0xFF003732),
                        modifier = Modifier.size(36.dp)
                    )
                }

                // Sample Cycle Button
                IconButton(
                    onClick = {
                        detectedSampleIndex++
                    },
                    modifier = Modifier
                        .size(52.dp)
                        .clip(CircleShape)
                        .background(Color(0xFF222B2B))
                ) {
                    Text("Sample", fontSize = 11.sp, color = Color.White, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}
