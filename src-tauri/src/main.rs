#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod hidden_command;
mod ipc;
mod process_mgr;
mod settings;

use std::collections::HashMap;
use std::sync::LazyLock;

const APP_NAME: &str = "LlamaCppHub";
const TRAY_ID: &str = "main-tray";

struct TrayText {
    show: &'static str,
    quit: &'static str,
    running_header: &'static str,
}

fn tray_text(language: &str) -> TrayText {
    match language {
        "zh" => TrayText {
            show: "显示主窗口",
            quit: "退出",
            running_header: "以下配置运行中：",
        },
        _ => TrayText {
            show: "Show",
            quit: "Quit",
            running_header: "Running configurations:",
        },
    }
}

fn build_tray_tooltip(language: &str, running_config_names: &[String]) -> String {
    if running_config_names.is_empty() {
        return APP_NAME.to_string();
    }

    let mut names = running_config_names.to_vec();
    names.sort();

    let mut lines = vec![
        APP_NAME.to_string(),
        tray_text(language).running_header.to_string(),
    ];
    lines.extend(names);
    lines.join("\n")
}

#[derive(Clone)]
struct RunningInstanceRecord {
    pid: u32,
    config_name: String,
}

static RUNNING_INSTANCES: LazyLock<std::sync::Mutex<HashMap<String, RunningInstanceRecord>>> =
    LazyLock::new(|| std::sync::Mutex::new(HashMap::new()));
#[derive(Clone)]
struct ActiveResourceMonitor {
    pid: u32,
    subscription_id: String,
}

static ACTIVE_RESOURCE_MONITORS: LazyLock<
    std::sync::Mutex<HashMap<String, ActiveResourceMonitor>>,
> = LazyLock::new(|| std::sync::Mutex::new(HashMap::new()));

#[cfg(test)]
mod tests {
    use super::*;

    static TEST_STATE_LOCK: LazyLock<std::sync::Mutex<()>> =
        LazyLock::new(|| std::sync::Mutex::new(()));

    fn reset_test_state() {
        RUNNING_INSTANCES.lock().unwrap().clear();
        ACTIVE_RESOURCE_MONITORS.lock().unwrap().clear();
    }

    #[test]
    fn tray_text_uses_chinese_labels() {
        let text = tray_text("zh");

        assert_eq!(text.show, "显示主窗口");
        assert_eq!(text.quit, "退出");
        assert_eq!(text.running_header, "以下配置运行中：");
    }

    #[test]
    fn tray_text_uses_english_labels() {
        let text = tray_text("en");

        assert_eq!(text.show, "Show");
        assert_eq!(text.quit, "Quit");
        assert_eq!(text.running_header, "Running configurations:");
    }

    #[test]
    fn tray_text_falls_back_to_english_for_unknown_language() {
        let text = tray_text("fr");

        assert_eq!(text.show, "Show");
        assert_eq!(text.quit, "Quit");
        assert_eq!(text.running_header, "Running configurations:");
    }

    #[test]
    fn tray_tooltip_only_shows_app_name_when_nothing_is_running() {
        let names: Vec<String> = Vec::new();

        assert_eq!(build_tray_tooltip("zh", &names), "LlamaCppHub");
    }

    #[test]
    fn tray_tooltip_lists_running_config_names_in_chinese() {
        let names = vec!["配置 B".to_string(), "配置 A".to_string()];

        assert_eq!(
            build_tray_tooltip("zh", &names),
            "LlamaCppHub\n以下配置运行中：\n配置 A\n配置 B"
        );
    }

    #[test]
    fn tray_tooltip_lists_running_config_names_in_english() {
        let names = vec!["Config B".to_string(), "Config A".to_string()];

        assert_eq!(
            build_tray_tooltip("en", &names),
            "LlamaCppHub\nRunning configurations:\nConfig A\nConfig B"
        );
    }

