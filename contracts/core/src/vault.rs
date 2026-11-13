//! Vault bertahap. Alur swap lewat DEX (Rhea): ft_transfer_call -> on_deposit -> swap -> on_swap ->
//! withdraw -> on_withdraw. Saldo job baru berubah di `complete_withdraw`. Job terkunci sejak awal.
//! Semua callback `#[private]`. Pemulihan lewat `recover_job`, `reconcile_job`, dan `force_unlock`.
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::json;
use near_sdk::{env, near, require, AccountId, Gas, NearToken, Promise};

use crate::job::{JobStatus, PendKind, Pending, Stage};
use crate::util::{emit, msg, tg};
use crate::{Contract, ContractExt};

// Gas (TGas) yang dilampirkan ke tiap langkah. Tiap callback harus cukup untuk kerjanya sendiri
// ditambah semua anak di bawahnya: on_withdraw 50 -> on_swap 100 -> on_deposit 145.
pub const G_DEPOSIT: u64 = 45;
pub const G_CB_DEPOSIT: u64 = 145;
pub const G_SWAP: u64 = 30;
pub const G_CB_SWAP: u64 = 100;
pub const G_WITHDRAW: u64 = 40;
pub const G_CB_WITHDRAW: u64 = 50;
pub const G_PAY: u64 = 10;
pub const G_CB_PAY: u64 = 10;
/// Gas minimal untuk `trade` dan `settle_job`: G_DEPOSIT + G_CB_DEPOSIT + kerja sendiri.
pub const MIN_PIPELINE_GAS: u64 = 200;
/// Gas minimal untuk `recover_job`: G_WITHDRAW + G_CB_WITHDRAW + kerja sendiri.
pub const MIN_RECOVER_GAS: u64 = 100;
pub const MIN_CLAIM_GAS: u64 = 40;
pub const MIN_RECONCILE_GAS: u64 = 150;
const G_VIEW: u64 = 10;
const G_CB_RECONCILE: u64 = 100;

#[near]
impl Contract {
    /// Hanya executor. Tidak payable: core sendiri yang melampirkan 1 yocto ke token dan DEX.
    /// `trade` tidak memeriksa `end_ns`: job yang lewat waktunya masih bisa di-trade
    /// sampai `settle_job` dipanggil. Kunci job mencegah `trade` dan `settle_job` berjalan bersamaan.
    pub fn trade(
        &mut self,
        job_id: U64,
        token_in: AccountId,
        amount_in: U128,
        token_out: AccountId,
        min_amount_out: U128,
        pool_id: u64,
    ) -> Promise {
        require!(env::predecessor_account_id() == self.executor, msg::ONLY_EXECUTOR);
        require!(env::prepaid_gas() >= tg(MIN_PIPELINE_GAS), "gas too low: minimum 200 TGas");
        require!(amount_in.0 > 0, msg::ZERO_AMOUNT);
        let pt = self.principal_token.clone();
        let bt = self.base_token.clone();
        require!(token_in != token_out, msg::SAME_TOKEN);
        require!((token_in == pt && token_out == bt) || (token_in == bt && token_out == pt), msg::BAD_PAIR);
        let dex = self.dex.clone();
        let now = env::block_timestamp();
        self.inflight += 1;
        let j = self.jobs.get_mut(&job_id.0).unwrap_or_else(|| env::panic_str(msg::JOB_NOT_FOUND));
        require!(j.status == JobStatus::Active, msg::JOB_NOT_ACTIVE);
        require!(!j.locked, msg::JOB_LOCKED);
        let bal = if token_in == pt { j.principal } else { j.base_balance };
        require!(amount_in.0 <= bal, msg::LOW_BALANCE);
        j.locked = true;
        j.last_pool = Some(pool_id);
        j.pending = Some(Pending {
            kind: PendKind::Trade,
            stage: Stage::Depositing,
            token_in: token_in.clone(),
            amount_in: amount_in.0,
            token_out,
            min_out: min_amount_out.0,
            pool_id,
            amount_out: 0,
            withdrawing: false,
            started_ns: now,
        });
        self.start_deposit(&dex, &token_in, amount_in.0, job_id.0)
    }

