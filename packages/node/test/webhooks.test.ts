import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { constructEvent, VendorvalError, type WebhookEvent } from "../src/index.js";

const SECRET = "whsec_per_monitor_secret";

// A delivery exactly as the API sends it: the body is the JSON string, the
// signature is HMAC-SHA256 over "<timestamp>.<body>", hex, prefixed "sha256=".
const EVENT = {
  event: "monitoring.changes_detected",
  created_at: "2026-10-09T12:00:00.000Z",
  data: {
    monitor_id: "mon_01J9ZK",
    entity_id: "ent_sam_lyhwaqba7q15",
    changes: [
      {
        event_type: "status_changed",
        field_path: "sam_registration.status",
        previous_value: "pass",
        new_value: "fail",
        detected_at: "2026-10-09T11:59:58.000Z",
      },
    ],
    verification_id: "ver_01J9ZK",
  },
};

function deliver(body: string, opts: { secret?: string; timestamp?: number } = {}) {
  const timestamp = String(opts.timestamp ?? Math.floor(Date.now() / 1000));
  const hex = createHmac("sha256", opts.secret ?? SECRET).update(`${timestamp}.${body}`).digest("hex");
  return {
    body,
    timestamp,
    headers: {
      "content-type": "application/json",
      "x-etp-signature": `sha256=${hex}`,
      "x-etp-timestamp": timestamp,
      "x-etp-delivery-id": "dlv_evt_0001",
      "x-etp-event": "monitoring.changes_detected",
    } as Record<string, string>,
  };
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(VendorvalError);
    return (err as VendorvalError).code ?? undefined;
  }
  return undefined;
}

describe("constructEvent", () => {
  it("verifies a real delivery and returns the parsed event", () => {
    const d = deliver(JSON.stringify(EVENT));
    const event: WebhookEvent = constructEvent(d.body, d.headers, SECRET);
    expect(event).toEqual(EVENT);
    if (event.event === "monitoring.changes_detected") {
      expect(event.data.monitor_id).toBe("mon_01J9ZK");
    }
  });

  it("accepts a Buffer body and a Fetch Headers object", () => {
    const d = deliver(JSON.stringify(EVENT));
    const event = constructEvent(Buffer.from(d.body), new Headers(d.headers), SECRET);
    expect(event.event).toBe("monitoring.changes_detected");
  });

  it("reads headers case-insensitively from a plain record", () => {
    const d = deliver(JSON.stringify(EVENT));
    const headers = {
      "X-ETP-Signature": d.headers["x-etp-signature"]!,
      "X-ETP-Timestamp": d.headers["x-etp-timestamp"]!,
    };
    expect(constructEvent(d.body, headers, SECRET).event).toBe("monitoring.changes_detected");
  });

  it("verifies over the raw bytes, not re-serialized JSON", () => {
    // Pretty-printed body: re-stringifying would produce different bytes.
    const d = deliver(JSON.stringify(EVENT, null, 2));
    expect(constructEvent(d.body, d.headers, SECRET)).toEqual(EVENT);
    expect(codeOf(() => constructEvent(JSON.stringify(EVENT), d.headers, SECRET))).toBe("signature_mismatch");
  });

  it("rejects a delivery signed with a different secret", () => {
    const d = deliver(JSON.stringify(EVENT), { secret: "some-other-monitor" });
    expect(codeOf(() => constructEvent(d.body, d.headers, SECRET))).toBe("signature_mismatch");
  });

  it("rejects a tampered body", () => {
    const d = deliver(JSON.stringify(EVENT));
    const tampered = d.body.replace("fail", "pass");
    expect(codeOf(() => constructEvent(tampered, d.headers, SECRET))).toBe("signature_mismatch");
  });

  it("rejects a replayed timestamp: the signature covers the timestamp", () => {
    const d = deliver(JSON.stringify(EVENT));
    const headers = { ...d.headers, "x-etp-timestamp": String(Number(d.timestamp) + 1) };
    expect(codeOf(() => constructEvent(d.body, headers, SECRET))).toBe("signature_mismatch");
  });

  it("rejects deliveries outside the tolerance window, in either direction", () => {
    const now = 1_800_000_000;
    const old = deliver(JSON.stringify(EVENT), { timestamp: now - 301 });
    expect(codeOf(() => constructEvent(old.body, old.headers, SECRET, { now }))).toBe("timestamp_out_of_range");
    const future = deliver(JSON.stringify(EVENT), { timestamp: now + 301 });
    expect(codeOf(() => constructEvent(future.body, future.headers, SECRET, { now }))).toBe("timestamp_out_of_range");
    const edge = deliver(JSON.stringify(EVENT), { timestamp: now - 300 });
    expect(constructEvent(edge.body, edge.headers, SECRET, { now }).event).toBe("monitoring.changes_detected");
  });

  it("honors a custom tolerance", () => {
    const now = 1_800_000_000;
    const d = deliver(JSON.stringify(EVENT), { timestamp: now - 30 });
    expect(codeOf(() => constructEvent(d.body, d.headers, SECRET, { now, tolerance: 10 }))).toBe(
      "timestamp_out_of_range",
    );
  });

  it("throws on a tolerance or clock that would disable the replay check", () => {
    const d = deliver(JSON.stringify(EVENT), { timestamp: 1 });
    for (const options of [{ tolerance: Number.NaN }, { tolerance: Infinity }, { tolerance: -1 }, { now: Number.NaN }]) {
      expect(() => constructEvent(d.body, d.headers, SECRET, options)).toThrow(TypeError);
    }
  });

  it("names the missing or malformed header", () => {
    const d = deliver(JSON.stringify(EVENT));
    const { "x-etp-signature": _sig, ...noSig } = d.headers;
    expect(codeOf(() => constructEvent(d.body, noSig, SECRET))).toBe("missing_signature_header");
    const { "x-etp-timestamp": _ts, ...noTs } = d.headers;
    expect(codeOf(() => constructEvent(d.body, noTs, SECRET))).toBe("missing_timestamp_header");
    // The old `t=…,v1=…` format is not what the API sends.
    const legacy = { ...d.headers, "x-etp-signature": `t=${d.timestamp},v1=abc` };
    expect(codeOf(() => constructEvent(d.body, legacy, SECRET))).toBe("invalid_signature_header");
    const badTs = { ...d.headers, "x-etp-timestamp": "2026-10-09T12:00:00Z" };
    expect(codeOf(() => constructEvent(d.body, badTs, SECRET))).toBe("invalid_timestamp");
  });

  it("requires a secret", () => {
    const d = deliver(JSON.stringify(EVENT));
    expect(codeOf(() => constructEvent(d.body, d.headers, ""))).toBe("missing_secret");
  });

  it("rejects a correctly signed body that is not JSON", () => {
    const d = deliver("not json");
    expect(codeOf(() => constructEvent(d.body, d.headers, SECRET))).toBe("invalid_payload");
  });
});
