// Call only after signature verification; record only after handling succeeds.
export class DeliveryCache {
  signatures = new Set();
  deliveryIds = new Set();

  isDuplicate(signature, deliveryId, body) {
    void body;
    const normalized = signature.trim().toLowerCase();
    if (this.signatures.has(normalized) || this.deliveryIds.has(deliveryId)) {
      this.signatures.add(normalized);
      return true;
    }
    return false;
  }

  record(signature, deliveryId, body) {
    void body;
    this.signatures.add(signature.trim().toLowerCase());
    if (typeof deliveryId === "string") this.deliveryIds.add(deliveryId);
  }
}
