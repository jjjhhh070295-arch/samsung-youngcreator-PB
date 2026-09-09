import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { collectIdeas, decodeDocument, runSyntheticMiraeLayout, type SyntheticMiraeInput } from "./pipeline";
import type { CollectionGrant } from "./collector";
import * as collectorModule from "./collector";
import * as textExtractorModule from "./extract";
import { MIRAE_TOP_PICKS_COLUMNS, MIRAE_TOP_PICKS_FORMAT, type MiraeCell, type MiraeLayout } from "./providers/miraeTopPicks";
const grant: CollectionGrant = {
  providerId: "synthetic-provider", allowedOrigins: ["https://synthetic-broker.example"],
  allowedPathPrefixes: ["/research"], fetchAllowed: true, extractAllowed: true, displayAllowed: true,
  approvalReference: "SYNTHETIC_TEST_ONLY", expiresAt: "2026-09-08T00:00:00Z",
};
const input = { url: "https://synthetic-broker.example/research/report", grant, now: "2026-09-07T00:00:00Z", kind: "stock" as const };
const transport = (body: string, contentType = "text/html") => (async () => new Response(body, { headers: { "content-type": contentType } })) as typeof fetch;
test("collection, HTML decoding and explicit selection extraction preserve hash and withheld review state", async () => {
  const result = await collectIdeas(input, transport("<script>Top Picks: Attack</script><p>Top Picks: Synthetic A, Synthetic B</p><p>BUY: Synthetic C</p>"));
  assert.equal(result.status, "review_required");
  if (result.status !== "review_required") return;
  assert.deepEqual(result.extraction.candidates.map(c => c.entityName), ["Synthetic A", "Synthetic B"]);
  assert.match(result.sourceHash, /^[a-f0-9]{64}$/);
  assert.equal(result.format, "html");
  assert.equal(result.extraction.candidates[0].page, 1);
  assert.equal("approved" in result, false);
});
test("unknown rights prevent fetch and decoding, not just display", async () => {
  let calls = 0;
  const result = await collectIdeas({ ...input, grant: { ...grant, fetchAllowed: false } },
    (async () => { calls++; throw new Error("must not run"); }) as typeof fetch,
    async () => { calls++; throw new Error("must not run"); });
  assert.equal(result.status, "withheld");
  assert.equal(calls, 0);
});
test("decode errors and unreadable scans cannot become successful empty recommendations", async () => {
  assert.equal((await collectIdeas(input, transport("x"), async () => { throw new Error("unsafe remote error"); })).status, "failed");
  assert.equal((await collectIdeas(input, transport("x"), async () => [])).status, "failed");
});
test("same bytes yield same hash; original change invalidates identity", async () => {
  const a = await collectIdeas(input, transport("<p>Top Pick: Synthetic A</p>"));
  const b = await collectIdeas(input, transport("<p>Top Pick: Synthetic A</p>"));
  const c = await collectIdeas(input, transport("<p>Top Pick: Synthetic B</p>"));
  assert.ok(a.status === "review_required" && b.status === "review_required" && c.status === "review_required");
  if (a.status === "review_required" && b.status === "review_required" && c.status === "review_required") {
    assert.equal(a.sourceHash, b.sourceHash); assert.notEqual(a.sourceHash, c.sourceHash);
  }
});
test("plain mentions remain no explicit selection, not a negative investment view", async () => {
  const result = await collectIdeas(input, transport("<p>Company A reported earnings.</p>"));
  assert.equal(result.status, "review_required");
  if (result.status === "review_required") assert.equal(result.extraction.status, "no_explicit_selection");
});
test("PDF body requires real signature; original page numbers survive decoder port", async () => {
  await assert.rejects(() => decodeDocument({ contentType: "pdf", bytes: new TextEncoder().encode("<html>not a PDF</html>") }));
  const result = await collectIdeas(input, transport("%PDF-synthetic", "application/pdf"), async () => [{ page: 64, text: "Top Pick: Synthetic A" }]);
  assert.equal(result.status, "review_required");
  if (result.status === "review_required") assert.equal(result.extraction.candidates[0].page, 64);
});

/** Entirely invented content; no files, licensed reports, fonts or external URLs are loaded. */
function syntheticPdf(): Uint8Array {
  const stream = "BT /F1 12 Tf 50 750 Td (Top Picks: Synthetic Alpha, Synthetic Beta) Tj 0 -20 Td (BUY: Synthetic Gamma) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "ascii"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "ascii");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, "ascii"));
}

