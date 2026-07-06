import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { type ProjectSettingsRow } from "../db";
import { INDUSTRIES } from "../../shared/industries";
import {
  buildExtractContactInfoPrompt,
  buildReformulateQueryPrompt,
  buildSummarizeConversationPrompt,
} from "../chat-runtime/llm/support-prompt-builders";
import { buildSupportSystemPrompt } from "../chat-runtime/prompt/build-support-system-prompt";

// ─── Service ──────────────────────────────────────────────────────────────────

interface AiServiceConfig {
  model: string;
  geminiApiKey: string;
  openaiApiKey: string;
}

export interface CompanyProfile {
  websiteName: string;
  companyName: string;
  industry: string;
  context: string;
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

    const recentHistory = conversationHistory.slice(-12);
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
    | { action: "ban"; reason: string }
  > {
    try {
      const { text } = await generateText({
        model: this.model,
        prompt: `A human support agent typed the following message directed at their AI assistant (chatbot). The agent is telling the bot what to do next for a customer conversation.

"${agentText}"

Determine the agent's intent. There are exactly four possible intents:

1. CLOSE — The agent is saying the conversation is done, resolved, finished, or should be closed.
   Examples: "we're done here", "this is resolved", "all sorted, customer is happy", "close this one"

2. HANDBACK — The agent is giving the bot private/internal instructions to follow silently going forward. The visitor should NOT see or know about these instructions. The bot should just keep them in mind for future messages.
   Examples: "don't mention to user but if they keep complaining, cancel their account", "offer them 20% off if they ask about pricing", "be extra careful with this customer, they're a VIP"

3. RESPOND — The agent wants the bot to immediately respond to the visitor with specific information or in a specific way. The visitor WILL see the bot's response.
   Examples: "explain how the refund process works", "tell them about our pricing plans", "answer their question about shipping", "take over", "you handle it from here"

4. BAN — The agent wants to ban/block this visitor from using the chat. Used for spam, abuse, or harassment.
   Examples: "ban this user", "block them", "this is spam, ban", "ban for harassment", "block this spammer"

Key distinction between HANDBACK and RESPOND:
- HANDBACK = secret instructions for the bot's behavior (visitor never sees the instruction itself)
- RESPOND = the agent wants the bot to generate a visible response to the visitor right now

Respond with ONLY a valid JSON object, no other text:

For CLOSE: {"action":"close"}
For HANDBACK: {"action":"handback","instructions":"<the private instructions>"}
For RESPOND: {"action":"respond","instructions":"<what the bot should respond about>"}
For BAN: {"action":"ban","reason":"<reason for the ban>"}

JSON:`,
        temperature: 0,
        maxOutputTokens: 256,
      });

      const parsed = JSON.parse(text.trim());
      if (parsed.action === "close") return { action: "close" };
      if (parsed.action === "ban") {
        return {
          action: "ban",
          reason: parsed.reason ?? "Banned by agent",
        };
      }
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
      | "workingHours"
      | "avgResponseTime"
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

  // ─── Suggest FAQ Description ───────────────────────────────────────────────

  async suggestFaqDescription(options: {
    pairs: Array<{ question: string; answer: string }>;
  }): Promise<string> {
    if (options.pairs.length === 0) return "";

    const pairListing = options.pairs
      .slice(0, 20)
      .map((pair) => `- Q: ${pair.question}`)
      .join("\n");

    try {
      const { text } = await generateText({
        model: this.model,
        prompt: `Given these FAQ questions, write ONE sentence (≤200 chars) that tells an AI agent when to consult this FAQ. Reply with the sentence only — no quotes, no preamble.

QUESTIONS:
${pairListing}

Sentence:`,
        temperature: 0.3,
        maxOutputTokens: 128,
      });

      return text
        .trim()
        .replace(/^["']|["']$/g, "")
        .slice(0, 500);
    } catch {
      return "";
    }
  }

  // ─── Split FAQ into Buckets ────────────────────────────────────────────────

  async splitFaqIntoBuckets(options: {
    originalTitle: string;
    originalDescription: string | null;
    pairs: Array<{ question: string; answer: string }>;
    maxBucketChars: number;
  }): Promise<Array<{
    title: string;
    description: string;
    pairIndices: number[];
  }> | null> {
    const indexedPairs = options.pairs.map((pair, index) => ({
      index,
      ...pair,
    }));

    const pairListing = indexedPairs
      .map(
        (pair) =>
          `[${pair.index}] Q: ${pair.question}\n    A: ${pair.answer}`,
      )
      .join("\n\n");

    const totalCount = options.pairs.length;
    const descriptionLine = options.originalDescription
      ? `Original "when to refer" description: ${options.originalDescription}`
      : "Original FAQ has no routing description.";

    const prompt = `You are splitting an oversized FAQ into 2 or 3 topically coherent smaller FAQ sets.

Original FAQ title: ${options.originalTitle}
${descriptionLine}

PAIRS (each line shows the original index):
${pairListing}

Rules:
- Group the ${totalCount} pairs into 2 OR 3 buckets by topic.
- EVERY index from 0 to ${totalCount - 1} must appear in exactly ONE bucket. Do NOT omit any index. Do NOT duplicate any index.
- Each bucket's combined Q+A character total should be ≤ ${options.maxBucketChars} (give yourself headroom).
- Each bucket needs a 1-4 word title that describes its topic.
- Each bucket needs a one-sentence "when to refer" description (≤200 chars) so an AI agent can route to the right set. The description must clearly distinguish this bucket from the others.
- Do NOT modify pair contents. Only group by index.
- Return ONLY valid JSON (no markdown, no commentary).

Return this exact shape:
{"buckets":[{"title":"...","description":"...","pairIndices":[0,2,5]},{"title":"...","description":"...","pairIndices":[1,3,4]}]}`;

    const tryGenerate = async (): Promise<Record<string, unknown> | null> => {
      try {
        const { text } = await generateText({
          model: this.model,
          prompt,
          temperature: 0.2,
          maxOutputTokens: 2048,
        });
        return parseJsonObject(text);
      } catch {
        return null;
      }
    };

    let parsed = await tryGenerate();
    if (!parsed) {
      parsed = await tryGenerate();
    }
    if (!parsed) return null;

    const rawBuckets = Array.isArray(parsed.buckets) ? parsed.buckets : [];
    if (rawBuckets.length < 2 || rawBuckets.length > 5) return null;

    const buckets: Array<{
      title: string;
      description: string;
      pairIndices: number[];
    }> = [];

    for (const entry of rawBuckets) {
      if (!entry || typeof entry !== "object") continue;
      const record = entry as Record<string, unknown>;
      const title = typeof record.title === "string" ? record.title.trim() : "";
      const description =
        typeof record.description === "string" ? record.description.trim() : "";
      const indicesRaw = Array.isArray(record.pairIndices)
        ? record.pairIndices
        : [];
      const indices: number[] = [];
      for (const value of indicesRaw) {
        if (typeof value !== "number" || !Number.isInteger(value)) continue;
        if (value < 0 || value >= totalCount) continue;
        indices.push(value);
      }
      if (!title || indices.length === 0) continue;
      buckets.push({ title, description, pairIndices: indices });
    }

    if (buckets.length < 2) return null;

    // Reconcile partition: every index must appear exactly once across all buckets.
    const seen = new Set<number>();
    let duplicate = false;
    for (const bucket of buckets) {
      for (const idx of bucket.pairIndices) {
        if (seen.has(idx)) {
          duplicate = true;
          break;
        }
        seen.add(idx);
      }
      if (duplicate) break;
    }
    if (duplicate || seen.size !== totalCount) return null;

    return buckets;
  }

  // ─── Generate FAQ from Sources ──────────────────────────────────────────────

  async generateFaqFromSources(options: {
    topic: string;
    sourceText: string;
    existingQuestions: string[];
    existingDescriptions: Array<{ title: string; description: string }>;
    targetPairCount: number;
    maxSetChars: number;
    maxPairChars: number;
    maxDescriptionChars: number;
  }): Promise<{
    title: string;
    description: string;
    pairs: Array<{ question: string; answer: string }>;
  } | null> {
    const existingQuestionsBlock =
      options.existingQuestions.length > 0
        ? options.existingQuestions
            .slice(0, 200)
            .map((q) => `- ${q}`)
            .join("\n")
        : "(none)";

    const existingDescriptionsBlock =
      options.existingDescriptions.length > 0
        ? options.existingDescriptions
            .map((d) => `- ${d.title}: ${d.description}`)
            .join("\n")
        : "(none)";

    const prompt = `You are generating ONE new FAQ resource for a customer support knowledge base.

TOPIC:
${options.topic}

SOURCE MATERIAL (use ONLY these facts):
${options.sourceText || "(no source material provided — generate based on topic alone)"}

EXISTING FAQ QUESTIONS ACROSS ALL FAQ SETS (do NOT generate any question semantically equivalent to these):
${existingQuestionsBlock}

EXISTING FAQ ROUTING DESCRIPTIONS (do NOT generate a description that overlaps with these — yours must distinctly cover the topic above):
${existingDescriptionsBlock}

Rules:
- Generate ${options.targetPairCount} concise, distinct Q&A pairs about the topic.
- Each Q&A pair (question + answer combined) must be ≤ ${options.maxPairChars} characters.
- The total of all questions + answers combined must be ≤ ${options.maxSetChars} characters.
- Use ONLY facts present in the source material. If the source does not support an answer, omit that pair entirely (do not fabricate).
- Skip any question that is semantically equivalent to one in the existing-questions list above. It is better to return fewer pairs than to duplicate.
- Title must be 1-4 words summarizing the topic.
- Description must be ONE sentence (≤ ${options.maxDescriptionChars} chars) telling an AI agent when to consult this FAQ. It must clearly distinguish this FAQ from the existing routing descriptions.
- Return ONLY valid JSON (no markdown, no code fences, no commentary).

Return this exact shape:
{"title":"...","description":"...","pairs":[{"question":"...","answer":"..."}]}`;

    const tryGenerate = async (): Promise<Record<string, unknown> | null> => {
      try {
        const { text } = await generateText({
          model: this.model,
          prompt,
          temperature: 0.3,
          maxOutputTokens: 4096,
        });
        return parseJsonObject(text);
      } catch {
        return null;
      }
    };

    let parsed = await tryGenerate();
    if (!parsed) {
      parsed = await tryGenerate();
    }
    if (!parsed) return null;

    const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
    const description =
      typeof parsed.description === "string" ? parsed.description.trim() : "";
    const rawPairs = Array.isArray(parsed.pairs) ? parsed.pairs : [];
    const pairs: Array<{ question: string; answer: string }> = [];

    for (const entry of rawPairs) {
      if (!entry || typeof entry !== "object") continue;
      const record = entry as Record<string, unknown>;
      const question =
        typeof record.question === "string" ? record.question.trim() : "";
      const answer =
        typeof record.answer === "string" ? record.answer.trim() : "";
      if (!question || !answer) continue;
      if (question.length + answer.length > options.maxPairChars) continue;
      pairs.push({ question, answer });
    }

    if (!title || pairs.length === 0) return null;

    return { title, description, pairs };
  }

  // ─── Extract Company Profile From Website ───────────────────────────────────

  async extractCompanyProfile(
    rawText: string,
    websiteUrl: string,
  ): Promise<CompanyProfile | null> {
    const truncated = rawText.slice(0, 15000);

    const json = await this.generateJsonObject({
      prompt: `You are analyzing a website's content to set up an AI customer support chatbot for it.

WEBSITE URL: ${websiteUrl}

WEBSITE CONTENT:
${truncated}

Extract the following and return ONLY a JSON object with these exact keys:
{
  "websiteName": "The product/website name as the company brands it (e.g. \\"Notion\\", \\"My Awesome App\\"). Max 60 chars.",
  "companyName": "The legal/company name if mentioned, otherwise the brand name (e.g. \\"Acme Inc.\\"). Max 100 chars.",
  "industry": "Exactly one of: ${INDUSTRIES.join(", ")}",
  "context": "A concise but comprehensive factual company description for the support agent's knowledge base: what the company does (products/services), key features or offerings, target audience, and any policies, pricing, or FAQs mentioned. Not marketing copy. Under 2000 characters."
}

If the content is very sparse, extract whatever useful info you can and make reasonable inferences from the URL and content. Return only valid JSON.`,
      maxOutputTokens: 1500,
    });

    if (!json) return null;

    let websiteName =
      typeof json.websiteName === "string" ? json.websiteName.trim() : "";
    const companyName =
      typeof json.companyName === "string" ? json.companyName.trim() : "";
    const context =
      typeof json.context === "string" ? json.context.trim() : "";
    const rawIndustry =
      typeof json.industry === "string" ? json.industry.trim() : "";
    const industry =
      INDUSTRIES.find(
        (i) => i.toLowerCase() === rawIndustry.toLowerCase(),
      ) ?? "Other";

    if (!context) return null;

    // Guarantee a usable website name — the LLM may omit it
    if (!websiteName) websiteName = companyName;
    if (!websiteName) {
      try {
        websiteName = new URL(websiteUrl).hostname.replace(/^www\./, "");
      } catch {
        return null;
      }
    }

    return {
      websiteName: websiteName.slice(0, 100),
      companyName: (companyName || websiteName).slice(0, 200),
      industry,
      context: context.slice(0, 10000),
    };
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
