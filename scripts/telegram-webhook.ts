/**
 * Points Telegram at this instance's webhook.
 *
 *   npm run telegram:webhook
 *   npm run telegram:webhook -- --delete
 *
 * Telegram will only POST to public HTTPS, so VITE_SITE_URL must be that origin.
 * Locally that means a tunnel; after deploy it is the live site.
 */

const token = process.env["TELEGRAM_BOT_TOKEN"]?.trim();
const secret = process.env["TELEGRAM_WEBHOOK_SECRET"]?.trim();
const site = (process.env["VITE_SITE_URL"] ?? "").replace(/\/+$/, "");

if (!token) {
  console.error("Missing TELEGRAM_BOT_TOKEN.");
  process.exit(1);
}

const api = (method: string) => `https://api.telegram.org/bot${token}/${method}`;

async function main(): Promise<void> {
  if (process.argv.includes("--delete")) {
    const res = await fetch(api("deleteWebhook"), { method: "POST" });
    console.log(await res.text());
    if (!res.ok) process.exit(1);
    return;
  }

  if (!secret) {
    console.error("Missing TELEGRAM_WEBHOOK_SECRET.");
    process.exit(1);
  }
  if (!site.startsWith("https://")) {
    console.error("VITE_SITE_URL must be public HTTPS for setWebhook.");
    process.exit(1);
  }

  const res = await fetch(api("setWebhook"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: `${site}/api/telegram/webhook`,
      secret_token: secret,
      allowed_updates: ["message"],
    }),
  });
  console.log(await res.text());
  if (!res.ok) process.exit(1);
}

await main();

export {};
