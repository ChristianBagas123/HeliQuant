//! Mock USDC (NEP-141, 6 desimal) dengan faucet publik. Hanya untuk testnet.
//! NEP-145 (storage) ditulis manual karena `impl_fungible_token_storage!` 5.30.1 tidak bisa dikompilasi.
use near_contract_standards::fungible_token::events::FtMint;
use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC,
};
use near_contract_standards::fungible_token::{FungibleToken, FungibleTokenCore, FungibleTokenResolver};
use near_contract_standards::storage_management::{StorageBalance, StorageBalanceBounds, StorageManagement};
use near_sdk::collections::LazyOption;
use near_sdk::json_types::U128;
use near_sdk::{near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, PromiseOrValue};

#[derive(BorshStorageKey)]
#[near]
enum SK {
    Token,
    Meta,
}

#[derive(PanicOnDefault)]
#[near(contract_state)]
pub struct Contract {
    token: FungibleToken,
    metadata: LazyOption<FungibleTokenMetadata>,
}

#[near]
impl Contract {
    #[init]
    pub fn new() -> Self {
        let metadata = FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: "Mock USDC".to_string(),
            symbol: "mUSDC".to_string(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: 6,
        };
        Self { token: FungibleToken::new(SK::Token), metadata: LazyOption::new(SK::Meta, Some(&metadata)) }
    }

    /// Faucet publik tanpa batas jumlah.
    /// Akun penerima harus sudah `storage_deposit`.
    pub fn mint(&mut self, account_id: AccountId, amount: U128) {
        require!(amount.0 > 0, "amount must be greater than zero");
        self.token.internal_deposit(&account_id, amount.0);
        FtMint { owner_id: &account_id, amount, memo: Some("faucet") }.emit();
    }
}

#[near]
impl FungibleTokenCore for Contract {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for Contract {
    #[private]
    fn ft_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, amount: U128) -> U128 {
        self.token.internal_ft_resolve_transfer(&sender_id, receiver_id, amount).0.into()
    }
}

#[near]
impl StorageManagement for Contract {
    #[payable]
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.token.internal_storage_unregister(force).is_some()
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for Contract {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.metadata.get().unwrap()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    fn ctx(pred: AccountId, deposit: u128) {
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(pred.clone())
            .signer_account_id(pred)
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .build());
    }

    #[test]
    fn metadata_and_faucet() {
        ctx(accounts(0), 0);
        let mut c = Contract::new();
        let m = c.ft_metadata();
        assert_eq!((m.name.as_str(), m.symbol.as_str(), m.decimals), ("Mock USDC", "mUSDC", 6));
        ctx(accounts(1), 10u128.pow(22));
        c.storage_deposit(Some(accounts(1)), None);
        ctx(accounts(2), 0);
        // mint publik: siapa saja, jumlah besar tanpa batas
        c.mint(accounts(1), U128(10u128.pow(30)));
        assert_eq!(c.ft_balance_of(accounts(1)).0, 10u128.pow(30));
        assert_eq!(c.ft_total_supply().0, 10u128.pow(30));
    }

    #[test]
    #[should_panic(expected = "amount must be greater than zero")]
    fn mint_zero_rejected() {
        ctx(accounts(0), 0);
        let mut c = Contract::new();
        c.mint(accounts(1), U128(0));
    }

    #[test]
    #[should_panic]
    fn mint_to_unregistered_account_fails() {
        ctx(accounts(0), 0);
        let mut c = Contract::new();
        c.mint(accounts(1), U128(5));
    }
}