    #[test]
    fn active_resource_monitor_snapshot_only_includes_subscribed_running_instances() {
        let _guard = TEST_STATE_LOCK.lock().unwrap();
        reset_test_state();

        let monitored = "test-monitored-instance".to_string();
        let unmonitored = "test-unmonitored-instance".to_string();

        register_running_instance(monitored.clone(), 11, "Monitored".to_string());
        register_running_instance(unmonitored.clone(), 22, "Unmonitored".to_string());
        register_active_resource_monitor(monitored.clone(), 11, "subscription-a".to_string());

        assert_eq!(
            active_resource_monitor_snapshot(),
            vec![(monitored.clone(), 11)]
        );

        unregister_active_resource_monitor(&monitored, "subscription-a");
        assert!(active_resource_monitor_snapshot().is_empty());

        unregister_running_instance(&monitored);
        unregister_running_instance(&unmonitored);
    }

    #[test]
    fn stale_resource_monitor_stop_does_not_remove_newer_subscription() {
        let _guard = TEST_STATE_LOCK.lock().unwrap();
        reset_test_state();

        let instance_id = "test-resubscribed-instance".to_string();

        register_running_instance(instance_id.clone(), 33, "Resubscribed".to_string());
        register_active_resource_monitor(instance_id.clone(), 33, "old".to_string());
        register_active_resource_monitor(instance_id.clone(), 33, "new".to_string());
        unregister_active_resource_monitor(&instance_id, "old");

        assert_eq!(
            active_resource_monitor_snapshot(),
            vec![(instance_id.clone(), 33)]
        );

        unregister_active_resource_monitor(&instance_id, "new");
        unregister_running_instance(&instance_id);
    }

    #[test]
    fn unregister_running_instance_clears_active_resource_monitor() {
        let _guard = TEST_STATE_LOCK.lock().unwrap();
        reset_test_state();

        let instance_id = "test-exited-instance".to_string();

        register_running_instance(instance_id.clone(), 44, "Exited".to_string());
        register_active_resource_monitor(instance_id.clone(), 44, "subscription".to_string());
        unregister_running_instance(&instance_id);

        assert!(active_resource_monitor_snapshot().is_empty());
        assert!(!RUNNING_INSTANCES.lock().unwrap().contains_key(&instance_id));
    }

    #[test]
    fn running_config_name_snapshot_returns_sorted_names() {
        let _guard = TEST_STATE_LOCK.lock().unwrap();
        reset_test_state();

        let instance_a = "test-running-a".to_string();
        let instance_b = "test-running-b".to_string();

        register_running_instance(instance_a.clone(), 101, "Beta".to_string());
        register_running_instance(instance_b.clone(), 102, "Alpha".to_string());

        assert_eq!(
            running_config_name_snapshot(),
            vec!["Alpha".to_string(), "Beta".to_string()]
        );

        unregister_running_instance(&instance_a);
        unregister_running_instance(&instance_b);
    }

    #[test]
    fn stop_instance_by_pid_removes_running_config_name() {
        let _guard = TEST_STATE_LOCK.lock().unwrap();
        reset_test_state();

        let instance_id = "test-stop-by-pid".to_string();

        register_running_instance(instance_id.clone(), 103, "Stopped".to_string());
        unregister_running_instance_by_pid(103);

        assert!(!running_config_name_snapshot().contains(&"Stopped".to_string()));
        assert!(!RUNNING_INSTANCES.lock().unwrap().contains_key(&instance_id));
    }
}

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, TrayIconEvent};
use tauri::Manager;

use settings::LlamaConfig;

fn register_active_resource_monitor(instance_id: String, pid: u32, subscription_id: String) {
    ACTIVE_RESOURCE_MONITORS.lock().unwrap().insert(
        instance_id,
        ActiveResourceMonitor {
            pid,
            subscription_id,
        },
    );
}

fn unregister_active_resource_monitor(instance_id: &str, subscription_id: &str) {
    let mut active = ACTIVE_RESOURCE_MONITORS.lock().unwrap();
    if active
        .get(instance_id)
        .is_some_and(|monitor| monitor.subscription_id == subscription_id)
    {
        active.remove(instance_id);
    }
}

fn register_running_instance(instance_id: String, pid: u32, config_name: String) {
    RUNNING_INSTANCES
        .lock()
        .unwrap()
        .insert(instance_id, RunningInstanceRecord { pid, config_name });
}

fn unregister_running_instance(instance_id: &str) {
    RUNNING_INSTANCES.lock().unwrap().remove(instance_id);
    ACTIVE_RESOURCE_MONITORS.lock().unwrap().remove(instance_id);
}

