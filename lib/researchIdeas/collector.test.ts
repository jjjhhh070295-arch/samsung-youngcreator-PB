import assert from "node:assert/strict";
import { test } from "node:test";
import { collectDocument, type CollectionGrant } from "./collector";

const NOW = "2026-09-07T03:00:00.000Z";
const URL = "https://research.example/reports/monthly.html";
const GRANT: CollectionGrant = {
  providerId: "synthetic-provider", allowedOrigins: ["https://research.example"],
  allowedPathPrefixes: ["/reports"], fetchAllowed: true, extractAllowed: true,
  displayAllowed: true, approvalReference: "SYNTHETIC-APPROVAL-ONLY",
  expiresAt: "2026-10-01T00:00:00.000Z",
};
const encode = (value: string) => new TextEncoder().encode(value);
const fake = (run: (url: string, init?: RequestInit) => Response | Promise<Response>): typeof fetch =>
  ((url, init) => Promise.resolve(run(String(url), init))) as typeof fetch;
const html = () => new Response("<html>synthetic only</html>", { headers: { "Content-Type": "text/html; charset=utf-8" } });

test("collects HTML with fixed safe request options and no ambient fetch", async () => {
  let calls = 0;
  const result = await collectDocument({ url: URL, grant: GRANT, now: NOW }, fake((url, init) => {
    calls += 1;
    assert.equal(url, URL);
    assert.equal(init?.method, "GET");
    assert.equal(init?.redirect, "error");
    assert.equal(init?.credentials, "omit");
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.referrerPolicy, "no-referrer");
    assert.ok(init?.signal instanceof AbortSignal);
    assert.deepEqual(init?.headers, { Accept: "application/pdf, text/html" });
    return html();
  }));
  assert.equal(calls, 1);
  assert.equal(result.status, "collected");
  if (result.status === "collected") {
    assert.equal(result.contentType, "html");
    assert.equal(result.fetchedAt, NOW);
    assert.equal(result.sourceUrl, URL);
    assert.equal(new TextDecoder().decode(result.bytes), "<html>synthetic only</html>");
  }
});

test("collects PDF bytes and strips fragment without following any link", async () => {
  const result = await collectDocument({ url: `${URL}#page=2`, grant: GRANT, now: NOW }, fake(() =>
    new Response(encode("%PDF-1.7 synthetic"), { headers: { "Content-Type": "application/pdf" } })));
  assert.equal(result.status, "collected");
  if (result.status === "collected") { assert.equal(result.contentType, "pdf"); assert.equal(result.sourceUrl, URL); }
});

test("unconfirmed rights, missing approval, invalid clock or expiry never reach transport", async () => {
  const transport = fake(() => { assert.fail("transport must not run"); });
  const grants: CollectionGrant[] = [
    { ...GRANT, fetchAllowed: false }, { ...GRANT, extractAllowed: false },
    { ...GRANT, displayAllowed: false }, { ...GRANT, approvalReference: null },
    { ...GRANT, approvalReference: " " }, { ...GRANT, providerId: "" },
    { ...GRANT, expiresAt: null }, { ...GRANT, expiresAt: NOW },
    { ...GRANT, expiresAt: "2026-09-06T00:00:00Z" },
    { ...GRANT, expiresAt: "2026-02-30T00:00:00Z" },
  ];
  for (const grant of grants) assert.equal((await collectDocument({ url: URL, grant, now: NOW }, transport)).status, "withheld");
  for (const now of ["bad", "2026-09-07", "2026-02-30T00:00:00Z"]) {
    assert.deepEqual(await collectDocument({ url: URL, grant: GRANT, now }, transport), { status: "withheld", reason: "invalid_now" });
  }
});

test("rejects unsafe schemes, credentials, ports, local addresses, origins and prefix tricks before transport", async () => {
  const transport = fake(() => { assert.fail("unsafe URL requested"); });
  const unsafe = [
    "http://research.example/reports/a", "file:///reports/a", "https://user:pass@research.example/reports/a",
    "https://research.example:443/reports/a", "https://research.example:8080/reports/a",
    "https://research.example.attacker.example/reports/a", "https://evil.example/reports/a",
    "https://research.example/reportsevil/a", "https://research.example/reports/../private/a",
    "https://research.example/reports/%2e%2e/private/a", "https://research.example/reports/%252e%252e/private/a",
    "https://research.example/reports/%25252e%25252e/private/a", "https://research.example/reports/%5cprivate",
    "https://research.example/reports/%2fprivate", "https://research.example/reports/%00bad",
    "https://research.example/reports/%zz", " https://research.example/reports/a",
    "https://research.example/reports/a\nb", "https://research.example./reports/a",
  ];
  for (const url of unsafe) assert.deepEqual(await collectDocument({ url, grant: GRANT, now: NOW }, transport), { status: "withheld", reason: "url_not_allowed" }, url);
  for (const host of ["localhost", "pb.localhost", "pb.local", "db.internal", "127.0.0.1", "2130706433", "0x7f000001", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "[::1]", "[::ffff:127.0.0.1]", "[fc00::1]"]) {
    const origin = `https://${host}`;
    assert.equal((await collectDocument({ url: `${origin}/reports/a`, grant: { ...GRANT, allowedOrigins: [origin] }, now: NOW }, transport)).status, "withheld", host);
  }
});

