// Usage: PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/verify-ips-layout.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const directory = path.resolve(process.argv[2] || "/tmp/ips-design-proof");
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  for (const count of [4, 8, 19, "tax"]) {
    await page.goto(pathToFileURL(path.join(directory, `ips-${count}.html`)).href);
    await page.evaluate(() => document.fonts.ready);
    const sheetCount = await page.locator(".ips-sheet").count();
    assert.equal(sheetCount, count === 4 || count === "tax" ? 2 : count === 8 ? 3 : 4);
    if (count === 4) {
      for (let i = 0; i < sheetCount; i++) await page.locator(".ips-sheet").nth(i).screenshot({ path: path.join(directory, `screen-page-${i + 1}.png`) });
    }
    await page.emulateMedia({ media: "print" });
    const pdfPath = path.join(directory, `ips-${count}.pdf`);
    await page.pdf({ path: pdfPath, preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
    const info = execFileSync("pdfinfo", [pdfPath], { encoding: "utf8", env: { ...process.env, LC_ALL: "C" } });
    const actualPages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
    assert.equal(actualPages, sheetCount, `Unexpected PDF page break: ${pdfPath}`);
    const pageSize = info.match(/^Page size:\s+([\d.]+) x ([\d.]+) pts/m);
    assert.ok(pageSize && Math.abs(Number(pageSize[1]) - 595.28) < 1 && Math.abs(Number(pageSize[2]) - 841.89) < 1, "PDF must use portrait A4");
    const printSizes = await page.locator(".ips-sheet").evaluateAll((sheets) => sheets.map((sheet) => ({ height: sheet.getBoundingClientRect().height, width: sheet.getBoundingClientRect().width })));
    console.log(JSON.stringify({ count, sheetCount, actualPages, printSizes }));
    await page.emulateMedia({ media: "screen" });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(pathToFileURL(path.join(directory, "ips-4.html")).href);
  await page.screenshot({ path: path.join(directory, "mobile.png"), fullPage: true });
  const overflowing = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: innerWidth }));
  assert.ok(overflowing.scroll <= overflowing.viewport, JSON.stringify(overflowing));
  console.log("Desktop, mobile, and print proofs generated without horizontal overflow.");
} finally {
  await browser.close();
}
