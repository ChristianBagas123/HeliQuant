//! Fungsi bantu murni: hitung bagi hasil, hash, event NEP-297, dan konstanta pesan panic.
use near_sdk::serde_json::{json, Value};
use near_sdk::{env, require, Gas};

/// Pesan panic dan alasan penolakan. Bahasa Inggris pendek karena tampil di UI publik.
pub mod msg {
    pub const ONLY_PRINCIPAL: &str = "only principal token";
    pub const ONLY_EXECUTOR: &str = "only executor";
    pub const ONLY_EXECUTOR_OR_OWNER: &str = "only executor or owner";
    pub const ONLY_OWNER: &str = "only owner";
    pub const ONLY_AGENT_ACCOUNT: &str = "only the agent account of this token";
    pub const ONLY_TOKEN_OWNER: &str = "only token owner";
    pub const ONLY_FIRM_OWNER: &str = "only owner of the parent Firm token";
    pub const SOULBOUND: &str = "soulbound token";
    pub const TOKEN_NOT_FOUND: &str = "token not found";
    pub const PARENT_NOT_FOUND: &str = "parent token not found";
    pub const PARENT_NOT_FIRM: &str = "parent is not a Firm";
    pub const FIRM_HAS_PARENT: &str = "Firm cannot have a parent";
    pub const NON_FIRM_NEEDS_PARENT: &str = "non-Firm agent needs a parent";
    pub const BAD_PROOF_KIND: &str = "invalid proof kind";
    pub const BAD_ANCHOR_KIND: &str = "invalid anchor kind";
    pub const JOB_NOT_FOUND: &str = "job not found";
    pub const JOB_NOT_ACTIVE: &str = "job not active";
    pub const JOB_LOCKED: &str = "job locked";
    pub const JOB_NOT_LOCKED: &str = "job not locked";
    pub const NOT_MATURE: &str = "job not mature";
    pub const LOW_BALANCE: &str = "insufficient job balance";
    pub const BAD_PAIR: &str = "token pair not allowed";
    pub const SAME_TOKEN: &str = "token_in and token_out must differ";
    pub const ZERO_AMOUNT: &str = "amount must be greater than zero";
    pub const NO_CLAIM: &str = "nothing to claim";
    pub const NO_PENDING: &str = "no pending flow";
    pub const WITHDRAW_RUNNING: &str = "withdraw in progress";
    pub const DEPOSITING_STAGE: &str = "stage Depositing: use force_unlock";
    pub const NOT_OLD_ENOUGH: &str = "flow not old enough";
    pub const OTHER_FLOW: &str = "another flow is running";
    pub const NO_POOL: &str = "pool unknown";
    pub const BAD_HASH_LEN: &str = "hash must be 64 hex characters";
    pub const BAD_HASH_HEX: &str = "hash is not hex";
    // Alasan penolakan job (event `job_rejected`).
    pub const R_BAD_MSG: &str = "invalid msg";
    pub const R_ZERO_DURATION: &str = "duration must be greater than zero";
    pub const R_DURATION_BIG: &str = "duration too large";
    pub const R_FEE_HIGH: &str = "perf fee above 3000 bps";
    pub const R_BASE: &str = "base token not allowed";
    pub const R_NO_FIRM: &str = "firm token not found";
    pub const R_NOT_FIRM: &str = "token is not a Firm";
}

pub fn tg(n: u64) -> Gas {
    Gas::from_tgas(n)
}

/// floor(x * bps / 10000) tanpa overflow untuk x dan bps apa pun yang masuk akal.
pub fn mul_bps(x: u128, bps: u32) -> u128 {
    let b = bps as u128;
    (x / 10_000) * b + (x % 10_000) * b / 10_000
}

/// (bagian klien, fee). Fee hanya dari keuntungan. Rugi: fee 0, tanpa underflow.
/// Selalu berlaku: bagian klien + fee = `principal_end`.
pub fn split_payout(principal_in: u128, principal_end: u128, bps: u32) -> (u128, u128) {
    let profit = principal_end.saturating_sub(principal_in);
    let fee = mul_bps(profit, bps);
    (principal_end - fee, fee)
}

/// floor(diff * 10000 / peak), dibatasi 10000. `diff` <= `peak`. Aman dari overflow.
pub fn drawdown_bps(diff: u128, peak: u128) -> u32 {
    if peak == 0 {
        return 0;
    }
    let v = match diff.checked_mul(10_000) {
        Some(m) => m / peak,
        None => diff / (peak / 10_000).max(1),
    };
    v.min(10_000) as u32
}