    /// Siapa pun boleh memanggil setelah `end_ns`. `min_out` opsional (bawaan 1) untuk penjualan base.
    pub fn settle_job(&mut self, job_id: U64, min_out: Option<U128>) -> Promise {
        require!(env::prepaid_gas() >= tg(MIN_PIPELINE_GAS), "gas too low: minimum 200 TGas");
        let dex = self.dex.clone();
        let now = env::block_timestamp();
        let j = self.jobs.get_mut(&job_id.0).unwrap_or_else(|| env::panic_str(msg::JOB_NOT_FOUND));
        require!(j.status == JobStatus::Active, msg::JOB_NOT_ACTIVE);
        require!(!j.locked, msg::JOB_LOCKED);
        require!(now >= j.end_ns, msg::NOT_MATURE);
        j.status = JobStatus::Settling;
        j.locked = true;
        if j.base_balance == 0 {
            return self.finalize(job_id.0).unwrap_or_else(|| {
                Promise::new(env::current_account_id()).function_call(
                    "version".to_string(),
                    vec![],
                    NearToken::from_yoctonear(0),
                    tg(5),
                )
            });
        }
        let pool = j.last_pool.unwrap_or_else(|| env::panic_str(msg::NO_POOL));
        let bt = j.base_token.clone();
        let amt = j.base_balance;
        j.pending = Some(Pending {
            kind: PendKind::Settle,
            stage: Stage::Depositing,
            token_in: bt.clone(),
            amount_in: amt,
            token_out: j.principal_token.clone(),
            min_out: min_out.map(|m| m.0).unwrap_or(1),
            pool_id: pool,
            amount_out: 0,
            withdrawing: false,
            started_ns: now,
        });
        self.inflight += 1;
        self.start_deposit(&dex, &bt, amt, job_id.0)
    }

    /// Pemulihan: tarik kembali token yang tersangkut di DEX (tahap Deposited atau Swapped).
    pub fn recover_job(&mut self, job_id: U64) -> Promise {
        self.assert_executor_or_owner();
        require!(env::prepaid_gas() >= tg(MIN_RECOVER_GAS), "gas too low: minimum 100 TGas");
        let j = self.jobs.get_mut(&job_id.0).unwrap_or_else(|| env::panic_str(msg::JOB_NOT_FOUND));
        require!(j.locked, msg::JOB_NOT_LOCKED);
        let p = j.pending.as_mut().unwrap_or_else(|| env::panic_str(msg::NO_PENDING));
        require!(!p.withdrawing, msg::WITHDRAW_RUNNING);
        let (token, amount) = match p.stage {
            Stage::Depositing => env::panic_str(msg::DEPOSITING_STAGE),
            Stage::Deposited => (p.token_in.clone(), p.amount_in),
            Stage::Swapped => (p.token_out.clone(), p.amount_out),
        };
        p.withdrawing = true;
        self.withdraw_call(&token, amount, job_id.0)
    }

    /// Pemulihan untuk alur yang macet karena callback hilang (mis. kehabisan gas). Membaca deposit
    /// core di DEX untuk kedua token, lalu `on_reconcile` memutuskan. Hanya aman kalau akun core di DEX
    /// dipakai satu alur saja, jadi dipersyaratkan `inflight == 1` dan alur sudah cukup lama.
    pub fn reconcile_job(&mut self, job_id: U64) -> Promise {
        self.assert_executor_or_owner();
        require!(env::prepaid_gas() >= tg(MIN_RECONCILE_GAS), "gas too low: minimum 150 TGas");
        require!(self.inflight == 1, msg::OTHER_FLOW);
        let now = env::block_timestamp();
        let after = self.reconcile_after_sec * 1_000_000_000;
        let j = self.jobs.get_mut(&job_id.0).unwrap_or_else(|| env::panic_str(msg::JOB_NOT_FOUND));
        require!(j.locked, msg::JOB_NOT_LOCKED);
        let p = j.pending.as_mut().unwrap_or_else(|| env::panic_str(msg::NO_PENDING));
        require!(now >= p.started_ns + after, msg::NOT_OLD_ENOUGH);
        p.started_ns = now;
        let (ti, to) = (p.token_in.clone(), p.token_out.clone());
        let core = env::current_account_id();
        let view = |t: &AccountId| {
            Promise::new(self.dex.clone()).function_call(
                "get_deposit".to_string(),
                json!({"account_id": core, "token_id": t}).to_string().into_bytes(),
                NearToken::from_yoctonear(0),
                self.g(G_VIEW),
            )
        };
        view(&ti).and(view(&to)).then(self.cb("on_reconcile", job_id.0, G_CB_RECONCILE))
    }

