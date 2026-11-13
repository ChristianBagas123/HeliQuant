//! Job (sewa firm): dibuat lewat `ft_on_transfer`, diselesaikan lewat `settle_job` (lihat vault.rs).
//! Status: Active -> Settling -> Settled.
use near_contract_standards::non_fungible_token::TokenId;
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::json;
use near_sdk::store::Vector;
use near_sdk::{env, near, require, AccountId, NearToken, Promise, PromiseOrValue};

use crate::identity::AgentKind;
use crate::util::{emit, msg, split_payout, tg, to_hex};
use crate::validation::PROOF_ONCHAIN_STATE;
use crate::{Contract, ContractExt, SK};

pub const MAX_PERF_FEE_BPS: u32 = 3000;

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum JobStatus {
    Active,
    Settling,
    Settled,
}

/// Jenis alur swap yang sedang berjalan.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PendKind {
    Trade,
    Settle,
}

/// Posisi alur swap. `Depositing`: ft_transfer_call ke DEX berjalan. `Deposited`: token ada di DEX,
/// swap belum tentu selesai. `Swapped`: swap selesai, hasil ada di DEX dan belum ditarik.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Stage {
    Depositing,
    Deposited,
    Swapped,
}

#[near(serializers = [borsh])]
pub struct Pending {
    pub kind: PendKind,
    pub stage: Stage,
    pub token_in: AccountId,
    pub amount_in: u128,
    pub token_out: AccountId,
    pub min_out: u128,
    pub pool_id: u64,
    pub amount_out: u128,
    /// true selama withdraw ke DEX sedang berjalan.
    pub withdrawing: bool,
    pub started_ns: u64,
}

#[near(serializers = [json])]
pub struct PendingView {
    pub kind: PendKind,
    pub stage: Stage,
    pub token_in: AccountId,
    pub amount_in: U128,
    pub token_out: AccountId,
    pub amount_out: U128,
    pub withdrawing: bool,
}

#[near(serializers = [borsh])]
pub struct Job {
    pub client: AccountId,
    pub firm_token_id: TokenId,
    pub principal_token: AccountId,
    /// Setoran awal. Tidak berubah.
    pub principal_in: u128,
    /// Saldo principal job saat ini.
    pub principal: u128,
    pub base_token: AccountId,
    pub base_balance: u128,
    pub start_ns: u64,
    pub end_ns: u64,
    pub perf_fee_bps: u32,
    pub status: JobStatus,
    pub locked: bool,
    pub last_pool: Option<u64>,
    pub pending: Option<Pending>,
    pub final_principal: u128,
    pub final_pnl: i128,
}

#[near(serializers = [json])]
pub struct JobView {
    pub job_id: U64,
    pub client: AccountId,
    pub firm_token_id: TokenId,
    pub principal_token: AccountId,
    pub principal_in: U128,
    pub principal: U128,
    pub base_token: AccountId,
    pub base_balance: U128,
    pub start_ns: U64,
    pub end_ns: U64,
    pub perf_fee_bps: u32,
    pub status: JobStatus,
    pub locked: bool,
    pub final_principal: U128,
    /// Nilai bertanda dikirim sebagai string.
    pub final_pnl: String,
}

#[near(serializers = [json])]
pub struct JobBalanceView {
    pub principal: U128,
    pub base: U128,
    pub locked: bool,
    pub status: JobStatus,
    pub pending: Option<PendingView>,
}

/// Isi `msg` pada `ft_transfer_call`.
#[near(serializers = [json])]
struct JobMsg {
    firm_token_id: String,
    base_token: AccountId,
    duration_sec: u64,
    perf_fee_bps: u32,
}

