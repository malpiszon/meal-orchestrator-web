// Auth users for e2e, through the GoTrue Admin API (public sign-up is disabled; accounts come from MO deliveries).

interface AdminUser {
  id: string;
  email?: string;
}

interface AdminUserList {
  users: AdminUser[];
}

const PER_PAGE = 100;
// A bound on paging, so a GoTrue that ignored `page` fails setup with a message instead of looping.
const MAX_PAGES = 20;

function adminConfig(): { url: string; headers: Record<string, string> } {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to provision e2e users");
  return {
    url: `${url}/auth/v1/admin/users`,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  };
}

async function failIfNotOk(response: Response, action: string): Promise<void> {
  if (!response.ok) throw new Error(`${action} answered ${response.status}: ${await response.text()}`);
}

/** The auth user with `email` (case-insensitive), or `undefined`. `filter` matches substrings, so page and compare. */
async function findUser(email: string): Promise<AdminUser | undefined> {
  const { url, headers } = adminConfig();
  const wanted = email.toLowerCase();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const query = new URLSearchParams({ filter: email, page: String(page), per_page: String(PER_PAGE) });
    const response = await fetch(`${url}?${query.toString()}`, { headers });
    await failIfNotOk(response, "Admin user list");
    const { users } = (await response.json()) as AdminUserList;
    const match = users.find((user) => user.email?.toLowerCase() === wanted);
    if (match || users.length < PER_PAGE) return match;
  }
  throw new Error(`Admin user list for ${email} still had full pages after ${MAX_PAGES} pages`);
}

/**
 * Makes sure an account for `email` exists, is confirmed and signs in with `password`: updates it when it
 * exists, creates it otherwise. Only touches the auth user; delivering weeks is the caller's job.
 */
export async function ensureUserWithPassword(email: string, password: string): Promise<void> {
  const { url, headers } = adminConfig();
  const body = JSON.stringify({ email, password, email_confirm: true });
  const existing = await findUser(email);
  const response = existing
    ? await fetch(`${url}/${existing.id}`, { method: "PUT", headers, body })
    : await fetch(url, { method: "POST", headers, body });
  await failIfNotOk(response, existing ? "Admin user update" : "Admin user create");
}
