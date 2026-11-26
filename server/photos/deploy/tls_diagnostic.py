"""Bounded read-only TLS discovery. No ACME client or hook is executed."""
import base64
import json
import os
from pathlib import Path, PurePosixPath
import re
import shlex
import shutil
import stat
import subprocess
import sys

IP = '106.55.92.40'
PHOTO_CONF = Path('/etc/nginx/conf.d/azhen-mcp-access.conf')
LIMIT = 262144


def run(args):
    try:
        result = subprocess.run(args, capture_output=True, timeout=15)
        return result.returncode, result.stdout.decode(errors='replace')[:LIMIT]
    except Exception:
        return -1, ''


def read(path):
    """Read configuration/scripts only; never follow a private-key filename."""
    try:
        resolved = path.resolve()
        if re.search(r'(?i)(?:privkey|private.?key|credentials|account\.conf|\.key$)', str(resolved)):
            return ''
        info = resolved.stat()
        if not stat.S_ISREG(info.st_mode) or info.st_size > LIMIT or info.st_uid != 0 or info.st_mode & 0o022:
            return ''
        return resolved.read_text(errors='replace')
    except (OSError, ValueError):
        return ''


def path_value(value):
    if value and re.fullmatch(r'/[A-Za-z0-9_./@:+-]{1,220}', value):
        return value
    return None


def fields(text):
    wanted = {'Le_RealFullChainPath', 'Le_RealCertPath', 'Le_Webroot', 'Le_PreHook', 'Le_PostHook',
              'Le_RenewHook', 'Le_ReloadCmd', 'Le_Domain', 'Le_Alt',
              'fullchain', 'cert', 'authenticator', 'archive_dir',
              'pre_hook', 'post_hook', 'deploy_hook', 'renew_hook'}
    result = {}
    for key, value in re.findall(r'(?m)^([A-Za-z_][A-Za-z_0-9]*)[ \t]*=[ \t]*([^\n]*)', text):
        if key not in wanted:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
            value = value[1:-1]
        result[key] = value
    return result


def hook_kind(value):
    if not value:
        return 'absent'
    prefix, suffix = '__ACME_BASE64__START_', '__ACME_BASE64__END_'
    if value.startswith(prefix) and value.endswith(suffix):
        try:
            value = base64.b64decode(value[len(prefix):-len(suffix)], validate=True).decode()
        except Exception:
            return 'review_required'
    value = re.sub(r'(?:/usr)?/(?:s?bin)/', '', value)
    value = ' '.join(value.split())
    if re.fullmatch(r'(?:nginx -t && )?(?:systemctl reload nginx(?:\.service)?|nginx -s reload)', value):
        return 'nginx_reload_only'
    return 'review_required'


def command_summary(text):
    """Return enums/booleans/validated paths, never raw command arguments."""
    engines = [name for name, pattern in (
        ('acme.sh', r'(?<![\w.-])acme\.sh\b'),
        ('certbot', r'(?<![\w.-])(?:certbot|letsencrypt)\b'),
    ) if re.search(pattern, text)]
    homes, wrappers = set(), set()
    try:
        tokens = shlex.split(text, comments=True)
    except ValueError:
        tokens = []
    for index, token in enumerate(tokens):
        value = path_value(token)
        if value:
            if value.endswith('/acme.sh'):
                homes.add(str(PurePosixPath(value).parent))
            if (value.endswith(('.sh', '.py')) or re.search(r'(?i)(?:renew|acme|cert|tls)', Path(value).name)) and not value.endswith('/acme.sh') and Path(value).name not in ('certbot', 'letsencrypt'):
                wrappers.add(value)
        if token in ('--home', '--config-home', '--config-dir') and index + 1 < len(tokens):
            value = path_value(tokens[index + 1])
            if value:
                homes.add(value)
        match = re.fullmatch(r'(?:--(?:home|config-home|config-dir)|LE_WORKING_DIR|LE_CONFIG_HOME)=(.*)', token)
        if match and path_value(match[1]):
            homes.add(match[1])
    return {'engines': engines, 'renew_or_cron': bool(re.search(r'--(?:renew|cron)\b|\brenew\b', text)),
            'nginx_stop_or_restart_mentioned': bool(re.search(r'(?:stop|restart)\s+nginx|nginx\s+(?:stop|restart)|nginx\s+-s\s+(?:stop|quit)', text)),
            'config_homes': sorted(homes)}, wrappers


