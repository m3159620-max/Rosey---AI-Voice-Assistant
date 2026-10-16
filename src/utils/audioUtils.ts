// Web Audio utilities: AudioContext management, 24kHz PCM16 decoding, and test tone verification

let sharedAudioContext: AudioContext | null = null;

/**
 * Returns the shared AudioContext if it has been created, or null.
 * Does NOT instantiate AudioContext before user interaction to avoid browser autoplay blocks.
 */
export function getOutputAudioContext(): AudioContext | null {
  return sharedAudioContext;
}

/**
 * Requirement 1: Create the output AudioContext on the user's click (Start Call / Test Sound),
 * call audioContext.resume() and await it, and make sure its state is "running" before playing.
 */
export async function ensureAudioContextRunning(): Promise<AudioContext> {
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;

  if (!sharedAudioContext || sharedAudioContext.state === "closed") {
    sharedAudioContext = new AudioContextClass();
    console.log(`[AudioContext] Created new instance. sampleRate: ${sharedAudioContext.sampleRate}Hz, state: ${sharedAudioContext.state}`);
  }

  if (sharedAudioContext.state === "suspended") {
    try {
      await sharedAudioContext.resume();
      console.log(`[AudioContext] Resumed successfully. State: ${sharedAudioContext.state}`);
    } catch (err) {
      console.warn("[AudioContext] Resume failed:", err);
    }
  }

  // Double check state
  if (sharedAudioContext.state !== "running") {
    try {
      await sharedAudioContext.resume();
    } catch (e) {
      console.warn("[AudioContext] Second resume attempt:", e);
    }
  }

  return sharedAudioContext;
}

/**
 * Requirement 1:
 * Decode base64 PCM16 chunk correctly:
 * 1. Decode base64 to Int16Array.
 * 2. Convert to Float32Array by dividing by 32768.
 * 3. Calculate peak amplitude (max absolute value) and sample count.
 */
export function decodePcm16Chunk(base64Data: string): {
  float32: Float32Array;
  sampleCount: number;
  peakAmplitude: number;
} {
  const binaryString = atob(base64Data);
  const len = binaryString.length;
  // Ensure even number of bytes for 16-bit PCM (2 bytes per sample)
  const byteCount = len - (len % 2);
  const sampleCount = byteCount / 2;

  const buffer = new ArrayBuffer(byteCount);
  const uint8 = new Uint8Array(buffer);
  for (let i = 0; i < byteCount; i++) {
    uint8[i] = binaryString.charCodeAt(i);
  }

  // Decode base64 to Int16Array (16-bit little-endian signed integer samples)
  const int16 = new Int16Array(buffer);

  // Convert to Float32Array by dividing by 32768
  const float32 = new Float32Array(sampleCount);
  let peakAmplitude = 0;

  for (let i = 0; i < sampleCount; i++) {
    const s = int16[i] / 32768.0;
    float32[i] = s;
    const abs = Math.abs(s);
    if (abs > peakAmplitude) {
      peakAmplitude = abs;
    }
  }

  return { float32, sampleCount, peakAmplitude };
}

/**
 * Requirement 4 from previous turn:
 * Test Sound button that plays a short pleasant beep so the user can verify speakers work
 * and the Chrome tab immediately displays the speaker indicator.
 */
export async function playTestSound(): Promise<{ success: boolean; state: string; sampleRate: number }> {
  try {
    const ctx = await ensureAudioContextRunning();
    if (ctx.state !== "running") {
      await ctx.resume();
    }

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    const now = ctx.currentTime;

    // Musical two-tone beep (D5 -> A5)
    osc.frequency.setValueAtTime(587.33, now); // D5
    osc.frequency.setValueAtTime(880.00, now + 0.12); // A5

    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.38);

    return new Promise((resolve) => {
      osc.onended = () => {
        try {
          osc.disconnect();
          gain.disconnect();
        } catch {}
        resolve({
          success: true,
          state: ctx.state,
          sampleRate: ctx.sampleRate,
        });
      };
    });
  } catch (error: any) {
    console.error("[Test Sound] Failed:", error);
    return {
      success: false,
      state: sharedAudioContext?.state || "failed",
      sampleRate: sharedAudioContext?.sampleRate || 0,
    };
  }
}

/**
 * Universal playback function for standalone audio (used by text chat TTS).
 */
export async function playPCM(base64Data: string, volume: number = 1.0): Promise<void> {
  try {
    const ctx = await ensureAudioContextRunning();
    if (ctx.state !== "running") {
      await ctx.resume();
    }

    const binaryString = atob(base64Data);
    const len = binaryString.length;
    if (len === 0) return;

    const rawBytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      rawBytes[i] = binaryString.charCodeAt(i);
    }

    // Check if it's a RIFF WAV container (e.g. from unary generateContent)
    const isWav =
      rawBytes.length > 12 &&
      rawBytes[0] === 0x52 && // 'R'
      rawBytes[1] === 0x49 && // 'I'
      rawBytes[2] === 0x46 && // 'F'
      rawBytes[3] === 0x46;

    let audioBuffer: AudioBuffer;
    if (isWav) {
      audioBuffer = await ctx.decodeAudioData(rawBytes.buffer.slice(0));
    } else {
      const { float32, sampleCount } = decodePcm16Chunk(base64Data);
      audioBuffer = ctx.createBuffer(1, sampleCount, 24000);
      audioBuffer.getChannelData(0).set(float32);
    }

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;

    const gainNode = ctx.createGain();
    // Ensure gain is never 0 and nothing is muted
    gainNode.gain.value = Math.max(0.1, Math.min(1.0, volume));

    source.connect(gainNode);
    gainNode.connect(ctx.destination);

    source.start(0);

    return new Promise<void>((resolve) => {
      source.onended = () => {
        try {
          source.disconnect();
          gainNode.disconnect();
        } catch {}
        resolve();
      };
    });
  } catch (error) {
    console.error("[playPCM Error]:", error);
  }
}
