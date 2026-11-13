//! Kredensial (bukti kerja). Desk mencatat lewat `record_output`. Settlement job mencatat kredensial
//! `OnchainStateCheck` secara internal.
use near_contract_standards::non_fungible_token::TokenId;
use near_sdk::json_types::U64;
use near_sdk::serde_json::json;
use near_sdk::store::Vector;
use near_sdk::{env, near, require, AccountId};

use crate::util::{emit, msg, parse_hash, to_hex};
use crate::{Contract, ContractExt, SK};

/// Jenis bukti: 0 OnchainStateCheck, 1 AttestedByValidator, 2 ZKProof.
pub const PROOF_ONCHAIN_STATE: u8 = 0;
pub const PROOF_ATTESTED: u8 = 1;
pub const PROOF_ZK: u8 = 2;

/// Tidak menyimpan `attested_by`: untuk jenis selain 0, penanda tangan selalu `agent_account` token,
/// yang tidak bisa diubah. View menurunkannya dari data agen. Ini menjaga ukuran per record.
#[near(serializers = [borsh])]
pub struct Credential {
    pub token_id: TokenId,
    pub job_id: u64,
    pub proof_kind: u8,
    pub proof_hash: [u8; 32],
    pub recorded_at_ns: u64,
}

#[near(serializers = [json])]
pub struct CredentialView {
    pub id: U64,
    pub token_id: TokenId,
    pub job_id: U64,
    pub proof_kind: u8,
    pub proof_hash: String,
    pub recorded_at_ns: U64,
    pub attested_by: Option<AccountId>,
}

#[near]
impl Contract {
    /// Hanya `agent_account` milik token. Desk memakai `proof_kind = 1`. Jenis 0 dicadangkan untuk settlement.
    pub fn record_output(&mut self, token_id: TokenId, job_id: U64, proof_kind: u8, proof_hash: String) -> U64 {
        let agent = self.agents.get(&token_id).unwrap_or_else(|| env::panic_str(msg::TOKEN_NOT_FOUND));
        let who = env::predecessor_account_id();
        require!(who == agent.agent_account, msg::ONLY_AGENT_ACCOUNT);
        require!(proof_kind == PROOF_ATTESTED || proof_kind == PROOF_ZK, msg::BAD_PROOF_KIND);
        let hash = parse_hash(&proof_hash);
        let id = self.push_credential(&token_id, job_id.0, proof_kind, hash);
        emit(
            "output_recorded",
            json!({"credential_id": id.to_string(), "token_id": token_id, "job_id": job_id,
                   "proof_kind": proof_kind, "proof_hash": to_hex(&hash), "attested_by": who}),
        );
        U64(id)
    }

    pub fn get_credential(&self, id: U64) -> Option<CredentialView> {
        let idx = id.0.checked_sub(1)?;
        let c = self.creds.get(u32::try_from(idx).ok()?)?;
        let attested_by = if c.proof_kind == PROOF_ONCHAIN_STATE {
            None
        } else {
            self.agents.get(&c.token_id).map(|a| a.agent_account.clone())
        };
        Some(CredentialView {
            id,
            token_id: c.token_id.clone(),
            job_id: U64(c.job_id),
            proof_kind: c.proof_kind,
            proof_hash: to_hex(&c.proof_hash),
            recorded_at_ns: U64(c.recorded_at_ns),
            attested_by,
        })
    }

    pub fn credential_total(&self) -> U64 {
        U64(self.creds.len() as u64)
    }

    pub fn credential_count_for(&self, token_id: TokenId) -> U64 {
        U64(self.by_token.get(&token_id).map(|v| v.len() as u64).unwrap_or(0))
    }

    /// ID kredensial milik token, berhalaman. `limit` maksimal 100.
    pub fn credential_ids_of(&self, token_id: TokenId, from_index: U64, limit: u32) -> Vec<U64> {
        match self.by_token.get(&token_id) {
            None => vec![],
            Some(v) => (from_index.0..v.len() as u64)
                .take(limit.min(100) as usize)
                .map(|i| U64(*v.get(i as u32).unwrap()))
                .collect(),
        }
    }
}

impl Contract {
    /// Simpan kredensial dan kembalikan ID-nya (mulai dari 1).
    pub(crate) fn push_credential(&mut self, token_id: &TokenId, job_id: u64, proof_kind: u8, hash: [u8; 32]) -> u64 {
        self.creds.push(Credential {
            token_id: token_id.clone(),
            job_id,
            proof_kind,
            proof_hash: hash,
            recorded_at_ns: env::block_timestamp(),
        });
        let id = self.creds.len() as u64;
        if self.by_token.get(token_id).is_none() {
            self.by_token.insert(token_id.clone(), Vector::new(SK::ByTokenInner(token_id.clone())));
        }
        self.by_token.get_mut(token_id).unwrap().push(id);
        id
    }
}