    /// Jalan terakhir (hanya owner): buka kunci tanpa memeriksa DEX. Token yang masih di DEX harus
    /// ditarik owner secara terpisah.
    pub fn force_unlock(&mut self, job_id: U64) {
        self.assert_owner();
        let j = self.jobs.get_mut(&job_id.0).unwrap_or_else(|| env::panic_str(msg::JOB_NOT_FOUND));
        require!(j.locked, msg::JOB_NOT_LOCKED);
        j.locked = false;
        let had = j.pending.take().is_some();
        if j.status == JobStatus::Settling {
            j.status = JobStatus::Active;
        }
        if had {
            self.dec_inflight();
        }
        emit("job_force_unlocked", json!({"job_id": job_id.0.to_string()}));
    }

    #[private]
    pub fn on_deposit(&mut self, job_id: U64) {
        let used = match env::promise_result_checked(0, 64) {
            Ok(b) => near_sdk::serde_json::from_slice::<U128>(&b).map(|u| u.0).unwrap_or(0),
            Err(_) => 0,
        };
        let jid = job_id.0;
        let step = {
            let Some(j) = self.jobs.get_mut(&jid) else { return };
            let Some(p) = j.pending.as_mut() else { return };
            if p.stage != Stage::Depositing {
                return;
            }
            if used == 0 {
                None
            } else {
                p.stage = Stage::Deposited;
                p.amount_in = used.min(p.amount_in);
                Some((p.token_in.clone(), p.token_out.clone(), p.amount_in, p.min_out, p.pool_id))
            }
        };
        match step {
            None => self.abort_pipeline(jid, "deposit", "DEX did not accept the token"),
            Some((ti, to, amt, min_out, pool)) => {
                let args = json!({"actions": [{"pool_id": pool, "token_in": ti, "amount_in": U128(amt),
                                               "token_out": to, "min_amount_out": U128(min_out)}],
                                  "referral_id": null})
                .to_string()
                .into_bytes();
                Promise::new(self.dex.clone())
                    .function_call("swap".to_string(), args, NearToken::from_yoctonear(1), self.g(G_SWAP))
                    .then(self.cb("on_swap", jid, G_CB_SWAP))
                    .detach();
            }
        }
    }

    #[private]
    pub fn on_swap(&mut self, job_id: U64) {
        let out = match env::promise_result_checked(0, 64) {
            Ok(b) => near_sdk::serde_json::from_slice::<U128>(&b).ok().map(|u| u.0),
            Err(_) => None,
        };
        let jid = job_id.0;
        let (token, amount, swapped) = {
            let Some(j) = self.jobs.get_mut(&jid) else { return };
            let Some(p) = j.pending.as_mut() else { return };
            if p.stage != Stage::Deposited || p.withdrawing {
                return;
            }
            p.withdrawing = true;
            match out {
                Some(o) if o > 0 => {
                    p.stage = Stage::Swapped;
                    p.amount_out = o;
                    (p.token_out.clone(), o, true)
                }
                // Swap gagal: token masih tercatat di DEX. Langsung ditarik kembali.
                _ => (p.token_in.clone(), p.amount_in, false),
            }
        };
        if !swapped {
            emit("swap_failed", json!({"job_id": jid.to_string(), "action": "withdraw token_in"}));
        }
        self.withdraw_call(&token, amount, jid).detach();
    }

