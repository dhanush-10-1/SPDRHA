# Pinned POC baseline. Check upstream advisories before any real deployment.
FROM tailscale/tailscale:v1.90.9 AS tailscale
FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /poc
COPY --from=tailscale /usr/local/bin/tailscale /usr/local/bin/tailscale
COPY --from=tailscale /usr/local/bin/tailscaled /usr/local/bin/tailscaled
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd --uid 10001 --create-home poc
COPY service.py start.py tcp_forwarder.py ./
USER poc
EXPOSE 10000
CMD ["python", "start.py"]
