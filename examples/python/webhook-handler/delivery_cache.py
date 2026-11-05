"""Call only after signature verification; record after handling succeeds."""


class DeliveryCache:
    def __init__(self) -> None:
        self.signatures: set[str] = set()
        self.delivery_ids: set[str] = set()

    def is_duplicate(self, signature: str, delivery_id: str | None, body: bytes) -> bool:
        normalized = signature.strip().lower()
        if normalized in self.signatures or delivery_id in self.delivery_ids:
            self.signatures.add(normalized)
            return True
        return False

    def record(self, signature: str, delivery_id: str | None, body: bytes) -> None:
        self.signatures.add(signature.strip().lower())
        if delivery_id is not None:
            self.delivery_ids.add(delivery_id)
