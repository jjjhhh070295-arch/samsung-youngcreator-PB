// Offline: node scripts/test-research-crawler.cjs
// Public, read-only smoke test (no DB/LLM/env): node scripts/test-research-crawler.cjs --live
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
require.extensions[".ts"] = (mod, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  mod._compile(output.outputText, filename);
};
if (!process.argv.includes("--live")) {
  require(path.resolve(__dirname, "../lib/researchCrawler.test.ts"));
} else {
  const { fetchSource, createCrawlClient } = require("../lib/researchCrawler.ts");
  const { RESEARCH_SOURCES } = require("../lib/portfolioResearch.ts");
  (async () => {
    const client = createCrawlClient();
    const names = ["네이버 금융 기업분석 리포트", "미래에셋증권 리서치", "흥국증권 리서치", "한양증권 리서치"];
    for (const name of names) {
      const source = RESEARCH_SOURCES.find((item) => item.name === name);
      const events = [];
      const items = await fetchSource(source, { client, maxPages: 3, onEvent: (e) => events.push(e) });
      const sample = items.slice(0, 3).map(({ title, date, broker, analyst, documentType, url }) =>
        ({ title, date, broker, analyst, documentType, url }));
      let pdf = null;
      const candidate = items.find((item) => /\.pdf(?:\?|$)/i.test(item.url));
      if (candidate) {
        try {
          const result = await client.get(candidate.url);
          const signature = new TextDecoder().decode(result.buffer.slice(0, 5));
          pdf = { status: result.status, contentType: result.contentType, signature, valid: signature === "%PDF-", url: result.url };
          if (!pdf.valid) process.exitCode = 1;
        } catch (error) {
          pdf = { error: error.message };
          process.exitCode = 1;
        }
      }
      console.log(JSON.stringify({ source: name, events, count: items.length, sample, pdf }));
      if (name !== names[0] && !items.length) process.exitCode = 1;
    }
  })().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
