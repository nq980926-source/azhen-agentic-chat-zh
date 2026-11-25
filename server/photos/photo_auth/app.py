"""Small WSGI JSON boundary. No import-time listeners, workers or cloud access."""
import json
import logging
import sqlite3
import uuid
from .schema import BASE,ROUTES,Problem
from .cos_adapter import CosUnavailable
log=logging.getLogger("photo_auth.audit")
class App:
 def __init__(self,service,verifier,*,mode="simulation_only",health_path="/healthz",devices=None):
  self.service,self.verifier,self.mode,self.health_path,self.devices=service,verifier,mode,health_path,devices
 def __call__(self,environ,start_response):
  request_id=str(uuid.uuid4());status=200;route="unmatched"
  try:
   path=environ.get("PATH_INFO","");method=environ.get("REQUEST_METHOD","")
   if environ.get("QUERY_STRING"):raise Problem(400,"query_not_allowed")
   if path==self.health_path and method=="GET":
    with self.service.store.transaction() as c:c.execute("SELECT 1")
    value={"mode":self.mode,"database":"available"};route="health"
   else:
    pairing=path==BASE+'/devices/pair' and method=='POST' and self.devices is not None
    if pairing:route,op,owner='pair',None,None
    else:
     owner=self.verifier.verify(environ.get("HTTP_AUTHORIZATION",""))
     route,op=self.match(method,path)
    length=environ.get("CONTENT_LENGTH","0") or "0"
    try:length=int(length)
    except ValueError:raise Problem(400,"content_length") from None
    if not 0<=length<=32768:raise Problem(413,"request_too_large")
    data={}
    if method=="POST":
     if environ.get("CONTENT_TYPE","").split(";")[0]!="application/json":raise Problem(415,"json_required")
     raw=environ["wsgi.input"].read(length)
     if len(raw)!=length:raise Problem(400,"truncated_json")
     try:data=json.loads(raw)
     except (ValueError,UnicodeError):raise Problem(400,"invalid_json") from None
     if not isinstance(data,dict):raise Problem(400,"json_object_required")
    if route=="pair":value=self.devices.pair(data)
    elif route=="create":value=self.service.create(owner,data)
    elif route=="read":value=self.service.reads(owner,data)
    elif route=="status":value=self.service.status(owner,op)
    else:value=getattr(self.service,route)(owner,op,data)
   response={"requestId":request_id,"data":value}
  except Problem as e:
   status=e.status;response={"requestId":request_id,"error":{"code":e.code,"retryable":status in (429,503),"localImageFallback":True}}
  except (sqlite3.Error,CosUnavailable,TimeoutError):
   status=503;response={"requestId":request_id,"error":{"code":"dependency_unavailable","retryable":True,"localImageFallback":True}}
  except Exception:
   status=500;response={"requestId":request_id,"error":{"code":"internal_error","retryable":False,"localImageFallback":True}}
  # Deliberate allowlist, never log input, URL, headers or exception text.
  log.info("request=%s route=%s status=%d",request_id,route,status)
  body=json.dumps(response,separators=(",",":")).encode()
  headers=[("Content-Type","application/json"),("Content-Length",str(len(body))),("Cache-Control","no-store")]
  if status==401:headers.append(("WWW-Authenticate","Bearer"))
  if status==429:headers.append(("Retry-After","60"))
  start_response(f"{status} response",headers)
  return [body]
 @staticmethod
 def match(method,path):
  for name,(verb,template) in ROUTES.items():
   if "{operationId}" in template:
    prefix,suffix=template.split("{operationId}")
    if not path.startswith(prefix) or (suffix and not path.endswith(suffix)):continue
    op=path[len(prefix):len(path)-len(suffix) if suffix else None]
    if not op or "/" in op:continue
   else:
    if path!=template:continue
    op=None
   if method!=verb:raise Problem(405,"method_not_allowed")
   return name,op
  raise Problem(404,"route_not_found")
