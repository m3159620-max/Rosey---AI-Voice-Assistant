export interface AppConfig {
  apiKey: string;
  userName: string;
  assistantName: string;
  systemPrompt: string;
  voiceName?: string;
  activeTopicOrScript?: string;
  autoMuteWhileSpeaking?: boolean;
}

export type AppState = "idle" | "listening" | "processing" | "speaking" | "reconnecting";
