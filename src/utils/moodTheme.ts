export interface MoodDefinition {
  name: string;
  accent: string;
  accentSoft: string;
  glow: string;
  keywords: string[];
}

export const MOODS: MoodDefinition[] = [
  {
    name: "love",
    accent: "#ff3d9a",
    accentSoft: "rgba(255, 61, 154, 0.18)",
    glow: "rgba(255, 61, 154, 0.45)",
    keywords: [
      "love",
      "pyaar",
      "pyar",
      "cute",
      "sweet",
      "flirt",
      "miss you",
      "miss u",
      "jaan",
      "baby",
      "shona",
      "dil",
      "mohabbat",
      "khubsurat",
      "khoobsurat",
      "romantic",
    ],
  },
  {
    name: "happy",
    accent: "#ffb020",
    accentSoft: "rgba(255, 176, 32, 0.18)",
    glow: "rgba(255, 176, 32, 0.45)",
    keywords: [
      "happy",
      "funny",
      "hahaha",
      "haha",
      "hehe",
      "mazaak",
      "mazak",
      "party",
      "masti",
      "lol",
      "khush",
      "smile",
      "enjoy",
      "mast",
      "badhiya",
      "cheers",
      "celebrate",
    ],
  },
  {
    name: "angry",
    accent: "#ff3b3b",
    accentSoft: "rgba(255, 59, 59, 0.18)",
    glow: "rgba(255, 59, 59, 0.45)",
    keywords: [
      "angry",
      "gussa",
      "saale",
      "sale",
      "kamine",
      "kamina",
      "harami",
      "pagal",
      "bakwaas",
      "bakwas",
      "shut up",
      "irritate",
      "chup",
      "hate",
      "idiot",
    ],
  },
  {
    name: "sad",
    accent: "#3b82f6",
    accentSoft: "rgba(59, 130, 246, 0.18)",
    glow: "rgba(59, 130, 246, 0.45)",
    keywords: [
      "sad",
      "ro",
      "dukh",
      "tension",
      "stress",
      "akela",
      "lonely",
      "rona",
      "upset",
      "dard",
      "cry",
      "depress",
      "pareshan",
      "hurt",
    ],
  },
  {
    name: "calm",
    accent: "#14b8a6",
    accentSoft: "rgba(20, 184, 166, 0.18)",
    glow: "rgba(20, 184, 166, 0.45)",
    keywords: [
      "calm",
      "night",
      "sleep",
      "relax",
      "shanti",
      "sukoon",
      "thand",
      "chill",
      "quiet",
      "so jao",
      "goodnight",
      "peace",
      "peaceful",
    ],
  },
  {
    name: "music",
    accent: "#06b6d4",
    accentSoft: "rgba(6, 182, 212, 0.18)",
    glow: "rgba(6, 182, 212, 0.45)",
    keywords: [
      "music",
      "dance",
      "song",
      "gaana",
      "gana",
      "beat",
      "rhythm",
      "nacho",
      "melody",
      "track",
      "sing",
      "sur",
      "baja",
    ],
  },
];

export const DEFAULT_MOOD: MoodDefinition = {
  name: "default",
  accent: "#8b5cf6",
  accentSoft: "rgba(139, 92, 246, 0.18)",
  glow: "rgba(139, 92, 246, 0.45)",
  keywords: [],
};

export function detectMoodFromText(text: string): MoodDefinition | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const mood of MOODS) {
    for (const kw of mood.keywords) {
      if (lower.includes(kw.toLowerCase())) {
        return mood;
      }
    }
  }
  return null;
}

export function applyMoodTheme(mood: MoodDefinition) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--accent", mood.accent);
  root.style.setProperty("--accent-soft", mood.accentSoft);
  root.style.setProperty("--glow", mood.glow);
}
