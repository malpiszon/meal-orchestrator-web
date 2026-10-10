// Proof for the Claude Code hooks in .claude/hooks/: each case pipes a hook payload into the real
// script, inside a throwaway git repo, and asserts the exit code and the channel the message uses
// (exit 2 + stderr is what Claude sees). git, jq and the scripts are real; ESLint, astro, Vitest
// and the Supabase CLI are stubs in the throwaway repo's node_modules/.bin that fail on a marker
// (LINT_ERROR, TYPE_ERROR, TEST_FAIL, PGTAP_FAIL), because the real ones take ~45 s per run here.
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const HOOKS_DIR = path.resolve(import.meta.dirname, "../../.claude/hooks");
const SETTINGS = path.resolve(import.meta.dirname, "../../.claude/settings.json");

const STUBS: Record<string, string> = {
  eslint: `
rc=0
for a; do case "$a" in -*) ;; *) if grep -q LINT_ERROR "$a" 2>/dev/null; then echo "$a 1:1 error LINT_ERROR"; rc=1; fi ;; esac; done
exit $rc`,
  astro: `
hits=$(grep -rl --include='*.ts' --include='*.astro' TYPE_ERROR src 2>/dev/null)
[ -z "$hits" ] && exit 0
for f in $hits; do echo "$f:1:1 - error ts(2322): TYPE_ERROR"; done
exit 1`,
  vitest: `
shift
files=(); for a; do case "$a" in -*) ;; *) files+=("$a") ;; esac; done
[ \${#files[@]} -gt 0 ] || files=(src)
hits=$(grep -rl TEST_FAIL "\${files[@]}" 2>/dev/null)
[ -z "$hits" ] && exit 0
echo "FAIL $hits TEST_FAIL"
exit 1`,
  supabase: `
if [ "$1" = migration ]; then
  printf '{"migrations":['
  sep=""
  for f in supabase/migrations/*.sql; do
    v=$(basename "$f"); v=\${v%%_*}; r=$v
    [ "$v" = "\${HOOK_STUB_PENDING:-}" ] && r=""
    printf '%s{"local":"%s","remote":"%s"}' "$sep" "$v" "$r"; sep=,
  done
  printf ']}\\n'
  exit 0
fi
shift 2
files=("$@"); [ \${#files[@]} -gt 0 ] || files=(supabase/tests)
hits=$(grep -rl PGTAP_FAIL "\${files[@]}" 2>/dev/null)
[ -z "$hits" ] && exit 0
echo "$hits .. Failed test 1: PGTAP_FAIL"
exit 1`,
};

const tmpRoots: string[] = [];
const servers: Server[] = [];
let templates = "";

function git(cwd: string, ...args: string[]) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

function write(root: string, rel: string, content: string) {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), content);
}

function installStubs(root: string) {
  for (const [name, body] of Object.entries(STUBS)) {
    const file = path.join(root, "node_modules/.bin", name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `#!/usr/bin/env bash\necho "${name} $*" >>"$HOOK_STUB_LOG"\n${body}\n`);
    chmodSync(file, 0o755);
  }
}

interface Repo {
  root: string;
  state: string;
  log: string;
}

/** A committed, clean checkout with the real hook scripts and stubbed tools. */
function buildTemplate(root: string, dbPort: number) {
  mkdirSync(root, { recursive: true });
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "hooks@test.invalid");
  git(root, "config", "user.name", "hooks test");
  cpSync(HOOKS_DIR, path.join(root, ".claude/hooks"), { recursive: true });
  cpSync(SETTINGS, path.join(root, ".claude/settings.json"));
  write(root, ".gitignore", "node_modules/\n");
  write(root, "supabase/config.toml", `[api]\nport = 1\n\n[db]\nport = ${dbPort}\n`);
  write(root, "supabase/migrations/20260101000000_init.sql", "create table t (id int);\n");
  write(root, "supabase/tests/a.test.sql", "select plan(1);\n");
  write(root, "src/lib/math.ts", "export const one = 1;\n");
  write(root, "src/lib/math.test.ts", "// passes\n");
  write(root, "README.md", "# repo\n");
  installStubs(root);
  git(root, "add", "-A");
  git(root, "commit", "-qm", "init");
}

