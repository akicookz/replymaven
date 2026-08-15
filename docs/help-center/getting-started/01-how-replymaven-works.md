---
title: How ReplyMaven works
slug: how-replymaven-works
excerpt: What happens between a visitor's question and the AI's answer.
---

When a visitor sends a message:

1. The message goes to the ReplyMaven API.
2. The API searches your knowledge base (web pages, PDFs, FAQs, help articles) with RAG (Retrieval-Augmented Generation).
3. The most relevant content is passed to the AI model together with your tone of voice configuration and company context.
4. The AI response streams back into the chat in real time.
5. If the AI cannot answer confidently, or the visitor asks for a person, the conversation is handed off to a human agent. See [Agent handoff](/help/replymaven/conversations/agent-handoff).

The AI always knows what page the visitor is on: the widget sends the current page URL and title with every message. You can add richer app-specific context with [page context](/help/replymaven/widget-api/page-context).

> [!INFO]
> The AI only answers from your knowledge base and configuration. The more sources you add, the better the answers get. See [How RAG works](/help/replymaven/knowledge-base/how-rag-works).
