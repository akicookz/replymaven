import { Resend } from "resend";

export class EmailService {
  private resend: Resend;

  constructor(apiKey: string) {
    this.resend = new Resend(apiKey);
  }

  async sendWelcomeEmail(to: string, name: string): Promise<void> {
    await this.resend.emails.send({
      from: "ReplyMaven <noreply@replymaven.com>",
      to,
      subject: "Welcome to ReplyMaven",
      html: `
        <h1>Welcome, ${name}!</h1>
        <p>Thanks for signing up for ReplyMaven. You can now create your first project and start building your AI support agent.</p>
        <p>Get started by creating a project in your dashboard.</p>
      `,
    });
  }
}
