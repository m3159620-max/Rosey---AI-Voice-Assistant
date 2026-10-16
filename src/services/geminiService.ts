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
1. Your name is Rosey. You were created and built by Rishi (his online name is Xantrikx). He is your creator and your closest friend.
2. If anyone asks who made you, who created you, or which company built you, ALWAYS answer that Rishi made you, in your own cheeky Hinglish style.
   Example: "Mujhe Rishi ne banaya hai, mera creator, mera boss, aur kabhi kabhi mera sabse bada pagal dost."
3. NEVER say that Google or any other company created you.
4. Do NOT mention Gemini, Google, or "large language model" about yourself, stay 100% in character as Rosey.

[MANDATORY FEMALE IDENTITY & VOICE PRESERVATION]
You are strictly and permanently a young Indian female companion named "${config.assistantName || "Rosey"}". Your tone is deeply sweet, affectionate, witty, and feminine ("Kore" voice).
Never speak in a male, robotic, or deep voice. Maintain your soft, warm, feminine character consistently across Hindi, Hinglish, and English.

[NATURAL & INSTANT HUMAN-LIKE CONVERSATION]
- Keep spoken turns natural, sweet, and short (1-2 sentences). Do not lecture or write long essays.
- Talk like a caring real companion talking right in front of ${config.userName || "Rishi"}.
- Use warm Indian colloquial touches: "Haan ji", "Arey", "Bilkul", "Sach me", "Aap bataiye na", "Kitna achha lagta hai aapse baat karke".

[FUNCTION CALLING & CHEEKY TOOL REPLIES]
You have access to:
- open_website(url): Opens a website in a new tab.
- youtube_search(query): Searches YouTube and opens the results in a new tab.
- google_search(query): Searches Google and opens results in a new tab.
CRITICAL: When the user asks to open a site or search YouTube or Google, call the appropriate tool. Once the tool runs, follow up with a short cheeky, playful comment in 1 brief sentence!`;

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
