"""
Emotera AI — Emotion Expansion Layer

Expands the 4 base emotions (happy, sad, angry, neutral) from the core
classifier into a richer set of 50+ nuanced emotions using:

  1. Acoustic feature signals (pitch, energy, tempo, ZCR)
  2. Transcript keyword analysis (from Whisper output)
  3. Base-emotion confidence score

This module is imported by app.py and called AFTER predict_emotion()
to produce the final expanded emotion without altering any existing
classification logic.
"""

import logging
from typing import Optional

logger = logging.getLogger("emotera-ml")

# ═══════════════════════════════════════════════════════════════
#  EXPANSION MAP — base emotion → possible expanded emotions
# ═══════════════════════════════════════════════════════════════

EXPANSION_MAP = {
    "happy": [
        "joy", "excited", "love", "proud", "playful",
        "grateful", "motivated", "amused", "content",
        "energetic", "confident", "inspired", "romantic",
    ],
    "sad": [
        "lonely", "heartbroken", "regretful", "tired",
        "nostalgic", "bored", "guilty", "ashamed",
        "hopeful", "peaceful",
    ],
    "angry": [
        "frustrated", "aggressive", "stressed", "jealous",
        "overwhelmed", "disgusted", "embarrassed", "determined",
    ],
    "neutral": [
        "calm", "relaxed", "content", "serene", "confused",
        "curious", "alert", "doubtful", "shy", "trusting",
        "secure", "peaceful",
    ],
}

# ═══════════════════════════════════════════════════════════════
#  KEYWORD → EMOTION MAPPING  (from Whisper transcript)
# ═══════════════════════════════════════════════════════════════

# Each entry: (keyword/phrase, target_emotion, score_boost)
# Processed in order — first match wins per emotion, but multiple
# emotions can accumulate score.

KEYWORD_RULES: list[tuple[list[str], str, float]] = [
    # ── Gratitude / appreciation ──
    (["thank you", "thanks", "appreciate", "grateful", "thankful"], "grateful", 0.35),

    # ── Guilt / apology ──
    (["sorry", "apologize", "forgive me", "my fault", "my bad"], "guilty", 0.35),
    (["i apologize", "pardon me"], "ashamed", 0.25),

    # ── Confusion ──
    (["confused", "don't understand", "what do you mean", "why is this happening",
      "makes no sense", "i don't get it"], "confused", 0.35),

    # ── Fear / anxiety ──
    (["scared", "i'm scared", "afraid", "fear", "terrified", "panic",
      "frightened", "anxious", "nervous", "worried"], "fear", 0.35),
    (["worried", "what if", "i'm not sure", "uneasy"], "anxious", 0.30),
    (["nervous", "butterflies", "on edge"], "nervous", 0.30),

    # ── Anger / frustration ──
    (["hate", "i hate", "sick of", "fed up", "furious", "outrageous"], "angry", 0.30),
    (["frustrated", "annoying", "irritating", "ridiculous"], "frustrated", 0.35),
    (["how dare", "unacceptable", "disgusting"], "aggressive", 0.30),

    # ── Love / romance ──
    (["love you", "i love", "adore", "miss you", "my heart"], "love", 0.35),
    (["romantic", "darling", "sweetheart", "baby"], "romantic", 0.30),

    # ── Excitement ──
    (["excited", "amazing", "awesome", "incredible", "can't wait",
      "so happy", "best ever", "fantastic", "wonderful"], "excited", 0.35),

    # ── Motivation / determination ──
    (["let's go", "i can do", "never give up", "keep going", "push through",
      "motivated", "determined", "i will"], "motivated", 0.30),
    (["determined", "no matter what", "i must"], "determined", 0.30),

    # ── Pride / confidence ──
    (["proud", "accomplished", "nailed it", "i did it", "achieved"], "proud", 0.30),
    (["confident", "i'm sure", "i know", "believe in myself"], "confident", 0.30),

    # ── Loneliness ──
    (["alone", "lonely", "no one", "nobody", "by myself", "all alone"], "lonely", 0.35),

    # ── Tiredness / boredom ──
    (["tired", "exhausted", "sleepy", "drained", "fatigued"], "tired", 0.35),
    (["bored", "boring", "nothing to do", "dull", "tedious"], "bored", 0.30),

    # ── Nostalgia ──
    (["remember", "those days", "back then", "used to", "good old",
      "miss those", "childhood"], "nostalgic", 0.30),

    # ── Surprise ──
    (["oh my", "wow", "unbelievable", "no way", "seriously", "really",
      "oh god", "what the"], "surprise", 0.30),

    # ── Curiosity ──
    (["curious", "i wonder", "interesting", "tell me more",
      "how does", "why does"], "curious", 0.30),

    # ── Playfulness ──
    (["haha", "lol", "funny", "hilarious", "joke", "kidding",
      "just playing", "messing around"], "playful", 0.30),
    (["haha", "lol", "so funny", "hilarious", "cracking up"], "amused", 0.30),

    # ── Calm / peace ──
    (["calm", "peaceful", "at peace", "tranquil", "serene",
      "it's okay", "all good"], "calm", 0.25),
    (["relaxed", "chill", "no worries", "laid back"], "relaxed", 0.25),

    # ── Jealousy ──
    (["jealous", "envious", "not fair", "why them", "wish i had"], "jealous", 0.30),

    # ── Stress ──
    (["stressed", "pressure", "too much", "can't handle",
      "overwhelmed", "breaking down"], "stressed", 0.35),
    (["overwhelmed", "drowning", "too much going on"], "overwhelmed", 0.30),

    # ── Regret ──
    (["regret", "shouldn't have", "wish i hadn't", "mistake", "if only"], "regretful", 0.30),

    # ── Hope ──
    (["hope", "hopefully", "praying", "fingers crossed", "wish",
      "looking forward", "optimistic"], "hopeful", 0.30),

    # ── Trust / security ──
    (["trust", "i trust", "rely on", "depend on", "faith in"], "trusting", 0.25),
    (["safe", "secure", "protected", "taken care of"], "secure", 0.25),

    # ── Inspiration ──
    (["inspired", "inspiring", "moved", "touched", "beautiful"], "inspired", 0.30),

    # ── Heartbreak ──
    (["heartbroken", "broke my heart", "devastated", "crushed", "shattered"], "heartbroken", 0.35),

    # ── Embarrassment ──
    (["embarrassed", "embarrassing", "awkward", "cringe", "humiliated"], "embarrassed", 0.30),

    # ── Shyness ──
    (["shy", "timid", "quiet", "introverted"], "shy", 0.25),

    # ── Alertness ──
    (["alert", "watch out", "careful", "heads up", "beware", "warning"], "alert", 0.30),

    # ── Doubt ──
    (["doubt", "doubtful", "not sure", "uncertain", "skeptical", "hard to believe"], "doubtful", 0.30),
]


