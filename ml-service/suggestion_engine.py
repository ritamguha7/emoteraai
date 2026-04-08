"""
Emotera AI — Rule-Based Suggestion Engine
Maps detected emotions to actionable agent suggestions.
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
    ]
}

import random

def get_suggestion(emotion: str) -> str:
    """Return a contextual suggestion for the detected emotion."""
    emotion_key = emotion.lower().strip()
    suggestions = SUGGESTION_MAP.get(emotion_key, SUGGESTION_MAP["neutral"])
    return random.choice(suggestions)