/** A fresh copy of a template: local Supabase "up" (a port that accepts) or "down" (a closed port). */
function makeRepo(db: "up" | "down" = "down"): Repo {
  const base = mkdtempSync(path.join(tmpdir(), "agent-hooks-"));
  tmpRoots.push(base);
  const root = path.join(base, "repo");
  cpSync(path.join(templates, db), root, { recursive: true });
  const state = path.join(base, "tmp");
  mkdirSync(state);
  return { root, state, log: path.join(base, "stub.log") };
}

interface RunOptions {
  cwd?: string;
  env?: Record<string, string>;
}

function hook(repo: Repo, script: string, payload: unknown, opts: RunOptions = {}) {
  const cwd = opts.cwd ?? repo.root;
  const input = typeof payload === "string" ? payload : JSON.stringify(payload);
  const r = spawnSync("bash", [path.join(cwd, ".claude/hooks", script)], {
    cwd,
    input,
    encoding: "utf8",
    env: { ...process.env, TMPDIR: repo.state, HOOK_STUB_LOG: repo.log, CLAUDE_PROJECT_DIR: cwd, ...opts.env },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const edit = (repo: Repo, file: string, extra: Record<string, unknown> = {}) =>
  hook(repo, "related-tests.sh", {
    session_id: "s1",
    cwd: repo.root,
    hook_event_name: "PostToolUse",
    tool_name: "Edit",
    tool_input: { file_path: path.isAbsolute(file) ? file : path.join(repo.root, file) },
    ...extra,
  });

const stop = (repo: Repo, extra: Record<string, unknown> = {}, opts: RunOptions = {}) =>
  hook(
    repo,
    "end-of-turn.sh",
    { session_id: "s1", cwd: repo.root, hook_event_name: "Stop", stop_hook_active: false, ...extra },
    opts,
  );

const stubCalls = (repo: Repo) => (existsSync(repo.log) ? readFileSync(repo.log, "utf8") : "");

async function openPort(): Promise<number> {
  const server = createServer((socket) => socket.end());
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return address.port;
}

beforeAll(async () => {
  templates = mkdtempSync(path.join(tmpdir(), "agent-hooks-templates-"));
  buildTemplate(path.join(templates, "up"), await openPort());
  const closedPort = await openPort();
  const closing = servers.pop();
  await new Promise((resolve) => closing?.close(resolve));
  buildTemplate(path.join(templates, "down"), closedPort);
});

afterEach(() => {
  while (tmpRoots.length) rmSync(tmpRoots.pop() ?? "", { recursive: true, force: true });
});

afterAll(() => {
  for (const s of servers) s.close();
  rmSync(templates, { recursive: true, force: true });
});

describe("related-tests.sh (PostToolUse)", () => {
  it("blocks with the failing tests on stderr when a related test fails", () => {
    const repo = makeRepo();
    write(repo.root, "src/lib/math.ts", "export const one = 1; // TEST_FAIL\n");
    const r = edit(repo, "src/lib/math.ts");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("Tests related to src/lib/math.ts fail");
    expect(r.stderr).toContain("TEST_FAIL");
  });

  it("runs an edited test file itself", () => {
    const repo = makeRepo();
    write(repo.root, "src/lib/math.test.ts", "// TEST_FAIL\n");
    const r = edit(repo, "src/lib/math.test.ts");
    expect(r.status).toBe(2);
    expect(stubCalls(repo)).toContain("vitest run src/lib/math.test.ts");
  });

  it("passes silently on a clean file", () => {
    const repo = makeRepo();
    const r = edit(repo, "src/lib/math.ts");
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    expect(stubCalls(repo)).toContain("vitest related src/lib/math.ts --run");
  });

  it("skips files it does not cover, files that do not exist and payloads without a path", () => {
    const repo = makeRepo();
    expect(edit(repo, "README.md").status).toBe(0);
    expect(edit(repo, "src/lib/gone.ts").status).toBe(0);
    expect(hook(repo, "related-tests.sh", {}).status).toBe(0);
    expect(hook(repo, "related-tests.sh", "not json").status).toBe(0);
    expect(hook(repo, "related-tests.sh", { tool_name: "Bash", tool_input: { command: "ls" } }).status).toBe(0);
    expect(stubCalls(repo)).toBe("");
  });

  it("runs an edited pgTAP file and blocks when it fails", () => {
    const repo = makeRepo("up");
    write(repo.root, "supabase/tests/a.test.sql", "-- PGTAP_FAIL\n");
    const r = edit(repo, "supabase/tests/a.test.sql");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("pgTAP supabase/tests/a.test.sql fails");
    expect(r.stderr).toContain("PGTAP_FAIL");
  });

  it("tells the user and the agent when local Supabase is down, instead of passing silently", () => {
    const repo = makeRepo();
    write(repo.root, "supabase/tests/a.test.sql", "-- PGTAP_FAIL\n");
    const r = edit(repo, "supabase/tests/a.test.sql");
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout) as { systemMessage: string; hookSpecificOutput: { additionalContext: string } };
    expect(out.systemMessage).toContain("not running");
    expect(out.hookSpecificOutput.additionalContext).toContain("not running");
    expect(stubCalls(repo)).not.toContain("supabase test");
  });

  it("resolves a relative path against cwd and skips files of another repository", () => {
    const repo = makeRepo();
    write(repo.root, "src/lib/math.ts", "// TEST_FAIL\n");
    const relative = hook(repo, "related-tests.sh", { cwd: repo.root, tool_input: { file_path: "src/lib/math.ts" } });
    expect(relative.status).toBe(2);

    const other = makeRepo();
    write(other.root, "src/lib/math.ts", "// TEST_FAIL\n");
    expect(edit(repo, path.join(other.root, "src/lib/math.ts")).status).toBe(0);
  });

  it("fails visibly when Vitest is not installed", () => {
    const repo = makeRepo();
    rmSync(path.join(repo.root, "node_modules/.bin/vitest"));
    const r = edit(repo, "src/lib/math.ts");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("node_modules/.bin/vitest is missing");
  });
});

describe("end-of-turn.sh (Stop)", () => {
  it("blocks on a lint error written without any per-edit hook, naming the file", () => {
    const repo = makeRepo();
    write(repo.root, "src/lib/shell-written.ts", "const x = 1; // LINT_ERROR\n");
    const r = stop(repo);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("ESLint errors in changed files");
    expect(r.stderr).toContain("src/lib/shell-written.ts 1:1 error LINT_ERROR");
  });

  it("reports type errors and failing unit tests in the same message", () => {
    const repo = makeRepo();
    write(repo.root, "src/lib/math.ts", "export const one: number = 'TYPE_ERROR';\n");
    write(repo.root, "src/lib/math.test.ts", "// TEST_FAIL\n");
    const r = stop(repo);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("astro check fails");
    expect(r.stderr).toContain("TYPE_ERROR");
    expect(r.stderr).toContain("Unit tests fail");
  });

  it("passes on a clean change and does not re-check the same tree next turn", () => {
    const repo = makeRepo();
    write(repo.root, "src/lib/math.ts", "export const one = 1;\nexport const two = 2;\n");
    const first = stop(repo);
    expect(first.status).toBe(0);
    expect(first.stderr).toBe("");
    expect(stubCalls(repo)).toContain("astro check");
    rmSync(repo.log);
    expect(stop(repo).status).toBe(0);
    expect(stubCalls(repo)).toBe("");
  });

  it("lets the agent finish once it was already sent back (stop_hook_active, loop_count)", () => {
    const repo = makeRepo();
    write(repo.root, "src/lib/math.ts", "// LINT_ERROR\n");
    expect(stop(repo, { stop_hook_active: true }).status).toBe(0);
    expect(stop(repo, { loop_count: 1 }).status).toBe(0);
    expect(stubCalls(repo)).toBe("");
  });

  it("runs nothing when nothing changed, and tolerates odd payloads", () => {
    const repo = makeRepo();
    expect(stop(repo).status).toBe(0);
    expect(hook(repo, "end-of-turn.sh", {}).status).toBe(0);
    expect(hook(repo, "end-of-turn.sh", "not json").status).toBe(0);
    expect(stubCalls(repo)).toBe("");
  });

  it("does not run the code checks for a docs-only change", () => {
    const repo = makeRepo();
    write(repo.root, "README.md", "# changed\n");
    expect(stop(repo).status).toBe(0);
    expect(stubCalls(repo)).toBe("");
  });

  it("blocks on a failing pgTAP test when supabase/ changed", () => {
    const repo = makeRepo("up");
    write(repo.root, "supabase/tests/a.test.sql", "-- PGTAP_FAIL\n");
    const r = stop(repo);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("pgTAP fails");
    expect(r.stderr).toContain("PGTAP_FAIL");
  });

  it("skips pgTAP visibly when a migration is not applied or Supabase is down", () => {
    const up = makeRepo("up");
    write(up.root, "supabase/migrations/20260202000000_new.sql", "-- PGTAP_FAIL\n");
    const pending = stop(up, {}, { env: { HOOK_STUB_PENDING: "20260202000000" } });
    expect(pending.status).toBe(0);
    expect((JSON.parse(pending.stdout) as { systemMessage: string }).systemMessage).toContain(
      "20260202000000 not applied locally",
    );
    expect(stubCalls(up)).not.toContain("supabase test");

    const down = makeRepo();
    write(down.root, "supabase/tests/a.test.sql", "-- PGTAP_FAIL\n");
    const r = stop(down);
    expect(r.status).toBe(0);
    expect((JSON.parse(r.stdout) as { systemMessage: string }).systemMessage).toContain("not running");
    // A skipped run is not cached as green: the next turn tries again.
    expect(stop(down).stdout).toContain("not running");
  });

  it("fails visibly when the typechecker is not installed", () => {
    const repo = makeRepo();
    rmSync(path.join(repo.root, "node_modules/.bin/astro"));
    write(repo.root, "src/lib/math.ts", "export const one = 1;\nexport const two = 2;\n");
    const r = stop(repo);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("node_modules/.bin/astro is missing");
  });
});

describe("checkout resolution", () => {
  it("checks the session's checkout, not $CLAUDE_PROJECT_DIR", () => {
    const repo = makeRepo();
    const other = makeRepo();
    write(other.root, "src/lib/math.ts", "// LINT_ERROR TEST_FAIL\n");
    const env = { CLAUDE_PROJECT_DIR: other.root };
    expect(stop(repo, {}, { env }).status).toBe(0);
    expect(edit(repo, "src/lib/math.ts").status).toBe(0);
  });

  it("sweeps a sibling worktree the session edited", () => {
    const repo = makeRepo();
    const wt = path.join(path.dirname(repo.root), "wt");
    git(repo.root, "worktree", "add", "-q", wt);
    installStubs(wt);
    write(wt, "src/lib/math.ts", "export const one = 1; // LINT_ERROR\n");
    edit(repo, path.join(wt, "src/lib/math.ts"));
    const r = stop(repo);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(`ESLint errors in changed files (${wt})`);
  });

  it("every configured command reaches its script from a worktree with a stale $CLAUDE_PROJECT_DIR", () => {
    const repo = makeRepo();
    const wt = path.join(path.dirname(repo.root), "wt");
    git(repo.root, "worktree", "add", "-q", wt);
    const settings = JSON.parse(readFileSync(SETTINGS, "utf8")) as {
      hooks: Record<string, { hooks: { command: string }[] }[]>;
    };
    const commands = Object.values(settings.hooks).flatMap((groups) =>
      groups.flatMap((g) => g.hooks.map((h) => h.command)),
    );
    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) {
      const r = spawnSync("sh", ["-c", command], {
        cwd: wt,
        input: "{}",
        encoding: "utf8",
        env: { ...process.env, TMPDIR: repo.state, HOOK_STUB_LOG: repo.log, CLAUDE_PROJECT_DIR: "/nonexistent" },
      });
      expect({ command, status: r.status, stderr: r.stderr }).toEqual({ command, status: 0, stderr: "" });
    }
  });
});