#[near]
impl Contract {
    /// Membuat job dari `ft_transfer_call`. Hanya token principal; pemanggil lain di-panic.
    /// Aturan lain yang gagal mengembalikan seluruh token lewat nilai balik dan event `job_rejected`,
    /// tanpa receipt gagal (wallet Meteor menampilkan error untuk receipt gagal).
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        require!(env::predecessor_account_id() == self.principal_token, msg::ONLY_PRINCIPAL);
        match self.try_create_job(&sender_id, amount.0, &msg) {
            Ok((id, m)) => {
                emit(
                    "job_created",
                    json!({"job_id": id.to_string(), "client": sender_id, "firm_token_id": m.firm_token_id,
                           "amount": amount, "duration_sec": m.duration_sec, "perf_fee_bps": m.perf_fee_bps}),
                );
                PromiseOrValue::Value(U128(0))
            }
            Err(reason) => {
                emit("job_rejected", json!({"client": sender_id, "amount": amount, "reason": reason}));
                PromiseOrValue::Value(amount)
            }
        }
    }

    pub fn get_job(&self, job_id: U64) -> Option<JobView> {
        self.jobs.get(&job_id.0).map(|j| Self::job_view(job_id.0, j))
    }

    pub fn get_job_balance(&self, job_id: U64) -> JobBalanceView {
        let j = self.jobs.get(&job_id.0).unwrap_or_else(|| env::panic_str(msg::JOB_NOT_FOUND));
        JobBalanceView {
            principal: U128(j.principal),
            base: U128(j.base_balance),
            locked: j.locked,
            status: j.status,
            pending: j.pending.as_ref().map(|p| PendingView {
                kind: p.kind,
                stage: p.stage,
                token_in: p.token_in.clone(),
                amount_in: U128(p.amount_in),
                token_out: p.token_out.clone(),
                amount_out: U128(p.amount_out),
                withdrawing: p.withdrawing,
            }),
        }
    }

    pub fn claimable_of(&self, account_id: AccountId, token: AccountId) -> U128 {
        U128(self.claimable.get(&(account_id, token)).copied().unwrap_or(0))
    }

    pub fn jobs_by_client(&self, client: AccountId, from_index: U64, limit: u32) -> Vec<JobView> {
        match self.jobs_by_client.get(&client) {
            None => vec![],
            Some(v) => self.collect_jobs(v, from_index.0, limit),
        }
    }

    pub fn jobs_by_firm(&self, firm_token_id: TokenId, from_index: U64, limit: u32) -> Vec<JobView> {
        match self.jobs_by_firm.get(&firm_token_id) {
            None => vec![],
            Some(v) => self.collect_jobs(v, from_index.0, limit),
        }
    }

    pub fn total_jobs(&self) -> U64 {
        U64(self.next_job)
    }

    /// Tarik saldo `claimable` milik pemanggil. Saldo dikurangi dulu, dikembalikan kalau transfer gagal.
    pub fn claim_payout(&mut self, token: AccountId) -> Promise {
        require!(env::prepaid_gas() >= tg(crate::vault::MIN_CLAIM_GAS), "gas too low: minimum 40 TGas");
        let caller = env::predecessor_account_id();
        self.pay(&caller, &token).unwrap_or_else(|| env::panic_str(msg::NO_CLAIM))
    }

    #[private]
    pub fn on_payout(&mut self, account_id: AccountId, token: AccountId, amount: U128) {
        match env::promise_result_checked(0, 16) {
            Ok(_) => emit("payout_sent", json!({"account_id": account_id, "token": token, "amount": amount})),
            Err(_) => {
                self.add_claimable(&account_id, &token, amount.0);
                emit("payout_failed", json!({"account_id": account_id, "token": token, "amount": amount}));
            }
        }
    }
}

impl Contract {
    pub(crate) fn job_view(id: u64, j: &Job) -> JobView {
        JobView {
            job_id: U64(id),
            client: j.client.clone(),
            firm_token_id: j.firm_token_id.clone(),
            principal_token: j.principal_token.clone(),
            principal_in: U128(j.principal_in),
            principal: U128(j.principal),
            base_token: j.base_token.clone(),
            base_balance: U128(j.base_balance),
            start_ns: U64(j.start_ns),
            end_ns: U64(j.end_ns),
            perf_fee_bps: j.perf_fee_bps,
            status: j.status,
            locked: j.locked,
            final_principal: U128(j.final_principal),
            final_pnl: j.final_pnl.to_string(),
        }
    }

    fn collect_jobs(&self, ids: &Vector<u64>, from: u64, limit: u32) -> Vec<JobView> {
        (from..ids.len() as u64)
            .take(limit.min(100) as usize)
            .filter_map(|i| {
                let id = *ids.get(i as u32).unwrap();
                self.jobs.get(&id).map(|j| Self::job_view(id, j))
            })
            .collect()
    }

    /// Validasi semua aturan `msg`, lalu simpan job. `Err` berisi alasan penolakan.
    fn try_create_job(&mut self, sender: &AccountId, amount: u128, raw: &str) -> Result<(u64, JobMsg), String> {
        let m: JobMsg = near_sdk::serde_json::from_str(raw).map_err(|_| msg::R_BAD_MSG.to_string())?;
        if amount == 0 {
            return Err(msg::ZERO_AMOUNT.to_string());
        }
        if m.duration_sec == 0 {
            return Err(msg::R_ZERO_DURATION.to_string());
        }
        if m.perf_fee_bps > MAX_PERF_FEE_BPS {
            return Err(msg::R_FEE_HIGH.to_string());
        }
        if m.base_token != self.base_token {
            return Err(msg::R_BASE.to_string());
        }
        match self.agents.get(&m.firm_token_id) {
            None => return Err(msg::R_NO_FIRM.to_string()),
            Some(a) if a.kind != AgentKind::Firm => return Err(msg::R_NOT_FIRM.to_string()),
            Some(_) => {}
        }
        let now = env::block_timestamp();
        let dur_ns = m.duration_sec.checked_mul(1_000_000_000).ok_or(msg::R_DURATION_BIG.to_string())?;
        let end_ns = now.checked_add(dur_ns).ok_or(msg::R_DURATION_BIG.to_string())?;
        self.next_job += 1;
        let id = self.next_job;
        self.jobs.insert(
            id,
            Job {
                client: sender.clone(),
                firm_token_id: m.firm_token_id.clone(),
                principal_token: self.principal_token.clone(),
                principal_in: amount,
                principal: amount,
                base_token: m.base_token.clone(),
                base_balance: 0,
                start_ns: now,
                end_ns,
                perf_fee_bps: m.perf_fee_bps,
                status: JobStatus::Active,
                locked: false,
                last_pool: None,
                pending: None,
                final_principal: 0,
                final_pnl: 0,
            },
        );
        if self.jobs_by_client.get(sender).is_none() {
            self.jobs_by_client.insert(sender.clone(), Vector::new(SK::JobsByClientInner(sender.clone())));
        }
        self.jobs_by_client.get_mut(sender).unwrap().push(id);
        if self.jobs_by_firm.get(&m.firm_token_id).is_none() {
            self.jobs_by_firm
                .insert(m.firm_token_id.clone(), Vector::new(SK::JobsByFirmInner(m.firm_token_id.clone())));
        }
        self.jobs_by_firm.get_mut(&m.firm_token_id).unwrap().push(id);
        Ok((id, m))
    }

