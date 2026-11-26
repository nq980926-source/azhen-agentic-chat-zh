"""Targeted renewal inspection fixtures; no COS or renewal commands."""
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'deploy'))
import existing_tls
import tls_renew


class ExistingTLS(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.previous = existing_tls.ROOT
        existing_tls.ROOT = self.root / 'letsencrypt'
        renewal = existing_tls.ROOT / 'renewal'
        renewal.mkdir(parents=True)
        self.cert = self.root / 'public.pem'
        openssl = r'D:\Git\usr\bin\openssl.exe' if sys.platform == 'win32' else 'openssl'
        self.openssl = openssl
        subprocess.run([openssl, 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', str(self.root / 'fixture.key'), '-out', str(self.cert), '-days', '3', '-subj', '/CN=106.55.92.40'], check=True, capture_output=True)
        self.renewal = renewal / 'azhen-mcp-ip.conf'
        self.renewal.write_text('fullchain = ' + str(self.cert) + '\n[renewalparams]\nauthenticator = webroot\ndeploy_hook = nginx -t && systemctl reload nginx\n')
        self.timer = self.root / 'renew.timer'
        self.timer.write_text('[Timer]\nOnCalendar=daily\n')
        self.service = self.root / 'renew.service'
        self.service.write_text('[Service]\nExecStart="' + (self.root / 'certbot').as_posix() + '" renew --config-dir "' + str(existing_tls.ROOT) + '" --quiet\n')
        self.enabled = 'enabled'
        self.calls = []

    def tearDown(self):
        existing_tls.ROOT = self.previous
        self.tmp.cleanup()

    def inspect_command(self, args, timeout):
        self.calls.append(args)
        if args[0] == 'openssl':
            return subprocess.run([self.openssl] + args[1:], capture_output=True, timeout=timeout)
        self.assertEqual(args[:2], ['systemctl', 'show'])
        unit, key = args[2], args[3].removeprefix('--property=')
        value = {'ActiveState': 'active', 'UnitFileState': self.enabled, 'Unit': existing_tls.SERVICE, 'DropInPaths': '', 'FragmentPath': str(self.timer if unit == existing_tls.TIMER else self.service)}[key]
        return SimpleNamespace(returncode=0, stdout=(value + '\n').encode())

    def validate(self):
        return existing_tls.validate(lambda path: path, self.inspect_command, tls_renew.need, tls_renew.safe_hook, self.cert)

    def test_custom_config_and_existing_timer_are_reused_without_execution(self):
        files = self.validate()
        self.assertIn(self.renewal, files)
        self.assertTrue(all(args[0] in ('openssl', 'systemctl') for args in self.calls))

    def test_disabled_timer_stops(self):
        self.enabled = 'disabled'
        with self.assertRaisesRegex(RuntimeError, 'TLS_EXISTING_TIMER_NOT_PERSISTENT'):
            self.validate()

    def test_stop_nginx_hook_stops(self):
        self.renewal.write_text(self.renewal.read_text().replace('nginx -t && systemctl reload nginx', 'systemctl stop nginx'))
        with self.assertRaisesRegex(RuntimeError, 'TLS_EXISTING_HOOK_REQUIRES_REVIEW'):
            self.validate()

    def test_standalone_challenge_stops(self):
        self.renewal.write_text(self.renewal.read_text().replace('webroot', 'standalone'))
        with self.assertRaisesRegex(RuntimeError, 'TLS_NONSTOP_RENEWAL_REQUIRED'):
            self.validate()

    def test_new_certificate_request_is_rejected(self):
        self.service.write_text(self.service.read_text().replace(' renew --config-dir', ' certonly --config-dir'))
        with self.assertRaisesRegex(RuntimeError, 'TLS_ONLY_EXISTING_RENEW_ALLOWED'):
            self.validate()

    def test_runtime_no_longer_creates_duplicate_tls_jobs(self):
        source = (Path(existing_tls.__file__).parent / 'manage.py').read_text()
        self.assertNotIn("'tls_service':", source)
        self.assertNotIn("'tls_timer':", source)
        self.assertNotIn("UNIT,TIMER,BACKUP_TIMER", source)


if __name__ == '__main__':
    unittest.main()
