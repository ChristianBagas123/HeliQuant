# agents-LocalReady 🦅 — run your own HeliQuant engine

Your **own** instance of the HeliQuant autonomous trading firm — running on
**your machine**, with **your keys**, **no custody**. The shared HeliQuant dApp connects to it over a tunnel;
your credentials live only in this engine's local SQLite and never touch anyone else's server.

```
download → docker compose up → ngrok → "Register your engine" on the dApp → your firm is live
```

## Quickstart (Docker — recommended)
```bash
git clone https://github.com/ChristianBagas123/HeliQuant
cd HeliQuant/agents-LocalReady
cp .env.example .env          # set HQ_OWNER_ACCOUNT (your NEAR testnet account); HQ_REPO_URL already points to https://github.com/ChristianBagas123/HeliQuant
docker compose up -d          # builds + runs the firm on http://localhost:8000
```
Then expose it and onboard:
```bash
ngrok http 8000               # copy the https URL it prints
```
Open the HeliQuant dApp → **Register your engine** → paste your ngrok URL, connect the wallet of
`HQ_OWNER_ACCOUNT`, add your keys (10 free Groq keys, optional Bitget Demo key) → **Register** and sign once
in your wallet. The dApp now reads **your** firm.

## No Docker?
- **Windows:** `./run.ps1`
- **macOS / Linux:** `chmod +x run.sh && ./run.sh`

Both need `HQ_REPO_URL` in the environment (or `.env` for Docker). They clone the firm, make a venv, install it, and run it on port 8000 — with the same self-driving loop.

## What it does
- Runs the firm's FastAPI service (`app.py`) + a built-in **self-pinger**, so the floor and the org cycle
  advance **24/7** with no external uptime monitor.
- Persists your credentials + state in a local SQLite (Docker volume `hq_data`).
- Exposes the same read endpoints the dApp uses (`/campaign`, `/agents`, `/trades`, …) over your tunnel.

See [`SETUP.md`](SETUP.md) for the full walkthrough + troubleshooting.

> **No custody.** Your keys are POSTed from the onboarding form straight to this engine's `/register`
> and stored in `data/credentials.db` on your machine. They never reach a shared server.
> `/register` only accepts a NEP-413 signature from the full-access key of `HQ_OWNER_ACCOUNT`, over a one-time
> nonce from this engine and the hash of the keys, so nobody else can write keys to your engine.