test("valid decoded Unicode path accepted, malformed grant prefixes and non-origin entries denied", async () => {
  assert.equal((await collectDocument({ url: "https://research.example/reports/%ED%95%9C%EA%B5%AD.pdf", grant: GRANT, now: NOW }, fake(html))).status, "collected");
  for (const grant of [
    { ...GRANT, allowedPathPrefixes: ["/reports/../"] },
    { ...GRANT, allowedPathPrefixes: ["/reports%2f"] },
    { ...GRANT, allowedOrigins: ["https://research.example/private"] },
    { ...GRANT, allowedOrigins: ["https://research.example?api_key=fake"] },
  ]) assert.equal((await collectDocument({ url: URL, grant, now: NOW }, fake(() => { assert.fail("invalid grant requested"); }))).status, "withheld");
});

test("rejects non-2xx, redirected replies and unsupported content types without reading content", async () => {
  for (const status of [301, 401, 403, 404, 429, 500]) {
    assert.deepEqual(await collectDocument({ url: URL, grant: GRANT, now: NOW }, fake(() => new Response("fake", { status, headers: { "Content-Type": "text/html" } }))), { status: "failed", reason: "http_error" });
  }
  for (const mime of ["application/json", "image/svg+xml", "application/octet-stream", "text/plain", ""]) {
    assert.deepEqual(await collectDocument({ url: URL, grant: GRANT, now: NOW }, fake(() => new Response("fake", { headers: { "Content-Type": mime } }))), { status: "failed", reason: "unsupported_content_type" });
  }
  const redirected = html();
  Object.defineProperty(redirected, "redirected", { value: true });
  assert.deepEqual(await collectDocument({ url: URL, grant: GRANT, now: NOW }, fake(() => redirected)), { status: "failed", reason: "redirect_rejected" });
  const changedUrl = html();
  Object.defineProperty(changedUrl, "url", { value: "https://private.example/reports/a" });
  assert.equal((await collectDocument({ url: URL, grant: GRANT, now: NOW }, fake(() => changedUrl))).status, "failed");
});

test("enforces 2 MiB stream limit even with absent or dishonest length and cancels stream", async () => {
  for (const length of [undefined, "1"]) {
    let canceled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024)); controller.enqueue(new Uint8Array(1)); },
      cancel() { canceled = true; },
    });
    const headers: Record<string, string> = { "Content-Type": "application/pdf" };
    if (length !== undefined) headers["Content-Length"] = length;
    assert.deepEqual(await collectDocument({ url: URL, grant: GRANT, now: NOW }, fake(() => new Response(stream, { headers }))), { status: "failed", reason: "body_too_large" });
    assert.equal(canceled, true);
  }
  const boundary = await collectDocument({ url: URL, grant: GRANT, now: NOW }, fake(() => new Response(new Uint8Array(2 * 1024 * 1024), { headers: { "Content-Type": "application/pdf" } })));
  assert.equal(boundary.status, "collected");
});

test("rejects oversized or malformed declared size before stream consumption and cancels", async () => {
  for (const length of ["2097153", "-1", "1,2", "not-a-number", "999999999999999999999999999999"]) {
    let canceled = false;
    const stream = new ReadableStream<Uint8Array>({ cancel() { canceled = true; } });
    assert.deepEqual(await collectDocument({ url: URL, grant: GRANT, now: NOW }, fake(() => new Response(stream, { headers: { "Content-Type": "text/html", "Content-Length": length } }))), { status: "failed", reason: "content_length_rejected" });
    assert.equal(canceled, true);
  }
});

test("empty bodies and stream errors fail closed without leaking transport error details", async () => {
  assert.deepEqual(await collectDocument({ url: URL, grant: GRANT, now: NOW }, fake(() => new Response(null, { headers: { "Content-Type": "text/html" } }))), { status: "failed", reason: "empty_body" });
  assert.deepEqual(await collectDocument({ url: URL, grant: GRANT, now: NOW }, fake(() => new Response("", { headers: { "Content-Type": "text/html" } }))), { status: "failed", reason: "empty_body" });
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error("SYNTHETIC_SECRET_DO_NOT_RETURN")); } });
  assert.deepEqual(await collectDocument({ url: URL, grant: GRANT, now: NOW }, fake(() => new Response(stream, { headers: { "Content-Type": "text/html" } }))), { status: "failed", reason: "transport_or_stream_error" });
  assert.deepEqual(await collectDocument({ url: URL, grant: GRANT, now: NOW }, fake(() => { throw new Error("SYNTHETIC_SECRET_DO_NOT_RETURN"); })), { status: "failed", reason: "transport_or_stream_error" });
});

test("10-second deadline aborts a stalled transport, including one ignoring AbortSignal", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let signal: AbortSignal | null | undefined;
  const pending = collectDocument({ url: URL, grant: GRANT, now: NOW }, fake((_url, init) => {
    signal = init?.signal;
    return new Promise<Response>(() => undefined);
  }));
  context.mock.timers.tick(9999);
  assert.equal(signal?.aborted, false);
  context.mock.timers.tick(1);
  assert.equal(signal?.aborted, true);
  assert.deepEqual(await pending, { status: "failed", reason: "timeout" });
});

test("deadline covers body streaming, cancels stalled stream and returns no partial content", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let canceled = false;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(encode("partial")); }, cancel() { canceled = true; } });
  const pending = collectDocument({ url: URL, grant: GRANT, now: NOW }, fake(() => new Response(stream, { headers: { "Content-Type": "text/html" } })));
  await Promise.resolve();
  await Promise.resolve();
  context.mock.timers.tick(10_000);
  assert.deepEqual(await pending, { status: "failed", reason: "timeout" });
  assert.equal(canceled, true);
});