fn unregister_running_instance_by_pid(pid: u32) {
    RUNNING_INSTANCES
        .lock()
        .unwrap()
        .retain(|_, running| running.pid != pid);
    ACTIVE_RESOURCE_MONITORS
        .lock()
        .unwrap()
        .retain(|_, monitor| monitor.pid != pid);
}

fn running_config_name_snapshot() -> Vec<String> {
    let mut names: Vec<String> = RUNNING_INSTANCES
        .lock()
        .unwrap()
        .values()
        .map(|running| running.config_name.clone())
        .collect();
    names.sort();
    names
}

fn create_tray_menu<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    language: &str,
) -> tauri::Result<Menu<R>> {
    let text = tray_text(language);
    let menu = Menu::new(app)?;
    let show_item = MenuItem::with_id(app, "show", text.show, true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", text.quit, true, None::<&str>)?;
    menu.append(&show_item)?;
    menu.append(&quit_item)?;
    Ok(menu)
}

fn refresh_tray(app: &tauri::AppHandle) {
    let language = settings::load_app_config().language;
    let tooltip = build_tray_tooltip(&language, &running_config_name_snapshot());

    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        eprintln!("[tray] Tray icon not found for refresh");
        return;
    };

    match create_tray_menu(app, &language) {
        Ok(menu) => {
            if let Err(error) = tray.set_menu(Some(menu)) {
                eprintln!("[tray] Failed to update menu: {}", error);
            }
        }
        Err(error) => eprintln!("[tray] Failed to build menu: {}", error),
    }

    if let Err(error) = tray.set_tooltip(Some(&tooltip)) {
        eprintln!("[tray] Failed to update tooltip: {}", error);
    }
}

fn active_resource_monitor_snapshot() -> Vec<(String, u32)> {
    let running = RUNNING_INSTANCES.lock().unwrap();
    let mut active: Vec<(String, u32)> = ACTIVE_RESOURCE_MONITORS
        .lock()
        .unwrap()
        .iter()
        .filter_map(|(instance_id, monitor)| {
            running
                .get(instance_id)
                .filter(|running| running.pid == monitor.pid)
                .map(|running| (instance_id.clone(), running.pid))
        })
        .collect();
    active.sort_by(|a, b| a.0.cmp(&b.0));
    active
}

fn is_main_window_visible(app: &tauri::AppHandle) -> bool {
    app.get_webview_window("main")
        .and_then(|window| {
            Some(window.is_visible().ok()? && !window.is_minimized().unwrap_or(false))
        })
        .unwrap_or(false)
}

