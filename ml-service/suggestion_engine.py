"""
Emotera AI — Rule-Based Suggestion Engine
Maps detected emotions to actionable agent suggestions.
Supports both base emotions and 50+ expanded emotions from emotion_expander.
"""

SUGGESTION_MAP = {
    "angry": [
        "The caller sounds frustrated. Apologize sincerely and offer immediate resolution.",
        "Detected anger in voice. Remain calm, acknowledge the issue, and escalate if needed.",
        "High frustration detected. Use empathetic language and take ownership of the problem.",
        "The customer is upset. Lower your tone, listen actively, and provide a clear action plan."
    ],
    "sad": [
        "The caller sounds distressed. Show empathy and ask how you can support them.",
        "Sadness detected. Use a warm, caring tone and let the caller know you understand.",
        "The customer may be going through a difficult time. Be patient and compassionate.",
        "Low emotional energy detected. Offer reassurance and take extra time to listen."
    ],
    "happy": [
        "The caller is in a positive mood. Maintain the energy and explore upselling opportunities.",
        "Happiness detected. Great opportunity to build loyalty — ask for feedback or offer rewards.",
        "Positive sentiment detected. Keep the momentum and close with a strong impression.",
        "The customer is satisfied. Reinforce the positive experience and thank them."
    ],
    "neutral": [
        "The caller is calm and composed. Proceed professionally with clear, concise information.",
        "Neutral tone detected. Focus on efficiency and provide direct answers.",
        "Standard engagement level. Stay professional and ensure all needs are addressed.",
        "Balanced emotional state. Continue with standard service protocols."
    ],
    "fearful": [
        "The caller sounds anxious. Reassure them calmly and explain each step clearly.",
        "Anxiety detected. Slow down your speech, be transparent, and reduce uncertainty.",
        "The customer seems worried. Provide guarantees and clear timelines."
    ],
    "surprised": [
        "Surprise detected. Clarify the situation and ensure the customer fully understands.",
        "The caller seems caught off guard. Explain thoroughly and check for understanding."
    ],
    "disgusted": [
        "The caller is expressing strong dissatisfaction. Take immediate corrective action.",
        "Negative reaction detected. Apologize, investigate the root cause, and follow up."
    ],
    "excited": [
        "The caller is excited! Match their energy and capitalize on the positive momentum.",
        "High excitement detected. Great time to upsell, cross-sell, or gather a review."
    ],
    "frustrated": [
        "Frustration detected. Acknowledge the difficulty, apologize, and present a clear solution path.",
        "The caller is frustrated. Avoid being defensive — focus on resolving the root issue quickly."
    ],
    "grateful": [
        "The caller is expressing gratitude. Reinforce the relationship and thank them for their loyalty.",
        "Gratitude detected. Use this moment to strengthen trust and offer additional assistance."
    ],
    "confused": [
        "The caller seems confused. Break down information into simpler steps and confirm understanding.",
        "Confusion detected. Slow down, use plain language, and guide them step by step."
    ],
    "lonely": [
        "The caller may be feeling isolated. Engage warmly, take extra time, and show genuine care.",
    ],
    "stressed": [
        "Stress detected in the caller's voice. Reassure them and simplify the process as much as possible.",
        "The caller sounds overwhelmed. Prioritize their most urgent need and handle one thing at a time."
    ],
    "tired": [
        "The caller sounds fatigued. Keep the interaction brief, efficient, and to the point.",
        "Low energy detected. Avoid unnecessary steps and help them reach resolution quickly."
    ],
    "anxious": [
        "Anxiety detected. Speak slowly, provide clear reassurances, and outline exact next steps.",
        "The caller seems anxious. Reduce uncertainty by being transparent about timelines and outcomes."
    ],
    "motivated": [
        "The caller sounds motivated and goal-driven. Support their momentum and provide actionable next steps.",
    ],
    "calm": [
        "The caller is calm and composed. Proceed efficiently with clear, professional communication.",
    ],
    "curious": [
        "Curiosity detected. The caller wants to learn more — provide detailed, helpful information.",
    ],
    "heartbroken": [
        "The caller sounds deeply upset. Show maximum empathy, listen patiently, and avoid rushing.",
    ],
    "overwhelmed": [
        "The caller sounds overwhelmed. Simplify, prioritize, and handle one concern at a time.",
    ],
}

# Map expanded emotions → base emotion for fallback suggestion lookup
EXPANDED_TO_BASE = {
    # happy family
    "joy": "happy", "excited": "excited", "love": "happy",
    "proud": "happy", "playful": "happy", "grateful": "grateful",
    "motivated": "motivated", "amused": "happy", "content": "happy",
    "energetic": "happy", "confident": "happy", "inspired": "happy",
    "romantic": "happy",

    # sad family
    "lonely": "lonely", "heartbroken": "heartbroken", "regretful": "sad",
    "tired": "tired", "nostalgic": "sad", "bored": "sad",
    "guilty": "sad", "ashamed": "sad", "hopeful": "neutral",
    "peaceful": "neutral",

    # angry family
    "frustrated": "frustrated", "aggressive": "angry", "stressed": "stressed",
    "jealous": "angry", "overwhelmed": "overwhelmed", "disgusted": "disgusted",
    "embarrassed": "sad", "determined": "neutral",

    # neutral family
    "calm": "calm", "relaxed": "neutral", "serene": "neutral",
    "confused": "confused", "curious": "curious", "alert": "neutral",
    "doubtful": "neutral", "shy": "neutral", "trusting": "neutral",
    "secure": "neutral",

    # standalone / cross-family
    "fear": "fearful", "surprise": "surprised", "anxious": "anxious",
    "nervous": "anxious", "worried": "anxious",
}

import random

def get_suggestion(emotion: str) -> str:
    """Return a contextual suggestion for the detected emotion."""
    emotion_key = emotion.lower().strip()

    # Direct match first (works for base emotions AND expanded ones with entries)
    if emotion_key in SUGGESTION_MAP:
        return random.choice(SUGGESTION_MAP[emotion_key])

    # Fallback: map expanded emotion → its nearest base/parent emotion
    parent = EXPANDED_TO_BASE.get(emotion_key)
    if parent and parent in SUGGESTION_MAP:
        return random.choice(SUGGESTION_MAP[parent])

    # Ultimate fallback → neutral suggestions
    return random.choice(SUGGESTION_MAP["neutral"])

