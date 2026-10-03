// Smoke test: proves the built app, the Cloudflare adapter and the Supabase auth and MO delivery flows still work together.
// Zero dependencies on purpose. Run against a live server:
//   BASE_URL=http://localhost:4321 MO_INGEST_TOKEN=<the server's token> node scripts/smoke.mjs

import { readFile } from "node:fs/promises";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4321";
const email = `smoke-${Date.now()}@example.com`;
const password = "Smoke-Test-Passw0rd!";
const jar = new Map();

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function storeCookies(response) {
  for (const raw of response.headers.getSetCookie()) {
    const [pair, ...attrs] = raw.split(";");
    const [name, ...rest] = pair.split("=");
    const expired = attrs.some((a) => /max-age=0/i.test(a.trim()));
    if (expired) jar.delete(name.trim());
    else jar.set(name.trim(), rest.join("="));
  }
}

async function request(path, { method = "GET", form, json, headers = {} } = {}) {
  const response = await fetch(BASE_URL + path, {
    method,
    redirect: "manual",
    headers: {
      Cookie: cookieHeader(),
      Origin: BASE_URL,
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...(json ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: form ? new URLSearchParams(form).toString() : json ? JSON.stringify(json) : undefined,
  });
  storeCookies(response);
  return { status: response.status, location: response.headers.get("location") ?? "", body: await response.text() };
}

// Astro escapes these characters in rendered text, so match names the way they appear in the HTML.
function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function jsonField(body, key) {
  try {
    return JSON.parse(body)[key];
  } catch {
    return undefined;
  }
}

const MS_PER_DAY = 86_400_000;

function isoDate(epochMs) {
  return new Date(epochMs).toISOString().slice(0, 10);
}

/**
 * The first Monday at least 7 days after today (UTC), as `YYYY-MM-DD`. Today in Europe/Warsaw is at most
 * one day after today in UTC, so that Monday is always "upcoming". Except on Mondays it is two Mondays
 * ahead; the dashboard's "Next week" tab still shows it, because it shows the latest future plan (as in
 * S-01), and the recency gap is then 14 days instead of 7.
 */
function upcomingMonday() {
  const now = new Date();
  let weekStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + 7 * MS_PER_DAY;
  while (new Date(weekStart).getUTCDay() !== 1) weekStart += MS_PER_DAY;
  return isoDate(weekStart);
}

/** The Monday of the current week in Europe/Warsaw (the dashboard's "This week"), as `YYYY-MM-DD`. */
function currentMonday() {
  // en-CA formats as YYYY-MM-DD.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw" }).format(new Date());
  let weekStart = Date.parse(`${today}T00:00:00Z`);
  while (new Date(weekStart).getUTCDay() !== 1) weekStart -= MS_PER_DAY;
  return isoDate(weekStart);
}

/** Whole days from one `YYYY-MM-DD` date to a later one. */
function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY);
}

/** The sample delivery for `deliveryEmail`, moved to the week starting on the Monday `weekStart` (`YYYY-MM-DD`). */
async function loadDelivery(deliveryEmail, weekStart) {
  const sample = JSON.parse(await readFile(new URL("./fixtures/mo-delivery.sample.json", import.meta.url), "utf8"));
  const shift = (date) =>
    isoDate(Date.parse(`${weekStart}T00:00:00Z`) + daysBetween(sample.week_start, date) * MS_PER_DAY);
  return {
    ...sample,
    user: { email: deliveryEmail },
    week_start: weekStart,
    week_end: shift(sample.week_end),
    days: sample.days.map((day) => ({ ...day, date: shift(day.date) })),
  };
}

/** The variant the dashboard recommends for a meal: highest score, ties going to the first listed. */
function recommendedIndex(meal) {
  return meal.variants.reduce((best, variant, index) => (variant.score > meal.variants[best].score ? index : best), 0);
}

const KEEPALIVE_EXPECT_FAILURE = process.env.KEEPALIVE_EXPECT_FAILURE === "1";
// Same schedule as wrangler.jsonc, so local logs read like production ("keepalive ok (0 3 * * *)").
const KEEPALIVE_TRIGGER = "/cdn-cgi/handler/scheduled?cron=0+3+*+*+*";
const DELIVERIES = "/api/mo/deliveries";
const MO_INGEST_TOKEN = process.env.MO_INGEST_TOKEN;
// Optional: the Supabase instance the server uses, to check its grants directly (CI sets both).
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
// Optional: the same instance's service-role key, to generate invitation and password-reset link tokens (CI sets it).
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const inviteEmail = `smoke-invite-${Date.now()}-${Math.random().toString(36).slice(2, 10)}@example.com`;
let recoveryTokenHash;

