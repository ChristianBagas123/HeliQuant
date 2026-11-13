//! Penerima prediksi Allora. Hanya akun relayer tepercaya yang boleh mengirim, dan kunci relayer
//! dibatasi protokol NEAR ke `submit_inference`.
use near_sdk::json_types::U64;
use near_sdk::serde_json::json;
use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, BorshStorageKey, PanicOnDefault};

pub const DEFAULT_MAX_FRESHNESS_SEC: u64 = 1_800;
pub const MAX_CONFIDENCE_BPS: u32 = 10_000;

#[near(serializers = [borsh])]
#[borsh(use_discriminant = true)]
#[repr(u8)]
#[derive(BorshStorageKey)]
enum SK {
    Relayers = 1,
    Topics = 2,
    Latest = 3,
}

#[near(serializers = [borsh])]
struct Stored {
    /// Bilangan bertanda skala 1e18.
    value: i128,
    timestamp_sec: u64,
    confidence_bps: u32,
    published_by: AccountId,
}

#[near(serializers = [json])]
pub struct InferenceView {
    /// String bilangan bertanda skala 1e18.
    pub network_inference: String,
    pub network_inference_timestamp_sec: U64,
    pub confidence_bps: u32,
    pub published_by: AccountId,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    max_freshness_sec: u64,
    relayers: LookupMap<AccountId, bool>,
    topics: LookupMap<u64, bool>,
    latest: LookupMap<u64, Stored>,
}

fn emit(event: &str, data: near_sdk::serde_json::Value) {
    let e = json!({"standard": "heliquant", "version": "1.0.0", "event": event, "data": [data]});
    env::log_str(&format!("EVENT_JSON:{}", e));
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner: AccountId) -> Self {
        Self {
            owner,
            max_freshness_sec: DEFAULT_MAX_FRESHNESS_SEC,
            relayers: LookupMap::new(SK::Relayers),
            topics: LookupMap::new(SK::Topics),
            latest: LookupMap::new(SK::Latest),
        }
    }

    pub fn version(&self) -> String {
        format!("heliquant-allora {}", env!("CARGO_PKG_VERSION"))
    }

    pub fn set_trusted_relayer(&mut self, account_id: AccountId, trusted: bool) {
        self.assert_owner();
        self.relayers.insert(account_id.clone(), trusted);
        emit("trusted_relayer_updated", json!({"account_id": account_id, "trusted": trusted}));
    }

    pub fn set_topic_enabled(&mut self, topic_id: u64, enabled: bool) {
        self.assert_owner();
        self.topics.insert(topic_id, enabled);
        emit("topic_enabled", json!({"topic_id": topic_id.to_string(), "enabled": enabled}));
    }

    pub fn set_max_freshness_seconds(&mut self, seconds: u64) {
        self.assert_owner();
        self.max_freshness_sec = seconds;
        emit("max_freshness_updated", json!({"seconds": seconds.to_string()}));
    }

    /// Hanya relayer tepercaya. `extra_data` diterima demi kecocokan antarmuka, tidak disimpan.
    pub fn submit_inference(
        &mut self,
        topic_id: u64,
        network_inference: String,
        network_inference_timestamp_sec: u64,
        confidence_bps: u32,
        extra_data: Option<String>,
    ) {
        let _ = extra_data;
        let who = env::predecessor_account_id();
        require!(self.relayers.get(&who).copied().unwrap_or(false), "untrusted relayer");
        require!(self.is_topic_enabled(topic_id), "topic not enabled");
        require!(confidence_bps <= MAX_CONFIDENCE_BPS, "invalid confidence");
        let value: i128 =
            network_inference.parse().unwrap_or_else(|_| env::panic_str("network_inference is not a signed integer"));
        let now = env::block_timestamp() / 1_000_000_000;
        require!(network_inference_timestamp_sec <= now, "future data");
        require!(now - network_inference_timestamp_sec <= self.max_freshness_sec, "stale data");
        if let Some(prev) = self.latest.get(&topic_id) {
            require!(network_inference_timestamp_sec > prev.timestamp_sec, "inference not newer");
        }
        self.latest.insert(
            topic_id,
            Stored {
                value,
                timestamp_sec: network_inference_timestamp_sec,
                confidence_bps,
                published_by: who.clone(),
            },
        );
        emit(
            "inference_recorded",
            json!({"topic_id": topic_id.to_string(), "network_inference": value.to_string(),
                   "network_inference_timestamp_sec": network_inference_timestamp_sec.to_string(),
                   "confidence_bps": confidence_bps, "published_by": who}),
        );
    }

    /// Panic `no inference recorded` kalau topik belum pernah diisi.
    pub fn get_latest_inference(&self, topic_id: u64) -> InferenceView {
        let s = self.latest.get(&topic_id).unwrap_or_else(|| env::panic_str("no inference recorded"));
        InferenceView {
            network_inference: s.value.to_string(),
            network_inference_timestamp_sec: U64(s.timestamp_sec),
            confidence_bps: s.confidence_bps,
            published_by: s.published_by.clone(),
        }
    }

    pub fn is_topic_enabled(&self, topic_id: u64) -> bool {
        self.topics.get(&topic_id).copied().unwrap_or(false)
    }

    pub fn is_trusted_relayer(&self, account_id: AccountId) -> bool {
        self.relayers.get(&account_id).copied().unwrap_or(false)
    }

    pub fn max_freshness_seconds(&self) -> U64 {
        U64(self.max_freshness_sec)
    }
}

