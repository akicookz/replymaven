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

export interface KnowledgeRefinementPlan {
  type:
    | "new_faq"
    | "add_faq_pair"
    | "refine_faq_pair"
    | "new_sop"
    | "add_sop"
    | "refine_sop"
    | "update_pdf"
    | "update_webpage"
    | "update_context";
  targetResourceId?: string;
  targetGuidelineId?: string;
  targetPageId?: string;
  reasoning: string;
}

export interface KnowledgeRefinementSuggestion {
  type:
    | "new_faq"
    | "add_faq_pair"
    | "refine_faq_pair"
    | "new_sop"
    | "add_sop"
    | "refine_sop"
    | "update_pdf"
    | "update_webpage"
    | "update_context";
  targetResourceId?: string;
  targetGuidelineId?: string;
  targetPageId?: string;
  suggestion: Record<string, unknown>;
  reasoning: string;
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

  async planKnowledgeRefinement(
    conversationMessages: Array<{ role: string; content: string }>,
    existingContext: {
      companyContext: string | null;
      faqCandidates: Array<{
        id: string;
        title: string;
        pairs: Array<{ question: string; answer: string }>;
      }>;
      guidelineCandidates: Array<{
        id: string;
        condition: string;
        instruction: string;
      }>;
      pdfCandidates: Array<{
        id: string;
        title: string;
        excerpt: string;
      }>;
      webpageCandidates: Array<{
        pageId: string;
        resourceId: string;
        resourceTitle: string;
        pageTitle: string | null;
        url: string;
      }>;
      pendingSuggestions: Array<{
        id: string;
        type: string;
        summary: string;
      }>;
    },
  ): Promise<KnowledgeRefinementPlan[]> {
    const transcript = conversationMessages
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    const faqSummary =
      existingContext.faqCandidates.length > 0
        ? existingContext.faqCandidates
            .map(
              (faq) =>
                `FAQ "${faq.title}" (id: ${faq.id}):\n${faq.pairs
                  .slice(0, 8)
                  .map((p) => `  Q: ${p.question}`)
                  .join("\n")}`,
            )
            .join("\n\n")
        : "(none)";

    const sopSummary =
      existingContext.guidelineCandidates.length > 0
        ? existingContext.guidelineCandidates
            .map(
              (g) =>
                `SOP (id: ${g.id}):\n  When: ${g.condition}\n  Then: ${g.instruction}`,
            )
            .join("\n\n")
        : "(none)";

    const pdfSummary =
      existingContext.pdfCandidates.length > 0
        ? existingContext.pdfCandidates
            .map(
              (pdf) =>
                `PDF "${pdf.title}" (id: ${pdf.id}):\n${pdf.excerpt || "(no excerpt available)"}`,
            )
            .join("\n\n")
        : "(none)";

    const webpageSummary =
      existingContext.webpageCandidates.length > 0
        ? existingContext.webpageCandidates
            .map(
              (page) =>
                `Web page (pageId: ${page.pageId}, resourceId: ${page.resourceId}):\n  Resource: ${page.resourceTitle}\n  Title: ${page.pageTitle ?? "(untitled)"}\n  URL: ${page.url}`,
            )
            .join("\n\n")
        : "(none)";

    const pendingSummary =
      existingContext.pendingSuggestions.length > 0
        ? existingContext.pendingSuggestions
            .map(
              (suggestion) =>
                `Pending ${suggestion.type} (${suggestion.id}): ${suggestion.summary}`,
            )
            .join("\n")
        : "(none)";

    const contextSummary = existingContext.companyContext || "(none)";

    try {
      const { text } = await generateText({
        model: this.model,
        prompt: `You are planning knowledge refinement actions for a customer support knowledge base.

CONVERSATION:
${transcript}

PENDING SUGGESTIONS TO AVOID DUPLICATING:
${pendingSummary}

DETERMINISTICALLY SELECTED FAQ CANDIDATES:
${faqSummary}

DETERMINISTICALLY SELECTED SOP CANDIDATES:
${sopSummary}

DETERMINISTICALLY SELECTED PDF CANDIDATES:
${pdfSummary}

DETERMINISTICALLY SELECTED WEB PAGE CANDIDATES:
${webpageSummary}

Company Context:
${contextSummary}

Pick the most appropriate actions. Use only these action types:
- "add_faq_pair": add ONE new Q&A pair to an EXISTING FAQ resource from the candidate list
- "refine_faq_pair": refine ONE specific Q&A pair in an EXISTING FAQ resource from the candidate list${existingContext.faqCandidates.length === 0 ? '\n- "new_faq": create a NEW FAQ resource (only available when no FAQs exist yet)' : ''}
- "add_sop": add ONE new SOP guideline
- "refine_sop": refine ONE existing SOP from the candidate list
- "new_sop": create a NEW SOP set only when no existing SOPs are related
- "update_pdf": refine an EXISTING PDF from the candidate list
- "update_webpage": refine an EXISTING web page from the candidate list
- "update_context": append missing high-level company context when it does not belong in a FAQ, SOP, PDF, or webpage refinement

Rules:
- Return at most 3 actions
- Each FAQ/SOP action should be for exactly ONE pair/guideline only
- For FAQs: Use "add_faq_pair" or "refine_faq_pair" instead of full resource updates
- For SOPs: Use "add_sop" or "refine_sop" for individual guidelines
- For PDFs and web pages, NEVER create a new resource suggestion. Only use "update_pdf" or "update_webpage"
- Do NOT create a duplicate of an existing pending suggestion
- Do NOT create multiple actions for the same target
- Only suggest an action if the conversation reveals a genuine gap, incorrect content, or missing procedure
- If no improvements are needed, return []

Return ONLY valid JSON array (no markdown, no code blocks) in this format:
[
  {
    "type": "add_faq_pair",
    "targetResourceId": "existing-faq-id",
    "reasoning": "Why this new Q&A pair should be added"
  },
  {
    "type": "refine_faq_pair",
    "targetResourceId": "existing-faq-id",
    "reasoning": "Why this specific Q&A pair needs refinement"
  },
  {
    "type": "add_sop",
    "reasoning": "Why this new guideline is needed"
  }
]

If no improvements are warranted, return exactly: []`,
        temperature: 0.2,
        maxOutputTokens: 1200,
      });

      const trimmed = text.trim();
      if (!trimmed || trimmed === "[]" || trimmed === "null") return [];

      try {
        const jsonMatch = trimmed.match(/\[[\s\S]*\]/);
        const parsed = JSON.parse(
          jsonMatch ? jsonMatch[0] : trimmed,
        ) as Array<Record<string, unknown>>;

        const validTypes = new Set([
          ...(existingContext.faqCandidates.length === 0 ? ["new_faq"] : []),
          "add_faq_pair",
          "refine_faq_pair",
          "new_sop",
          "add_sop",
          "refine_sop",
          "update_pdf",
          "update_webpage",
          "update_context",
        ]);
        const faqIds = new Set(
          existingContext.faqCandidates.map((faq) => faq.id),
        );
        const guidelineIds = new Set(
          existingContext.guidelineCandidates.map((guideline) => guideline.id),
        );
        const pdfIds = new Set(
          existingContext.pdfCandidates.map((pdf) => pdf.id),
        );
        const webpagePages = new Map(
          existingContext.webpageCandidates.map((page) => [page.pageId, page]),
        );

        const plans: KnowledgeRefinementPlan[] = [];

        for (const entry of parsed) {
          const type =
            typeof entry.type === "string" ? entry.type : undefined;
          const targetResourceId =
            typeof entry.targetResourceId === "string"
              ? entry.targetResourceId
              : undefined;
          const targetGuidelineId =
            typeof entry.targetGuidelineId === "string"
              ? entry.targetGuidelineId
              : undefined;
          const targetPageId =
            typeof entry.targetPageId === "string"
              ? entry.targetPageId
              : undefined;
          const reasoning =
            typeof entry.reasoning === "string" ? entry.reasoning : undefined;

          if (!type || !reasoning || !validTypes.has(type)) {
            continue;
          }

          switch (type) {
            case "add_faq_pair":
            case "refine_faq_pair":
              if (targetResourceId && faqIds.has(targetResourceId)) {
                plans.push({ type, targetResourceId, reasoning });
              }
              break;
            case "add_sop":
              plans.push({ type, reasoning });
              break;
            case "refine_sop":
              if (targetGuidelineId && guidelineIds.has(targetGuidelineId)) {
                plans.push({ type, targetGuidelineId, reasoning });
              }
              break;
            case "update_pdf":
              if (targetResourceId && pdfIds.has(targetResourceId)) {
                plans.push({ type, targetResourceId, reasoning });
              }
              break;
            case "update_webpage":
              if (targetPageId && targetResourceId) {
                const page = webpagePages.get(targetPageId);
                if (page && page.resourceId === targetResourceId) {
                  plans.push({
                    type,
                    targetResourceId,
                    targetPageId,
                    reasoning,
                  });
                }
              }
              break;
            case "new_faq":
              // Only allow new_faq when no existing FAQs
              if (existingContext.faqCandidates.length === 0) {
                plans.push({ type, reasoning });
              }
              break;
            case "new_sop":
            case "update_context":
              plans.push({ type, reasoning });
              break;
          }
        }

        return plans;
      } catch {
        return [];
      }
    } catch {
      return [];
    }
  }

