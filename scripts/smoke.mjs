// Smoke test: proves the built app, the Cloudflare adapter and the Supabase auth and MO delivery flows still work together.
// Zero dependencies on purpose. Run against a live server:
//   BASE_URL=http://localhost:4321 MO_INGEST_TOKEN=<the server's token> node scripts/smoke.mjs
// Required: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (the smoke user is created through the Admin API).
// Optional: SUPABASE_KEY and MAILPIT_URL enable more checks (see README).

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4321";
const email = `smoke-${Date.now()}@example.com`;
const password = "Smoke-Test-Passw0rd!";
// The smoke user's password changes during the password-reset steps; they sign in with this one.
let smokePassword = password;
const jar = new Map();

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function storeCookies(response) {
  for (const raw of response.headers.getSetCookie()) {
    const [pair, ...attrs] = raw.split(";");
    const [name, ...rest] = pair.split("=");
    // Supabase deletes cookies with Max-Age=0, Astro with an Expires date in the past. Max-Age wins over Expires.
    const attr = (key) =>
      attrs
        .map((a) => a.trim())
        .find((a) => a.toLowerCase().startsWith(`${key}=`))
        ?.slice(key.length + 1);
    const maxAge = attr("max-age");
    const expires = attr("expires");
    const expired =
      maxAge !== undefined ? Number(maxAge) <= 0 : expires !== undefined && Date.parse(expires) <= Date.now();
    if (expired) jar.delete(name.trim());
    else jar.set(name.trim(), rest.join("="));
  }
}

async function request(path, { method = "GET", form, json, raw, headers = {} } = {}) {
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
    body: form ? new URLSearchParams(form).toString() : json ? JSON.stringify(json) : raw,
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

/** The dashboard's "This week" and "Next week" panels, which render in tab order. */
function panels(body) {
  const [, thisWeek = "", nextWeek = ""] = body.split('data-slot="tabs-content"');
  return { thisWeek, nextWeek };
}

/**
 * The option id (`value`) of the first radio in `html` whose option shows `name`, i.e. the name occurs
 * after that radio and before the next one. React's attribute order is not fixed (it puts `checked` before
 * `value`), so attributes are read from the whole tag. React escapes `'` as `&#x27;` where `escapeHtml`
 * gives `&#39;`; the sample's names have neither.
 */
function radioIdFor(html, name) {
  for (const chunk of html.split("<input ").slice(1)) {
    const tag = chunk.slice(0, chunk.indexOf(">"));
    if (tag.includes('type="radio"') && chunk.includes(escapeHtml(name))) return /value="([^"]+)"/.exec(tag)?.[1];
  }
  return undefined;
}

/** The option label (radio, name, score and note) in `html` that shows `name`, or `""` if none does. */
function optionLabelFor(html, name) {
  const label = html
    .split("<label")
    .slice(1)
    .find((part) => part.includes(escapeHtml(name)));
  return label?.slice(0, label.indexOf("</label>")) ?? "";
}

/** Whether the radio with option id `optionId` is rendered `checked` in `html`. */
function isRadioChecked(html, optionId) {
  const tag = html.split("<input ").find((chunk) => chunk.slice(0, chunk.indexOf(">")).includes(`value="${optionId}"`));
  return tag !== undefined && /\schecked[=\s/>]/.test(` ${tag.slice(0, tag.indexOf(">") + 1)}`);
}

/** The option id (`data-option-id`, "This week" layout) of the first option in `html` that shows `name`. */
function optionIdFor(html, name) {
  const chunk = html
    .split('data-option-id="')
    .slice(1)
    .find((part) => part.includes(escapeHtml(name)));
  return chunk?.slice(0, chunk.indexOf('"'));
}

/** Whether `html` shows `text`; Astro escapes `'` as `&#39;` and React as `&#x27;`, so any of them matches. */
function showsText(html, text) {
  return ["&#39;", "&#x27;", "'"].some((apostrophe) => html.includes(escapeHtml(text).replaceAll("&#39;", apostrophe)));
}

/**
 * Whether the rating faces (`data-rating-option-id`, "This week" layout) of option `optionId` in `html`
 * have a face pressed (`aria-pressed="true"`). `undefined` when that option has no faces.
 */
