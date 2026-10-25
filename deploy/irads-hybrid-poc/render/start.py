"""One-container supervisor. Opens Render HTTP early; never prints auth-key output."""
import asyncio
import os
from pathlib import Path
import signal
import sys
from uuid import uuid4

from service import validate_environment
from tcp_forwarder import validate_target

SOCKET = "/tmp/irads-poc-tailscaled.sock"


async def main():
    validate_environment()
    validate_target(os.environ["POC_LAPTOP_TS_IP"])
    port = int(os.getenv("PORT", "10000"))
    if not 1 <= port <= 65535 or port in (1055, 15433, 16379, 19092):
        raise ValueError("PORT must be valid and not a POC forwarding port")
    keyfile = Path(os.getenv("TAILSCALE_AUTHKEY_FILE", "/etc/secrets/tailscale-authkey"))
    if not keyfile.is_file():
        raise ValueError("Supply the runtime Tailscale auth-key secret file")
    children = []
    auth_process = None
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)

    async def spawn(*args, quiet=False):
        process = await asyncio.create_subprocess_exec(
            *args, stdout=asyncio.subprocess.DEVNULL if quiet else None,
            stderr=asyncio.subprocess.DEVNULL if quiet else None,
        )
        children.append(process)
        return process

    async def authenticate():
        nonlocal auth_process
        while not stop.is_set():
            if not Path(SOCKET).exists():
                await asyncio.sleep(0.5)
                continue
            auth_process = await asyncio.create_subprocess_exec(
                "tailscale", "--socket=" + SOCKET, "up",
                "--auth-key=file:" + str(keyfile),
                "--hostname=irads-render-poc-" + str(uuid4())[:8],
                "--accept-dns=false", "--accept-routes=false", "--timeout=20s",
                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
            )
            if await auth_process.wait() == 0:
                print("POC Tailscale enrollment succeeded", flush=True)
                return
            print("POC enrollment failed; check secret, tag grants and key expiry", flush=True)
            await asyncio.sleep(15)

    auth_task = None
    monitors = []
    stopping = None
    try:
        await spawn("tailscaled", "--tun=userspace-networking", "--state=mem:",
                    "--socket=" + SOCKET, "--socks5-server=127.0.0.1:1055", quiet=True)
        await spawn(sys.executable, "tcp_forwarder.py")
        await spawn(sys.executable, "-m", "uvicorn", "service:app", "--host", "0.0.0.0",
                    "--port", str(port), "--workers", "1", "--no-access-log")
        auth_task = asyncio.create_task(authenticate())
        monitors = [asyncio.create_task(child.wait()) for child in children]
        stopping = asyncio.create_task(stop.wait())
        done, _ = await asyncio.wait([*monitors, stopping, auth_task], return_when=asyncio.FIRST_COMPLETED)
        if auth_task in done:
            # Authentication success is not a reason to exit; keep supervising processes.
            await auth_task
            done, _ = await asyncio.wait([*monitors, stopping], return_when=asyncio.FIRST_COMPLETED)
        if stopping not in done:
            raise RuntimeError("POC child exited; restart the whole test service")
    finally:
        if auth_task is not None:
            auth_task.cancel()
            await asyncio.gather(auth_task, return_exceptions=True)
        if auth_process is not None and auth_process.returncode is None:
            children.append(auth_process)
        for child in children:
            if child.returncode is None:
                child.terminate()
        for child in children:
            try:
                await asyncio.wait_for(child.wait(), timeout=10)
            except asyncio.TimeoutError:
                child.kill()
                await child.wait()
        for task in [*monitors, stopping]:
            if task is not None:
                task.cancel()
        await asyncio.gather(*(t for t in [*monitors, stopping] if t is not None), return_exceptions=True)


if __name__ == "__main__":
    asyncio.run(main())
