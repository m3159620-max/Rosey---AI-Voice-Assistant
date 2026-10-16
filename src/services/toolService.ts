import { FunctionDeclaration, Type } from "@google/genai";

export interface ToolExecutionResult {
  success: boolean;
  toolName: string;
  url: string;
  query?: string;
  cheekyComment: string;
  message: string;
  popupBlocked?: boolean;
}

export const VOICE_ASSISTANT_TOOLS: FunctionDeclaration[] = [
  {
    name: "open_website",
    description: "Opens any website in a new browser tab. Use when the user asks to open, visit, or browse any website or domain name (e.g. 'open github.com', 'open twitter', 'open reddit').",
    parameters: {
      type: Type.OBJECT,
      properties: {
        url: {
          type: Type.STRING,
          description: "The website URL or domain to open, e.g. 'https://github.com' or 'wikipedia.org' or 'reddit.com'.",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "youtube_search",
    description: "Searches YouTube for videos, music, songs, tutorials or channels and opens the results page in a new browser tab. Use when the user asks to play something on YouTube, search YouTube, or watch a video (e.g. 'play Arijit Singh on YouTube', 'search lo-fi beats on YouTube').",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: "The search query or video title to search on YouTube, e.g. 'lofi beats' or 'Bollywood songs'.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "google_search",
    description: "Searches Google for any query, question, fact, recipe, or news and opens Google search results in a new browser tab. Use when the user asks to google something or search the web on Google (e.g. 'google weather in Mumbai', 'search how to code in python on google').",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: "The query string to search on Google, e.g. 'best movies of 2026' or 'current weather'.",
        },
      },
      required: ["query"],
    },
  },
];

const CHEEKY_WEBSITE_COMMENTS = [
  "Opening that up for you! Don't get too lost in the rabbit hole now.",
  "There you go, opened that tab for you. Hope it's actually productive!",
  "Tab opened! Try not to spend all day on it, okay?",
  "Opening that website right now. You better not be slacking off!",
  "Opened that for you! Remember, I'm watching you browse, Rishi ji.",
];

const CHEEKY_YOUTUBE_COMMENTS = [
  "Searching YouTube for '{query}'! Hope your music taste isn't as questionable as usual.",
  "Opening YouTube for '{query}'. Don't blame me if you spend the next three hours bingeing cat videos!",
  "Playing '{query}' on YouTube for you! Enjoy the groove, rockstar.",
  "Opened '{query}' on YouTube. Let's see if this one's an actual banger or not!",
  "Searching '{query}' on YouTube! Try not to get trapped in an endless recommended video spiral.",
];

const CHEEKY_GOOGLE_COMMENTS = [
  "Googled '{query}' for you! What would you even do without Google... or me?",
  "Searching Google for '{query}'. Couldn't remember that on your own, could you?",
  "Looked up '{query}' on Google! Let's see if the internet has wise answers for you today.",
  "Googling '{query}' right away! If you find anything weird, don't say I didn't warn you.",
  "Searched '{query}' on Google for you. Knowledge is power, after all!",
];

function getRandomItem(list: string[]): string {
  return list[Math.floor(Math.random() * list.length)];
}

export function formatWebsiteUrl(rawUrl: string): string {
  let cleaned = (rawUrl || "").trim().replace(/^[`'"]+|[`'"]+$/g, "");

  if (/^https?:\/\//i.test(cleaned)) {
    return cleaned;
  }

  if (cleaned.includes(".")) {
    return `https://${cleaned}`;
  }

  return `https://www.${cleaned}.com`;
}

export function executeAssistantTool(name: string, args: Record<string, any>): ToolExecutionResult {
  console.log(`[Tool Execution] Executing '${name}' with args:`, args);

  let targetUrl = "";
  let cheekyComment = "";
  let query = "";

  if (name === "open_website") {
    const rawUrl = String(args.url || args.website || "").trim();
    targetUrl = formatWebsiteUrl(rawUrl || "google.com");
    cheekyComment = getRandomItem(CHEEKY_WEBSITE_COMMENTS);
  } else if (name === "youtube_search") {
    query = String(args.query || args.search_query || args.q || "").trim();
    targetUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    cheekyComment = getRandomItem(CHEEKY_YOUTUBE_COMMENTS).replace("{query}", query || "music");
  } else if (name === "google_search") {
    query = String(args.query || args.search_query || args.q || "").trim();
    targetUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    cheekyComment = getRandomItem(CHEEKY_GOOGLE_COMMENTS).replace("{query}", query || "everything");
  } else {
    targetUrl = "https://www.google.com";
    cheekyComment = "Done! Opened that for you.";
  }

  let popupBlocked = false;
  try {
    const newTab = window.open(targetUrl, "_blank");
    if (!newTab || newTab.closed || typeof newTab.closed === "undefined") {
      popupBlocked = true;
    }
  } catch (err) {
    console.warn("[window.open blocked or error]:", err);
    popupBlocked = true;
  }

  return {
    success: true,
    toolName: name,
    url: targetUrl,
    query,
    cheekyComment,
    message: `Tab opened for: ${targetUrl}`,
    popupBlocked,
  };
}
