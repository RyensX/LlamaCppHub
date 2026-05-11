use crate::hidden_command::hidden_command;
use crate::settings::{CustomArg, PreStartCommand};
use std::io::BufRead;
use std::process::{Command, Stdio};
use std::sync::{LazyLock, Mutex};
use tauri::Emitter;

static LLAMA_JOB_HANDLE: LazyLock<Mutex<Option<isize>>> = LazyLock::new(|| Mutex::new(None));

pub fn register_job_handle(handle: isize) {
    if let Ok(mut job_handle) = LLAMA_JOB_HANDLE.lock() {
        *job_handle = Some(handle);
    }
}

pub fn get_job_handle() -> Option<isize> {
    LLAMA_JOB_HANDLE.lock().ok().and_then(|handle| *handle)
}

pub fn shutdown_all_instances() {
    if let Some(job_handle_raw) = LLAMA_JOB_HANDLE
        .lock()
        .ok()
        .and_then(|mut handle| handle.take())
    {
        #[cfg(windows)]
        unsafe {
            use windows::Win32::Foundation::{CloseHandle, HANDLE};
            let handle = HANDLE(job_handle_raw as *mut std::ffi::c_void);
            let _ = CloseHandle(handle);
        }
    }
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceInfo {
    pub pid: u32,
    pub command: String,
}

/// Extract enabled parameters from a params object.
/// Returns pairs of (flag, value) where value is the string to pass as arg.
pub fn extract_enabled_params(params: &serde_json::Value) -> Vec<(String, Option<String>)> {
    let mut result = Vec::new();
    if let Some(params_obj) = params.as_object() {
        for (flag, param) in params_obj {
            if flag == "cors" || flag == "max_batch" {
                continue;
            }
            if let Some(enabled) = param.get("enabled").and_then(|e| e.as_bool()) {
                if !enabled {
                    continue;
                }
                let value =
                    param
                        .get("value")
                        .and_then(|v| v.as_str())
                        .map(|v| match (flag.as_str(), v) {
                            ("flash_attn", "true") => "on".to_string(),
                            ("flash_attn", "false") => "off".to_string(),
                            _ => v.to_string(),
                        });
                if let Some(ref v) = value {
                    if v.is_empty() {
                        continue;
                    }
                }
                result.push((flag.clone(), value));
            }
        }
    }
    result
}

pub fn parse_custom_args(input: &str) -> Result<Vec<String>, String> {
    let mut args = Vec::new();
    let mut current = String::new();
    let mut chars = input.chars().peekable();
    let mut quote: Option<char> = None;

    while let Some(ch) = chars.next() {
        if let Some(active_quote) = quote {
            if ch == active_quote {
                quote = None;
            } else if ch == '\\' {
                match chars.peek().copied() {
                    Some(next) if next == active_quote => {
                        let mut lookahead = chars.clone();
                        lookahead.next();
                        if lookahead.peek().is_none_or(|after| after.is_whitespace()) {
                            current.push(ch);
                            chars.next();
                            quote = None;
                        } else {
                            current.push(chars.next().unwrap());
                        }
                    }
                    Some(next) if next.is_whitespace() => {
                        current.push(chars.next().unwrap());
                    }
                    _ => current.push(ch),
                }
            } else {
                current.push(ch);
            }
            continue;
        }

        match ch {
            '\'' | '"' => quote = Some(ch),
            '\\' => match chars.peek().copied() {
                Some(next) if next.is_whitespace() || next == '\'' || next == '"' => {
                    current.push(chars.next().unwrap());
                }
                _ => current.push(ch),
            },
            ch if ch.is_whitespace() => {
                if !current.is_empty() {
                    args.push(std::mem::take(&mut current));
                }
                while chars.peek().is_some_and(|next| next.is_whitespace()) {
                    chars.next();
                }
            }
            _ => current.push(ch),
        }
    }

    if let Some(active_quote) = quote {
        return Err(format!(
            "Unclosed quote in custom arguments: {}",
            active_quote
        ));
    }

    if !current.is_empty() {
        args.push(current);
    }

    Ok(args)
}

pub fn extract_enabled_custom_args(custom_args: &[CustomArg]) -> Result<Vec<String>, String> {
    let mut result = Vec::new();
    for custom_arg in custom_args {
        let text = custom_arg.text.trim();
        if !custom_arg.enabled || text.is_empty() {
            continue;
        }
        result.extend(parse_custom_args(text)?);
    }
    Ok(result)
}

/// Map from parameter key (stored in config) to the actual CLI flag string.
static KEY_TO_FLAG: LazyLock<std::collections::HashMap<&'static str, &'static str>> =
    LazyLock::new(|| {
        [
            // Model
            ("model", "-m"),
            ("threads", "-t"),
            ("threads_batch", "-tb"),
            ("gpu_layers", "-ngl"),
            ("split_mode", "-sm"),
            ("tensor_split", "-ts"),
            ("main_gpu", "-mg"),
            ("fit", "--fit"),
            ("fit_target", "--fit-target"),
            ("fit_ctx", "--fit-ctx"),
            ("rope_scaling", "--rope-scaling"),
            ("rope_freq_base", "--rope-freq-base"),
            ("rope_freq_scale", "--rope-freq-scale"),
            ("vocab_only", "--vocab-only"),
            ("use_mmap", "--mmap"),
            ("use_mlock", "--mlock"),
            ("no_mmap", "--no-mmap"),
            ("check_tensors", "--check-tensors"),
            ("override_kv", "--override-kv"),
            ("op_offload", "--op-offload"),
            ("no_op_offload", "--no-op-offload"),
            ("lora", "--lora"),
            ("lora_scaled", "--lora-scaled"),
            // Context
            ("ctx_size", "-c"),
            ("batch_size", "--batch-size"),
            ("ubatch_size", "--ubatch-size"),
            ("repetition_penalty", "--repeat-penalty"),
            ("frequency_penalty", "--frequency-penalty"),
            ("presence_penalty", "--presence-penalty"),
            ("dry_multiplier", "--dry-multiplier"),
            ("dry_base", "--dry-base"),
            ("dry_allowed_length", "--dry-allowed-length"),
            ("dry_penalty_last_n", "--dry-penalty-last-n"),
            ("cache_type_k", "--cache-type-k"),
            ("cache_type_v", "--cache-type-v"),
            // Server
            ("host", "--host"),
            ("port", "--port"),
            ("embedding", "--embedding"),
            ("log_disable", "--log-disable"),
            ("log_prefix", "--log-prefix"),
            ("cslots", "--chunk-size"),
            // Advanced
            ("flash_attn", "-fa"),
            ("low_vram", "--low-vram"),
            ("no_kv_offload", "--no-kv-offload"),
            ("batch_break", "--batch-break"),
            ("logit_bias", "--logit-bias"),
            ("ignore_eos", "--ignore-eos"),
            ("speculative", "--speculative"),
            ("jinja", "--jinja"),
            ("chat_template_file", "--chat-template-file"),
            ("numa", "--numa"),
            ("mirostat", "--mirostat"),
            ("mirostat_lr", "--mirostat-lr"),
            ("mirostat_ent", "--mirostat-ent"),
            ("mirostat_tau", "--mirostat-tau"),
            ("seed", "--seed"),
            ("skip_predict_special", "--skip-predict-special"),
            ("tokens_add_special", "--tokens-add-special"),
            ("tokens_add_user", "--tokens-add-user"),
            ("tokens_add_assistant", "--tokens-add-assistant"),
            ("maas_mode", "--maas-mode"),
        ]
        .into_iter()
        .collect()
    });

static FLAG_ONLY_KEYS: LazyLock<std::collections::HashSet<&'static str>> = LazyLock::new(|| {
    [
        "vocab_only",
        "use_mmap",
        "use_mlock",
        "no_mmap",
        "check_tensors",
        "op_offload",
        "no_op_offload",
        "embedding",
        "log_disable",
        "low_vram",
        "no_kv_offload",
        "batch_break",
        "ignore_eos",
        "jinja",
        "numa",
        "skip_predict_special",
        "maas_mode",
    ]
    .into_iter()
    .collect()
});

