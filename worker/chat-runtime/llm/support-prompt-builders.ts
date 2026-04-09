interface PromptBlockOptions {
  transcript: string;
  currentMessage?: string;
  pageContextBlock?: string;
}

export function buildClassifySupportTurnPrompt(
  options: PromptBlockOptions,
): string {
  return `Classify the next support-chat turn and provide retrieval hints for the orchestrator.

Conversation:
${options.transcript || "No prior conversation"}

Latest user message:
${options.currentMessage ?? ""}

Page context:
${options.pageContextBlock ?? "None"}

You must produce:
- intent:
  - how_to: asks how to perform, set up, configure, or use something
  - troubleshoot: reports something broken, failing, or not working
  - lookup: needs account-specific data, status, or a backend lookup/action
  - policy: asks about plans, pricing, billing, limits, refund, security, or policy
  - clarify: too ambiguous to act on confidently yet
  - handoff: explicitly wants a human or support team handoff
- summary: one short line describing the handling posture
- retrievalQueries: focused documentation searches that would help if docs should be consulted
- broaderQueries: broader second-pass documentation searches if focused docs miss
- followUpQuestion: one focused question to ask when the request remains underspecified

Important context assessment:
- Consider the business context when determining if a message has enough detail
- A message is NOT vague just because it's short - assess whether it provides enough context for the specific business domain
- Consider industry-specific terminology and concepts when evaluating clarity
- If the user mentions specific items, features, or issues relevant to their context, treat it as actionable

Rules:
- Do not invent product-specific features or terminology.
- Assess message completeness based on what would be reasonable for the business context
- A message mentioning specific business elements (products, services, features) has sufficient context
- Only mark as "clarify" if genuinely ambiguous for any business context
- Retrieval hints are only hints. Do not use them to decide tool policy or runtime escalation state.
- Questions like "how do I check if X is working?" or "how can I verify X is connected?" are troubleshooting/docs turns, not lookup turns, unless they clearly require account-specific backend data.
- For lookup turns, retrievalQueries can be empty if documentation is unlikely to help.
- For clarify turns, include focused retrieval queries whenever a feature, page, integration, or topic is already known. Do not skip docs just because the request is underspecified.
- For handoff turns, retrievalQueries and broaderQueries should usually be empty unless the same message also contains a concrete product question that still needs documentation context.
- Prefer troubleshooting-oriented search phrases over repeating raw complaints.
- If a product, page, step, error, pricing topic, or integration is mentioned, include it in retrieval queries when relevant.
- Broader queries should be more general than focused queries, but still relevant to the issue.
- Keep queries short and search-friendly.`;
}

export function buildReformulateQueryPrompt(
  options: PromptBlockOptions,
): string {
  return `Given the conversation below, rewrite the user's latest message into a standalone search query that captures the full intent. The query should be self-contained and optimized for searching a knowledge base.

If the latest message is vague or underspecified (for example "x is not working", "it failed", or "billing is broken"), do NOT just repeat the exact phrase. Expand it into a docs-oriented search query using the feature, page, topic, or pricing/policy detail mentioned by the user if available, plus likely documentation terms such as setup, troubleshooting, common issues, configuration, errors, billing, pricing, or policy.

Do not invent product features, hidden tools, or facts that were not mentioned or implied by the conversation.

CONVERSATION:
${options.transcript}

LATEST MESSAGE: ${options.currentMessage ?? ""}

Output ONLY the rewritten search query, nothing else. If the latest message is already a clear standalone question, return it as-is.`;
}

export function buildSummarizeConversationPrompt(
  options: PromptBlockOptions,
): string {
  return `Summarize this customer support conversation in 1-2 sentences. Focus on: what the visitor needs help with and what has been discussed so far. Be factual and concise.

CONVERSATION:
${options.transcript}

SUMMARY:`;
}

export function buildSummarizeTeamRequestPrompt(
  options: PromptBlockOptions,
): string {
  return `Summarize this support conversation for an internal team follow-up request created by the runtime.

CONVERSATION:
${options.transcript}

Write a short factual summary that covers:
- what the visitor is trying to do
- what is not working or still unclear
- any concrete details already shared
- what the team should investigate or respond with

Rules:
- Keep it under 700 characters
- Do not invent details
- Do not use markdown headings
- Write in plain text for an internal support note`;
}

export function buildExtractContactInfoPrompt(
  options: PromptBlockOptions,
): string {
  return `Extract the visitor's name and email from these messages. Extract only contact details the visitor explicitly shared. If either is not present, declined, or still unknown, return "unknown".

VISITOR MESSAGES:
${options.transcript}

Respond in exactly this format (no other text):
name: <name or unknown>
email: <email or unknown>`;
}
