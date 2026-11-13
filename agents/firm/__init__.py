"""HeliQuant — Python worker agents orchestrated by Paperclip.

Architecture:
  Paperclip (Node.js control plane) → HTTP webhook → this FastAPI server
  → one of:
    /agent/research   — scan news/sentiment via Claude, push to signal context
    /agent/signal     — fuse Allora prediction + ML model → trade decision
    /agent/risk       — gate trade size and drawdown
    /agent/execution  — call core.trade on NEAR (executor key)
    /agent/reputation — read settled-job outcome from the core contract
"""
