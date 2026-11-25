"""Execute only after the complete production change request is approved."""
import datetime,fcntl,hashlib,http.client,json,os,pathlib,pwd,re,shutil,ssl,stat,subprocess,sys,tempfile,time
import tls_renew
from nginx_parser import parse
P=pathlib.Path
VERSION='0.51.28-rc.1'
SOURCE=P(__file__).resolve().parents[1]
RELEASE=P('/opt/azhen-photo-auth/releases')/VERSION
CONFIG=P('/etc/azhen-photo-auth/config.json')
NGINX=P('/etc/nginx/conf.d/azhen-mcp-access.conf')
DROP=P('/etc/systemd/system/azhen-photo-auth.service.d/50-photos-production.conf')
BASE=P('/var/backups/azhen-photos-production')
UNIT='azhen-photo-auth.service'
TIMER='azhen-photos-tls.timer'
TLS_SERVICE=P('/etc/systemd/system/azhen-photos-tls.service')
TLS_TIMER=P('/etc/systemd/system')/TIMER
BACKUP_TIMER='azhen-photos-backup.timer'
BACKUP_SERVICE=P('/etc/systemd/system/azhen-photos-backup.service')
BACKUP_TIMER_FILE=P('/etc/systemd/system')/BACKUP_TIMER
PREFIX='private-photos/v1/'
def need(ok,code):
 if not ok:raise RuntimeError(code)
def run(args,timeout=600,cwd=None):
 result=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout,cwd=cwd)
 need(result.returncode==0,'DEPLOY_COMMAND_FAILED')
 return result.stdout.decode().strip()
def raw(path):
 need(path.resolve()==path,'UNSAFE_PATH')
 info=path.stat();need(stat.S_ISREG(info.st_mode) and info.st_uid==0 and not info.st_mode&0o022 and info.st_size<=262144,'UNSAFE_FILE')
 return path.read_bytes()
def sha(value):return hashlib.sha256(value).hexdigest()
def atomic(path,value,mode=0o600):
 path.parent.mkdir(parents=True,exist_ok=True)
 fd,name=tempfile.mkstemp(prefix='.azhen-production-',dir=str(path.parent));tmp=P(name)
 try:
  with os.fdopen(fd,'wb') as stream:stream.write(value);stream.flush();os.fsync(stream.fileno())
  if path.exists():
   info=path.stat();shutil.copystat(path,tmp);os.chown(tmp,info.st_uid,info.st_gid)
  else:os.chmod(tmp,mode)
  os.replace(tmp,path)
  directory=os.open(str(path.parent),os.O_RDONLY|os.O_DIRECTORY)
  try:os.fsync(directory)
  finally:os.close(directory)
 finally:
  if tmp.exists():tmp.unlink()
def config():
 original=raw(CONFIG);value=json.loads(original)
 need(value['bucket']=='azhen-photos-1301105804' and value['region']=='ap-guangzhou' and value['port']==8001,'PHOTO_SCOPE_CHANGED')
 need(value['prefix']=='isolated-test/s2-05/492d2883-a19e-4929-bedd-86db673b7f51/','EXPECTED_ISOLATED_BASELINE')
 need(all(value.get(k) is False for k in ('uploadsEnabled','readsEnabled','headNetworkEnabled')),'CLOSE_EXISTING_UPLOAD_WINDOW_FIRST')
 state=P(value['stateDirectory']);info=state.stat()
 need(state.is_absolute() and state.resolve()==state and info.st_uid==pwd.getpwnam('azhen-photo-auth').pw_uid and not info.st_mode&0o077,'UNSAFE_PHOTO_STATE_DIRECTORY')
 return original,value
