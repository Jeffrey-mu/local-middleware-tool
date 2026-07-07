use super::paths::data_dir;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    pub id: String,
    pub name: String,
    pub base_url: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub api_keys: Vec<String>,
    #[serde(default = "default_priority")]
    pub priority: u32,
    #[serde(default = "default_weight")]
    pub weight: u32,
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u64,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub models: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteRule {
    pub id: String,
    pub pattern: String,
    #[serde(default)]
    pub provider_ids: Vec<String>,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CircuitBreakerConfig {
    #[serde(default = "default_failure_threshold")]
    pub failure_threshold: u32,
    #[serde(default = "default_cooldown_ms")]
    pub cooldown_ms: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Strategy {
    Priority,
    RoundRobin,
    Weighted,
    Fastest,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayConfig {
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default = "default_strategy")]
    pub strategy: Strategy,
    #[serde(default = "default_max_retries")]
    pub max_retries: u32,
    #[serde(default)]
    pub circuit_breaker: CircuitBreakerConfig,
    #[serde(default)]
    pub providers: Vec<ProviderConfig>,
    #[serde(default)]
    pub rules: Vec<RouteRule>,
}

impl Default for CircuitBreakerConfig {
    fn default() -> Self {
        Self {
            failure_threshold: default_failure_threshold(),
            cooldown_ms: default_cooldown_ms(),
        }
    }
}

impl Default for GatewayConfig {
    fn default() -> Self {
        Self {
            port: default_port(),
            strategy: default_strategy(),
            max_retries: default_max_retries(),
            circuit_breaker: CircuitBreakerConfig::default(),
            providers: vec![
                ProviderConfig {
                    id: "polo".into(),
                    name: "Polo API".into(),
                    base_url: "https://api.example.com/v1".into(),
                    api_key: String::new(),
                    api_keys: vec![],
                    priority: 1,
                    weight: 100,
                    timeout_ms: default_timeout_ms(),
                    enabled: false,
                    models: vec!["gpt-*".into()],
                },
                ProviderConfig {
                    id: "openrouter".into(),
                    name: "OpenRouter".into(),
                    base_url: "https://openrouter.ai/api/v1".into(),
                    api_key: String::new(),
                    api_keys: vec![],
                    priority: 2,
                    weight: 60,
                    timeout_ms: default_timeout_ms(),
                    enabled: false,
                    models: vec!["*".into()],
                },
            ],
            rules: vec![RouteRule {
                id: "default-gpt".into(),
                pattern: "gpt-*".into(),
                provider_ids: vec!["polo".into(), "openrouter".into()],
                enabled: true,
            }],
        }
    }
}

pub async fn load_config() -> Result<GatewayConfig> {
    let path = config_path();
    tokio::fs::create_dir_all(path.parent().expect("config path has parent")).await?;

    match tokio::fs::read_to_string(&path).await {
        Ok(raw) => Ok(serde_json::from_str(&raw)?),
        Err(_) => save_config(GatewayConfig::default()).await,
    }
}

pub async fn save_config(config: GatewayConfig) -> Result<GatewayConfig> {
    let path = config_path();
    tokio::fs::create_dir_all(path.parent().expect("config path has parent")).await?;
    tokio::fs::write(&path, serde_json::to_string_pretty(&config)?).await?;
    Ok(config)
}

pub fn provider_auth_key(provider: &ProviderConfig) -> Option<String> {
    provider
        .api_keys
        .iter()
        .find(|key| !key.is_empty())
        .cloned()
        .or_else(|| (!provider.api_key.is_empty()).then(|| provider.api_key.clone()))
}

pub fn trim_provider_base_url(base_url: &str) -> String {
    base_url.trim_end_matches('/').to_string()
}

fn config_path() -> PathBuf {
    data_dir().join("gateway.json")
}

fn default_port() -> u16 {
    8787
}

fn default_strategy() -> Strategy {
    Strategy::Priority
}

fn default_max_retries() -> u32 {
    3
}

fn default_failure_threshold() -> u32 {
    5
}

fn default_cooldown_ms() -> u64 {
    60_000
}

fn default_priority() -> u32 {
    1
}

fn default_weight() -> u32 {
    100
}

fn default_timeout_ms() -> u64 {
    30_000
}

fn default_enabled() -> bool {
    true
}
