// Invitation emails from local Supabase's Mailpit.
import { setTimeout as sleep } from "node:timers/promises";

interface MailpitSearch {
  messages?: { ID: string }[];
}

interface MailpitMessage {
  Subject?: string;
  HTML?: string;
  Text?: string;
}

const TIMEOUT_MS = 15_000;
const POLL_MS = 500;
const INVITE_LINK = /\/auth\/set-password\?[^\s"<>]*type=invite/;

async function readJson<T>(url: string, action: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Mailpit ${action} answered ${response.status}: ${await response.text()}`);
  return (await response.json()) as T;
}

/**
 * Waits for the newest email to `email` and returns its invitation link (`/auth/set-password?token_hash=…&type=invite`)
 * on `baseURL`: the email links to Supabase's `site_url`, which need not be where the e2e app runs.
 */
export async function readInvitationLink(email: string, baseURL: string): Promise<string> {
  // `||`, not `??`: .env.example leaves MAILPIT_URL= empty, which means the default.
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  const mailpit = process.env.MAILPIT_URL || "http://127.0.0.1:54324";
  const searchUrl = `${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`;
  const deadline = Date.now() + TIMEOUT_MS;
  do {
    const { messages } = await readJson<MailpitSearch>(searchUrl, "search");
    // Mailpit lists messages newest first.
    const newest = messages?.[0];
    if (newest) {
      const message = await readJson<MailpitMessage>(`${mailpit}/api/v1/message/${newest.ID}`, "message read");
      const body = `${message.HTML ?? ""}\n${message.Text ?? ""}`.replaceAll("&amp;", "&");
      const link = INVITE_LINK.exec(body)?.[0];
      if (!link) throw new Error(`No invitation link in the newest email to ${email} ("${message.Subject ?? ""}")`);
      return new URL(link, baseURL).toString();
    }
    await sleep(POLL_MS);
  } while (Date.now() < deadline);
  throw new Error(`No email to ${email} arrived in Mailpit at ${mailpit} within ${TIMEOUT_MS / 1000} s`);
}
