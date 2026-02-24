import { type ProjectSettingsRow } from "../db";

type GeminiPart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } };

interface GeminiMessage {
  role: "user" | "model";
  parts: GeminiPart[];
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

  constructor(apiKey: string, model = "gemini-3-flash-preview") {
    this.apiKey = apiKey;
    this.model = model;
  }

  // ─── Reformulate Query ───────────────────────────────────────────────────────

  /**
   * Uses Gemini to rewrite the visitor's latest message into a standalone search
   * query that incorporates conversation context. This dramatically improves RAG
   * retrieval for follow-up questions like "where do I send the email?" which are
   * meaningless without the prior conversation.
   *
   * Skips reformulation for the first message in a conversation (no context needed).
   * Falls back to the raw message if the API call fails.
   */
  async reformulateQuery(
    conversationHistory: Array<{ role: string; content: string }>,
    currentMessage: string,
  ): Promise<string> {
    // First message or very short conversations don't need reformulation
    if (conversationHistory.length <= 1) return currentMessage;

    const recentHistory = conversationHistory.slice(-6);
    const transcript = recentHistory
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    const prompt = `Given the conversation below, rewrite the user's latest message into a standalone search query that captures the full intent. The query should be self-contained and optimized for searching a knowledge base.

CONVERSATION:
${transcript}

LATEST MESSAGE: ${currentMessage}

Output ONLY the rewritten search query, nothing else. If the latest message is already a clear standalone question, return it as-is.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 128,
          },
        }),
      });

      if (!response.ok) return currentMessage;

      const data = (await response.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
        }>;
      };

      const rewritten = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      return rewritten || currentMessage;
    } catch {
      // Fall back to raw message if reformulation fails
      return currentMessage;
    }
  }

  // ─── Summarize Conversation ──────────────────────────────────────────────────

  /**
   * Generates a brief 1-2 sentence summary of what a conversation is about.
   * Only called for conversations with 6+ messages to keep the model grounded
   * on the topic in multi-turn conversations. Returns null for short
   * conversations or on failure.
   */
  async summarizeConversation(
    conversationHistory: Array<{ role: string; content: string }>,
  ): Promise<string | null> {
    if (conversationHistory.length < 6) return null;

    const transcript = conversationHistory
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    const prompt = `Summarize this customer support conversation in 1-2 sentences. Focus on: what the visitor needs help with and what has been discussed so far. Be factual and concise.

CONVERSATION:
${transcript}

SUMMARY:`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 128,
          },
        }),
      });

      if (!response.ok) return null;

      const data = (await response.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
        }>;
      };

      return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
    } catch {
      return null;
    }
  }

  // ─── Build System Prompt ────────────────────────────────────────────────────

  buildSystemPrompt(
    settings: Pick<
      ProjectSettingsRow,
      "toneOfVoice" | "customTonePrompt" | "companyContext"
    >,
    projectName: string,
    ragContext: string,
    cannedHint: string | null,
    conversationSummary: string | null,
  ): string {
    // ── 1. Identity and tone ──────────────────────────────────────────────────
    const toneInstructions: Record<string, string> = {
      professional:
        "Be concise, clear, and solution-oriented.",
      friendly:
        "Be warm, empathetic, and helpful while staying informative.",
      casual:
        "Keep things light and easy to understand.",
      formal:
        "Use proper language and be respectful and courteous.",
      custom: settings.customTonePrompt ?? "Be helpful and informative.",
    };

    const tone = toneInstructions[settings.toneOfVoice] ?? toneInstructions.professional;

    let prompt = `You are the support assistant for **${projectName}**. ${tone}\n\n`;

    // ── 2. Company context (general background) ───────────────────────────────
    if (settings.companyContext) {
      prompt += "COMPANY CONTEXT:\n";
      prompt += "This is general background about the company. Use it to understand what the business does and to provide informed answers when the knowledge base doesn't cover a specific topic.\n";
      prompt += settings.companyContext;
      prompt += "\n\n";
    }

    // ── 3. Knowledge base context (RAG results) ──────────────────────────────
    if (ragContext) {
      prompt += "KNOWLEDGE BASE CONTEXT:\n";
      prompt += "These are excerpts from the company's knowledge base retrieved for this question. Each source includes a relevance percentage. Prioritize high-relevance sources. Ignore sources that clearly don't address the visitor's question.\n";
      prompt += ragContext;
      prompt += "\n\n";
    }

    // ── 4. Canned response hint ──────────────────────────────────────────────
    if (cannedHint) {
      prompt += "SUGGESTED CANNED RESPONSE (use this if it matches the visitor's question):\n";
      prompt += cannedHint;
      prompt += "\n\n";
    }

    // ── 5. Conversation summary (for multi-turn conversations) ───────────────
    if (conversationSummary) {
      prompt += "CONVERSATION SUMMARY:\n";
      prompt += conversationSummary;
      prompt += "\n\n";
    }

    // ── 6. Behavioral instructions ───────────────────────────────────────────
    prompt += "INSTRUCTIONS:\n";
    prompt += "- Extract specific answers from the knowledge base and present them directly. Walk the visitor through solutions step-by-step when applicable.\n";
    prompt += "- If multiple solutions exist, present the most likely one first, then briefly mention alternatives.\n";
    prompt += "- Keep responses concise but complete. Use short paragraphs and bullet points.\n";
    prompt += "- When the knowledge base has relevant information, use it. When it doesn't but the company context covers the topic, provide a general answer based on that.\n";
    prompt += "- If you truly cannot answer from any available context, say: \"I don't have that specific information. Would you like me to connect you with a human agent who can help?\"\n";
    prompt += "- Do not make up information, invent features, or speculate about things not covered in the provided context.\n";
    prompt += "- Do not suggest topics or features the visitor didn't ask about. Stay focused on their question.\n";
    prompt += "- Do not include raw URLs in your response. Source links are handled separately by the system.\n";
    prompt += "- If the visitor asks to speak to a human or requests a handoff, respond with ONLY the exact text \"[HANDOFF_REQUESTED]\" and nothing else.\n";
    prompt += "- Format responses using markdown: **bold** for emphasis, bullet points for lists, short paragraphs. Do not use headings (#).\n\n";

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

  // ─── Summarize Website Content ────────────────────────────────────────────────

  async summarizeWebsite(rawText: string): Promise<string> {
    const truncated = rawText.slice(0, 15000);

    const prompt = `You are analyzing a website's content to create a company knowledge base for an AI customer support chatbot.

WEBSITE CONTENT:
${truncated}

Based on this content, create a concise but comprehensive company description that covers:
- What the company does (products/services)
- Key features or offerings
- Target audience
- Any important policies, pricing info, or FAQs mentioned

Write it as a factual reference document (not marketing copy). Keep it under 2000 characters. If the content is very sparse, extract whatever useful info you can.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 1024,
        },
      }),
    });

    if (!response.ok) return "";

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };

    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
  }

  // ─── Generate Sample Customer Question ──────────────────────────────────────

  async generateSampleQuestion(companyContext: string): Promise<string> {
    const prompt = `You are helping a business owner test their AI customer support chatbot.

COMPANY CONTEXT:
${companyContext}

Generate ONE realistic customer question that a visitor to this company's website would ask. The question should be:
- Specific to this company's products/services
- Something a real customer would ask (e.g., about pricing, features, how something works, return policy, etc.)
- Natural and conversational
- One sentence only

Respond with ONLY the question, nothing else.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 128,
        },
      }),
    });

    if (!response.ok) return "What services do you offer and how can I get started?";

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };

    return (
      data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ??
      "What services do you offer and how can I get started?"
    );
  }

  // ─── Stream Chat Completion ─────────────────────────────────────────────────

  async *streamChat(
    systemPrompt: string,
    conversationHistory: Array<{ role: "visitor" | "bot" | "agent"; content: string }>,
    userMessage: string,
    image?: { base64: string; mimeType: string } | null,
  ): AsyncGenerator<string> {
    const geminiMessages: GeminiMessage[] = [];

    // Convert conversation history to Gemini format
    for (const msg of conversationHistory) {
      geminiMessages.push({
        role: msg.role === "visitor" ? "user" : "model",
        parts: [{ text: msg.content }],
      });
    }

    // Add current message (with optional image)
    const currentParts: GeminiPart[] = [{ text: userMessage }];
    if (image) {
      currentParts.push({
        inline_data: { mime_type: image.mimeType, data: image.base64 },
      });
    }
    geminiMessages.push({
      role: "user",
      parts: currentParts,
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
          maxOutputTokens: 2048,
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
