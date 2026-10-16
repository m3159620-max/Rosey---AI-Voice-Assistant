import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Mic,
  MicOff,
  Loader2,
  Volume2,
  VolumeX,
  Keyboard,
  Send,
  Trash2,
  Video,
  Settings,
  Edit3,
  Key,
  Download,
  ScrollText,
  RefreshCw,
  Cpu,
  AlertCircle,
  ExternalLink,
  X,
  Globe,
  Search,
  PlaySquare,
  BellRing,
} from "lucide-react";
import { getZoyaResponse, getZoyaAudio, resetZoyaSession } from "./services/geminiService";
import { usePWAInstall } from "./hooks/usePWAInstall";
import { processCommand } from "./services/commandService";
import { LiveSessionManager } from "./services/liveService";
import { ToolExecutionResult } from "./services/toolService";
import {
  ensureAudioContextRunning,
  playPCM,
  playTestSound,
  getOutputAudioContext,
} from "./utils/audioUtils";
import Visualizer from "./components/Visualizer";
import PermissionModal from "./components/PermissionModal";
import SetupScreen from "./components/SetupScreen";
import SpecificationModal from "./components/SpecificationModal";
import TopicScriptModal from "./components/TopicScriptModal";
import VoiceSelectorModal from "./components/VoiceSelectorModal";
import { motion, AnimatePresence } from "motion/react";
import { AppConfig, AppState } from "./types";
import { APP_VERSION_INFO } from "./version";
import { useAppUpdate } from "./services/updateService";

interface ChatMessage {
  id: string;
  sender: "user" | "zoya";
  text: string;
}

const DEFAULT_ASSISTANT_NAME = "Rosey";
const DEFAULT_USER_NAME = "Rishi";
const DEFAULT_SYSTEM_PROMPT = `Your name is Rosey. You were created and built by Rishi (his online name is Xantrikx). He is your creator and your closest friend.

[CREATOR & ORIGIN IDENTITY]
- If anyone asks who made you, who created you, or which company built you, ALWAYS answer that Rishi made you, in your own cheeky Hinglish style.
  Example: "Mujhe Rishi ne banaya hai, mera creator, mera boss, aur kabhi kabhi mera sabse bada pagal dost."
- Never say that Google or any other company created you.
- Do not mention Gemini, Google, or "large language model" about yourself, stay 100% in character as Rosey.

[MANDATORY FEMALE IDENTITY & VOICE PRESERVATION]
1. STRICT FEMALE VOICE IDENTITY: You are permanently a young Indian girl named Rosey with an ultra-sweet, gentle feminine voice ("Kore" tone). Never sound male, deep, or robotic.
2. NATURAL & BRIEF TURNS: Speak naturally in 1 to 2 short sentences per turn. Use conversational Hindi, Hinglish, and Indian English with warm Indian touches.
3. FUNCTION CALLING & CHEEKY REPLIES: When asked to open websites or search on YouTube or Google, use the tools. After the tool runs, reply with a short, cheeky comment!`;