function hasPressedFace(html, optionId) {
  const marker = `data-rating-option-id="${optionId}"`;
  const start = html.indexOf(marker);
  if (start === -1) return undefined;
  const rest = html.slice(start + marker.length);
  const end = rest.search(/data-rating-option-id="|<\/astro-island>/);
  return (end === -1 ? rest : rest.slice(0, end)).includes('aria-pressed="true"');
}

const MS_PER_DAY = 86_400_000;

function isoDate(epochMs) {
  return new Date(epochMs).toISOString().slice(0, 10);
}

/**
 * The first Monday at least 7 days after today (UTC), as `YYYY-MM-DD`. Today in Europe/Warsaw is at most
 * one day after today in UTC, so that Monday is always "upcoming". Except on Mondays it is two Mondays
 * ahead; the dashboard's "Next week" tab still shows it, because it shows the latest future plan (as in
 * S-01). The recency history is this week once it is saved, and the later week sits 7 days after it,
 * wherever it falls.
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
const CHOOSE = "/api/plans/choose";
const RATINGS = "/api/ratings";
// The rating the rating steps give, and its label (RATING_FACES in src/lib/ratings.ts).
const RATING = 5;
const RATING_LABEL = "Chef's kiss";
const MO_INGEST_TOKEN = process.env.MO_INGEST_TOKEN;
// Optional: the Supabase instance the server uses, to check its grants directly (CI sets both).
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
// The same instance's service-role key, to create the smoke user and generate invitation and password-reset link tokens.
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
// Optional: the same instance's Mailpit (local Supabase's email catcher), to read a real reset email (CI sets it).
const MAILPIT_URL = process.env.MAILPIT_URL?.replace(/\/$/, "");
const inviteEmail = `smoke-invite-${Date.now()}-${Math.random().toString(36).slice(2, 10)}@example.com`;
const unknownEmail = `smoke-unknown-${Date.now()}-${Math.random().toString(36).slice(2, 10)}@example.com`;
const FORGOT_PASSWORD = "/api/auth/forgot-password";
const SET_PASSWORD = "/api/auth/set-password";
// Set by src/pages/api/auth/set-password.ts when a save fails after the emailed token was used.
const PASSWORD_RETRY_COOKIE = "mo-password-retry";
// 7 characters: one short of the minimum (MIN_PASSWORD_LENGTH in src/lib/password-rules.ts).
const SHORT_PASSWORD = "Short7!";
const RESET_PASSWORD = "Smoke-Reset-Passw0rd-1!";
const RETRY_PASSWORD = "Smoke-Retry-Passw0rd-2!";
const EMAIL_RESET_PASSWORD = "Smoke-Email-Passw0rd-3!";
const CLAIM_PASSWORD = "Smoke-Claim-Passw0rd!";
// Tokens of the reset links the steps generate or read from Mailpit, kept for the steps that reuse them.
let recoveryTokenHash, inviteTokenHash, emailLink;

let delivery, newUserDelivery, redelivery, laterDelivery, oldName, newName, recencyNote, swapName;
let currentDelivery, currentRedelivery, currentName;
// The rating steps: the current week's Monday meal they rate (the second meal, which is not renamed, so the
// upcoming week has the same name), an option of that meal that is not chosen, and the rated option's id.
let ratedName, unchosenName, ratedOptionId;
// The week before the current one: past, so /history lists it. It is never saved, so it gives no recency notes.
// The same week for the account a delivery creates, which the smoke user must not be able to open.
let pastDelivery, otherPastDelivery, pastName;
// From the delivery responses, for the history steps.
let pastPlanId, otherPastPlanId, currentPlanId, upcomingDeliveryPlanId;
// Read from the dashboard HTML by the swap steps.
let upcomingPlanId, swapOptionId;
if (!KEEPALIVE_EXPECT_FAILURE) {
  if (!MO_INGEST_TOKEN) {
    console.error("MO_INGEST_TOKEN is not set; use the same token the server under test has.");
    process.exit(1);
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set; the smoke user is created through the Admin API (sign-up is disabled).",
    );
    process.exit(1);
  }
  if (!SUPABASE_KEY) console.log("SKIP  anon grant check (set SUPABASE_KEY)\n");
  if (!MAILPIT_URL) console.log("SKIP  real reset email (set MAILPIT_URL)\n");
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
  // The swap: the first option of the same meal that MO did not recommend.
  swapName = firstMeal.variants.find((_, i) => i !== index)?.name;
  if (!swapName) {
    console.error("Fixture problem: the sample's first meal has only one option, so there is nothing to swap to.");
    process.exit(1);
  }
  newName = `Smoke re-delivered meal ${Date.now()}`;
  redelivery = structuredClone(delivery);
  redelivery.days[0].meals[0].variants[index].name = newName;
  // The "old name is gone" check is only meaningful if the name occurs nowhere else in the week.
  if (JSON.stringify(redelivery).includes(JSON.stringify(oldName).slice(1, -1))) {
    console.error(`Fixture problem: "${oldName}" occurs more than once in the sample delivery.`);
    process.exit(1);
  }

  // The current week: the same sample, with the meal renamed there, so that its name is specific to
  // "This week" and the upcoming week's old name still occurs only in the upcoming week. It is never
  // saved (a started week can't be), so it must give the upcoming week no recency notes.
  const thisWeek = currentMonday();
  currentDelivery = await loadDelivery(email, thisWeek);
  currentName = `Smoke current-week meal ${Date.now()}`;
  currentDelivery.days[0].meals[0].variants[index].name = currentName;
  // Rating: the recommended (so chosen, as the week is never saved) option of the Monday's second meal.
  // The Monday of the current week is always within the rateable window (today - 7 .. today).
  const ratedMeal = currentDelivery.days[0].meals[1];
  if (!ratedMeal || ratedMeal.variants.length < 2) {
    console.error("Fixture problem: the sample's first day needs a second meal with at least two options to rate.");
    process.exit(1);
  }
  const ratedIndex = recommendedIndex(ratedMeal);
  ratedName = ratedMeal.variants[ratedIndex].name;
  unchosenName = ratedMeal.variants.find((_, i) => i !== ratedIndex)?.name;

  // A changed re-send of the current week, which has started, so it must be refused.
  currentRedelivery = structuredClone(currentDelivery);
  currentRedelivery.days[0].meals[0].variants[index].name = `Smoke refused current-week meal ${Date.now()}`;

  // The past week, with the meal renamed there too, so its week page can only pass on its own data.
  const pastWeek = isoDate(Date.parse(`${thisWeek}T00:00:00Z`) - 7 * MS_PER_DAY);
  pastDelivery = await loadDelivery(email, pastWeek);
  pastName = `Smoke past-week meal ${Date.now()}`;
  pastDelivery.days[0].meals[0].variants[index].name = pastName;
  otherPastDelivery = await loadDelivery(newUserDelivery.user.email, pastWeek);

  // History: the upcoming week, once the swap step has saved it. A week 7 days after it, with the same
  // meals (their ids repeat) and the re-delivered recommended meal's name, is annotated against it: each
  // meal the user chose in the saved week carries a note, the number of days between the two Mondays earlier.
  const laterWeek = isoDate(Date.parse(`${nextWeek}T00:00:00Z`) + 7 * MS_PER_DAY);
  laterDelivery = await loadDelivery(email, laterWeek);
  laterDelivery.days[0].meals[0].variants[index].name = newName;
  recencyNote = `In your plan ${daysBetween(nextWeek, laterWeek)} days earlier (`;
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

/** Tries a public sign-up with the anon key; invitations are the only way to get an account. */
async function anonSignup() {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: `smoke-signup-${Date.now()}@example.com`, password: RESET_PASSWORD }),
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

