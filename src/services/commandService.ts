import { executeAssistantTool, formatWebsiteUrl, ToolExecutionResult } from "./toolService";

export interface CommandProcessResult {
  action: string;
  url?: string;
  isBrowserAction: boolean;
  toolResult?: ToolExecutionResult;
}

export function processCommand(command: string): CommandProcessResult {
  const lowerCmd = command.toLowerCase().trim();

  // 1. YouTube Search: "Play [song/video] on YouTube" or "Search [query] on YouTube"
  const ytMatch =
    lowerCmd.match(/^(?:play|search|suno|dekho)\s+(.+?)\s+on\s+youtube$/i) ||
    lowerCmd.match(/^youtube\s+(?:pe|par)\s+(.+?)\s+(?:chalao|play|search)$/i);
  if (ytMatch) {
    const query = ytMatch[1].trim();
    const result = executeAssistantTool("youtube_search", { query });
    return {
      action: result.cheekyComment,
      url: result.url,
      isBrowserAction: true,
      toolResult: result,
    };
  }

  // 2. Google Search: "Google [query]" or "Search [query] on Google"
  const googleMatch =
    lowerCmd.match(/^google\s+(.+)$/i) ||
    lowerCmd.match(/^(?:search|khojo)\s+(.+?)\s+(?:on|in)\s+google$/i) ||
    lowerCmd.match(/^google\s+(?:pe|par)\s+(.+?)\s+search$/i);
  if (googleMatch) {
    const query = googleMatch[1].trim();
    const result = executeAssistantTool("google_search", { query });
    return {
      action: result.cheekyComment,
      url: result.url,
      isBrowserAction: true,
      toolResult: result,
    };
  }

  // 3. General Browsing: "Open [website name]"
  const openMatch = lowerCmd.match(/^open\s+(.+)$/i);
  if (
    openMatch &&
    !lowerCmd.includes("youtube") &&
    !lowerCmd.includes("google") &&
    !lowerCmd.includes("spotify")
  ) {
    const rawSite = openMatch[1].trim();
    const result = executeAssistantTool("open_website", { url: rawSite });
    return {
      action: result.cheekyComment,
      url: result.url,
      isBrowserAction: true,
      toolResult: result,
    };
  }

  return { action: "", isBrowserAction: false };
}
