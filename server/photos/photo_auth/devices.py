"""Per-device revocable credentials. Only hashes persist; pairing is single use."""
import hashlib
import re
import secrets
import time
import uuid
from .schema import Problem

class Devices:
 def __init__(self,store,owner,clock=time.time):
  self.store,self.owner,self.clock=store,owner,clock
  with store.transaction() as c:
   c.execute('CREATE TABLE IF NOT EXISTS photo_devices(id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL, digest TEXT UNIQUE NOT NULL, created REAL NOT NULL, revoked INTEGER NOT NULL DEFAULT 0)')
   c.execute('CREATE TABLE IF NOT EXISTS photo_pair_codes(digest TEXT PRIMARY KEY, owner TEXT NOT NULL, expires REAL NOT NULL)')
   c.execute('CREATE TABLE IF NOT EXISTS photo_pair_attempts(stamp REAL NOT NULL)')
 @staticmethod
 def digest(value):return hashlib.sha256(value.encode('ascii')).hexdigest()
 def code(self):
  code=''.join(secrets.choice('ABCDEFGHJKLMNPQRSTUVWXYZ23456789') for _ in range(16))
  now=self.clock()
  with self.store.transaction() as c:
   c.execute('DELETE FROM photo_pair_codes WHERE expires<?',(now,))
   c.execute('INSERT INTO photo_pair_codes VALUES(?,?,?)',(self.digest(code),self.owner,now+600))
  return '-'.join(code[i:i+4] for i in range(0,16,4))
 def pair(self,data):
  now=self.clock()
  # Commit failed attempts as well; a rolled-back rejection must not bypass rate limits.
  with self.store.transaction() as c:
   c.execute('DELETE FROM photo_pair_attempts WHERE stamp<?',(now-600,))
   count=c.execute('SELECT count(*) FROM photo_pair_attempts WHERE stamp>=?',(now-60,)).fetchone()[0]
   limited=count>=10
   if not limited:c.execute('INSERT INTO photo_pair_attempts VALUES(?)',(now,))
  if limited:raise Problem(429,'pair_rate_limited')
  if not isinstance(data,dict) or set(data)!={'code','name'}:raise Problem(400,'invalid_pairing')
  code,name=data['code'],data['name']
  if not isinstance(code,str) or not re.fullmatch('[A-Z2-9]{16}',code) or not isinstance(name,str) or not 1<=len(name.strip())<=64 or any(ord(x)<32 for x in name):raise Problem(400,'invalid_pairing')
  with self.store.transaction() as c:
   row=c.execute('SELECT owner FROM photo_pair_codes WHERE digest=? AND expires>?',(self.digest(code),now)).fetchone()
   if row is None or row['owner']!=self.owner:raise Problem(401,'pairing_expired_or_used')
   c.execute('DELETE FROM photo_pair_codes WHERE digest=?',(self.digest(code),))
   token='azp_'+secrets.token_urlsafe(32);device=str(uuid.uuid4())
   c.execute('INSERT INTO photo_devices VALUES(?,?,?,?,?,0)',(device,self.owner,name.strip(),self.digest(token),now))
  return {'token':token,'deviceId':device}
 def verify(self,header):
  parts=header.split()
  token=parts[1] if len(parts)==2 and parts[0].lower()=='bearer' else ''
  if not re.fullmatch(r'azp_[A-Za-z0-9_-]{43}',token):raise Problem(401,'unauthorized')
  with self.store.transaction() as c:
   row=c.execute('SELECT owner FROM photo_devices WHERE digest=? AND revoked=0',(self.digest(token),)).fetchone()
  if row is None or row['owner']!=self.owner:raise Problem(401,'unauthorized')
  return row['owner']
 def list(self):
  with self.store.transaction() as c:return [dict(row) for row in c.execute('SELECT id,name,created,revoked FROM photo_devices WHERE owner=?',(self.owner,))]
 def revoke(self,device):
  try:uuid.UUID(device)
  except (ValueError,TypeError):raise Problem(400,'invalid_device') from None
  with self.store.transaction() as c:
   count=c.execute('UPDATE photo_devices SET revoked=1 WHERE owner=? AND id=?',(self.owner,device)).rowcount
  if count!=1:raise Problem(404,'device_not_found')

class PhotoVerifier:
 def __init__(self,devices,legacy=None):self.devices,self.legacy=devices,legacy
 def verify(self,header):
  if self.legacy is not None and not header.lower().startswith('bearer azp_'):
   return self.legacy.verify(header)
  return self.devices.verify(header)
