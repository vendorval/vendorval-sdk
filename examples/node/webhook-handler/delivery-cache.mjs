import { createHash } from "node:crypto";

// Call only after signature verification; record only after handling succeeds.
export class DeliveryCache {
  signatures = new Set();
  deliveries = new Map();

  isDuplicate(signature, deliveryId, body) {
    const normalized = signature.trim().toLowerCase();
    if (this.signatures.has(normalized)) return true;
    const digest = createHash("sha256").update(body).digest("hex");
    if (this.deliveries.get(deliveryId)?.has(digest)) {
      // A retry counts as handled only when its authenticated body also matches.
      this.signatures.add(normalized);
      return true;
    }
    return false;
  }

  record(signature, deliveryId, body) {
    this.signatures.add(signature.trim().toLowerCase());
    if (typeof deliveryId === "string") {
      const digests = this.deliveries.get(deliveryId) ?? new Set();
      digests.add(createHash("sha256").update(body).digest("hex"));
      this.deliveries.set(deliveryId, digests);
    }
  }
}
