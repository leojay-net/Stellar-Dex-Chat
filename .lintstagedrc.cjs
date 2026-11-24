const path = require("node:path");

const rootDir = process.cwd();
const frontendDir = path.join(rootDir, "Dechat/dex_with_fiat_frontend");

const toPosix = (value) => value.split(path.sep).join("/");

// Build a space-separated list of paths relative to the frontend package root.
// Returns null when no staged file falls inside that directory.
function relativeToFrontend(files) {
  const rel = files
    .map((file) => path.relative(frontendDir, file))
    .filter((file) => file && !file.startsWith(".."))
    .map((file) => toPosix(file));
  return rel.length ? rel : null;
}

module.exports = {
  // ── Rust ────────────────────────────────────────────────────────────────
  "Dechat/stellar-contracts/**/*.rs": () => "npm run precommit:clippy",

  // ── Frontend: Prettier (src, e2e tests, root config files) ──────────────
  // Runs prettier --write on every staged file that Prettier owns.
  // Covers TS/TSX source, Playwright e2e specs, and the root config files
  // (next.config.ts, vitest.config.ts, playwright.config.ts, *.mjs, *.json).
  "Dechat/dex_with_fiat_frontend/**/*.{ts,tsx,mjs,json}": (files) => {
    const rel = relativeToFrontend(files);
    if (!rel) return [];
    const fileArgs = rel.map((f) => `"${f}"`).join(" ");
    return `pnpm --prefix Dechat/dex_with_fiat_frontend exec prettier --write ${fileArgs}`;
  },

  // ── Frontend: ESLint ─────────────────────────────────────────────────────
  "Dechat/dex_with_fiat_frontend/**/*.{ts,tsx}": (files) => {
    const rel = relativeToFrontend(files);
    if (!rel) return [];
    const fileArgs = rel.map((f) => `--file "${f}"`).join(" ");
    return `npm run precommit:eslint -- ${fileArgs}`;
  },
};
