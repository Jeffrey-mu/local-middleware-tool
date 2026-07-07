use super::config::{GatewayConfig, ProviderConfig, Strategy};
use super::state::GatewayState;
use glob::Pattern;
use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricsSummary {
    pub requests: u64,
    pub successes: u64,
    pub failures: u64,
    pub success_rate: f64,
    pub online_providers: usize,
}

pub fn select_providers(config: &GatewayConfig, state: &mut GatewayState, model: &str, round_robin_index: &mut usize) -> Vec<ProviderConfig> {
    let enabled: Vec<ProviderConfig> = config
        .providers
        .iter()
        .filter(|provider| provider.enabled && !state.is_circuit_open(provider))
        .cloned()
        .collect();

    let matching_rule = config.rules.iter().find(|rule| {
        rule.enabled && Pattern::new(&rule.pattern).map(|pattern| pattern.matches(model)).unwrap_or(false)
    });

    let mut candidates = if let Some(rule) = matching_rule.filter(|rule| !rule.provider_ids.is_empty()) {
        let mut preferred: Vec<ProviderConfig> = rule
            .provider_ids
            .iter()
            .filter_map(|id| enabled.iter().find(|provider| provider.id == *id).cloned())
            .collect();
        let mut fallback: Vec<ProviderConfig> = enabled
            .iter()
            .filter(|provider| !rule.provider_ids.contains(&provider.id))
            .cloned()
            .collect();
        if preferred.is_empty() {
            enabled
        } else {
            preferred.append(&mut fallback);
            preferred
        }
    } else {
        enabled
    };

    match config.strategy {
        Strategy::Fastest => {
            let statuses = state.provider_statuses();
            candidates.sort_by_key(|provider| {
                let latency = statuses
                    .iter()
                    .find(|status| status.provider_id == provider.id)
                    .and_then(|status| status.latency_ms)
                    .unwrap_or(u64::MAX);
                (latency, provider.priority)
            });
            candidates
        }
        Strategy::RoundRobin => {
            if candidates.is_empty() {
                return candidates;
            }
            let start = *round_robin_index % candidates.len();
            candidates.rotate_left(start);
            *round_robin_index = (*round_robin_index + 1) % candidates.len();
            candidates
        }
        Strategy::Weighted => {
            candidates.sort_by_key(|provider| (std::cmp::Reverse(provider.weight), provider.priority));
            candidates
        }
        Strategy::Priority => {
            candidates.sort_by_key(|provider| provider.priority);
            candidates
        }
    }
}

pub fn metrics_summary(state: &GatewayState) -> MetricsSummary {
    let statuses = state.provider_statuses();
    let requests = statuses.iter().map(|item| item.requests).sum();
    let successes = statuses.iter().map(|item| item.successes).sum();
    let failures = statuses.iter().map(|item| item.failures).sum();
    MetricsSummary {
        requests,
        successes,
        failures,
        success_rate: if requests == 0 { 1.0 } else { successes as f64 / requests as f64 },
        online_providers: statuses.iter().filter(|item| item.online).count(),
    }
}

pub fn should_failover_status(status_code: u16) -> bool {
    !(200..400).contains(&status_code)
}
