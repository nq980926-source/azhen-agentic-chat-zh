"""Diagnostic-only privacy and read-only command checks; no cloud calls."""
import ast
import base64
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'deploy'))
import tls_diagnostic as diagnostic


class TLSReadOnlyDiagnostic(unittest.TestCase):
    def test_commands_do_not_echo_credentials_or_raw_arguments(self):
        secret = 'NEVER_PRINT_THIS_SECRET_238ab6'
        summary, wrappers = diagnostic.command_summary(
            '/opt/acme/acme.sh --cron --home /opt/acme --config-home /var/lib/acme '
            '--api-token ' + secret + ' https://user:' + secret + '@example.invalid/')
        self.assertNotIn(secret, json.dumps(summary) + str(wrappers))
        self.assertEqual(summary['config_homes'], ['/opt/acme', '/var/lib/acme'])
        self.assertEqual(summary['engines'], ['acme.sh'])

    def test_only_required_config_fields_are_collected(self):
        result = diagnostic.fields("Le_Domain='106.55.92.40'\nCOS_SECRET_KEY='never-print'\nDNS_TOKEN='never-print'\nLe_RealFullChainPath='/etc/nginx/ssl/photo.pem'\n")
        self.assertEqual(result, {'Le_Domain': '106.55.92.40', 'Le_RealFullChainPath': '/etc/nginx/ssl/photo.pem'})

    def test_hook_classification_never_returns_raw_command(self):
        safe = 'nginx -t && systemctl reload nginx'
        encoded = '__ACME_BASE64__START_' + base64.b64encode(safe.encode()).decode() + '__ACME_BASE64__END_'
        self.assertEqual(diagnostic.hook_kind(encoded), 'nginx_reload_only')
        self.assertEqual(diagnostic.hook_kind('systemctl stop nginx; token=never-print'), 'review_required')
        self.assertEqual(diagnostic.hook_kind(''), 'absent')

    def test_urls_and_shell_expansion_are_not_reported_as_paths(self):
        for value in ('https://host/?token=secret', '/tmp/$(secret)', '/tmp/secret;stop', '${HOME}/.acme.sh'):
            self.assertIsNone(diagnostic.path_value(value))
        self.assertEqual(diagnostic.path_value('/opt/acme/conf'), '/opt/acme/conf')

    def test_external_commands_are_read_only_allowlisted(self):
        tree = ast.parse(Path(diagnostic.__file__).read_text())
        count = 0
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == 'run':
                self.assertIsInstance(node.args[0], ast.List)
                values = node.args[0].elts
                prefix = [value.value for value in values[:2] if isinstance(value, ast.Constant)]
                self.assertIn(prefix, [
                    ['openssl', 'x509'], ['crontab', '-l'], ['systemctl', 'list-unit-files'],
                    ['systemctl', 'show'], ['systemctl', 'is-active'], ['nginx', '-t']])
                count += 1
        self.assertGreaterEqual(count, 8)
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
                self.assertNotIn(node.func.attr, ('write_text', 'write_bytes', 'unlink', 'mkdir', 'chmod', 'chown'))
                if node.func.attr == 'replace':
                    self.assertEqual([value.value for value in node.args if isinstance(value, ast.Constant)], [':', ''])


if __name__ == '__main__':
    unittest.main()