#[cfg(windows)]
fn create_job_object() -> Result<isize, String> {
    use windows::Win32::System::JobObjects::{
        CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    let job_name: Vec<u16> = "llama-cpp-manager-llama-jobs\0".encode_utf16().collect();
    let job_handle = unsafe { CreateJobObjectW(None, windows_core::PCWSTR(job_name.as_ptr())) }
        .map_err(|e| format!("Failed to create job object: {}", e))?;

    let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
    info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    unsafe {
        SetInformationJobObject(
            job_handle,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const _,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
    }
    .map_err(|e| format!("Failed to set job object info: {}", e))?;

    Ok(job_handle.0 as isize)
}

// ── Config Management Commands ──

#[tauri::command]
async fn get_configs() -> Result<Vec<LlamaConfig>, String> {
    Ok(settings::load_configs())
}

#[tauri::command]
async fn save_config(config: LlamaConfig) -> Result<(), String> {
    let mut configs = settings::load_configs();
    if let Some(idx) = configs.iter().position(|c| c.id == config.id) {
        configs[idx] = config;
    } else {
        configs.push(config);
    }
    settings::save_configs(&configs)
}

#[tauri::command]
async fn delete_config(id: String) -> Result<(), String> {
    let mut configs = settings::load_configs();
    configs.retain(|c| c.id != id);
    settings::save_configs(&configs)
}

#[tauri::command]
async fn duplicate_config(id: String) -> Result<LlamaConfig, String> {
    let configs = settings::load_configs();
    let source = configs
        .iter()
        .find(|c| c.id == id)
        .ok_or("Config not found")?;

    let now = chrono::Utc::now().timestamp_millis() as u64;
    let new_config = LlamaConfig {
        id: uuid::Uuid::new_v4().to_string(),
        name: format!("{} (copy)", source.name),
        llama_cpp_path: source.llama_cpp_path.clone(),
        params: source.params.clone(),
        custom_args: source.custom_args.clone(),
        pre_start_command: source.pre_start_command.clone(),
        created_at: now,
        updated_at: now,
        is_favorite: false,
    };

    let mut configs = settings::load_configs();
    configs.push(new_config.clone());
    settings::save_configs(&configs)?;

    Ok(new_config)
}

// ── Instance Management Commands ──

#[tauri::command]
fn start_instance(
    config_id: String,
    instance_id: String,
    app: tauri::AppHandle,
) -> Result<process_mgr::InstanceInfo, String> {
    eprintln!("[START_INSTANCE] >>> config_id={}", config_id);

    // Quick sanity test: load configs and check
    let configs = settings::load_configs();
    eprintln!("[START_INSTANCE] >>> configs count={}", configs.len());
    let cfg = configs
        .iter()
        .find(|c| c.id == config_id)
        .ok_or("Config not found")?;
    eprintln!("[START_INSTANCE] >>> found config: {}", cfg.name);
    eprintln!(
        "[START_INSTANCE] >>> llama_path='{}', params keys={}",
        cfg.llama_cpp_path,
        cfg.params.as_object().map(|o| o.len()).unwrap_or(0)
    );

    let llama_path = if !cfg.llama_cpp_path.is_empty() {
        cfg.llama_cpp_path.clone()
    } else {
        let app_cfg = settings::load_app_config();
        app_cfg
            .llama_cpp_path
            .clone()
            .ok_or("llama.cpp path not set in settings")?
    };

    eprintln!(
        "[START_INSTANCE] >>> resolved path='{}', exists={}",
        llama_path,
        std::path::Path::new(&llama_path).exists()
    );

    if !std::path::Path::new(&llama_path).exists() {
        return Err(format!(
            "llama.cpp executable not found: {}\nPlease update the path in Settings.",
            llama_path
        ));
    }

    let job_handle_raw = process_mgr::get_job_handle();
    eprintln!("[START_INSTANCE] >>> calling spawn_llama_process...");
    let instance_info = process_mgr::spawn_llama_process(
        &llama_path,
        &cfg.params,
        &cfg.custom_args,
        &cfg.pre_start_command,
        &app,
        &instance_id,
        job_handle_raw,
    )?;

    register_running_instance(instance_id, instance_info.pid, cfg.name.clone());
    refresh_tray(&app);

    Ok(instance_info)
}

#[tauri::command]
fn stop_instance_cmd(pid: u32, app: tauri::AppHandle) -> Result<(), String> {
    process_mgr::stop_instance(pid)?;
    unregister_running_instance_by_pid(pid);
    refresh_tray(&app);

    Ok(())
}

// ── Resource Monitoring Commands ──

#[tauri::command]
fn get_process_resource_cmd(pid: u32) -> Result<ipc::ProcessResource, String> {
    ipc::get_process_resource(pid)
}

#[tauri::command]
fn start_instance_resource_monitor(
    instance_id: String,
    pid: u32,
    subscription_id: String,
) -> Result<(), String> {
    let is_running = RUNNING_INSTANCES
        .lock()
        .unwrap()
        .get(&instance_id)
        .is_some_and(|running| running.pid == pid);
    if !is_running {
        return Err(format!("Instance is not running: {}", instance_id));
    }

    register_active_resource_monitor(instance_id, pid, subscription_id);
    Ok(())
}

#[tauri::command]
fn stop_instance_resource_monitor(
    instance_id: String,
    subscription_id: String,
) -> Result<(), String> {
    unregister_active_resource_monitor(&instance_id, &subscription_id);
    Ok(())
}

#[tauri::command]
fn unregister_instance_cmd(instance_id: String, app: tauri::AppHandle) -> Result<(), String> {
    unregister_running_instance(&instance_id);
    refresh_tray(&app);
    Ok(())
}

#[tauri::command]
fn get_system_info_cmd() -> Result<ipc::SystemInfo, String> {
    ipc::get_system_info()
}

#[tauri::command]
fn detect_llama_cpp_paths_cmd() -> Result<Vec<String>, String> {
    Ok(ipc::detect_llama_cpp_paths())
}

// ── Path Management Commands ──

#[tauri::command]
fn get_llama_cpp_path() -> Result<Option<String>, String> {
    let app_cfg = settings::load_app_config();
    Ok(app_cfg.llama_cpp_path)
}

#[tauri::command]
fn set_llama_cpp_path(path: String) -> Result<(), String> {
    let mut app_cfg = settings::load_app_config();
    app_cfg.llama_cpp_path = if path.is_empty() { None } else { Some(path) };
    settings::save_app_config(&app_cfg)
}

#[tauri::command]
fn select_file() -> Result<String, String> {
    let script = r#"
Add-Type -AssemblyName System.Windows.Forms
$dlg = New-Object System.Windows.Forms.OpenFileDialog
$dlg.Filter = "All Files (*.*)|*.*|Executable (*.exe;*.dll)|*.exe;*.dll"
$dlg.FilterIndex = 1
$dlg.ShowDialog() | Out-Null
if ($dlg.FileName -ne '') {
    Write-Output $dlg.FileName
}
"#;
    let output = hidden_command::hidden_command("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()
        .map_err(|e| format!("Failed to run dialog: {}", e))?;
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() {
        Err("User cancelled".to_string())
    } else {
        Ok(path)
    }
}

// ── App Settings Commands ──

#[tauri::command]
fn get_language() -> Result<String, String> {
    let app_cfg = settings::load_app_config();
    Ok(app_cfg.language)
}

#[tauri::command]
fn set_language(lang: String, app: tauri::AppHandle) -> Result<(), String> {
    let mut app_cfg = settings::load_app_config();
    app_cfg.language = lang;
    settings::save_app_config(&app_cfg)?;
    refresh_tray(&app);
    Ok(())
}

#[tauri::command]
fn get_theme() -> Result<String, String> {
    let app_cfg = settings::load_app_config();
    Ok(app_cfg.theme)
}

#[tauri::command]
fn set_theme(theme: String) -> Result<(), String> {
    let mut app_cfg = settings::load_app_config();
    app_cfg.theme = theme;
    settings::save_app_config(&app_cfg)
}

#[tauri::command]
fn save_all_settings(
    llama_cpp_path: String,
    language: String,
    theme: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let mut app_cfg = settings::load_app_config();
    app_cfg.llama_cpp_path = if llama_cpp_path.is_empty() {
        None
    } else {
        Some(llama_cpp_path)
    };
    app_cfg.language = language;
    app_cfg.theme = theme;
    settings::save_app_config(&app_cfg)?;
    refresh_tray(&app);
    Ok(())
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    process_mgr::shutdown_all_instances();
    RUNNING_INSTANCES.lock().unwrap().clear();
    ACTIVE_RESOURCE_MONITORS.lock().unwrap().clear();
    refresh_tray(&app);
    app.exit(0);
}

fn main() {
    if let Err(e) = settings::migrate_legacy_config() {
        eprintln!("[main] WARNING: Failed to migrate legacy config: {}", e);
    }
    settings::ensure_config_dir().ok();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_configs,
            save_config,
            delete_config,
            duplicate_config,
            start_instance,
            stop_instance_cmd,
            get_process_resource_cmd,
            start_instance_resource_monitor,
            stop_instance_resource_monitor,
            unregister_instance_cmd,
            get_system_info_cmd,
            detect_llama_cpp_paths_cmd,
            get_llama_cpp_path,
            set_llama_cpp_path,
            select_file,
            get_language,
            set_language,
            get_theme,
            set_theme,
            save_all_settings,
            quit_app,
        ])
        .setup(|app| {
            // Set window icon
            let icon_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("icons")
                .join("icon.png");
            if icon_path.exists() {
                if let Ok(icon) = tauri::image::Image::from_path(&icon_path) {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.set_icon(icon);
                        #[cfg(debug_assertions)]
                        eprintln!("[main] Window icon set from {}", icon_path.display());
                    } else {
                        eprintln!("[main] WARNING: Window 'main' not found for icon setting");
                    }
                } else {
                    eprintln!("[main] WARNING: Failed to load icon image from {}", icon_path.display());
                }
            } else {
                eprintln!("[main] WARNING: Icon file not found: {}", icon_path.display());
            }

            // Create Job Object for llama.cpp process management.
            #[cfg(windows)]
            {
                match create_job_object() {
                    Ok(handle) => {
                        process_mgr::register_job_handle(handle);
                    }
                    Err(e) => {
                        eprintln!("[main] WARNING: Failed to create Job Object: {}. llama.cpp processes will not auto-clean on app exit.", e);
                    }
                }
            }

            let app_handle = app.handle().clone();

            let language = settings::load_app_config().language;
            let tooltip = build_tray_tooltip(&language, &running_config_name_snapshot());

            match create_tray_menu(&app.handle().clone(), &language) {
                Ok(menu) => {
                    let tray_builder = {
                        let mut b = tauri::tray::TrayIconBuilder::with_id(TRAY_ID);

                        let tray_icon_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                            .join("icons")
                            .join("icon.png");
                        if tray_icon_path.exists() {
                            if let Ok(image) = tauri::image::Image::from_path(&tray_icon_path) {
                                b = b.icon(image);
                            }
                        }

                        b.menu(&menu)
                            .tooltip(&tooltip)
                            .show_menu_on_left_click(false)
                            .on_menu_event({
                                let ah = app_handle.clone();
                                move |_app, event| {
                                    if event.id == "show" {
                                        if let Some(window) = ah.webview_windows().get("main") {
                                            if window.is_minimized().unwrap_or(false) {
                                                let _ = window.unminimize();
                                            }
                                            let _ = window.show();
                                            let _ = window.set_focus();
                                        }
                                    } else if event.id == "quit" {
                                        process_mgr::shutdown_all_instances();
                                        RUNNING_INSTANCES.lock().unwrap().clear();
                                        ACTIVE_RESOURCE_MONITORS.lock().unwrap().clear();
                                        refresh_tray(&ah);
                                        ah.exit(0);
                                    }
                                }
                            })
                            .on_tray_icon_event({
                                let ah = app_handle.clone();
                                move |_tray, event| {
                                    if let TrayIconEvent::Click { button, button_state: tauri::tray::MouseButtonState::Up, .. } = event {
                                        if button == MouseButton::Left {
                                            let ah = ah.clone();
                                            tauri::async_runtime::spawn(async move {
                                                if let Some(window) = ah.webview_windows().get("main") {
                                                    if window.is_minimized().unwrap_or(false) {
                                                        let _ = window.unminimize();
                                                    }
                                                    let _ = window.show();
                                                    let _ = window.set_focus();
                                                }
                                            });
                                        }
                                    }
                                }
                            })
                    };

                    if let Err(error) = tray_builder.build(app) {
                        eprintln!("[tray] Failed to build tray icon: {}", error);
                    }
                }
                Err(error) => eprintln!("[tray] Failed to build initial menu: {}", error),
            }

            let system_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                use std::time::Duration;
                let mut interval = tokio::time::interval(Duration::from_secs(1));
                loop {
                    interval.tick().await;
                    if !is_main_window_visible(&system_app) {
                        continue;
                    }

                    let refresh_app = system_app.clone();
                    match tauri::async_runtime::spawn_blocking(move || {
                        ipc::refresh_and_emit_system_info(&refresh_app)
                    }).await {
                        Ok(Ok(())) => {}
                        Ok(Err(e)) => eprintln!("[system] refresh failed: {}", e),
                        Err(e) => eprintln!("[system] refresh task failed: {}", e),
                    }
                }
            });

            // Start background resource monitoring timer.
            let resource_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                use std::time::Duration;
                let mut interval = tokio::time::interval(Duration::from_secs(2));
                loop {
                    interval.tick().await;
                    if !is_main_window_visible(&resource_app) {
                        continue;
                    }

                    let instances = active_resource_monitor_snapshot();
                    if instances.is_empty() {
                        continue;
                    }
                    if let Err(e) = ipc::refresh_and_emit_resources(instances, &resource_app) {
                        eprintln!("[resource] refresh failed: {}", e);
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    if let Err(e) = window.hide() {
                        eprintln!("[main] Failed to hide main window: {}", e);
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
