import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const SERIES = ["DFEDTARU", "FEDFUNDS", "DGS10", "DEXKOUS", "PPIACO", "CPIAUCSL", "VIXCLS"];
const START = "1989-01-01";
const UA = "Mozilla/5.0 macro-stress-snapshot/1.0";

async function downloadSeries(id) {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${START}`;
  const response = await fetch(url, {
    headers: { "user-agent": UA, accept: "text/csv" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`FRED ${id}: HTTP ${response.status}`);

  const byMonth = new Map();
  for (const line of (await response.text()).trim().split(/\r?\n/).slice(1)) {
    const [date, raw] = line.split(",");
    const value = Number(raw);
    if (date && Number.isFinite(value)) byMonth.set(date.slice(0, 7), { date, value });
  }
  return Array.from(byMonth.values());
}

const entries = await Promise.all(
  SERIES.map(async (id) => [id, await downloadSeries(id)]),
);
const snapshot = {
  generatedAt: new Date().toISOString(),
  start: START,
  series: Object.fromEntries(entries),
};
const target = resolve("lib/macroStress/fred-snapshot.json");
await writeFile(target, `${JSON.stringify(snapshot)}\n`, "utf8");
console.log(`Wrote ${target}`);
for (const [id, rows] of entries) console.log(`${id}: ${rows.length} months`);
