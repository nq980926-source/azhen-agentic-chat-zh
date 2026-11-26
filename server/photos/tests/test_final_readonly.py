"""Checks limited to the one permitted final incident diagnostic."""
import ast
import importlib.util
import json
from pathlib import Path
import unittest

source = Path(__file__).resolve().parents[1] / 'deploy/final_failure_readonly.py'
spec = importlib.util.spec_from_file_location('final_inspection', source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FinalReadOnly(unittest.TestCase):
    def test_arbitrary_log_values_are_not_emitted(self):
        self.assertIsNone(module.event('Authorization: Bearer NEVER_PRINT token=NEVER_PRINT https://host/signature?secret=NEVER_PRINT'))
        value = module.event('NEVER_PRINT photo_auth_startup_or_runtime_failed NEVER_PRINT')
        self.assertNotIn('NEVER_PRINT', json.dumps(value))

    def test_only_allowed_journal_details_survive(self):
        self.assertEqual(module.event('log request=private route=health status=503'), {'kind': 'health_response', 'status': 503})
        self.assertEqual(module.event('status=203/EXEC private text'), {'kind': 'systemd_execution_failed','reason':'EXEC','status':203})

    def test_parent_and_helper_use_python_312_syntax(self):
        ast.parse(source.read_text(), feature_version=(3,12))
        ast.parse(module.CHILD, feature_version=(3,12))
        self.assertIn("'socket.connect'", module.CHILD)
        self.assertIn("'sqlite3.connect'", module.CHILD)
        self.assertIn('os.O_WRONLY', module.CHILD)

    def test_parent_has_no_filesystem_write_or_deploy_calls(self):
        tree = ast.parse(source.read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
                self.assertNotIn(node.func.attr, ('write_text','write_bytes','unlink','mkdir','chmod','chown'))
        self.assertNotIn("'restart'", source.read_text())
        self.assertNotIn("'reload'", source.read_text())


if __name__ == '__main__':
    unittest.main()
