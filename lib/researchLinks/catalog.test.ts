import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { filterResearchSources, getResearchSourceHref, RESEARCH_SOURCES, type ResearchSource } from "./catalog";

test("all catalog ids are unique and reviewed URLs are HTTPS without credentials", () => {
  assert.equal(new Set(RESEARCH_SOURCES.map((source) => source.id)).size, RESEARCH_SOURCES.length);
  for (const source of RESEARCH_SOURCES) {
    const href = getResearchSourceHref(source);
    if (source.status === "needs-review") { assert.equal(href, null); continue; }
    assert.ok(href);
    const url = new URL(href);
    assert.equal(url.protocol, "https:");
    assert.equal(url.username + url.password, "");
    assert.match(source.verifiedOn ?? "", /^\d{4}-\d{2}-\d{2}$/);
  }
});

test("unreviewed or modified destinations remain disabled", () => {
  const valid = RESEARCH_SOURCES[0];
  for (const patch of [
    { status: "needs-review" }, { verifiedOn: null }, { url: null },
    { url: "javascript:alert(1)" }, { url: "https://www.growthresearch.co.kr.evil.invalid/report" },
    { url: "https://www.growthresearch.co.kr/report?redirect=https://evil.invalid" },
  ]) assert.equal(getResearchSourceHref({ ...valid, ...patch } as ResearchSource), null);
});

test("name/search/category filters preserve independent versus broker distinction", () => {
  assert.equal(filterResearchSources("  그로쓰  ", "all")[0]?.id, "growth");
  assert.equal(filterResearchSources("ＦＳ", "independent")[0]?.id, "fs-research");
  assert.ok(filterResearchSources("", "broker").every((source) => source.kind === "broker"));
  assert.equal(filterResearchSources("알 수 없는 기관", "all").length, 0);
  assert.equal(filterResearchSources("밸류파인더", "broker").length, 0);
});

test("swapped approved URLs or publisher names fail closed", () => {
  const [growth, arum] = RESEARCH_SOURCES;
  assert.equal(getResearchSourceHref({ ...growth, url: arum.url }), null);
  assert.equal(getResearchSourceHref({ ...arum, url: growth.url }), null);
  assert.equal(getResearchSourceHref({ ...growth, name: arum.name }), null);
  assert.equal(getResearchSourceHref({ ...growth, id: "unapproved-publisher" }), null);
});

test("ambiguous ValueResearch is not confused with ValueFinder", () => {
  const sources = filterResearchSources("밸류", "independent");
  assert.equal(sources.length, 2);
  assert.ok(getResearchSourceHref(sources.find((source) => source.id === "valuefinder")!));
  assert.equal(getResearchSourceHref(sources.find((source) => source.id === "value-research")!), null);
});

test("directory modules do not import auth, customer stores, APIs or background network", () => {
  const root = resolve(__dirname, "../..");
  for (const file of ["lib/researchLinks/catalog.ts", "components/researchLinks/ResearchLinkDirectory.tsx", "app/research-links/page.tsx"]) {
    const source = readFileSync(resolve(root, file), "utf8");
    assert.doesNotMatch(source, /(?:from|import\()\s*["'][^"']*(?:store|auth|supabase|syntheticPreview|localOfficialPreview)/);
    assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|setInterval)\s*\(/);
    assert.doesNotMatch(source, /process\.env|localStorage|sessionStorage|dangerouslySetInnerHTML/);
  }
});

test("external links isolate opener/referrer; directory is additive navigation", () => {
  const root = resolve(__dirname, "../..");
  const component = readFileSync(resolve(root, "components/researchLinks/ResearchLinkDirectory.tsx"), "utf8");
  assert.match(component, /target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"/);
  assert.doesNotMatch(component, /<iframe|<img|<script/);
  const nav = readFileSync(resolve(root, "components/AppNav.tsx"), "utf8");
  assert.equal((nav.match(/key: "research-links"/g) || []).length, 1);
  assert.match(nav, /key: "research", label: "리서치", icon: "📊", href: "\/research"/);
});
