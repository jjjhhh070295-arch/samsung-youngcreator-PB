import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  previewBriefingText,
  selectTodaysBriefing,
  type BriefingListItem,
} from "./MarketHomeMorningBriefing";

const sample = (date: string, headline: string): BriefingListItem => ({
  id: `id-${date}`,
  report_date: date,
  headline,
  text_body: `${headline} 본문입니다.`,
});

describe("MarketHomeMorningBriefing helpers", () => {
  it("selects only the exact KST today report", () => {
    const today = "2026-09-10";
    const list = [
      sample("2026-09-10", "오늘 헤드라인"),
      sample("2026-09-09", "어제 헤드라인"),
      sample("2026-09-08", "그제 헤드라인"),
    ];
    const picked = selectTodaysBriefing(list, today);
    assert.ok(picked);
    assert.equal(picked!.headline, "오늘 헤드라인");
    assert.equal(picked!.report_date, today);
  });

  it("does not fall back to the latest older report when today is missing", () => {
    const list = [sample("2026-09-09", "어제"), sample("2026-09-08", "그제")];
    assert.equal(selectTodaysBriefing(list, "2026-09-10"), null);
  });

  it("flattens text_body for a safe compact preview without HTML", () => {
    const preview = previewBriefingText("첫 줄\n\n둘째 줄   공백", 20);
    assert.equal(preview.includes("<"), false);
    assert.ok(preview.startsWith("첫 줄 둘째 줄"));
    assert.ok(preview.length <= 21); // 20 + ellipsis possible
  });
});