let delivery, newUserDelivery, redelivery, oldName, newName, currentDelivery, currentName, recencyNote;
if (!KEEPALIVE_EXPECT_FAILURE) {
  if (!MO_INGEST_TOKEN) {
    console.error("MO_INGEST_TOKEN is not set; use the same token the server under test has.");
    process.exit(1);
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) console.log("SKIP  anon grant check (set SUPABASE_URL and SUPABASE_KEY)\n");
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)
    console.log("SKIP  email link checks (set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)\n");
  const nextWeek = upcomingMonday();
  delivery = await loadDelivery(email, nextWeek);
  newUserDelivery = await loadDelivery(
    `smoke-mo-${Date.now()}-${Math.random().toString(36).slice(2, 10)}@example.com`,
    nextWeek,
  );

  // Re-delivery: the same week with the first day's first recommended meal renamed.
  const firstMeal = delivery.days[0].meals[0];
  const index = recommendedIndex(firstMeal);
  oldName = firstMeal.variants[index].name;
  newName = `Smoke re-delivered meal ${Date.now()}`;
  redelivery = structuredClone(delivery);
  redelivery.days[0].meals[0].variants[index].name = newName;
  // The "old name is gone" check is only meaningful if the name occurs nowhere else in the week.
  if (JSON.stringify(redelivery).includes(JSON.stringify(oldName).slice(1, -1))) {
    console.error(`Fixture problem: "${oldName}" occurs more than once in the sample delivery.`);
    process.exit(1);
  }

  // History: the same sample in the current week, with the meal renamed there, so that its name is
  // specific to "This week" and the upcoming week's old name still occurs only in the upcoming week.
  // Its meals keep their ids, so every recommended meal of the upcoming week was planned on the same
  // weekday of the current week, the number of days between the two Mondays earlier.
  const thisWeek = currentMonday();
  currentDelivery = await loadDelivery(email, thisWeek);
  currentName = `Smoke current-week meal ${Date.now()}`;
  currentDelivery.days[0].meals[0].variants[index].name = currentName;
  const gap = daysBetween(thisWeek, nextWeek);
  recencyNote = `In your plan ${gap} days earlier (`;
}

const deliver = (payload) =>
  request(DELIVERIES, { method: "POST", json: payload, headers: { Authorization: `Bearer ${MO_INGEST_TOKEN}` } });

