// Render the production document with fictional data for screenshot/PDF QA.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import IpsA4Document from "../components/ips/IpsA4Document";
import { ipsDocumentFixture } from "../lib/ipsDocument.fixture";

const output = path.resolve(process.argv[2] || "/tmp/ips-design-proof");
mkdirSync(output, { recursive: true });
const css = readFileSync("app/ips-document.css", "utf8");
const taxClient = ipsDocumentFixture();
taxClient.portfolios[0].id = "stable";
const cases = [
  ...[4, 8, 19].map((count) => ({ name: String(count), client: ipsDocumentFixture(count) })),
  { name: "tax", client: taxClient },
];
for (const { name, client } of cases) {
  const body = renderToStaticMarkup(<IpsA4Document documentClient={client} documentPbDisplay="박담당" investableWon={3_000_000_000} dateStr="2026년 9월 8일" />);
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>IPS 디자인 검증 · 가상 고객</title><style>body{margin:0;padding:24px;background:#edf1f6;}@media(max-width:600px){body{padding:0;}}@media print{body{padding:0;background:white;}}${css}</style></head><body>${body}</body></html>`;
  writeFileSync(path.join(output, `ips-${name}.html`), html);
}
console.log(`Fictional IPS proofs: ${output}`);
