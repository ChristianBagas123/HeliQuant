//! Identitas agen: NFT NEP-171. Hanya token Firm yang bisa dipindahkan (soulbound untuk agen lain).
use std::collections::HashMap;

use near_contract_standards::non_fungible_token::approval::NonFungibleTokenApproval;
use near_contract_standards::non_fungible_token::core::{NonFungibleTokenCore, NonFungibleTokenResolver};
use near_contract_standards::non_fungible_token::enumeration::NonFungibleTokenEnumeration;
use near_contract_standards::non_fungible_token::metadata::{
    NFTContractMetadata, NonFungibleTokenMetadataProvider, TokenMetadata, NFT_METADATA_SPEC,
};
use near_contract_standards::non_fungible_token::{Token, TokenId};
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::json;
use near_sdk::{env, near, require, AccountId, Promise, PromiseOrValue};

use crate::util::{emit, msg};
use crate::{Contract, ContractExt};

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum AgentKind {
    Firm,
    Research,
    Signal,
    Risk,
    Execution,
    Reputation,
    Custom,
}

#[near(serializers = [borsh])]
pub struct Agent {
    pub kind: AgentKind,
    pub parent: Option<TokenId>,
    pub agent_account: AccountId,
    pub metadata_uri: String,
    pub service_endpoint: Option<String>,
    pub created_at_ns: u64,
}

#[near(serializers = [json])]
pub struct IdentityView {
    pub token_id: TokenId,
    pub owner_id: AccountId,
    pub kind: AgentKind,
    pub created_at_ns: U64,
    pub parent_token_id: Option<TokenId>,
    pub metadata_uri: String,
    pub service_endpoint: Option<String>,
    pub agent_account: AccountId,
}

#[near]
impl Contract {
    /// Firm (tanpa induk): siapa saja. Agen lain: wajib induk berjenis Firm, dan pemanggil harus pemilik
    /// langsung token induk (penerima approval ditolak). Token dicetak ke pemanggil.
    /// Pemanggil melampirkan deposit simpan (mis. 0,01 NEAR). Sisanya dikembalikan.
    #[payable]
    pub fn register_agent(
        &mut self,
        kind: AgentKind,
        parent_token_id: Option<TokenId>,
        agent_account: AccountId,
        metadata_uri: String,
        service_endpoint: Option<String>,
    ) -> TokenId {
        let caller = env::predecessor_account_id();
        match &parent_token_id {
            None => require!(kind == AgentKind::Firm, msg::NON_FIRM_NEEDS_PARENT),
            Some(p) => {
                require!(kind != AgentKind::Firm, msg::FIRM_HAS_PARENT);
                let parent = self.agents.get(p).unwrap_or_else(|| env::panic_str(msg::PARENT_NOT_FOUND));
                require!(parent.kind == AgentKind::Firm, msg::PARENT_NOT_FIRM);
                require!(self.token_owner(p).as_ref() == Some(&caller), msg::ONLY_FIRM_OWNER);
            }
        }
        self.next_token += 1;
        let id = self.next_token.to_string();
        let meta = TokenMetadata {
            title: Some(format!("HeliQuant {:?} #{}", kind, id)),
            description: None,
            media: None,
            media_hash: None,
            copies: None,
            issued_at: None,
            expires_at: None,
            starts_at: None,
            updated_at: None,
            extra: None,
            reference: None,
            reference_hash: None,
        };
        // `internal_mint` memotong biaya simpan dari deposit, mengembalikan sisanya, dan mengeluarkan event nep171.
        self.nft.internal_mint(id.clone(), caller.clone(), Some(meta));
        self.agents.insert(
            id.clone(),
            Agent {
                kind,
                parent: parent_token_id.clone(),
                agent_account: agent_account.clone(),
                metadata_uri: metadata_uri.clone(),
                service_endpoint,
                created_at_ns: env::block_timestamp(),
            },
        );
        emit(
            "agent_registered",
            json!({"token_id": id, "kind": kind, "parent_token_id": parent_token_id,
                   "owner_id": caller, "agent_account": agent_account, "metadata_uri": metadata_uri}),
        );
        id
    }

    pub fn update_metadata(&mut self, token_id: TokenId, metadata_uri: String) {
        self.assert_token_owner(&token_id);
        self.agents.get_mut(&token_id).unwrap().metadata_uri = metadata_uri.clone();
        emit("metadata_updated", json!({"token_id": token_id, "metadata_uri": metadata_uri}));
    }

