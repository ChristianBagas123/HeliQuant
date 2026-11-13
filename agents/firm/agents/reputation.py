"""Reputation Agent — off-chain mirror of a job's reputation update after it settles.

On NEAR the core contract (`core.heliquant.testnet`) already records reputation itself: `settle_job`
updates the firm token's reputation entry and emits the `job_settled` event (contracts/core/src/job.rs).
This agent only mirrors the same numbers into the orchestration log (analytics, dashboard counters).

Stub: log only. It sends no transaction.
"""

from __future__ import annotations

import structlog

from firm.schemas import ReputationInput, ReputationOutput

log = structlog.get_logger()


async def run(inputs: ReputationInput) -> ReputationOutput:
    log.info(
        "reputation.run",
        firm_token_id=inputs.firm_token_id,
        job_id=inputs.job_id,
        pnl=inputs.pnl,
    )

    # The core contract already wrote the reputation in `settle_job`. This agent only projects it off-chain,
    # so it sends nothing and has no transaction hash of its own.
    return ReputationOutput(tx_hash="")
