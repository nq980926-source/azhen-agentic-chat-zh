"""Single bounded incident inspection. Never deploys, restarts, or modifies data."""
import datetime
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import subprocess
import sys
import time

BASE = Path('/var/backups/azhen-photos-production')
RELEASE = Path('/opt/azhen-photo-auth/releases/0.51.28-rc.1-tlsfix.1')
UNIT = 'azhen-photo-auth.service'
ALLOWED_FILES = {
    'config': '/etc/azhen-photo-auth/config.json',
    'nginx': '/etc/nginx/conf.d/azhen-mcp-access.conf',
    'dropin': '/etc/systemd/system/azhen-photo-auth.service.d/50-photos-production.conf',
    'backup_service': '/etc/systemd/system/azhen-photos-backup.service',
    'backup_timer': '/etc/systemd/system/azhen-photos-backup.timer',
}


def need(ok):
    if not ok:
        raise RuntimeError('INSPECTION_BOUNDARY_STOP')


def read(path, limit=262144):
    info = path.lstat()
    need(path.resolve() == path and stat.S_ISREG(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022 and info.st_size <= limit)
    return path.read_bytes()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def command(args, timeout=20):
    try:
        result = subprocess.run(args, capture_output=True, timeout=timeout)
        return result.returncode, result.stdout[:2097152]
    except Exception:
        return -1, b''


def prop(unit, key):
    code, data = command(['systemctl', 'show', unit, '--property=' + key, '--value'])
    return data.decode(errors='replace').strip() if code == 0 else ''


def event(message):
    """Never return log text, URLs, paths, user names, arguments or config values."""
    if 'photo_auth_startup_or_runtime_failed' in message:
        return {'kind': 'application_startup_failed'}
    match = re.search(r'route=(health|pair) status=(\d{3})(?:\s|$)', message)
    if match:
        return {'kind': match[1] + '_response', 'status': int(match[2])}
    match = re.search(r'status=(\d+)/(EXEC|USER|GROUP|CHDIR|NAMESPACE)', message)
    if match:
        return {'kind': 'systemd_execution_failed', 'reason': match[2], 'status': int(match[1])}
    for prefix, name in (('Started ', 'started'), ('Starting ', 'starting'),
                         ('Stopping ', 'stopping'), ('Stopped ', 'stopped'),
                         ('Reloaded ', 'reloaded'), ('Reloading ', 'reloading')):
        if message.startswith(prefix):
            return {'kind': name}
    match = re.search(r'code=exited, status=(\d+)/', message)
    if match:
        return {'kind': 'process_exited', 'status': int(match[1])}
    return None


CHILD = r'''
import contextlib,io,json,logging,os,re,sys
result={'check':'dependency_and_sdk_initialization','ok':False}
def audit(name,args):
 if name in ('socket.connect','socket.bind','socket.getaddrinfo','sqlite3.connect','subprocess.Popen','os.mkdir','os.remove','os.rename','os.chmod','os.chown'):
  raise PermissionError('diagnostic_mutation_or_network_forbidden')
 if name=='open' and len(args)>2 and isinstance(args[2],int) and args[2] & (os.O_WRONLY|os.O_RDWR|os.O_CREAT|os.O_TRUNC|os.O_APPEND):
  raise PermissionError('diagnostic_write_forbidden')
sys.addaudithook(audit)
logging.disable(logging.CRITICAL)
try:
 with contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):
  sys.path.insert(0,sys.argv[1])
  from photo_auth.production import load_config,ConfigError
  from qcloud_cos import CosConfig,CosS3Client
  from waitress import serve
  c,secrets=load_config('/etc/azhen-photo-auth/config.json')
  config=CosConfig(Region=c['region'],SecretId=secrets['secretId'],SecretKey=secrets['secretKey'],Token=None,Scheme='https',Timeout=10,
   AllowRedirects=False,VerifySSL=True,SignHost=True,EnableSessionAuth=False,EnableGatewayDnsLb=False,AutoSwitchDomainOnRetry=False)
  client=CosS3Client(config,retry=0)
  result['ok']=True
except BaseException as error:
 classes={'ConfigError','CosUnavailable','ImportError','ModuleNotFoundError','PermissionError','TypeError','OSError','AttributeError'}
 result['error_class']=type(error).__name__ if type(error).__name__ in classes else 'OTHER'
 known_options={'Region','SecretId','SecretKey','Token','Scheme','Timeout','AllowRedirects','VerifySSL','SignHost','EnableSessionAuth','EnableGatewayDnsLb','AutoSwitchDomainOnRetry','retry'}
 match=re.search(r"unexpected keyword argument ['\"]([A-Za-z_]+)['\"]",str(error))
 if type(error).__name__=='TypeError' and match and match[1] in known_options:result['unsupported_sdk_option']=match[1]
 if type(error).__name__=='ModuleNotFoundError' and getattr(error,'name',None) in {'qcloud_cos','waitress','requests','Crypto','crcmod','photo_auth','xmltodict'}:result['missing_module']=error.name
 codes={'linux_permissions_required','unsafe_owner','unsafe_file_type','unsafe_permissions','unsafe_group','absolute_canonical_path_required','config_too_large','invalid_config','config_fields','credential_fields','credential_value','unsupported database schema'}
 if type(error).__name__=='ConfigError' and str(error) in codes:result['safe_code']=str(error)
print(json.dumps(result))
'''


def inspect():
    need(os.geteuid() == 0)
    directory = Path(read(BASE / 'CURRENT').decode().strip())
    need(directory.parent == BASE and directory.resolve() == directory)
    manifest = json.loads(read(directory / 'manifest.json'))
    need(manifest.get('service_build') == '0.51.28-rc.1-tlsfix.1')
    stamp = datetime.datetime.strptime(directory.name, '%Y%m%dT%H%M%S.%fZ').replace(tzinfo=datetime.timezone.utc).timestamp()
    report = {'result': 'FINAL_PHOTO_INCIDENT_READ_ONLY', 'incident_utc': datetime.datetime.fromtimestamp(stamp, datetime.timezone.utc).isoformat()}
    restored = {}
    backups_ok = True
    for name, row in manifest['files'].items():
        need(name in ALLOWED_FILES and row['path'] == ALLOWED_FILES[name])
        path = Path(row['path'])
        before = row['before']
        if before is None:
            restored[name] = not path.exists() and not path.is_symlink()
        else:
            backups_ok = backups_ok and digest(read(directory / name)) == before
            restored[name] = path.exists() and digest(read(path)) == before
            if restored[name]:
                info = path.stat()
                restored[name] = (stat.S_IMODE(info.st_mode), info.st_uid, info.st_gid) == (row['mode'], row['uid'], row['gid'])
    need(set(manifest['files']) == set(ALLOWED_FILES))
    current = json.loads(read(Path(ALLOWED_FILES['config'])))
    report['configuration_restored'] = restored
    report['backup_hashes_ok'] = backups_ok
    snapshot = directory / 'metadata.sqlite'
    need(snapshot.resolve() == snapshot and stat.S_ISREG(snapshot.lstat().st_mode))
    connection = sqlite3.connect(snapshot.as_uri() + '?mode=ro&immutable=1', uri=True)
    try:
        report['sqlite_snapshot_integrity_ok'] = connection.execute('PRAGMA quick_check').fetchone()[0] == 'ok'
        columns = {row[1] for row in connection.execute('PRAGMA table_info(intents)')}
        report['sqlite_snapshot_schema_compatible'] = {'owner','op','photo','object_key','batch','bytes','params','state','integrity','binding','bucket','region','created','updated','lease'} <= columns
    finally:
        connection.close()
    report['disk_switches_all_false'] = all(current.get(key) is False for key in ('uploadsEnabled','readsEnabled','headNetworkEnabled'))
    report['photo_service_active'] = prop(UNIT, 'ActiveState') == 'active'
    report['original_enable_state_restored'] = (prop(UNIT, 'UnitFileState') == 'enabled') == manifest['previously_enabled']
    report['new_release_active'] = str(RELEASE) in prop(UNIT, 'ExecStart')
    timer = 'azhen-photos-backup.timer'
    prior = manifest['timers'][timer]
    report['backup_timer_state_restored'] = ((prop(timer, 'UnitFileState') == 'enabled') == prior['enabled'] and (prop(timer, 'ActiveState') == 'active') == prior['active'])
    report['existing_tls_timer_active'] = prop('azhen-mcp-cert-renew.timer', 'ActiveState') == 'active'
    report['nginx_syntax_ok'] = command(['nginx', '-t'])[0] == 0
    healthy = False
    http = http.client.HTTPConnection('127.0.0.1', 8001, timeout=10)
    try:
        http.request('GET', '/photos/v1/healthz')
        response = http.getresponse()
        value = json.loads(response.read(4096))
        healthy = response.status == 200 and value.get('data', {}).get('database') == 'available'
    except Exception:
        pass
    finally:
        http.close()
    report['restored_service_health_ok'] = healthy
    report['rollback_verified'] = all(restored.values()) and backups_ok and report['sqlite_snapshot_integrity_ok'] and healthy and report['photo_service_active'] and report['original_enable_state_restored'] and report['backup_timer_state_restored'] and not report['new_release_active'] and report['nginx_syntax_ok']
    report['recovery_has_priority'] = not report['rollback_verified']
    expected = json.loads((Path(__file__).parent / 'EXPECTED_TLSFIX1.json').read_text())
    report['installed_bundle_matches_published'] = all(digest(read(RELEASE / name, 2097152)) == wanted for name, wanted in expected.items())
    preflight = {'ok': False, 'safe_code': 'INSTALLED_BUNDLE_NOT_VERIFIED'}
    if report['installed_bundle_matches_published']:
        code, data = command(['runuser','-u','azhen-photo-auth','--',str(RELEASE / '.venv/bin/python'),'-B','-I','-c',CHILD,str(RELEASE)], 30)
        if code == 0:
            try:
                parsed = json.loads(data)
                if set(parsed) <= {'check','ok','error_class','safe_code','unsupported_sdk_option','missing_module'}:
                    preflight = parsed
            except Exception:
                preflight = {'ok': False, 'safe_code': 'PRECHECK_OUTPUT_UNAVAILABLE'}
        else:
            preflight = {'ok': False, 'safe_code': 'PRECHECK_PROCESS_FAILED'}
    report['preflight'] = preflight
    code, raw = command(['journalctl','-u',UNIT,'-u','nginx.service','-u','azhen-photos-backup.service','--since=@' + str(int(stamp)-2),'--until=@' + str(int(min(time.time(),stamp+3600))),'-n','600','--no-pager','-o','json'], 30)
    timeline = []
    for line in raw.splitlines():
        try:
            row = json.loads(line)
            unit = row.get('UNIT') or row.get('_SYSTEMD_UNIT')
            if unit not in (UNIT, 'nginx.service', 'azhen-photos-backup.service'):
                continue
            item = event(str(row.get('MESSAGE', '')))
            if item:
                item.update(unit={'nginx.service':'nginx',UNIT:'photo','azhen-photos-backup.service':'backup'}[unit], offset_ms=int((int(row['__REALTIME_TIMESTAMP']) / 1000000 - stamp) * 1000))
                timeline.append(item)
        except Exception:
            continue
    report['journal_available'] = code == 0
    report['timeline'] = sorted(timeline, key=lambda item: item['offset_ms'])[:60]
    report['failure_stage_proven'] = 'PROTECTED_APPLY_AFTER_METADATA_BACKUP'
    report['source_confirmed_gaps'] = ['original_exception_class_and_stage_not_recorded','no_readiness_wait_after_restart','rollback_success_marker_did_not_check_health']
    report['root_cause'] = 'NOT_PROVEN'
    starts = [item for item in timeline if item['unit']=='photo' and item['kind']=='started']
    if starts:
        start = min(item['offset_ms'] for item in starts)
        stops = [item['offset_ms'] for item in timeline if item['unit']=='photo' and item['kind']=='stopping' and item['offset_ms'] > start]
        end = min(stops) if stops else 3600000
        new = [item for item in timeline if start <= item['offset_ms'] < end and item['unit']=='photo']
        report['failure_stage_proven'] = 'PHOTO_RESTART_OR_LATER'
        failures = [item for item in new if item['kind']=='systemd_execution_failed']
        if failures:
            report['root_cause'] = 'SYSTEMD_' + failures[0]['reason'] + '_FAILED'
            report['failure_stage_proven'] = 'PHOTO_PROCESS_LAUNCH'
        elif any(item['kind']=='application_startup_failed' for item in new) and not preflight.get('ok'):
            report['failure_stage_proven'] = 'PHOTO_APPLICATION_STARTUP'
            if preflight.get('unsupported_sdk_option'):
                report['root_cause'] = 'SDK_UNSUPPORTED_OPTION_' + preflight['unsupported_sdk_option']
            elif preflight.get('missing_module'):
                report['root_cause'] = 'MISSING_MODULE_' + preflight['missing_module']
    report['known_blockers'] = [key for key in ('installed_bundle_matches_published','sqlite_snapshot_schema_compatible','rollback_verified') if not report[key]]
    if not preflight.get('ok'):
        report['known_blockers'].append('dependency_or_sdk_precheck_failed')
    report['decision'] = 'ROOT_CAUSE_EVIDENCE_AVAILABLE_FOR_REVIEW' if report['root_cause'] != 'NOT_PROVEN' else 'STOP_PROJECT_IF_NO_ADDITIONAL_EXISTING_EVIDENCE'
    report['configurations_modified'] = False
    report['deployment_or_restart_performed'] = False
    report['cos_requests_performed'] = False
    print(json.dumps(report, separators=(',', ':')))


if __name__ == '__main__':
    try:
        inspect()
    except Exception:
        print('{"result":"FINAL_INSPECTION_INCOMPLETE_NO_SECRET_DETAILS","decision":"STOP_NEW_DEPLOYMENT","configurations_modified":false}')
        sys.exit(1)