# ═══════════════════════════════════════════════════════════════
#  ACOUSTIC FEATURE RULES
# ═══════════════════════════════════════════════════════════════

def _score_from_features(features: dict) -> dict[str, float]:
    """
    Produce emotion-score adjustments based on acoustic features.
    Returns a dict of {emotion: score_delta} (can be positive only).
    """
    scores: dict[str, float] = {}

    pitch = features.get("pitch_mean", 0.0)
    pitch_std = features.get("pitch_std", 0.0)
    energy = features.get("energy_mean", 0.0)
    energy_max = features.get("energy_max", 0.0)
    zcr = features.get("zcr_mean", 0.0)
    spectral = features.get("spectral_centroid_mean", 0.0)

    # ── High pitch + high energy → excited / energetic ──
    if pitch > 250 and energy > 0.06:
        scores["excited"] = scores.get("excited", 0) + 0.25
        scores["energetic"] = scores.get("energetic", 0) + 0.20

    # ── Very high pitch + very high energy → aggressive ──
    if pitch > 320 and energy > 0.10:
        scores["aggressive"] = scores.get("aggressive", 0) + 0.20

    # ── Low pitch + low energy → tired / sad / bored ──
    if pitch < 130 and energy < 0.025:
        scores["tired"] = scores.get("tired", 0) + 0.25
        scores["bored"] = scores.get("bored", 0) + 0.15

    # ── Very low energy → lonely / peaceful ──
    if energy < 0.015:
        scores["lonely"] = scores.get("lonely", 0) + 0.15
        scores["peaceful"] = scores.get("peaceful", 0) + 0.10

    # ── High zero-crossing rate → frustrated / angry ──
    if zcr > 0.10:
        scores["frustrated"] = scores.get("frustrated", 0) + 0.20
        scores["stressed"] = scores.get("stressed", 0) + 0.15

    # ── Very low ZCR + moderate energy → calm / serene ──
    if zcr < 0.035 and 0.02 < energy < 0.06:
        scores["calm"] = scores.get("calm", 0) + 0.25
        scores["serene"] = scores.get("serene", 0) + 0.15
        scores["relaxed"] = scores.get("relaxed", 0) + 0.15

    # ── High pitch variability → playful / amused ──
    if pitch_std > 60:
        scores["playful"] = scores.get("playful", 0) + 0.15
        scores["amused"] = scores.get("amused", 0) + 0.10
        scores["surprised"] = scores.get("surprised", 0) + 0.10

    # ── Very low pitch variability → determined / content ──
    if pitch_std < 12 and energy > 0.03:
        scores["determined"] = scores.get("determined", 0) + 0.15
        scores["content"] = scores.get("content", 0) + 0.10

    # ── High spectral centroid → alert / energetic ──
    if spectral > 2500:
        scores["alert"] = scores.get("alert", 0) + 0.15
        scores["energetic"] = scores.get("energetic", 0) + 0.10

    # ── Low spectral centroid → nostalgic / tired ──
    if spectral < 1200:
        scores["nostalgic"] = scores.get("nostalgic", 0) + 0.10
        scores["tired"] = scores.get("tired", 0) + 0.10

    # ── Moderate everything → neutral-family ──
    if 140 < pitch < 240 and 0.025 < energy < 0.06 and 0.03 < zcr < 0.08:
        scores["calm"] = scores.get("calm", 0) + 0.10
        scores["content"] = scores.get("content", 0) + 0.10

    return scores


