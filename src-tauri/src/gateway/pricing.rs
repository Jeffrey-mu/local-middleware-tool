use super::paths::data_dir;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelPricing {
    pub model: String,
    #[serde(default)]
    pub input_usd_per_million: f64,
    #[serde(default)]
    pub cached_input_usd_per_million: f64,
    #[serde(default)]
    pub output_usd_per_million: f64,
    #[serde(default = "default_source")]
    pub source: String,
    #[serde(default)]
    pub updated_at: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct PricingTable {
    #[serde(default)]
    pub models: Vec<ModelPricing>,
}

#[derive(Clone, Debug, Default)]
pub struct TokenUsage {
    pub prompt_tokens: u64,
    pub cached_tokens: u64,
    pub completion_tokens: u64,
    pub total_tokens: u64,
}

pub async fn load_pricing_table() -> Result<PricingTable> {
    let path = pricing_path();
    tokio::fs::create_dir_all(path.parent().expect("pricing path has parent")).await?;

    match tokio::fs::read_to_string(&path).await {
        Ok(raw) => Ok(serde_json::from_str(&raw)?),
        Err(_) => save_pricing_table(PricingTable::default()).await,
    }
}

pub async fn save_pricing_table(table: PricingTable) -> Result<PricingTable> {
    let path = pricing_path();
    tokio::fs::create_dir_all(path.parent().expect("pricing path has parent")).await?;
    tokio::fs::write(&path, serde_json::to_string_pretty(&table)?).await?;
    Ok(table)
}

pub fn estimate_cost_usd(table: &PricingTable, model: &str, usage: &TokenUsage) -> f64 {
    let Some(pricing) = table
        .models
        .iter()
        .find(|item| item.model == model)
        .or_else(|| table.models.iter().find(|item| item.model == "*"))
    else {
        return 0.0;
    };

    usage.prompt_tokens as f64 * per_token(pricing.input_usd_per_million)
        + usage.cached_tokens as f64 * per_token(pricing.cached_input_usd_per_million)
        + usage.completion_tokens as f64 * per_token(pricing.output_usd_per_million)
}

pub fn parse_usage(payload: &serde_json::Value) -> TokenUsage {
    let usage = payload.get("usage").unwrap_or(&serde_json::Value::Null);
    let input_tokens = usage
        .get("prompt_tokens")
        .or_else(|| usage.get("input_tokens"))
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);
    let input_details = usage
        .get("prompt_tokens_details")
        .or_else(|| usage.get("input_tokens_details"))
        .unwrap_or(&serde_json::Value::Null);
    let cached_tokens = input_details
        .get("cached_tokens")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);
    let completion_tokens = usage
        .get("completion_tokens")
        .or_else(|| usage.get("output_tokens"))
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);
    let total_tokens = usage
        .get("total_tokens")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(input_tokens + completion_tokens);

    TokenUsage {
        prompt_tokens: input_tokens.saturating_sub(cached_tokens),
        cached_tokens,
        completion_tokens,
        total_tokens,
    }
}

fn pricing_path() -> PathBuf {
    data_dir().join("model-pricing.json")
}

fn per_token(usd_per_million: f64) -> f64 {
    usd_per_million / 1_000_000.0
}

fn default_source() -> String {
    "manual".into()
}