fn quote_command_arg(arg: &str) -> String {
    if !arg.is_empty() && !arg.chars().any(|ch| ch.is_whitespace() || ch == '"') {
        return arg.to_string();
    }

    let mut quoted = String::with_capacity(arg.len() + 2);
    quoted.push('"');
    for ch in arg.chars() {
        if ch == '"' {
            quoted.push('\\');
        }
        quoted.push(ch);
    }
    quoted.push('"');
    quoted
}

fn build_command_with_custom_argv(
    llama_cpp_path: &str,
    params: &serde_json::Value,
    custom_argv: &[String],
) -> String {
    let mut full_cmd = String::new();
    for (key, value) in extract_enabled_params(params) {
        let flag: String = KEY_TO_FLAG
            .get(key.as_str())
            .map(|&f| f.to_string())
            .unwrap_or_else(|| format!("--{}", key));
        full_cmd.push_str(&quote_command_arg(&flag));
        if !FLAG_ONLY_KEYS.contains(key.as_str()) {
            if let Some(ref v) = value {
                if !v.is_empty() {
                    full_cmd.push(' ');
                    full_cmd.push_str(&quote_command_arg(v));
                }
            }
        }
        full_cmd.push(' ');
    }

    for arg in custom_argv {
        full_cmd.push_str(&quote_command_arg(arg));
        full_cmd.push(' ');
    }

    format!("{} {}", quote_command_arg(llama_cpp_path), full_cmd.trim())
        .trim()
        .to_string()
}

