"""Execution Agent — memanggil core.trade (vault bertahap) di NEAR dengan kunci executor terbatas.

This is the ONLY agent that holds a private key. Its scope is intentionally narrow:
  - Receive {job_id, direction, size_token_in, min_amount_out}
  - Call core.trade(...) with the executor signing key (firm/near_client.py)
  - Return tx hash + amount out

Stub, sama seperti versi sebelumnya: agen tidak memanggil `trade` otomatis. Demo alur Hire memakai
scripts/executor_demo.py, yang memanggil core.trade, recover_job, dan reconcile_job.
"""

from __future__ import annotations

import structlog

from firm.config import settings
from firm.schemas import ExecutionInput, ExecutionOutput, TradeDirection

log = structlog.get_logger()


async def run(inputs: ExecutionInput) -> ExecutionOutput:
    log.info(
        "execution.run",
        job_id=inputs.job_id,
        direction=inputs.direction.value,
        size=inputs.size_token_in,
    )

    if settings.near_core_contract_id is None:
        raise RuntimeError(
            "NEAR_CORE_CONTRACT_ID not configured"
        )

    # ─── V1 stub ──────────────────────────────────────────────────────
    # V2: near_client.send_sync(executor, key, core, "trade", {...})
    return ExecutionOutput(
        tx_hash="0" * 44,
        amount_out=inputs.min_amount_out,
        block_number=0,
    )
