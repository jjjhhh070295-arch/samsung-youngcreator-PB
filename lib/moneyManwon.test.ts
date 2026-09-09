import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseManwonInput,
  wonToManwonDisplay,
  WON_PER_MANWON,
  isManwonDraftAllowed,
} from "./moneyManwon";

describe("moneyManwon conversion", () => {
  it("round-trips examples exactly", () => {
    assert.equal(wonToManwonDisplay(50_000_000), "5000");
    assert.equal(parseManwonInput("100").ok && (parseManwonInput("100") as any).won, 1_000_000);
    assert.equal(parseManwonInput("0.5").ok && (parseManwonInput("0.5") as any).won, 5_000);
    assert.equal(wonToManwonDisplay(10_001), "1.0001");
    const back = parseManwonInput(wonToManwonDisplay(10_001));
    assert.equal(back.ok && !("empty" in back && back.empty) && back.won, 10_001);
  });

  it("empty is null; zero is explicit zero; commas paste", () => {
    const empty = parseManwonInput("");
    assert.ok(empty.ok && "empty" in empty && empty.empty && empty.won === null);
    const zero = parseManwonInput("0");
    assert.ok(zero.ok && !("empty" in zero && zero.empty) && zero.won === 0);
    const comma = parseManwonInput("1,234.5");
    assert.ok(comma.ok && !("empty" in comma && comma.empty) && comma.won === 12_345_000);
  });

  it("does not scale interest-like percent values when using won helpers", () => {
    // rates stay as percent — callers must not pass them through WON_PER_MANWON
    assert.equal(WON_PER_MANWON, 10_000);
    assert.notEqual(8 * WON_PER_MANWON, 8);
  });

  it("allows intermediate drafts", () => {
    assert.equal(isManwonDraftAllowed(""), true);
    assert.equal(isManwonDraftAllowed("12."), true);
    assert.equal(isManwonDraftAllowed("12.34"), true);
    assert.equal(isManwonDraftAllowed("12.a"), false);
  });
});