/// Build the command string from config params
pub fn build_command(
    llama_cpp_path: &str,
    params: &serde_json::Value,
    custom_args: &[CustomArg],
) -> Result<String, String> {
    let custom_argv = extract_enabled_custom_args(custom_args)?;
    Ok(build_command_with_custom_argv(
        llama_cpp_path,
        params,
        &custom_argv,
    ))
}

/// Assign a process by PID to the Job Object.
/// This is MANDATORY — without it, the process won't be cleaned up on app exit.
#[cfg(windows)]
fn assign_to_job(pid: u32, job_handle: isize) -> Result<(), String> {
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::System::JobObjects::AssignProcessToJobObject;
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};

    for attempt in 0..5 {
        let proc_h = match unsafe { OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid) }
        {
            Ok(h) if !h.is_invalid() => h,
            Ok(_) | Err(_) => {
                if attempt < 4 {
                    std::thread::sleep(std::time::Duration::from_millis(10));
                    continue;
                }
                return Err(format!("OpenProcess failed (pid={})", pid));
            }
        };

        let job_h = HANDLE(job_handle as *mut std::ffi::c_void);
        let assigned = unsafe { AssignProcessToJobObject(job_h, proc_h) }.is_ok();
        unsafe {
            let _ = CloseHandle(proc_h);
        }
        if assigned {
            return Ok(());
        }

        if attempt < 4 {
            std::thread::sleep(std::time::Duration::from_millis(10));
            continue;
        }
    }
    Err(format!(
        "AssignProcessToJobObject failed after 5 retries (pid={})",
        pid
    ))
}

fn emit_instance_log(
    app: &tauri::AppHandle,
    instance_id: &str,
    line: impl Into<String>,
    log_type: &str,
) {
    let _ = app.emit(
        &format!("instance:{}:log", instance_id),
        serde_json::json!({ "line": line.into(), "type": log_type }),
    );
}

fn shell_command(command: &str) -> Command {
    #[cfg(windows)]
    {
        let mut cmd = hidden_command("cmd");
        cmd.arg("/C").arg(command);
        cmd
    }

    #[cfg(not(windows))]
    {
        let mut cmd = Command::new("sh");
        cmd.arg("-c").arg(command);
        cmd
    }
}

