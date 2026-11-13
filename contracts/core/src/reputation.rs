//! Reputasi per agen. Diperbarui hanya saat job selesai (`settle`).
use near_contract_standards::non_fungible_token::TokenId;
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::json;
use near_sdk::{env, near};

use crate::util::{drawdown_bps, emit};
use crate::{Contract, ContractExt};

#[near(serializers = [borsh])]
#[derive(Default, Clone)]
pub struct Reputation {
    pub total_jobs: u64,
    pub successful_jobs: u64,
    pub cumulative_pnl: i128,
    pub total_volume: u128,
    pub peak_balance: u128,
    pub max_drawdown_bps: u32,
    pub last_update_ns: u64,
}

#[near(serializers = [json])]
pub struct ReputationView {
    pub total_jobs: U64,
    pub successful_jobs: U64,
    /// Nilai bertanda dikirim sebagai string.
    pub cumulative_pnl: String,
    pub total_volume: U128,
    pub peak_balance: U128,
    pub max_drawdown_bps: u32,
    pub last_update_ns: U64,
}

#[near]
impl Contract {
    pub fn get_reputation(&self, token_id: TokenId) -> ReputationView {
        let r = self.reputations.get(&token_id).cloned().unwrap_or_default();
        ReputationView {
            total_jobs: U64(r.total_jobs),
            successful_jobs: U64(r.successful_jobs),
            cumulative_pnl: r.cumulative_pnl.to_string(),
            total_volume: U128(r.total_volume),
            peak_balance: U128(r.peak_balance),
            max_drawdown_bps: r.max_drawdown_bps,
            last_update_ns: U64(r.last_update_ns),
        }
    }

    pub fn win_rate_bps(&self, token_id: TokenId) -> u32 {
        match self.reputations.get(&token_id) {
            Some(r) if r.total_jobs > 0 => (r.successful_jobs as u128 * 10_000 / r.total_jobs as u128) as u32,
            _ => 0,
        }
    }
}

impl Contract {
    /// Internal, dipanggil saat `settle`. `pnl` = saldo akhir - setoran awal.
    pub(crate) fn record_job_outcome(
        &mut self,
        token_id: &TokenId,
        job_id: u64,
        pnl: i128,
        volume: u128,
        current_balance: u128,
    ) {
        let mut r = self.reputations.get(token_id).cloned().unwrap_or_default();
        r.total_jobs += 1;
        if pnl > 0 {
            r.successful_jobs += 1;
        }
        r.cumulative_pnl = r.cumulative_pnl.checked_add(pnl).expect("pnl overflow");
        r.total_volume = r.total_volume.checked_add(volume).expect("volume overflow");
        if current_balance > r.peak_balance {
            r.peak_balance = current_balance;
        } else if r.peak_balance > 0 {
            let dd = drawdown_bps(r.peak_balance - current_balance, r.peak_balance);
            if dd > r.max_drawdown_bps {
                r.max_drawdown_bps = dd;
            }
        }
        r.last_update_ns = env::block_timestamp();
        self.reputations.insert(token_id.clone(), r);
        emit(
            "job_outcome_recorded",
            json!({"token_id": token_id, "job_id": job_id.to_string(), "pnl": pnl.to_string(),
                   "volume": U128(volume), "success": pnl > 0}),
        );
    }
}