def cors(original):
 text=original.decode();begin=text.find('# AZHEN_PHOTO_A_HTTP_LOCALHOST_BEGIN');end=text.find('# AZHEN_PHOTO_A_HTTP_LOCALHOST_END')
 need(begin>=0 and end>begin and text.count('# AZHEN_PHOTO_A_HTTP_LOCALHOST_BEGIN')==1,'SUCCESSFUL_A2_BASELINE_REQUIRED')
 locations=[]
 def visit(nodes):
  for node in nodes:
   if node['a'] in (['location','/photos/v1/'],['location','^~','/photos/v1/']):locations.append(node)
   if node['children'] is not None:visit(node['children'])
 visit(parse(text));need(len(locations)==1,'PHOTO_LOCATION_NOT_UNIQUE')
 photo=locations[0];need(photo['open']<begin<end<photo['end'],'CORS_MARKER_OUTSIDE_PHOTO_LOCATION')
 need(any(node['a']==['proxy_pass','http://127.0.0.1:8001'] for node in photo['children']),'PHOTO_UPSTREAM_CHANGED')
 part=text[begin:end]
 pattern=r'(?m)^([ \t]*)if \(\$http_origin = "http://localhost"\) \{\r?\n(?:[^\n]*\r?\n)*?\1\}'
 matches=list(re.finditer(pattern,part));need(len(matches)==1,'CORS_ORIGIN_BLOCK_NOT_UNIQUE')
 match=matches[0];block=match[0];part=part[:match.end()]+ '\n'+block.replace('"http://localhost"','"app://obsidian.md"')+part[match.end():]
 gate='if ($azhen_photo_a_gate = "OPTIONS|http://localhost") { return 204; }'
 need(part.count(gate)==1 and part.count('if ($request_method = OPTIONS) { return 403; }')==1,'STRICT_OPTIONS_BASELINE_REQUIRED')
 part=part.replace(gate,gate+'\n'+match[1]+'if ($azhen_photo_a_gate = "OPTIONS|app://obsidian.md") { return 204; }')
 # add_header statements, all existing security headers and every byte outside the approved marker remain unchanged.
 return (text[:begin]+part+text[end:]).encode()
def healthy():
 connection=http.client.HTTPConnection('127.0.0.1',8001,timeout=10)
 try:
  connection.request('GET','/photos/v1/healthz');response=connection.getresponse();body=response.read(4096)
  need(response.status==200 and json.loads(body)['data']['mode']=='private_cos_production','PRODUCTION_HEALTH_FAILED')
 finally:connection.close()