fn spawn_pre_start_log_reader<R>(
    app: tauri::AppHandle,
    instance_id: String,
    reader: R,
    log_type: &'static str,
) -> std::thread::JoinHandle<()>
where
    R: std::io::Read + Send + 'static,
{
    std::thread::spawn(move || {
        let reader = std::io::BufReader::new(reader);
        for line in reader.lines() {
            let Ok(line) = line else {
                break;
            };
            emit_instance_log(
                &app,
                &instance_id,
                format!("[pre-start] {}", line),
                log_type,
            );
        }
    })
}

fn pre_start_failure_message(status: &std::process::ExitStatus) -> String {
    let code = status.code().map_or_else(
        || "terminated by signal".to_string(),
        |code| code.to_string(),
    );
    format!("Pre-start command failed with exit code {}", code)
}

fn run_pre_start_command_line(
    command: &str,
    app: &tauri::AppHandle,
    instance_id: &str,
) -> Result<(), String> {
    emit_instance_log(
        app,
        instance_id,
        format!("[pre-start] running: {}", command),
        "stdout",
    );

    let mut child = shell_command(command)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to run pre-start command: {}", e))?;

    let mut log_threads = Vec::new();
    if let Some(stdout) = child.stdout.take() {
        log_threads.push(spawn_pre_start_log_reader(
            app.clone(),
            instance_id.to_string(),
            stdout,
            "stdout",
        ));
    }
    if let Some(stderr) = child.stderr.take() {
        log_threads.push(spawn_pre_start_log_reader(
            app.clone(),
            instance_id.to_string(),
            stderr,
            "stderr",
        ));
    }

    let status = child
        .wait()
        .map_err(|e| format!("Failed to run pre-start command: {}", e))?;
    for log_thread in log_threads {
        let _ = log_thread.join();
    }

    if status.success() {
        emit_instance_log(app, instance_id, "[pre-start] completed", "stdout");
        return Ok(());
    }

    let message = pre_start_failure_message(&status);
    emit_instance_log(
        app,
        instance_id,
        format!("[pre-start] {}", message),
        "stderr",
    );
    Err(message)
}

fn run_pre_start_command(
    pre_start_command: &PreStartCommand,
    app: &tauri::AppHandle,
    instance_id: &str,
) -> Result<(), String> {
    if !pre_start_command.enabled {
        return Ok(());
    }

    for command in pre_start_command
        .command
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        if let Err(message) = run_pre_start_command_line(command, app, instance_id) {
            if !pre_start_command.continue_on_failure {
                return Err(message);
            }

            emit_instance_log(
                app,
                instance_id,
                "[pre-start] continuing because continueOnFailure is enabled",
                "stderr",
            );
        }
    }

    Ok(())
}

