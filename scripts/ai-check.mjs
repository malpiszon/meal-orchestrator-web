// Shows whether the optional @malpiszon/ai-toolkit is installed and its postinstall ran.
// npm skips the package silently without a token, and npm 11 can skip its install script,
// so this names which of the two happened. Run with `npm run ai:check`; not used in CI.

import { existsSync, readFileSync } from "node:fs";

const PKG = "node_modules/@malpiszon/ai-toolkit/package.json";
const MANIFEST = ".claude/.ai-toolkit-manifest.json";

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

if (!existsSync(PKG)) {
  console.error(
    "AI toolkit not installed: store a read:packages token (docs/dev-walkthrough.md, AI toolkit), then npm install",
  );
  process.exit(1);
}

const { version } = readJson(PKG);
const installed = existsSync(MANIFEST) ? readJson(MANIFEST).version : undefined;
if (installed !== version) {
  console.error(
    `AI toolkit ${version} is in node_modules but its install script did not run (installed skills: ${installed ?? "none"}). ` +
      "Run npm install-scripts approve @malpiszon/ai-toolkit, then npm rebuild @malpiszon/ai-toolkit",
  );
  process.exit(1);
}

console.log(version);
