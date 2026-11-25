"""Single source for v1 wire routes, fields, states and production default limits."""
from dataclasses import dataclass
from enum import StrEnum
BASE = "/photos/v1"
ROUTES = {"create": ("POST", BASE+"/uploads"), "status": ("GET", BASE+"/uploads/{operationId}"),
 "renew": ("POST", BASE+"/uploads/{operationId}/renew"), "complete": ("POST", BASE+"/uploads/{operationId}/complete"),
 "integrity": ("POST", BASE+"/uploads/{operationId}/integrity-report"), "read": ("POST", BASE+"/read-authorizations")}
CREATE_FIELDS = {"operationId", "batchId", "bytes", "mime", "sha256", "contentMd5", "originalFilename"}
ACTION_FIELDS = {"renew": set(), "complete": {"outcome"}, "integrity": {"sha256", "bytes"}, "read": {"photoIds"}}
MIMES = {"image/png":"png", "image/jpeg":"jpg", "image/webp":"webp", "image/gif":"gif"}
class State(StrEnum):
 RESERVED="reserved"
 UPLOADED="uploaded"
 CONFIRMED="confirmed"
 UNKNOWN="unknown"
 FAILED="failed"
 EXPIRED="expired"
@dataclass(frozen=True)
class Limits:
 file_bytes:int=10*1024**2
 batch_bytes:int=40*1024**2
 batch_count:int=4
 active:int=2
 daily_count:int=100
 daily_bytes:int=200*1024**2
 create_minute:int=20
 pending:int=20
 renew_hour:int=3
 read_batch:int=20
 read_minute:int=60
 daily_read_bytes:int=1024**3
 put_ttl:int=600
 get_ttl:int=300
class Problem(Exception):
 def __init__(self, status, code):
  self.status,self.code=status,code
  super().__init__(code)