/// Spawn a llama.cpp process and return its PID.
/// This is a pure sync function — no async, no spawn_blocking, no tokio.
/// Log streaming is done in std::threads that call app.emit() directly.
pub fn spawn_llama_process(
    llama_cpp_path: &str,
    params: &serde_json::Value,
    custom_args: &[CustomArg],
    pre_start_command: &PreStartCommand,
    app: &tauri::AppHandle,
    instance_id: &str,
    job_handle_raw: Option<isize>,
) -> Result<InstanceInfo, String> {
    eprintln!(
        "[spawn_llama] >>> START path={} params_keys={}",
        llama_cpp_path,
        params.as_object().map(|o| o.keys().count()).unwrap_or(0)
    );
    let custom_argv = extract_enabled_custom_args(custom_args)?;
    let command_str = build_command_with_custom_argv(llama_cpp_path, params, &custom_argv);
    eprintln!("[spawn_llama] >>> command built: {}", command_str);
    run_pre_start_command(pre_start_command, app, instance_id)?;
    eprintln!("[spawn_llama] >>> spawning...");

    let mut cmd = hidden_command(llama_cpp_path);

    for (key, value) in extract_enabled_params(params) {
        let flag = KEY_TO_FLAG
            .get(key.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("--{}", key));
        cmd.arg(&flag);
        if !FLAG_ONLY_KEYS.contains(key.as_str()) {
            if let Some(ref v) = value {
                if !v.is_empty() {
                    cmd.arg(v);
                }
            }
        }
    }

    for arg in custom_argv {
        cmd.arg(arg);
    }

    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| {
        format!(
            "Failed to start llama.cpp (path='{}'): {}",
            llama_cpp_path, e
        )
    })?;
    let pid = child.id();

    #[cfg(windows)]
    {
        let jh = job_handle_raw.ok_or_else(|| {
            "Job Object is not available; refusing to start detached llama.cpp process".to_string()
        })?;
        if let Err(e) = assign_to_job(pid, jh) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!(
                "Failed to attach llama.cpp process to app lifecycle: {}",
                e
            ));
        }
    }

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    let inst_id = instance_id.to_string();
    let app_stdout = app.clone();

    // Stream stdout in background thread
    let stdout_thread = std::thread::spawn(move || {
        let reader = std::io::BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(line) => {
                    let _ = app_stdout.emit(
                        &format!("instance:{}:log", inst_id),
                        serde_json::json!({ "line": line, "type": "stdout" }),
                    );
                }
                Err(_) => break,
            }
        }
    });

    // Stream stderr in background thread
    let inst_stderr = instance_id.to_string();
    let app_stderr = app.clone();
    let stderr_thread = std::thread::spawn(move || {
        let reader = std::io::BufReader::new(stderr);
        for line in reader.lines() {
            match line {
                Ok(line) => {
                    let _ = app_stderr.emit(
                        &format!("instance:{}:log", inst_stderr),
                        serde_json::json!({ "line": line, "type": "stderr" }),
                    );
                }
                Err(_) => break,
            }
        }
    });

    let app_exit = app.clone();
    let inst_exit = instance_id.to_string();
    std::thread::spawn(move || {
        let code = child
            .wait()
            .ok()
            .and_then(|status| status.code())
            .unwrap_or(-1);
        let _ = stdout_thread.join();
        let _ = stderr_thread.join();
        let _ = app_exit.emit(
            &format!("instance:{}:exited", inst_exit),
            serde_json::json!({ "code": code }),
        );
    });

    Ok(InstanceInfo {
        pid,
        command: command_str,
    })
}