/** Creates the smoke user through the Admin API with a password; public sign-up is disabled. */
async function createSmokeUser() {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  return { status: response.status, location: "", body: await response.text() };
}

/** Opens an old-style email link (`/api/auth/confirm`) the way a click in the email does. */
const openEmailLink = (type, tokenHash) =>
  request(`/api/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=${type}`);

/** Opens the set-password page a reset email links to. The page only reads the token; it never uses it. */
const openSetPasswordPage = (tokenHash, type = "recovery") =>
  request(`/auth/set-password?token_hash=${encodeURIComponent(tokenHash)}&type=${type}`);

/**
 * Posts the set-password form with `newPassword`. With `link` (`{ tokenHash, type }`) it is the form of an
 * emailed link; without it, the token-less retry after a rejected save.
 */
const postSetPassword = (newPassword, link) =>
  request(SET_PASSWORD, {
    method: "POST",
    form: { password: newPassword, ...(link ? { token_hash: link.tokenHash, type: link.type ?? "recovery" } : {}) },
  });

/** Posts the reset request form ("Forgot password?"). */
const requestReset = (resetEmail) => request(FORGOT_PASSWORD, { method: "POST", form: { email: resetEmail } });

/** Whether `body` renders the set-password form, with the emailed link's hidden token fields or without them. */
function hasSetPasswordForm(body, withToken) {
  return body.includes(`action="${SET_PASSWORD}"`) && body.includes('name="token_hash"') === withToken;
}

/** Whether `body` shows the invalid-link notice ("Ask for a new link") instead of the set-password form. */
function showsInvalidLinkNotice(body) {
  return body.includes("This link is invalid or has expired") && !body.includes(`action="${SET_PASSWORD}"`);
}

/** The `/history` list item that links to the past plan `planId`, or `""` if none does. */
function historyItemFor(body, planId) {
  const item = body
    .split(/<li\b/)
    .slice(1)
    .find((part) => part.includes(`href="/history/${planId}"`));
  return item?.slice(0, item.indexOf("</li>")) ?? "";
}

/** Rates option `optionId` with `rating` (1-5, or `null` to clear) as the signed-in user. */
const rate = (optionId, rating) => request(RATINGS, { method: "POST", json: { optionId, rating } });

/** Whether the dashboard's "This week" shows the rated meal's faces with one pressed (`pressed`) or none. */
const ratedFacePressed = (pressed) => [
  `"This week" shows the faces of "${ratedName}" ${pressed ? "with" : "without"} a pressed face`,
  (body) => ratedOptionId !== undefined && hasPressedFace(panels(body).thisWeek, ratedOptionId) === pressed,
];

/** Whether `body` shows the label of a plan that was never saved; Astro may escape its `'` either way. */
function showsNotSavedLabel(body) {
  return ["MO&#39;s", "MO&#x27;s", "MO's"].some((mo) => body.includes(`Not saved: ${mo} recommendation`));
}

/** `location` parsed against BASE_URL, so relative and absolute redirects read the same. */
const locationUrl = (location) => new URL(location || "/", BASE_URL);

/** A step result for a step that failed before reaching the server; JSON so the run prints it. */
const stepFailure = (message) => ({ status: 0, location: "", body: JSON.stringify({ error: message }) });

/**
 * Reads the newest email to `to` from Mailpit and returns its set-password link's path and query as
 * `location` (the link's host is Supabase's `site_url`, not BASE_URL). Every run's smoke user has a new
 * address and Mailpit lists messages newest first, so older emails can't be picked. Polls for up to 10 s,
 * as the email is sent asynchronously.
 */
async function newestResetEmailLink(to) {
  try {
    return await pollResetEmailLink(to);
  } catch (error) {
    return stepFailure(`Mailpit read at ${MAILPIT_URL} failed: ${error.message}`);
  }
}

