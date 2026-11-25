"""Explicit Linux deployment entrypoint. Importing never reads secrets or starts IO."""
import argparse
import json
import logging
import os
import stat
import sys
import time
import uuid
from pathlib import Path
from .app import App
from .auth import TokenVerifier
from .metadata_store import Store
from .schema import Limits
from .service import Service
from .tencent_cos import TencentCosAdapter, official_client
from .devices import Devices,PhotoVerifier

class ConfigError(ValueError):
 pass

def _check_stat(info, *, directory=False, private=False):
 if os.name != "posix":raise ConfigError("linux_permissions_required")
 allowed_owners={0,os.geteuid()} if not private else {os.geteuid()}
 if info.st_uid not in allowed_owners:raise ConfigError("unsafe_owner")
 if not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)):raise ConfigError("unsafe_file_type")
 if stat.S_IMODE(info.st_mode) & (0o077 if private else 0o027):raise ConfigError("unsafe_permissions")
 if info.st_mode & 0o050 and info.st_gid not in {0,os.getegid()}:raise ConfigError("unsafe_group")

def _private_directory(path, *, state=False):
 p=Path(path)
 if not p.is_absolute() or p.resolve()!=p:raise ConfigError("absolute_canonical_path_required")
 _check_stat(p.stat(),directory=True,private=state)
 return p

def _read_json(path):
 p=Path(path)
 _private_directory(p.parent)
 if not p.is_absolute() or p.resolve()!=p:raise ConfigError("absolute_canonical_path_required")
 fd=os.open(p,os.O_RDONLY|getattr(os,"O_NOFOLLOW",0))
 try:
  _check_stat(os.fstat(fd))
  with os.fdopen(fd,"rb",closefd=False) as stream:raw=stream.read(16385)
  if len(raw)>16384:raise ConfigError("config_too_large")
  value=json.loads(raw)
  if not isinstance(value,dict):raise ConfigError("config_object_required")
  return value
 except (ValueError,UnicodeError):raise ConfigError("invalid_config") from None
 finally:os.close(fd)

def load_config(path):
 c=_read_json(path)
 required={"bucket","region","prefix","port","stateDirectory","credentialsFile","owner"}
 switches={"uploadsEnabled","readsEnabled","headNetworkEnabled"}
 if not required<=set(c) or set(c)-required-switches-{'deploymentMode'}:raise ConfigError("config_fields")
 if c["bucket"]!="azhen-photos-1301105804" or c["region"]!="ap-guangzhou":raise ConfigError("isolated_bucket_required")
 production=c.get('deploymentMode','isolated')=='production'
 if c.get('deploymentMode','isolated') not in ('production','isolated'):raise ConfigError('deployment_mode')
 try:
  run=c["prefix"].removeprefix("isolated-test/s2-05/").removesuffix("/")
  if production:
   if c['prefix']!='private-photos/v1/':raise ValueError()
  elif str(uuid.UUID(run))!=run or c["prefix"]!=f"isolated-test/s2-05/{run}/":raise ValueError()
 except (ValueError,TypeError,AttributeError):raise ConfigError("run_prefix_required") from None
 if type(c["port"]) is not int or not 1024<=c["port"]<=65535:raise ConfigError("port_required")
 if not isinstance(c["owner"],str) or not 1<=len(c["owner"])<=128 or any(ord(x)<33 for x in c["owner"]):raise ConfigError("owner_required")
 for key in switches:
  c.setdefault(key,False)
  if type(c[key]) is not bool:raise ConfigError("boolean_switch_required")
 if (c["uploadsEnabled"] or c["readsEnabled"]) and not c["headNetworkEnabled"]:raise ConfigError("head_required")
 _private_directory(c["stateDirectory"],state=True)
 secrets=_read_json(c["credentialsFile"])
 if set(secrets)!={"secretId","secretKey","authToken"}:raise ConfigError("credential_fields")
 for key in secrets:
  if not isinstance(secrets[key],str) or len(secrets[key])<32 or secrets[key].startswith("REPLACE_") or any(ord(x)<33 or ord(x)>126 for x in secrets[key]):raise ConfigError("credential_value")
 if secrets["authToken"] in (secrets["secretId"],secrets["secretKey"]):raise ConfigError("separate_identity_required")
 return c,secrets

def create_app(config_path, *, client_factory=official_client):
 c,secrets=load_config(config_path)
 # Values never pass through environment discovery, repr, error text or client JSON.
 client=client_factory(c["region"],secrets["secretId"],secrets["secretKey"])
 cos=TencentCosAdapter(c["bucket"],c["region"],client,prefix=c["prefix"],allow_head_network=c["headNetworkEnabled"])
 database=Path(c["stateDirectory"])/"metadata.sqlite"
 if database.is_symlink():raise ConfigError("unsafe_database_path")
 if database.exists():_check_stat(database.stat(),private=True)
 production=c.get('deploymentMode','isolated')=='production'
 limits=Limits(file_bytes=10*1024**2,batch_bytes=40*1024**2,batch_count=4,daily_count=100,daily_bytes=1024*1024**2,daily_read_bytes=4096*1024**2) if production else Limits(file_bytes=2*1024**2,batch_bytes=8*1024**2,daily_count=8,daily_bytes=16*1024**2,daily_read_bytes=40*1024**2)
 store=Store(database)
 service=Service(store,cos,time.time,limits)
 service.uploads_enabled=c["uploadsEnabled"];service.reads_enabled=c["readsEnabled"]
 devices=Devices(store,c['owner']) if production else None
 verifier=PhotoVerifier(devices) if production else TokenVerifier(secrets['authToken'],c['owner'])
 return App(service,verifier,mode="private_cos_production" if production else "isolated_cos_configured_not_cloud_verified",health_path="/photos/v1/healthz",devices=devices),c

def server_options(port):
 return dict(host="127.0.0.1",port=port,threads=4,connection_limit=32,backlog=32,
  channel_timeout=30,cleanup_interval=5,max_request_header_size=16384,
  max_request_body_size=32768,expose_tracebacks=False,log_socket_errors=False,
  clear_untrusted_proxy_headers=True,ident="photo-auth")

def main(argv=None):
 parser=argparse.ArgumentParser(description="Isolated COS authorization service; explicit restricted Linux configuration")
 parser.add_argument("--config",required=True)
 parser.add_argument("--check-config",action="store_true")
 args=parser.parse_args(argv)
 os.umask(0o077)
 # HTTP debug logs must never receive URLs, response bodies or credentials.
 logging.basicConfig(level=logging.WARNING,format="%(name)s %(message)s",force=True)
 logging.getLogger("photo_auth.audit").setLevel(logging.INFO)
 try:
  if args.check_config:
   load_config(args.config);print("configuration_valid_no_cloud_request");return 0
  app,c=create_app(args.config)
  from waitress import serve
  serve(app,**server_options(c["port"]))
  return 0
 except Exception:
  # Never propagate credentials/config/SDK exception representations to journal.
  print("photo_auth_startup_or_runtime_failed",file=sys.stderr);return 2
if __name__=="__main__":sys.exit(main())