def public_certificate(path):
    try:
        if not path.is_file() or path.stat().st_size > LIMIT or re.search(r'(?i)(?:privkey|private.?key|\.key$)', str(path.resolve())):
            return None
        code, fingerprint = run(['openssl', 'x509', '-in', str(path), '-noout', '-fingerprint', '-sha256'])
        digest = fingerprint.strip().split('=')[-1].replace(':', '').lower()
        if code != 0 or not re.fullmatch(r'[0-9a-f]{64}', digest):
            return None
        code, dates = run(['openssl', 'x509', '-in', str(path), '-noout', '-enddate'])
        end = dates.strip().removeprefix('notAfter=')
        if not re.fullmatch(r'[A-Za-z0-9 :]+', end):
            end = 'unavailable'
        return {'path': str(path), 'resolved_path': str(path.resolve()), 'sha256': digest,
                'ip_match': run(['openssl', 'x509', '-in', str(path), '-noout', '-checkip', IP])[0] == 0,
                'valid_24h': run(['openssl', 'x509', '-in', str(path), '-noout', '-checkend', '86400'])[0] == 0,
                'valid_48h': run(['openssl', 'x509', '-in', str(path), '-noout', '-checkend', '172800'])[0] == 0,
                'not_after_utc': end}
    except (OSError, ValueError):
        return None


