import unittest

from app.main import app, health_legacy


class TestHealthRoutes(unittest.TestCase):
    def test_health_legacy_returns_ok(self):
        self.assertEqual(health_legacy(), {"ok": True})

    def test_health_routes_are_registered(self):
        route_paths = {route.path for route in app.routes if hasattr(route, "path")}
        self.assertIn("/health", route_paths)
        self.assertIn("/api/v1/health", route_paths)


if __name__ == "__main__":
    unittest.main()
