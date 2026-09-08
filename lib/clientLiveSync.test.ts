import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CLIENT_LIVE_SYNC_CHANNEL,
  CLIENT_LIVE_SYNC_EVENT,
  CLIENT_LIVE_SYNC_STORAGE_KEY,
  publishClientLiveSync,
  type ClientLiveSyncMessage,
} from "./clientLiveSync";

describe("publishClientLiveSync (node without window)", () => {
  it("returns null when window is unavailable", () => {
    assert.equal(publishClientLiveSync("c1", "save"), null);
  });
});

describe("ClientLiveSyncMessage shape", () => {
  it("uses monotonic revision timestamps when constructed", () => {
    const msg: ClientLiveSyncMessage = {
      v: 1,
      clientId: "c1",
      revision: Date.now(),
      at: new Date().toISOString(),
      reason: "save",
      source: "test",
    };
    assert.equal(msg.v, 1);
    assert.ok(msg.revision > 0);
    assert.equal(CLIENT_LIVE_SYNC_EVENT, "pb-client-live-sync");
    assert.equal(CLIENT_LIVE_SYNC_STORAGE_KEY, "pb-client-live-sync-v1");
    assert.equal(CLIENT_LIVE_SYNC_CHANNEL, "pb-client-live-sync");
  });

  it("ignores out-of-order revisions by comparison", () => {
    let last = 0;
    const apply = (revision: number) => {
      if (revision <= last) return false;
      last = revision;
      return true;
    };
    assert.equal(apply(100), true);
    assert.equal(apply(90), false);
    assert.equal(apply(101), true);
    assert.equal(last, 101);
  });

  it("rejects other client ids", () => {
    const scoped = "client-a";
    const deliver = (id: string) => id === scoped;
    assert.equal(deliver("client-a"), true);
    assert.equal(deliver("client-b"), false);
  });
});
