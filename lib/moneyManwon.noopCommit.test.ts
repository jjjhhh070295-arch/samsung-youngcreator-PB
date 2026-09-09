import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseManwonInput, wonToManwonDisplay, formatManwonBlur } from "./moneyManwon";

/** MoneyManwonInput no-op commit gate — same logic as the component. */
function wouldCommit(
  draft: string,
  valueWon: number | null,
  lastCommitted: number | null | undefined,
  allowSigned = false,
): boolean {
  const parsed = parseManwonInput(draft, { allowSigned });
  if (!parsed.ok) return false;
  const next = "empty" in parsed && parsed.empty ? null : parsed.won;
  const same = (a: number | null | undefined, b: number | null | undefined) => {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    return a === b;
  };
  if (same(next, lastCommitted) && same(next, valueWon)) return false;
  return true;
}

describe("MoneyManwonInput no-op commits", () => {
  it("blur with equivalent formatting does not commit", () => {
    const won = 1_000_000;
    const display = wonToManwonDisplay(won);
    assert.equal(wouldCommit(display, won, won), false);
    assert.equal(wouldCommit("100.0000", won, won), false);
    assert.equal(wouldCommit("100", won, won), false);
  });

  it("real change commits once; Enter then blur does not double if lastCommitted updated", () => {
    assert.equal(wouldCommit("200", 1_000_000, 1_000_000), true);
    const after = parseManwonInput("200");
    assert.ok(after.ok && !("empty" in after && after.empty));
    const committed = after.won;
    assert.equal(wouldCommit(formatManwonBlur(committed), committed, committed), false);
  });

  it("empty stays null; explicit zero is a real value", () => {
    assert.equal(wouldCommit("", null, null), false);
    assert.equal(wouldCommit("0", null, null), true);
    assert.equal(wouldCommit("0", 0, 0), false);
  });
});