impl Contract {
    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "only owner");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    const NOW_SEC: u64 = 1_000_000;

    fn ctx(pred: AccountId) {
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(pred.clone())
            .signer_account_id(pred)
            .block_timestamp(NOW_SEC * 1_000_000_000)
            .build());
    }

    fn setup() -> Contract {
        ctx(accounts(0));
        let mut c = Contract::new(accounts(0));
        c.set_trusted_relayer(accounts(1), true);
        c.set_topic_enabled(14, true);
        c
    }

    fn submit(c: &mut Contract, who: AccountId, ts: u64, conf: u32) {
        ctx(who);
        c.submit_inference(14, "123456789000000000000".to_string(), ts, conf, None);
    }

    #[test]
    fn happy_path_and_defaults() {
        let mut c = setup();
        assert_eq!(c.max_freshness_seconds().0, 1_800);
        assert!(c.is_topic_enabled(14));
        assert!(!c.is_topic_enabled(15));
        submit(&mut c, accounts(1), NOW_SEC - 10, 9_000);
        let v = c.get_latest_inference(14);
        assert_eq!(v.network_inference, "123456789000000000000");
        assert_eq!(v.network_inference_timestamp_sec.0, NOW_SEC - 10);
        assert_eq!(v.confidence_bps, 9_000);
        assert_eq!(v.published_by, accounts(1));
    }

    #[test]
    fn negative_value_roundtrips() {
        let mut c = setup();
        ctx(accounts(1));
        c.submit_inference(14, "-5000000000000000000".to_string(), NOW_SEC, 100, Some("0x".to_string()));
        assert_eq!(c.get_latest_inference(14).network_inference, "-5000000000000000000");
    }

    #[test]
    #[should_panic(expected = "untrusted relayer")]
    fn untrusted_relayer_rejected() {
        let mut c = setup();
        submit(&mut c, accounts(2), NOW_SEC, 100);
    }

    #[test]
    #[should_panic(expected = "untrusted relayer")]
    fn revoked_relayer_rejected() {
        let mut c = setup();
        ctx(accounts(0));
        c.set_trusted_relayer(accounts(1), false);
        submit(&mut c, accounts(1), NOW_SEC, 100);
    }

    #[test]
    #[should_panic(expected = "topic not enabled")]
    fn disabled_topic_rejected() {
        let mut c = setup();
        ctx(accounts(0));
        c.set_topic_enabled(14, false);
        submit(&mut c, accounts(1), NOW_SEC, 100);
    }

    #[test]
    #[should_panic(expected = "invalid confidence")]
    fn confidence_above_max_rejected() {
        let mut c = setup();
        submit(&mut c, accounts(1), NOW_SEC, 10_001);
    }

    #[test]
    fn confidence_at_max_accepted() {
        let mut c = setup();
        submit(&mut c, accounts(1), NOW_SEC, 10_000);
    }

    #[test]
    #[should_panic(expected = "future data")]
    fn future_data_rejected() {
        let mut c = setup();
        submit(&mut c, accounts(1), NOW_SEC + 1, 100);
    }

    #[test]
    #[should_panic(expected = "stale data")]
    fn stale_data_rejected() {
        let mut c = setup();
        submit(&mut c, accounts(1), NOW_SEC - 1_801, 100);
    }

    #[test]
    fn freshness_boundary_and_setter() {
        let mut c = setup();
        submit(&mut c, accounts(1), NOW_SEC - 1_800, 100);
        ctx(accounts(0));
        c.set_max_freshness_seconds(60);
        assert_eq!(c.max_freshness_seconds().0, 60);
    }

    #[test]
    #[should_panic(expected = "inference not newer")]
    fn not_newer_rejected() {
        let mut c = setup();
        submit(&mut c, accounts(1), NOW_SEC - 10, 100);
        submit(&mut c, accounts(1), NOW_SEC - 10, 100);
    }

    #[test]
    fn newer_accepted() {
        let mut c = setup();
        submit(&mut c, accounts(1), NOW_SEC - 10, 100);
        submit(&mut c, accounts(1), NOW_SEC - 9, 200);
        assert_eq!(c.get_latest_inference(14).confidence_bps, 200);
    }

    #[test]
    #[should_panic(expected = "no inference recorded")]
    fn no_inference_panics() {
        let c = setup();
        c.get_latest_inference(14);
    }

    #[test]
    #[should_panic(expected = "signed integer")]
    fn bad_number_rejected() {
        let mut c = setup();
        ctx(accounts(1));
        c.submit_inference(14, "1.5".to_string(), NOW_SEC, 100, None);
    }

    #[test]
    #[should_panic(expected = "only owner")]
    fn setters_owner_only() {
        let mut c = setup();
        ctx(accounts(1));
        c.set_topic_enabled(1, true);
    }
}