/// Stop a single process by PID.
/// Child processes are automatically killed by the Job Object.
pub fn stop_instance(pid: u32) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows::Win32::System::Threading::{
            OpenProcess, TerminateProcess, PROCESS_QUERY_INFORMATION, PROCESS_TERMINATE,
        };
        let handle =
            match unsafe { OpenProcess(PROCESS_TERMINATE | PROCESS_QUERY_INFORMATION, false, pid) }
            {
                Ok(h) if !h.is_invalid() => h,
                _ => return Ok(()), // Process already gone
            };
        let _ = unsafe { TerminateProcess(handle, 1) };
    }

    #[cfg(not(windows))]
    {
        let _ = Command::new("kill").arg("-9").arg(pid.to_string()).output();
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        build_command, extract_enabled_custom_args, parse_custom_args, pre_start_failure_message,
        shell_command,
    };
    use crate::settings::CustomArg;
    use serde_json::json;
    use std::ffi::OsStr;

    fn has_adjacent_args(command: &str, flag: &str, value: &str) -> bool {
        command
            .split_whitespace()
            .collect::<Vec<_>>()
            .windows(2)
            .any(|window| window == [flag, value])
    }

    #[test]
    fn build_command_renders_fit_family() {
        let params = json!({
            "fit": { "enabled": true, "value": "on" },
            "fit_target": { "enabled": true, "value": "2048" },
            "fit_ctx": { "enabled": true, "value": "8192" }
        });

        let command = build_command("llama-server", &params, &[]).unwrap();

        assert!(has_adjacent_args(&command, "--fit", "on"));
        assert!(has_adjacent_args(&command, "--fit-target", "2048"));
        assert!(has_adjacent_args(&command, "--fit-ctx", "8192"));
    }

    #[test]
    fn build_command_renders_jinja_without_value() {
        let params = json!({
            "jinja": { "enabled": true, "value": "true" }
        });

        let command = build_command("llama-server", &params, &[]).unwrap();

        assert!(command.split_whitespace().any(|part| part == "--jinja"));
        assert!(!has_adjacent_args(&command, "--jinja", "true"));
    }

    #[test]
    fn build_command_renders_chat_template_file_with_path() {
        let params = json!({
            "chat_template_file": { "enabled": true, "value": "C:\\templates\\chat_template.jinja" }
        });

        let command = build_command("llama-server", &params, &[]).unwrap();

        assert!(has_adjacent_args(
            &command,
            "--chat-template-file",
            "C:\\templates\\chat_template.jinja"
        ));
    }

    #[test]
    fn build_command_renders_flag_only_params_without_values() {
        let params = json!({
            "check_tensors": { "enabled": true, "value": "true" },
            "op_offload": { "enabled": true, "value": "true" },
            "no_op_offload": { "enabled": true, "value": "true" }
        });

        let command = build_command("llama-server", &params, &[]).unwrap();

        assert!(command
            .split_whitespace()
            .any(|arg| arg == "--check-tensors"));
        assert!(command.split_whitespace().any(|arg| arg == "--op-offload"));
        assert!(command
            .split_whitespace()
            .any(|arg| arg == "--no-op-offload"));
        assert!(!command.split_whitespace().any(|arg| arg == "true"));
    }

    #[test]
    fn build_command_converts_flash_attn_bool_values() {
        let enabled_params = json!({
            "flash_attn": { "enabled": true, "value": "true" }
        });
        let disabled_params = json!({
            "flash_attn": { "enabled": true, "value": "false" }
        });

        let enabled_command = build_command("llama-server", &enabled_params, &[]).unwrap();
        let disabled_command = build_command("llama-server", &disabled_params, &[]).unwrap();

        assert!(has_adjacent_args(&enabled_command, "-fa", "on"));
        assert!(has_adjacent_args(&disabled_command, "-fa", "off"));
    }

    #[test]
    fn build_command_renders_current_batch_flags() {
        let params = json!({
            "batch_size": { "enabled": true, "value": "2048" },
            "ubatch_size": { "enabled": true, "value": "512" }
        });

        let command = build_command("llama-server", &params, &[]).unwrap();

        assert!(has_adjacent_args(&command, "--batch-size", "2048"));
        assert!(has_adjacent_args(&command, "--ubatch-size", "512"));
        assert!(!command.split_whitespace().any(|arg| arg == "--batch"));
        assert!(!command.split_whitespace().any(|arg| arg == "--ubatch"));
    }

    #[test]
    fn build_command_skips_removed_max_batch_param() {
        let params = json!({
            "max_batch": { "enabled": true, "value": "4096" }
        });

        let command = build_command("llama-server", &params, &[]).unwrap();

        assert_eq!(command, "llama-server");
    }

    #[test]
    fn parse_custom_args_splits_plain_args() {
        assert_eq!(
            parse_custom_args("--foo bar --baz").unwrap(),
            vec!["--foo".to_string(), "bar".to_string(), "--baz".to_string()]
        );
    }

    #[test]
    fn parse_custom_args_preserves_quoted_spaces() {
        assert_eq!(
            parse_custom_args(r#"--name "my model" --port 8080"#).unwrap(),
            vec![
                "--name".to_string(),
                "my model".to_string(),
                "--port".to_string(),
                "8080".to_string()
            ]
        );
    }

    #[test]
    fn parse_custom_args_rejects_unclosed_quote() {
        assert!(parse_custom_args(r#"--name "my model"#).is_err());
    }

    #[test]
    fn parse_custom_args_preserves_unquoted_windows_paths() {
        assert_eq!(
            parse_custom_args(r#"--model C:\models\foo.gguf"#).unwrap(),
            vec!["--model".to_string(), r#"C:\models\foo.gguf"#.to_string()]
        );
    }

    #[test]
    fn parse_custom_args_preserves_quoted_windows_paths_with_spaces() {
        assert_eq!(
            parse_custom_args(r#"--model "C:\model dir\foo.gguf""#).unwrap(),
            vec![
                "--model".to_string(),
                r#"C:\model dir\foo.gguf"#.to_string()
            ]
        );
    }

    #[test]
    fn parse_custom_args_preserves_unc_paths() {
        assert_eq!(
            parse_custom_args(r#"--model \\server\share\foo.gguf"#).unwrap(),
            vec![
                "--model".to_string(),
                r#"\\server\share\foo.gguf"#.to_string()
            ]
        );
    }

    #[test]
    fn parse_custom_args_preserves_quoted_windows_path_ending_with_backslash() {
        assert_eq!(
            parse_custom_args(r#"--dir "C:\models dir\""#).unwrap(),
            vec!["--dir".to_string(), r#"C:\models dir\"#.to_string()]
        );
    }

    #[test]
    fn parse_custom_args_preserves_quoted_unc_path_ending_with_backslash() {
        assert_eq!(
            parse_custom_args(r#"--dir "\\server\share dir\""#).unwrap(),
            vec!["--dir".to_string(), r#"\\server\share dir\"#.to_string()]
        );
    }

    #[test]
    fn parse_custom_args_escapes_whitespace_outside_quotes() {
        assert_eq!(
            parse_custom_args(r#"--name my\ model"#).unwrap(),
            vec!["--name".to_string(), "my model".to_string()]
        );
    }

    #[test]
    fn extract_enabled_custom_args_filters_disabled_and_empty_rows() {
        let custom_args = vec![
            CustomArg {
                id: "a".to_string(),
                enabled: true,
                text: "--foo bar".to_string(),
            },
            CustomArg {
                id: "b".to_string(),
                enabled: false,
                text: "--disabled yes".to_string(),
            },
            CustomArg {
                id: "c".to_string(),
                enabled: true,
                text: "   ".to_string(),
            },
        ];

        assert_eq!(
            extract_enabled_custom_args(&custom_args).unwrap(),
            vec!["--foo".to_string(), "bar".to_string()]
        );
    }

    #[test]
    fn build_command_appends_enabled_custom_args_after_builtin_params() {
        let params = json!({
            "port": { "enabled": true, "value": "9090" }
        });
        let custom_args = vec![CustomArg {
            id: "a".to_string(),
            enabled: true,
            text: "--name local-model".to_string(),
        }];

        let command = build_command("llama-server", &params, &custom_args).unwrap();

        assert!(has_adjacent_args(&command, "--port", "9090"));
        assert!(has_adjacent_args(&command, "--name", "local-model"));
    }

    #[test]
    fn build_command_quotes_custom_args_with_spaces_for_preview() {
        let custom_args = vec![CustomArg {
            id: "a".to_string(),
            enabled: true,
            text: r#"--name "my model""#.to_string(),
        }];

        let command = build_command("llama-server", &json!({}), &custom_args).unwrap();

        assert!(command.contains(r#"--name "my model""#));
    }

    #[test]
    fn build_command_rejects_invalid_custom_args_before_command_preview() {
        let custom_args = vec![CustomArg {
            id: "a".to_string(),
            enabled: true,
            text: r#"--name "unterminated"#.to_string(),
        }];

        let error = build_command("llama-server", &json!({}), &custom_args).unwrap_err();

        assert!(error.contains("Unclosed quote in custom arguments"));
    }

    #[test]
    fn pre_start_failure_message_includes_exit_code() {
        let status = shell_command("exit 7").status().unwrap();

        assert_eq!(
            pre_start_failure_message(&status),
            "Pre-start command failed with exit code 7"
        );
    }

    #[test]
    #[cfg(windows)]
    fn shell_command_uses_cmd_on_windows() {
        let command = shell_command("echo hello");

        assert_eq!(command.get_program(), OsStr::new("cmd"));
        assert_eq!(
            command.get_args().collect::<Vec<_>>(),
            vec![OsStr::new("/C"), OsStr::new("echo hello")]
        );
    }

    #[test]
    #[cfg(not(windows))]
    fn shell_command_uses_sh_on_unix() {
        let command = shell_command("echo hello");

        assert_eq!(command.get_program(), OsStr::new("sh"));
        assert_eq!(
            command.get_args().collect::<Vec<_>>(),
            vec![OsStr::new("-c"), OsStr::new("echo hello")]
        );
    }
}
