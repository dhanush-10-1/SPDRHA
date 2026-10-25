"""Start private networking before the real IRADS FastAPI application."""
import asyncio
import os
from pathlib import Path
import signal
import sys
from uuid import uuid4

from tcp_forwarder import open_socks, validate_target

SOCKET = "/tmp/irads-real-tailscaled.sock"
PORTS = (25433, 26379, 29093)


async def main():
    target = validate_target(os.environ["IRADS_LAPTOP_TS_IP"])
    keyfile = Path(os.getenv("TAILSCALE_AUTHKEY_FILE", "/etc/secrets/tailscale-authkey"))

    if not keyfile.is_file():
        raise RuntimeError("Real backend Tailscale secret file is missing")

    port = int(os.getenv("PORT", "10000"))
    if not 1 <= port <= 65535 or port in (*PORTS, 1055):
        raise ValueError("Invalid HTTP port")

    children = []
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()

    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)

    async def spawn(*args, quiet=False):
        process = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.DEVNULL if quiet else None,
            stderr=asyncio.subprocess.DEVNULL if quiet else None,
        )
        children.append(process)
        return process

    try:
        await spawn(
            "tailscaled",
            "--tun=userspace-networking",
            "--state=mem:",
            "--socket=" + SOCKET,
            "--socks5-server=127.0.0.1:1055",
            quiet=True,
        )

        authenticated = False

        for attempt in range(12):
            if stop.is_set():
                return

            if not Path(SOCKET).exists():
                await asyncio.sleep(2)
                continue

            auth = await asyncio.create_subprocess_exec(
                "tailscale",
                "--socket=" + SOCKET,
                "up",
                "--auth-key=file:" + str(keyfile),
                "--hostname=irads-render-real-" + uuid4().hex[:8],
                "--accept-dns=false",
                "--accept-routes=false",
                "--timeout=20s",
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )

            if await auth.wait() == 0:
                authenticated = True
                print("Real IRADS Tailscale enrollment succeeded", flush=True)
                break

            print("Tailscale enrollment unsuccessful", flush=True)
            await asyncio.sleep(5)

        if not authenticated:
            raise RuntimeError("Tailscale enrollment failed")

        await spawn(sys.executable, "tcp_forwarder.py")

        for attempt in range(20):
            if stop.is_set():
                return

            try:
                for remote_port in PORTS:
                    reader, writer = await asyncio.wait_for(
                        open_socks(target, remote_port), timeout=8
                    )
                    writer.close()
                    await writer.wait_closed()

                print("Real IRADS private connections reachable", flush=True)
                break

            except (OSError, ConnectionError, asyncio.TimeoutError,
                    asyncio.IncompleteReadError):
                if attempt == 19:
                    raise RuntimeError("Private backend connections unavailable")
                await asyncio.sleep(3)

        api = await spawn(
            sys.executable,
            "-m",
            "uvicorn",
            "backend.main:app",
            "--host",
            "0.0.0.0",
            "--port",
            str(port),
            "--workers",
            "1",
            "--no-access-log",
        )

        stopping = asyncio.create_task(stop.wait())
        exited = asyncio.create_task(api.wait())

        done, pending = await asyncio.wait(
            [stopping, exited],
            return_when=asyncio.FIRST_COMPLETED,
        )

        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)

        if exited in done and not stop.is_set():
            raise RuntimeError("Real FastAPI process exited")

    finally:
        for child in reversed(children):
            if child.returncode is None:
                child.terminate()

        for child in reversed(children):
            try:
                await asyncio.wait_for(child.wait(), timeout=10)
            except asyncio.TimeoutError:
                child.kill()
                await child.wait()


if __name__ == "__main__":
    asyncio.run(main())
