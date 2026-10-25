"""No Docker commands, external networking, real credentials, or real data access."""
import asyncio
import importlib.util
import ipaddress
import os
from pathlib import Path
import struct
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

import yaml
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "render"))
import service
import tcp_forwarder as forwarder

spec = importlib.util.spec_from_file_location("poc_consumer", ROOT / "windows/consumer.py")
consumer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(consumer)
TEST_SECRET = "unit-test-only-not-a-real-secret"


class IsolationTests(unittest.TestCase):
    def test_compose_isolation(self):
        config = yaml.safe_load((ROOT / "compose.windows.yml").read_text())
        self.assertEqual(config["name"], "irads-render-poc")
        for volume in config["volumes"].values():
            self.assertTrue(volume["name"].startswith("irads_render_poc_"))
            self.assertNotIn("external", volume)
        publications = []
        for svc in config["services"].values():
            for binding in svc.get("ports", []):
                self.assertTrue(binding.startswith("127.0.0.1:"))
                publications.append(binding)
            for mount in svc.get("volumes", []):
                self.assertTrue(mount.split(":")[0] in config["volumes"] or mount.startswith("./windows/init.sql:"))
        self.assertEqual(len(publications), 3)
        self.assertTrue(config["networks"]["poc"]["internal"])
        kafka = config["services"]["kafka"]["environment"]
        self.assertIn("RENDER://127.0.0.1:19092", kafka["KAFKA_ADVERTISED_LISTENERS"])
        self.assertIn("irads-poc-events", config["services"]["kafka-init"]["command"][0])

    def test_credentials_required(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(ValueError, "POC_DB_PASSWORD"):
                service.validate_environment()
        with patch.dict(os.environ, {k: TEST_SECRET for k in ("POC_DB_PASSWORD", "POC_REDIS_PASSWORD", "POC_PROBE_TOKEN")}, clear=True):
            service.validate_environment()

    def test_tailnet_target_only(self):
        self.assertEqual(forwarder.validate_target("100.100.1.2"), "100.100.1.2")
        for target in ("127.0.0.1", "8.8.8.8", "192.168.1.1", "::1", "example.com"):
            with self.subTest(target=target), self.assertRaises(ValueError):
                forwarder.validate_target(target)

    def test_metadata_rejects_wrong_listener(self):
        service.assert_metadata([SimpleNamespace(host="127.0.0.1", port=19092)])
        for host, port in (("kafka", 29092), ("localhost", 9092), ("100.100.1.2", 19092)):
            with self.assertRaises(RuntimeError):
                service.assert_metadata([SimpleNamespace(host=host, port=port)])
        with self.assertRaises(RuntimeError):
            service.assert_metadata([])

    def test_only_test_events(self):
        from uuid import uuid4
        event = {"id": str(uuid4()), "source": service.SOURCE}
        self.assertEqual(consumer.validate_event(event), event)
        for value in ({"id": event["id"], "source": "irads"}, {"source": service.SOURCE, "id": "bad"}, []):
            with self.assertRaises((ValueError, KeyError)):
                consumer.validate_event(value)


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"POC_PROBE_TOKEN": TEST_SECRET})
        self.env.start()
        self.client = TestClient(service.app)

    def tearDown(self):
        self.client.close()
        self.env.stop()

    def test_liveness_and_no_public_diagnostics(self):
        self.assertEqual(self.client.get("/healthz").json(), {"status": "alive"})
        for method in (self.client.get, self.client.post):
            self.assertEqual(method("/probe").status_code, 401)
            self.assertEqual(method("/probe", headers={"X-POC-Token": "wrong"}).status_code, 401)
        self.assertEqual(self.client.get("/docs").status_code, 404)

    def test_read_only_and_error_status(self):
        for status, code in (("ok", 200), ("error", 503)):
            result = {name: {"status": status} for name in ("postgres", "redis", "kafka")}
            with patch.object(service, "connectivity", AsyncMock(return_value=result)), patch.object(service, "check_kafka", AsyncMock()) as delivery:
                response = self.client.get("/probe", headers={"X-POC-Token": TEST_SECRET})
                self.assertEqual(response.status_code, code)
                self.assertEqual(response.json()["checks"], result)
                self.assertEqual(response.json()["instance"], service.INSTANCE)
                delivery.assert_not_awaited()

    def test_delivery_route(self):
        result = {name: {"status": "ok"} for name in ("postgres", "redis", "kafka")}
        with patch.object(service, "connectivity", AsyncMock(return_value=result)), patch.object(service, "check_redis", AsyncMock(return_value={"status": "ok", "readback": True})) as redis, patch.object(service, "check_kafka", AsyncMock(return_value={"status": "ok", "readback": True, "windows_consumer": True})) as kafka:
            response = self.client.post("/probe", headers={"X-POC-Token": TEST_SECRET})
            self.assertEqual(response.status_code, 200)
            redis.assert_awaited_once_with(write=True)
            kafka.assert_awaited_once_with(delivery=True)


