//! Migrasi state. Dipanggil setelah deploy ulang ketika layout state berubah.
//!
//! Layout saat ini adalah layout versi 1, jadi `migrate` hanya membaca state yang ada. Saat layout
//! berubah di versi berikutnya, tulis struct layout lama di sini, baca dengan itu, lalu bangun `Contract` baru.
//! Jangan menjalankan `new` di akun yang sudah punya state.
use crate::{Contract, ContractExt};
use near_sdk::near;

#[near]
impl Contract {
    #[private]
    #[init(ignore_state)]
    pub fn migrate() -> Self {
        #[cfg(not(feature = "test-layout-v2"))]
        {
            near_sdk::env::state_read::<Self>().unwrap_or_else(|| near_sdk::env::panic_str("no state to migrate"))
        }
        // Build tes upgrade: field baru ada di akhir state, jadi byte lama + 4 byte nol = layout baru.
        #[cfg(feature = "test-layout-v2")]
        {
            use near_sdk::borsh::BorshDeserialize;
            let mut bytes =
                near_sdk::env::storage_read(b"STATE").unwrap_or_else(|| near_sdk::env::panic_str("no state to migrate"));
            bytes.extend_from_slice(&[0u8; 4]);
            Self::try_from_slice(&bytes).unwrap_or_else(|_| near_sdk::env::panic_str("state layout mismatch"))
        }
    }

    /// Hanya build tes upgrade: membuktikan field baru terbaca setelah `migrate`.
    #[cfg(feature = "test-layout-v2")]
    pub fn layout_marker(&self) -> u32 {
        self.layout_marker
    }
}