def public_checks():
 for origin in ('http://localhost','app://obsidian.md','https://example.invalid'):
  connection=http.client.HTTPSConnection('106.55.92.40',timeout=10,context=ssl.create_default_context())
  try:
   connection.request('OPTIONS','/photos/v1/devices/pair',headers={'Origin':origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'})
   response=connection.getresponse();headers=response.getheaders();response.read(4096)
   values=[value for key,value in headers if key.lower()=='access-control-allow-origin']
   allowed=origin!='https://example.invalid'
   need(response.status==(204 if allowed else 403) and values==([origin] if allowed else []),'PUBLIC_CORS_BOUNDARY_FAILED')
  finally:connection.close()
 # Confirm a public one-time-code route reaches this backend, not an inherited legacy Token gate.
 connection=http.client.HTTPSConnection('106.55.92.40',timeout=10,context=ssl.create_default_context())
 try:
  connection.request('POST','/photos/v1/devices/pair',body=b'{}',headers={'Origin':'app://obsidian.md','Content-Type':'application/json'})
  response=connection.getresponse();body=response.read(4096)
  need(response.status==400 and json.loads(body).get('error',{}).get('code')=='invalid_pairing','PUBLIC_PAIRING_ROUTE_BLOCKED')
 finally:connection.close()
def rollback(directory):
 manifest=json.loads(raw(directory/'manifest.json'))
 run(['systemctl','stop',UNIT],90)
 for timer in (TIMER,BACKUP_TIMER):subprocess.run(['systemctl','disable','--now',timer],capture_output=True,timeout=60)
 for name in manifest['files']:
  row=manifest['files'][name];path=P(row['path'])
  if path.exists():need(sha(raw(path)) in (row.get('before'),row.get('after')),'EXTERNAL_CHANGE_PREVENTS_ROLLBACK')
  if row['before'] is None:
   if path.exists():path.unlink()
  else:
   backup=raw(directory/name);need(sha(backup)==row['before'],'BACKUP_HASH_MISMATCH');atomic(path,backup)
   os.chmod(path,row['mode']);os.chown(path,row['uid'],row['gid'])
 run(['nginx','-t']);run(['systemctl','daemon-reload']);run(['systemctl','reload','nginx'])
 run(['systemctl','restart',UNIT],90)
 if not manifest['previously_enabled']:run(['systemctl','disable',UNIT])
 for timer,previous in manifest['timers'].items():
  if previous['enabled']:run(['systemctl','enable',timer])
  if previous['active']:run(['systemctl','start',timer])
 print('PHOTO_PRODUCTION_ROLLED_BACK_DATABASE_AND_OBJECTS_PRESERVED')
def apply():
 original,old=config();tls_renew.detect()
 run(['systemctl','is-active','--quiet',UNIT]);run(['nginx','-t'])
 need(run(['systemctl','show',UNIT,'--property=User','--value'])=='azhen-photo-auth','PHOTO_SERVICE_USER_CHANGED')
 owner=pwd.getpwnam('azhen-photo-auth')
 database=P(old['stateDirectory'])/'metadata.sqlite'
 query="import sqlite3,sys; c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); print(c.execute(\"SELECT count(*) FROM intents WHERE lease>? AND state NOT IN ('confirmed','failed','expired')\",(float(sys.argv[2]),)).fetchone()[0]); c.close()"
 active=run(['runuser','-u','azhen-photo-auth','--','/usr/bin/python3','-c',query,str(database),str(time.time())])
 need(active=='0','EXISTING_UPLOADS_IN_FLIGHT')
 if RELEASE.exists():
  need(RELEASE.resolve()==RELEASE and RELEASE.stat().st_uid==0 and not RELEASE.stat().st_mode&0o022,'UNSAFE_EXISTING_RELEASE')
  need(not (RELEASE/'.venv').exists() or (RELEASE/'.venv').resolve()==RELEASE/'.venv','UNSAFE_EXISTING_VENV')
  for path in SOURCE.rglob('*'):
   relative=path.relative_to(SOURCE)
   if not path.is_file() or any(part in ('__pycache__','.venv','tests') for part in relative.parts) or path.suffix=='.pyc':continue
   staged=RELEASE/relative
   if staged.exists():need(raw(staged)==path.read_bytes(),'EXISTING_RELEASE_DIFFERS_FROM_APPROVED_BUNDLE')
   else:staged.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(path,staged)
 else:shutil.copytree(SOURCE,RELEASE,ignore=shutil.ignore_patterns('__pycache__','*.pyc','tests','.venv'))
 run(['/usr/bin/python3','-m','venv',str(RELEASE/'.venv')])
 python=str(RELEASE/'.venv/bin/python')
 run([python,'-m','pip','install','--disable-pip-version-check','-r',str(RELEASE/'requirements-production.lock')])
 run([python,'-m','pip','check'])
 # Release files contain no secrets; make root-installed source/venv readable to the existing service user.
 for path in [RELEASE]+list(RELEASE.rglob('*')):
  if path.is_symlink():continue
  os.chmod(path,0o755 if path.is_dir() or path.stat().st_mode&0o111 else 0o644)
 # Reuse the current managed certificate, without creating another account or reading keys into this utility.
 tls_renew.ensure()
 BASE.mkdir(mode=0o700,exist_ok=True);need(BASE.resolve()==BASE and BASE.stat().st_uid==0 and not BASE.stat().st_mode&0o077,'UNSAFE_BACKUP_DIRECTORY')
 directory=BASE/datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ');directory.mkdir(mode=0o700)
 proposed=dict(old);proposed.update(json.loads((SOURCE/'deploy/production-config.patch.json').read_text()))
 candidate=(json.dumps(proposed,indent=2)+'\n').encode()
 dropin=('[Service]\nWorkingDirectory='+str(RELEASE)+'\nExecStart=\nExecStart='+python+' -m photo_auth.production --config '+str(CONFIG)+'\nRestart=on-failure\nRestartSec=5\n').encode()
 tls_service=('[Unit]\nDescription=Azhen existing photo TLS renewal guard\nAfter=network-online.target\n[Service]\nType=oneshot\nExecStart=/usr/bin/python3 '+str(RELEASE/'deploy/tls_renew.py')+'\nRestart=on-failure\nRestartSec=30min\n').encode()
 tls_timer=b'[Unit]\nDescription=Azhen existing photo TLS renewal guard\n[Timer]\nOnBootSec=10min\nOnUnitActiveSec=12h\nRandomizedDelaySec=5min\n[Install]\nWantedBy=timers.target\n'
 backup_service=('[Unit]\nDescription=Azhen private photo metadata backup\n[Service]\nType=oneshot\nUser=azhen-photo-auth\nGroup=azhen-photo-auth\nWorkingDirectory='+str(RELEASE)+'\nExecStart='+python+' -m photo_auth.backup --config '+str(CONFIG)+'\nUMask=0077\n').encode()
 backup_timer=b'[Unit]\nDescription=Azhen private photo metadata backup\n[Timer]\nOnCalendar=daily\nPersistent=true\n[Install]\nWantedBy=timers.target\n'
 updates={'config':(CONFIG,candidate),'nginx':(NGINX,cors(raw(NGINX))),'dropin':(DROP,dropin),'tls_service':(TLS_SERVICE,tls_service),'tls_timer':(TLS_TIMER,tls_timer),'backup_service':(BACKUP_SERVICE,backup_service),'backup_timer':(BACKUP_TIMER_FILE,backup_timer)}
 manifest={'version':VERSION,'previously_enabled':subprocess.run(['systemctl','is-enabled','--quiet',UNIT],capture_output=True).returncode==0,'timers':{timer:{'enabled':subprocess.run(['systemctl','is-enabled','--quiet',timer],capture_output=True).returncode==0,'active':subprocess.run(['systemctl','is-active','--quiet',timer],capture_output=True).returncode==0} for timer in (TIMER,BACKUP_TIMER)},'files':{}}
 for name,(path,value) in updates.items():
  before=raw(path) if path.exists() else None
  if before is not None:atomic(directory/name,before)
  manifest['files'][name]={'path':str(path),'before':sha(before) if before is not None else None,'after':sha(value)}
  if before is not None:
   info=path.stat();manifest['files'][name].update(mode=stat.S_IMODE(info.st_mode),uid=info.st_uid,gid=info.st_gid)
 # Consistent SQLite backup includes WAL, but rollback never discards new photoId rows.
 temporary=database.parent/('.deployment-backup-'+directory.name+'.sqlite')
 backup_code="import sqlite3,sys,os; fd=os.open(sys.argv[2],os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600); os.close(fd); src=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); dst=sqlite3.connect(sys.argv[2]); src.backup(dst); dst.close(); src.close()"
 run(['runuser','-u','azhen-photo-auth','--','/usr/bin/python3','-c',backup_code,str(database),str(temporary)])
 info=temporary.lstat();need(temporary.resolve()==temporary and stat.S_ISREG(info.st_mode) and info.st_uid==owner.pw_uid,'UNSAFE_METADATA_SNAPSHOT')
 shutil.copyfile(temporary,directory/'metadata.sqlite');os.chmod(directory/'metadata.sqlite',0o600);temporary.unlink()
 atomic(directory/'manifest.json',(json.dumps(manifest,indent=2)+'\n').encode())
 atomic(BASE/'CURRENT',(str(directory)+'\n').encode())
 try:
  for unit in ('azhen-photo-live-a3-close.timer','azhen-photo-live-a3-close.service'):
   stopped=subprocess.run(['systemctl','stop',unit],capture_output=True,timeout=60)
   need(stopped.returncode==0 or run(['systemctl','show',unit,'--property=LoadState','--value'])=='not-found','OLD_WINDOW_GUARD_NOT_STOPPED')
  for name,(path,value) in updates.items():
   row=manifest['files'][name];need((sha(raw(path)) if path.exists() else None)==row['before'],'CONFIG_CHANGED_DURING_DEPLOY')
   atomic(path,value,0o644 if name not in ('config',) else 0o640)
  run(['nginx','-t']);run(['systemctl','daemon-reload'])
  run(['runuser','-u','azhen-photo-auth','--',python,'-m','photo_auth.production','--config',str(CONFIG),'--check-config'],cwd=RELEASE)
  run(['systemctl','restart',UNIT],90);healthy()
  need(raw(CONFIG)==candidate,'CONFIG_CHANGED_AFTER_RESTART')
  run(['systemctl','reload','nginx']);public_checks();run(['systemctl','enable',UNIT,TIMER,BACKUP_TIMER]);run(['systemctl','start',TIMER,BACKUP_TIMER])
  run(['systemctl','start','azhen-photos-backup.service'])
  run(['systemctl','is-active','--quiet',UNIT]);run(['systemctl','is-active','--quiet',TIMER])
  run(['systemctl','is-active','--quiet',BACKUP_TIMER]);need(raw(CONFIG)==candidate,'CONFIG_CHANGED_AFTER_DEPLOY')
  print('PHOTO_PRODUCTION_READY_NO_OBJECT_REQUESTS')
  print('DEVICE_PAIRING_READY_RUN_PAIR_ONCE_PER_DEVICE')
 except BaseException:
  rollback(directory);raise
def main():
 need(os.geteuid()==0,'ROOT_REQUIRED');os.umask(0o077)
 action=sys.argv[1] if len(sys.argv)==2 else ''
 if action=='apply':apply()
 elif action=='rollback':
  directory=P(raw(BASE/'CURRENT').decode().strip());need(directory.parent==BASE and directory.resolve()==directory,'UNSAFE_BACKUP_POINTER');rollback(directory)
 elif action=='pair':
  need(json.loads(raw(CONFIG)).get('deploymentMode')=='production','PRODUCTION_DEPLOYMENT_REQUIRED');healthy()
  command=['runuser','-u','azhen-photo-auth','--',str(RELEASE/'.venv/bin/python'),'-m','photo_auth.device_admin','--config',str(CONFIG),'pair']
  # Pair code goes only to the administrator's terminal, never to build logs or chat.
  result=subprocess.run(command,cwd=RELEASE);need(result.returncode==0,'PAIRING_CODE_CREATION_FAILED')
 elif action=='pause':
  before=raw(CONFIG);value=json.loads(before);need(value.get('deploymentMode')=='production' and value.get('prefix')==PREFIX,'EXPECTED_PRODUCTION_CONFIGURATION')
  value.update(uploadsEnabled=False,readsEnabled=False,headNetworkEnabled=False)
  need(raw(CONFIG)==before,'CONFIG_CHANGED_DURING_PAUSE');atomic(CONFIG,(json.dumps(value,indent=2)+'\n').encode());run(['systemctl','restart',UNIT],90);healthy()
  print('PHOTO_PRODUCTION_PAUSED_OBJECTS_METADATA_AND_NOTES_PRESERVED')
 else:raise RuntimeError('EXPECTED_APPLY_ROLLBACK_PAIR_OR_PAUSE')
if __name__=='__main__':
 try:
  with open('/run/azhen-photos-deploy.lock','a') as lock:
   fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);main()
 except BaseException as error:
  code=error.args[0] if isinstance(error,RuntimeError) and error.args and re.fullmatch('[A-Z_]+',str(error.args[0])) else 'DEPLOY_FAILED_NO_SECRET_DETAILS'
  print(code);raise SystemExit(1)