test("synthetic PDF and real decoder extract an in-memory one-page document without mutating original bytes", async () => {
  const bytes = syntheticPdf();
  const original = bytes.slice();
  const pages = await decodeDocument({ contentType: "pdf", bytes });
  assert.deepEqual(bytes, original);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].page, 1);
  assert.match(pages[0].text, /Top Picks: Synthetic Alpha, Synthetic Beta/);
  assert.match(pages[0].text, /\nBUY: Synthetic Gamma/);
});

test("synthetic PDF and real decoder complete collection, original hash and candidate extraction with fake transport only", async () => {
  const bytes = syntheticPdf();
  let calls = 0;
  const fakeTransport = (async (url, init) => {
    calls += 1;
    assert.equal(String(url), input.url);
    assert.equal(init?.redirect, "error");
    return new Response(new Uint8Array(bytes).buffer, { headers: { "Content-Type": "application/pdf", "Content-Length": String(bytes.byteLength) } });
  }) as typeof fetch;
  // No decoder argument: this exercises the actual installed unpdf parser, not its mock port.
  const result = await collectIdeas(input, fakeTransport);
  assert.equal(calls, 1);
  assert.equal(result.status, "review_required");
  if (result.status !== "review_required") return;
  const { createHash } = await import("node:crypto");
  assert.equal(result.sourceHash, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(result.format, "pdf");
  assert.equal(result.sourceUrl, input.url);
  assert.equal(result.extraction.status, "candidates");
  assert.deepEqual(result.extraction.candidates.map(candidate => candidate.entityName), ["Synthetic Alpha", "Synthetic Beta"]);
  assert.ok(result.extraction.candidates.every(candidate => candidate.page === 1 && candidate.direction === "unspecified"));
  assert.equal(result.extraction.candidates.some(candidate => candidate.entityName.includes("Gamma")), false);
  assert.equal("approved" in result, false);
});

// Invented layout, not output from an actual PDF decoder. Bytes bind the fixture
// identity only; they do not authenticate this separately supplied table layout.
function syntheticMiraeMetadata(): SyntheticMiraeInput["expectedDocument"] {
  return {
    providerId: "mirae", opinionProviderId: "mirae", opinionSubject: "합성 기관 의견 주체",
    desk: "주식전략", author: "합성 작성자", title: "합성 미래에셋 표 연결 시험",
    publicationDate: "2026-05-22", pageCount: 68,
    targetPeriod: { label: "2026년 하반기", start: "2026-07-01", end: "2026-12-31" }, scenario: null,
  };
}
function syntheticMiraeCell(text: string, column: number, y: number): MiraeCell {
  return { text, box: [column / 14, y, (column + 1) / 14, y + 0.02] };
}
function syntheticMiraeFixture(): SyntheticMiraeInput & { layout: MiraeLayout } {
  const fixtureBytes = new TextEncoder().encode("SYNTHETIC MIRAE TABLE FIXTURE v1 — 가상기업A / 가상기업B. NOT A REAL REPORT.");
  return {
    mode: "synthetic", fixtureBytes, expectedDocument: syntheticMiraeMetadata(),
    layout: {
      format: MIRAE_TOP_PICKS_FORMAT,
      document: { ...syntheticMiraeMetadata(), origin: "synthetic", sourceUrl: null, sourceHash: createHash("sha256").update(fixtureBytes).digest("hex") },
      tables: [{
        id: "synthetic-table", page: 64, printedPage: "64", heading: { text: "2026년 하반기 Top Picks", box: [0, 0.01, 1, 0.05] },
        headers: MIRAE_TOP_PICKS_COLUMNS.map((text, index) => syntheticMiraeCell(text, index, 0.1)),
        asOf: { date: "2026-05-21", note: { text: "합성 주: 2026년 5월 21일 종가 기준", box: [0, 0.8, 1, 0.85] } },
        legends: [{ text: "합성 범례 — 시장 약어 설명 미확인", box: [0, 0.87, 1, 0.9] }],
        rows: [
          { number: 1, cells: ["합성 업종 묶음", "A000001", "가상기업A", "KS", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"].map((text, index) => syntheticMiraeCell(text, index, 0.2)) },
          { number: 2, cells: ["합성 업종 묶음", "A000002", "가상기업B", "KQ", "1", "2", "3", "", "", "흑전", "적축", "-", "9", "10"].map((text, index) => syntheticMiraeCell(text, index, 0.25)) },
        ],
      }],
    },
  };
}
function expectSyntheticWithheld(value: unknown, reason?: string) {
  const result = runSyntheticMiraeLayout(value as SyntheticMiraeInput);
  assert.equal(result.status, "withheld");
  assert.equal(result.mode, "synthetic");
  assert.equal(result.publishable, false);
  assert.equal("extraction" in result, false);
  if (result.status === "withheld" && reason) assert.ok(result.reasons.includes(reason), JSON.stringify(result));
  return result;
}

test("Mirae pipeline connects only synthetic coordinate tables and preserves full review evidence", () => {
  const input = syntheticMiraeFixture(), result = runSyntheticMiraeLayout(input);
  assert.equal(result.status, "review_required");
  if (result.status !== "review_required") return;
  assert.equal(result.mode, "synthetic"); assert.equal(result.publishable, false);
  assert.equal(result.sourceHash, createHash("sha256").update(input.fixtureBytes).digest("hex"));
  assert.equal(result.extraction.status, "candidates"); assert.equal(result.extraction.candidates.length, 2);
  const first = result.extraction.candidates[0], table = input.layout.tables[0];
  assert.deepEqual(first.document.targetPeriod, input.expectedDocument.targetPeriod);
  assert.deepEqual(first.evidence[0], {
    page: 64, printedPage: "64", tableId: table.id, row: 1, heading: table.heading,
    headers: table.headers, cells: table.rows[0].cells, asOf: table.asOf, legends: table.legends,
  });
  assert.deepEqual(result.extraction.candidates[1].evidence[0].cells.slice(7).map(cell => cell.text), ["", "", "흑전", "적축", "-", "9", "10"]);
  assert.ok(result.extraction.candidates.every(candidate => candidate.reviewStatus === "review_required"
    && !candidate.publishable && candidate.rightsStatus === "unconfirmed" && candidate.sourceVerification === "unverified"
    && candidate.instrument.canonicalId === null && candidate.sector === null && candidate.direction === "unspecified"));
  for (const field of ["fetchedAt", "sourceUrl", "approved", "customerId"]) assert.equal(field in result, false);
});

test("Mirae pipeline detects altered bytes and malformed or different hashes", () => {
  const changed = syntheticMiraeFixture(); changed.fixtureBytes[0] ^= 1;
  expectSyntheticWithheld(changed, "source_hash_mismatch");
  for (const hash of ["", "x".repeat(64), "a".repeat(64)]) {
    const input = syntheticMiraeFixture(); input.layout.document.sourceHash = hash;
    expectSyntheticWithheld(input, /^[a-f0-9]{64}$/i.test(hash) ? "source_hash_mismatch" : "invalid_source_hash");
  }
  const uppercase = syntheticMiraeFixture(); uppercase.layout.document.sourceHash = uppercase.layout.document.sourceHash.toUpperCase();
  assert.equal(runSyntheticMiraeLayout(uppercase).status, "review_required");
});

test("Mirae pipeline matches independent document expectations field by field", () => {
  for (const field of ["providerId", "opinionProviderId", "opinionSubject", "desk", "author", "title", "publicationDate"] as const) {
    const changed = syntheticMiraeFixture(); changed.layout.document[field] = "다른 합성 값";
    expectSyntheticWithheld(changed, "document_metadata_mismatch");
    const missing = syntheticMiraeFixture();
    expectSyntheticWithheld({ ...missing, expectedDocument: { ...missing.expectedDocument, [field]: undefined } }, "document_metadata_mismatch");
  }
  const pages = syntheticMiraeFixture(); pages.layout.document.pageCount = 67;
  expectSyntheticWithheld(pages, "document_metadata_mismatch");
  const scenario = syntheticMiraeFixture(); scenario.layout.document.scenario = "다른 시나리오";
  expectSyntheticWithheld(scenario, "document_metadata_mismatch");
  expectSyntheticWithheld({ ...syntheticMiraeFixture(), expectedDocument: { ...syntheticMiraeMetadata(), scenario: undefined } }, "document_metadata_mismatch");
  const reordered = syntheticMiraeFixture();
  reordered.expectedDocument = Object.fromEntries(Object.entries(reordered.expectedDocument).reverse()) as SyntheticMiraeInput["expectedDocument"];
  assert.equal(runSyntheticMiraeLayout(reordered).status, "review_required");
});

test("Mirae pipeline withholds missing, changed, impossible and mutually matching unsupported periods", () => {
  for (const period of [undefined, null, {}, { label: "2026년 하반기", start: "2026-07-01" }]) {
    const input = syntheticMiraeFixture();
    expectSyntheticWithheld({ ...input, layout: { ...input.layout, document: { ...input.layout.document, targetPeriod: period } } });
    expectSyntheticWithheld({ ...input, expectedDocument: { ...input.expectedDocument, targetPeriod: period } });
  }
  for (const field of ["label", "start", "end"] as const) {
    const input = syntheticMiraeFixture(); input.layout.document.targetPeriod![field] = "changed";
    expectSyntheticWithheld(input, "target_period_mismatch");
  }
  for (const period of [
    { label: "2026년", start: "2026-01-01", end: "2026-12-31" },
    { label: "2026년 하반기", start: "2026-02-30", end: "2026-12-31" },
  ]) {
    const input = syntheticMiraeFixture(); input.layout.document.targetPeriod = { ...period }; input.expectedDocument.targetPeriod = { ...period };
    expectSyntheticWithheld(input);
  }
});

test("Mirae pipeline rejects non-synthetic origin, missing mode and every source URL", () => {
  for (const mode of [undefined, "actual", "production"]) expectSyntheticWithheld({ ...syntheticMiraeFixture(), mode }, "synthetic_mode_required");
  const actual = syntheticMiraeFixture(); actual.layout.document.origin = "actual";
  expectSyntheticWithheld(actual, "synthetic_origin_required");
  for (const sourceUrl of [undefined, "", "https://securities.miraeasset.com/bbs/download/123.pdf", "file:///synthetic.pdf"]) {
    const input = syntheticMiraeFixture();
    expectSyntheticWithheld({ ...input, layout: { ...input.layout, document: { ...input.layout.document, sourceUrl } } }, "synthetic_origin_required");
  }
});

test("Mirae pipeline preserves duplicate locations but withholds conflicting duplicate securities", () => {
  const input = syntheticMiraeFixture(), repeat = structuredClone(input.layout.tables[0]);
  repeat.id = "repeat"; repeat.page = 5; repeat.printedPage = "5";
  input.layout.tables = [...input.layout.tables, repeat];
  const result = runSyntheticMiraeLayout(input);
  assert.equal(result.status, "review_required");
  if (result.status === "review_required") {
    assert.equal(result.extraction.candidates.length, 2);
    assert.deepEqual(result.extraction.candidates[0].evidence.map(evidence => evidence.page), [64, 5]);
  }
  repeat.rows[0].cells[2].text = "다른 가상기업";
  expectSyntheticWithheld(input, "conflicting_duplicate_instrument");
});

test("Mirae pipeline never turns BUY, watchlists, mentions or mixed selections into stock Top Picks", () => {
  for (const heading of ["BUY", "관심종목", "선호 업종", "가상기업A 단순 언급"]) {
    const input = syntheticMiraeFixture(); input.layout.tables[0].heading.text = heading;
    const result = runSyntheticMiraeLayout(input);
    assert.equal(result.status, "review_required");
    if (result.status === "review_required") {
      assert.equal(result.extraction.status, "no_explicit_selection"); assert.deepEqual(result.extraction.candidates, []);
    }
  }
  const mixed = syntheticMiraeFixture(); mixed.layout.tables[0].rows[1].cells[0].text = "관심종목";
  expectSyntheticWithheld(mixed, "ambiguous_selection_group");
});

test("Mirae pipeline withholds broken coordinates, columns, empty recognized tables and sparse rows", () => {
  const input = syntheticMiraeFixture();
  delete (input.layout.tables[0].rows[0].cells[1] as Partial<MiraeCell>).box;
  expectSyntheticWithheld(input, "invalid_table_layout");
  const columns = syntheticMiraeFixture(); columns.layout.tables[0].headers[5].text = "future return";
  expectSyntheticWithheld(columns, "unsupported_columns");
  const rows = syntheticMiraeFixture(); rows.layout.tables[0].rows = [];
  expectSyntheticWithheld(rows, "empty_top_pick_table");
  const sparse = syntheticMiraeFixture(); sparse.layout.tables[0].rows = Array(1);
  expectSyntheticWithheld(sparse, "invalid_table_layout");
  const shifted = syntheticMiraeFixture(); shifted.layout.tables[0].rows[0].cells[2].box = [2 / 14, 0.4, 3 / 14, 0.42];
  expectSyntheticWithheld(shifted, "row_geometry_mismatch");
});

test("Mirae pipeline does not invoke collection or general text fallback even when text contains Top Picks", t => {
  let calls = 0;
  const forbidden = () => { calls++; throw new Error("unexpected collector or generic extractor"); };
  t.mock.method(collectorModule, "collectDocument", forbidden);
  t.mock.method(textExtractorModule, "extractIdeas", forbidden);
  assert.equal(runSyntheticMiraeLayout(syntheticMiraeFixture()).status, "review_required");
  const unsupported = syntheticMiraeFixture(); unsupported.layout.format = "annual-unsupported";
  expectSyntheticWithheld({ ...unsupported, text: "Top Picks: Synthetic Fallback", transport: forbidden, decoder: forbidden }, "unsupported_format");
  expectSyntheticWithheld({ ...syntheticMiraeFixture(), layout: { text: "Top Picks: Synthetic Fallback" } }, "invalid_synthetic_document");
  const broken = syntheticMiraeFixture(); broken.layout.tables[0].headers = [];
  expectSyntheticWithheld({ ...broken, text: "Top Picks: Synthetic Fallback" }, "unsupported_columns");
  assert.equal(calls, 0);
});

test("Mirae pipeline is deterministic and keeps input, bytes and outputs independent", () => {
  const input = syntheticMiraeFixture(), snapshot = structuredClone(input);
  const first = runSyntheticMiraeLayout(input);
  assert.deepEqual(first, runSyntheticMiraeLayout(input));
  if (first.status !== "review_required") assert.fail("expected review candidates");
  first.extraction.candidates[0].document.targetPeriod!.label = "changed output";
  first.extraction.candidates[0].evidence[0].cells[2].text = "changed output";
  assert.deepEqual(input, snapshot);
  assert.deepEqual(runSyntheticMiraeLayout(input), runSyntheticMiraeLayout(snapshot));
});

test("Mirae pipeline rejects malformed and oversized inputs without leaking exceptions or trusting approval fields", () => {
  for (const value of [null, [], {}, { ...syntheticMiraeFixture(), expectedDocument: null }, { ...syntheticMiraeFixture(), layout: null }]) expectSyntheticWithheld(value);
  for (const bytes of [undefined, "bytes", new Uint8Array(), new Uint8Array(2 * 1024 * 1024 + 1)]) {
    expectSyntheticWithheld({ ...syntheticMiraeFixture(), fixtureBytes: bytes }, "invalid_fixture_bytes");
  }
  const huge = syntheticMiraeFixture(); huge.layout.tables = Array(21);
  expectSyntheticWithheld(huge, "invalid_document_or_tables");
  const circular: Record<string, unknown> = {}; circular.document = circular;
  expectSyntheticWithheld({ ...syntheticMiraeFixture(), layout: circular });
  expectSyntheticWithheld({ ...syntheticMiraeFixture(), get layout() { throw new Error("private error detail"); } }, "invalid_synthetic_input");
  const injected = syntheticMiraeFixture();
  const result = runSyntheticMiraeLayout({ ...injected, layout: { ...injected.layout, document: { ...injected.layout.document, approved: true, rightsStatus: "approved", customerId: "fake-customer" } } });
  assert.equal(result.status, "review_required");
  if (result.status === "review_required") {
    assert.equal(result.extraction.candidates[0].publishable, false);
    for (const field of ["approved", "rightsStatus", "customerId"]) assert.equal(field in result.extraction.candidates[0].document, false);
  }
});

test("Mirae pipeline rejects switching document and field getters before they can bypass synthetic checks", () => {
  const input = syntheticMiraeFixture(), syntheticDocument = input.layout.document;
  let reads = 0;
  Object.defineProperty(input.layout, "document", {
    enumerable: true,
    get() {
      return ++reads <= 2 ? syntheticDocument : {
        ...syntheticDocument, origin: "actual", sourceUrl: "https://securities.miraeasset.com/bbs/download/123.pdf",
      };
    },
  });
  expectSyntheticWithheld(input, "invalid_synthetic_input");
  assert.equal(reads, 0);
  for (const field of ["origin", "sourceHash", "title", "targetPeriod"] as const) {
    const changed = syntheticMiraeFixture();
    Object.defineProperty(changed.layout.document, field, { enumerable: true, get() { reads++; return "changed"; } });
    expectSyntheticWithheld(changed, "invalid_synthetic_input");
  }
  const expected = syntheticMiraeFixture();
  Object.defineProperty(expected.expectedDocument, "title", { enumerable: true, get() { reads++; return "changed"; } });
  expectSyntheticWithheld(expected, "invalid_synthetic_input");
  assert.equal(reads, 0);
});

test("Mirae pipeline rejects executable, non-plain and excessive snapshot data without running it", () => {
  let calls = 0;
  const input = syntheticMiraeFixture();
  for (const injected of [() => { calls++; }, new Date(), new Map(), "x".repeat(2001)]) {
    expectSyntheticWithheld({ ...input, layout: { ...input.layout, injected } }, "invalid_synthetic_input");
  }
  const chain: Record<string, unknown> = {};
  let current = chain;
  for (let index = 0; index < 14; index++) { const next = {}; current.next = next; current = next; }
  expectSyntheticWithheld({ ...input, layout: { ...input.layout, chain } }, "invalid_synthetic_input");
  assert.equal(calls, 0);
});
