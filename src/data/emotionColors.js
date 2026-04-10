/**
 * Centralized Emotion → Color mapping for Emotera AI.
 *
 * All emotion display components should import helpers from this module
 * instead of defining their own color switches.
 *
 * Colors are CSS-safe values chosen to work well on the dark glassmorphism
 * theme used throughout the app.
 */

// ── Emotion → CSS color map (50 emotions) ──────────────────────────────
const EMOTION_COLOR_MAP = Object.freeze({
  happy:        '#facc15',   // yellow
  sad:          '#3b82f6',   // blue
  angry:        '#ef4444',   // red
  neutral:      '#e2e8f0',   // white / light slate
  fear:         '#a855f7',   // purple
  surprise:     '#f97316',   // orange
  disgust:      '#22c55e',   // green
  excited:      '#eab308',   // gold

  love:         '#ec4899',   // pink
  joy:          '#fde047',   // bright yellow
  calm:         '#7dd3fc',   // light blue
  confused:     '#9ca3af',   // grey
  bored:        '#d1d5db',   // light grey
  tired:        '#c4b5fd',   // lavender
  relaxed:      '#6ee7b7',   // mint green
  anxious:      '#7e22ce',   // dark purple

  nervous:      '#8b5cf6',   // violet
  proud:        '#b8860b',   // dark gold
  ashamed:      '#a0522d',   // brown
  guilty:       '#5c3317',   // dark brown
  jealous:      '#166534',   // dark green
  hopeful:      '#38bdf8',   // sky blue
  grateful:     '#fbcfe8',   // light pink
  lonely:       '#1e3a5f',   // dark blue

  heartbroken:  '#1e3a8a',   // navy
  frustrated:   '#dc2626',   // crimson
  curious:      '#14b8a6',   // teal
  playful:      '#fdba74',   // peach
  shy:          '#f9a8d4',   // soft pink
  confident:    '#2563eb',   // royal blue
  motivated:    '#84cc16',   // lime
  determined:   '#991b1b',   // dark red

  content:      '#86efac',   // light green
  peaceful:     '#67e8f9',   // aqua
  stressed:     '#4b5563',   // dark grey
  overwhelmed:  '#1f2937',   // near-black (charcoal for visibility)
  embarrassed:  '#fb7185',   // rose
  amused:       '#fef08a',   // light yellow
  inspired:     '#06b6d4',   // cyan
  doubtful:     '#94a3b8',   // slate grey

  regretful:    '#7f1d1d',   // maroon
  nostalgic:    '#c2956b',   // sepia
  serene:       '#93c5fd',   // soft blue
  alert:        '#fb923c',   // bright orange
  worried:      '#6d28d9',   // dark violet
  trusting:     '#5eead4',   // light teal
  secure:       '#059669',   // emerald
  energetic:    '#4ade80',   // neon green

  romantic:     '#db2777',   // deep pink
  aggressive:   '#b91c1c',   // blood red
});

// ── Emotion → Emoji map ────────────────────────────────────────────────
const EMOTION_EMOJI_MAP = Object.freeze({
  happy:        '😊',
  sad:          '😔',
  angry:        '😠',
  neutral:      '😐',
  fear:         '😨',
  surprise:     '😲',
  disgust:      '🤢',
  excited:      '🤩',

  love:         '❤️',
  joy:          '😄',
  calm:         '😌',
  confused:     '😕',
  bored:        '😒',
  tired:        '😴',
  relaxed:      '😎',
  anxious:      '😰',

  nervous:      '😬',
  proud:        '🏆',
  ashamed:      '😳',
  guilty:       '😞',
  jealous:      '😤',
  hopeful:      '🌟',
  grateful:     '🙏',
  lonely:       '🥺',

  heartbroken:  '💔',
  frustrated:   '😩',
  curious:      '🤔',
  playful:      '😜',
  shy:          '🙈',
  confident:    '💪',
  motivated:    '🔥',
  determined:   '🎯',

  content:      '☺️',
  peaceful:     '🕊️',
  stressed:     '😫',
  overwhelmed:  '🤯',
  embarrassed:  '😅',
  amused:       '😂',
  inspired:     '✨',
  doubtful:     '🤨',

  regretful:    '😢',
  nostalgic:    '🥲',
  serene:       '🧘',
  alert:        '⚡',
  worried:      '😟',
  trusting:     '🤝',
  secure:       '🛡️',
  energetic:    '⚡',

  romantic:     '💕',
  aggressive:   '👊',
});

// Fallback values
const DEFAULT_COLOR = EMOTION_COLOR_MAP.neutral;
const DEFAULT_EMOJI = '⏳';
const DEFAULT_SCORE = 50;

// ── Emotion scoring (for chart trajectory) ─────────────────────────────
// Scores range 0-100 and are grouped by valence so the chart trajectory
// produces meaningful visual patterns.
const EMOTION_SCORE_MAP = Object.freeze({
  // High-positive
  happy: 95, joy: 100, excited: 92, love: 90, proud: 88,
  motivated: 87, energetic: 85, confident: 84, amused: 82,
  grateful: 80, inspired: 78, romantic: 77, playful: 76,

  // Mid-positive
  content: 72, peaceful: 70, relaxed: 68, calm: 66,
  serene: 65, hopeful: 63, trusting: 62, secure: 60,

  // Neutral band
  neutral: 50, curious: 52, alert: 55, surprise: 54,

  // Mid-negative
  confused: 45, bored: 42, shy: 40, doubtful: 38,
  tired: 36, nervous: 34, nostalgic: 33, lonely: 30,

  // High-negative
  anxious: 28, worried: 26, sad: 24, stressed: 22,
  embarrassed: 20, overwhelmed: 18, frustrated: 16,
  regretful: 15, guilty: 14, ashamed: 13, jealous: 12,
  heartbroken: 10, fear: 8, disgust: 6, angry: 5,
  aggressive: 3, determined: 55,  // determined is effort-oriented, neutral-ish
});

// ── Public helpers ─────────────────────────────────────────────────────

/**
 * Returns a CSS color string for the given emotion.
 * Case-insensitive. Falls back to neutral (white) for unknown emotions.
 */
export function getEmotionColor(emotion) {
  if (!emotion) return DEFAULT_COLOR;
  return EMOTION_COLOR_MAP[emotion.toLowerCase()] ?? DEFAULT_COLOR;
}

/**
 * Returns an emoji for the given emotion.
 * Case-insensitive. Falls back to ⏳ for unknown emotions.
 */
export function getEmotionEmoji(emotion) {
  if (!emotion) return DEFAULT_EMOJI;
  return EMOTION_EMOJI_MAP[emotion.toLowerCase()] ?? DEFAULT_EMOJI;
}

/**
 * Returns a numeric score (0-100) for the given emotion, useful for
 * chart trajectories. Case-insensitive.
 */
export function getEmotionScore(emotion) {
  if (!emotion) return DEFAULT_SCORE;
  return EMOTION_SCORE_MAP[emotion.toLowerCase()] ?? DEFAULT_SCORE;
}

/**
 * Returns the full color map (frozen) — useful if a component needs
 * to iterate over all known emotions (e.g. for a legend).
 */
export function getAllEmotionColors() {
  return EMOTION_COLOR_MAP;
}

/**
 * Returns the list of all supported emotion keys.
 */
export function getSupportedEmotions() {
  return Object.keys(EMOTION_COLOR_MAP);
}