  async generateKnowledgeSuggestionPayload(
    conversationMessages: Array<{ role: string; content: string }>,
    plan: KnowledgeRefinementPlan,
    context: {
      companyContext: string | null;
      faqTarget?: {
        id: string;
        title: string;
        pairs: Array<{ question: string; answer: string }>;
      };
      guidelineTarget?: {
        id: string;
        condition: string;
        instruction: string;
      };
      pdfTarget?: {
        id: string;
        title: string;
        excerpt: string;
      };
      webpageTarget?: {
        pageId: string;
        resourceId: string;
        resourceTitle: string;
        pageTitle: string | null;
        url: string;
        excerpt: string;
      };
    },
  ): Promise<KnowledgeRefinementSuggestion | null> {
    const transcript = conversationMessages
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    switch (plan.type) {
      case "new_faq": {
        const suggestion = await this.generateJsonObject({
          prompt: `You are creating a new FAQ resource from a support conversation.

CONVERSATION:
${transcript}

Rules:
- Create 1-5 concise Q&A pairs
- Use a title that groups the topic clearly
- Do not create duplicate or near-duplicate questions inside the same FAQ
- Return only valid JSON

Return this exact shape:
{"title":"FAQ title","pairs":[{"question":"...","answer":"..."}]}`,
          maxOutputTokens: 1200,
        });

        if (!suggestion) return null;
        return { ...plan, suggestion };
      }
      case "add_faq_pair": {
        if (!context.faqTarget) return null;
        const suggestion = await this.generateJsonObject({
          prompt: `You are adding ONE new Q&A pair to an existing FAQ based on a support conversation.

CONVERSATION:
${transcript}

EXISTING FAQ:
Title: ${context.faqTarget.title}
Current questions:
${context.faqTarget.pairs.map((p) => `- ${p.question}`).join("\n")}

Rules:
- Create exactly ONE new Q&A pair that addresses something from the conversation
- Do not duplicate any existing question
- Keep the answer concise and helpful
- Return only valid JSON

Return this exact shape:
{"pair":{"question":"...","answer":"..."}}`,
          maxOutputTokens: 500,
        });

        if (!suggestion) return null;
        return { ...plan, suggestion };
      }
      case "refine_faq_pair": {
        if (!context.faqTarget) return null;

        // Find which pair from the conversation needs refinement
        const suggestion = await this.generateJsonObject({
          prompt: `You are refining ONE specific Q&A pair in an existing FAQ based on a support conversation.

CONVERSATION:
${transcript}

EXISTING FAQ PAIRS:
${context.faqTarget.pairs
  .map((p, i) => `[${i}] Q: ${p.question}\n    A: ${p.answer}`)
  .join("\n\n")}

Rules:
- Identify which ONE existing pair needs refinement based on the conversation
- Provide the index, original pair, and refined version
- Make the minimum necessary changes
- Return only valid JSON

Return this exact shape:
{"pairIndex":0,"originalPair":{"question":"...","answer":"..."},"refinedPair":{"question":"...","answer":"..."}}`,
          maxOutputTokens: 800,
        });

        if (!suggestion) return null;
        return { ...plan, suggestion };
      }
      case "new_sop": {
        const suggestion = await this.generateJsonObject({
          prompt: `You are creating a new SOP from a support conversation.

CONVERSATION:
${transcript}

Rules:
- The condition should describe when the SOP applies
- The instruction should describe exactly how the bot should respond or behave
- Keep both concise and specific
- Return only valid JSON

Return this exact shape:
{"condition":"When ...","instruction":"The bot should ..."}`,
          maxOutputTokens: 400,
        });

        if (!suggestion) return null;
        return { ...plan, suggestion };
      }
      case "add_sop": {
        const suggestion = await this.generateJsonObject({
          prompt: `You are creating ONE new SOP guideline based on a support conversation.

CONVERSATION:
${transcript}

Rules:
- Create exactly ONE guideline that addresses something from the conversation
- The condition should describe when the SOP applies
- The instruction should be actionable
- Keep both condition and instruction clear and concise
- Return only valid JSON

Return this exact shape:
{"condition":"When ...","instruction":"The bot should ..."}`,
          maxOutputTokens: 500,
        });

        if (!suggestion) return null;
        return { ...plan, suggestion };
      }
      case "refine_sop": {
        if (!context.guidelineTarget) return null;
        const suggestion = await this.generateJsonObject({
          prompt: `You are refining ONE existing SOP guideline based on a support conversation.

CONVERSATION:
${transcript}

CURRENT SOP:
When: ${context.guidelineTarget.condition}
Then: ${context.guidelineTarget.instruction}

Rules:
- Refine this specific guideline based on the conversation
- Provide both original and refined versions
- Make the minimum necessary changes
- Return only valid JSON

Return this exact shape:
{"originalCondition":"${context.guidelineTarget.condition}","originalInstruction":"${context.guidelineTarget.instruction}","refinedCondition":"When ...","refinedInstruction":"The bot should ..."}`,
          maxOutputTokens: 600,
        });

        if (!suggestion) return null;
        return { ...plan, suggestion };
      }
      case "update_pdf": {
        if (!context.pdfTarget) return null;
        const suggestion = await this.generateJsonObject({
          prompt: `You are refining an existing PDF knowledge resource based on a support conversation.

CONVERSATION:
${transcript}

TARGET PDF:
Title: ${context.pdfTarget.title}

RELEVANT CURRENT EXCERPT:
${context.pdfTarget.excerpt}

Rules:
- Do NOT rewrite the whole document
- Use "replace" when an existing excerpt is wrong or incomplete
- Use "append" only when the missing information should be added as a new short section
- If using "replace", currentText must be copied exactly from the current excerpt
- Keep changes narrow and retrieval-friendly
- Return only valid JSON

Return one of these exact shapes:
{"mode":"replace","currentText":"exact text from excerpt","updatedText":"replacement text"}
{"mode":"append","appendText":"new text to append"}`,
          maxOutputTokens: 900,
        });

        if (!suggestion) return null;
        return { ...plan, suggestion };
      }
      case "update_webpage": {
        if (!context.webpageTarget) return null;
        const suggestion = await this.generateJsonObject({
          prompt: `You are refining an existing crawled web page resource based on a support conversation.

CONVERSATION:
${transcript}

TARGET WEB PAGE:
Resource: ${context.webpageTarget.resourceTitle}
Page title: ${context.webpageTarget.pageTitle ?? "(untitled)"}
URL: ${context.webpageTarget.url}

RELEVANT CURRENT EXCERPT:
${context.webpageTarget.excerpt}

Rules:
- Do NOT rewrite the whole page
- Use "replace" when an existing excerpt is wrong or incomplete
- Use "append" only when the missing information should be added as a short supplemental section
- If using "replace", currentText must be copied exactly from the current excerpt
- Keep changes narrow and retrieval-friendly
- Return only valid JSON

Return one of these exact shapes:
{"mode":"replace","currentText":"exact text from excerpt","updatedText":"replacement text","pageUrl":"${context.webpageTarget.url}"}
{"mode":"append","appendText":"new text to append","pageUrl":"${context.webpageTarget.url}"}`,
          maxOutputTokens: 900,
        });

        if (!suggestion) return null;
        return { ...plan, suggestion };
      }
      case "update_context": {
        const suggestion = await this.generateJsonObject({
          prompt: `You are updating high-level company context from a support conversation.

CONVERSATION:
${transcript}

CURRENT COMPANY CONTEXT:
${context.companyContext ?? "(none)"}

Rules:
- Only append high-level business or support context that belongs in company context
- Do NOT duplicate product documentation, FAQ answers, or SOP behavior already better suited elsewhere
- Return only valid JSON

Return this exact shape:
{"appendText":"..."}`,
          maxOutputTokens: 500,
        });

        if (!suggestion) return null;
        return { ...plan, suggestion };
      }
      default:
        return null;
    }
  }

  async generateJsonObject(options: {
    prompt: string;
    maxOutputTokens: number;
  }): Promise<Record<string, unknown> | null> {
    try {
      const { text } = await generateText({
        model: this.model,
        prompt: options.prompt,
        temperature: 0.2,
        maxOutputTokens: options.maxOutputTokens,
      });

      return parseJsonObject(text);
    } catch {
      return null;
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

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const cleaned = text
      .replace(/```json?\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();
    const objectMatch = cleaned.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(objectMatch ? objectMatch[0] : cleaned);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
