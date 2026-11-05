"""Call only after signature verification; record after handling succeeds."""

from hashlib import sha256


class DeliveryCache:
    def __init__(self) -> None:
        self.signatures: set[str] = set()
        self.deliveries: dict[str, set[str]] = {}

    def is_duplicate(self, signature: str, delivery_id: str | None, body: bytes) -> bool:
        normalized = signature.strip().lower()
        if normalized in self.signatures:
            return True
        digest = sha256(body).hexdigest()
        if delivery_id is not None and digest in self.deliveries.get(delivery_id, set()):
            # A retry counts as handled only when its authenticated body also matches.
            self.signatures.add(normalized)
            return True
        return False

    def record(self, signature: str, delivery_id: str | None, body: bytes) -> None:
        self.signatures.add(signature.strip().lower())
        if delivery_id is not None:
            self.deliveries.setdefault(delivery_id, set()).add(sha256(body).hexdigest())
