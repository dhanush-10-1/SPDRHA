# IRADS → Render Free / Windows hybrid proof of concept

**Prepared, not deployed.** This is a standalone networking experiment, not a
production deployment or a change to the IRADS API. It never imports application
code, runs the existing consumer, touches Android, or attaches existing volumes.

## Boundaries and topology

```
authenticated test request → Render HTTPS → diagnostic ASGI service
  → 127.0.0.1:{15433,16379,19092} → local Python TCP bridges
  → tailscaled SOCKS5 (127.0.0.1:1055, userspace networking)
  → encrypted tailnet → Windows Tailscale Serve TCP forwarding
  → Windows loopback Docker bindings → new POC services
Kafka INTERNAL listener → separate POC recorder → new irads_poc database
```

All Docker publications are **127.0.0.1 only**. No router forwarding, Funnel,
public database ports, subnet routers, TUN, privileged Docker, or host networking
are needed. The Render service will eventually have a public HTTPS URL, but only
`/healthz` is anonymous; both diagnostic methods require `X-POC-Token`.

Docker project: `irads-render-poc`. Its new volumes are exactly:

- `irads_render_poc_postgres_v1`
- `irads_render_poc_redis_v1`
- `irads_render_poc_kafka_v1`
- `irads_render_poc_zookeeper_data_v1`
- `irads_render_poc_zookeeper_log_v1`

They are not external volumes and have no production/development references.
If ANY of these names or the project name already exist, stop and investigate;
do not reuse or remove them blindly. Never combine this Compose file with an
existing IRADS file. No cleanup commands are supplied or run.

Images deliberately keep the existing Kafka/PostGIS generation for compatibility.
Tags/direct Python versions are pinned for a reproducible baseline, but tags and
transitive dependencies are not digest/hash locked. Check current advisories and
image availability before an actual deployment; these are not production security
certifications. No TensorFlow or Android build dependencies are installed.

## 1. Windows preflight — read-only

Use PowerShell, Docker Desktop in **Linux container** mode, native Tailscale for
Windows, and sufficient free memory (approximately 4 GB for this additional test
stack). Keep the laptop awake during the experiment. Docker Desktop generally
requires a signed-in user; verify its actual restart behavior instead of assuming
it is an unattended server.

From the repository root:

```powershell
Set-Location deploy/irads-hybrid-poc
docker compose version
docker ps --format '{{.Names}}'
docker volume ls --format '{{.Name}}'
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -in @(15433,16379,19092) }
tailscale status
tailscale serve status
```

Stop if ports, POC containers/volumes, or corresponding Serve forwards already
exist. Do not stop existing IRADS containers or reset existing Serve configuration.
Record the laptop's Tailscale IPv4 address (`tailscale ip -4`).

## 2. Configure only temporary test credentials

Copy `.env.example` to `.env` in this directory. Populate **only** these two values
with distinct randomly generated test-only passwords, each at least 24 characters:

```
POC_DB_PASSWORD=<new test-only password>
POC_REDIS_PASSWORD=<different new test-only password>
```

Use hex/alphanumeric values to avoid shell/Compose interpolation ambiguity. Do not
reuse existing IRADS passwords. `.env` is ignored; restrict its Windows file ACL to
your user. Do not paste values into issues, shell commands, screenshots, or commits.
The PostgreSQL username/database are fixed to `irads_poc` and Kafka topic is fixed
to `irads-poc-events`, in both programs. These are not environment-selectable.

**The following commands are instructions for a later authorized local test.**
Nothing in this PR automatically starts Docker or deploys to Render:

```powershell
docker compose --env-file .env -f compose.windows.yml config --quiet
docker compose --env-file .env -f compose.windows.yml up --build -d
docker compose --env-file .env -f compose.windows.yml ps
docker compose --env-file .env -f compose.windows.yml logs --tail 40 consumer
```

`config --quiet` avoids printing interpolated passwords. The initialization job
creates a single-partition test topic. PostgreSQL creates PostGIS and only the
`poc_deliveries` table. The dedicated consumer validates the POC event marker,
inserts by UUID idempotently, then commits the Kafka offset. It does not execute
IRADS anomaly confirmation or training logic.

Changing `POC_DB_PASSWORD` later does not update a role in an existing initialized
POC volume. Do not delete a volume to solve that. Use a planned credential change
or leave the experiment stopped and investigate.

## 3. Add narrow private tailnet access

Use a dedicated source tag `tag:irads-render-poc`. An administrator should permit
only that identity to the laptop's three POC TCP ports. Example **fragment**, not a
replacement for an existing policy (replace the example IP):

```json
{
  "grants": [{
    "src": ["tag:irads-render-poc"],
    "dst": ["100.100.1.2"],
    "ip": ["tcp:15433", "tcp:16379", "tcp:19092"]
  }]
}
```

