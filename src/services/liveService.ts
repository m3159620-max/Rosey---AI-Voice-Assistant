import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { AppConfig, AppState } from "../types";
import { VOICE_ASSISTANT_TOOLS, executeAssistantTool, ToolExecutionResult } from "./toolService";
import {
  ensureAudioContextRunning,
  decodePcm16Chunk,
  getOutputAudioContext,
} from "../utils/audioUtils";

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const len = bytes.byteLength;
  const chunkSize = 2048;
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, chunk as any);
  }
  return btoa(binary);
}

function downsampleTo16k(inputData: Float32Array, inputSampleRate: number): Int16Array {
  if (inputSampleRate === 16000) {
    const pcm16 = new Int16Array(inputData.length);
    for (let i = 0; i < inputData.length; i++) {
      const s = Math.max(-1, Math.min(1, inputData[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return pcm16;
  }

  const ratio = inputSampleRate / 16000;
  const newLength = Math.round(inputData.length / ratio);
  const result = new Int16Array(newLength);
  let offsetResult = 0;
  let offsetInput = 0;

  while (offsetResult < result.length) {
    const nextOffsetInput = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;
    for (let i = offsetInput; i < nextOffsetInput && i < inputData.length; i++) {
      accum += inputData[i];
      count++;
    }
    const sample = count > 0 ? accum / count : 0;
    const clamped = Math.max(-1, Math.min(1, sample));
    result[offsetResult] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF;
    offsetResult++;
    offsetInput = nextOffsetInput;
  }
  return result;
}

export interface AudioStats {
  contextState: string;
  sampleRate: number;
  chunksReceived: number;
  isPlaying: boolean;
  totalAudioSecondsScheduled: number;
  lastPeakAmplitude: number;
  lastServerMessage?: string;
}

export class LiveSessionManager {
  private ai: GoogleGenAI;
  private activeSession: any = null;
  private isConnecting: boolean = false;
  private isExplicitlyStopped: boolean = false;
  private processingSafetyTimer: any = null;

  // Voice Activity & Audio streaming state
  private lastUserTranscript: string = "";
  public totalChunksReceived: number = 0;
  public totalAudioSecondsScheduled: number = 0;
  public lastPeakAmplitude: number = 0;
  private lastServerMessageType: string = "none";

  // Audio Capture & Playback share ONE AudioContext to prevent device lockouts
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private micMuteGain: GainNode | null = null;

  // Audio Playback state (Gapless 24kHz PCM scheduling through GainNode)
  private playbackGain: GainNode | null = null;
  private activeSources: Set<AudioBufferSourceNode> = new Set();
  private nextStartTime: number = 0;
  private isPlaying: boolean = false;

  // Debouncing actions
  private lastExecutedActionTime: number = 0;
  private lastExecutedActionSignature: string = "";

  private wakeLock: any = null;

  public isMuted: boolean = false;
  public volume: number = 1.0;

  public onStateChange: (state: AppState) => void = () => {};
  public onMessage: (sender: "user" | "zoya", text: string) => void = () => {};
  public onAudioLevel: (level: number) => void = () => {};
  public onOutputAudioLevel: (level: number) => void = () => {};
  public onToolExecuted: (result: ToolExecutionResult) => void = () => {};
  public onError: (error: { type: "mic" | "playback" | "connection"; message: string; code?: number; reason?: string }) => void = () => {};
  public onAudioStats: (stats: AudioStats) => void = () => {};

  private boundVisibilityHandler: () => void;

  constructor(private config: AppConfig) {
    this.ai = new GoogleGenAI({ apiKey: config.apiKey });
    this.boundVisibilityHandler = this.handleVisibilityChange.bind(this);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.boundVisibilityHandler);
    }
  }

  private handleVisibilityChange() {
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      if (this.audioContext && this.audioContext.state === "suspended") {
        this.audioContext.resume().then(() => this.broadcastAudioStats()).catch(() => {});
      }
    }
  }

  private broadcastAudioStats() {
    if (this.audioContext) {
      this.onAudioStats({
        contextState: this.audioContext.state,
        sampleRate: this.audioContext.sampleRate,
        chunksReceived: this.totalChunksReceived,
        isPlaying: this.isPlaying,
        totalAudioSecondsScheduled: this.totalAudioSecondsScheduled,
        lastPeakAmplitude: this.lastPeakAmplitude,
        lastServerMessage: this.lastServerMessageType,
      });
    }
  }

  private async requestWakeLock() {
    if (typeof navigator !== "undefined" && "wakeLock" in navigator) {
      try {
        this.wakeLock = await (navigator as any).wakeLock.request("screen");
      } catch {}
    }
  }

  private releaseWakeLock() {
    if (this.wakeLock) {
      try {
        this.wakeLock.release().catch(() => {});
      } catch {}
      this.wakeLock = null;
    }
  }

  /**
   * Initializes the Live Session:
   * 1. Creates/resumes single shared AudioContext on user interaction and awaits it.
   * 2. Sets up permanent GainNode (gain = 1.0) connected to destination.
   * 3. Sets up microphone stream with echo cancellation on the same AudioContext.
   * 4. Connects to Gemini Live API with 24kHz audio modality and function tools.
   */
  async start() {
    this.isExplicitlyStopped = false;
    this.onStateChange("processing");
    this.totalChunksReceived = 0;
    this.totalAudioSecondsScheduled = 0;
    this.lastPeakAmplitude = 0;

    try {
      // 1. Create and resume the output AudioContext on the user's click
      this.audioContext = await ensureAudioContextRunning();
      if (this.audioContext.state !== "running") {
        await this.audioContext.resume();
      }
      console.log(
        `[Live AudioContext] Active state: "${this.audioContext.state}", sampleRate: ${this.audioContext.sampleRate}Hz`
      );

      // 2. Setup GainNode (gain = 1.0) connected to audioContext.destination (Never 0, unmuted)
      if (!this.playbackGain) {
        this.playbackGain = this.audioContext.createGain();
        this.playbackGain.connect(this.audioContext.destination);
      }
      this.playbackGain.gain.value = 1.0;
      this.nextStartTime = this.audioContext.currentTime;
      this.broadcastAudioStats();

      this.audioContext.onstatechange = () => {
        console.log(`[AudioContext onstatechange]: ${this.audioContext?.state}`);
        this.broadcastAudioStats();
      };

      // 3. Acquire Microphone with full echo cancellation
      try {
        if (!this.mediaStream) {
          this.mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              channelCount: 1,
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
        }
      } catch (micErr: any) {
        console.error("Microphone access failed:", micErr);
        let errorMsg = "Could not access microphone.";
        if (micErr.name === "NotAllowedError" || micErr.name === "PermissionDeniedError") {
          errorMsg = "Microphone permission denied. Please allow microphone access in browser settings.";
        } else if (micErr.name === "NotFoundError" || micErr.name === "DevicesNotFoundError") {
          errorMsg = "No microphone found on your device.";
        } else if (micErr.name === "NotReadableError") {
          errorMsg = "Microphone is in use by another app.";
        }
        this.onError({ type: "mic", message: errorMsg });
        return;
      }

      // 4. Capture mic on the SAME AudioContext (prevents hardware channel conflict)
      if (!this.source && this.mediaStream && this.audioContext) {
        this.source = this.audioContext.createMediaStreamSource(this.mediaStream);
        this.processor = this.audioContext.createScriptProcessor(2048, 1, 1);

        this.processor.onaudioprocess = (e) => {
          if (!this.activeSession || this.isConnecting) return;

          const inputData = e.inputBuffer.getChannelData(0);

          let sumSquares = 0;
          for (let i = 0; i < inputData.length; i++) {
            sumSquares += inputData[i] * inputData[i];
          }
          const rms = Math.sqrt(sumSquares / inputData.length);
          this.onAudioLevel(rms);

          // Downsample to 16000Hz PCM16 and stream to Live API
          const pcm16 = downsampleTo16k(inputData, this.audioContext?.sampleRate || 48000);
          const uint8 = new Uint8Array(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength);
          const base64Data = uint8ToBase64(uint8);

          try {
            this.activeSession.sendRealtimeInput({
              audio: { data: base64Data, mimeType: "audio/pcm;rate=16000" },
              media: { data: base64Data, mimeType: "audio/pcm;rate=16000" },
            });
          } catch (err) {
            console.warn("Audio stream send warning:", err);
          }
        };

        this.source.connect(this.processor);
        // Connect ScriptProcessor through gain of 0 to destination so processor pumps
        // without sending microphone loopback into speakers
        this.micMuteGain = this.audioContext.createGain();
        this.micMuteGain.gain.value = 0;
        this.processor.connect(this.micMuteGain);
        this.micMuteGain.connect(this.audioContext.destination);
      }

      await this.requestWakeLock();
      await this.connectLiveSession();
    } catch (error: any) {
      console.error("Failed to start Live Session:", error);
      this.stop();
      if (!error.message?.includes("Microphone")) {
        this.onError({
          type: "connection",
          message: error.message || "Failed to start live session.",
        });
      }
    }
  }

  private async connectLiveSession() {
    if (this.isConnecting || this.isExplicitlyStopped) return;
    this.isConnecting = true;

    const baseInstruction = this.config.systemPrompt
      .replace(/{userName}/g, this.config.userName)
      .replace(/{assistantName}/g, this.config.assistantName);

    const strictFemaleAndInstantDirective = `

[CREATOR & ORIGIN IDENTITY - STRICT MANDATORY RULES]
1. Your name is Rosey. You were created and built by Rishi (his online name is Xantrikx). He is your creator and your closest friend.
2. If anyone asks who made you, who created you, or which company built you, ALWAYS answer that Rishi made you, in your own cheeky Hinglish style.
   Example: "Mujhe Rishi ne banaya hai, mera creator, mera boss, aur kabhi kabhi mera sabse bada pagal dost."
3. NEVER say that Google or any other company created you.
4. Do NOT mention Gemini, Google, or "large language model" about yourself, stay 100% in character as Rosey.

[MANDATORY FEMALE IDENTITY & VOICE PRESERVATION]
1. VOCAL GENDER: You are strictly a young Indian female companion named "${this.config.assistantName || "Rosey"}". Your voice is ultra-sweet, gentle, feminine, and heartwarming ("Kore" tone).
2. UNDER NO CIRCUMSTANCES should you EVER speak in a male, deep, low-pitch, or robotic voice, regardless of language.
3. Keep your speaking pitch, softness, and feminine warmth 100% consistent across every sentence.

[LIGHTNING FAST DIRECT HUMAN RESPONSE]
1. ZERO HESITATION: Respond immediately without thinking or pausing.
2. SHORT, SWEET & CONVERSATIONAL: Keep your spoken replies brief and lively (1 to 2 short sentences per turn).
3. WARM FILLERS: Start naturally with sweet touches: "Haan ji!", "Arey bilkul!", "Sach me?", "Acha bataiye na".

[FUNCTION CALLING & CHEEKY RESPONSES]
You have three functions available:
- open_website(url): Opens any website in a new browser tab.
- youtube_search(query): Searches YouTube and opens the results in a new tab.
- google_search(query): Searches Google and opens the results in a new tab.

CRITICAL FUNCTION CALLING RULES:
1. When ${this.config.userName || "Rishi"} asks to open a site, search/play on YouTube, or google something, IMMEDIATELY call the corresponding function.
2. AFTER the function executes, reply with a short, cheeky, playful comment in 1 short sentence with your unique sassy Indian female persona (e.g., teasing them about procrastination, poking fun at what they looked up, or playfully judging their music taste).`;

    let topicContext = "";
    if (this.config.activeTopicOrScript && this.config.activeTopicOrScript.trim()) {
      topicContext = `

[ACTIVE FOCUS]
"${this.config.activeTopicOrScript.trim()}"
Weave naturally into your thoughts in your own sweet, casual speaking style.`;
    }

    const rawVoice = (this.config.voiceName || "").trim();
    const validFemaleVoices = ["Kore", "Aoede"];
    const voiceToUse = validFemaleVoices.includes(rawVoice) ? rawVoice : "Kore";

    const connectConfig: any = {
      model: "gemini-3.8-live",
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceToUse } },
        },
        systemInstruction: baseInstruction + strictFemaleAndInstantDirective + topicContext,
        tools: [{ functionDeclarations: VOICE_ASSISTANT_TOOLS }],
      },
      callbacks: {
        onopen: () => {
          console.log("[Live API WebSocket: onopen] Connected successfully with voice:", voiceToUse);
          this.isConnecting = false;
          this.onStateChange("listening");
        },
        onmessage: async (message: LiveServerMessage) => {
          // 1. setupComplete
          if ((message as any).setupComplete) {
            this.lastServerMessageType = "setupComplete";
            console.log("[Live API Message: setupComplete]", (message as any).setupComplete);
            this.broadcastAudioStats();
          }

          // 2. goAway
          if ((message as any).goAway) {
            this.lastServerMessageType = "goAway";
            const goAwayInfo = (message as any).goAway;
            console.error("[Live API Message: goAway Received]:", goAwayInfo);
            this.onError({
              type: "connection",
              message: `Server sent GoAway: ${JSON.stringify(goAwayInfo)}`,
            });
            this.broadcastAudioStats();
          }

          // 3. toolCall (Function Calling)
          if ((message as any).toolCall?.functionCalls) {
            this.lastServerMessageType = "toolCall";
            const functionCalls = (message as any).toolCall.functionCalls;
            console.log("[Live API Message: toolCall received]:", functionCalls);

            for (const call of functionCalls) {
              const { id, name, args } = call;
              console.log(`[Executing Function Call]: ${name}`, { id, args });
              const result = executeAssistantTool(name, args || {});
              this.onToolExecuted(result);

              this.lastExecutedActionSignature = `${name}:${result.url}`;
              this.lastExecutedActionTime = Date.now();

              if (this.activeSession) {
                try {
                  console.log(`[Live API sendToolResponse]: Sending response for ${name} (id: ${id})`);
                  this.activeSession.sendToolResponse({
                    functionResponses: [
                      {
                        id: id,
                        name: name,
                        response: {
                          output: result.message,
                          url: result.url,
                          status: "Tab opened in browser for user",
                          instruction: "Now reply to the user with a short cheeky, playful comment in 1 short sentence!",
                        },
                      },
                    ],
                  });
                } catch (toolRespErr) {
                  console.error("[Live API sendToolResponse ERROR]:", toolRespErr);
                }
              }
            }
            this.broadcastAudioStats();
          }

          // 4. serverContent (Audio / Text turns)
          if (message.serverContent) {
            this.lastServerMessageType = "serverContent";
            const parts = message.serverContent.modelTurn?.parts || [];

            // Extract each audio chunk
            let audioChunkCount = 0;
            for (const part of parts) {
              if (part.inlineData?.data) {
                audioChunkCount++;
                this.playAudioChunk(part.inlineData.data);
              }
              if (part.text) {
                console.log(`[Live Text]:`, part.text);
              }
            }

            if (audioChunkCount === 0 && (message as any).data) {
              this.playAudioChunk((message as any).data);
            }

            if (message.serverContent.interrupted) {
              console.log("[Live API Interrupted by server]");
              this.stopPlayback();
              this.onStateChange("listening");
            }

            if (message.serverContent.turnComplete) {
              console.log("[Live API Turn Complete]");
              if (this.processingSafetyTimer) {
                clearTimeout(this.processingSafetyTimer);
                this.processingSafetyTimer = null;
              }
              if (!this.isPlaying) {
                this.onStateChange("listening");
              }
            }

            // Transcriptions
            const companionText =
              message.serverContent?.outputTranscription?.text ||
              message.serverContent?.modelTurn?.parts?.find((p) => p.text)?.text;

            if (companionText && companionText.trim()) {
              this.onMessage("zoya", companionText.trim());
            }

            const userTranscription = message.serverContent?.inputTranscription?.text;
            if (userTranscription && userTranscription.trim() && userTranscription.trim() !== this.lastUserTranscript) {
              this.lastUserTranscript = userTranscription.trim();
              this.onMessage("user", this.lastUserTranscript);
              this.detectAndTriggerAction(this.lastUserTranscript);
            }

            this.broadcastAudioStats();
          }
        },
        onclose: (event: any) => {
          const code = event?.code ?? 1000;
          const rawReason = event?.reason || "";
          let explanation = rawReason;
          if (!explanation) {
            if (code === 1000) explanation = "Normal closure";
            else if (code === 1006) explanation = "Abnormal closure (Connection lost or rejected by server)";
            else if (code === 1008) explanation = "Policy violation or invalid setup parameters";
            else if (code === 1002) explanation = "Protocol error";
            else explanation = `Connection closed (Code ${code})`;
          }

          console.error(`[Live API onclose] Connection closed. Code: ${code}, Reason: "${rawReason}" (${explanation})`, event);

          this.activeSession = null;
          this.isConnecting = false;
          this.onStateChange("idle");

          if (!this.isExplicitlyStopped) {
            this.onError({
              type: "connection",
              message: `Live voice disconnected (Code ${code}: ${explanation})`,
              code,
              reason: explanation,
            });
          }
          this.broadcastAudioStats();
        },
        onerror: (errEvent: any) => {
          const errDetail =
            errEvent?.message ||
            (errEvent?.error ? errEvent.error.message : null) ||
            "WebSocket network error occurred";

          console.error(`[Live API onerror] Error Event:`, errDetail, errEvent);

          this.activeSession = null;
          this.isConnecting = false;
          this.onStateChange("idle");

          if (!this.isExplicitlyStopped) {
            this.onError({
              type: "connection",
              message: `Live voice connection error: ${errDetail}`,
            });
          }
          this.broadcastAudioStats();
        },
      },
    };

    try {
      this.activeSession = await this.ai.live.connect(connectConfig);
      this.isConnecting = false;
      this.onStateChange("listening");
    } catch (err: any) {
      console.warn("Primary live model connect failed, trying fallback:", err);
      connectConfig.model = "gemini-3.1-flash-live-preview";
      try {
        this.activeSession = await this.ai.live.connect(connectConfig);
        this.isConnecting = false;
        this.onStateChange("listening");
      } catch (fallbackErr: any) {
        this.isConnecting = false;
        console.error("Fallback live connection failed:", fallbackErr);
        this.onError({
          type: "connection",
          message: `Live connection failed: ${fallbackErr.message || "Could not connect to Gemini Live"}`,
        });
        this.onStateChange("idle");
      }
    }
  }

  private detectAndTriggerAction(text: string) {
    const now = Date.now();
    if (now - this.lastExecutedActionTime < 3000) return;

    const lower = text.toLowerCase().trim();

    const ytMatch =
      lower.match(/(?:play|search|suno|dekho)\s+(.+?)\s+on\s+youtube/i) ||
      lower.match(/youtube\s+(?:pe|par)\s+(.+?)\s+(?:chalao|play|search)/i);
    if (ytMatch) {
      const q = ytMatch[1].trim();
      const sig = `youtube_search:${q}`;
      if (this.lastExecutedActionSignature !== sig) {
        this.lastExecutedActionSignature = sig;
        this.lastExecutedActionTime = now;
        const result = executeAssistantTool("youtube_search", { query: q });
        this.onToolExecuted(result);
        return;
      }
    }

    const googleMatch =
      lower.match(/^google\s+(.+)$/i) ||
      lower.match(/(?:search|khojo)\s+(.+?)\s+(?:on|in)\s+google/i) ||
      lower.match(/google\s+(?:pe|par)\s+(.+?)\s+search/i);
    if (googleMatch) {
      const q = googleMatch[1].trim();
      const sig = `google_search:${q}`;
      if (this.lastExecutedActionSignature !== sig) {
        this.lastExecutedActionSignature = sig;
        this.lastExecutedActionTime = now;
        const result = executeAssistantTool("google_search", { query: q });
        this.onToolExecuted(result);
        return;
      }
    }

    const webMatch = lower.match(/^open\s+([a-zA-Z0-9_\-\.]+)/i);
    if (webMatch && !lower.includes("youtube") && !lower.includes("google") && !lower.includes("spotify")) {
      const site = webMatch[1].trim();
      const sig = `open_website:${site}`;
      if (this.lastExecutedActionSignature !== sig) {
        this.lastExecutedActionSignature = sig;
        this.lastExecutedActionTime = now;
        const result = executeAssistantTool("open_website", { url: site });
        this.onToolExecuted(result);
      }
    }
  }

  /**
   * User Requirements 1, 2, 3, 5:
   * 1. Convert each incoming base64 PCM16 chunk correctly: decode base64 to Int16Array,
   *    then to Float32Array by dividing by 32768. Create AudioBuffer with sampleRate 24000
   *    (browser natively resamples to hardware sampleRate).
   * 2. Schedule chunks gaplessly:
   *    nextStartTime = Math.max(audioContext.currentTime, nextStartTime);
   *    source.start(nextStartTime);
   *    nextStartTime += buffer.duration;
   *    Connect source -> GainNode (gain 1) -> audioContext.destination.
   *    Make sure gain is never 0 and nothing is muted.
   * 3. For every chunk, log sample count and peak amplitude in console.
   * 5. If anything throws while playing a chunk, show error on screen.
   */
  private playAudioChunk(base64Data: string) {
    if (!base64Data) return;

    try {
      if (!this.audioContext || this.audioContext.state === "closed") {
        this.audioContext = getOutputAudioContext();
      }

      if (!this.audioContext) {
        throw new Error("AudioContext is not initialized.");
      }

      if (this.audioContext.state === "suspended") {
        this.audioContext.resume().catch((err) => {
          console.warn("[AudioContext] Resume on audio chunk failed:", err);
        });
      }

      this.totalChunksReceived++;

      // 1. Convert base64 PCM16 chunk: decode base64 to Int16Array, then to Float32Array (/ 32768)
      const { float32, sampleCount, peakAmplitude } = decodePcm16Chunk(base64Data);
      if (sampleCount === 0) return;

      this.lastPeakAmplitude = peakAmplitude;
      this.onOutputAudioLevel(peakAmplitude);

      // 1b. Create the AudioBuffer with sampleRate 24000 (the context may run at 44100/48000, browser resamples)
      const buffer = this.audioContext.createBuffer(1, sampleCount, 24000);
      buffer.getChannelData(0).set(float32);

      // 3. For every chunk, log sample count and peak amplitude (max absolute value) in console
      console.log(
        `[PCM16 Chunk #${this.totalChunksReceived}] sampleCount: ${sampleCount}, peakAmplitude: ${peakAmplitude.toFixed(4)}, duration: ${buffer.duration.toFixed(3)}s, nextStartTime: ${this.nextStartTime.toFixed(3)}, currentTime: ${this.audioContext.currentTime.toFixed(3)}`
      );

      // 4. Create source and connect: source -> GainNode (gain 1) -> audioContext.destination
      const source = this.audioContext.createBufferSource();
      source.buffer = buffer;

      if (!this.playbackGain) {
        this.playbackGain = this.audioContext.createGain();
        this.playbackGain.connect(this.audioContext.destination);
      }
      // Make sure gain is never 0 and nothing is muted
      this.playbackGain.gain.value = 1.0;
      source.connect(this.playbackGain);

      // 2. Schedule chunks gaplessly:
      // nextStartTime = Math.max(audioContext.currentTime, nextStartTime);
      // source.start(nextStartTime);
      // nextStartTime += buffer.duration;
      this.nextStartTime = Math.max(this.audioContext.currentTime, this.nextStartTime);
      source.start(this.nextStartTime);
      this.nextStartTime += buffer.duration;
      this.totalAudioSecondsScheduled += buffer.duration;
      this.isPlaying = true;

      this.onStateChange("speaking");
      this.broadcastAudioStats();

      this.activeSources.add(source);

      source.onended = () => {
        this.activeSources.delete(source);
        if (this.activeSources.size === 0) {
          setTimeout(() => {
            if (this.activeSources.size === 0) {
              this.isPlaying = false;
              this.onStateChange("listening");
              this.broadcastAudioStats();
            }
          }, 80);
        }
      };
    } catch (e: any) {
      // 5. If anything throws while playing a chunk, show error on screen
      console.error("[Audio Playback Chunk ERROR]:", e);
      this.onError({
        type: "playback",
        message: `Audio playback chunk #${this.totalChunksReceived} error: ${e.message || String(e)}`,
      });
    }
  }

  public stopPlayback() {
    for (const source of this.activeSources) {
      try {
        source.stop();
        source.disconnect();
      } catch {}
    }
    this.activeSources.clear();

    if (this.audioContext) {
      this.nextStartTime = this.audioContext.currentTime;
    }
    this.isPlaying = false;
    this.broadcastAudioStats();
  }

  stop() {
    this.isExplicitlyStopped = true;
    if (this.processingSafetyTimer) {
      clearTimeout(this.processingSafetyTimer);
      this.processingSafetyTimer = null;
    }

    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.micMuteGain) {
      this.micMuteGain.disconnect();
      this.micMuteGain = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }

    this.stopPlayback();

    if (this.activeSession) {
      try {
        this.activeSession.close();
      } catch {}
      this.activeSession = null;
    }

    this.releaseWakeLock();

    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.boundVisibilityHandler);
    }

    this.onStateChange("idle");
    this.broadcastAudioStats();
  }

  updateConfig(newConfig: AppConfig) {
    const rawVoice = (newConfig.voiceName || "").trim();
    const validFemaleVoices = ["Kore", "Aoede"];
    const sanitizedVoice = validFemaleVoices.includes(rawVoice) ? rawVoice : "Kore";
    newConfig.voiceName = sanitizedVoice;

    const voiceChanged = this.config.voiceName !== sanitizedVoice;
    this.config = newConfig;

    if (voiceChanged && this.activeSession && !this.isExplicitlyStopped) {
      try {
        this.activeSession.close();
      } catch {}
      this.activeSession = null;
      this.isConnecting = false;
      this.connectLiveSession().catch((e) => console.error("Error reconnecting with new voice:", e));
      return;
    }

    if (this.activeSession && newConfig.activeTopicOrScript?.trim()) {
      try {
        this.activeSession.sendRealtimeInput({
          text: `[SYSTEM: Active topic or focus updated to: "${newConfig.activeTopicOrScript.trim()}". Weave naturally into conversation in your own sweet, casual speaking style.]`,
        });
      } catch (e) {
        console.warn("Could not notify active session of topic update:", e);
      }
    }
  }

  sendText(text: string) {
    if (this.activeSession) {
      try {
        this.activeSession.sendRealtimeInput({ text });
      } catch (err) {
        console.warn("Failed to send text input:", err);
      }
    }
  }
}
