"""Validate the already installed custom Certbot renewal, without running it."""
import configparser
import pathlib
import re
import shlex
import shutil

ROOT = pathlib.Path('/etc/azhen-mcp/letsencrypt')
TIMER = 'azhen-mcp-cert-renew.timer'
SERVICE = 'azhen-mcp-cert-renew.service'


def validate(safe, run, need, safe_hook, certificate):
    files = []

    def text(path):
        path = safe(path)
        need(path.stat().st_size <= 262144, 'TLS_CONFIGURATION_TOO_LARGE')
        files.append(path)
        return path.read_text()

    def property(unit, name):
        result = run(['systemctl', 'show', unit, '--property=' + name, '--value'], 15)
        need(result.returncode == 0, 'TLS_EXISTING_UNIT_INSPECTION_FAILED')
        return result.stdout.decode().strip()

    def fingerprint(path):
        result = run(['openssl', 'x509', '-in', str(safe(path)), '-noout', '-fingerprint', '-sha256'], 15)
        value = result.stdout.decode().strip().split('=')[-1].replace(':', '').lower()
        need(result.returncode == 0 and re.fullmatch('[a-f0-9]{64}', value), 'TLS_PUBLIC_CERTIFICATE_INVALID')
        return value

    renewal = ROOT / 'renewal/azhen-mcp-ip.conf'
    config = configparser.RawConfigParser(strict=True)
    config.read_string('[certificate]\n' + text(renewal))
    chain = pathlib.Path(config.get('certificate', 'fullchain'))
    need(chain.is_absolute() and fingerprint(chain) == fingerprint(certificate), 'TLS_CUSTOM_CERTIFICATE_MISMATCH')
    params = config['renewalparams']
    need(params.get('authenticator') in ('webroot', 'nginx'), 'TLS_NONSTOP_RENEWAL_REQUIRED')
    hooks = [params.get(name, '') for name in ('pre_hook', 'post_hook', 'deploy_hook', 'renew_hook')]
    need(all(safe_hook(hook) for hook in hooks), 'TLS_EXISTING_HOOK_REQUIRES_REVIEW')
    reload_found = any(hook.strip() for hook in hooks)
    renew_found = False
    inspected = set()

    def command(value, wrapper=False):
        nonlocal reload_found, renew_found
        need(not re.search(r'[$`%<>|]', value), 'TLS_DYNAMIC_COMMAND_REQUIRES_REVIEW')
        if safe_hook(value):
            if value.strip():
                reload_found = True
            return
        if re.fullmatch(r'(?:/usr/sbin/|/sbin/)?nginx -t', value.strip()):
            return
        args = shlex.split(value)
        need(bool(args), 'TLS_EMPTY_COMMAND')
        executable = pathlib.Path(args[0])
        if executable.name == 'certbot':
            if not executable.is_absolute():
                found = shutil.which('certbot')
                need(found is not None, 'TLS_EXISTING_CERTBOT_REQUIRED')
                executable = pathlib.Path(found)
            need(executable.is_absolute(), 'TLS_CERTBOT_ABSOLUTE_PATH_REQUIRED')
            safe(executable)
            need(len(args) > 1 and args[1] == 'renew', 'TLS_ONLY_EXISTING_RENEW_ALLOWED')
            values = {}
            index = 2
            while index < len(args):
                token = args[index]
                if token in ('--quiet', '-q', '--no-directory-hooks', '--non-interactive', '-n', '--no-random-sleep-on-renew'):
                    index += 1
                    continue
                key, separator, content = token.partition('=')
                need(key in ('--config-dir', '--work-dir', '--logs-dir', '--cert-name', '--deploy-hook', '--post-hook', '--pre-hook', '--renew-before-expiry'), 'TLS_RENEW_ARGUMENT_REQUIRES_REVIEW')
                if not separator:
                    need(index + 1 < len(args), 'TLS_RENEW_ARGUMENT_MISSING')
                    content = args[index + 1]
                    index += 1
                need(key not in values, 'TLS_DUPLICATE_RENEW_ARGUMENT')
                values[key] = content
                index += 1
            need(values.get('--config-dir') == str(ROOT), 'TLS_CUSTOM_CONFIG_DIR_MISMATCH')
            need(values.get('--cert-name', 'azhen-mcp-ip') == 'azhen-mcp-ip', 'TLS_CERT_NAME_CHANGED')
            for key in ('--work-dir', '--logs-dir'):
                if key in values:
                    need(bool(re.fullmatch(r'/[A-Za-z0-9_./-]+', values[key])), 'TLS_UNSAFE_RENEW_DIRECTORY')
            for key in ('--deploy-hook', '--post-hook', '--pre-hook'):
                if key in values:
                    need(safe_hook(values[key]), 'TLS_EXISTING_HOOK_REQUIRES_REVIEW')
                    reload_found = reload_found or bool(values[key].strip())
            renew_found = True
            return
        if executable.name in ('bash', 'sh') and executable.is_absolute() and len(args) == 2:
            safe(executable)
            executable = pathlib.Path(args[1])
        else:
            need(len(args) == 1, 'TLS_WRAPPER_ARGUMENTS_REQUIRE_REVIEW')
        need(not wrapper and executable.is_absolute() and executable not in inspected, 'TLS_WRAPPER_REQUIRES_REVIEW')
        inspected.add(executable)
        for line in text(executable).splitlines():
            line = line.strip()
            if not line or line.startswith('#') or line in ('set -e', 'set -eu', 'set -euo pipefail', 'set -eu -o pipefail'):
                continue
            command(line, wrapper=True)

    def directives(unit):
        fragment = pathlib.Path(property(unit, 'FragmentPath'))
        need(fragment.is_absolute(), 'TLS_EXISTING_UNIT_FILE_REQUIRED')
        paths = [fragment] + [pathlib.Path(value) for value in shlex.split(property(unit, 'DropInPaths'))]
        result = {}
        for path in paths:
            contents = text(path).replace('\\\n', '')
            for line in contents.splitlines():
                match = re.fullmatch(r'\s*([A-Za-z][A-Za-z0-9]*)\s*=(.*)', line)
                if match:
                    key, value = match[1], match[2].strip()
                    if not value:
                        result[key] = []
                    else:
                        result.setdefault(key, []).append(value)
        return result

    need(property(TIMER, 'ActiveState') == 'active' and property(TIMER, 'UnitFileState') == 'enabled', 'TLS_EXISTING_TIMER_NOT_PERSISTENT')
    need(property(TIMER, 'Unit') == SERVICE, 'TLS_EXISTING_TIMER_TARGET_CHANGED')
    timer = directives(TIMER)
    need(any(timer.get(key) for key in ('OnCalendar', 'OnUnitActiveSec', 'OnUnitInactiveSec')), 'TLS_EXISTING_TIMER_NOT_RECURRING')
    service = directives(SERVICE)
    need(service.get('User', ['root']) == ['root'], 'TLS_RENEW_SERVICE_USER_CHANGED')
    need(not any(service.get(key) for key in ('Environment', 'EnvironmentFile', 'ExecCondition', 'RootDirectory', 'RootImage')), 'TLS_SERVICE_ENVIRONMENT_REQUIRES_REVIEW')
    for key in ('ExecStartPre', 'ExecStart', 'ExecStartPost'):
        for value in service.get(key, []):
            command(value)
    need(renew_found and reload_found, 'TLS_RENEW_AND_SAFE_RELOAD_REQUIRED')
    # Certbot can also load cli.ini and directory hooks. Validate these, too.
    ini = ROOT / 'cli.ini'
    if ini.exists():
        ini_config = configparser.RawConfigParser()
        ini_config.read_string('[options]\n' + text(ini))
        allowed = {'email', 'agree-tos', 'non-interactive', 'quiet', 'config-dir', 'work-dir', 'logs-dir', 'server'}
        need(set(ini_config['options']) <= allowed, 'TLS_CLI_CONFIGURATION_REQUIRES_REVIEW')
    hooks_dir = ROOT / 'renewal-hooks'
    if hooks_dir.is_dir():
        for path in hooks_dir.glob('*/*'):
            if path.is_file() and path.stat().st_mode & 0o111:
                for line in text(path).splitlines():
                    if line.strip() and not line.lstrip().startswith('#'):
                        need(safe_hook(line.strip()) or line.strip() == 'set -e', 'TLS_DIRECTORY_HOOK_REQUIRES_REVIEW')
    return tuple(dict.fromkeys(files))
