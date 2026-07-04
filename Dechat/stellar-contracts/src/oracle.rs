use soroban_sdk::{contractclient, Address, Env};

/// Interface that any price oracle contract must implement.
/// Returns the price of a token in USD with 7 decimal places
/// (i.e. 1 USD = 10_000_000).
#[contractclient(name = "OracleClient")]
pub trait PriceOracle {
    fn get_price(env: Env, token: Address) -> Option<i128>;
}

/// A price value tagged with the ledger sequence at which it was recorded.
/// Used by oracle staleness tests.
pub struct TimestampedPrice {
    /// Price in USD with 7 decimal places (e.g. 10_000_000 = $1.00).
    pub price: i128,
    /// The ledger sequence number at which this price was recorded.
    pub recorded_at: u32,
}

impl TimestampedPrice {
    /// Returns `true` if `current_ledger - recorded_at <= max_age_ledgers`.
    /// Saturates to 0 if `current_ledger < recorded_at` (clock skew guard).
    pub fn is_fresh(&self, current_ledger: u32, max_age_ledgers: u32) -> bool {
        let age = current_ledger.saturating_sub(self.recorded_at);
        age <= max_age_ledgers
    }
}