    pub(crate) fn add_claimable(&mut self, acct: &AccountId, token: &AccountId, amt: u128) {
        if amt == 0 {
            return;
        }
        let k = (acct.clone(), token.clone());
        let cur = self.claimable.get(&k).copied().unwrap_or(0);
        self.claimable.insert(k, cur.checked_add(amt).expect("claimable overflow"));
    }

    /// Kurangi `claimable` lalu kirim token. `on_payout` mengembalikan saldo kalau transfer gagal.
    pub(crate) fn pay(&mut self, acct: &AccountId, token: &AccountId) -> Option<Promise> {
        let k = (acct.clone(), token.clone());
        let amt = self.claimable.get(&k).copied().unwrap_or(0);
        if amt == 0 {
            return None;
        }
        self.claimable.remove(&k);
        let args = json!({"receiver_id": acct, "amount": U128(amt), "memo": null}).to_string().into_bytes();
        let cb_args = json!({"account_id": acct, "token": token, "amount": U128(amt)}).to_string().into_bytes();
        Some(
            Promise::new(token.clone())
                .function_call("ft_transfer".to_string(), args, NearToken::from_yoctonear(1), self.g(crate::vault::G_PAY))
                .then(Promise::new(env::current_account_id()).function_call(
                    "on_payout".to_string(),
                    cb_args,
                    NearToken::from_yoctonear(0),
                    self.g(crate::vault::G_CB_PAY),
                )),
        )
    }

    /// Hitung bagi hasil, tandai Settled, catat reputasi dan kredensial, kreditkan `claimable`, lalu coba kirim.
    pub(crate) fn finalize(&mut self, jid: u64) -> Option<Promise> {
        let (client, firm, pt, pin, pend, bps) = {
            let j = self.jobs.get_mut(&jid).unwrap();
            j.pending = None;
            (
                j.client.clone(),
                j.firm_token_id.clone(),
                j.principal_token.clone(),
                j.principal_in,
                j.principal,
                j.perf_fee_bps,
            )
        };
        let (client_amt, fee) = split_payout(pin, pend, bps);
        let pnl = i128::try_from(pend).expect("balance overflow") - i128::try_from(pin).expect("deposit overflow");
        // Fee ke pemilik token firm saat ini (bukan saat job dibuat).
        let fee_owner = self.token_owner(&firm).unwrap_or_else(|| self.owner.clone());
        {
            let j = self.jobs.get_mut(&jid).unwrap();
            j.principal = 0;
            j.status = JobStatus::Settled;
            j.locked = false;
            j.final_principal = pend;
            j.final_pnl = pnl;
        }
        self.add_claimable(&client, &pt, client_amt);
        self.add_claimable(&fee_owner, &pt, fee);
        emit(
            "job_settled",
            json!({"job_id": jid.to_string(), "principal_end": U128(pend), "pnl": pnl.to_string(),
                   "client_payout": U128(client_amt), "firm_fee": U128(fee)}),
        );
        // Volume = setoran awal (principal at risk).
        self.record_job_outcome(&firm, jid, pnl, pin, pend);
        let mut preimage = Vec::with_capacity(8 + 16 + 16 + 8);
        preimage.extend_from_slice(&jid.to_le_bytes());
        preimage.extend_from_slice(&pend.to_le_bytes());
        preimage.extend_from_slice(&pnl.to_le_bytes());
        preimage.extend_from_slice(&env::block_timestamp().to_le_bytes());
        let hash = env::sha256_array(&preimage);
        let cid = self.push_credential(&firm, jid, PROOF_ONCHAIN_STATE, hash);
        emit(
            "output_recorded",
            json!({"credential_id": cid.to_string(), "token_id": firm, "job_id": jid.to_string(),
                   "proof_kind": PROOF_ONCHAIN_STATE, "proof_hash": to_hex(&hash), "attested_by": null}),
        );
        let mut out = self.pay(&client, &pt);
        if fee > 0 {
            if let Some(q) = self.pay(&fee_owner, &pt) {
                out = Some(match out {
                    Some(p) => p.and(q),
                    None => q,
                });
            }
        }
        out
    }
}