Configure tag ownership separately. Existing broad allow rules are additive and
can defeat this restriction; review them and add policy tests. Do not change
existing service access accidentally. Grant neither production ports nor other
laptop hosts. Confirm access denial from an unauthorized test identity.

On Windows, add **only** these dedicated Serve TCP forwards after checking the
current configuration. Confirm syntax with the installed `tailscale serve --help`:

```powershell
tailscale serve --bg --tcp=15433 tcp://127.0.0.1:15433
tailscale serve --bg --tcp=16379 tcp://127.0.0.1:16379
tailscale serve --bg --tcp=19092 tcp://127.0.0.1:19092
tailscale serve status
```

Do not use `tailscale funnel`, `serve reset`, router port forwarding, or a broad
Windows Firewall allow rule. Windows/Render Tailscale transport must be tested;
configuration alone does not establish reachability. Direct or DERP relay
connections can work; relay paths may add latency.

## 4. Temporary Render Free Docker service — manual, not provisioned here

After independently reviewing current Render Free limits and Tailscale policies,
create a **new** test web service (do not repoint an existing service):

| Render setting | Value |
| --- | --- |
| Repository branch | This POC branch |
| Runtime | Docker |
| Root directory | `deploy/irads-hybrid-poc/render` |
| Dockerfile path / build context | `./Dockerfile` / `.` within that root |
| Instance | Free, if currently available |
| Health check path | `/healthz` |
| Persistent disk | None |
| Automatic deployment | Disable while evaluating |

Set these runtime variables using Render's secret UI:

- `POC_LAPTOP_TS_IP`: actual Windows Tailscale IPv4 address, not a public/LAN IP.
- `POC_DB_PASSWORD`, `POC_REDIS_PASSWORD`: only the new POC values from step 2.
- `POC_PROBE_TOKEN`: a third, independent random secret (at least 24 characters).
- `TAILSCALE_AUTHKEY_FILE`: `/etc/secrets/tailscale-authkey` (the default).

Add a Render **secret file** named `tailscale-authkey`. Its contents must be only a
short-validity, preauthorized, reusable, ephemeral Tailscale auth key tagged
`tag:irads-render-poc`. Never put this key in Git, the image, a build argument, a
URL, or a command line. The supervisor passes only the secret file's pathname to
`tailscale up` and suppresses enrollment command output.

Use a reusable key for this limited experiment: memory-only identities cannot
re-enroll on restart using a consumed single-use key. Expiry/revocation prevents
future registrations; revoke the test key/device access when the test is finished
through a separately reviewed action. Tagged-node expiry behavior and auth-key
expiry are distinct; do not assume one revokes the other. Longer-running use
should evaluate scoped OAuth-generated ephemeral auth keys instead.

The image starts non-root `tailscaled --tun=userspace-networking --state=mem:`,
three **loopback** TCP bridges, and one Uvicorn worker on `0.0.0.0:$PORT`. Render
provides public HTTPS termination. No sidecar, persistent identity, Caddy, or
additional public ports are needed. Python clients do not support `ALL_PROXY`
automatically; the SOCKS5 bridge carries their native binary protocols unchanged.

The HTTP process starts before enrollment completes so Render can detect its
port even if the laptop is offline. `/healthz` proves only the HTTP process is
alive. **Authenticated `GET /probe` is dependency readiness** and returns 503
while enrollment, services, or metadata are not ready. A child process failure
stops the container; authentication failures retry without printing secret values.

## 5. Exact protocol tests

Render Free shell access is not assumed. Use the supplied Windows script; it
prompts for the probe token securely and refuses redirects or non-Render URLs:

```powershell
# Metadata/connectivity only; no test data inserted:
./windows/Test-RenderPoc.ps1 -BaseUrl https://YOUR-POC.onrender.com/
# Redis TTL key + Kafka send/readback + separate Windows consumer verification:
./windows/Test-RenderPoc.ps1 -BaseUrl https://YOUR-POC.onrender.com/ -Delivery
```

Requests without `X-POC-Token` must receive **401** for both GET and POST `/probe`.
Never put the token in a query string. `/docs` and `/openapi.json` are disabled.
The script permits a long initial cold-start timeout and prints only probe results.
A failing probe responds 503 with an error *type*, not a credential-bearing traceback.

| Check | Exact operation | Evidence required |
| --- | --- | --- |
| PostgreSQL | `SELECT current_database(), PostGIS_Version()` plus a read from `poc_deliveries` | `database=irads_poc`, nonempty PostGIS version, `status=ok` |
| Redis GET probe | Authenticated `PING` | `status=ok` |
| Redis delivery probe | Set UUID-prefixed `irads:poc:*` key with `EX 60`, then GET | `readback=true`; key expires without cleanup |
| Kafka metadata | Fetch cluster broker metadata via producer | Every broker is exactly `127.0.0.1:19092`; otherwise fail |
| Kafka delivery | `send_and_wait` a UUID POC event to partition 0 | Acknowledged `partition=0` and `offset` |
| Kafka readback | Group-less test consumer seeks to end before publishing | Exact new event UUID is read back |
| Windows consumer | Poll isolated PostgreSQL for that event UUID | `windows_consumer=true` |