    #[private]
    pub fn on_withdraw(&mut self, job_id: U64) {
        let jid = job_id.0;
        let (stage, expected) = {
            let Some(j) = self.jobs.get_mut(&jid) else { return };
            let Some(p) = j.pending.as_mut() else { return };
            p.withdrawing = false;
            let expected = match p.stage {
                Stage::Swapped => p.amount_out,
                Stage::Deposited => p.amount_in,
                Stage::Depositing => 0,
            };
            (p.stage, expected)
        };
        // Rhea (terukur di testnet): `withdraw` sukses memberi nilai akhir = jumlah yang ditarik, dan kalau
        // ft_transfer di dalamnya gagal, promise tetap sukses dengan nilai "0" (deposit dipulihkan).
        // Jadi sukses hanya kalau nilai balik persis sama dengan jumlah yang diminta.
        let ok = match env::promise_result_checked(0, 64) {
            Ok(b) => near_sdk::serde_json::from_slice::<U128>(&b).map(|u| u.0 == expected).unwrap_or(false),
            Err(_) => false,
        };
        if !ok {
            emit("trade_stuck", json!({"job_id": jid.to_string(), "stage": format!("{:?}", stage)}));
            return;
        }
        self.complete_withdraw(jid);
    }

    #[private]
    pub fn on_reconcile(&mut self, job_id: U64) {
        if env::promise_results_count() != 2 {
            return;
        }
        let rd = |i: u64| match env::promise_result_checked(i, 64) {
            Ok(b) => near_sdk::serde_json::from_slice::<U128>(&b).ok().map(|u| u.0),
            Err(_) => None,
        };
        let jid = job_id.0;
        let (Some(dep_in), Some(dep_out)) = (rd(0), rd(1)) else {
            emit("reconcile_failed", json!({"job_id": jid.to_string(), "reason": "DEX deposit not readable"}));
            return;
        };
        let now = env::block_timestamp();
        enum Act {
            Withdraw(AccountId, u128),
            Abort,
            Complete,
            Inconclusive,
        }
        let act = {
            let Some(j) = self.jobs.get_mut(&jid) else { return };
            let Some(p) = j.pending.as_mut() else { return };
            if dep_out > 0 {
                // hasil swap ada di DEX: swap sudah terjadi
                let amt = if p.stage == Stage::Swapped && p.amount_out > 0 { p.amount_out.min(dep_out) } else { dep_out };
                p.stage = Stage::Swapped;
                p.amount_out = amt;
                p.withdrawing = true;
                p.started_ns = now;
                Act::Withdraw(p.token_out.clone(), amt)
            } else if dep_in > 0 {
                // token masuk masih di DEX: swap belum terjadi
                let amt = dep_in.min(p.amount_in);
                p.stage = Stage::Deposited;
                p.amount_in = amt;
                p.withdrawing = true;
                p.started_ns = now;
                Act::Withdraw(p.token_in.clone(), amt)
            } else {
                match (p.stage, p.withdrawing) {
                    (Stage::Depositing, _) => Act::Abort,
                    (_, true) => Act::Complete,
                    _ => Act::Inconclusive,
                }
            }
        };
        emit("reconciled", json!({"job_id": jid.to_string(), "dep_in": U128(dep_in), "dep_out": U128(dep_out)}));
        match act {
            Act::Withdraw(t, a) => self.withdraw_call(&t, a, jid).detach(),
            Act::Abort => self.abort_pipeline(jid, "reconcile", "deposit never reached the DEX"),
            Act::Complete => self.complete_withdraw(jid),
            Act::Inconclusive => emit("reconcile_inconclusive", json!({"job_id": jid.to_string()})),
        }
    }
}

impl Contract {
    /// Gas lampiran. Build tes sandbox bisa menskalakannya.
    pub(crate) fn g(&self, n: u64) -> Gas {
        #[cfg(feature = "test-hooks")]
        {
            Gas::from_gas(n * 10_000_000_000 * self.gas_pct as u64)
        }
        #[cfg(not(feature = "test-hooks"))]
        {
            tg(n)
        }
    }

