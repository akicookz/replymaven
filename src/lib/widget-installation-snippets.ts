export const identityServerSnippet = `import { createHmac } from "node:crypto";

function encodeBase64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function createReplyMavenIdentityToken(user: AppUser): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = encodeBase64Url(JSON.stringify({
    v: 1,
    projectId: process.env.REPLYMAVEN_PROJECT_ID,
    externalId: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone,
    customFields: { plan: user.plan, seats: user.seats },
    iat: now,
    exp: now + 15 * 60,
  }));
  const signature = createHmac(
    "sha256",
    process.env.REPLYMAVEN_IDENTITY_SECRET!,
  ).update(payload).digest("base64url");
  return \`${"${payload}"}.${"${signature}"}\`;
}`;

export const identityBrowserSnippet = `async function identifyReplyMavenCustomer() {
  const { token } = await fetch("/api/replymaven-identity")
    .then((response) => response.json());
  await window.ReplyMaven.identify({ token });
}

// Call as soon as authenticated user data is available.
await identifyReplyMavenCustomer();

// When name, email, phone, plan, or other trusted fields change, fetch a fresh
// token and identify again. The external ID keeps the same customer profile.
await identifyReplyMavenCustomer();

async function logout() {
  window.ReplyMaven.reset();
  await appLogout();
}`;
