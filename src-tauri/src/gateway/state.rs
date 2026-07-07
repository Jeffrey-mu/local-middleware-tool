use super::config::ProviderConfig;
use super::paths::data_dir;
use anyhow::Result;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatus {
    pub provider_id: String,
    pub online: bool,
    pub latency_ms: Option<u64>,
    pub consecutive_failures: u32,
    pub circuit_open_until: Option<i64>,
    pub last_success_at: Option<String>,
    pub last_failure_at: Option<String>,
    pub requests: u64,
    pub successes: u64,
    pub failures: u64,
    pub status429: u64,
    pub status500: u64,
    pub timeouts: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestLog {
    pub id: String,
    pub at: String,
    pub api_key_name: String,
    pub model: String,
    pub path: String,
    pub method: String,
    pub provider: String,
    pub provider_id: String,
    pub status: serde_json::Value,
    pub latency_ms: u64,
    pub retry: usize,
    pub stream: bool,
    pub billing_mode: String,
    pub prompt_tokens: u64,
    #[serde(default)]
    pub cached_tokens: u64,
    pub completion_tokens: u64,
    pub total_tokens: u64,
    pub cost_usd: f64,
    pub first_token_ms: Option<u64>,
    pub user_agent: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Default)]
pub struct GatewayState {
    statuses: HashMap<String, ProviderStatus>,
    request_logs: Vec<RequestLog>,
}

impl GatewayState {
    pub async fn load() -> Self {
        let mut state = Self::default();
        if let Ok(raw) = tokio::fs::read_to_string(usage_path()).await {
            if let Ok(mut logs) = serde_json::from_str::<Vec<RequestLog>>(&raw) {
                logs.truncate(5000);
                state.request_logs = logs;
            }
        }
        state
    }

    pub fn ensure_provider_status(&mut self, provider: &ProviderConfig) {
        self.statuses
            .entry(provider.id.clone())
            .or_insert_with(|| ProviderStatus {
                provider_id: provider.id.clone(),
                online: false,
                latency_ms: None,
                consecutive_failures: 0,
                circuit_open_until: None,
                last_success_at: None,
                last_failure_at: None,
                requests: 0,
                successes: 0,
                failures: 0,
                status429: 0,
                status500: 0,
                timeouts: 0,
            });
    }

    pub fn provider_statuses(&self) -> Vec<ProviderStatus> {
        self.statuses.values().cloned().collect()
    }

    pub fn is_circuit_open(&self, provider: &ProviderConfig) -> bool {
        self.statuses
            .get(&provider.id)
            .and_then(|status| status.circuit_open_until)
            .is_some_and(|until| until > Utc::now().timestamp_millis())
    }

    pub fn record_success(&mut self, provider: &ProviderConfig, latency_ms: u64, count_request: bool) {
        self.ensure_provider_status(provider);
        let status = self.statuses.get_mut(&provider.id).expect("status exists");
        status.online = true;
        status.latency_ms = Some(latency_ms);
        status.consecutive_failures = 0;
        status.circuit_open_until = None;
        status.last_success_at = Some(Utc::now().to_rfc3339());
        if count_request {
            status.requests += 1;
            status.successes += 1;
        }
    }

    pub fn record_failure(
        &mut self,
        provider: &ProviderConfig,
        latency_ms: u64,
        status_code: Option<u16>,
        timeout: bool,
        failure_threshold: u32,
        cooldown_ms: u64,
        count_request: bool,
    ) {
        self.ensure_provider_status(provider);
        let status = self.statuses.get_mut(&provider.id).expect("status exists");
        status.online = false;
        status.latency_ms = Some(latency_ms);
        status.last_failure_at = Some(Utc::now().to_rfc3339());
        if count_request {
            status.requests += 1;
            status.failures += 1;
        }
        status.consecutive_failures += 1;
        if status_code == Some(429) {
            status.status429 += 1;
        }
        if status_code.is_some_and(|code| code >= 500) {
            status.status500 += 1;
        }
        if timeout {
            status.timeouts += 1;
        }
        if status.consecutive_failures >= failure_threshold {
            status.circuit_open_until = Some(Utc::now().timestamp_millis() + cooldown_ms as i64);
        }
    }

    pub async fn add_request_log(&mut self, log: RequestLog) {
        self.request_logs.insert(0, log);
        self.request_logs.truncate(5000);
        let _ = self.persist_request_logs().await;
    }

    pub fn request_logs(&self) -> Vec<RequestLog> {
        self.request_logs.clone()
    }

    pub async fn update_request_logs<F>(&mut self, updater: F)
    where
        F: Fn(&RequestLog) -> RequestLog,
    {
        self.request_logs = self.request_logs.iter().map(updater).collect();
        let _ = self.persist_request_logs().await;
    }

    async fn persist_request_logs(&self) -> Result<()> {
        let path = usage_path();
        tokio::fs::create_dir_all(path.parent().expect("usage path has parent")).await?;
        tokio::fs::write(path, serde_json::to_string_pretty(&self.request_logs)?).await?;
        Ok(())
    }
}

fn usage_path() -> PathBuf {
    data_dir().join("usage.json")
}
