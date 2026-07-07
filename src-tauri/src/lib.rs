#[cfg(not(debug_assertions))]
use std::fs::OpenOptions;
#[cfg(not(debug_assertions))]
use std::path::PathBuf;
#[cfg(not(debug_assertions))]
use std::process::{Child, Command, Stdio};
#[cfg(not(debug_assertions))]
use std::sync::Mutex;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[cfg(not(debug_assertions))]
struct GatewayProcess(Mutex<Child>);

#[cfg(not(debug_assertions))]
impl Drop for GatewayProcess {
    fn drop(&mut self) {
        if let Ok(mut child) = self.0.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[cfg(not(debug_assertions))]
impl GatewayProcess {
    fn shutdown(&self) {
        if let Ok(mut child) = self.0.lock() {
            match child.try_wait() {
                Ok(Some(_)) => {}
                Ok(None) => {
                    let _ = child.kill();
                    let _ = child.wait();
                }
                Err(_) => {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if let Err(error) = start_gateway_sidecar(app.handle()) {
                eprintln!("failed to start gateway sidecar: {error}");
            }
            ensure_main_window(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                shutdown_gateway_sidecar(window.app_handle());
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building CCSwitch")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit) {
                shutdown_gateway_sidecar(app);
            }
        });
}

fn shutdown_gateway_sidecar(app: &tauri::AppHandle) {
    #[cfg(not(debug_assertions))]
    {
        if let Some(process) = app.try_state::<GatewayProcess>() {
            process.shutdown();
        }
    }

    #[cfg(debug_assertions)]
    {
        let _ = app;
    }
}

fn start_gateway_sidecar(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(debug_assertions)]
    {
        let _ = app;
        return Ok(());
    }

    #[cfg(not(debug_assertions))]
    {
        let data_dir = app.path().app_data_dir()?;
        std::fs::create_dir_all(&data_dir)?;
        let gateway = find_gateway_binary(app).ok_or("ccswitch-gateway sidecar not found")?;
        let log_path = data_dir.join("gateway-sidecar.log");
        let stdout = OpenOptions::new().create(true).append(true).open(&log_path)?;
        let stderr = OpenOptions::new().create(true).append(true).open(&log_path)?;

        let child = Command::new(gateway)
            .env("CCSWITCH_DATA_DIR", data_dir)
            .env("NO_PROXY", "127.0.0.1,localhost,::1,0.0.0.0,*.local,<local>")
            .env("no_proxy", "127.0.0.1,localhost,::1,0.0.0.0,*.local,<local>")
            .stdin(Stdio::null())
            .stdout(Stdio::from(stdout))
            .stderr(Stdio::from(stderr))
            .spawn()?;

        app.manage(GatewayProcess(Mutex::new(child)));
        Ok(())
    }
}

#[cfg(not(debug_assertions))]
fn find_gateway_binary(app: &tauri::AppHandle) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    let sidecar_names = gateway_sidecar_names();

    if let Ok(resource_dir) = app.path().resource_dir() {
        for name in sidecar_names {
            candidates.push(resource_dir.join(name));
            candidates.push(resource_dir.join("_up_/binaries").join(name));
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for name in sidecar_names {
                candidates.push(dir.join(name));
            }
        }
    }

    candidates.into_iter().find(|candidate| candidate.is_file())
}

#[cfg(not(debug_assertions))]
fn gateway_sidecar_names() -> &'static [&'static str] {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        &[
            "ccswitch-gateway-aarch64-apple-darwin",
            "ccswitch-gateway",
        ]
    }

    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        &[
            "ccswitch-gateway-x86_64-apple-darwin",
            "ccswitch-gateway",
        ]
    }

    #[cfg(all(target_os = "windows", target_arch = "x86_64", target_env = "msvc"))]
    {
        &[
            "ccswitch-gateway-x86_64-pc-windows-msvc.exe",
            "ccswitch-gateway.exe",
        ]
    }

    #[cfg(all(target_os = "windows", target_arch = "aarch64", target_env = "msvc"))]
    {
        &[
            "ccswitch-gateway-aarch64-pc-windows-msvc.exe",
            "ccswitch-gateway.exe",
        ]
    }

    #[cfg(all(target_os = "windows", target_arch = "x86_64", target_env = "gnu"))]
    {
        &[
            "ccswitch-gateway-x86_64-pc-windows-gnu.exe",
            "ccswitch-gateway.exe",
        ]
    }

    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        &[
            "ccswitch-gateway-x86_64-unknown-linux-gnu",
            "ccswitch-gateway",
        ]
    }

    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    {
        &[
            "ccswitch-gateway-aarch64-unknown-linux-gnu",
            "ccswitch-gateway",
        ]
    }
}

fn ensure_main_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    if app.get_webview_window("main").is_some() {
        return Ok(());
    }

    WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("CCSwitch")
        .inner_size(1280.0, 820.0)
        .min_inner_size(1040.0, 680.0)
        .center()
        .resizable(true)
        .fullscreen(false)
        .build()?;

    Ok(())
}
