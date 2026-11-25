import base64
import hashlib
import json
import re
import uuid
from .schema import CREATE_FIELDS,ACTION_FIELDS,MIMES,Limits,Problem,State
from .cos_adapter import CosMissing,CosUnavailable
from .quota import rate,daily,event

def identifier(value):
 if not isinstance(value,str):raise Problem(400,"invalid_id")
 try:
  if str(uuid.UUID(value))!=value:raise ValueError()
 except ValueError:raise Problem(400,"invalid_id") from None
 return value
class Service:
 def __init__(self,store,cos,clock,limits=Limits()):
  self.store,self.cos,self.clock,self.limits=store,cos,clock,limits
  self.uploads_enabled=False
  self.reads_enabled=True
 def validate(self,data):
  if not isinstance(data,dict) or set(data)!=CREATE_FIELDS:raise Problem(400,"invalid_fields")
  identifier(data["operationId"]);identifier(data["batchId"])
  if type(data["bytes"]) is not int or not 0<data["bytes"]<=self.limits.file_bytes:raise Problem(400,"file_size")
  if not isinstance(data["mime"],str) or data["mime"] not in MIMES:raise Problem(400,"mime")
  if not isinstance(data["sha256"],str) or not re.fullmatch("[0-9a-f]{64}",data["sha256"]):raise Problem(400,"sha256")
  try:
   md5=base64.b64decode(data["contentMd5"],validate=True)
   if len(md5)!=16 or base64.b64encode(md5).decode()!=data["contentMd5"]:raise ValueError()
  except (ValueError,TypeError):raise Problem(400,"content_md5") from None
  name=data["originalFilename"]
  if not isinstance(name,str) or not 0<len(name)<=255 or any(ord(x)<32 for x in name):raise Problem(400,"filename")
 def row(self,c,owner,op):
  identifier(op)
  row=c.execute("SELECT * FROM intents WHERE owner=? AND op=?",(owner,op)).fetchone()
  if row is None:raise Problem(404,"not_found")
  return row
 def public(self,row):
  params=json.loads(row["params"])
  return {"operationId":row["op"],"photoId":row["photo"],"reference":"azhen-photo://v1/"+row["photo"],
   "state":row["state"],"integrityLevel":row["integrity"],"integritySource":"client_reported" if row["integrity"].endswith("client_verified") else "head_or_declared",
   "binding":row["binding"],"bytes":row["bytes"],"mime":params["mime"],"sha256":params["sha256"]}
 def grant(self,row,expiry):
  p=json.loads(row["params"])
  headers={"content-type":p["mime"],"content-length":str(p["bytes"]),"content-md5":p["contentMd5"],
   "x-cos-forbid-overwrite":"true","x-cos-meta-sha256":p["sha256"],"x-cos-meta-content-md5":p["contentMd5"],"x-cos-acl":"private"}
  return {"method":"PUT","url":self.cos.sign("PUT",row["object_key"],expiry,headers),"headers":headers,"expiresAt":expiry,"serverTime":self.clock()}
 def slot(self,c,owner,now,exclude=""):
  active=c.execute("SELECT count(*) FROM intents WHERE owner=? AND lease>? AND state IN ('reserved','unknown','uploaded') AND op!=?",(owner,now,exclude)).fetchone()[0]
  if active>=self.limits.active:raise Problem(429,"active_upload_limit")
 def create(self,owner,data):
  self.validate(data)
  if not self.uploads_enabled:raise Problem(503,"uploads_disabled")
  now=self.clock();l=self.limits
  params=json.dumps(data,sort_keys=True,separators=(",",":"))
  with self.store.transaction() as c:
   old=c.execute("SELECT * FROM intents WHERE owner=? AND op=?",(owner,data["operationId"])).fetchone()
   if old:
    if old["params"]!=params:raise Problem(409,"idempotency_conflict")
    result=self.public(old)
    if old["state"]==State.RESERVED and old["lease"]>now:result["authorization"]=self.grant(old,old["lease"])
    return result
   self.slot(c,owner,now)
   pending=c.execute("SELECT count(*) FROM intents WHERE owner=? AND state NOT IN ('confirmed','failed','expired')",(owner,)).fetchone()[0]
   if pending>=l.pending:raise Problem(429,"pending_limit")
   batch=c.execute("SELECT count(*),coalesce(sum(bytes),0) FROM intents WHERE owner=? AND batch=?",(owner,data["batchId"])).fetchone()
   if batch[0]>=l.batch_count or batch[1]+data["bytes"]>l.batch_bytes:raise Problem(429,"batch_limit")
   rate(c,owner,"create",now,60,l.create_minute)
   daily(c,owner,"create",now,l.daily_count,l.daily_bytes,data["bytes"])
   photo=str(uuid.uuid4());prefix=hashlib.sha256(owner.encode()).hexdigest()[:24]
   key=f"{getattr(self.cos,'prefix','isolated-test/')}photos/v1/{prefix}/{photo}/original.{MIMES[data['mime']]}"
   c.execute("INSERT INTO intents VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",(owner,data["operationId"],photo,key,data["batchId"],data["bytes"],params,State.RESERVED,"declared","pending_reference",getattr(self.cos,"bucket","simulation-bucket"),getattr(self.cos,"region","simulation-region"),now,now,now+l.put_ttl))
   row=self.row(c,owner,data["operationId"])
   result=self.public(row);result["authorization"]=self.grant(row,now+l.put_ttl)
   event(c,owner,"create",now,data["bytes"],data["operationId"])
   return result
 def status(self,owner,op):
  with self.store.transaction() as c:return self.public(self.row(c,owner,op))
 def reconcile(self,c,row,now):
  try:head=self.cos.head(row["object_key"])
  except CosMissing:return "missing"
  except (CosUnavailable,TimeoutError):
   c.execute("UPDATE intents SET state='unknown',updated=? WHERE owner=? AND op=?",(now,row["owner"],row["op"]))
   return "unknown"
  p=json.loads(row["params"])
  valid=head.get("bytes")==row["bytes"] and head.get("content-type")==p["mime"] and head.get("x-cos-meta-sha256")==p["sha256"] and head.get("content-md5")==p["contentMd5"]
  c.execute("UPDATE intents SET state=?,integrity=?,updated=?,lease=0 WHERE owner=? AND op=?",("confirmed" if valid else "failed","transport_checked" if valid else "declared",now,row["owner"],row["op"]))
  return "confirmed" if valid else "mismatch"
 def complete(self,owner,op,data):
  if set(data)-ACTION_FIELDS["complete"] or data.get("outcome","uploaded") not in ("uploaded","timeout","cancelled","failed"):raise Problem(400,"invalid_fields")
  with self.store.transaction() as c:
   row=self.row(c,owner,op)
   if row["state"] in ("confirmed","failed"):return self.public(row)
   c.execute("UPDATE intents SET state=?,updated=? WHERE owner=? AND op=?",("uploaded" if data.get("outcome","uploaded")=="uploaded" else "unknown",self.clock(),owner,op))
  with self.store.transaction() as c:
   row=self.row(c,owner,op)
   if row["state"] in ("confirmed","failed"):return self.public(row)
   result=self.reconcile(c,row,self.clock())
   if result=="missing":c.execute("UPDATE intents SET state='unknown',updated=? WHERE owner=? AND op=?",(self.clock(),owner,op))
   return self.public(self.row(c,owner,op))
 def renew(self,owner,op,data):
  if data:raise Problem(400,"invalid_fields")
  if not self.uploads_enabled:raise Problem(503,"uploads_disabled")
  now=self.clock();l=self.limits
  with self.store.transaction() as c:
   row=self.row(c,owner,op)
   if row["state"] in ("confirmed","failed"):raise Problem(409,"not_renewable")
   result=self.reconcile(c,row,now)
   if result=="missing":
    rate(c,owner,"renew",now,3600,l.renew_hour,op)
    self.slot(c,owner,now,op)
    c.execute("UPDATE intents SET state='reserved',lease=?,updated=? WHERE owner=? AND op=?",(now+l.put_ttl,now,owner,op))
    event(c,owner,"renew",now,op=op)
    row=self.row(c,owner,op);answer=self.public(row);answer["authorization"]=self.grant(row,now+l.put_ttl)
    return answer
   return self.public(self.row(c,owner,op))
 def integrity(self,owner,op,data):
  if set(data)!=ACTION_FIELDS["integrity"] or type(data["bytes"]) is not int:raise Problem(400,"invalid_fields")
  with self.store.transaction() as c:
   row=self.row(c,owner,op);p=json.loads(row["params"])
   if row["state"]!="confirmed":raise Problem(409,"not_confirmed")
   good=data["sha256"]==p["sha256"] and data["bytes"]==row["bytes"]
   c.execute("UPDATE intents SET integrity=?,updated=? WHERE owner=? AND op=?",("roundtrip_sha256_client_verified" if good else "client_reported_mismatch",self.clock(),owner,op))
   return self.public(self.row(c,owner,op))
 def reads(self,owner,data):
  ids=data.get("photoIds")
  if set(data)!=ACTION_FIELDS["read"] or not isinstance(ids,list) or not 0<len(ids)<=self.limits.read_batch:raise Problem(400,"invalid_fields")
  for i in ids:identifier(i)
  if len(set(ids))!=len(ids):raise Problem(400,"duplicate_photo")
  if not self.reads_enabled:raise Problem(503,"reads_disabled")
  now=self.clock();l=self.limits
  with self.store.transaction() as c:
   rows=[]
   for photo in ids:
    row=c.execute("SELECT * FROM intents WHERE owner=? AND photo=?",(owner,photo)).fetchone()
    if row is None:raise Problem(404,"not_found")
    if row["state"]!="confirmed" or row["integrity"]=="client_reported_mismatch":raise Problem(409,"not_readable")
    rows.append(row)
   size=sum(row["bytes"] for row in rows)
   rate(c,owner,"read",now,60,l.read_minute)
   daily(c,owner,"read",now,10**12,l.daily_read_bytes,size)
   result=[{**self.public(row),"authorization":{"method":"GET","url":self.cos.sign("GET",row["object_key"],now+l.get_ttl,{}),"expiresAt":now+l.get_ttl,"serverTime":now}} for row in rows]
   event(c,owner,"read",now,size)
   return result
