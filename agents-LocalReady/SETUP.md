# Setup — agents-LocalReady

Step-by-step to run your own HeliQuant engine and connect the dApp to it.

## 0 · Prerequisites
- **Docker** (recommended) — or Python 3.12 + git for the no-Docker path.
- **ngrok** (free) — https://ngrok.com → sign up → `ngrok config add-authtoken <token>`.
- A few **free Groq API keys** — https://console.groq.com (ten is ideal; the desks rotate to dodge limits).
- A **NEAR testnet account** in a browser wallet (e.g. Meteor, HOT, MyNearWallet) with its full-access key.

## 1 · Get the engine running
```bash
git clone https://github.com/ChristianBagas123/HeliQuant
cd HeliQuant/agents-LocalReady
cp .env.example .env
```
Edit `.env` and set **`HQ_OWNER_ACCOUNT`** to your NEAR testnet account (only that account may register
credentials to your engine, by signing with its wallet). **`HQ_REPO_URL`** already points to
https://github.com/ChristianBagas123/HeliQuant (the engine pulls its `agents/` folder from there); change it only for your own fork. Then:
```bash
docker compose up -d          # first run builds the image (a few minutes)
curl http://localhost:8000/health     # → ok
```

## 2 · Expose it with a tunnel
```bash
ngrok http 8000
```
Copy the `https://…ngrok-free.app` URL.

## 3 · Register on the dApp (no custody)
Open the HeliQuant dApp → **Register your engine** (`/onboarding`):
1. Paste your **ngrok URL**, hit **Connect to your engine →**, and connect the wallet of your **`HQ_OWNER_ACCOUNT`**.
2. Paste your **10 Groq keys** + any execution keys (Bitget Demo) / optional desk APIs.
3. Hit **Register your engine** and sign the message in your wallet (NEP-413: it signs a one-time nonce from your engine
   plus a hash of the keys — the key values are not shown in the wallet). The engine checks the signature and
   that the key is a full-access key of the owner, then stores the keys in its local SQLite. The whole
   dashboard switches to **your** firm.

Done — your firm runs autonomously. Next time, use **"Already configured → dashboard"** to reconnect.

## No-Docker path
```bash
# Windows
./run.ps1
# macOS / Linux
chmod +x run.sh && ./run.sh
```

## Troubleshooting
- **`/register` returns 503** — `HQ_OWNER_ACCOUNT` isn't set in `.env`. Set it + restart.
- **`/register` returns 403** — the wallet is not `HQ_OWNER_ACCOUNT`, the account is not `.testnet`, or the
  wallet signed with a function-call key. Sign in with the owner account's full-access key.
- **`/register` returns 401** — the nonce expired (5 min) or was already used. Hit Register again.
- **dApp says "engine unreachable"** — is the tunnel up? Test `curl <ngrok-url>/health`.
- **Firm abstains / 0 trades** — correct + disciplined when no validated edge fires. Not a bug.
- **Update the firm** — `docker compose build --no-cache && docker compose up -d` re-pulls the latest `agents`.
- **Data persists** in the `hq_data` volume (your `credentials.db` + state). `docker compose down -v` wipes it.