def main():
    if os.geteuid() != 0:
        raise RuntimeError('ROOT_REQUIRED')
    text = read(PHOTO_CONF)
    names = re.findall(r'(?m)^\s*ssl_certificate\s+["\']?(/[^\s;"\']+)["\']?\s*;', text)
    certificates = [item for name in sorted(set(names)) if path_value(name) for item in [public_certificate(Path(name))] if item and item['ip_match']]
    fingerprints = {item['sha256'] for item in certificates}
    report = {'result': 'PHOTO_TLS_READ_ONLY_V1', 'photo_certificates': certificates}
    homes = {Path('/root/.acme.sh'), Path('/etc/acme.sh'), Path('/var/lib/acme'), Path('/opt/acme.sh')}
    for executable in ('acme.sh', 'certbot'):
        found = shutil.which(executable)
        if found and executable == 'acme.sh':
            homes.add(Path(found).resolve().parent)
    if Path('/home').is_dir():
        homes.update(item / '.acme.sh' for item in list(Path('/home').iterdir())[:30] if item.is_dir())
    schedules, wrappers = [], set()

    def schedule(source, contents):
        if not re.search(r'(?i)acme|certbot|letsencrypt|renew|azhen.*tls', contents):
            return
        summary, referenced = command_summary(contents)
        summary['source'] = source
        schedules.append(summary)
        homes.update(Path(path) for path in summary['config_homes'])
        wrappers.update(referenced)

    code, cron = run(['crontab', '-l'])
    if code == 0:
        for number, line in enumerate(cron.splitlines(), 1):
            if line.strip() and not line.lstrip().startswith('#'):
                schedule('root_crontab_line_' + str(number), line)
    cron_files = [Path('/etc/crontab')]
    for directory in ('/etc/cron.d', '/etc/cron.daily', '/etc/cron.hourly', '/etc/cron.weekly'):
        if Path(directory).is_dir():
            cron_files.extend(sorted(Path(directory).iterdir())[:60])
    for path in cron_files:
        content = read(path)
        if content:
            schedule(str(path), content)
    code, units = run(['systemctl', 'list-unit-files', '--type=service', '--type=timer', '--no-legend', '--no-pager'])
    matched_units = []
    if code == 0:
        for line in units.splitlines():
            unit = line.split()[0] if line.split() else ''
            if re.fullmatch(r'[A-Za-z0-9_.@:-]+\.(?:service|timer)', unit) and re.search(r'(?i)acme|cert|letsencrypt|renew|tls', unit):
                matched_units.append(unit)
    for unit in matched_units[:30]:
        code, values = run(['systemctl', 'show', unit, '--property=FragmentPath,DropInPaths,ExecStart,ActiveState,UnitFileState'])
        data = dict(line.split('=', 1) for line in values.splitlines() if '=' in line)
        fragment = path_value(data.get('FragmentPath', ''))
        if fragment:
            sources = [read(Path(fragment)), data.get('ExecStart', '')]
            for dropin in data.get('DropInPaths', '').split()[:10]:
                if path_value(dropin):
                    sources.append(read(Path(dropin)))
            summary, referenced = command_summary('\n'.join(sources))
            summary.update(source=unit, active=data.get('ActiveState') in ('active', 'activating'), enabled=data.get('UnitFileState') == 'enabled')
            schedules.append(summary)
            homes.update(Path(path) for path in summary['config_homes'])
            wrappers.update(referenced)
    for path in sorted(wrappers)[:20]:
        contents = read(Path(path))
        if contents:
            summary, unused = command_summary(contents)
            summary['source'] = path
            schedules.append(summary)
            homes.update(Path(value) for value in summary['config_homes'])
    report['renewal_mechanisms'] = schedules[:50]
    configs = []
    certbot_dirs = {Path('/etc/letsencrypt')} | homes
    certbot_files = sorted({path for directory in certbot_dirs for path in (directory / 'renewal').glob('*.conf')})[:60]
    for path in certbot_files:
        values = fields(read(path))
        chain = path_value(values.get('fullchain', ''))
        cert = public_certificate(Path(chain)) if chain else None
        if (cert and cert['sha256'] in fingerprints) or IP in path.name:
            configs.append({'engine': 'certbot', 'config': str(path), 'matches_current_certificate': bool(cert and cert['sha256'] in fingerprints),
                            'fullchain_path': chain, 'authenticator': values.get('authenticator') if values.get('authenticator') in ('webroot', 'nginx', 'standalone', 'manual') else 'other_or_absent',
                            'hooks': {key: hook_kind(values.get(key)) for key in ('pre_hook', 'post_hook', 'deploy_hook', 'renew_hook')}})
    acme_scanned = 0
    for home in sorted(homes, key=str)[:24]:
        if not home.is_dir():
            continue
        for path in sorted(home.glob('*/*.conf'))[:100]:
            if path.name in ('account.conf', 'http.header') or not read(path):
                continue
            acme_scanned += 1
            values = fields(read(path))
            chain = path_value(values.get('Le_RealFullChainPath', ''))
            installed = public_certificate(Path(chain)) if chain else None
            cert_path = path_value(values.get('Le_RealCertPath', ''))
            installed_cert = public_certificate(Path(cert_path)) if cert_path else None
            local = public_certificate(path.parent / 'fullchain.cer')
            matches = any(cert and cert['sha256'] in fingerprints for cert in (installed, installed_cert, local))
            if not matches and values.get('Le_Domain') != IP and IP not in path.name:
                continue
            webroot = values.get('Le_Webroot', '')
            configs.append({'engine': 'acme.sh', 'config': str(path), 'home': str(home), 'client_present': (home / 'acme.sh').is_file(),
                            'matches_current_certificate': matches, 'installed_fullchain_path': chain, 'installed_cert_path': cert_path,
                            'local_fullchain_matches': bool(local and local['sha256'] in fingerprints),
                            'webroot_kind': 'absolute_path' if path_value(webroot) else 'nginx' if webroot in ('nginx', 'nginx:') or webroot.startswith('nginx:/etc/nginx/') else 'other_or_absent',
                            'webroot_path': path_value(webroot),
                            'hooks': {key: hook_kind(values.get(key)) for key in ('Le_PreHook', 'Le_PostHook', 'Le_RenewHook', 'Le_ReloadCmd')}})
    report['matching_renewal_configs'] = configs[:10]
    report['discovery_counts'] = {'certbot_configs': len(certbot_files), 'acme_configs': acme_scanned}
    report['nginx_syntax_ok'] = run(['nginx', '-t'])[0] == 0
    report['photo_service_active'] = run(['systemctl', 'is-active', '--quiet', 'azhen-photo-auth.service'])[0] == 0
    report['configuration_changed'] = False
    report['services_reloaded_or_restarted'] = False
    report['acme_or_renewal_commands_executed'] = False
    print(json.dumps(report, ensure_ascii=True, separators=(',', ':')))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('{"result":"PHOTO_TLS_DIAGNOSTIC_STOP_NO_CHANGES_NO_SECRET_DETAILS"}')
        sys.exit(1)
