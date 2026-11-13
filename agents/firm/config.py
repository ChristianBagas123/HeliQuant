"""Centralized configuration for all agent workers.

Reads from environment / .env via pydantic-settings. Each agent imports `settings`
from this module — no scattered os.environ lookups.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[2] / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ─── NEAR (testnet) RPC + signing ──────────────────────────────────
    near_network: str = "testnet"
    near_rpc_url: str = "https://test.rpc.fastnear.com"
    near_parent_account: str | None = None
    near_executor_private_key: str | None = None  # kunci terbatas: trade, recover_job, reconcile_job, anchor

    # ─── Deployed contracts (nilai dari contracts/deployments/near_testnet.json) ──
    near_core_contract_id: str | None = None
    allora_contract_id: str | None = None
    firm_token_id: str | None = None

    # ─── ML model artifact ─────────────────────────────────────────────
    ml_model_path: str = "models/xgb_near.pkl"
    ml_confidence_buy: float = 0.65
    ml_confidence_sell: float = 0.55
    ml_min_adx: float = 20.0

    # Allora: dibaca langsung dari chain Allora lewat LCD (firm/allora_lcd.py, env ALLORA_LCD_URL); topik 14 = BTC 8h,
    # 9 = ETH 8h. LLM: firm/llm_client.py (env HQ_PROVIDER, NEARAI_*, GROQ_API_KEY).

    # ─── HTTP server ───────────────────────────────────────────────────
    worker_host: str = "0.0.0.0"
    worker_port: int = 8000

    # ─── Risk parameters ───────────────────────────────────────────────
    risk_per_trade_bps: int = 100         # 1%
    max_drawdown_bps: int = 2_000         # 20% kill-switch
    atr_sl_multiplier: float = 1.0
    atr_tp_multiplier: float = 1.46


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings: Settings = get_settings()