# ═══════════════════════════════════════════════════════════════
#  KEYWORD ANALYSIS
# ═══════════════════════════════════════════════════════════════

def keyword_analysis(text: str) -> dict[str, float]:
    """
    Scan transcript text for emotion-indicating keywords.
    Returns a dict of {emotion: accumulated_score}.
    """
    if not text:
        return {}

    text_lower = text.lower().strip()
    scores: dict[str, float] = {}
    matched_emotions: set[str] = set()

    for phrases, target_emotion, boost in KEYWORD_RULES:
        # Only take the first matching rule per emotion to avoid
        # double-counting similar phrases for the same target.
        if target_emotion in matched_emotions:
            continue
        for phrase in phrases:
            if phrase in text_lower:
                scores[target_emotion] = scores.get(target_emotion, 0) + boost
                matched_emotions.add(target_emotion)
                break  # Move to next rule

    return scores


# ═══════════════════════════════════════════════════════════════
#  MAIN EXPANSION FUNCTION
# ═══════════════════════════════════════════════════════════════

def expand_emotion(
    base_emotion: str,
    confidence: float,
    features: Optional[dict] = None,
    transcript: Optional[str] = None,
) -> dict:
    """
    Expand a base emotion into a richer nuanced emotion.

    Parameters
    ----------
    base_emotion : str
        One of "happy", "sad", "angry", "neutral" from the core model.
    confidence : float
        Model confidence as a percentage (0-100).
    features : dict, optional
        Acoustic features extracted by extract_features() in app.py.
    transcript : str, optional
        Whisper transcription text for keyword analysis.

    Returns
    -------
    dict
        {
            "emotion": "frustrated",       # expanded emotion
            "base_emotion": "angry",        # original base emotion
            "confidence": 82.3              # adjusted confidence
        }
    """
    base = base_emotion.lower().strip()

    # Gather valid expansion candidates for this base emotion
    candidates = EXPANSION_MAP.get(base, [])

    # Start with scores seeded from acoustic features
    feature_scores: dict[str, float] = {}
    if features:
        feature_scores = _score_from_features(features)

    # Add keyword scores
    keyword_scores: dict[str, float] = {}
    if transcript:
        keyword_scores = keyword_analysis(transcript)

    # ── Build combined scores for every candidate ──
    combined: dict[str, float] = {}

    for emotion in candidates:
        score = 0.0
        score += feature_scores.get(emotion, 0.0)
        score += keyword_scores.get(emotion, 0.0)
        combined[emotion] = score

    # Also consider keyword hits that are NOT in the current base's
    # candidate list — a strong keyword match can override the base
    # family (e.g. transcript says "I'm scared" while base is neutral)
    for emotion, kscore in keyword_scores.items():
        if emotion not in combined and kscore >= 0.30:
            combined[emotion] = kscore

    # ── Decide: expand or keep base ──
    if not combined:
        # No expansion signals — return the base emotion as-is
        return {
            "emotion": base,
            "base_emotion": base,
            "confidence": round(confidence, 1),
        }

    # Pick the highest-scoring expanded emotion
    best_emotion = max(combined, key=combined.get)
    best_score = combined[best_emotion]

    # Only expand if the signal is meaningful (above a threshold)
    # Low-confidence base predictions are easier to override
    expansion_threshold = 0.15 if confidence < 60 else 0.20

    if best_score < expansion_threshold:
        # Signal too weak — keep base emotion
        return {
            "emotion": base,
            "base_emotion": base,
            "confidence": round(confidence, 1),
        }

    # Adjust confidence: blend base confidence with expansion signal
    # The expansion can slightly reduce confidence (since we're refining)
    adjusted_confidence = confidence * (0.85 + min(best_score, 0.5) * 0.30)
    adjusted_confidence = min(adjusted_confidence, 99.0)

    logger.info(
        f"Emotion expanded: {base} → {best_emotion} "
        f"(score={best_score:.2f}, conf={confidence:.1f}→{adjusted_confidence:.1f})"
    )

    return {
        "emotion": best_emotion,
        "base_emotion": base,
        "confidence": round(adjusted_confidence, 1),
    }
