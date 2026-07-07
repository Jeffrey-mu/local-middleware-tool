use super::config::{load_config, provider_auth_key, save_config, trim_provider_base_url, GatewayConfig, ProviderConfig};
use super::paths::data_dir;
use super::pricing::{estimate_cost_usd, load_pricing_table, parse_usage, save_pricing_table, PricingTable, TokenUsage};
use super::router::{metrics_summary, select_providers, should_failover_status};
use super::state::{GatewayState, RequestLog};
use anyhow::Result;
use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, get, post, put};
use axum::{Json, Router};
use chrono::Utc;
use futures_util::StreamExt;
use nanoid::nanoid;
use reqwest::Client;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Mutex;
use tower_http::cors::{Any, CorsLayer};

#[derive(Clone)]
pub struct AppState {
    inner: Arc<Mutex<InnerState>>,
    client: Client,
}

pub struct InnerState {
    pub config: GatewayConfig,
    pub pricing: PricingTable,
    pub gateway_state: GatewayState,
    pub round_robin_index: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusPayload {
    endpoint: String,
    config: GatewayConfig,
    pricing: PricingTable,
    metrics: super::router::MetricsSummary,
    providers: Vec<super::state::ProviderStatus>,
    logs: Vec<RequestLog>,
    analytics: Value,
}

pub async fn run() -> Result<()> {
    let config = load_config().await?;
    let pricing = load_pricing_table().await?;
    let mut gateway_state = GatewayState::load().await;
    for provider in &config.providers {
        gateway_state.ensure_provider_status(provider);
    }

    let port = config.port;
    let state = AppState {
        inner: Arc::new(Mutex::new(InnerState {
            config,
            pricing,
            gateway_state,
            round_robin_index: 0,
        })),
        client: Client::builder().no_proxy().build()?,
    };

    recalculate_logged_costs(&state).await;

    let app = Router::new()
        .route("/admin/status", get(admin_status))
        .route("/admin/trace", get(admin_trace))
        .route("/admin/config", put(admin_config))
        .route("/admin/pricing", get(admin_pricing).put(admin_pricing_put))
        .route("/admin/health-check", post(admin_health_check))
        .route("/v1/{*path}", any(proxy_v1))
        .layer(CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any))
        .with_state(state);

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

async fn admin_status(State(state): State<AppState>) -> Json<StatusPayload> {
    let inner = state.inner.lock().await;
    let analytics = build_analytics(&inner.gateway_state.request_logs());
    Json(StatusPayload {
        endpoint: format!("http://127.0.0.1:{}/v1", inner.config.port),
        config: inner.config.clone(),
        pricing: inner.pricing.clone(),
        metrics: metrics_summary(&inner.gateway_state),
        providers: inner.gateway_state.provider_statuses(),
        logs: inner.gateway_state.request_logs(),
        analytics,
    })
}

async fn admin_trace() -> Json<Value> {
    Json(json!({ "traces": read_trace_events().await }))
}

async fn admin_config(State(state): State<AppState>, Json(config): Json<GatewayConfig>) -> impl IntoResponse {
    match save_config(config).await {
        Ok(config) => {
            let mut inner = state.inner.lock().await;
            inner.config = config.clone();
            let providers = inner.config.providers.clone();
            for provider in &providers {
                inner.gateway_state.ensure_provider_status(provider);
            }
            (StatusCode::OK, Json(json!({ "ok": true, "config": config })))
        }
        Err(error) => error_response(StatusCode::BAD_REQUEST, error.to_string()),
    }
}

async fn admin_pricing(State(state): State<AppState>) -> Json<PricingTable> {
    let inner = state.inner.lock().await;
    Json(inner.pricing.clone())
}

async fn admin_pricing_put(State(state): State<AppState>, Json(table): Json<PricingTable>) -> impl IntoResponse {
    match save_pricing_table(table).await {
        Ok(table) => {
            {
                let mut inner = state.inner.lock().await;
                inner.pricing = table.clone();
            }
            recalculate_logged_costs(&state).await;
            (StatusCode::OK, Json(json!(table)))
        }
        Err(error) => error_response(StatusCode::BAD_REQUEST, error.to_string()),
    }
}

async fn admin_health_check(State(state): State<AppState>) -> impl IntoResponse {
    let providers = {
        let inner = state.inner.lock().await;
        inner.config.providers.clone()
    };

    for provider in providers.into_iter().filter(|provider| provider.enabled) {
        let result = probe_provider(&state.client, &provider).await;
        let mut inner = state.inner.lock().await;
        let breaker = inner.config.circuit_breaker.clone();
        if result.ok {
            inner.gateway_state.record_success(&provider, result.latency_ms, false);
        } else {
            inner.gateway_state.record_failure(
                &provider,
                result.latency_ms,
                result.status_code,
                false,
                breaker.failure_threshold,
                breaker.cooldown_ms,
                false,
            );
        }
    }

    let inner = state.inner.lock().await;
    (StatusCode::OK, Json(json!({ "ok": true, "providers": inner.gateway_state.provider_statuses() })))
}

async fn proxy_v1(
    State(state): State<AppState>,
    Path(path): Path<String>,
    method: Method,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    let client_path = format!("/v1/{path}");
    let upstream_path = format!("/{path}");
    let body_value = serde_json::from_slice::<Value>(&body).ok();
    let model = body_value.as_ref().and_then(get_model_name).unwrap_or_else(|| "unknown".into());
    let stream = body_value.as_ref().is_some_and(is_streaming_request);
    let user_agent = header_string(&headers, "user-agent");
    let api_key_name = format_api_key_name(&header_string(&headers, "authorization"));

    let providers = {
        let mut inner = state.inner.lock().await;
        let config = inner.config.clone();
        let mut round_robin_index = inner.round_robin_index;
        let providers = select_providers(&config, &mut inner.gateway_state, &model, &mut round_robin_index);
        inner.round_robin_index = round_robin_index;
        providers
    };

    if providers.is_empty() {
        return json_error(StatusCode::SERVICE_UNAVAILABLE, "No enabled provider is available.", "gateway_unavailable");
    }

    let mut last_error = "All providers failed.".to_string();

    for (retry, provider) in providers.iter().enumerate() {
        let started = Instant::now();
        let target = format!("{}{}", trim_provider_base_url(&provider.base_url), upstream_path);
        let upstream = state
            .client
            .request(method.clone(), &target)
            .headers(forward_headers(&headers, provider))
            .body(body.clone())
            .timeout(std::time::Duration::from_millis(provider.timeout_ms))
            .send()
            .await;

        match upstream {
            Ok(upstream) => {
                let latency_ms = started.elapsed().as_millis() as u64;
                let status = upstream.status();
                let status_code = status.as_u16();
                let response_headers = upstream.headers().clone();

                if should_failover_status(status_code) && retry < providers.len() - 1 {
                    let detail = upstream.text().await.unwrap_or_default();
                    last_error = format_upstream_failure(&provider.name, &target, status_code, &summarize_text(&detail));
                    record_failed_attempt(
                        &state,
                        provider,
                        status_code,
                        latency_ms,
                        retry,
                        &api_key_name,
                        &model,
                        &client_path,
                        &method,
                        stream,
                        &user_agent,
                        Some(format!("Failover to next provider: {last_error}")),
                    )
                    .await;
                    continue;
                }

                if stream {
                    let mut response = Response::builder().status(status);
                    copy_response_headers(response.headers_mut().expect("headers"), &response_headers);
                    let byte_stream = upstream.bytes_stream().map(|chunk| chunk.map_err(std::io::Error::other));
                    record_success_attempt(
                        &state,
                        provider,
                        status_code,
                        latency_ms,
                        retry,
                        &api_key_name,
                        &model,
                        &client_path,
                        &method,
                        stream::empty_usage(),
                        true,
                        &user_agent,
                    )
                    .await;
                    return response.body(Body::from_stream(byte_stream)).unwrap_or_else(|error| {
                        json_error(StatusCode::BAD_GATEWAY, &error.to_string(), "gateway_stream_error")
                    });
                }

                let text = upstream.text().await.unwrap_or_default();
                let usage = serde_json::from_str::<Value>(&text).map(|payload| parse_usage(&payload)).unwrap_or_default();
                record_success_attempt(
                    &state,
                    provider,
                    status_code,
                    latency_ms,
                    retry,
                    &api_key_name,
                    &model,
                    &client_path,
                    &method,
                    usage,
                    stream,
                    &user_agent,
                )
                .await;

                let mut response = Response::builder().status(status);
                copy_response_headers(response.headers_mut().expect("headers"), &response_headers);
                return response.body(Body::from(text)).unwrap_or_else(|error| {
                    json_error(StatusCode::BAD_GATEWAY, &error.to_string(), "gateway_response_error")
                });
            }
            Err(error) => {
                let latency_ms = started.elapsed().as_millis() as u64;
                last_error = format!("Provider {} request failed at {}: {}", provider.name, target, error);
                record_error_attempt(
                    &state,
                    provider,
                    latency_ms,
                    retry,
                    &api_key_name,
                    &model,
                    &client_path,
                    &method,
                    stream,
                    &user_agent,
                    &last_error,
                    error.is_timeout(),
                )
                .await;
            }
        }
    }

    json_error(StatusCode::BAD_GATEWAY, &last_error, "gateway_provider_error")
}

async fn record_failed_attempt(
    state: &AppState,
    provider: &ProviderConfig,
    status_code: u16,
    latency_ms: u64,
    retry: usize,
    api_key_name: &str,
    model: &str,
    path: &str,
    method: &Method,
    stream: bool,
    user_agent: &str,
    message: Option<String>,
) {
    let mut inner = state.inner.lock().await;
    let breaker = inner.config.circuit_breaker.clone();
    inner.gateway_state.record_failure(provider, latency_ms, Some(status_code), false, breaker.failure_threshold, breaker.cooldown_ms, true);
    let log = request_log(provider, serde_json::Value::from(status_code), latency_ms, retry, api_key_name, model, path, method, stream, TokenUsage::default(), 0.0, None, user_agent, message);
    inner.gateway_state.add_request_log(log).await;
}

async fn record_error_attempt(
    state: &AppState,
    provider: &ProviderConfig,
    latency_ms: u64,
    retry: usize,
    api_key_name: &str,
    model: &str,
    path: &str,
    method: &Method,
    stream: bool,
    user_agent: &str,
    message: &str,
    timeout: bool,
) {
    let mut inner = state.inner.lock().await;
    let breaker = inner.config.circuit_breaker.clone();
    inner.gateway_state.record_failure(provider, latency_ms, None, timeout, breaker.failure_threshold, breaker.cooldown_ms, true);
    let status = if timeout { json!("timeout") } else { json!("error") };
    let log = request_log(provider, status, latency_ms, retry, api_key_name, model, path, method, stream, TokenUsage::default(), 0.0, None, user_agent, Some(message.into()));
    inner.gateway_state.add_request_log(log).await;
}

async fn record_success_attempt(
    state: &AppState,
    provider: &ProviderConfig,
    status_code: u16,
    latency_ms: u64,
    retry: usize,
    api_key_name: &str,
    model: &str,
    path: &str,
    method: &Method,
    usage: TokenUsage,
    stream: bool,
    user_agent: &str,
) {
    let mut inner = state.inner.lock().await;
    inner.gateway_state.record_success(provider, latency_ms, true);
    let cost = estimate_cost_usd(&inner.pricing, model, &usage);
    let log = request_log(provider, serde_json::Value::from(status_code), latency_ms, retry, api_key_name, model, path, method, stream, usage, cost, None, user_agent, None);
    inner.gateway_state.add_request_log(log).await;
}

fn request_log(
    provider: &ProviderConfig,
    status: Value,
    latency_ms: u64,
    retry: usize,
    api_key_name: &str,
    model: &str,
    path: &str,
    method: &Method,
    stream: bool,
    usage: TokenUsage,
    cost_usd: f64,
    first_token_ms: Option<u64>,
    user_agent: &str,
    message: Option<String>,
) -> RequestLog {
    RequestLog {
        id: nanoid!(10),
        at: Utc::now().to_rfc3339(),
        api_key_name: api_key_name.into(),
        model: model.into(),
        path: path.into(),
        method: method.to_string(),
        provider: provider.name.clone(),
        provider_id: provider.id.clone(),
        status,
        latency_ms,
        retry,
        stream,
        billing_mode: "按量".into(),
        prompt_tokens: usage.prompt_tokens,
        cached_tokens: usage.cached_tokens,
        completion_tokens: usage.completion_tokens,
        total_tokens: usage.total_tokens,
        cost_usd,
        first_token_ms,
        user_agent: user_agent.into(),
        message,
    }
}

async fn recalculate_logged_costs(state: &AppState) {
    let mut inner = state.inner.lock().await;
    let pricing = inner.pricing.clone();
    inner
        .gateway_state
        .update_request_logs(|log| {
            let usage = TokenUsage {
                prompt_tokens: log.prompt_tokens,
                cached_tokens: log.cached_tokens,
                completion_tokens: log.completion_tokens,
                total_tokens: log.total_tokens,
            };
            let mut next = log.clone();
            next.cost_usd = estimate_cost_usd(&pricing, &log.model, &usage);
            next
        })
        .await;
}

struct ProbeResult {
    ok: bool,
    latency_ms: u64,
    status_code: Option<u16>,
}

async fn probe_provider(client: &Client, provider: &ProviderConfig) -> ProbeResult {
    let started = Instant::now();
    let headers = provider_auth_key(provider)
        .and_then(|key| HeaderValue::from_str(&format!("Bearer {key}")).ok())
        .map(|value| {
            let mut headers = HeaderMap::new();
            headers.insert(axum::http::header::AUTHORIZATION, value);
            headers
        })
        .unwrap_or_default();

    for path in ["/models", "/v1/models"] {
        let url = format!("{}{}", trim_provider_base_url(&provider.base_url), path);
        let response = client
            .get(url)
            .headers(headers.clone())
            .timeout(std::time::Duration::from_millis(provider.timeout_ms.min(10_000)))
            .send()
            .await;

        if let Ok(response) = response {
            let status = response.status().as_u16();
            let content_type = response
                .headers()
                .get(axum::http::header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .unwrap_or("");
            let ok = (200..500).contains(&status) && content_type.contains("application/json");
            if ok || path == "/v1/models" {
                return ProbeResult {
                    ok,
                    latency_ms: started.elapsed().as_millis() as u64,
                    status_code: Some(status),
                };
            }
        }
    }

    ProbeResult {
        ok: false,
        latency_ms: started.elapsed().as_millis() as u64,
        status_code: None,
    }
}

fn get_model_name(payload: &Value) -> Option<String> {
    payload.get("model").and_then(Value::as_str).map(str::to_string)
}

fn is_streaming_request(payload: &Value) -> bool {
    payload.get("stream").and_then(Value::as_bool).unwrap_or(false)
}

fn forward_headers(headers: &HeaderMap, provider: &ProviderConfig) -> HeaderMap {
    let mut next = HeaderMap::new();
    for (key, value) in headers.iter() {
        let name = key.as_str().to_ascii_lowercase();
        if matches!(name.as_str(), "host" | "content-length" | "connection") {
            continue;
        }
        next.insert(key, value.clone());
    }
    if let Some(key) = provider_auth_key(provider) {
        if let Ok(value) = HeaderValue::from_str(&format!("Bearer {key}")) {
            next.insert(axum::http::header::AUTHORIZATION, value);
        }
    }
    next
}

fn copy_response_headers(target: &mut HeaderMap, source: &HeaderMap) {
    for (key, value) in source.iter() {
        if key != axum::http::header::TRANSFER_ENCODING {
            target.insert(key, value.clone());
        }
    }
}

fn header_string(headers: &HeaderMap, name: &str) -> String {
    HeaderName::from_bytes(name.as_bytes())
        .ok()
        .and_then(|name| headers.get(name))
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string()
}

fn format_api_key_name(authorization: &str) -> String {
    let token = authorization.trim_start_matches("Bearer ").trim();
    if token.is_empty() {
        "未提供".into()
    } else if token.starts_with("sk-") && token.len() > 10 {
        format!("{}...{}", &token[..6], &token[token.len().saturating_sub(4)..])
    } else if token.len() > 18 {
        format!("{}...", &token[..12])
    } else {
        token.into()
    }
}

fn summarize_text(text: &str) -> String {
    serde_json::from_str::<Value>(text)
        .ok()
        .and_then(|payload| payload.pointer("/error/message").or_else(|| payload.get("message")).and_then(Value::as_str).map(str::to_string))
        .unwrap_or_else(|| text.split_whitespace().collect::<Vec<_>>().join(" "))
        .chars()
        .take(500)
        .collect()
}

fn format_upstream_failure(provider_name: &str, target: &str, status_code: u16, detail: &str) -> String {
    let suffix = if detail.is_empty() { String::new() } else { format!(": {detail}") };
    format!("Provider {provider_name} returned {status_code} from {target}{suffix}")
}

fn json_error(status: StatusCode, message: &str, error_type: &str) -> Response {
    (status, Json(json!({ "error": { "message": message, "type": error_type } }))).into_response()
}

fn error_response(status: StatusCode, message: String) -> (StatusCode, Json<Value>) {
    (status, Json(json!({ "error": { "message": message, "type": "gateway_request_error" } })))
}

fn build_analytics(logs: &[RequestLog]) -> Value {
    let successes: Vec<&RequestLog> = logs
        .iter()
        .filter(|log| log.status.as_u64().is_some_and(|status| (200..400).contains(&status)))
        .collect();
    let total_tokens: u64 = logs.iter().map(|log| log.total_tokens).sum();
    let total_cost: f64 = logs.iter().map(|log| log.cost_usd).sum();
    let avg_latency_ms = if successes.is_empty() {
        0.0
    } else {
        successes.iter().map(|log| log.latency_ms as f64).sum::<f64>() / successes.len() as f64
    };

    json!({
        "totalRequests": logs.len(),
        "successRate": if logs.is_empty() { 1.0 } else { successes.len() as f64 / logs.len() as f64 },
        "totalTokens": total_tokens,
        "totalCost": total_cost,
        "avgLatencyMs": avg_latency_ms,
        "byProvider": group_provider(logs),
        "byModel": group_model(logs),
    })
}

fn group_provider(logs: &[RequestLog]) -> Vec<Value> {
    let mut grouped: BTreeMap<String, Vec<&RequestLog>> = BTreeMap::new();
    for log in logs {
        grouped.entry(log.provider.clone()).or_default().push(log);
    }
    grouped
        .into_iter()
        .map(|(provider, logs)| {
            let successes = logs.iter().filter(|log| log.status.as_u64().is_some_and(|status| status < 400)).count();
            json!({
                "provider": provider,
                "requests": logs.len(),
                "successRate": if logs.is_empty() { 1.0 } else { successes as f64 / logs.len() as f64 },
                "avgLatencyMs": average(logs.iter().map(|log| log.latency_ms as f64)),
                "totalTokens": logs.iter().map(|log| log.total_tokens).sum::<u64>(),
                "costUsd": logs.iter().map(|log| log.cost_usd).sum::<f64>(),
            })
        })
        .collect()
}

fn group_model(logs: &[RequestLog]) -> Vec<Value> {
    let mut grouped: BTreeMap<String, Vec<&RequestLog>> = BTreeMap::new();
    for log in logs {
        grouped.entry(log.model.clone()).or_default().push(log);
    }
    grouped
        .into_iter()
        .map(|(model, logs)| {
            json!({
                "model": model,
                "requests": logs.len(),
                "totalTokens": logs.iter().map(|log| log.total_tokens).sum::<u64>(),
                "avgLatencyMs": average(logs.iter().map(|log| log.latency_ms as f64)),
                "costUsd": logs.iter().map(|log| log.cost_usd).sum::<f64>(),
            })
        })
        .collect()
}

fn average(values: impl Iterator<Item = f64>) -> f64 {
    let values: Vec<f64> = values.collect();
    if values.is_empty() {
        0.0
    } else {
        values.iter().sum::<f64>() / values.len() as f64
    }
}

async fn read_trace_events() -> Vec<Value> {
    let path = data_dir().join("gateway-trace.jsonl");
    let Ok(raw) = tokio::fs::read_to_string(path).await else {
        return vec![];
    };
    raw.lines()
        .rev()
        .take(200)
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .collect()
}

mod stream {
    use super::TokenUsage;

    pub fn empty_usage() -> TokenUsage {
        TokenUsage::default()
    }
}