/** Calls ingest_weekly_plan through PostgREST with the anon key, as a browser holding that key could. */
async function anonIngestRpc() {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/ingest_weekly_plan`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      p_email: email,
      p_provider: "smoke",
      p_week_start: delivery.week_start,
      p_week_end: delivery.week_end,
      p_run_id: null,
      p_raw: {},
      p_options: [],
    }),
  });
  return { status: response.status, location: "", body: await response.text() };
}

/**
 * Generates an email link through the Admin API, as Supabase does before sending the email, and returns its
 * `hashed_token` (the `token_hash` the email templates put in the link). Without one, `failure` is a result
 * the step can return, so the run reports what the Admin API answered.
 */
async function generateLinkToken(type, linkEmail) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type, email: linkEmail }),
  });
  const body = await response.text();
  // GoTrue versions differ on where the token sits in the response.
  const hash = jsonField(body, "hashed_token") ?? jsonField(body, "properties")?.hashed_token;
  return hash ? { hash } : { failure: { status: response.status, location: "", body } };
}

/** Opens an email link the way a click in the email does. */
const openEmailLink = (type, tokenHash) =>
  request(`/api/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=${type}`);

const steps = KEEPALIVE_EXPECT_FAILURE
  ? [["keepalive cron reports failure", () => request(KEEPALIVE_TRIGGER), { status: (status) => status >= 400 }]]
  : [
      ["home renders", () => request("/"), { status: 200 }],
      ["dashboard redirects anonymous user", () => request("/dashboard"), { status: 302, location: "/auth/signin" }],
      [
        "signup creates account",
        () => request("/api/auth/signup", { method: "POST", form: { email, password } }),
        { status: 302, location: "/auth/confirm-email" },
      ],
      [
        "signin rejects wrong password",
        () => request("/api/auth/signin", { method: "POST", form: { email, password: "wrong" } }),
        { status: 302, location: "/auth/signin?error=" },
      ],
      [
        "signin accepts correct password",
        () => request("/api/auth/signin", { method: "POST", form: { email, password } }),
        { status: 302, location: "/" },
      ],
      [
        "dashboard shows no upcoming plan yet",
        () => request("/dashboard"),
        { status: 200, body: ["contains 'No upcoming plan yet'", (body) => body.includes("No upcoming plan yet")] },
      ],
      [
        "delivery without a token is rejected",
        () => request(DELIVERIES, { method: "POST", json: delivery }),
        { status: 401 },
      ],
      ...(SUPABASE_URL && SUPABASE_KEY
        ? [
            [
              "anon cannot execute ingest_weekly_plan",
              anonIngestRpc,
              // 42501 = permission denied; a 404 (e.g. a signature mismatch) must not pass as "refused".
              { status: 401, body: ["code 42501", (body) => jsonField(body, "code") === "42501"] },
            ],
          ]
        : []),
      [
        "delivery for a new email creates the account",
        () => deliver(newUserDelivery),
        { status: 200, body: ["account_created: true", (body) => jsonField(body, "account_created") === true] },
      ],
      [
        "current-week delivery for the signed-in user is stored",
        () => deliver(currentDelivery),
        { status: 200, body: ["account_created: false", (body) => jsonField(body, "account_created") === false] },
      ],
      [
        "dashboard shows this week's plan",
        () => request("/dashboard"),
        {
          status: 200,
          body: [
            `contains "This week" and "${currentName}"`,
            (body) => body.includes("This week") && body.includes(escapeHtml(currentName ?? "")),
          ],
        },
      ],
      [
        "delivery for the signed-in user is stored",
        () => deliver(delivery),
        { status: 200, body: ["account_created: false", (body) => jsonField(body, "account_created") === false] },
      ],
      [
        "dashboard shows the recommended meal",
        () => request("/dashboard"),
        { status: 200, body: [`contains "${oldName}"`, (body) => body.includes(escapeHtml(oldName ?? ""))] },
      ],
      [
        "dashboard shows recency notes on the upcoming week",
        () => request("/dashboard"),
        {
          status: 200,
          body: [
            `"Next week" contains "${recencyNote}" and "This week" has no note`,
            (body) => {
              // The panels render in tab order: "This week", then "Next week".
              const [, thisWeek, nextWeek] = body.split('data-slot="tabs-content"');
              return (
                nextWeek !== undefined && !thisWeek.includes("In your plan") && nextWeek.includes(recencyNote ?? "")
              );
            },
          ],
        },
      ],
      ["re-delivery of the same week is stored", () => deliver(redelivery), { status: 200 }],
      [
        "dashboard shows the re-delivered week",
        () => request("/dashboard"),
        {
          status: 200,
          body: [
            `contains "${newName}" and not "${oldName}"`,
            (body) => body.includes(escapeHtml(newName ?? "")) && !body.includes(escapeHtml(oldName ?? "")),
          ],
        },
      ],
      ["dashboard renders for signed-in user", () => request("/dashboard"), { status: 200 }],
      [
        "signout clears session",
        () => request("/api/auth/signout", { method: "POST" }),
        { status: 302, location: "/" },
      ],
      ["dashboard redirects after signout", () => request("/dashboard"), { status: 302, location: "/auth/signin" }],
      ...(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
        ? [
            [
              "invitation link signs a new user in",
              async () => {
                jar.clear();
                const link = await generateLinkToken("invite", inviteEmail);
                return link.failure ?? openEmailLink("invite", link.hash);
              },
              { status: 302, location: "/dashboard" },
            ],
            [
              "invited user's dashboard shows no upcoming plan yet",
              () => request("/dashboard"),
              {
                status: 200,
                body: ["contains 'No upcoming plan yet'", (body) => body.includes("No upcoming plan yet")],
              },
            ],
            [
              "password-reset link signs the smoke user in",
              async () => {
                jar.clear();
                const link = await generateLinkToken("recovery", email);
                recoveryTokenHash = link.hash;
                return link.failure ?? openEmailLink("recovery", link.hash);
              },
              { status: 302, location: "/dashboard" },
            ],
            [
              // The re-delivered week is the smoke user's, so this proves the session is theirs.
              "dashboard shows the smoke user's plan after the password-reset link",
              () => request("/dashboard"),
              { status: 200, body: [`contains "${newName}"`, (body) => body.includes(escapeHtml(newName ?? ""))] },
            ],
            [
              "used password-reset link is rejected",
              () => {
                jar.clear();
                return openEmailLink("recovery", recoveryTokenHash ?? "missing");
              },
              { status: 302, location: "/auth/signin?error=" },
            ],
            [
              "garbage email link is rejected",
              () => openEmailLink("invite", "not-a-real-token-hash"),
              { status: 302, location: "/auth/signin?error=" },
            ],
          ]
        : []),
      ["keepalive cron succeeds", () => request(KEEPALIVE_TRIGGER), { status: 200 }],
    ];

let failed = 0;
for (const [name, run, expected] of steps) {
  const actual = await run();
  const statusOk =
    typeof expected.status === "function" ? expected.status(actual.status) : actual.status === expected.status;
  const bodyOk = expected.body === undefined || expected.body[1](actual.body);
  const ok = statusOk && bodyOk && (expected.location === undefined || actual.location.startsWith(expected.location));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  -> ${actual.status} ${actual.location}`);
  if (!ok) {
    failed++;
    const expectedStatus = typeof expected.status === "function" ? "non-2xx" : expected.status;
    console.log(
      `      expected ${expectedStatus} ${expected.location ?? ""}${expected.body ? `, body ${expected.body[0]}` : ""}`,
    );
    // JSON error bodies (e.g. a delivery's validation issues) are short and worth seeing; HTML pages are not.
    if (actual.body.startsWith("{")) console.log(`      got ${actual.body.slice(0, 500)}`);
  }
}

console.log(failed ? `\n${failed} step(s) failed` : "\nAll smoke steps passed");
process.exit(failed ? 1 : 0);
