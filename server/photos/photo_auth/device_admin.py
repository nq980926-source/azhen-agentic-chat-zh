"""Run by the photo service account. No COS credentials or permanent tokens printed."""
import argparse
import json
import os
from pathlib import Path
from .production import _read_json,_private_directory
from .metadata_store import Store
from .devices import Devices

def main():
 parser=argparse.ArgumentParser()
 parser.add_argument('--config',required=True)
 parser.add_argument('action',choices=['pair','list','revoke'])
 parser.add_argument('--device')
 args=parser.parse_args();os.umask(0o077)
 try:
  config=_read_json(args.config)
  directory=_private_directory(config['stateDirectory'],state=True)
  devices=Devices(Store(directory/'metadata.sqlite'),config['owner'])
  if args.action=='pair':
   print('一次性照片配对码（10分钟有效，仅输入本机插件设置，不发送到聊天）：')
   print(devices.code())
  elif args.action=='list':print(json.dumps(devices.list(),ensure_ascii=False))
  else:devices.revoke(args.device);print('device_revoked_photos_preserved')
  return 0
 except Exception:
  print('device_admin_failed_no_secret_details');return 1
if __name__=='__main__':raise SystemExit(main())
