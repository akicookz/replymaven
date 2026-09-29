# How ReplyMaven works

When a visitor sends a message, the widget sends it to ReplyMaven. Maven searches the project's web pages, PDFs, FAQs, and published help articles. It uses relevant results with your company context and persona to prepare a reply. The reply streams into the conversation.

If a visitor needs a person, Maven can ask your team for help. Maven keeps helping while the team reviews the conversation. When a teammate takes ownership, Maven pauses its automatic replies. A visitor can still ask Maven directly, and ownership can return to Maven after a quiet period. Read [Agent handoff](https://replymaven.com/docs/conversations/agent-handoff) for the full flow.

Your team can work from the dashboard, email, Slack, or Telegram when those channels are connected. Maven has a private team thread for each conversation. Team messages in that thread do not go to the visitor unless a teammate sends a customer reply or email.

The widget sends the current page URL and title with messages. Add app state with [page context](https://replymaven.com/docs/widget-api/page-context). Add sources in [Maven → Knowledge](https://replymaven.com/docs/knowledge-base).

> [!INFO]
> Answers depend on the content and tools available to the project. More sources can help, but they do not guarantee a correct answer. See [How RAG works](https://replymaven.com/docs/knowledge-base/how-rag-works).
