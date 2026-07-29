import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import yaml

import multi_program_agent as mpa


class MultiProgramConfigTests(unittest.TestCase):
    def load_example(self, directory):
        value = yaml.safe_load(Path("multi_program_config.example.yaml").read_text())
        value["global"]["audit_dir"] = str(Path(directory) / "evidence")
        value["global"]["duplicate_db"] = str(
            Path(directory) / "evidence" / "dedupe.sqlite3"
        )
        path = Path(directory) / "config.yaml"
        path.write_text(yaml.safe_dump(value, sort_keys=False), encoding="utf-8")
        return mpa.MultiProgramConfig(str(path)), value, path

    def test_three_profiles_encode_required_modes_and_rates(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            config, _, _ = self.load_example(temp_dir)
            mattermost = config.profile("mattermost", require_ready=False)
            files = config.profile("files", require_ready=False)
            amazon = config.profile("amazon", require_ready=False)
        self.assertEqual(mattermost.mode, "self_hosted_only")
        self.assertEqual(mattermost.exact_host, "127.0.0.1")
        self.assertEqual(files.allowed_methods, frozenset({"GET", "HEAD", "OPTIONS"}))
        self.assertLessEqual(files.max_rps, 2)
        self.assertLessEqual(amazon.max_rps, 5)
        self.assertTrue(amazon.required_user_agent.startswith("amazonvrpresearcher_"))

    def test_live_profiles_reject_identity_placeholders(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            config, _, _ = self.load_example(temp_dir)
            for program_id in mpa.PROGRAM_IDS:
                with self.subTest(program_id=program_id), self.assertRaises(ValueError):
                    config.profile(program_id, require_ready=True)

    def test_remote_mattermost_and_invalid_program_hosts_are_rejected(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            _config, value, path = self.load_example(temp_dir)
            value["programs"]["mattermost"]["base_url"] = (
                "https://community.mattermost.com"
            )
            path.write_text(yaml.safe_dump(value), encoding="utf-8")
            with self.assertRaises(ValueError):
                mpa.MultiProgramConfig(str(path)).profile(
                    "mattermost", require_ready=False
                )

            value["programs"]["mattermost"]["base_url"] = "http://127.0.0.1:8065"
            value["programs"]["files"]["assigned_host"] = "app.files.com"
            path.write_text(yaml.safe_dump(value), encoding="utf-8")
            with self.assertRaises(ValueError):
                mpa.MultiProgramConfig(str(path)).profile("files", require_ready=False)

            value["programs"]["files"]["assigned_host"] = "research.files.com"
            value["programs"]["amazon"]["marketplace_host"] = "console.aws.amazon.com"
            path.write_text(yaml.safe_dump(value), encoding="utf-8")
            with self.assertRaises(ValueError):
                mpa.MultiProgramConfig(str(path)).profile("amazon", require_ready=False)


class ProgramPolicyTests(unittest.TestCase):
    def profile(self):
        return mpa.ProgramProfile(
            program_id="files",
            display_name="Files",
            mode="bounded_production",
            exact_host="research.files.com",
            scheme="https",
            port=443,
            required_user_agent="H1Research/researcher",
            max_rps=1,
            hard_max_rps=2,
            request_budget=5,
            allowed_methods=frozenset({"GET", "HEAD", "OPTIONS"}),
            known_urls=("https://research.files.com/api/items?id=own-test-item",),
            test_email="researcher@wearehackerone.com",
            hackerone_username="researcher",
        )

    def test_known_read_only_request_passes(self):
        policy = mpa.ProgramPolicy(self.profile())
        request = mpa.RequestSpec(
            name="baseline",
            method="GET",
            url="https://research.files.com/api/items?id=second-owned-test-item",
        )
        policy.validate_plan([request])

    def test_new_path_method_query_and_host_are_blocked(self):
        policy = mpa.ProgramPolicy(self.profile())
        requests = [
            mpa.RequestSpec("new-path", "GET", "https://research.files.com/api/other"),
            mpa.RequestSpec(
                "post", "POST", "https://research.files.com/api/items?id=x"
            ),
            mpa.RequestSpec(
                "query", "GET", "https://research.files.com/api/items?token=x"
            ),
            mpa.RequestSpec("host", "GET", "https://app.files.com/api/items?id=x"),
        ]
        for request in requests:
            with self.subTest(request=request.name), self.assertRaises(PermissionError):
                policy.validate_request(request)

    def test_budget_and_duplicate_plan_names_are_blocked(self):
        profile = self.profile()
        policy = mpa.ProgramPolicy(profile)
        request = mpa.RequestSpec(
            "same", "GET", "https://research.files.com/api/items?id=own"
        )
        with self.assertRaises(ValueError):
            policy.validate_plan([request, request])
        many = [
            mpa.RequestSpec(
                f"request-{index}",
                "GET",
                f"https://research.files.com/api/items?id={index}",
            )
            for index in range(6)
        ]
        with self.assertRaises(ValueError):
            policy.validate_plan(many)


class FakeAIResponse:
    status_code = 200

    def __init__(self, text):
        self.text = text

    def json(self):
        return {"content": [{"text": self.text}]}


class BoundedAIPlannerTests(unittest.TestCase):
    def build(self, directory):
        value = yaml.safe_load(Path("multi_program_config.example.yaml").read_text())
        value["global"]["duplicate_db"] = str(Path(directory) / "dedupe.sqlite3")
        value["programs"]["files"].update(
            {
                "assigned_host": "research.files.com",
                "hackerone_username": "researcher",
                "test_email": "researcher@wearehackerone.com",
                "required_user_agent": "H1Research/researcher",
                "known_urls": ["https://research.files.com/api/ping"],
            }
        )
        path = Path(directory) / "config.yaml"
        path.write_text(yaml.safe_dump(value), encoding="utf-8")
        with patch.dict("os.environ", {"AGENT_API_KEY": "not-real"}):
            config = mpa.MultiProgramConfig(str(path))
            planner = mpa.BoundedAIPlanner(config)
        return planner, config.profile("files", require_ready=True)

    def test_valid_ai_plan_is_policy_checked(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            planner, profile = self.build(temp_dir)
            response = FakeAIResponse(
                json.dumps(
                    {
                        "program": "files",
                        "requests": [
                            {
                                "name": "baseline",
                                "method": "GET",
                                "url": "https://research.files.com/api/ping",
                                "body": "",
                            }
                        ],
                    }
                )
            )
            with patch.object(mpa.requests, "post", return_value=response):
                requests_out = planner.generate(profile, "baseline")
            self.assertEqual(len(requests_out), 1)

    def test_ai_cannot_invent_path(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            planner, profile = self.build(temp_dir)
            response = FakeAIResponse(
                json.dumps(
                    {
                        "program": "files",
                        "requests": [
                            {
                                "name": "invented",
                                "method": "GET",
                                "url": "https://research.files.com/admin",
                                "body": "",
                            }
                        ],
                    }
                )
            )
            with (
                patch.object(mpa.requests, "post", return_value=response),
                self.assertRaises(PermissionError),
            ):
                planner.generate(profile, "find admin")


class DuplicateRegistryTests(unittest.TestCase):
    def test_prevents_local_duplicates_by_root_cause(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            registry = mpa.DuplicateRegistry(Path(temp_dir) / "dedupe.sqlite3")
            first, fingerprint = registry.reserve(
                "amazon",
                "IDOR",
                "/orders/12345",
                "order_id",
                "missing ownership check in order controller",
            )
            second, same_fingerprint = registry.reserve(
                "amazon",
                "idor",
                "/orders/99999",
                "order_id",
                "Missing ownership check in order controller",
            )
            self.assertTrue(first)
            self.assertFalse(second)
            self.assertEqual(fingerprint, same_fingerprint)
            registry.mark("amazon", fingerprint, "submitted", "H1-123")
            self.assertEqual(registry.rows()[0][5], "submitted")

    def test_same_root_cause_is_separate_between_programs(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            registry = mpa.DuplicateRegistry(Path(temp_dir) / "dedupe.sqlite3")
            one, _ = registry.reserve("files", "XSS", "/x", "q", "missing encoding")
            two, _ = registry.reserve("amazon", "XSS", "/x", "q", "missing encoding")
            self.assertTrue(one)
            self.assertTrue(two)


class ConcurrentOrchestratorTests(unittest.TestCase):
    def test_three_workers_run_concurrently_in_dry_run_without_network(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            value = yaml.safe_load(
                Path("multi_program_config.example.yaml").read_text()
            )
            value["global"]["audit_dir"] = str(root / "evidence")
            value["global"]["duplicate_db"] = str(root / "evidence" / "dedupe.sqlite3")
            value["programs"]["files"]["assigned_host"] = "research.files.com"
            value["programs"]["files"]["known_urls"] = [
                "https://research.files.com/api/ping"
            ]
            value["programs"]["amazon"]["known_urls"] = [
                "https://www.amazon.com/robots.txt"
            ]
            config_path = root / "config.yaml"
            config_path.write_text(yaml.safe_dump(value), encoding="utf-8")
            plans = root / "plans"
            plans.mkdir()
            urls = {
                "mattermost": "http://127.0.0.1:8065/api/v4/system/ping",
                "files": "https://research.files.com/api/ping",
                "amazon": "https://www.amazon.com/robots.txt",
            }
            for program_id, url in urls.items():
                plan = {
                    "program": program_id,
                    "requests": [{"name": "baseline", "method": "GET", "url": url}],
                }
                (plans / f"{program_id}.json").write_text(
                    json.dumps(plan), encoding="utf-8"
                )
            orchestrator = mpa.ConcurrentOrchestrator(
                mpa.MultiProgramConfig(str(config_path)), plans, dry_run=True
            )
            results = orchestrator.run()
            self.assertEqual(
                {result.program_id for result in results}, set(mpa.PROGRAM_IDS)
            )
            self.assertTrue(all(result.status == "complete" for result in results))
            self.assertTrue(all(len(result.requests) == 1 for result in results))
            self.assertTrue(orchestrator.audit.path.exists())

    def test_sensitive_data_guard_stops_on_structured_pii(self):
        self.assertIsNotNone(
            mpa.SensitiveDataGuard.detect(
                'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{"email":"other@example.test"}'
            )
        )
        self.assertIsNone(
            mpa.SensitiveDataGuard.detect(
                "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nhealthy"
            )
        )


if __name__ == "__main__":
    unittest.main()
