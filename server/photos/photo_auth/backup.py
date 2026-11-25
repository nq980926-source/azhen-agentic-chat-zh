"""Daily consistent metadata snapshots; no image bytes or COS credentials."""
import datetime,os,stat
from .production import _read_json,_private_directory
from .metadata_store import Store
def main():
 import argparse
 parser=argparse.ArgumentParser();parser.add_argument('--config',required=True);args=parser.parse_args()
 os.umask(0o077)
 try:
  config=_read_json(args.config);state=_private_directory(config['stateDirectory'],state=True)
  destination=state/'backups';destination.mkdir(mode=0o700,exist_ok=True)
  _private_directory(destination,state=True)
  stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
  Store(state/'metadata.sqlite').backup(destination/('metadata-'+stamp+'.sqlite'))
  files=sorted(destination.glob('metadata-*.sqlite'),reverse=True)
  for path in files[30:]:
   info=path.lstat()
   if path.resolve()==path and stat.S_ISREG(info.st_mode) and info.st_uid==os.geteuid():path.unlink()
  print('PHOTO_METADATA_BACKUP_OK_NO_CREDENTIALS_OR_IMAGES');return 0
 except Exception:print('PHOTO_METADATA_BACKUP_FAILED_NO_SECRET_DETAILS');return 1
if __name__=='__main__':raise SystemExit(main())
