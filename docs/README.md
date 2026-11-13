# HeliQuant — Documentation

The official docs for **HeliQuant**, an autonomous multi-desk AI trading firm on NEAR.
Built with [Fumadocs](https://fumadocs.dev) (Next.js + MDX), themed "Night Garage" (dark automotive
brutalism).

- **Live firm:** https://heliquant-near.vercel.app
- **Source:** https://github.com/ChristianBagas123/HeliQuant (`agents/`, `contracts/`, `relayer/`, `frontend/`, `docs/`)

## Pages

`index` · `architecture` · `components` · `machinery` · `desks` (one page per desk) · `self-learning` ·
`on-chain` · `findings` · `verifiability` · `self-host` · `api` — content lives in [`content/docs/`](./content/docs).

## Develop

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build (Vercel uses this)
```

## Deploy (Vercel)

Import this repository in Vercel and set **Root Directory** to `docs`. The framework (Next.js) is detected automatically.
