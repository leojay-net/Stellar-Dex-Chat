const path = require("node:path");

const rootDir = process.cwd();
const frontendDir = path.join(rootDir, "dex_with_fiat_frontend");

const toPosix = (value) => value.split(path.sep).join("/");

module.exports = {
  "stellar-contracts/**/*.rs": () => "npm run precommit:clippy",
  "dex_with_fiat_frontend/**/*.{ts,tsx}": (files) => {
    if (!files.length) return [];
    const fileArgs = files
      .map((file) => path.relative(frontendDir, file))
      .filter((file) => file && !file.startsWith(".."))
      .map((file) => `--file ${JSON.stringify(toPosix(file))}`)
      .join(" ");

    if (!fileArgs) return [];
    return `npm run precommit:eslint -- ${fileArgs}`;
  },
};