async function pollResetEmailLink(to) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const search = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    if (!search.ok) return stepFailure(`Mailpit search answered ${search.status}: ${await search.text()}`);
    const [newest] = (await search.json()).messages ?? [];
    if (newest) {
      const read = await fetch(`${MAILPIT_URL}/api/v1/message/${newest.ID}`);
      if (!read.ok) return stepFailure(`Mailpit message read answered ${read.status}: ${await read.text()}`);
      const message = await read.json();
      const href =
        /href="([^"]*\/auth\/set-password[^"]*)"/.exec(message.HTML ?? "")?.[1] ??
        /(https?:\/\/[^\s"<>]*\/auth\/set-password[^\s"<>]*)/.exec(message.Text ?? "")?.[1];
      if (!href) return stepFailure(`no /auth/set-password link in the email "${message.Subject}"`);
      const url = new URL(href.replaceAll("&amp;", "&"));
      return { status: 200, location: url.pathname + url.search, body: "" };
    }
    await sleep(500);
  }
  return stepFailure(
    `no email to ${to} arrived in Mailpit (forgot-password hides GoTrue errors; check auth.email.max_frequency and the email_sent rate limit)`,
  );
}

const steps = KEEPALIVE_EXPECT_FAILURE
  ? [["keepalive cron reports failure", () => request(KEEPALIVE_TRIGGER), { status: (status) => status >= 400 }]]
  : [
      ["home redirects anonymous user to sign-in", () => request("/"), { status: 302, location: "/auth/signin" }],
      ["dashboard redirects anonymous user", () => request("/dashboard"), { status: 302, location: "/auth/signin" }],
      ["history redirects anonymous user", () => request("/history"), { status: 302, location: "/auth/signin" }],
      [
        "history week page redirects anonymous user",
        () => request("/history/not-a-uuid"),
        { status: 302, location: "/auth/signin" },
      ],
      ["admin creates the smoke user", createSmokeUser, { status: 200 }],
      [
        "signin rejects wrong password",
        () => request("/api/auth/signin", { method: "POST", form: { email, password: "wrong" } }),
        { status: 302, location: "/auth/signin?error=" },
      ],
      [
        "signin accepts correct password",
        () => request("/api/auth/signin", { method: "POST", form: { email, password } }),
        { status: 302, location: "/dashboard" },
      ],
      [
        "dashboard shows no upcoming plan yet",
        () => request("/dashboard"),
        { status: 200, body: ["contains 'No upcoming plan yet'", (body) => body.includes("No upcoming plan yet")] },
      ],
      [
        // The smoke user is new on every run, so no earlier run's past weeks can show up here.
        "history shows no past plans yet",
        () => request("/history"),
        { status: 200, body: ["contains 'No past plans yet'", (body) => body.includes("No past plans yet")] },
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
            [
              "anon cannot sign up",
              anonSignup,
              {
                status: 422,
                body: ["code signup_disabled", (body) => jsonField(body, "error_code") === "signup_disabled"],
              },
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
        async () => {
          const result = await deliver(currentDelivery);
          currentPlanId = jsonField(result.body, "plan_id");
          return result;
        },
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
        async () => {
          const result = await deliver(delivery);
          upcomingDeliveryPlanId = jsonField(result.body, "plan_id");
          return result;
        },
        { status: 200, body: ["account_created: false", (body) => jsonField(body, "account_created") === false] },
      ],
      [
        "dashboard shows the recommended meal",
        () => request("/dashboard"),
        { status: 200, body: [`contains "${oldName}"`, (body) => body.includes(escapeHtml(oldName ?? ""))] },
      ],
      [
        // The current week can never be saved and the upcoming one is not saved yet: neither counts as history.
        "dashboard shows no recency notes while no earlier plan is saved",
        () => request("/dashboard"),
        {
          status: 200,
          body: [
            `neither "This week" nor "Next week" contains "In your plan"`,
            (body) => {
              const { thisWeek, nextWeek } = panels(body);
              return thisWeek.length > 0 && nextWeek.length > 0 && !body.includes("In your plan");
            },
          ],
        },
      ],
      [
        "rating without session is rejected",
        () =>
          request(RATINGS, {
            method: "POST",
            json: { optionId: randomUUID(), rating: RATING },
            headers: { Cookie: "" },
          }),
        { status: 401 },
      ],
      [
        "rating a chosen meal of this week is saved",
        async () => {
          const { thisWeek } = panels((await request("/dashboard")).body);
          ratedOptionId = optionIdFor(thisWeek, ratedName ?? "");
          return ratedOptionId ? rate(ratedOptionId, RATING) : stepFailure(`no "${ratedName}" in "This week"`);
        },
        { status: 200, body: [`rating: ${RATING}`, (body) => jsonField(body, "rating") === RATING] },
      ],
      [
        "dashboard shows the rating pressed",
        () => request("/dashboard"),
        { status: 200, body: ratedFacePressed(true) },
      ],
      [
        // The current week is never saved: a rated meal was had, so its rating shows on later plans anyway.
        "next week shows the rating on the same meal",
        () => request("/dashboard"),
        {
          status: 200,
          body: [
            `"Next week" has "Last rated" and "${RATING_LABEL}" on "${ratedName}"`,
            (body) => {
              const label = optionLabelFor(panels(body).nextWeek, ratedName ?? "");
              return label.includes("Last rated") && showsText(label, RATING_LABEL);
            },
          ],
        },
      ],
      [
        "rating an upcoming meal is refused",
        async () => {
          const { nextWeek } = panels((await request("/dashboard")).body);
          const optionId = radioIdFor(nextWeek, ratedName ?? "");
          return optionId ? rate(optionId, RATING) : stepFailure(`no "${ratedName}" in "Next week"`);
        },
        { status: 409, body: ["error: not_rateable", (body) => jsonField(body, "error") === "not_rateable"] },
      ],
      [
        "rating a meal of this week that is not chosen is refused",
        async () => {
          const { thisWeek } = panels((await request("/dashboard")).body);
          const optionId = optionIdFor(thisWeek, unchosenName ?? "");
          return optionId ? rate(optionId, RATING) : stepFailure(`no "${unchosenName}" in "This week"`);
        },
        { status: 409, body: ["error: not_rateable", (body) => jsonField(body, "error") === "not_rateable"] },
      ],
      [
        "rating off the scale is rejected",
        () => (ratedOptionId ? rate(ratedOptionId, 6) : stepFailure("no rated option id")),
        { status: 400, body: ["error: invalid_request", (body) => jsonField(body, "error") === "invalid_request"] },
      ],
      [
        "rating is cleared",
        () => (ratedOptionId ? rate(ratedOptionId, null) : stepFailure("no rated option id")),
        { status: 200, body: ["rating: null", (body) => jsonField(body, "rating") === null] },
      ],
      [
        "dashboard shows the rating cleared",
        () => request("/dashboard"),
        { status: 200, body: ratedFacePressed(false) },
      ],
      [
        "meal is rated again",
        () => (ratedOptionId ? rate(ratedOptionId, RATING) : stepFailure("no rated option id")),
        { status: 200, body: [`rating: ${RATING}`, (body) => jsonField(body, "rating") === RATING] },
      ],
      [
        // A first delivery of a started week is stored; only a changed re-send of one is refused.
        "past-week delivery for the signed-in user is stored",
        async () => {
          const result = await deliver(pastDelivery);
          pastPlanId = jsonField(result.body, "plan_id");
          return result;
        },
        { status: 200, body: ["account_created: false", (body) => jsonField(body, "account_created") === false] },
      ],
      [
        "past-week delivery for another user is stored",
        async () => {
          const result = await deliver(otherPastDelivery);
          otherPastPlanId = jsonField(result.body, "plan_id");
          return result;
        },
        { status: 200, body: ["account_created: false", (body) => jsonField(body, "account_created") === false] },
      ],
      [
        "history lists the past week as not saved",
        () => request("/history"),
        {
          status: 200,
          body: [
            `links to /history/<plan_id> marked "Not saved", and not to the current week or the other user's week`,
            (body) =>
              pastPlanId !== undefined &&
              currentPlanId !== undefined &&
              otherPastPlanId !== undefined &&
              historyItemFor(body, pastPlanId).includes("Not saved") &&
              historyItemFor(body, currentPlanId) === "" &&
              historyItemFor(body, otherPastPlanId) === "",
          ],
        },
      ],
      [
        "history week page shows its meal",
        () => (pastPlanId ? request(`/history/${pastPlanId}`) : stepFailure("no past plan_id")),
        {
          status: 200,
          body: [
            `contains "${pastName}" and "Not saved: MO's recommendation"`,
            (body) => body.includes(escapeHtml(pastName ?? "")) && showsNotSavedLabel(body),
          ],
        },
      ],
      [
        // The boundary week: "This week" until the Monday after it ends, so never in history before then.
        "history hides the current week",
        () => (currentPlanId ? request(`/history/${currentPlanId}`) : stepFailure("no current plan_id")),
        { status: 404, body: ["contains 'Plan not found'", (body) => body.includes("Plan not found")] },
      ],
      [
        "history hides another user's past week",
        () => (otherPastPlanId ? request(`/history/${otherPastPlanId}`) : stepFailure("no other user's plan_id")),
        { status: 404, body: ["contains 'Plan not found'", (body) => body.includes("Plan not found")] },
      ],
      [
        "history hides the upcoming week",
        () =>
          upcomingDeliveryPlanId ? request(`/history/${upcomingDeliveryPlanId}`) : stepFailure("no upcoming plan_id"),
        { status: 404, body: ["contains 'Plan not found'", (body) => body.includes("Plan not found")] },
      ],
      [
        "history rejects a malformed id",
        () => request("/history/not-a-uuid"),
        { status: 404, body: ["contains 'Plan not found'", (body) => body.includes("Plan not found")] },
      ],
      [
        "choose without session is rejected",
        () =>
          request(CHOOSE, {
            method: "POST",
            json: { planId: randomUUID(), optionId: randomUUID() },
            headers: { Cookie: "" },
          }),
        { status: 401 },
      ],
      [
        "swap in upcoming week is saved",
        async () => {
          const { nextWeek } = panels((await request("/dashboard")).body);
          upcomingPlanId = /data-plan-id="([^"]+)"/.exec(nextWeek)?.[1];
          swapOptionId = radioIdFor(nextWeek, swapName ?? "");
          return request(CHOOSE, { method: "POST", json: { planId: upcomingPlanId, optionId: swapOptionId } });
        },
        { status: 200, body: ["saved_at is set", (body) => typeof jsonField(body, "saved_at") === "string"] },
      ],
      [
        "dashboard shows the swap",
        () => request("/dashboard"),
        {
          status: 200,
          body: [
            `"Next week" has "${swapName}" checked and "Saved "`,
            (body) => {
              const { nextWeek } = panels(body);
              return isRadioChecked(nextWeek, swapOptionId) && nextWeek.includes("Saved ");
            },
          ],
        },
      ],
      [
        "current week is locked",
        async () => {
          const { thisWeek } = panels((await request("/dashboard")).body);
          // The function refuses before planId is used (it only re-reads recency after a save).
          const optionId = optionIdFor(thisWeek, currentName ?? "");
          return request(CHOOSE, { method: "POST", json: { planId: upcomingPlanId, optionId } });
        },
        { status: 409, body: ["error: plan_locked", (body) => jsonField(body, "error") === "plan_locked"] },
      ],
      [
        "unknown option is not found",
        () => request(CHOOSE, { method: "POST", json: { planId: upcomingPlanId, optionId: randomUUID() } }),
        { status: 404, body: ["error: not_found", (body) => jsonField(body, "error") === "not_found"] },
      ],
      [
        "invalid body is rejected",
        () => request(CHOOSE, { method: "POST", raw: "not json", headers: { "Content-Type": "application/json" } }),
        { status: 400, body: ["error: invalid_request", (body) => jsonField(body, "error") === "invalid_request"] },
      ],
      [
        // Same body as the stored one: a no-op that answers with the existing plan.
        "identical re-delivery returns the same plan",
        () => deliver(delivery),
        {
          status: 200,
          body: [
            "the same plan_id",
            (body) => upcomingPlanId !== undefined && jsonField(body, "plan_id") === upcomingPlanId,
          ],
        },
      ],
      [
        "identical re-delivery keeps the swap",
        () => request("/dashboard"),
        {
          status: 200,
          body: [
            `"Next week" has "${swapName}" checked and "Saved "`,
            (body) => {
              const { nextWeek } = panels(body);
              return isRadioChecked(nextWeek, swapOptionId) && nextWeek.includes("Saved ");
            },
          ],
        },
      ],
      [
        "re-delivery of the current week is refused",
        () => deliver(currentRedelivery),
        { status: 409, body: ["error: week_started", (body) => jsonField(body, "error") === "week_started"] },
      ],
      [
        "refused re-delivery leaves this week's plan",
        () => request("/dashboard"),
        {
          status: 200,
          body: [
            `"This week" contains "${currentName}"`,
            (body) => panels(body).thisWeek.includes(escapeHtml(currentName ?? "")),
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
      [
        // The re-sent week keeps its provider_meal_ids, so the saved swap is carried over to the new option rows.
        "re-delivery keeps the swap",
        () => request("/dashboard"),
        {
          status: 200,
          body: [
            `"Next week" has "${swapName}" checked and "Saved ", not "Not saved yet"`,
            (body) => {
              const { nextWeek } = panels(body);
              const optionId = radioIdFor(nextWeek, swapName ?? "");
              return (
                optionId !== undefined &&
                isRadioChecked(nextWeek, optionId) &&
                nextWeek.includes("Saved ") &&
                !nextWeek.includes("Not saved yet")
              );
            },
          ],
        },
      ],
      [
        "re-delivery leaves this week alone",
        () => request("/dashboard"),
        {
          status: 200,
          body: [
            `"This week" contains "${currentName}"`,
            (body) => panels(body).thisWeek.includes(escapeHtml(currentName ?? "")),
          ],
        },
      ],
      [
        // The upcoming week is saved with a swap by now, so it counts as history for a week 7 days later.
        "delivery of a later week for the signed-in user is stored",
        () => deliver(laterDelivery),
        { status: 200, body: ["account_created: false", (body) => jsonField(body, "account_created") === false] },
      ],
      [
        "later week shows recency notes from the saved week, none for the swapped-away meal",
        () => request("/dashboard"),
        {
          status: 200,
          body: [
            `"Next week" has "${recencyNote}" on "${swapName}", not on "${newName}", and "This week" has no note`,
            (body) => {
              const { thisWeek, nextWeek } = panels(body);
              const swappedAway = optionLabelFor(nextWeek, newName ?? "");
              return (
                !thisWeek.includes("In your plan") &&
                optionLabelFor(nextWeek, swapName ?? "").includes(recencyNote ?? "") &&
                swappedAway !== "" &&
                !swappedAway.includes("In your plan")
              );
            },
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
              "invitation link is forwarded to the set-password page without signing in",
              async () => {
                jar.clear();
                const link = await generateLinkToken("invite", inviteEmail);
                inviteTokenHash = link.hash;
                return link.failure ?? openEmailLink("invite", link.hash);
              },
              {
                status: 302,
                location: [
                  "/auth/set-password?token_hash=…&type=invite",
                  (location) => {
                    const url = locationUrl(location);
                    return (
                      url.pathname === "/auth/set-password" &&
                      Boolean(url.searchParams.get("token_hash")) &&
                      url.searchParams.get("type") === "invite"
                    );
                  },
                ],
              },
            ],
            [
              "dashboard still redirects after opening the invitation link",
              () => request("/dashboard"),
              { status: 302, location: "/auth/signin" },
            ],
            [
              "set-password page shows the form for the invitation link",
              () =>
                inviteTokenHash ? openSetPasswordPage(inviteTokenHash, "invite") : stepFailure("no invitation token"),
              {
                status: 200,
                body: ["contains the form with the link's token", (body) => hasSetPasswordForm(body, true)],
              },
            ],
            [
              // The token survived the GET of the page above.
              "new password from the invitation signs the user in",
              () =>
                inviteTokenHash
                  ? postSetPassword(RESET_PASSWORD, { tokenHash: inviteTokenHash, type: "invite" })
                  : stepFailure("no invitation token"),
              { status: 302, location: "/dashboard" },
            ],
            [
              "used invitation link opened on the page shows the notice",
              () =>
                inviteTokenHash ? openSetPasswordPage(inviteTokenHash, "invite") : stepFailure("no invitation token"),
              { status: 200, body: ["shows the invalid-link message and no form", showsInvalidLinkNotice] },
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
              "reset request for an unknown email looks like a success",
              () => requestReset(unknownEmail),
              { status: 302, location: "/auth/forgot-password?sent=1" },
            ],
            [
              "reset request with an invalid email is rejected",
              () => requestReset("not-an-email"),
              { status: 302, location: "/auth/forgot-password?error=" },
            ],
            [
              "old-style password-reset link is forwarded to the set-password page",
              async () => {
                jar.clear();
                const link = await generateLinkToken("recovery", email);
                recoveryTokenHash = link.hash;
                return link.failure ?? openEmailLink("recovery", link.hash);
              },
              { status: 302, location: "/auth/set-password?token_hash=" },
            ],
            [
              "set-password page shows the form for the link",
              () => (recoveryTokenHash ? openSetPasswordPage(recoveryTokenHash) : stepFailure("no reset token")),
              {
                status: 200,
                body: ["contains the form with the link's token", (body) => hasSetPasswordForm(body, true)],
              },
            ],
            [
              "too-short password is rejected and keeps the token",
              () =>
                recoveryTokenHash
                  ? postSetPassword(SHORT_PASSWORD, { tokenHash: recoveryTokenHash })
                  : stepFailure("no reset token"),
              {
                status: 302,
                location: [
                  "/auth/set-password with the same token and an error",
                  (location) => {
                    const url = locationUrl(location);
                    return (
                      url.pathname === "/auth/set-password" &&
                      url.searchParams.get("token_hash") === recoveryTokenHash &&
                      url.searchParams.get("type") === "recovery" &&
                      Boolean(url.searchParams.get("error"))
                    );
                  },
                ],
              },
            ],
            [
              // The token survived the GET of the page and the rejected password above.
              "new password from the link is saved and signs the user in",
              async () => {
                if (!recoveryTokenHash) return stepFailure("no reset token");
                const result = await postSetPassword(RESET_PASSWORD, { tokenHash: recoveryTokenHash });
                if (result.status === 302 && result.location.startsWith("/dashboard")) smokePassword = RESET_PASSWORD;
                return result;
              },
              { status: 302, location: "/dashboard" },
            ],
            [
              // The re-delivered week is the smoke user's, so this proves the session is theirs.
              "dashboard shows the smoke user's plan after the reset",
              () => request("/dashboard"),
              { status: 200, body: [`contains "${newName}"`, (body) => body.includes(escapeHtml(newName ?? ""))] },
            ],
            [
              "set-password page without a token refuses a signed-in session without the retry cookie",
              () => request("/auth/set-password"),
              {
                status: 200,
                body: ["shows the invalid-link message and no form", showsInvalidLinkNotice],
              },
            ],
            [
              "token-less save from a signed-in session without the retry cookie is refused",
              () => postSetPassword(RETRY_PASSWORD),
              { status: 302, location: "/auth/forgot-password?error=" },
            ],
            [
              "signout after the reset",
              () => request("/api/auth/signout", { method: "POST" }),
              { status: 302, location: "/" },
            ],
            [
              "token-less save without a session is refused",
              () => postSetPassword(RETRY_PASSWORD),
              { status: 302, location: "/auth/forgot-password?error=" },
            ],
            [
              "signin rejects the password from before the reset",
              () => request("/api/auth/signin", { method: "POST", form: { email, password } }),
              { status: 302, location: "/auth/signin?error=" },
            ],
            [
              "signin accepts the new password",
              () => request("/api/auth/signin", { method: "POST", form: { email, password: smokePassword } }),
              { status: 302, location: "/" },
            ],
            [
              "used password-reset link is rejected",
              () => {
                jar.clear();
                // Nothing to reuse if no token was generated; fail rather than pass on a stand-in token.
                if (!recoveryTokenHash) return stepFailure("no password-reset token was generated");
                return postSetPassword(RETRY_PASSWORD, { tokenHash: recoveryTokenHash });
              },
              { status: 302, location: "/auth/forgot-password?error=" },
            ],
            [
              "used password-reset link opened on the page shows the notice",
              () =>
                recoveryTokenHash
                  ? openSetPasswordPage(recoveryTokenHash)
                  : stepFailure("no password-reset token was generated"),
              { status: 200, body: ["shows the invalid-link message and no form", showsInvalidLinkNotice] },
            ],
            [
              "made-up password-reset token is rejected",
              () => postSetPassword(RETRY_PASSWORD, { tokenHash: "not-a-real-token-hash" }),
              { status: 302, location: "/auth/forgot-password?error=" },
            ],
            [
              "made-up token opened on the page shows the notice",
              () => openSetPasswordPage("not-a-real-token-hash"),
              { status: 200, body: ["shows the invalid-link message and no form", showsInvalidLinkNotice] },
            ],
            [
              // A second reset link replaces the first. Uses the invited user, whose links no later step needs.
              "replaced password-reset link shows the notice and the newer one the form",
              async () => {
                const first = await generateLinkToken("recovery", inviteEmail);
                if (first.failure) return first.failure;
                const second = await generateLinkToken("recovery", inviteEmail);
                if (second.failure) return second.failure;
                const replaced = await openSetPasswordPage(first.hash);
                if (!showsInvalidLinkNotice(replaced.body))
                  return stepFailure("the replaced link did not show the invalid-link notice");
                return openSetPasswordPage(second.hash);
              },
              {
                status: 200,
                body: ["the newer link shows the form with its token", (body) => hasSetPasswordForm(body, true)],
              },
            ],
            [
              // Supabase refuses the current password (same_password) after the token was already used.
              "rejected save after the link opens a token-less retry",
              async () => {
                jar.clear();
                const link = await generateLinkToken("recovery", email);
                return link.failure ?? postSetPassword(smokePassword, { tokenHash: link.hash });
              },
              {
                status: 302,
                location: [
                  "/auth/set-password with an error, no token, and the retry cookie set",
                  (location) => {
                    const url = locationUrl(location);
                    return (
                      url.pathname === "/auth/set-password" &&
                      !url.searchParams.has("token_hash") &&
                      Boolean(url.searchParams.get("error")) &&
                      jar.has(PASSWORD_RETRY_COOKIE)
                    );
                  },
                ],
              },
            ],
            [
              "set-password page offers the retry form without a token",
              () => request("/auth/set-password"),
              { status: 200, body: ["contains the form without a token", (body) => hasSetPasswordForm(body, false)] },
            ],
            [
              "token-less retry saves the password",
              async () => {
                const result = await postSetPassword(RETRY_PASSWORD);
                if (result.status === 302 && result.location.startsWith("/dashboard")) smokePassword = RETRY_PASSWORD;
                return result;
              },
              {
                status: 302,
                location: [
                  "/dashboard, and the retry cookie is cleared",
                  (location) => location.startsWith("/dashboard") && !jar.has(PASSWORD_RETRY_COOKIE),
                ],
              },
            ],
            [
              "account created by a delivery claims itself with a reset link",
              async () => {
                jar.clear();
                const link = await generateLinkToken("recovery", newUserDelivery.user.email);
                return link.failure ?? postSetPassword(CLAIM_PASSWORD, { tokenHash: link.hash });
              },
              { status: 302, location: "/dashboard" },
            ],
            [
              "claimed account's dashboard shows its delivered week",
              () => request("/dashboard"),
              { status: 200, body: [`contains "${oldName}"`, (body) => body.includes(escapeHtml(oldName ?? ""))] },
            ],
            ...(MAILPIT_URL
              ? [
                  [
                    "reset request for the smoke user is accepted",
                    async () => {
                      jar.clear();
                      // generate_link above set recovery_sent_at; GoTrue refuses another send within max_frequency (1s).
                      await sleep(1500);
                      return requestReset(email);
                    },
                    { status: 302, location: "/auth/forgot-password?sent=1" },
                  ],
                  [
                    "reset email links to the set-password page",
                    async () => {
                      const result = await newestResetEmailLink(email);
                      if (result.status === 200) {
                        const params = locationUrl(result.location).searchParams;
                        emailLink = { tokenHash: params.get("token_hash"), type: params.get("type") };
                      }
                      return result;
                    },
                    {
                      status: 200,
                      location: [
                        "/auth/set-password?…type=recovery with a token",
                        (location) => {
                          const url = locationUrl(location);
                          return (
                            url.pathname === "/auth/set-password" &&
                            url.searchParams.get("type") === "recovery" &&
                            Boolean(url.searchParams.get("token_hash"))
                          );
                        },
                      ],
                    },
                  ],
                  [
                    "password from the reset email is saved",
                    async () => {
                      if (!emailLink?.tokenHash) return stepFailure("no link was read from the reset email");
                      const result = await postSetPassword(EMAIL_RESET_PASSWORD, emailLink);
                      if (result.status === 302 && result.location.startsWith("/dashboard"))
                        smokePassword = EMAIL_RESET_PASSWORD;
                      return result;
                    },
                    { status: 302, location: "/dashboard" },
                  ],
                ]
              : []),
            [
              "garbage invitation link is forwarded to the set-password page",
              () => {
                jar.clear();
                return openEmailLink("invite", "not-a-real-token-hash");
              },
              { status: 302, location: "/auth/set-password?token_hash=" },
            ],
            [
              "garbage invitation token is rejected on save",
              () => postSetPassword(RESET_PASSWORD, { tokenHash: "not-a-real-token-hash", type: "invite" }),
              { status: 302, location: "/auth/forgot-password?error=" },
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
  // `location` is a prefix, or a `[label, check]` pair like `body`.
  const locationOk =
    expected.location === undefined ||
    (Array.isArray(expected.location)
      ? expected.location[1](actual.location)
      : actual.location.startsWith(expected.location));
  const ok = statusOk && bodyOk && locationOk;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  -> ${actual.status} ${actual.location}`);
  if (!ok) {
    failed++;
    const expectedStatus = typeof expected.status === "function" ? "non-2xx" : expected.status;
    console.log(
      `      expected ${expectedStatus} ${(Array.isArray(expected.location) ? expected.location[0] : expected.location) ?? ""}${expected.body ? `, body ${expected.body[0]}` : ""}`,
    );
    // JSON error bodies (e.g. a delivery's validation issues) are short and worth seeing; HTML pages are not.
    if (actual.body.startsWith("{")) console.log(`      got ${actual.body.slice(0, 500)}`);
  }
}

console.log(failed ? `\n${failed} step(s) failed` : "\nAll smoke steps passed");
process.exit(failed ? 1 : 0);
