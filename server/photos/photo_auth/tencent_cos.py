"""Official SDK adapter, disconnected by default. No client/credentials at import.
Ordinary COS buckets only. This module never implements the Tencent signature algorithm.
"""
import contextvars
import logging
import math
import re
import time
from contextlib import contextmanager
from urllib.parse import urlsplit,unquote
from .cos_adapter import CosMissing,CosUnavailable
_quiet=contextvars.ContextVar("photo_cos_quiet",default=False)
class _SensitiveSdkFilter(logging.Filter):
 def filter(self,record):return not _quiet.get()
_filter=_SensitiveSdkFilter()
@contextmanager
def quiet_sdk():
 # SDK debug/exception records can contain URL/authorization data. Suppress only
 # records emitted by SDK modules during adapter calls, without changing root level.
 for name in ("qcloud_cos.cos_client","qcloud_cos.cos_auth","qcloud_cos.cos_comm"):
  logger=logging.getLogger(name)
  if _filter not in logger.filters:logger.addFilter(_filter)
 token=_quiet.set(True)
 try:yield
 finally:_quiet.reset(token)
def official_client(region,secret_id,secret_key,token=None):
 if not region or not secret_id or not secret_key:raise ValueError("cos_credentials_required")
 try:
  from qcloud_cos import CosConfig,CosS3Client
  with quiet_sdk():
   config=CosConfig(Region=region,SecretId=secret_id,SecretKey=secret_key,Token=token,Scheme="https",Timeout=10,
    AllowRedirects=False,VerifySSL=True,SignHost=True,EnableSessionAuth=False,EnableGatewayDnsLb=False,AutoSwitchDomainOnRetry=False)
   return CosS3Client(config,retry=0)
 except Exception:raise CosUnavailable("cos_client_init_unavailable") from None
class TencentCosAdapter:
 def __init__(self,bucket,region,client,*,prefix="isolated-test/",clock=time.time,allow_head_network=False):
  if not re.fullmatch(r"[a-z0-9][a-z0-9-]*-[0-9]+",bucket) or "-x--" in bucket:raise ValueError("ordinary_bucket_required")
  if not re.fullmatch(r"ap-[a-z]+",region):raise ValueError("cos_region_rejected")
  if prefix!='private-photos/v1/' and not re.fullmatch(r"isolated-test/(?:[a-zA-Z0-9_-]+/)*",prefix):raise ValueError("isolated_prefix_required")
  self.bucket,self.region,self.prefix,self.client=bucket,region,prefix,client
  self.clock,self.allow_head_network=clock,allow_head_network
 def _key(self,key):
  prefixes=(self.prefix,'isolated-test/s2-05/492d2883-a19e-4929-bedd-86db673b7f51/') if self.prefix=='private-photos/v1/' else (self.prefix,)
  if not isinstance(key,str) or not key.startswith(prefixes) or len(key)>512:raise ValueError("cos_key_rejected")
  if not re.fullmatch(r"[a-zA-Z0-9/_\.-]+",key) or any(p in ("",".","..") for p in key.split("/")):raise ValueError("cos_key_rejected")
 def sign(self,method,key,expires,headers):
  self._key(key)
  if method not in ("PUT","GET"):raise ValueError("cos_method_rejected")
  if method=='PUT' and not key.startswith(self.prefix):raise ValueError('legacy_read_only')
  ttl=math.floor(expires-self.clock())
  if not 1<=ttl<=(600 if method=="PUT" else 300):raise ValueError("cos_expiry_rejected")
  headers=dict(headers)
  if method=="GET" and headers:raise ValueError("cos_get_headers_rejected")
  if method=="PUT":
   required={"content-type","content-length","content-md5","x-cos-forbid-overwrite","x-cos-meta-sha256","x-cos-meta-content-md5","x-cos-acl"}
   if set(headers)!=required or headers["x-cos-forbid-overwrite"]!="true" or headers["x-cos-acl"]!="private":raise ValueError("cos_put_headers_rejected")
   if headers["x-cos-meta-content-md5"]!=headers["content-md5"]:raise ValueError("cos_md5_metadata_rejected")
  try:
   with quiet_sdk():url=self.client.get_presigned_url(Bucket=self.bucket,Key=key,Method=method,Expired=ttl,Params={},Headers=headers,SignHost=True)
   u=urlsplit(url)
   if u.scheme!="https" or u.netloc!=f"{self.bucket}.cos.{self.region}.myqcloud.com" or unquote(u.path)!=f"/{key}" or u.fragment:raise ValueError()
   return url
  except Exception:raise CosUnavailable("cos_sign_unavailable") from None
 def head(self,key):
  self._key(key)
  if not self.allow_head_network:raise CosUnavailable("cos_head_network_disabled")
  from qcloud_cos.cos_exception import CosServiceError
  try:
   with quiet_sdk():raw=self.client.head_object(Bucket=self.bucket,Key=key)
  except CosServiceError as error:
   try:status,code=int(error.get_status_code()),error.get_error_code()
   except (KeyError,ValueError,TypeError):status,code=0,""
   if status==404 and code in ("NoSuchKey","NotFound"):raise CosMissing() from None
   raise CosUnavailable("cos_head_unavailable") from None
  except Exception:raise CosUnavailable("cos_head_unavailable") from None
  try:
   h={k.lower():v for k,v in raw.items()}
   # These are metadata declarations, NOT an independently computed checksum.
   return {"bytes":int(h["content-length"]),"content-type":h["content-type"],
    "content-md5":h["x-cos-meta-content-md5"],"x-cos-meta-sha256":h["x-cos-meta-sha256"]}
  except (KeyError,ValueError,TypeError):raise CosUnavailable("cos_head_metadata_invalid") from None
