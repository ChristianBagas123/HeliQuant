//! Kontrak utama HeliQuant di NEAR. Menggabungkan identitas (NFT NEP-171), reputasi, validasi,
//! job (sewa firm), vault (swap bertahap lewat DEX), dan anchor dalam satu akun.
//!
//! Awalan penyimpanan memakai diskriminan tetap `#[repr(u8)]` yang dimulai dari 1. Awalan tidak boleh
//! dipakai ulang untuk layout lain. Perubahan layout state wajib lewat `migrate`.
use near_contract_standards::non_fungible_token::{NonFungibleToken, TokenId};
use near_sdk::json_types::U64;
use near_sdk::store::{LookupMap, Vector};
use near_sdk::{near, require, AccountId, BorshStorageKey, PanicOnDefault};

#[cfg(test)]
mod tests;

pub mod anchor;
pub mod identity;
pub mod job;
pub mod migrate;
pub mod reputation;
pub mod util;
pub mod validation;
pub mod vault;

use identity::Agent;
use job::Job;
use reputation::Reputation;
use util::msg;
use validation::Credential;

#[near(serializers = [borsh])]
#[borsh(use_discriminant = true)]
#[repr(u8)]
#[derive(BorshStorageKey)]
pub enum SK {
    Agents = 1,
    Creds = 2,
    ByToken = 3,
    ByTokenInner(String) = 4,
    NftOwner = 5,
    NftMeta = 6,
    NftEnum = 7,
    NftApproval = 8,
    Jobs = 9,
    JobsByClient = 10,
    JobsByClientInner(AccountId) = 11,
    JobsByFirm = 12,
    JobsByFirmInner(String) = 13,
    Claimable = 14,
    Reputations = 15,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    pub(crate) owner: AccountId,
    pub(crate) principal_token: AccountId,
    pub(crate) base_token: AccountId,
    pub(crate) dex: AccountId,
    pub(crate) executor: AccountId,
    pub(crate) next_token: u64,
    pub(crate) nft: NonFungibleToken,
    pub(crate) agents: LookupMap<TokenId, Agent>,
    /// Kredensial. ID kredensial = indeks + 1, jadi ID pertama adalah 1.
    pub(crate) creds: Vector<Credential>,
    pub(crate) by_token: LookupMap<TokenId, Vector<u64>>,
    pub(crate) reputations: LookupMap<TokenId, Reputation>,
    pub(crate) next_job: u64,
    pub(crate) jobs: LookupMap<u64, Job>,
    pub(crate) jobs_by_client: LookupMap<AccountId, Vector<u64>>,
    pub(crate) jobs_by_firm: LookupMap<TokenId, Vector<u64>>,
    /// Saldo yang bisa ditarik: (akun, token) -> jumlah.
    pub(crate) claimable: LookupMap<(AccountId, AccountId), u128>,
    /// Jumlah alur swap yang sedang berjalan (job dengan `pending`).
    pub(crate) inflight: u32,
    /// Alur baru boleh direkonsiliasi setelah sekian detik.
    pub(crate) reconcile_after_sec: u64,
    /// Hanya build tes sandbox: skala gas lampiran dalam persen (100 = normal).
    #[cfg(feature = "test-hooks")]
    pub(crate) gas_pct: u32,
    /// Hanya build tes sandbox: nama callback yang sengaja diberi gas 1 TGas, atau `none`.
    #[cfg(feature = "test-hooks")]
    pub(crate) starve: String,
    /// Hanya build tes upgrade: field baru di akhir state.
    #[cfg(feature = "test-layout-v2")]
    pub(crate) layout_marker: u32,
}

#[near(serializers = [json])]
pub struct ConfigView {
    pub owner: AccountId,
    pub principal_token: AccountId,
    pub base_token: AccountId,
    pub dex: AccountId,
    pub executor: AccountId,
    pub reconcile_after_sec: U64,
}

#[near]
impl Contract {
    /// Dipanggil sekali oleh akun `core` saat deploy. Bukan `ignore_state`.
    #[init]
    pub fn new(
        owner: AccountId,
        principal_token: AccountId,
        base_token: AccountId,
        dex: AccountId,
        executor: AccountId,
    ) -> Self {
        let nft = NonFungibleToken::new(
            SK::NftOwner,
            owner.clone(),
            Some(SK::NftMeta),
            Some(SK::NftEnum),
            Some(SK::NftApproval),
        );
        Self {
            owner,
            principal_token,
            base_token,
            dex,
            executor,
            next_token: 0,
            nft,
            agents: LookupMap::new(SK::Agents),
            creds: Vector::new(SK::Creds),
            by_token: LookupMap::new(SK::ByToken),
            reputations: LookupMap::new(SK::Reputations),
            next_job: 0,
            jobs: LookupMap::new(SK::Jobs),
            jobs_by_client: LookupMap::new(SK::JobsByClient),
            jobs_by_firm: LookupMap::new(SK::JobsByFirm),
            claimable: LookupMap::new(SK::Claimable),
            inflight: 0,
            reconcile_after_sec: 60,
            #[cfg(feature = "test-hooks")]
            gas_pct: 100,
            #[cfg(feature = "test-hooks")]
            starve: "none".to_string(),
            #[cfg(feature = "test-layout-v2")]
            layout_marker: 0,
        }
    }

    pub fn version(&self) -> String {
        format!("heliquant-core {}", env!("CARGO_PKG_VERSION"))
    }

    pub fn config(&self) -> ConfigView {
        ConfigView {
            owner: self.owner.clone(),
            principal_token: self.principal_token.clone(),
            base_token: self.base_token.clone(),
            dex: self.dex.clone(),
            executor: self.executor.clone(),
            reconcile_after_sec: U64(self.reconcile_after_sec),
        }
    }

    /// Padanan `setExecutor`.
    pub fn set_executor(&mut self, account_id: AccountId) {
        self.assert_owner();
        self.executor = account_id;
    }

    /// Padanan `setDexRouter`.
    pub fn set_dex(&mut self, account_id: AccountId) {
        self.assert_owner();
        self.dex = account_id;
    }

    /// Jumlah alur swap yang sedang berjalan.
    pub fn inflight_count(&self) -> u32 {
        self.inflight
    }

    /// Hanya build tes: skala gas lampiran, callback yang dikurangi gasnya, dan jeda rekonsiliasi.
    #[cfg(feature = "test-hooks")]
    pub fn set_test_gas(&mut self, pct: u32, starve: String, reconcile_after_sec: u64) {
        self.assert_owner();
        self.gas_pct = pct;
        self.starve = starve;
        self.reconcile_after_sec = reconcile_after_sec;
    }
}

impl Contract {
    pub(crate) fn assert_owner(&self) {
        require!(near_sdk::env::predecessor_account_id() == self.owner, msg::ONLY_OWNER);
    }

    pub(crate) fn assert_executor_or_owner(&self) {
        let c = near_sdk::env::predecessor_account_id();
        require!(c == self.executor || c == self.owner, msg::ONLY_EXECUTOR_OR_OWNER);
    }
}
