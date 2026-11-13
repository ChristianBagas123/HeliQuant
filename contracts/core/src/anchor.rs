//! Anchor: mencatat hash catatan off-chain sebagai event. Tidak menyimpan data, jadi `storage_usage` tetap.
use near_sdk::serde_json::json;
use near_sdk::{env, near, require};

use crate::util::{emit, msg, parse_hash, to_hex};
use crate::{Contract, ContractExt};

const KINDS: [&str; 3] = ["decision", "trade", "edge_validation"];

#[near]
impl Contract {
    /// Hanya akun executor. `record_hash` adalah SHA-256 hex 64 karakter (boleh berawalan `0x`).
    pub fn anchor(&mut self, record_hash: String, kind: String, ref_id: String) {
        require!(env::predecessor_account_id() == self.executor, msg::ONLY_EXECUTOR);
        require!(KINDS.contains(&kind.as_str()), msg::BAD_ANCHOR_KIND);
        let hash = parse_hash(&record_hash);
        emit("anchored", json!({"record_hash": to_hex(&hash), "kind": kind, "ref_id": ref_id}));
    }
}
