import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatKstTodoHeader, todayKstDate } from "./pbScheduleStorage";

describe("pbScheduleStorage date helpers", () => {
  it("formats today in KST as YYYY-MM-DD", () => {
    const date = todayKstDate(new Date("2026-09-01T02:30:00.000Z"));
    assert.equal(date, "2026-09-01");
  });

  it("builds Korean todo header with weekday", () => {
    const header = formatKstTodoHeader("2026-09-01");
    assert.match(header, /2026/);
    assert.match(header, /해야 할 일/);
  });
});
