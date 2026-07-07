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
        Ok(raw) => {
            let table = serde_json::from_str::<PricingTable>(&raw)?;
            if table.models.is_empty() {
                return restore_seed_pricing_table().await;
            }
            Ok(table)
        }
        Err(_) => restore_seed_pricing_table().await,
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

async fn restore_seed_pricing_table() -> Result<PricingTable> {
    if let Some(seed_path) = seed_pricing_path() {
        if let Ok(raw) = tokio::fs::read_to_string(seed_path).await {
            let table = serde_json::from_str::<PricingTable>(&raw)?;
            if !table.models.is_empty() {
                return save_pricing_table(table).await;
            }
        }
    }

    save_pricing_table(PricingTable::default()).await
}

fn seed_pricing_path() -> Option<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(path) = std::env::var("AIGATE_PRICING_SEED") {
        candidates.push(PathBuf::from(path));
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(contents_dir) = exe.parent().and_then(|path| path.parent()) {
            candidates.push(contents_dir.join("Resources/model-pricing.json"));
            candidates.push(contents_dir.join("Resources/_up_/data/model-pricing.json"));
        }
    }

    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("data/model-pricing.json"));
    }

    candidates.into_iter().find(|candidate| candidate.is_file())
}

fn per_token(usd_per_million: f64) -> f64 {
    usd_per_million / 1_000_000.0
}

fn default_source() -> String {
    "manual".into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[tokio::test]
    async fn restores_seed_when_existing_pricing_table_is_empty() {
        let test_dir = std::env::temp_dir().join(format!("aigate-pricing-{}", nanoid::nanoid!()));
        tokio::fs::create_dir_all(&test_dir).await.unwrap();
        tokio::fs::write(test_dir.join("model-pricing.json"), r#"{"models":[]}"#)
            .await
            .unwrap();

        let seed_path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("data/model-pricing.json");
        let previous_data_dir = std::env::var("AIGATE_DATA_DIR").ok();
        let previous_seed = std::env::var("AIGATE_PRICING_SEED").ok();

        std::env::set_var("AIGATE_DATA_DIR", &test_dir);
        std::env::set_var("AIGATE_PRICING_SEED", seed_path);

        let table = load_pricing_table().await.unwrap();

        if let Some(value) = previous_data_dir {
            std::env::set_var("AIGATE_DATA_DIR", value);
        } else {
            std::env::remove_var("AIGATE_DATA_DIR");
        }
        if let Some(value) = previous_seed {
            std::env::set_var("AIGATE_PRICING_SEED", value);
        } else {
            std::env::remove_var("AIGATE_PRICING_SEED");
        }
        let _ = tokio::fs::remove_dir_all(&test_dir).await;

        assert!(!table.models.is_empty());
        assert!(table.models.iter().any(|item| item.model == "gpt-5.5"));
    }
}
