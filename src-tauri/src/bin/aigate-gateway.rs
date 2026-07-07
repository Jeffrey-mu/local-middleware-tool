#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[path = "../gateway/mod.rs"]
mod gateway;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    gateway::http::run().await
}