    pub fn update_service_endpoint(&mut self, token_id: TokenId, service_endpoint: Option<String>) {
        self.assert_token_owner(&token_id);
        self.agents.get_mut(&token_id).unwrap().service_endpoint = service_endpoint.clone();
        emit("service_endpoint_updated", json!({"token_id": token_id, "service_endpoint": service_endpoint}));
    }

    pub fn get_identity(&self, token_id: TokenId) -> Option<IdentityView> {
        let a = self.agents.get(&token_id)?;
        Some(IdentityView {
            owner_id: self.token_owner(&token_id)?,
            token_id,
            kind: a.kind,
            created_at_ns: U64(a.created_at_ns),
            parent_token_id: a.parent.clone(),
            metadata_uri: a.metadata_uri.clone(),
            service_endpoint: a.service_endpoint.clone(),
            agent_account: a.agent_account.clone(),
        })
    }

    pub fn total_agents(&self) -> U64 {
        U64(self.next_token)
    }
}

impl Contract {
    pub(crate) fn token_owner(&self, token_id: &TokenId) -> Option<AccountId> {
        self.nft.nft_token(token_id.clone()).map(|t| t.owner_id)
    }

    fn assert_token_owner(&self, token_id: &TokenId) {
        require!(self.agents.contains_key(token_id), msg::TOKEN_NOT_FOUND);
        require!(
            self.token_owner(token_id).as_ref() == Some(&env::predecessor_account_id()),
            msg::ONLY_TOKEN_OWNER
        );
    }

    fn require_transferable(&self, token_id: &TokenId) {
        let a = self.agents.get(token_id).unwrap_or_else(|| env::panic_str(msg::TOKEN_NOT_FOUND));
        require!(a.kind == AgentKind::Firm, msg::SOULBOUND);
    }
}

// ---- standar NFT: delegasi ke NonFungibleToken, transfer dan approve dibatasi ke Firm ----
#[near]
impl NonFungibleTokenCore for Contract {
    #[payable]
    fn nft_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
    ) {
        self.require_transferable(&token_id);
        self.nft.nft_transfer(receiver_id, token_id, approval_id, memo)
    }

    #[payable]
    fn nft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<bool> {
        self.require_transferable(&token_id);
        self.nft.nft_transfer_call(receiver_id, token_id, approval_id, memo, msg)
    }

    fn nft_token(&self, token_id: TokenId) -> Option<Token> {
        self.nft.nft_token(token_id)
    }
}

#[near]
impl NonFungibleTokenResolver for Contract {
    #[private]
    fn nft_resolve_transfer(
        &mut self,
        previous_owner_id: AccountId,
        receiver_id: AccountId,
        token_id: TokenId,
        approved_account_ids: Option<HashMap<AccountId, u64>>,
    ) -> bool {
        self.nft.nft_resolve_transfer(previous_owner_id, receiver_id, token_id, approved_account_ids)
    }
}

#[near]
impl NonFungibleTokenApproval for Contract {
    #[payable]
    fn nft_approve(&mut self, token_id: TokenId, account_id: AccountId, msg: Option<String>) -> Option<Promise> {
        self.require_transferable(&token_id);
        self.nft.nft_approve(token_id, account_id, msg)
    }

    #[payable]
    fn nft_revoke(&mut self, token_id: TokenId, account_id: AccountId) {
        self.nft.nft_revoke(token_id, account_id)
    }

    #[payable]
    fn nft_revoke_all(&mut self, token_id: TokenId) {
        self.nft.nft_revoke_all(token_id)
    }

    fn nft_is_approved(&self, token_id: TokenId, approved_account_id: AccountId, approval_id: Option<u64>) -> bool {
        self.nft.nft_is_approved(token_id, approved_account_id, approval_id)
    }
}

#[near]
impl NonFungibleTokenEnumeration for Contract {
    fn nft_total_supply(&self) -> U128 {
        self.nft.nft_total_supply()
    }

    fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        self.nft.nft_tokens(from_index, limit)
    }

    fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 {
        self.nft.nft_supply_for_owner(account_id)
    }

    fn nft_tokens_for_owner(&self, account_id: AccountId, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        self.nft.nft_tokens_for_owner(account_id, from_index, limit)
    }
}

#[near]
impl NonFungibleTokenMetadataProvider for Contract {
    fn nft_metadata(&self) -> NFTContractMetadata {
        NFTContractMetadata {
            spec: NFT_METADATA_SPEC.to_string(),
            name: "HeliQuant Agent Identity".to_string(),
            symbol: "HQAGENT".to_string(),
            icon: None,
            base_uri: None,
            reference: None,
            reference_hash: None,
        }
    }
}
