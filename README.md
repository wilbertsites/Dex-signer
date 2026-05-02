# Dex Signer

IPA signing service. Upload a P12 certificate + IPA, get a signed IPA back.

## Deploy to Render

1. Push this folder to a GitHub repo
2. Go to [render.com](https://render.com) → New → Web Service
3. Connect your repo → it auto-detects the Dockerfile
4. Or use **render.yaml** for blueprint deploy (New → Blueprint)
5. Free/Starter plan works fine

Build takes ~3-4 min first time (compiles zsign from source).

## Local dev

```bash
# You need zsign installed locally (macOS: brew install zsign)
npm install
node server.js
# → http://localhost:3000
```

## Stack

- Node.js + Express
- [zsign](https://github.com/zhlynn/zsign) for actual signing
- No database, no persistence — files wiped after 5 min
