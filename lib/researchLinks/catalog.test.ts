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
  assert.equal(filterResearchSources(" ＣＭＩＲ ", "independent")[0]?.id, "cmir");
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

test("requested removals do not remove ValueFinder or other existing destinations", () => {
  for (const id of ["value-research", "fs-research"]) assert.equal(RESEARCH_SOURCES.some(source => source.id === id), false);
  assert.equal(filterResearchSources("FS리서치", "all").length, 0);
  assert.equal(RESEARCH_SOURCES.some(source => source.name === "밸류리서치"), false);
  const preserved: Record<string, string> = {
    growth: "https://www.growthresearch.co.kr/report",
    arum: "https://researcharum.com/report/small-cap-research-list.php",
    valuefinder: "https://contents.premium.naver.com/valuefinder/valuesmallcap",
    kirs: "https://www.kirs.or.kr/",
    daol: "https://www.daolsecurities.com/research/article/common.jspx?rGubun=I01&sctrGubun=I07&web=0",
    heungkuk: "https://www.heungkuksec.co.kr/research/company/list.do?key=300",
    hanyang: "https://www.hygood.co.kr/board/researchAnalyzeCompany/list",
    "krx-kosdaq": "https://kosdaqglobal.krx.co.kr/02/02040000/KGS02040100.jsp",
  };
  for (const [id, url] of Object.entries(preserved)) assert.equal(getResearchSourceHref(RESEARCH_SOURCES.find(source => source.id === id)!), url);
});

test("only the eleven checked screenshot providers are added with exact destinations", () => {
  const additions = [
    ["morningstar", "모닝스타", "https://www.morningstar.com/company"],
    ["buffett", "버핏연구소", "https://buffettlab.co.kr/"],
    ["bulit", "불릿", "https://bulit.io/plus"],
    ["smallinsight", "스몰인사이트리서치", "https://t.me/s/smallinsightresearch"],
    ["stunningvalue", "스터닝밸류리서치", "https://t.me/s/stunningvalue"],
    ["aris", "아리스", "https://t.me/s/aris1031"],
    ["glresearch", "지엘리서치", "https://t.me/s/valjuman"],
    ["konnect", "코넥트", "https://index.konnect-ai.net/about"],
    ["finlit", "핀릿", "https://finlit.tovstock.com/"],
    ["cmir", "CMIR", "https://www.cmir.co.kr/"],
    ["hsacademy", "HS아카데미", "https://www.hs-academy.kr/"],
  ];
  assert.equal(RESEARCH_SOURCES.length, 19);
  assert.equal(new Set(RESEARCH_SOURCES.map(source => source.url)).size, RESEARCH_SOURCES.length);
  for (const [id, name, url] of additions) {
    const source = RESEARCH_SOURCES.find(entry => entry.id === id)!;
    assert.equal(source.name, name);
    assert.equal(source.verifiedOn, "2026-09-07");
    assert.equal(getResearchSourceHref(source), url);
    assert.equal(getResearchSourceHref({ ...source, name: "unverified-publisher" }), null);
    assert.equal(getResearchSourceHref({ ...source, url: url + "?redirect=unreviewed" }), null);
  }
});

test("unresolved screenshot providers are not given guessed links or duplicated institutions", () => {
  for (const name of ["브라이어스 인사이트", "아이브이리서치", "에이알씨리서치", "CTT리서치"]) {
    assert.equal(RESEARCH_SOURCES.some(source => source.name === name), false);
  }
  assert.equal(RESEARCH_SOURCES.filter(source => source.name === "한국IR협의회").length, 1);
  for (const id of ["smallinsight", "stunningvalue", "aris", "glresearch"]) {
    const source = RESEARCH_SOURCES.find(entry => entry.id === id)!;
    assert.match(source.description, /채널/);
    assert.equal(new URL(source.url!).host, "t.me");
  }
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
