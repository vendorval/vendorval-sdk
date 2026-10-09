import { createServer } from "node:http";
import { WEBHOOK_DELIVERY_ID_HEADER, constructEvent } from "vendorval-sdk";

// Each monitor has its own signing secret, returned once by
// `client.monitors.create()` (or `client.monitors.rotateSecret()`).
// This example reads them from the environment:
//   VENDORVAL_WEBHOOK_SECRETS='{"<monitor id>":"<webhook_secret>", ...}'
// A real handler would look them up in its own datastore.
let SECRETS;
try {
  SECRETS = JSON.parse(process.env.VENDORVAL_WEBHOOK_SECRETS ?? "{}");
} catch {
  console.error("VENDORVAL_WEBHOOK_SECRETS must be a JSON object of monitor id -> secret.");
  process.exit(1);
}
if (Object.keys(SECRETS).length === 0) {
  console.error("Set VENDORVAL_WEBHOOK_SECRETS before starting the server.");
  process.exit(1);
}

const MAX_BYTES = 1024 * 1024; // 1MB cap on webhook bodies; reject anything larger.

// Deliveries are at-least-once and retries reuse the delivery id, so remember
// the ids already handled. Keep this in durable storage in production.
const seen = new Set();

/**
 * The monitor id is read from the body before the signature is checked, only
 * to choose which secret to verify with. Nothing else in the body is used
 * until constructEvent() has verified it.
 */
function secretFor(body) {
  try {
    const monitorId = JSON.parse(body.toString("utf8"))?.data?.monitor_id;
    return typeof monitorId === "string" ? SECRETS[monitorId] : undefined;
  } catch {
    return undefined;
  }
}

const server = createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/webhook") {
    res.statusCode = 404;
    res.end();
    return;
  }
  const chunks = [];
  let total = 0;
  let aborted = false;
  req.on("data", (c) => {
    if (aborted) return;
    total += c.length;
    if (total > MAX_BYTES) {
      aborted = true;
      res.statusCode = 413;
      res.end("payload too large");
      req.destroy();
      return;
    }
    chunks.push(c);
  });
  req.on("end", () => {
    if (aborted) return;
    // Verify the exact bytes received. Re-serializing parsed JSON would
    // change them and the signature would not match.
    const body = Buffer.concat(chunks);
    const secret = secretFor(body);
    if (!secret) {
      res.statusCode = 400;
      res.end("unknown monitor");
      return;
    }
    let event;
    try {
      event = constructEvent(body, req.headers, secret);
    } catch (err) {
      console.error("invalid webhook:", err.code ?? err);
      res.statusCode = 400;
      res.end("invalid");
      return;
    }

    const deliveryId = req.headers[WEBHOOK_DELIVERY_ID_HEADER];
    if (typeof deliveryId === "string" && seen.has(deliveryId)) {
      res.statusCode = 200;
      res.end("duplicate");
      return;
    }
    if (typeof deliveryId === "string") seen.add(deliveryId);

    if (event.event === "monitoring.changes_detected") {
      for (const change of event.data.changes) {
        console.log(
          `monitor ${event.data.monitor_id}: ${change.event_type}`,
          change.field_path ?? "",
          change.previous_value,
          "->",
          change.new_value,
        );
      }
    } else {
      console.log("received event", event.event);
    }
    res.statusCode = 200;
    res.end("ok");
  });
});

server.listen(8787, () => {
  console.log("listening on http://localhost:8787/webhook");
});