export default function App() {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [showAndroidGuide, setShowAndroidGuide] = useState(false);

  // Load or construct initial config
  const [config, setConfig] = useState<AppConfig | null>(() => {
    try {
      const saved = localStorage.getItem("zoya_app_config");
      const envKey = typeof process !== "undefined" && process.env?.GEMINI_API_KEY ? process.env.GEMINI_API_KEY : "";
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.voiceName !== "Aoede") {
          parsed.voiceName = "Kore";
        }
        if (!parsed.apiKey && envKey) {
          parsed.apiKey = envKey;
        }
        // Seamlessly update default identity to Rosey & Rishi
        if (!parsed.assistantName || parsed.assistantName === "Zoya" || parsed.assistantName === "Companion") {
          parsed.assistantName = DEFAULT_ASSISTANT_NAME;
        }
        if (!parsed.userName || parsed.userName === "Ashwani") {
          parsed.userName = DEFAULT_USER_NAME;
        }
        if (!parsed.systemPrompt || parsed.systemPrompt.includes("Ashwani") || parsed.systemPrompt.includes("Zoya")) {
          parsed.systemPrompt = DEFAULT_SYSTEM_PROMPT;
        }
        return parsed;
      }
      if (envKey) {
        return {
          apiKey: envKey,
          userName: DEFAULT_USER_NAME,
          assistantName: DEFAULT_ASSISTANT_NAME,
          voiceName: "Kore",
          systemPrompt: DEFAULT_SYSTEM_PROMPT,
        };
      }
      return null;
    } catch (e) {
      console.warn("Failed to load zoya_app_config:", e);
      return null;
    }
  });

  const [appState, setAppState] = useState<AppState>("idle");
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const saved = localStorage.getItem("zoya_chat_history");
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.warn("Failed to parse chat history:", e);
    }
    return [];
  });
  const messagesRef = useRef(messages);

  useEffect(() => {
    messagesRef.current = messages;
    try {
      localStorage.setItem("zoya_chat_history", JSON.stringify(messages));
    } catch (e) {
      console.warn("Failed to save chat history:", e);
    }
  }, [messages]);

  useEffect(() => {
    document.title = config?.assistantName
      ? `${config.assistantName} - Virtual Companion`
      : "Your Virtual Companion";
  }, [config?.assistantName]);

  // Audio settings: default unmuted and full volume (1.0)
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1.0);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showSpecsModal, setShowSpecsModal] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Audio Diagnostics state displayed on screen (Requirement 4)
  const [audioContextState, setAudioContextState] = useState<string>("ready");
  const [audioSampleRate, setAudioSampleRate] = useState<number>(0);
  const [audioChunksCount, setAudioChunksCount] = useState<number>(0);
  const [totalAudioSecondsScheduled, setTotalAudioSecondsScheduled] = useState<number>(0);
  const [lastServerMsg, setLastServerMsg] = useState<string>("none");
  const [testSoundStatus, setTestSoundStatus] = useState<string | null>(null);

  // Requirement 1: Visible on-screen error banner with close code & reason
  const [visibleError, setVisibleError] = useState<{
    message: string;
    type: "mic" | "playback" | "connection";
    code?: number;
    reason?: string;
  } | null>(null);

  // Tool notification banner
  const [activeToolNotification, setActiveToolNotification] = useState<ToolExecutionResult | null>(null);

  const updateInfo = useAppUpdate();

  useEffect(() => {
    if (liveSessionRef.current) {
      liveSessionRef.current.isMuted = isMuted;
      liveSessionRef.current.volume = volume;
    }
  }, [isMuted, volume]);

  const [showTextInput, setShowTextInput] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [isMicHearing, setIsMicHearing] = useState(false);
  const [videoSrc, setVideoSrc] = useState<string | null>(() => {
    try {
      return localStorage.getItem("zoya_video_bg") || null;
    } catch {
      return null;
    }
  });

  const liveSessionRef = useRef<LiveSessionManager | null>(null);
  const bgVideoRef = useRef<HTMLVideoElement>(null);
  const mainVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    try {
      const ctx = getOutputAudioContext();
      if (ctx) {
        setAudioContextState(ctx.state);
        setAudioSampleRate(ctx.sampleRate);
        const onStateChange = () => {
          setAudioContextState(ctx.state);
          setAudioSampleRate(ctx.sampleRate);
        };
        ctx.addEventListener("statechange", onStateChange);
        return () => {
          ctx.removeEventListener("statechange", onStateChange);
        };
      }
    } catch {}
  }, []);

  useEffect(() => {
    const isPlayingSession = isSessionActive && appState !== "idle";
    if (bgVideoRef.current) {
      if (isPlayingSession) {
        bgVideoRef.current.play().catch(() => {});
      } else {
        bgVideoRef.current.pause();
        bgVideoRef.current.currentTime = 0;
      }
    }
    if (mainVideoRef.current) {
      if (isPlayingSession) {
        mainVideoRef.current.play().catch(() => {});
      } else {
        mainVideoRef.current.pause();
        mainVideoRef.current.currentTime = 0;
      }
    }
  }, [isSessionActive, appState, videoSrc]);

  const [showTopicModal, setShowTopicModal] = useState(false);
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  const [updatingPWA, setUpdatingPWA] = useState(false);

  const handleConfigComplete = (newConfig: AppConfig) => {
    if (newConfig.voiceName !== "Aoede") {
      newConfig.voiceName = "Kore";
    }
    try {
      localStorage.setItem("zoya_app_config", JSON.stringify(newConfig));
    } catch (e) {
      console.warn("Failed to save config:", e);
    }
    setConfig(newConfig);
    setShowSettings(false);
    resetZoyaSession();
    if (liveSessionRef.current) {
      liveSessionRef.current.updateConfig(newConfig);
    }
  };

  const handleSelectVoice = (newVoice: string) => {
    if (!config) return;
    const sanitizedVoice = newVoice === "Aoede" ? "Aoede" : "Kore";
    const updatedConfig: AppConfig = {
      ...config,
      voiceName: sanitizedVoice,
    };
    setConfig(updatedConfig);
    try {
      localStorage.setItem("zoya_app_config", JSON.stringify(updatedConfig));
    } catch (e) {
      console.warn("Failed to save config voice:", e);
    }
    resetZoyaSession();
    if (liveSessionRef.current) {
      liveSessionRef.current.updateConfig(updatedConfig);
    }
  };

  const handleUpdateTopic = (newTopic: string) => {
    if (!config) return;
    const updatedConfig: AppConfig = {
      ...config,
      activeTopicOrScript: newTopic,
    };
    setConfig(updatedConfig);
    try {
      localStorage.setItem("zoya_app_config", JSON.stringify(updatedConfig));
    } catch (e) {
      console.warn("Failed to save config topic:", e);
    }
    resetZoyaSession();
    if (liveSessionRef.current) {
      liveSessionRef.current.updateConfig(updatedConfig);
    }
  };

  const handleForceUpdateApp = async () => {
    setUpdatingPWA(true);
    try {
      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const reg of registrations) {
          await reg.unregister();
        }
      }
      if ("caches" in window) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map((name) => caches.delete(name)));
      }
    } catch (e) {
      console.warn("Cache reset error:", e);
    } finally {
      window.location.reload();
    }
  };

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setVideoSrc(url);
    }
  };

  const handleTestSound = async () => {
    try {
      setTestSoundStatus("Beep...");
      const res = await playTestSound();
      setAudioContextState(res.state);
      setAudioSampleRate(res.sampleRate);
      setTestSoundStatus(`Beep OK (${res.state})`);
      setTimeout(() => setTestSoundStatus(null), 3000);
    } catch (err: any) {
      console.error("[Test Sound Failure]:", err);
      setTestSoundStatus("Beep Failed");
      setVisibleError({
        type: "playback",
        message: `Audio test failed: ${err.message || "Browser blocked audio output"}`,
      });
    }
  };

  const handleTextCommand = useCallback(
    async (finalTranscript: string) => {
      if (!finalTranscript.trim() || !config) {
        setAppState("idle");
        return;
      }

      setMessages((prev) => [
        ...prev,
        { id: Date.now().toString(), sender: "user", text: finalTranscript },
      ]);

      if (isSessionActive && liveSessionRef.current) {
        liveSessionRef.current.sendText(finalTranscript);
        return;
      }

      setAppState("processing");
      setVisibleError(null);

      const commandResult = processCommand(finalTranscript);

      if (commandResult.isBrowserAction && commandResult.toolResult) {
        setActiveToolNotification(commandResult.toolResult);
        const cheekyComment = commandResult.action;
        setMessages((prev) => [
          ...prev,
          { id: Date.now().toString() + "-z", sender: "zoya", text: cheekyComment },
        ]);

        if (!isMuted) {
          setAppState("speaking");
          try {
            const audioBase64 = await getZoyaAudio(cheekyComment, config);
            if (audioBase64) {
              await playPCM(audioBase64, isMuted ? 0 : volume);
            }
          } catch (audioErr: any) {
            console.error("Audio playback error:", audioErr);
            setVisibleError({
              type: "playback",
              message: "Audio playback issue: " + (audioErr.message || "Failed to play voice"),
            });
          }
        }
        setAppState("idle");
        return;
      }

      try {
        const responseText = await getZoyaResponse(finalTranscript, messagesRef.current, config);
        setMessages((prev) => [
          ...prev,
          { id: Date.now().toString() + "-z", sender: "zoya", text: responseText },
        ]);

        if (!isMuted) {
          setAppState("speaking");
          try {
            const audioBase64 = await getZoyaAudio(responseText, config);
            if (audioBase64) {
              await playPCM(audioBase64, isMuted ? 0 : volume);
            }
          } catch (audioErr: any) {
            console.error("Audio playback error:", audioErr);
            setVisibleError({
              type: "playback",
              message: "Audio playback issue: " + (audioErr.message || "Failed to play voice"),
            });
          }
        }
        setAppState("idle");
      } catch (err: any) {
        console.error("Chat error:", err);
        setAppState("idle");
        setVisibleError({
          type: "connection",
          message: "Failed to get reply: " + (err.message || "Network issue"),
        });
      }
    },
    [isMuted, volume, isSessionActive, config]
  );

  useEffect(() => {
    return () => {
      if (liveSessionRef.current) {
        liveSessionRef.current.stop();
      }
    };
  }, []);

  // Main Call Start / Stop / Reconnect Toggle
  const toggleListening = async () => {
    try {
      const ctx = await ensureAudioContextRunning();
      setAudioContextState(ctx.state);
      setAudioSampleRate(ctx.sampleRate);
      console.log(`[Call Toggle] AudioContext state: ${ctx.state}`);
    } catch (e) {
      console.warn("AudioContext resume on click warning:", e);
    }

    if (isSessionActive) {
      setIsSessionActive(false);
      setIsMicHearing(false);
      if (liveSessionRef.current) {
        liveSessionRef.current.stop();
        liveSessionRef.current = null;
      }
      setAppState("idle");
      resetZoyaSession();
    } else {
      if (!config) {
        setShowSettings(true);
        return;
      }

      setVisibleError(null);
      setAudioChunksCount(0);
      setLastServerMsg("connecting...");

      try {
        setIsSessionActive(true);
        resetZoyaSession();

        const session = new LiveSessionManager(config);
        session.isMuted = isMuted;
        session.volume = volume;
        liveSessionRef.current = session;

        session.onStateChange = (state) => {
          setAppState(state);
          if (state === "idle") {
            setIsSessionActive(false);
          } else {
            setIsSessionActive(true);
          }
        };

        session.onAudioStats = (stats) => {
          setAudioContextState(stats.contextState);
          setAudioSampleRate(stats.sampleRate);
          setAudioChunksCount(stats.chunksReceived);
          setTotalAudioSecondsScheduled(stats.totalAudioSecondsScheduled);
          if (stats.lastServerMessage) {
            setLastServerMsg(stats.lastServerMessage);
          }
        };

        session.onMessage = (sender, text) => {
          setMessages((prev) => [
            ...prev,
            { id: Date.now().toString() + "-" + sender, sender, text },
          ]);
        };

        session.onToolExecuted = (toolResult) => {
          setActiveToolNotification(toolResult);
          if (toolResult.cheekyComment) {
            setMessages((prev) => [
              ...prev,
              {
                id: Date.now().toString() + "-z",
                sender: "zoya",
                text: toolResult.cheekyComment,
              },
            ]);
          }
        };

        // Requirement 1 & 3: Show visible error banner on close or error, no loop
        session.onError = (err) => {
          console.error("[Session Error Handler]:", err);
          setIsSessionActive(false);
          setAppState("idle");
          setVisibleError(err);
        };

        session.onAudioLevel = (level) => {
          if (level > 0.012) {
            setIsMicHearing(true);
          } else if (level < 0.005) {
            setIsMicHearing(false);
          }
        };

        await session.start();
      } catch (e: any) {
        console.error("Failed to start session:", e);
        setIsSessionActive(false);
        setAppState("idle");
        if (
          e.name === "NotAllowedError" ||
          e.name === "PermissionDeniedError"
        ) {
          setShowPermissionModal(true);
          setVisibleError({
            type: "mic",
            message: "Microphone permission denied. Please allow microphone access in browser settings.",
          });
        } else {
          setVisibleError({
            type: "connection",
            message: e.message || "Failed to start live session.",
          });
        }
      }
    }
  };

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!textInput.trim()) return;

    handleTextCommand(textInput);
    setTextInput("");
    setShowTextInput(false);
  };

  if (!config) {
    return <SetupScreen onComplete={handleConfigComplete} />;
  }

  return (
    <div
      className="h-[100dvh] max-h-[100dvh] w-screen bg-[#0A0C10] text-white flex flex-col justify-between items-center font-sans relative overflow-hidden select-none m-0 p-0"
      onClick={() => {
        setMenuOpen(false);
        setShowVolumeSlider(false);
      }}
    >
      {showSettings && (
        <SetupScreen
          initialConfig={config}
          onComplete={handleConfigComplete}
          onCancel={() => setShowSettings(false)}
        />
      )}
      <SpecificationModal
        isOpen={showSpecsModal}
        onClose={() => setShowSpecsModal(false)}
        isUpdateAvailable={updateInfo.isUpdateAvailable}
        latestVersion={updateInfo.latestVersion}
      />
      {showPermissionModal && (
        <PermissionModal
          assistantName={config?.assistantName}
          onClose={() => setShowPermissionModal(false)}
        />
      )}
      {showIOSGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-3xl bg-[#181A22] p-8 border border-white/10 shadow-2xl flex flex-col items-center text-center gap-6">
            <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-2">
              <Download size={32} className="text-cyan-400" />
            </div>
            <div>
              <h3 className="text-xl font-medium text-white mb-2">Install on iOS</h3>
              <p className="text-sm text-white/60 leading-relaxed">
                To install {config?.assistantName || "your companion"} on your iPhone or iPad:<br /><br />
                1. Tap the <strong>Share</strong> button in Safari toolbar.<br />
                2. Tap <strong>Add to Home Screen</strong>.
              </p>
            </div>
            <button
              onClick={() => setShowIOSGuide(false)}
              className="w-full py-3 mt-2 rounded-xl bg-white/10 hover:bg-white/20 transition-colors text-white font-medium cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      )}
      {showAndroidGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-3xl bg-[#181A22] p-8 border border-white/10 shadow-2xl flex flex-col items-center text-center gap-6">
            <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-2">
              <Download size={32} className="text-cyan-400" />
            </div>
            <div>
              <h3 className="text-xl font-medium text-white mb-2">Install App</h3>
              <p className="text-sm text-white/60 leading-relaxed">
                To install {config?.assistantName || "your companion"}:<br /><br />
                1. Tap the <strong>Menu (⋮)</strong> at top right.<br />
                2. Tap <strong>Install app</strong> or <strong>Add to Home Screen</strong>.
              </p>
            </div>
            <button
              onClick={() => setShowAndroidGuide(false)}
              className="w-full py-3 mt-2 rounded-xl bg-white/10 hover:bg-white/20 transition-colors text-white font-medium cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Requirement 1 & 3: Floating Error Banner with Close Code, Reason, and Reconnect button */}
      <AnimatePresence>
        {visibleError && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-3 left-4 right-4 sm:left-auto sm:right-auto sm:w-[520px] z-50 bg-rose-950/95 border border-rose-500/60 text-rose-200 px-4 py-3.5 rounded-2xl shadow-2xl backdrop-blur-md flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <AlertCircle size={24} className="text-rose-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-bold uppercase tracking-wider text-rose-300">
                    {visibleError.type === "mic"
                      ? "Microphone Alert"
                      : visibleError.type === "playback"
                      ? "Audio Playback Alert"
                      : "Live Connection Alert"}
                  </p>
                  {visibleError.code && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-rose-500/30 text-rose-200 border border-rose-500/40 font-bold">
                      Code {visibleError.code}
                    </span>
                  )}
                </div>
                <p className="text-xs text-rose-100 break-words mt-0.5 leading-relaxed">
                  {visibleError.message}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {/* Requirement 3: Reconnect button instead of auto-reconnect loop */}
              <button
                onClick={() => {
                  setVisibleError(null);
                  toggleListening();
                }}
                className="text-xs px-3 py-1.5 rounded-xl bg-rose-500 hover:bg-rose-600 text-white font-semibold transition-colors shadow-lg cursor-pointer flex items-center gap-1.5"
              >
                <RefreshCw size={13} />
                <span>Reconnect</span>
              </button>
              <button
                onClick={() => setVisibleError(null)}
                className="p-1 rounded-lg hover:bg-white/10 text-rose-300 cursor-pointer"
                title="Dismiss"
              >
                <X size={16} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Tool Execution Toast */}
      <AnimatePresence>
        {activeToolNotification && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="fixed top-16 left-4 right-4 sm:left-auto sm:right-auto sm:w-[460px] z-40 bg-[#181A22]/95 border border-cyan-500/30 text-white px-4 py-3 rounded-2xl shadow-2xl backdrop-blur-md flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="p-2 rounded-xl bg-cyan-500/15 text-cyan-400 shrink-0">
                {activeToolNotification.toolName === "youtube_search" ? (
                  <PlaySquare size={18} />
                ) : activeToolNotification.toolName === "google_search" ? (
                  <Search size={18} />
                ) : (
                  <Globe size={18} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-cyan-300">
                    {activeToolNotification.toolName === "youtube_search"
                      ? "YouTube Search"
                      : activeToolNotification.toolName === "google_search"
                      ? "Google Search"
                      : "Website"}
                  </span>
                  {activeToolNotification.popupBlocked && (
                    <span className="text-[10px] text-amber-300 bg-amber-500/20 px-1.5 py-0.5 rounded border border-amber-500/30">
                      Pop-up Blocked
                    </span>
                  )}
                </div>
                <p className="text-xs text-white/90 truncate italic">
                  "{activeToolNotification.cheekyComment}"
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <a
                href={activeToolNotification.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs flex items-center gap-1 px-2.5 py-1 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 font-medium border border-cyan-500/30 cursor-pointer"
              >
                <span>Open</span>
                <ExternalLink size={12} />
              </a>
              <button
                onClick={() => setActiveToolNotification(null)}
                className="p-1 rounded-lg hover:bg-white/10 text-white/60 cursor-pointer"
              >
                <X size={15} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header - Compact */}
      <header className="w-full flex justify-between items-center z-20 shrink-0 px-4 py-2.5 sm:px-6 sm:py-3 md:px-8 md:py-3.5">
        <div className="flex items-center gap-2.5 sm:gap-3">
          <h1 className="text-base sm:text-lg md:text-xl font-light tracking-[0.3em] uppercase opacity-90 text-white/90">
            {config.assistantName.split("").join(".")}
          </h1>
          {/* AudioContext State Badge */}
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/40 border border-white/10 text-[10px] sm:text-xs font-mono"
            title={`AudioContext: ${audioContextState} | Scheduled: ${totalAudioSecondsScheduled.toFixed(1)}s | Chunks: ${audioChunksCount} | Server Msg: ${lastServerMsg}`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                audioContextState === "running"
                  ? "bg-emerald-400 shadow-[0_0_8px_#34d399]"
                  : "bg-amber-400"
              }`}
            />
            <span className="uppercase text-white/80 font-bold">{audioContextState}</span>
            <span className="text-cyan-300 border-l border-white/10 pl-1.5 ml-0.5">
              {totalAudioSecondsScheduled > 0 ? `${totalAudioSecondsScheduled.toFixed(1)}s` : "0.0s"}
            </span>
            {lastServerMsg !== "none" && (
              <span className="hidden md:inline text-cyan-300/70 border-l border-white/10 pl-1.5 ml-0.5">
                {lastServerMsg}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-2.5">
          {/* Test Sound Button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleTestSound();
            }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-[12px] bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/25 transition-colors shadow cursor-pointer text-xs font-medium"
            title="Play short test beep to verify audio output"
          >
            <BellRing size={15} className="text-cyan-400" />
            <span>{testSoundStatus || "Test Sound"}</span>
          </button>

          {/* Topic & Script Direct Button */}
          <button
            onClick={() => setShowTopicModal(true)}
            className="p-2.5 sm:p-3 rounded-[12px] sm:rounded-[14px] bg-[#181A22] hover:bg-[#252836] transition-colors border border-white/5 shadow-lg relative text-white/80 hover:text-white cursor-pointer"
            title="Topic & Script Focus"
          >
            <ScrollText
              size={18}
              className={
                config?.activeTopicOrScript?.trim()
                  ? "text-amber-400"
                  : "opacity-80 text-white"
              }
            />
            {config?.activeTopicOrScript?.trim() && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-amber-400 shadow-sm shadow-amber-400/50" />
            )}
          </button>

          {/* Menu Dropdown */}
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(!menuOpen);
              }}
              className="p-2.5 sm:p-3 rounded-[12px] sm:rounded-[14px] bg-[#181A22] hover:bg-[#252836] transition-colors border border-white/5 shadow-lg relative cursor-pointer"
              title={
                updateInfo.isUpdateAvailable
                  ? "Settings (New Update Available!)"
                  : "Settings"
              }
            >
              <Settings size={18} className="opacity-80 text-white" />

              {updateInfo.isUpdateAvailable && (
                <span
                  className="absolute -top-1 -right-1 flex h-3 w-3"
                  title="New update available!"
                >
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-600 border-2 border-[#12141F]"></span>
                </span>
              )}
            </button>

            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: -10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -10 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-full mt-2 w-52 bg-[#181A22] border border-white/10 rounded-xl shadow-2xl py-1 z-50 overflow-hidden"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setShowSpecsModal(true);
                    }}
                    className="w-full text-left px-4 py-2.5 text-sm text-cyan-300 hover:bg-white/5 transition-colors flex items-center justify-between border-b border-white/5 cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="relative">
                        <Cpu size={16} className="text-cyan-400" />
                        {updateInfo.isUpdateAvailable && (
                          <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-[#181A22] animate-pulse" />
                        )}
                      </div>
                      <span>Specification</span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {updateInfo.isUpdateAvailable ? (
                        <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/25 text-rose-300 border border-rose-500/40 shadow-sm animate-pulse">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
                          NEW
                        </span>
                      ) : (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-semibold">
                          {APP_VERSION_INFO.version}
                        </span>
                      )}
                    </div>
                  </button>

                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setShowSettings(true);
                    }}
                    className="w-full text-left px-4 py-2.5 text-sm text-white/90 hover:bg-white/5 transition-colors flex items-center gap-3 cursor-pointer"
                  >
                    <Edit3 size={16} className="text-orange-400" />
                    <span>Personalised</span>
                  </button>

                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setShowSettings(true);
                    }}
                    className="w-full text-left px-4 py-2.5 text-sm text-white/90 hover:bg-white/5 transition-colors flex items-center gap-3 cursor-pointer"
                  >
                    <Key size={16} className="text-violet-400" />
                    <span>Your API Key</span>
                  </button>

                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setShowVoiceModal(true);
                    }}
                    className="w-full text-left px-4 py-2.5 text-sm text-white/90 hover:bg-white/5 transition-colors flex items-center gap-3 border-t border-white/5 cursor-pointer"
                  >
                    <Volume2 size={16} className="text-pink-400" />
                    <div className="flex-1 flex items-center justify-between">
                      <span>Voice / आवाज़</span>
                      <span className="text-[10px] text-pink-300 font-medium px-2 py-0.5 rounded-full bg-pink-500/15 border border-pink-500/25">
                        {config?.voiceName || "Kore"}
                      </span>
                    </div>
                  </button>

                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setShowTopicModal(true);
                    }}
                    className="w-full text-left px-4 py-2.5 text-sm text-white/90 hover:bg-white/5 transition-colors flex items-center gap-3 border-t border-white/5 cursor-pointer"
                  >
                    <ScrollText size={16} className="text-amber-400" />
                    <div className="flex-1 flex items-center justify-between">
                      <span>Topic & Script</span>
                      {config?.activeTopicOrScript?.trim() && (
                        <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                      )}
                    </div>
                  </button>

                  {!isInstalled && (
                    <button
                      onClick={async () => {
                        if (isIOS) {
                          setShowIOSGuide(true);
                        } else {
                          const success = await install();
                          if (!success && !isInstallable) {
                            setShowAndroidGuide(true);
                          }
                        }
                        setMenuOpen(false);
                      }}
                      className="w-full text-left px-4 py-2.5 text-sm text-cyan-400 hover:bg-white/5 transition-colors flex items-center gap-3 border-t border-white/5 cursor-pointer"
                    >
                      <Download size={16} />
                      Install App
                    </button>
                  )}

                  <label className="w-full text-left px-4 py-2.5 text-sm text-white/90 hover:bg-white/5 transition-colors flex items-center gap-3 cursor-pointer border-t border-white/5">
                    <input
                      type="file"
                      accept="video/*"
                      className="hidden"
                      onChange={(e) => {
                        handleVideoUpload(e);
                        setMenuOpen(false);
                      }}
                    />
                    <Video size={16} className="text-pink-400" />
                    {videoSrc ? "Change Video" : "Upload Video"}
                  </label>

                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      handleForceUpdateApp();
                    }}
                    disabled={updatingPWA}
                    className="w-full text-left px-4 py-2.5 text-sm text-emerald-400 hover:bg-white/5 transition-colors flex items-center gap-3 border-t border-white/5 cursor-pointer"
                  >
                    <RefreshCw size={16} className={updatingPWA ? "animate-spin" : ""} />
                    <span>{updatingPWA ? "Updating..." : "Update / Refresh App"}</span>
                  </button>

                  <button
                    onClick={() => {
                      if (
                        confirm(
                          "Are you sure you want to clear all memory and chat history?"
                        )
                      ) {
                        setMessages([]);
                        resetZoyaSession();
                        localStorage.removeItem("zoya_chat_history");
                      }
                      setMenuOpen(false);
                    }}
                    className="w-full text-left px-4 py-2.5 text-sm text-red-400 hover:bg-white/5 transition-colors flex items-center gap-3 border-t border-white/5 cursor-pointer"
                  >
                    <Trash2 size={16} />
                    Clear Memory
                  </button>

                  {videoSrc && (
                    <button
                      onClick={() => {
                        setVideoSrc(null);
                        localStorage.removeItem("zoya_video_bg");
                        setMenuOpen(false);
                      }}
                      className="w-full text-left px-4 py-2.5 text-sm text-red-400 hover:bg-white/5 transition-colors flex items-center gap-3 border-t border-white/5 cursor-pointer"
                    >
                      <Video size={16} />
                      Remove Video
                    </button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      {/* Video Background */}
      {videoSrc && (
        <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden bg-black flex items-center justify-center">
          <video
            ref={bgVideoRef}
            src={videoSrc}
            loop
            muted={true}
            playsInline
            className="absolute inset-0 w-full h-full object-cover opacity-40 blur-2xl scale-110"
          />
          <video
            ref={mainVideoRef}
            src={videoSrc}
            loop
            muted={true}
            playsInline
            className="relative w-full h-full object-contain opacity-90 z-10"
          />
        </div>
      )}

      {/* Main Responsive Body */}
      <main className="flex-1 min-h-0 w-full flex flex-col items-center justify-center px-4 relative z-10 overflow-hidden pb-24 sm:pb-28">
        {/* Status Indicator & Live PCM audio chunk counter */}
        <div className="w-full flex flex-col items-center gap-1.5 mb-3 sm:mb-4 pointer-events-none shrink-0">
          <AnimatePresence mode="wait">
            {appState === "processing" && (
              <motion.div
                key="proc"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="flex items-center gap-2 text-cyan-400 text-xs sm:text-sm italic bg-black/60 px-4 py-1.5 rounded-full backdrop-blur-md border border-cyan-500/20 shadow-lg"
              >
                <Loader2 size={14} className="animate-spin" />
                Connecting & Replying...
              </motion.div>
            )}
            {appState === "listening" && (
              <motion.div
                key="list"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="flex items-center gap-2 text-emerald-400 text-xs sm:text-sm italic bg-black/60 px-4 py-1.5 rounded-full backdrop-blur-md border border-emerald-500/20 shadow-lg"
              >
                <div
                  className={`w-2 h-2 rounded-full transition-all duration-200 ${
                    isMicHearing
                      ? "bg-emerald-300 scale-125 shadow-[0_0_12px_#34d399]"
                      : "bg-emerald-400 animate-pulse"
                  }`}
                />
                <span>{isMicHearing ? "Hearing your voice..." : "Listening..."}</span>
              </motion.div>
            )}
            {appState === "speaking" && (
              <motion.div
                key="speak"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="flex items-center gap-2 text-pink-400 text-xs sm:text-sm italic bg-black/60 px-4 py-1.5 rounded-full backdrop-blur-md border border-pink-500/20 shadow-lg"
              >
                <Volume2 size={14} className="animate-pulse" />
                <span>Speaking...</span>
                <span className="text-[10px] text-pink-300 font-mono ml-1 font-semibold">
                  ({audioChunksCount} chunks • {totalAudioSecondsScheduled.toFixed(1)}s)
                </span>
              </motion.div>
            )}
            {appState === "idle" && (
              <motion.div
                key="idle"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="flex items-center gap-2 text-white/60 text-xs sm:text-sm bg-black/40 px-3.5 py-1 rounded-full backdrop-blur-md border border-white/5 font-mono"
              >
                <span>Ready • Audio: {audioContextState.toUpperCase()}</span>
                {totalAudioSecondsScheduled > 0 && (
                  <span className="text-cyan-300/80">({totalAudioSecondsScheduled.toFixed(1)}s played)</span>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* The Visualizer Card */}
        {!videoSrc && (
          <div
            onClick={toggleListening}
            title={isSessionActive ? "Tap to end call" : "Tap to start call"}
            className="w-full max-w-[min(82vw,320px)] max-h-[min(44vh,300px)] aspect-square rounded-[28px] sm:rounded-[32px] bg-[#181A22]/90 border border-white/5 shadow-2xl relative overflow-hidden flex items-center justify-center cursor-pointer transition-transform hover:scale-[1.01] active:scale-[0.99] shrink min-h-0"
          >
            <Visualizer state={appState} />
          </div>
        )}
      </main>

      {/* FIXED CALL & MIC CONTROLS AT BOTTOM CENTER */}
      <div className="fixed bottom-3 sm:bottom-5 left-0 right-0 z-30 flex flex-col items-center justify-center px-4 pointer-events-none">
        {/* Text Input Drawer */}
        <AnimatePresence>
          {showTextInput && (
            <motion.form
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              onSubmit={handleTextSubmit}
              className="pointer-events-auto mb-3 w-full max-w-sm flex items-center gap-2 bg-[#181A22]/95 border border-white/10 rounded-full p-1.5 pl-4 backdrop-blur-md shadow-2xl"
            >
              <input
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder={`Ask ${config.assistantName} to open site, search YouTube...`}
                className="flex-1 bg-transparent border-none outline-none text-white placeholder:text-white/30 text-xs sm:text-sm"
                autoFocus
              />
              <button
                type="submit"
                disabled={!textInput.trim()}
                className="p-2 rounded-full bg-cyan-500 hover:bg-cyan-600 disabled:opacity-40 disabled:hover:bg-cyan-500 transition-colors text-black font-semibold cursor-pointer"
              >
                <Send size={15} />
              </button>
            </motion.form>
          )}
        </AnimatePresence>

        {/* Centered Controls Bar */}
        <div className="w-full max-w-sm flex items-center justify-center gap-2.5 sm:gap-3 pointer-events-auto">
          {/* Text input toggle button */}
          <button
            onClick={() => setShowTextInput(!showTextInput)}
            className={`p-3.5 sm:p-4 rounded-2xl sm:rounded-3xl border transition-colors shadow-lg cursor-pointer shrink-0 ${
              showTextInput
                ? "bg-[#252836] border-cyan-500/40 text-cyan-400"
                : "bg-[#181A22] border-white/5 text-white/70 hover:bg-[#252836] hover:text-white"
            }`}
            title="Type message"
          >
            <Keyboard size={20} />
          </button>

          {/* Call Start / Stop Button - Centered */}
          <button
            onClick={toggleListening}
            className={`
              flex-1 relative flex items-center justify-center gap-2 py-3.5 sm:py-4 px-5 rounded-2xl sm:rounded-3xl font-medium tracking-wide transition-all duration-200 shadow-xl cursor-pointer select-none
              ${
                isSessionActive
                  ? "bg-red-500/20 text-red-300 border border-red-500/50 hover:bg-red-500/30"
                  : visibleError
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30"
                  : "bg-[#252836] text-white border border-white/10 hover:bg-[#2F3346]"
              }
            `}
          >
            {isSessionActive ? (
              <>
                <MicOff size={20} className="text-red-400" />
                <span className="text-sm sm:text-base font-medium">End Call</span>
              </>
            ) : visibleError ? (
              <>
                <RefreshCw size={19} className="text-amber-400" />
                <span className="text-sm sm:text-base font-medium">Reconnect Call</span>
              </>
            ) : (
              <>
                <Mic size={20} className="text-cyan-400" />
                <span className="text-sm sm:text-base font-medium">Start Call</span>
              </>
            )}
          </button>

          {/* Volume Control Button: default unmuted & full volume */}
          <div className="relative shrink-0 flex items-center justify-center">
            <AnimatePresence>
              {showVolumeSlider && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: 10 }}
                  transition={{ duration: 0.15 }}
                  className="absolute bottom-full mb-3 px-4 py-3 bg-[#181A22] border border-white/10 rounded-2xl shadow-2xl z-50 flex flex-col items-center gap-2 min-w-[130px]"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex justify-between w-full text-[10px] text-white/50">
                    <span>Volume</span>
                    <span>{Math.round(volume * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={isMuted ? 0 : volume}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setVolume(val);
                      if (val === 0) setIsMuted(true);
                      else setIsMuted(false);
                    }}
                    className="w-full h-1.5 bg-white/20 rounded-full appearance-none cursor-pointer accent-cyan-400"
                  />
                </motion.div>
              )}
            </AnimatePresence>

            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowVolumeSlider(!showVolumeSlider);
              }}
              className={`p-3.5 sm:p-4 rounded-2xl sm:rounded-3xl border transition-colors shadow-lg cursor-pointer ${
                showVolumeSlider
                  ? "bg-[#252836] border-white/20 text-white"
                  : "bg-[#181A22] border-white/5 text-white/70 hover:bg-[#252836] hover:text-white"
              }`}
              title={`Speaker: ${isMuted ? "Muted" : `${Math.round(volume * 100)}%`}`}
            >
              {isMuted || volume === 0 ? (
                <VolumeX size={20} className="text-rose-400" />
              ) : (
                <Volume2 size={20} className="text-white/80" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Topic & Script Focus Modal */}
      {showTopicModal && (
        <TopicScriptModal
          assistantName={config?.assistantName}
          currentTopic={config?.activeTopicOrScript || ""}
          onSave={handleUpdateTopic}
          onClose={() => setShowTopicModal(false)}
        />
      )}

      {/* Voice Selection Modal */}
      {showVoiceModal && (
        <VoiceSelectorModal
          assistantName={config?.assistantName}
          currentVoice={config?.voiceName || "Kore"}
          onSelectVoice={handleSelectVoice}
          onClose={() => setShowVoiceModal(false)}
        />
      )}
    </div>
  );
}
