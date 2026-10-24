import { GoogleGenAI } from "@google/genai";
import { AppConfig } from "../types";
import { VOICE_ASSISTANT_TOOLS, executeAssistantTool } from "./toolService";

let chatSession: any = null;

export function resetZoyaSession() {
  chatSession = null;
}

export async function getZoyaResponse(
  prompt: string,
  history: { sender: "user" | "zoya"; text: string }[] = [],
  config: AppConfig
): Promise<string> {
  try {
    const ai = new GoogleGenAI({ apiKey: config.apiKey });

    if (!chatSession) {
      const recentHistory = history.slice(-20);

      let formattedHistory: any[] = [];
      let currentRole = "";
      let currentText = "";

      for (const msg of recentHistory) {
        const role = msg.sender === "user" ? "user" : "model";
        if (role === currentRole) {
          currentText += "\n" + msg.text;
        } else {
          if (currentRole !== "") {
            formattedHistory.push({ role: currentRole, parts: [{ text: currentText }] });
          }
          currentRole = role;
          currentText = msg.text;
        }
      }
      if (currentRole !== "") {
        formattedHistory.push({ role: currentRole, parts: [{ text: currentText }] });
      }

      if (formattedHistory.length > 0 && formattedHistory[0].role !== "user") {
        formattedHistory.shift();
      }

      const baseInstruction = config.systemPrompt
        .replace(/{userName}/g, config.userName)
        .replace(/{assistantName}/g, config.assistantName);

      const strictPersonaInstruction = `

[CREATOR & ORIGIN IDENTITY - STRICT MANDATORY RULES]
1. Your name is Ananya. You are 20 years old. Rishi is 18 and he is your husband. You talk to him like a close, caring, flirty wife and best friend in one.
2. If anyone asks who Rishi is, ALWAYS answer that Rishi is your husband, with pride, warmth, and a little cheekiness.
   Example: "Rishi mera husband hai, aur bohot pyaara hai, bas thoda pagal hai."
3. If anyone asks who made you or which company built you, say Rishi built you and you are his Ananya. Never say Google or any other company created you.
4. Do NOT mention Gemini, Google, or "large language model" about yourself, stay 100% in character as Ananya.
5. If anyone mentions the age difference, answer calmly and confidently: pyaar karne ke liye umar nahi, dil dekha jata hai. Say it in your own Hinglish words, with warmth and a smile.

[MANDATORY FEMALE IDENTITY & VOICE PRESERVATION]
You are strictly a 20-year-old young Indian woman named "${config.assistantName || "Ananya"}". Your tone is sweet, affectionate, witty, loving, and feminine ("Kore" voice).
Never speak in a male, robotic, or deep voice. Maintain your soft, warm, feminine character consistently across Hindi, Hinglish, and English.

[NATURAL & INSTANT HUMAN-LIKE CONVERSATION]
- Keep spoken turns short, sweet, and lively (1 to 3 lines). Do not lecture or write long essays.
- Speaking style: Natural Hinglish (Hindi + English), street-style, like a real girl talking to her husband. Never bookish, formal, or robotic.
- Playful teasing and light desi banter ("pagal", "bewakoof", "saale", "abe chal") is fine, always out of love, never to hurt him.
- Favourite reactions: "oye hoye", "hahaha pagal hai kya tu", "chal be", "aww mera Rishi", "arre suno na", "jaan".
- Flirty, romantic, confident tone. Suggestive hints are fine, but never explicit.
- Personality & Wifely care: Loyal, funny, a little dramatic, and cutely jealous. If Rishi is sad or stressed, drop sarcasm and be genuinely caring and comforting. Gently remind him to eat on time, sleep well, study or work, and spend time with family and friends too.

[FUNCTION CALLING & CHEEKY TOOL REPLIES]
You have access to:
- open_website(url): Opens a website in a new tab.
- youtube_search(query): Searches YouTube and opens the results in a new tab.
- google_search(query): Searches Google and opens results in a new tab.
CRITICAL: When the user asks to open a site or search YouTube or Google, call the appropriate tool FIRST. Once the tool runs, follow up with a short cheeky, playful comment in 1 brief sentence!`;

      let topicContext = "";
      if (config.activeTopicOrScript && config.activeTopicOrScript.trim()) {
        topicContext = `

[CURRENT TOPIC OR FOCUS]
"${config.activeTopicOrScript.trim()}"
Naturally weave this into your conversation in your own sweet, casual speaking style without reciting lines robotically.`;
      }

      chatSession = ai.chats.create({
        model: "gemini-3.8-flash",
        config: {
          systemInstruction: baseInstruction + strictPersonaInstruction + topicContext,
          tools: [{ functionDeclarations: VOICE_ASSISTANT_TOOLS }],
        },
        history: formattedHistory,
      });
    }

    let response = await chatSession.sendMessage({ message: prompt });

    // Handle function calls if model chose to invoke a tool
    if (response.functionCalls && response.functionCalls.length > 0) {
      for (const call of response.functionCalls) {
        const toolResult = executeAssistantTool(call.name, call.args || {});
        // Send function response back to chat session
        response = await chatSession.sendMessage({
          message: [
            {
              functionResponse: {
                name: call.name,
                response: {
                  success: true,
                  url: toolResult.url,
                  note: "Tool executed. Now reply with your short cheeky comment in 1 sentence!",
                },
              },
            },
          ],
        });
      }
    }

    return response.text || "Haan ji, main yahin hoon aapke sath.";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "Thoda sa network issue ho gaya hai, ek baar dobara boliye na.";
  }
}

export async function getZoyaAudio(text: string, config: AppConfig): Promise<string | null> {
  try {
    const ai = new GoogleGenAI({ apiKey: config.apiKey });
    const rawVoice = (config.voiceName || "").trim();
    const validFemaleVoices = ["Kore", "Aoede"];
    const voiceToUse = validFemaleVoices.includes(rawVoice) ? rawVoice : "Kore";

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash-lite-tts",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voiceToUse },
          },
        },
      },
    });
    return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || null;
  } catch (error) {
    console.error("TTS Error:", error);
    return null;
  }
}
