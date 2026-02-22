import { Link } from "react-router-dom";
import { MessageSquare, Zap, Globe, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center">
              <MessageSquare className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-semibold text-foreground text-lg">
              ReplyMaven
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/login">
              <Button variant="outline" size="sm">
                Log in
              </Button>
            </Link>
            <Link to="/signup">
              <Button size="sm">Get Started</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 py-24 text-center">
        <h1 className="text-5xl font-bold text-foreground tracking-tight font-heading">
          AI-Powered Customer Support
          <br />
          <span className="text-muted-foreground">for Your Website</span>
        </h1>
        <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto">
          Create a smart support chatbot that knows your product inside out.
          Embed it on your website in minutes. Let AI handle the routine while
          you focus on what matters.
        </p>
        <div className="mt-10 flex items-center justify-center gap-4">
          <Link to="/signup">
            <Button size="lg">Start Free</Button>
          </Link>
          <Link to="/login">
            <Button variant="outline" size="lg">
              View Demo
            </Button>
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-6 py-16">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="bg-card/50 backdrop-blur-xl rounded-2xl border border-border p-6 space-y-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Bot className="w-5 h-5 text-primary" />
            </div>
            <h3 className="text-lg font-semibold text-card-foreground">
              Smart AI Responses
            </h3>
            <p className="text-sm text-muted-foreground">
              Powered by Google Gemini with RAG over your knowledge base.
              Accurate, context-aware answers every time.
            </p>
          </div>
          <div className="bg-card/50 backdrop-blur-xl rounded-2xl border border-border p-6 space-y-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Globe className="w-5 h-5 text-primary" />
            </div>
            <h3 className="text-lg font-semibold text-card-foreground">
              Easy Embed
            </h3>
            <p className="text-sm text-muted-foreground">
              Add a single script tag to your website. Customize colors, tone,
              and behavior from your dashboard.
            </p>
          </div>
          <div className="bg-card/50 backdrop-blur-xl rounded-2xl border border-border p-6 space-y-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Zap className="w-5 h-5 text-primary" />
            </div>
            <h3 className="text-lg font-semibold text-card-foreground">
              Live Agent Handoff
            </h3>
            <p className="text-sm text-muted-foreground">
              When AI can't help, seamlessly hand off to a human agent via
              Telegram. No context lost.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8 text-center text-sm text-muted-foreground">
        ReplyMaven &mdash; Built on Cloudflare Workers
      </footer>
    </div>
  );
}

export default Landing;
