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

pub fn select_providers(
    config: &GatewayConfig,
    state: &mut GatewayState,
    model: &str,
    round_robin_index: &mut usize,
) -> Vec<ProviderConfig> {
    let enabled: Vec<ProviderConfig> = config
        .providers
        .iter()
        .filter(|provider| provider.enabled && !state.is_circuit_open(provider))
        .cloned()
        .collect();

    let matching_rule = config.rules.iter().find(|rule| {
        rule.enabled
            && Pattern::new(&rule.pattern)
                .map(|pattern| pattern.matches(model))
                .unwrap_or(false)
    });

    let mut candidates =
        if let Some(rule) = matching_rule.filter(|rule| !rule.provider_ids.is_empty()) {
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
        Strategy::StablePriority => {
            let statuses = state.provider_statuses();
            candidates.sort_by_key(|provider| {
                let stable_rank = statuses
                    .iter()
                    .find(|status| status.provider_id == provider.id)
                    .map(|status| {
                        if status.online && status.successes > 0 && status.consecutive_failures == 0
                        {
                            0
                        } else {
                            1
                        }
                    })
                    .unwrap_or(1);
                (stable_rank, provider.priority)
            });
            candidates
        }
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
            candidates
                .sort_by_key(|provider| (std::cmp::Reverse(provider.weight), provider.priority));
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
        success_rate: if requests == 0 {
            1.0
        } else {
            successes as f64 / requests as f64
        },
        online_providers: statuses.iter().filter(|item| item.online).count(),
    }
}

pub fn should_failover_status(status_code: u16) -> bool {
    !(200..400).contains(&status_code)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gateway::config::{CircuitBreakerConfig, RouteRule};

    fn provider(id: &str, priority: u32) -> ProviderConfig {
        ProviderConfig {
            id: id.into(),
            name: id.into(),
            base_url: "https://example.test/v1".into(),
            api_key: "key".into(),
            api_keys: vec![],
            priority,
            weight: 100,
            timeout_ms: 30_000,
            enabled: true,
            models: vec!["*".into()],
        }
    }

    fn config(strategy: Strategy, providers: Vec<ProviderConfig>) -> GatewayConfig {
        GatewayConfig {
            port: 8787,
            strategy,
            max_retries: 3,
            circuit_breaker: CircuitBreakerConfig {
                failure_threshold: 5,
                cooldown_ms: 60_000,
            },
            providers,
            rules: vec![RouteRule {
                id: "default".into(),
                pattern: "*".into(),
                provider_ids: vec![],
                enabled: true,
            }],
        }
    }

    #[test]
    fn stable_priority_keeps_successful_provider_first() {
        let stable = provider("stable", 20);
        let cold = provider("cold", 1);
        let mut state = GatewayState::default();
        state.record_success(&stable, 120, true);
        let mut round_robin_index = 0;

        let selected = select_providers(
            &config(Strategy::StablePriority, vec![cold.clone(), stable.clone()]),
            &mut state,
            "gpt-5.5",
            &mut round_robin_index,
        );

        assert_eq!(
            selected.first().map(|provider| provider.id.as_str()),
            Some("stable")
        );
    }

    #[test]
    fn stable_priority_falls_back_after_provider_failure() {
        let failed = provider("failed", 1);
        let stable = provider("stable", 20);
        let mut state = GatewayState::default();
        state.record_success(&failed, 100, true);
        state.record_failure(&failed, 200, Some(429), false, 1, 60_000, true);
        state.record_success(&stable, 120, true);
        let mut round_robin_index = 0;

        let selected = select_providers(
            &config(
                Strategy::StablePriority,
                vec![failed.clone(), stable.clone()],
            ),
            &mut state,
            "gpt-5.5",
            &mut round_robin_index,
        );

        assert_eq!(
            selected.first().map(|provider| provider.id.as_str()),
            Some("stable")
        );
        assert!(!selected.iter().any(|provider| provider.id == "failed"));
    }
}