pub fn parse_hash(s: &str) -> [u8; 32] {
    let s = s.strip_prefix("0x").unwrap_or(s);
    require!(s.len() == 64, msg::BAD_HASH_LEN);
    require!(s.bytes().all(|b| b.is_ascii_hexdigit()), msg::BAD_HASH_HEX);
    let mut out = [0u8; 32];
    for (i, o) in out.iter_mut().enumerate() {
        *o = u8::from_str_radix(&s[2 * i..2 * i + 2], 16).unwrap();
    }
    out
}

pub fn to_hex(h: &[u8; 32]) -> String {
    h.iter().map(|b| format!("{:02x}", b)).collect()
}

/// Event NEP-297 dengan standar `heliquant`.
pub fn emit(event: &str, data: Value) {
    let e = json!({"standard": "heliquant", "version": "1.0.0", "event": event, "data": [data]});
    env::log_str(&format!("EVENT_JSON:{}", e));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_parsing() {
        let h = "ab".repeat(32);
        assert_eq!(parse_hash(&h)[0], 0xab);
        assert_eq!(parse_hash(&format!("0x{h}"))[31], 0xab);
        assert_eq!(to_hex(&parse_hash(&h)), h);
    }

    #[test]
    #[should_panic(expected = "hash must be 64 hex characters")]
    fn bad_hash_length() {
        parse_hash("abcd");
    }

    #[test]
    #[should_panic(expected = "hash is not hex")]
    fn bad_hash_chars() {
        parse_hash(&"zz".repeat(32));
    }

    #[test]
    fn bps_no_overflow_at_extremes() {
        assert!(u128::MAX.checked_mul(3000).is_none());
        assert_eq!(mul_bps(u128::MAX, 3000), u128::MAX / 10_000 * 3000 + (u128::MAX % 10_000) * 3000 / 10_000);
        assert_eq!(mul_bps(u128::MAX, 10_000), u128::MAX);
        assert_eq!(mul_bps(u128::MAX, 0), 0);
        for x in [0u128, 1, 9, 10, 9_999, 10_000, 10_001, 123_456_789, 10u128.pow(30) + 7] {
            for bps in [0u32, 1, 999, 1000, 3000, 3001, 10_000] {
                assert_eq!(mul_bps(x, bps), x * bps as u128 / 10_000, "x={x} bps={bps}");
            }
        }
    }

    #[test]
    fn payout_split_profit_loss_and_scale() {
        assert_eq!(split_payout(100, 200, 1000), (190, 10));
        assert_eq!(split_payout(100, 50, 1000), (50, 0));
        assert_eq!(split_payout(100, 0, 3000), (0, 0));
        assert_eq!(split_payout(100, 100, 3000), (100, 0));
        let usdc_max = 1_000_000_000u128 * 10u128.pow(6);
        let near_max = 1_000_000_000u128 * 10u128.pow(24);
        let (c, f) = split_payout(usdc_max, usdc_max * 3, 3000);
        assert_eq!(c + f, usdc_max * 3);
        let (c, f) = split_payout(near_max, near_max * 3, 3000);
        assert_eq!(c + f, near_max * 3);
        let (c, f) = split_payout(0, u128::MAX, 3000);
        assert_eq!(c + f, u128::MAX);
        assert_eq!(f, mul_bps(u128::MAX, 3000));
    }

    #[test]
    fn payout_split_invariant_sweep() {
        for pin in [0u128, 1, 7, 1_000_000, 10u128.pow(24)] {
            for end in [0u128, 1, 6, 999_999, 1_000_000, 1_000_001, 10u128.pow(25)] {
                for bps in [0u32, 1, 2000, 3000] {
                    let (c, f) = split_payout(pin, end, bps);
                    assert_eq!(c + f, end);
                    if end <= pin {
                        assert_eq!(f, 0);
                    }
                }
            }
        }
    }

    #[test]
    fn drawdown_math() {
        assert_eq!(drawdown_bps(0, 100), 0);
        assert_eq!(drawdown_bps(50, 100), 5000);
        assert_eq!(drawdown_bps(100, 100), 10_000);
        assert_eq!(drawdown_bps(1, 3), 3333);
        assert_eq!(drawdown_bps(5, 0), 0);
        // nilai raksasa: tidak overflow dan tetap <= 10000
        assert_eq!(drawdown_bps(u128::MAX / 2, u128::MAX), 5000);
        assert!(drawdown_bps(u128::MAX, u128::MAX) <= 10_000);
    }
}
