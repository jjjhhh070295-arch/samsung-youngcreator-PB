import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildMonthCalendarDays,
  formatKstDateLabel,
  formatKstTodoHeader,
  kstWeekdayIndex,
  todayKstDate,
} from "./pbScheduleStorage";

describe("pbScheduleStorage date helpers", () => {
  it("formats today in KST as YYYY-MM-DD", () => {
    const date = todayKstDate(new Date("2026-09-01T02:30:00.000Z"));
    assert.equal(date, "2026-09-01");
  });

  it("builds Korean todo header with weekday", () => {
    const header = formatKstTodoHeader("2026-09-01");
    assert.equal(header, "2026.09.01 (화) 해야 할 일");
  });

  it("labels KST weekdays", () => {
    assert.equal(kstWeekdayIndex("2026-09-01"), 2);
    assert.equal(formatKstDateLabel("2026-09-05"), "2026.09.05 (토)");
  });

  it("builds month calendar grid with leading padding", () => {
    const cells = buildMonthCalendarDays(2026, 9);
    assert.equal(cells[0], null);
    assert.equal(cells[1], null);
    assert.equal(cells[2], "2026-09-01");
    assert.equal(cells.at(-1), "2026-09-30");
  });
});