class AsyncTests(unittest.IsolatedAsyncioTestCase):
    async def test_error_messages_redacted(self):
        async def fail():
            raise RuntimeError("secret must not appear")
        self.assertEqual(await service.bounded(fail()), {"status": "error", "error_type": "RuntimeError"})

    async def test_timeout(self):
        result = await service.bounded(asyncio.sleep(10), timeout=0.01)
        self.assertEqual(result, {"status": "error", "error_type": "TimeoutError"})

    async def test_postgres_closed(self):
        conn = MagicMock(fetchrow=AsyncMock(return_value={"db": service.DATABASE, "postgis": "test-version"}), fetchval=AsyncMock(), close=AsyncMock())
        with patch.object(service, "postgres_connect", AsyncMock(return_value=conn)):
            self.assertEqual((await service.check_postgres())["status"], "ok")
        conn.close.assert_awaited_once()

    async def test_redis_ttl_and_close(self):
        client = MagicMock(ping=AsyncMock(return_value=True), set=AsyncMock(), get=AsyncMock(), aclose=AsyncMock())
        async def capture(key, value, ex):
            client.get.return_value = value
        client.set.side_effect = capture
        with patch.object(service, "redis_connect", return_value=client):
            self.assertTrue((await service.check_redis(write=True))["readback"])
        self.assertTrue(client.set.call_args.args[0].startswith("irads:poc:"))
        self.assertEqual(client.set.call_args.kwargs["ex"], 60)
        client.aclose.assert_awaited_once()

    async def test_full_kafka_delivery_and_windows_recorder(self):
        producer = MagicMock(start=AsyncMock(), stop=AsyncMock())
        producer.client.cluster.brokers.return_value = [SimpleNamespace(host="127.0.0.1", port=19092)]
        kafka_consumer = MagicMock(start=AsyncMock(), stop=AsyncMock(), seek_to_end=AsyncMock())
        async def publish(topic, payload, partition):
            self.assertEqual(topic, "irads-poc-events")
            self.assertEqual(partition, 0)
            kafka_consumer.getmany.return_value = {"partition": [SimpleNamespace(value=payload)]}
            return SimpleNamespace(partition=0, offset=42)
        producer.send_and_wait = AsyncMock(side_effect=publish)
        kafka_consumer.getmany = AsyncMock()
        conn = MagicMock(fetchval=AsyncMock(return_value=True), close=AsyncMock())
        with patch.object(service, "AIOKafkaProducer", return_value=producer), patch.object(service, "AIOKafkaConsumer", return_value=kafka_consumer), patch.object(service, "postgres_connect", AsyncMock(return_value=conn)):
            result = await service.check_kafka(delivery=True)
        self.assertTrue(result["readback"])
        self.assertTrue(result["windows_consumer"])
        self.assertEqual(result["offset"], 42)
        self.assertIn("poc_deliveries", conn.fetchval.call_args.args[0])
        kafka_consumer.seek_to_end.assert_awaited_once()
        producer.stop.assert_awaited_once()
        kafka_consumer.stop.assert_awaited_once()
        conn.close.assert_awaited_once()

    async def test_bad_kafka_metadata_closes_producer(self):
        producer = MagicMock(start=AsyncMock(), stop=AsyncMock())
        producer.client.cluster.brokers.return_value = [SimpleNamespace(host="kafka", port=29092)]
        with patch.object(service, "AIOKafkaProducer", return_value=producer):
            with self.assertRaises(RuntimeError):
                await service.check_kafka()
        producer.stop.assert_awaited_once()

    async def test_socks_handshake_and_bidirectional_relay(self):
        handshakes = []
        async def socks(reader, writer):
            try:
                self.assertEqual(await reader.readexactly(3), b"\x05\x01\x00")
                writer.write(b"\x05\x00")
                await writer.drain()
                request = await reader.readexactly(10)
                handshakes.append(request)
                writer.write(b"\x05\x00\x00\x01\x7f\x00\x00\x01\x00\x00")
                await writer.drain()
                while data := await reader.read(65536):
                    writer.write(data)
                    await writer.drain()
            finally:
                writer.close()
                await writer.wait_closed()
        proxy = await asyncio.start_server(socks, "127.0.0.1", 0)
        proxy_port = proxy.sockets[0].getsockname()[1]
        tasks = []
        async def handle(reader, writer):
            task = asyncio.create_task(forwarder.relay(reader, writer, "100.100.1.2", 15433, proxy_port))
            tasks.append(task)
            await task
        bridge = await asyncio.start_server(handle, "127.0.0.1", 0)
        try:
            reader, writer = await asyncio.open_connection("127.0.0.1", bridge.sockets[0].getsockname()[1])
            payload = b"binary-protocol\x00\xff" * 10000
            writer.write(payload)
            await writer.drain()
            self.assertEqual(await asyncio.wait_for(reader.readexactly(len(payload)), 3), payload)
            writer.write_eof()
            self.assertEqual(await asyncio.wait_for(reader.read(), 3), b"")
            writer.close()
            await writer.wait_closed()
            await asyncio.wait_for(asyncio.gather(*tasks), 3)
            self.assertEqual(handshakes[0], b"\x05\x01\x00\x01" + ipaddress.IPv4Address("100.100.1.2").packed + struct.pack("!H", 15433))
        finally:
            bridge.close()
            proxy.close()
            await bridge.wait_closed()
            await proxy.wait_closed()

    async def test_socks_denial(self):
        async def deny(reader, writer):
            await reader.readexactly(3)
            writer.write(b"\x05\xff")
            await writer.drain()
            writer.close()
            await writer.wait_closed()
        proxy = await asyncio.start_server(deny, "127.0.0.1", 0)
        try:
            with self.assertRaises(ConnectionError):
                await forwarder.open_socks("100.100.1.2", 15433, proxy.sockets[0].getsockname()[1])
        finally:
            proxy.close()
            await proxy.wait_closed()


if __name__ == "__main__":
    unittest.main()
