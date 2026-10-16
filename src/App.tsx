import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Mic,
  MicOff,
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
import PermissionModal from "./components/PermissionModal";
import SetupScreen from "./components/SetupScreen";
import SpecificationModal from "./components/SpecificationModal";
import TopicScriptModal from "./components/TopicScriptModal";
import VoiceSelectorModal from "./components/VoiceSelectorModal";
import RoseyOrbitCenter from "./components/RoseyOrbitCenter";
import Starfield from "./components/Starfield";
import { motion, AnimatePresence } from "motion/react";
import { AppConfig, AppState } from "./types";

const COLOR_PALETTE = [
  "#8b5cf6", // purple
  "#3b82f6", // blue
  "#22d3ee", // cyan
  "#14b8a6", // teal
  "#ec4899", // pink
  "#d946ef", // magenta
  "#f43f5e", // rose
  "#a78bfa", // violet
];
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
      const envKey =
        typeof process !== "undefined" && process.env?.GEMINI_API_KEY
          ? process.env.GEMINI_API_KEY
          : "";
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.voiceName !== "Aoede") {
          parsed.voiceName = "Kore";
        }
        if (!parsed.apiKey && envKey) {
          parsed.apiKey = envKey;
        }
        if (
          !parsed.assistantName ||
          parsed.assistantName.toLowerCase() === "xantrikx" ||
          parsed.assistantName === "Zoya" ||
          parsed.assistantName === "Companion"
        ) {
          parsed.assistantName = DEFAULT_ASSISTANT_NAME;
        }
        if (!parsed.userName || parsed.userName === "Ashwani") {
          parsed.userName = DEFAULT_USER_NAME;
        }
        if (
          !parsed.systemPrompt ||
          parsed.systemPrompt.includes("Ashwani") ||
          parsed.systemPrompt.includes("Zoya")
        ) {
          parsed.systemPrompt = DEFAULT_SYSTEM_PROMPT;
        }
        try {
          localStorage.setItem("zoya_app_config", JSON.stringify(parsed));
        } catch {}
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
  const [liveAudioLevel, setLiveAudioLevel] = useState<number>(0);

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
      ? `${config.assistantName} - AI Voice Assistant`
      : "Rosey - AI Voice Assistant";
  }, [config?.assistantName]);

  // Audio settings: default unmuted and full volume (1.0)
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1.0);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showSpecsModal, setShowSpecsModal] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Audio Diagnostics state displayed on screen
  const [audioContextState, setAudioContextState] = useState<string>("ready");
  const [audioSampleRate, setAudioSampleRate] = useState<number>(0);
  const [audioChunksCount, setAudioChunksCount] = useState<number>(0);
  const [totalAudioSecondsScheduled, setTotalAudioSecondsScheduled] = useState<number>(0);
  const [lastServerMsg, setLastServerMsg] = useState<string>("none");
  const [testSoundStatus, setTestSoundStatus] = useState<string | null>(null);

  // Visible on-screen error banner with close code & reason
  const [visibleError, setVisibleError] = useState<{
    message: string;
    type: "mic" | "playback" | "connection";
    code?: number;
    reason?: string;
  } | null>(null);

  // Tool notification banner
  const [activeToolNotification, setActiveToolNotification] =
    useState<ToolExecutionResult | null>(null);

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

  // Color cycle: smooth 1.8s transition every 2000ms looping forever through COLOR_PALETTE
  useEffect(() => {
    let colorIndex = 0;
    document.documentElement.style.setProperty("--accent", COLOR_PALETTE[0]);

    const interval = setInterval(() => {
      colorIndex = (colorIndex + 1) % COLOR_PALETTE.length;
      document.documentElement.style.setProperty(
        "--accent",
        COLOR_PALETTE[colorIndex]
      );
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  // Initialize AudioContext listeners
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
      setTestSoundStatus("Beeping...");
      const res = await playTestSound();
      setAudioContextState(res.state);
      setAudioSampleRate(res.sampleRate);
      setTestSoundStatus("Beep OK");
      setTimeout(() => setTestSoundStatus(null), 2500);
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
        const responseText = await getZoyaResponse(
          finalTranscript,
          messagesRef.current,
          config
        );

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
      setLiveAudioLevel(0);
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
            setLiveAudioLevel(0);
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

        session.onError = (err) => {
          console.error("[Session Error Handler]:", err);
          setIsSessionActive(false);
          setAppState("idle");
          setLiveAudioLevel(0);
          setVisibleError(err);
        };

        session.onAudioLevel = (level) => {
          if (level > 0.012) {
            setIsMicHearing(true);
          } else if (level < 0.005) {
            setIsMicHearing(false);
          }
          setLiveAudioLevel(Math.min(level * 8, 1));
        };

        session.onOutputAudioLevel = (level) => {
          setLiveAudioLevel(Math.min(level * 1.5, 1));
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
            message:
              "Microphone permission denied. Please allow microphone access in browser settings.",
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

  const handleClearChatHistory = () => {
    if (
      confirm("Are you sure you want to clear all memory and chat history?")
    ) {
      setMessages([]);
      resetZoyaSession();
      try {
        localStorage.removeItem("zoya_chat_history");
      } catch {}
    }
    setMenuOpen(false);
  };

  if (!config) {
    return <SetupScreen onComplete={handleConfigComplete} />;
  }

  const rawAssistantName = config?.assistantName;
  const assistantDisplayName =
    rawAssistantName && rawAssistantName.toLowerCase() !== "xantrikx"
      ? rawAssistantName
      : DEFAULT_ASSISTANT_NAME;
  const assistantInitial =
    assistantDisplayName.toLowerCase() === "xantrikx"
      ? "R"
      : assistantDisplayName.charAt(0).toUpperCase();

  return (
    <div
      className="h-[100dvh] max-h-[100dvh] w-screen bg-[#03050a] text-white flex flex-col justify-between items-center font-sans relative overflow-hidden select-none m-0 p-0"
      onClick={() => {
        setMenuOpen(false);
        setShowVolumeSlider(false);
      }}
    >
      {/* Background Starfield Particles & 60% Screen Ambient Radial Accent Glow */}
      <Starfield
        glowScale={1 + Math.min(liveAudioLevel * 0.16, 0.2)}
        glowOpacity={isSessionActive ? 0.95 : 0.85}
      />

      {/* Video Background Layer if user uploaded custom video */}
      {videoSrc && (
        <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden bg-black flex items-center justify-center">
          <video
            ref={bgVideoRef}
            src={videoSrc}
            loop
            muted={true}
            playsInline
            className="absolute inset-0 w-full h-full object-cover opacity-35 blur-2xl scale-110"
          />
          <video
            ref={mainVideoRef}
            src={videoSrc}
            loop
            muted={true}
            playsInline
            className="relative w-full h-full object-contain opacity-85 z-10"
          />
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <SetupScreen
          initialConfig={config}
          onComplete={handleConfigComplete}
          onCancel={() => setShowSettings(false)}
        />
      )}

      {/* Specification Modal */}
      <SpecificationModal
        isOpen={showSpecsModal}
        onClose={() => setShowSpecsModal(false)}
        isUpdateAvailable={updateInfo.isUpdateAvailable}
        latestVersion={updateInfo.latestVersion}
      />

      {/* Permission Modal */}
      {showPermissionModal && (
        <PermissionModal
          assistantName={config?.assistantName}
          onClose={() => setShowPermissionModal(false)}
        />
      )}

      {/* iOS PWA Guide Modal */}
      {showIOSGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-3xl bg-[#0c101d] p-8 border border-white/10 shadow-2xl flex flex-col items-center text-center gap-6">
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

      {/* Android PWA Guide Modal */}
      {showAndroidGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-3xl bg-[#0c101d] p-8 border border-white/10 shadow-2xl flex flex-col items-center text-center gap-6">
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

      {/* Floating Error Banner with Close Code, Reason, and Reconnect button */}
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
                  <p className="text-xs font-semibold text-rose-300">
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
            className="fixed top-16 left-4 right-4 sm:left-auto sm:right-auto sm:w-[460px] z-40 bg-[#0c101d]/95 border border-[var(--accent)]/40 text-white px-4 py-3 rounded-2xl shadow-2xl backdrop-blur-md flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="p-2 rounded-xl bg-[var(--accent-soft)] text-white shrink-0">
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
                  <span className="text-[11px] font-semibold text-[var(--accent)]">
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
                className="text-xs flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--accent-soft)] hover:opacity-90 text-white font-medium border border-[var(--accent)]/40 cursor-pointer"
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

      {/* TOP BAR: Top-Left Avatar & Name | Top-Right Glassmorphism Buttons */}
      <header className="w-full flex justify-between items-center z-30 shrink-0 px-4 py-3 sm:px-8 sm:py-5">
        {/* Top-Left: Round gradient avatar badge (accent to blue) with letter "R" and name "Rosey" in plain white text */}
        <div className="flex items-center gap-3.5">
          <div
            className="w-11 h-11 sm:w-12 sm:h-12 rounded-full flex items-center justify-center font-bold text-white text-xl border border-white/20 shadow-lg cursor-pointer transition-transform hover:scale-105 active:scale-95 select-none shrink-0"
            style={{
              background: "linear-gradient(135deg, var(--accent) 0%, #3b82f6 100%)",
              boxShadow: "0 0 20px var(--glow)",
            }}
            title={`${assistantDisplayName} - Created by Rishi`}
          >
            R
          </div>
          <span className="font-['Quicksand',sans-serif] font-bold text-xl sm:text-2xl text-white select-none">
            {assistantDisplayName}
          </span>
        </div>

        {/* Top-Right: Smaller 44px round glass icons to the left + Round 56px glass buttons: trash & speaker */}
        <div className="flex items-center gap-2 sm:gap-2.5">
          {/* Test Sound Button (44px) */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleTestSound();
            }}
            className="w-[44px] h-[44px] rounded-full bg-white/[0.06] hover:bg-white/[0.14] border border-white/10 backdrop-blur-xl flex items-center justify-center text-cyan-300 hover:text-white transition-transform duration-200 hover:scale-105 active:scale-95 shadow-md cursor-pointer"
            title={testSoundStatus || "Play test audio tone"}
          >
            <BellRing size={19} />
          </button>

          {/* Topic & Script Focus Button (44px) */}
          <button
            onClick={() => setShowTopicModal(true)}
            className="w-[44px] h-[44px] rounded-full bg-white/[0.06] hover:bg-white/[0.14] border border-white/10 backdrop-blur-xl flex items-center justify-center text-amber-300 hover:text-white transition-transform duration-200 hover:scale-105 active:scale-95 shadow-md relative cursor-pointer"
            title="Topic & Script Focus"
          >
            <ScrollText size={19} />
            {config?.activeTopicOrScript?.trim() && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_8px_#fbbf24]" />
            )}
          </button>

          {/* Settings Menu Button (44px) */}
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(!menuOpen);
              }}
              className="w-[44px] h-[44px] rounded-full bg-white/[0.06] hover:bg-white/[0.14] border border-white/10 backdrop-blur-xl flex items-center justify-center text-pink-300 hover:text-white transition-transform duration-200 hover:scale-105 active:scale-95 shadow-md relative cursor-pointer"
              title="Settings & Setup"
            >
              <Settings size={19} />
              {updateInfo.isUpdateAvailable && (
                <span className="absolute top-1 right-1 flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500"></span>
                </span>
              )}
            </button>

            {/* Settings Dropdown */}
            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: -10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -10 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-full mt-2 w-56 bg-[#0c101d]/95 border border-white/10 backdrop-blur-2xl rounded-2xl shadow-2xl py-1.5 z-50 overflow-hidden"
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
                      <Cpu size={16} className="text-cyan-400" />
                      <span>Specification</span>
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-semibold">
                      {APP_VERSION_INFO.version}
                    </span>
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
                    onClick={handleClearChatHistory}
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

          {/* Round 56px Glass Button: Trash (Clear Chat) */}
          <button
            onClick={handleClearChatHistory}
            className="w-[56px] h-[56px] rounded-full bg-white/[0.06] hover:bg-white/[0.14] border border-white/10 backdrop-blur-xl flex items-center justify-center text-white/90 hover:text-white transition-transform duration-200 hover:scale-105 active:scale-95 shadow-lg cursor-pointer"
            title="Clear memory and conversation"
          >
            <Trash2 size={22} />
          </button>

          {/* Round 56px Glass Button: Speaker (Volume) */}
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowVolumeSlider(!showVolumeSlider);
              }}
              className={`w-[56px] h-[56px] rounded-full border backdrop-blur-xl flex items-center justify-center transition-transform duration-200 hover:scale-105 active:scale-95 shadow-lg cursor-pointer ${
                showVolumeSlider
                  ? "bg-white/[0.22] border-white/30 text-white"
                  : "bg-white/[0.06] hover:bg-white/[0.14] border-white/10 text-white/90 hover:text-white"
              }`}
              title={`Speaker: ${isMuted ? "Muted" : `${Math.round(volume * 100)}%`}`}
            >
              {isMuted || volume === 0 ? (
                <VolumeX size={22} className="text-rose-400" />
              ) : (
                <Volume2 size={22} />
              )}
            </button>

            {/* Volume Slider Popover */}
            <AnimatePresence>
              {showVolumeSlider && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9, y: -10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: -10 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-full mt-2 px-4 py-3 bg-[#0c101d]/90 border border-white/10 backdrop-blur-xl rounded-2xl shadow-2xl z-50 flex flex-col items-center gap-2 min-w-[140px]"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex justify-between w-full text-[10px] font-mono text-white/60">
                    <span>VOLUME</span>
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
                    className="w-full h-1.5 bg-white/20 rounded-full appearance-none cursor-pointer accent-[var(--accent)]"
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      {/* CENTER: Glowing Glass Pill Capsule with "Rosey" & Tilted Orbit Rings */}
      <main className="flex-1 w-full relative flex items-center justify-center overflow-visible z-10 px-4">
        <RoseyOrbitCenter
          assistantName={assistantDisplayName}
          appState={appState}
          isMicHearing={isMicHearing}
          audioLevel={liveAudioLevel}
          onToggleCall={toggleListening}
        />

        {/* RIGHT SIDE (Vertically Centered at far right): Glowing Accent Dot & Italic Status Text */}
        <div className="absolute right-4 sm:right-7 md:right-10 top-1/2 -translate-y-1/2 flex items-center gap-2.5 z-20 pointer-events-none select-none">
          <div
            className="w-2.5 h-2.5 rounded-full bg-[var(--accent)] shadow-[0_0_12px_var(--accent)] transition-all duration-300"
          />
          <span className="font-['Quicksand',sans-serif] font-semibold italic text-sm sm:text-base text-white/90 drop-shadow">
            {appState === "listening"
              ? "Listening..."
              : appState === "speaking"
              ? "Speaking..."
              : appState === "processing"
              ? "Thinking..."
              : "Ready"}
          </span>
        </div>
      </main>

      {/* BOTTOM CONTROLS: Glowing Glass Pill Call Button & Keyboard Drawer */}
      <footer className="w-full shrink-0 z-30 pb-[32px] pt-2 flex flex-col items-center justify-center px-4 pointer-events-none">
        {/* Text Input Drawer */}
        <AnimatePresence>
          {showTextInput && (
            <motion.form
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              onSubmit={handleTextSubmit}
              className="pointer-events-auto mb-3.5 w-full max-w-md flex items-center gap-2 bg-[#0c101d]/95 border border-[var(--accent)]/40 rounded-full p-2 pl-4 backdrop-blur-2xl shadow-2xl"
            >
              <input
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder={`Ask ${assistantDisplayName} anything or to search...`}
                className="flex-1 bg-transparent border-none outline-none text-white placeholder:text-white/30 text-xs sm:text-sm font-['Quicksand',sans-serif] font-medium"
                autoFocus
              />
              <button
                type="submit"
                disabled={!textInput.trim()}
                className="p-2.5 rounded-full text-white font-semibold cursor-pointer disabled:opacity-40 transition-all hover:scale-105 active:scale-95"
                style={{
                  backgroundColor: "var(--accent)",
                  boxShadow: "0 0 14px var(--glow)",
                }}
              >
                <Send size={15} />
              </button>
            </motion.form>
          )}
        </AnimatePresence>

        {/* Bottom Center Bar: Call Pill Button + Round Keyboard Button */}
        <div className="flex items-center justify-center gap-3.5 pointer-events-auto">
          {/* Main Glowing Glass Pill Call Button: width ~15vw (min 230px, max 300px), height ~8vh (min 64px, max 80px) */}
          <button
            onClick={toggleListening}
            className={`
              relative w-[18vw] min-w-[230px] max-w-[300px] h-[8vh] min-h-[64px] max-h-[80px] rounded-full flex items-center justify-center gap-3
              font-['Quicksand',sans-serif] font-bold text-lg sm:text-[19px] transition-transform duration-200 cursor-pointer select-none backdrop-blur-xl border
              hover:scale-[1.04] active:scale-[0.97]
              ${
                isSessionActive
                  ? "border-red-500/80 text-white"
                  : visibleError
                  ? "bg-amber-500/20 border-amber-500/80 text-amber-100 shadow-[0_0_28px_rgba(245,158,11,0.55)]"
                  : "text-white"
              }
            `}
            style={
              isSessionActive
                ? {
                    backgroundColor: "rgba(220, 38, 38, 0.28)",
                    borderColor: "rgba(239, 68, 68, 0.85)",
                    boxShadow: "0 0 35px rgba(239, 68, 68, 0.65), inset 0 1px 0 rgba(255, 255, 255, 0.25)",
                  }
                : !visibleError
                ? {
                    backgroundColor: "color-mix(in srgb, var(--accent) 18%, rgba(10, 14, 26, 0.65))",
                    borderColor: "var(--accent)",
                    boxShadow: "0 0 30px var(--glow), inset 0 1px 0 rgba(255, 255, 255, 0.25)",
                  }
                : undefined
            }
          >
            {/* Gentle pulsing glow when idle (transform and opacity only) */}
            {!isSessionActive && !visibleError && (
              <span
                aria-hidden="true"
                className="absolute -inset-[1px] rounded-full pointer-events-none animate-idle-glow"
                style={{
                  boxShadow: "0 0 28px var(--glow), inset 0 0 12px var(--glow)",
                  border: "1px solid var(--accent)",
                }}
              />
            )}

            {isSessionActive ? (
              <>
                <MicOff size={22} className="text-red-300 shrink-0" />
                <span>End Session</span>
              </>
            ) : visibleError ? (
              <>
                <RefreshCw size={22} className="text-amber-400 shrink-0" />
                <span>Reconnect Session</span>
              </>
            ) : (
              <>
                <Mic size={22} style={{ color: "var(--accent)" }} className="shrink-0" />
                <span>Start Session</span>
              </>
            )}
          </button>

          {/* Small Round 48px Glass Keyboard Button beside it */}
          <button
            onClick={() => setShowTextInput(!showTextInput)}
            className={`w-[48px] h-[48px] min-w-[48px] rounded-full border backdrop-blur-xl flex items-center justify-center transition-transform duration-200 hover:scale-[1.04] active:scale-[0.97] shadow-lg cursor-pointer ${
              showTextInput
                ? "bg-white/[0.22] border-[var(--accent)] text-white shadow-[0_0_15px_var(--glow)]"
                : "bg-white/[0.06] hover:bg-white/[0.14] border-white/10 text-white/80 hover:text-white"
            }`}
            title="Type message"
          >
            <Keyboard size={20} />
          </button>
        </div>
      </footer>

      {/* Modals */}
      {showTopicModal && (
        <TopicScriptModal
          assistantName={config?.assistantName}
          currentTopic={config?.activeTopicOrScript || ""}
          onSave={handleUpdateTopic}
          onClose={() => setShowTopicModal(false)}
        />
      )}

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
