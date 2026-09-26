// Smoke test: proves the built app, the Cloudflare adapter and the Supabase auth flow still work together.
// Zero dependencies on purpose. Run against a live server: BASE_URL=http://localhost:4321 node scripts/smoke.mjs

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

async function request(path, { method = "GET", form } = {}) {
  const response = await fetch(BASE_URL + path, {
    method,
    redirect: "manual",
    headers: {
      Cookie: cookieHeader(),
      Origin: BASE_URL,
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  storeCookies(response);
  return { status: response.status, location: response.headers.get("location") ?? "" };
}

const KEEPALIVE_EXPECT_FAILURE = process.env.KEEPALIVE_EXPECT_FAILURE === "1";
// Same schedule as wrangler.jsonc, so local logs read like production ("keepalive ok (0 3 * * *)").
const KEEPALIVE_TRIGGER = "/cdn-cgi/handler/scheduled?cron=0+3+*+*+*";

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
      ["dashboard renders for signed-in user", () => request("/dashboard"), { status: 200 }],
      [
        "signout clears session",
        () => request("/api/auth/signout", { method: "POST" }),
        { status: 302, location: "/" },
      ],
      ["dashboard redirects after signout", () => request("/dashboard"), { status: 302, location: "/auth/signin" }],
      ["keepalive cron succeeds", () => request(KEEPALIVE_TRIGGER), { status: 200 }],
    ];

let failed = 0;
for (const [name, run, expected] of steps) {
  const actual = await run();
  const statusOk =
    typeof expected.status === "function" ? expected.status(actual.status) : actual.status === expected.status;
  const ok = statusOk && (expected.location === undefined || actual.location.startsWith(expected.location));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  -> ${actual.status} ${actual.location}`);
  if (!ok) {
    failed++;
    const expectedStatus = typeof expected.status === "function" ? "non-2xx" : expected.status;
    console.log(`      expected ${expectedStatus} ${expected.location ?? ""}`);
  }
}

console.log(failed ? `\n${failed} step(s) failed` : "\nAll smoke steps passed");
process.exit(failed ? 1 : 0);
