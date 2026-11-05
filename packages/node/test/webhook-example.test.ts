import { describe, expect, it } from "vitest";

const { DeliveryCache } = await import(new URL(
  "../../../examples/node/webhook-handler/delivery-cache.mjs", import.meta.url,
).href);

describe("webhook example delivery cache", () => {
  it("does not let an unsigned ID suppress or poison a different authenticated payload", () => {
    const cache = new DeliveryCache();
    cache.record("sha256=aaa", "delivery-a", Buffer.from("payload-a"));
    expect(cache.isDuplicate("sha256=bbb", "delivery-a", Buffer.from("payload-b"))).toBe(false);
    // The genuine delivery B is still eligible after a failed or unhandled forged-ID copy.
    expect(cache.isDuplicate("sha256=bbb", "delivery-b", Buffer.from("payload-b"))).toBe(false);
  });

  it("recognizes a re-signed retry and its subsequent altered-ID replay", () => {
    const cache = new DeliveryCache();
    const body = Buffer.from("payload-a");
    cache.record("sha256=aaa", "delivery-a", body);
    expect(cache.isDuplicate("sha256=bbb", "delivery-a", body)).toBe(true);
    expect(cache.isDuplicate("SHA256=BBB", "changed-id", body)).toBe(true);
  });

  it("does not bind an unseen ID when an already-processed signature is replayed", () => {
    const cache = new DeliveryCache();
    cache.record("sha256=aaa", "delivery-a", Buffer.from("payload-a"));
    expect(cache.isDuplicate("sha256=aaa", "delivery-b", Buffer.from("payload-a"))).toBe(true);
    expect(cache.isDuplicate("sha256=bbb", "delivery-b", Buffer.from("payload-b"))).toBe(false);
  });

  it("records only completed handling", () => {
    const cache = new DeliveryCache();
    const body = Buffer.from("payload-a");
    expect(cache.isDuplicate("sha256=aaa", undefined, body)).toBe(false);
    expect(cache.isDuplicate("sha256=aaa", undefined, body)).toBe(false);
    cache.record("sha256=aaa", undefined, body);
    expect(cache.isDuplicate("SHA256=AAA", undefined, body)).toBe(true);
  });
});
