import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { type ProjectSettingsRow } from "../db";
import {
  buildExtractContactInfoPrompt,
  buildReformulateQueryPrompt,
  buildSummarizeConversationPrompt,
  buildSummarizeTeamRequestPrompt,
} from "../chat-runtime/llm/support-prompt-builders";
import { buildSupportSystemPrompt } from "../chat-runtime/prompt/build-support-system-prompt";

// ─── Service ──────────────────────────────────────────────────────────────────

interface AiServiceConfig {
  model: string;
  geminiApiKey: string;
  openaiApiKey: string;
}

export class AiService {
  private model;

  constructor(config: AiServiceConfig) {
    if (config.model.startsWith("gpt")) {
      const provider = createOpenAI({ apiKey: config.openaiApiKey });
      this.model = provider(config.model);
    } else {
      const provider = createGoogleGenerativeAI({
        apiKey: config.geminiApiKey,
      });
      this.model = provider(config.model);
    }
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

    try {
      const { text } = await generateText({
        model: this.model,
        prompt: buildReformulateQueryPrompt({
          transcript,
          currentMessage,
        }),
        temperature: 0,
        maxOutputTokens: 128,
      });

      return text.trim() || currentMessage;
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

    try {
      const { text } = await generateText({
        model: this.model,
        prompt: buildSummarizeConversationPrompt({ transcript }),
        temperature: 0,
        maxOutputTokens: 128,
      });

      return text.trim() || null;
    } catch {
      return null;
    }
  }

  // ─── Summarize Team Request ──────────────────────────────────────────────────

  async summarizeTeamRequest(
    conversationHistory: Array<{ role: string; content: string }>,
  ): Promise<string> {
    const transcript = conversationHistory
      .slice(-16)
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    try {
      const { text } = await generateText({
        model: this.model,
        prompt: buildSummarizeTeamRequestPrompt({ transcript }),
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

  // ─── Extract Contact Info ────────────────────────────────────────────────────

  async extractContactInfo(
    messages: Array<{ role: string; content: string }>,
  ): Promise<{ name: string | null; email: string | null }> {
    // First try regex extraction for email (fast, no AI call needed)
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
    let extractedEmail: string | null = null;
    let extractedName: string | null = null;

    const visitorMessages = messages
      .filter((m) => m.role === "visitor")
      .slice(-10);

    for (const msg of visitorMessages) {
      const emailMatch = msg.content.match(emailRegex);
      if (emailMatch) {
        extractedEmail = emailMatch[0].toLowerCase();
      }
    }

    // Use AI to extract name (and email as backup)
    const transcript = visitorMessages
      .map((m) => m.content)
      .join("\n");

    try {
      const { text } = await generateText({
        model: this.model,
        prompt: buildExtractContactInfoPrompt({ transcript }),
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
      // Fallback: regex-only extraction is fine
    }

    return { name: extractedName, email: extractedEmail };
  }

  // ─── Classify Agent Command ──────────────────────────────────────────────────

  async classifyAgentCommand(
    agentText: string,
  ): Promise<
    | { action: "close" }
    | { action: "handback"; instructions: string }
    | { action: "respond"; instructions: string }
  > {
    try {
      const { text } = await generateText({
        model: this.model,
        prompt: `A human support agent typed the following message directed at their AI assistant (chatbot). The agent is telling the bot what to do next for a customer conversation.

"${agentText}"

Determine the agent's intent. There are exactly three possible intents:

1. CLOSE — The agent is saying the conversation is done, resolved, finished, or should be closed.
   Examples: "we're done here", "this is resolved", "all sorted, customer is happy", "close this one"

2. HANDBACK — The agent is giving the bot private/internal instructions to follow silently going forward. The visitor should NOT see or know about these instructions. The bot should just keep them in mind for future messages.
   Examples: "don't mention to user but if they keep complaining, cancel their account", "offer them 20% off if they ask about pricing", "be extra careful with this customer, they're a VIP"

3. RESPOND — The agent wants the bot to immediately respond to the visitor with specific information or in a specific way. The visitor WILL see the bot's response.
   Examples: "explain how the refund process works", "tell them about our pricing plans", "answer their question about shipping", "take over", "you handle it from here"

Key distinction between HANDBACK and RESPOND:
- HANDBACK = secret instructions for the bot's behavior (visitor never sees the instruction itself)
- RESPOND = the agent wants the bot to generate a visible response to the visitor right now

Respond with ONLY a valid JSON object, no other text:

For CLOSE: {"action":"close"}
For HANDBACK: {"action":"handback","instructions":"<the private instructions>"}
For RESPOND: {"action":"respond","instructions":"<what the bot should respond about>"}

JSON:`,
        temperature: 0,
        maxOutputTokens: 256,
      });

      const parsed = JSON.parse(text.trim());
      if (parsed.action === "close") return { action: "close" };
      if (parsed.action === "respond") {
        return {
          action: "respond",
          instructions: parsed.instructions ?? agentText,
        };
      }
      return {
        action: "handback",
        instructions: parsed.instructions ?? "",
      };
    } catch {
      // Default to respond with the full text as instructions
      return { action: "respond", instructions: agentText };
    }
  }

  // ─── Generate Directed Response ─────────────────────────────────────────────

  async generateDirectedResponse(
    settings: Pick<
      ProjectSettingsRow,
      | "toneOfVoice"
      | "customTonePrompt"
      | "companyContext"
      | "botName"
      | "agentName"
    >,
    projectName: string,
    conversationHistory: Array<{ role: string; content: string }>,
    agentInstruction: string,
  ): Promise<string> {
    const systemPrompt = buildSupportSystemPrompt(
      settings,
      projectName,
      "", // no RAG context for directed responses
      null,
      { agentHandbackInstructions: agentInstruction },
    );

    const messages: Array<{ role: "user" | "assistant"; content: string }> =
      conversationHistory.slice(-20).map((m) => ({
        role: (m.role === "visitor" ? "user" : "assistant") as
          | "user"
          | "assistant",
        content: m.content,
      }));

    // Add a synthetic user message to trigger the bot to respond
    messages.push({
      role: "user",
      content:
        "[The human agent has asked you to respond to the visitor now. Follow the agent instructions and generate your response.]",
    });

    try {
      const { text } = await generateText({
        model: this.model,
        system: systemPrompt,
        messages,
        temperature: 0.7,
        maxOutputTokens: 1024,
      });

      return text.trim() || "I'm here to help! What can I assist you with?";
    } catch {
      return "I'm here to help! What can I assist you with?";
    }
  }

  // ─── Knowledge Refinement ────────────────────────────────────────────────────

  async generateKnowledgeRefinement(
    conversationMessages: Array<{ role: string; content: string }>,
    existingContext: {
      companyContext: string | null;
      faqResources: Array<{
        id: string;
        title: string;
        pairs: Array<{ question: string; answer: string }>;
      }>;
      guidelines: Array<{
        id: string;
        condition: string;
        instruction: string;
      }>;
    },
  ): Promise<
    Array<{
      type:
        | "new_faq"
        | "add_faq_entry"
        | "new_sop"
        | "update_sop"
        | "update_context";
      targetResourceId?: string;
      targetGuidelineId?: string;
      suggestion: Record<string, unknown>;
      reasoning: string;
    }>
  > {
    const transcript = conversationMessages
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    const faqSummary =
      existingContext.faqResources.length > 0
        ? existingContext.faqResources
            .map(
              (faq) =>
                `FAQ "${faq.title}" (id: ${faq.id}):\n${faq.pairs.map((p) => `  Q: ${p.question}\n  A: ${p.answer}`).join("\n")}`,
            )
            .join("\n\n")
        : "(none)";

    const sopSummary =
      existingContext.guidelines.length > 0
        ? existingContext.guidelines
            .map(
              (g) =>
                `SOP (id: ${g.id}):\n  When: ${g.condition}\n  Then: ${g.instruction}`,
            )
            .join("\n\n")
        : "(none)";

    const contextSummary = existingContext.companyContext || "(none)";

    try {
      const { text } = await generateText({
        model: this.model,
        prompt: `You are a knowledge base analyst. Analyze this customer support conversation and identify improvements to the knowledge base.

CONVERSATION:
${transcript}

EXISTING KNOWLEDGE BASE:

FAQs:
${faqSummary}

SOPs (Standard Operating Procedures):
${sopSummary}

Company Context:
${contextSummary}

Based on the conversation, suggest improvements. For each suggestion, pick the most appropriate type:
- "add_faq_entry": Add Q&A pairs to an EXISTING FAQ resource (specify targetResourceId)
- "new_faq": Create a NEW FAQ resource if no existing one fits (specify title + pairs)
- "update_sop": Update an EXISTING SOP that was incomplete or wrong (specify targetGuidelineId + new condition/instruction)
- "new_sop": Create a NEW SOP for a behavioral pattern not covered (specify condition/instruction)
- "update_context": Append important company info that was missing from company context

Rules:
- Do NOT suggest duplicates of existing FAQ pairs or SOPs
- Only suggest if the conversation reveals a genuine knowledge gap, incorrect info, or missing procedure
- Prefer adding to existing FAQ resources over creating new ones
- Be specific and actionable
- If no improvements are needed, return an empty array

Return ONLY valid JSON array (no markdown, no code blocks):
[
  {
    "type": "add_faq_entry",
    "targetResourceId": "existing-resource-id",
    "suggestion": { "pairs": [{"question": "...", "answer": "..."}] },
    "reasoning": "Why this improvement is needed"
  },
  {
    "type": "new_sop",
    "suggestion": { "condition": "When...", "instruction": "The bot should..." },
    "reasoning": "Why this SOP is needed"
  }
]

If no improvements are warranted, return exactly: []`,
        temperature: 0.3,
        maxOutputTokens: 1024,
      });

      const trimmed = text.trim();
      if (!trimmed || trimmed === "[]" || trimmed === "null") return [];

      try {
        const jsonMatch = trimmed.match(/\[[\s\S]*\]/);
        const parsed = JSON.parse(
          jsonMatch ? jsonMatch[0] : trimmed,
        ) as Array<{
          type: string;
          targetResourceId?: string;
          targetGuidelineId?: string;
          suggestion: Record<string, unknown>;
          reasoning: string;
        }>;

        const validTypes = new Set([
          "new_faq",
          "add_faq_entry",
          "new_sop",
          "update_sop",
          "update_context",
        ]);

        return parsed.filter(
          (s) =>
            validTypes.has(s.type) &&
            s.suggestion &&
            typeof s.reasoning === "string",
        ) as Array<{
          type:
            | "new_faq"
            | "add_faq_entry"
            | "new_sop"
            | "update_sop"
            | "update_context";
          targetResourceId?: string;
          targetGuidelineId?: string;
          suggestion: Record<string, unknown>;
          reasoning: string;
        }>;
      } catch {
        return [];
      }
    } catch {
      return [];
    }
  }

  // ─── Compose Inquiry Reply ──────────────────────────────────────────────────

  async composeInquiryReply(
    settings: {
      toneOfVoice?: string | null;
      customTonePrompt?: string | null;
      companyContext?: string | null;
      companyName?: string | null;
    },
    projectName: string,
    inquiryData: Record<string, string>,
    senderInfo?: {
      name: string;
      email: string;
      workTitle?: string | null;
    } | null,
  ): Promise<{ subject: string; body: string }> {
    const toneInstruction =
      settings.toneOfVoice === "custom" && settings.customTonePrompt
        ? settings.customTonePrompt
        : settings.toneOfVoice === "friendly"
          ? "Write in a warm, friendly, and approachable tone."
          : settings.toneOfVoice === "casual"
            ? "Write in a casual, relaxed tone."
            : settings.toneOfVoice === "formal"
              ? "Write in a formal, respectful tone."
              : "Write in a professional, clear tone.";

    const companyCtx = settings.companyContext
      ? `\nCompany context:\n${settings.companyContext}`
      : "";

    const fieldLines = Object.entries(inquiryData)
      .map(([key, val]) => `${key}: ${val}`)
      .join("\n");

    const signOff = senderInfo
      ? `End with this sign-off:\n\nBest regards,\n${senderInfo.name}${senderInfo.workTitle ? `\n${senderInfo.workTitle}` : ""}\n${projectName}\n${senderInfo.email}`
      : `End with an appropriate sign-off using "[Your name]" as placeholder`;

    const cannedHint = "";

    const { text } = await generateText({
      model: this.model,
      system: `You are a helpful assistant composing email replies on behalf of "${projectName}".
${toneInstruction}${companyCtx}${cannedHint}

Compose a professional reply email to an inquiry form submission. The reply should:
- Address the person by name if available
- Acknowledge what they wrote
- Provide a helpful, relevant response based on the company context
- Be concise but thorough
- ${signOff}

Return ONLY valid JSON in this exact format:
{"subject":"<email subject line>","body":"<email body text>"}

Do not wrap in markdown code blocks. Do not include any text outside the JSON.`,
      prompt: `Inquiry submission:\n${fieldLines}`,
      temperature: 0.5,
      maxOutputTokens: 1024,
    });

    try {
      const cleaned = text.replace(/```json?\s*/g, "").replace(/```\s*/g, "").trim();
      const parsed = JSON.parse(cleaned);
      return {
        subject: parsed.subject || "Re: Your inquiry",
        body: parsed.body || "",
      };
    } catch {
      return {
        subject: "Re: Your inquiry",
        body: text.trim(),
      };
    }
  }

  // ─── Summarize Website Content ────────────────────────────────────────────────

  async summarizeWebsite(rawText: string): Promise<string> {
    const truncated = rawText.slice(0, 15000);

    try {
      const { text } = await generateText({
        model: this.model,
        prompt: `You are analyzing a website's content to create a company knowledge base for an AI customer support chatbot.

WEBSITE CONTENT:
${truncated}

Based on this content, create a concise but comprehensive company description that covers:
- What the company does (products/services)
- Key features or offerings
- Target audience
- Any important policies, pricing info, or FAQs mentioned

Write it as a factual reference document (not marketing copy). Keep it under 2000 characters. If the content is very sparse, extract whatever useful info you can.`,
        temperature: 0.3,
        maxOutputTokens: 1024,
      });

      return text.trim();
    } catch {
      return "";
    }
  }

  // ─── Generate Structured Company Context ────────────────────────────────────

  async generateStructuredCompanyContext(sourceText: string): Promise<string> {
    const truncated = sourceText.slice(0, 45000);

    try {
      const { text } = await generateText({
        model: this.model,
        prompt: `You are creating a structured internal company context document for a customer support AI assistant.

SOURCE MATERIAL:
${truncated}

Write a concise, factual markdown document using exactly these section headings:
## What The Company Is
## Value Propositions
## Main Features
## Pricing
## Contact
## FAQs
## Testimonials And Reviews

Rules:
- Use only facts supported by the source material.
- Do not invent details.
- If a section is missing in the source, write: "Not found in source material."
- Use bullet points where useful.
- Keep it concise but complete enough for support answers.`,
        temperature: 0.2,
        maxOutputTokens: 1800,
      });

      return text.trim();
    } catch {
      return "";
    }
  }

  // ─── Generate Sample Customer Question ──────────────────────────────────────

  async generateSampleQuestion(companyContext: string): Promise<string> {
    try {
      const { text } = await generateText({
        model: this.model,
        prompt: `You are helping a business owner test their AI customer support chatbot.

COMPANY CONTEXT:
${companyContext}

Generate ONE realistic customer question that a visitor to this company's website would ask. The question should be:
- Specific to this company's products/services
- Something a real customer would ask (e.g., about pricing, features, how something works, return policy, etc.)
- Natural and conversational
- One sentence only

Respond with ONLY the question, nothing else.`,
        temperature: 0.7,
        maxOutputTokens: 128,
      });

      return (
        text.trim() || "What services do you offer and how can I get started?"
      );
    } catch {
      return "What services do you offer and how can I get started?";
    }
  }
}
