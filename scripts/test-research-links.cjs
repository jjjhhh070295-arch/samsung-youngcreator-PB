// Run: node scripts/test-research-links.cjs
// Uses the existing TypeScript dev dependency. No npx/install, env or network.
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
require.extensions[".ts"] = (mod, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  mod._compile(output.outputText, filename);
};
require(path.resolve(__dirname, "../lib/researchLinks/catalog.test.ts"));
