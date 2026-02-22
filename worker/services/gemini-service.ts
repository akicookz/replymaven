import { type ProjectSettingsRow } from "../db";

interface GeminiMessage {
  role: "user" | "model";
  parts: Array<{ text: string }>;
}

interface GeminiStreamChunk {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
    finishReason?: string;
  }>;
}

export class GeminiService {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model = "gemini-2.0-flash") {
    this.apiKey = apiKey;
    this.model = model;
  }

  // ─── Build System Prompt ────────────────────────────────────────────────────

  buildSystemPrompt(
    settings: Pick<
      ProjectSettingsRow,
      "toneOfVoice" | "customTonePrompt"
    >,
    ragContext: string,
    cannedHint: string | null,
  ): string {
    const toneInstructions: Record<string, string> = {
      professional:
        "You are a professional and helpful customer support agent. Be concise, clear, and solution-oriented.",
      friendly:
        "You are a friendly and approachable customer support agent. Be warm, empathetic, and helpful.",
      casual:
        "You are a casual and relaxed customer support agent. Keep things light and easy to understand.",
      formal:
        "You are a formal and courteous customer support agent. Use proper language and be respectful.",
      custom: settings.customTonePrompt ?? "You are a helpful customer support agent.",
    };

    const tone = toneInstructions[settings.toneOfVoice] ?? toneInstructions.professional;

    let prompt = `${tone}\n\n`;
    prompt += "IMPORTANT RULES:\n";
    prompt += "- Only answer questions based on the provided context and knowledge base.\n";
    prompt += "- If you don't know the answer, say so honestly and offer to connect the visitor with a human agent.\n";
    prompt += "- Keep responses concise and helpful.\n";
    prompt += "- Do not make up information.\n";
    prompt += '- If the visitor asks to speak to a human, respond with exactly: "[HANDOFF_REQUESTED]"\n\n';

    if (ragContext) {
      prompt += "KNOWLEDGE BASE CONTEXT:\n";
      prompt += ragContext;
      prompt += "\n\n";
    }

    if (cannedHint) {
      prompt += "SUGGESTED CANNED RESPONSE (use if relevant):\n";
      prompt += cannedHint;
      prompt += "\n\n";
    }

    return prompt;
  }

  // ─── Auto-Draft Canned Response ──────────────────────────────────────────────

  async generateCannedDraft(
    conversationMessages: Array<{ role: string; content: string }>,
  ): Promise<{ trigger: string; response: string } | null> {
    const transcript = conversationMessages
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    const prompt = `Analyze this customer support conversation and generate a canned response that could be reused for similar future questions.

CONVERSATION:
${transcript}

Respond ONLY with valid JSON in this exact format (no markdown, no code blocks):
{"trigger": "short keyword or phrase that identifies the question type", "response": "the ideal concise response to give"}

If the conversation is too short, trivial, or doesn't contain a clear reusable Q&A pattern, respond with exactly: null`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 512,
        },
      }),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text || text === "null") return null;

    try {
      const parsed = JSON.parse(text) as { trigger?: string; response?: string };
      if (parsed.trigger && parsed.response) {
        return { trigger: parsed.trigger, response: parsed.response };
      }
    } catch {
      // Gemini may wrap in markdown code block -- try extracting JSON
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]) as {
            trigger?: string;
            response?: string;
          };
          if (parsed.trigger && parsed.response) {
            return { trigger: parsed.trigger, response: parsed.response };
          }
        } catch {
          // Give up
        }
      }
    }

    return null;
  }

  // ─── Stream Chat Completion ─────────────────────────────────────────────────

  async *streamChat(
    systemPrompt: string,
    conversationHistory: Array<{ role: "visitor" | "bot" | "agent"; content: string }>,
    userMessage: string,
  ): AsyncGenerator<string> {
    const geminiMessages: GeminiMessage[] = [];

    // Convert conversation history to Gemini format
    for (const msg of conversationHistory) {
      geminiMessages.push({
        role: msg.role === "visitor" ? "user" : "model",
        parts: [{ text: msg.content }],
      });
    }

    // Add current message
    geminiMessages.push({
      role: "user",
      parts: [{ text: userMessage }],
    });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:streamGenerateContent?alt=sse&key=${this.apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: systemPrompt }],
        },
        contents: geminiMessages,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1024,
          topP: 0.95,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error: ${response.status} ${errorText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body from Gemini");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const jsonStr = line.slice(6).trim();
          if (!jsonStr || jsonStr === "[DONE]") continue;

          try {
            const chunk: GeminiStreamChunk = JSON.parse(jsonStr);
            const text =
              chunk.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
            if (text) {
              yield text;
            }
          } catch {
            // Skip malformed JSON chunks
          }
        }
      }
    }
  }
}
