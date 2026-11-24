from fastapi import Request
from sqlalchemy.orm import Session
from app.models import SecurityEvent
from app.security import keyed_hash

def record_security_event(db: Session, request: Request, event_type: str, *, user_id: int | None = None, email: str | None = None) -> None:
    # Do not trust client-supplied X-Forwarded-For unless a trusted proxy is configured.
    client_ip = request.client.host if request.client else "unknown"
    db.add(SecurityEvent(event_type=event_type, user_id=user_id, email_hash=keyed_hash(email.lower().strip()) if email else None, ip_hash=keyed_hash(client_ip)))
