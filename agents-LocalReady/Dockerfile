# agents-LocalReady — your local HeliQuant engine, containerized.
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends git curl build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt
# Pull the firm from this project's public repository (its `agents/` folder becomes /opt/firm).
# Pass the URL at build time (docker compose reads HQ_REPO_URL from .env). Rebuild with --no-cache to update.
ARG HQ_REPO_URL
RUN test -n "$HQ_REPO_URL" || { echo "set HQ_REPO_URL to the project's public repository URL"; exit 1; }     && git clone --depth 1 "$HQ_REPO_URL" repo && mv repo/agents firm && rm -rf repo

WORKDIR /opt/firm
# Deps only — the firm runs from /opt/firm (WORKDIR); NO editable install (the pyproject's hatch wheel
# target isn't configured, and app.py + firm/ import directly from the working directory).
RUN pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir "uvicorn[standard]"

COPY start.sh /opt/start.sh
RUN chmod +x /opt/start.sh

EXPOSE 8000
CMD ["/opt/start.sh"]