    fn cb(&self, method: &str, job_id: u64, gas: u64) -> Promise {
        #[cfg(feature = "test-hooks")]
        let g = if self.starve == method { Gas::from_tgas(1) } else { self.g(gas) };
        #[cfg(not(feature = "test-hooks"))]
        let g = self.g(gas);
        Promise::new(env::current_account_id()).function_call(
            method.to_string(),
            json!({"job_id": U64(job_id)}).to_string().into_bytes(),
            NearToken::from_yoctonear(0),
            g,
        )
    }

    fn dec_inflight(&mut self) {
        self.inflight = self.inflight.saturating_sub(1);
    }

    fn start_deposit(&self, dex: &AccountId, token_in: &AccountId, amount: u128, job_id: u64) -> Promise {
        let args = json!({"receiver_id": dex, "amount": U128(amount), "memo": null, "msg": ""})
            .to_string()
            .into_bytes();
        Promise::new(token_in.clone())
            .function_call("ft_transfer_call".to_string(), args, NearToken::from_yoctonear(1), self.g(G_DEPOSIT))
            .then(self.cb("on_deposit", job_id, G_CB_DEPOSIT))
    }

    fn withdraw_call(&self, token: &AccountId, amount: u128, job_id: u64) -> Promise {
        let args = json!({"token_id": token, "amount": U128(amount), "unregister": null, "skip_unwrap_near": null})
            .to_string()
            .into_bytes();
        Promise::new(self.dex.clone())
            .function_call("withdraw".to_string(), args, NearToken::from_yoctonear(1), self.g(G_WITHDRAW))
            .then(self.cb("on_withdraw", job_id, G_CB_WITHDRAW))
    }

    /// Withdraw ke core terbukti selesai: terapkan hasil menurut tahap. Satu-satunya tempat saldo job berubah.
    fn complete_withdraw(&mut self, jid: u64) {
        let (stage, kind) = {
            let Some(j) = self.jobs.get_mut(&jid) else { return };
            let Some(p) = j.pending.as_mut() else { return };
            p.withdrawing = false;
            (p.stage, p.kind)
        };
        match stage {
            Stage::Depositing => {}
            Stage::Deposited => {
                let j = self.jobs.get_mut(&jid).unwrap();
                j.pending = None;
                j.locked = false;
                if kind == PendKind::Settle {
                    j.status = JobStatus::Active;
                }
                self.dec_inflight();
                emit("pipeline_aborted", json!({"job_id": jid.to_string(), "kind": format!("{:?}", kind)}));
            }
            Stage::Swapped => {
                let mut finish = false;
                {
                    let j = self.jobs.get_mut(&jid).unwrap();
                    let p = j.pending.take().unwrap();
                    if p.token_in == j.principal_token {
                        j.principal = j.principal.checked_sub(p.amount_in).expect("principal underflow");
                        j.base_balance = j.base_balance.checked_add(p.amount_out).expect("base overflow");
                    } else {
                        j.base_balance = j.base_balance.checked_sub(p.amount_in).expect("base underflow");
                        j.principal = j.principal.checked_add(p.amount_out).expect("principal overflow");
                    }
                    emit(
                        "trade_done",
                        json!({"job_id": jid.to_string(), "token_in": p.token_in, "amount_in": U128(p.amount_in),
                               "token_out": p.token_out, "amount_out": U128(p.amount_out)}),
                    );
                    match kind {
                        PendKind::Trade => j.locked = false,
                        PendKind::Settle => {
                            if j.base_balance > 0 {
                                j.status = JobStatus::Active;
                                j.locked = false;
                                emit("settle_incomplete", json!({"job_id": jid.to_string()}));
                            } else {
                                finish = true;
                            }
                        }
                    }
                }
                self.dec_inflight();
                if finish {
                    if let Some(p) = self.finalize(jid) {
                        p.detach();
                    }
                }
            }
        }
    }

    fn abort_pipeline(&mut self, jid: u64, step: &str, reason: &str) {
        let j = self.jobs.get_mut(&jid).unwrap();
        let kind = j.pending.as_ref().map(|p| p.kind);
        j.pending = None;
        j.locked = false;
        if kind == Some(PendKind::Settle) {
            j.status = JobStatus::Active;
        }
        self.dec_inflight();
        emit("trade_failed", json!({"job_id": jid.to_string(), "step": step, "reason": reason}));
    }
}
