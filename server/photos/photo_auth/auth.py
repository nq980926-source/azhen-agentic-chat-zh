import hashlib
import hmac
from .schema import Problem
class TokenVerifier:
 """One explicitly configured owner. Never persist or repr a bearer token."""
 def __init__(self, token, owner="local-owner"):
  if len(token)<32: raise ValueError("mock token must be >=32 chars")
  self._digest=hashlib.sha256(token.encode()).digest()
  self.owner=owner
 def verify(self, header):
  parts=header.split()
  value=parts[1] if len(parts)==2 and parts[0].lower()=="bearer" else ""
  if not hmac.compare_digest(hashlib.sha256(value.encode()).digest(),self._digest): raise Problem(401,"unauthorized")
  return self.owner
