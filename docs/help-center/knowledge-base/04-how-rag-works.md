---
title: How RAG works
slug: how-rag-works
excerpt: How ReplyMaven grounds AI answers in your actual content.
---

ReplyMaven uses Retrieval-Augmented Generation (RAG) to ground AI responses in your real content instead of general model knowledge:

1. Your sources (web pages, PDFs, FAQs, published help articles) are stored securely and indexed for search.
2. When a visitor sends a message, the most relevant content chunks are retrieved from the index.
3. Only chunks above a relevance threshold are included, so weak matches do not pollute the answer.
4. The retrieved context is passed to the AI model together with the conversation history, your company context, and tone of voice.
5. Source references are resolved and shown below the bot's response as clickable links.

## What this means in practice

- The bot cannot answer what your sources do not cover. Gaps in answers are gaps in knowledge; add a source or an FAQ to fix them.
- Contradictory sources produce muddy answers. Retire outdated pages instead of leaving both versions indexed.
- Specific, well-structured content retrieves better than long unstructured pages.

Related:

- [Add web pages](/help/replymaven/knowledge-base/web-pages)
- [Create FAQs](/help/replymaven/knowledge-base/faqs)
- [Help articles feed your AI](/help/replymaven/knowledge-base/help-articles-as-knowledge)
