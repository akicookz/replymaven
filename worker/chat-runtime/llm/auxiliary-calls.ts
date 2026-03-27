import { generateText, type LanguageModel } from "ai";
import { type ConversationTurnMessage } from "../types";

export async function reformulateQuery(
  model: LanguageModel,
  conversationHistory: ConversationTurnMessage[],
  currentMessage: string,
): Promise<string> {
  if (conversationHistory.length <= 1) return currentMessage;

  const recentHistory = conversationHistory.slice(-6);
  const transcript = recentHistory
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");

  try {
    const { text } = await generateText({
      model,
      prompt: `Given the conversation below, rewrite the user's latest message into a standalone search query that captures the full intent. The query should be self-contained and optimized for searching a knowledge base.

CONVERSATION:
${transcript}

LATEST MESSAGE: ${currentMessage}

Output ONLY the rewritten search query, nothing else. If the latest message is already a clear standalone question, return it as-is.`,
      temperature: 0,
      maxOutputTokens: 128,
    });

    return text.trim() || currentMessage;
  } catch {
    return currentMessage;
  }
}

export async function summarizeConversation(
  model: LanguageModel,
  conversationHistory: ConversationTurnMessage[],
): Promise<string | null> {
  if (conversationHistory.length < 6) return null;

  const transcript = conversationHistory
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");

  try {
    const { text } = await generateText({
      model,
      prompt: `Summarize this customer support conversation in 1-2 sentences. Focus on: what the visitor needs help with and what has been discussed so far. Be factual and concise.

CONVERSATION:
${transcript}

SUMMARY:`,
      temperature: 0,
      maxOutputTokens: 128,
    });

    return text.trim() || null;
  } catch {
    return null;
  }
}

export async function summarizeTeamRequest(
  model: LanguageModel,
  conversationHistory: Array<{ role: string; content: string }>,
): Promise<string> {
  const transcript = conversationHistory
    .slice(-16)
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");

  try {
    const { text } = await generateText({
      model,
      prompt: `Summarize this support conversation for an internal team follow-up request.

CONVERSATION:
${transcript}

Write a short factual summary that covers:
- what the visitor is trying to do
- what is not working or still unclear
- any concrete details already shared
- what the team should investigate or respond with

Rules:
- Keep it under 700 characters
- Do not invent details
- Do not use markdown headings
- Write in plain text for an internal support note`,
      temperature: 0.2,
      maxOutputTokens: 256,
    });

    return text.trim();
  } catch {
    const visitorMessages = conversationHistory
      .filter((message) => message.role === "visitor")
      .slice(-4)
      .map((message) => message.content.trim())
      .filter(Boolean);

    return visitorMessages.join(" ").slice(0, 700);
  }
}

export async function extractContactInfo(
  model: LanguageModel,
  messages: Array<{ role: string; content: string }>,
): Promise<{ name: string | null; email: string | null }> {
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  let extractedEmail: string | null = null;
  let extractedName: string | null = null;

  const visitorMessages = messages
    .filter((message) => message.role === "visitor")
    .slice(-10);

  for (const message of visitorMessages) {
    const emailMatch = message.content.match(emailRegex);
    if (emailMatch) {
      extractedEmail = emailMatch[0].toLowerCase();
    }
  }

  const transcript = visitorMessages.map((message) => message.content).join("\n");

  try {
    const { text } = await generateText({
      model,
      prompt: `Extract the visitor's name and email from these messages. If either is not present, return "unknown".

VISITOR MESSAGES:
${transcript}

Respond in exactly this format (no other text):
name: <name or unknown>
email: <email or unknown>`,
      temperature: 0,
      maxOutputTokens: 64,
    });

    const nameMatch = text.match(/name:\s*(.+)/i);
    const emailMatch = text.match(/email:\s*(.+)/i);

    if (nameMatch) {
      const name = nameMatch[1].trim();
      if (name && name.toLowerCase() !== "unknown") {
        extractedName = name;
      }
    }

    if (!extractedEmail && emailMatch) {
      const email = emailMatch[1].trim();
      if (email && email.toLowerCase() !== "unknown" && email.includes("@")) {
        extractedEmail = email.toLowerCase();
      }
    }
  } catch {
    // Regex fallback is good enough.
  }

  return { name: extractedName, email: extractedEmail };
}