A successful POST returns HTTP 200 with all statuses `ok`, an `instance` UUID,
Kafka `event_id`, `readback=true`, and `windows_consumer=true`. A TCP-open check or
bootstrap-only success is insufficient.

### Why the Kafka advertised address is loopback

The Render-only broker listener advertises **127.0.0.1:19092**, matching the local
Render bridge. Kafka redirects clients to that address after bootstrap. The POC
Windows consumer receives **kafka:29092** from the separate INTERNAL listener.
Do not use this Render listener from an ordinary tailnet client without its own
matching forwarder. This is a single-broker test; multiple brokers would require
distinct local endpoints/advertisements. Existing Kafka configuration is untouched.

## 6. Restart and failure recovery (only after the isolated test is authorized)

1. Run a successful delivery probe; retain its `instance`, `event_id`, and offset.
2. Use Render's restart action for **only the new POC service**. Do not redeploy or
   restart an existing IRADS service.
3. Retry GET `/probe` with increasing pauses (e.g. 5, 10, 20 seconds). Short-lived
   503 responses during enrollment are expected. Investigate persistent failures;
   do not rotate keys or recreate volumes blindly.
4. Run POST `/probe`. Require a **different instance UUID**, all checks passing,
   a new event UUID, and `windows_consumer=true`. This proves a new Python process
   recovered without retained Tailscale state. The old database row should remain:

   ```powershell
   docker compose --env-file .env -f compose.windows.yml exec -T postgres `
       psql -U irads_poc -d irads_poc -c 'SELECT id, received_at FROM poc_deliveries ORDER BY received_at DESC LIMIT 5;'
   ```

5. Separately allow natural Render Free idle spin-down (historically about 15
   minutes), then repeat the probes. Record cold-start time, peak memory, OOMs,
   restarts and tailnet/relay behavior. Tailscale traffic is not an availability
   guarantee. Do not add keep-alive traffic to evade Free-tier sleeping.
6. Optional recovery drills, **this file/project only**:

   ```powershell
   docker compose --env-file .env -f compose.windows.yml stop consumer
   # GET remains healthy; POST must fail its Windows-consumer check.
   docker compose --env-file .env -f compose.windows.yml start consumer
   # Run POST again and require complete success.
   docker compose --env-file .env -f compose.windows.yml stop redis
   # GET /probe must return 503 while /healthz remains 200.
   docker compose --env-file .env -f compose.windows.yml start redis
   # GET and POST must recover without container/volume recreation.
   ```

Do not run these drills against any existing stack. No deletion is necessary.
Sleeping Windows, stopped Docker Desktop, or a lost home connection makes the
hybrid service unavailable. This experiment does not provide production uptime.

## 7. Safe local checks used for this PR

From the repository root, in a Python 3.12 virtual environment:

```powershell
python -m pip install -r deploy/irads-hybrid-poc/requirements-check.txt
python -m unittest discover -s deploy/irads-hybrid-poc/tests -v
python -m compileall -q deploy/irads-hybrid-poc/render deploy/irads-hybrid-poc/windows
```

Tests use fake credentials, mocked protocol clients, and loopback-only fake SOCKS
servers. They check isolation, auth, metadata rejection, redaction, TTL behavior,
and binary/half-close forwarding. They never start Docker or access a real database.
Compose can also be parsed with `config --quiet` and throwaway environment values;
never print its interpolated secret-bearing configuration into logs.

**Not established by static checks:** Docker image availability/build success,
Windows Serve/port forwarding, Render egress/512 MB memory limits, live protocol
connectivity, actual message delivery, or restart recovery. Those require the
explicit test steps above. The POC is ready for review, not a claim of deployment
success. No production API, consumer, or Android contracts are changed.

## Costs and reference material

An eligible personal Tailscale plan plus Render Free can make the experiment's
incremental hosting cost $0 (existing laptop electricity/internet excluded).
Verify current eligibility, outbound-traffic limits, hours allowance, memory,
sleep behavior and commercial licensing before deploying. No paid resource is
created by these files; Render will use its supplied HTTPS hostname.

- https://render.com/docs/free
- https://render.com/docs/docker
- https://tailscale.com/kb/1112/userspace-networking
- https://tailscale.com/kb/1242/tailscale-serve
- https://tailscale.com/kb/1085/auth-keys
- https://tailscale.com/kb/1111/ephemeral-nodes

Those documentation sites were blocked by the setup machine's network policy.
The installed-version CLI help and actual deployment tests remain authoritative
for the experiment; do not treat the examples as a verified live deployment.
