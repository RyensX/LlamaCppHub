use crate::hidden_command::hidden_command;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::{LazyLock, Mutex};
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
use tauri::Emitter;

// ── Shared types ──

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct ProcessResource {
    pub pid: u32,
    pub cpu: f64,
    pub ram_mb: f64,
    pub vram_mb: f64,
    pub gpu: f64,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub cpu: SystemCpuInfo,
    pub memory: SystemMemoryInfo,
    pub gpus: Vec<SystemGpuInfo>,
    pub updated_at: i64,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SystemCpuInfo {
    pub brand: Option<String>,
    pub usage_percent: f64,
    pub cores: usize,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SystemMemoryInfo {
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub available_bytes: u64,
    pub modules: Vec<SystemMemoryModuleInfo>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SystemMemoryModuleInfo {
    pub manufacturer: Option<String>,
    pub part_number: Option<String>,
    pub capacity_bytes: Option<u64>,
    pub speed_mhz: Option<u32>,
    pub memory_type: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SystemGpuInfo {
    pub name: String,
    pub memory_total_bytes: Option<u64>,
    pub memory_used_bytes: Option<u64>,
}

// ── sysinfo persistent state for accurate per-process CPU ──
/// sysinfo's Process::cpu_usage() returns the CPU usage since the last refresh.
static SYS: LazyLock<Mutex<System>> = LazyLock::new(|| Mutex::new(System::new_all()));

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_csv_fields_trims_quotes_and_spaces() {
        let fields = parse_csv_fields(r#""NVIDIA GeForce RTX", "8192", "1024""#);
        assert_eq!(fields, vec!["NVIDIA GeForce RTX", "8192", "1024"]);
    }

    #[test]
    fn parse_pid_from_gpu_counter_name_reads_pid_prefix() {
        assert_eq!(
            parse_pid_from_gpu_counter_name("pid_1234_engtype_3D"),
            Some(1234)
        );
        assert_eq!(parse_pid_from_gpu_counter_name("not_a_pid"), None);
    }

    #[test]
    fn parse_static_gpu_csv_line_reads_index_name_and_total_memory() {
        let gpu = parse_static_gpu_csv_line(r#"0, "NVIDIA GeForce RTX 4090", 24564"#).unwrap();
        assert_eq!(gpu.index, 0);
        assert_eq!(gpu.name, "NVIDIA GeForce RTX 4090");
        assert_eq!(gpu.memory_total_bytes, Some(24564 * 1024 * 1024));
    }

    #[test]
    fn parse_gpu_used_memory_csv_line_reads_index_and_used_memory() {
        assert_eq!(
            parse_gpu_used_memory_csv_line("1, 2048"),
            Some((1, 2048 * 1024 * 1024))
        );
        assert_eq!(parse_gpu_used_memory_csv_line("bad data"), None);
    }
}

#[derive(Clone, Debug)]
struct StaticSystemInfo {
    cpu_brand: Option<String>,
    cpu_cores: usize,
    memory_modules: Vec<SystemMemoryModuleInfo>,
    gpus: Vec<StaticSystemGpuInfo>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct StaticSystemGpuInfo {
    index: usize,
    name: String,
    memory_total_bytes: Option<u64>,
}

static STATIC_SYSTEM_INFO: LazyLock<Mutex<Option<StaticSystemInfo>>> =
    LazyLock::new(|| Mutex::new(None));

/// Per-process VRAM cache — recaches every 5 seconds.
/// Stores (timestamp, (pid -> used_memory_mb)).
#[derive(Clone, Copy, Default)]
struct GpuProcessResource {
    vram_mb: f64,
    gpu: f64,
}

static GPU_CACHE: LazyLock<
    Mutex<(
        std::time::Instant,
        std::collections::HashMap<u32, GpuProcessResource>,
    )>,
> = LazyLock::new(|| Mutex::new((std::time::Instant::now(), std::collections::HashMap::new())));

// ── Resource Monitoring ──

/// Get resource usage for a specific process.
/// CPU: sysinfo Process::cpu_usage() (requires periodic refresh).
/// RAM: RSS physical memory.
/// VRAM: per-process via nvidia-smi compute apps query.
pub fn get_process_resource(pid: u32) -> Result<ProcessResource, String> {
    let mut sys = SYS.lock().unwrap();

    let root_pid = Pid::from(pid as usize);
    let pids = collect_process_tree_pids(&sys, root_pid);

    // Only refresh the relevant process tree, not all system processes.
    let pids_to_refresh: ProcessesToUpdate = ProcessesToUpdate::Some(&pids);
    sys.refresh_processes_specifics(
        pids_to_refresh,
        true,
        ProcessRefreshKind::nothing().with_cpu().with_memory(),
    );

    let cpu_count = sys.cpus().len().max(1) as f64;

    let ram_mb = pids
        .iter()
        .filter_map(|pid| sys.process(*pid))
        .map(|p| p.memory() as f64 / 1024.0 / 1024.0)
        .sum();
    let cpu = pids
        .iter()
        .filter_map(|pid| sys.process(*pid))
        .map(|p| p.cpu_usage() as f64 / cpu_count)
        .sum::<f64>()
        .clamp(0.0, 100.0);
    let os_pids: Vec<u32> = pids.iter().map(|pid| pid.as_u32()).collect();

    drop(sys);

    let gpu_resource = get_process_gpu_resource(&os_pids);

    Ok(ProcessResource {
        pid,
        cpu,
        ram_mb,
        vram_mb: gpu_resource.vram_mb,
        gpu: gpu_resource.gpu,
    })
}

pub fn get_system_info() -> Result<SystemInfo, String> {
    let mut sys = SYS.lock().unwrap();
    sys.refresh_cpu_usage();
    sys.refresh_memory();

    let static_info = get_static_system_info(&sys);
    let cpus = sys.cpus();
    let cpu_usage = if cpus.is_empty() {
        0.0
    } else {
        cpus.iter().map(|cpu| cpu.cpu_usage() as f64).sum::<f64>() / cpus.len() as f64
    };
    let memory = SystemMemoryInfo {
        total_bytes: sys.total_memory(),
        used_bytes: sys.used_memory(),
        available_bytes: sys.available_memory(),
        modules: static_info.memory_modules.clone(),
    };
    let cpu = SystemCpuInfo {
        brand: static_info.cpu_brand.clone(),
        usage_percent: cpu_usage.clamp(0.0, 100.0),
        cores: static_info.cpu_cores,
    };

    drop(sys);

    Ok(SystemInfo {
        cpu,
        memory,
        gpus: read_dynamic_gpus(&static_info),
        updated_at: chrono::Utc::now().timestamp_millis(),
    })
}

fn get_static_system_info(sys: &System) -> StaticSystemInfo {
    let mut cached = STATIC_SYSTEM_INFO.lock().unwrap();
    if let Some(info) = cached.clone() {
        return info;
    }

    let cpus = sys.cpus();
    let info = StaticSystemInfo {
        cpu_brand: cpus
            .iter()
            .map(|cpu| cpu.brand().trim())
            .find(|brand| !brand.is_empty())
            .map(str::to_string),
        cpu_cores: cpus.len(),
        memory_modules: read_windows_memory_modules(),
        gpus: read_nvidia_static_gpus(),
    };

    *cached = Some(info.clone());
    info
}

fn read_dynamic_gpus(static_info: &StaticSystemInfo) -> Vec<SystemGpuInfo> {
    let used_memory_by_index = read_nvidia_gpu_used_memory();

    static_info
        .gpus
        .iter()
        .map(|gpu| SystemGpuInfo {
            name: gpu.name.clone(),
            memory_total_bytes: gpu.memory_total_bytes,
            memory_used_bytes: used_memory_by_index.get(&gpu.index).copied(),
        })
        .collect()
}

pub fn refresh_and_emit_system_info(app: &tauri::AppHandle) -> Result<(), String> {
    let info = get_system_info()?;
    app.emit("system:info", info).map_err(|e| e.to_string())
}

pub fn collect_process_tree_pids(sys: &System, root_pid: Pid) -> Vec<Pid> {
    let mut result = Vec::new();
    let mut stack = vec![root_pid];
    let mut seen = HashSet::new();

    while let Some(pid) = stack.pop() {
        if !seen.insert(pid) {
            continue;
        }
        result.push(pid);

        for (child_pid, process) in sys.processes() {
            if process.parent() == Some(pid) {
                stack.push(*child_pid);
            }
        }
    }

    result
}

fn get_process_gpu_resource(pids: &[u32]) -> GpuProcessResource {
    let cache_guard = GPU_CACHE.lock().unwrap();
    let (cache_ts, cache_data) = &*cache_guard;

    if cache_ts.elapsed().as_secs() < 2 && !cache_data.is_empty() {
        return sum_gpu_resources(pids, cache_data);
    }
    drop(cache_guard);

    let mut cache_guard = GPU_CACHE.lock().unwrap();
    let mut result_map = read_nvidia_pmon();

    for (p, vram_mb) in read_nvidia_compute_apps()
        .into_iter()
        .chain(read_nvidia_process_table())
        .chain(read_windows_gpu_process_memory())
    {
        result_map
            .entry(p)
            .and_modify(|resource| resource.vram_mb = resource.vram_mb.max(vram_mb))
            .or_insert(GpuProcessResource { vram_mb, gpu: 0.0 });
    }

    for (p, gpu) in read_windows_gpu_engine_usage() {
        result_map
            .entry(p)
            .and_modify(|resource| resource.gpu = resource.gpu.max(gpu))
            .or_insert(GpuProcessResource { vram_mb: 0.0, gpu });
    }

    if !result_map.is_empty() {
        cache_guard.0 = std::time::Instant::now();
        cache_guard.1 = result_map;
    }

    sum_gpu_resources(pids, &cache_guard.1)
}

fn sum_gpu_resources(
    pids: &[u32],
    data: &std::collections::HashMap<u32, GpuProcessResource>,
) -> GpuProcessResource {
    let mut total = GpuProcessResource::default();
    for pid in pids {
        if let Some(resource) = data.get(pid) {
            total.vram_mb += resource.vram_mb;
            total.gpu += resource.gpu;
        }
    }
    total.gpu = total.gpu.clamp(0.0, 100.0);
    total
}

fn read_nvidia_pmon() -> std::collections::HashMap<u32, GpuProcessResource> {
    let mut result_map = std::collections::HashMap::new();
    if let Ok(output) = hidden_command("nvidia-smi")
        .args(["pmon", "-c", "1", "-s", "um"])
        .output()
    {
        let text = String::from_utf8_lossy(&output.stdout);
        for line in text.lines().map(str::trim).filter(|line| !line.is_empty()) {
            if line.starts_with('#') {
                continue;
            }

            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 4 {
                continue;
            }

            let pid = match parts[1].parse::<u32>() {
                Ok(pid) => pid,
                Err(_) => continue,
            };
            let gpu = parts
                .get(3)
                .and_then(|value| value.parse::<f64>().ok())
                .unwrap_or(0.0)
                .clamp(0.0, 100.0);
            let vram_mb = parts
                .get(9)
                .and_then(|value| value.parse::<f64>().ok())
                .unwrap_or(0.0)
                .max(0.0);
            result_map.insert(pid, GpuProcessResource { vram_mb, gpu });
        }
    }
    result_map
}

fn read_nvidia_compute_apps() -> std::collections::HashMap<u32, f64> {
    let mut result_map = std::collections::HashMap::new();
    if let Ok(output) = hidden_command("nvidia-smi")
        .args([
            "--query-compute-apps=pid,used_memory",
            "--format=csv,noheader,nounits",
        ])
        .output()
    {
        let text = String::from_utf8_lossy(&output.stdout);
        for line in text.lines().filter(|line| !line.is_empty()) {
            let parts: Vec<&str> = line.split(',').collect();
            if parts.len() >= 2 {
                if let Ok(pid) = parts[0].trim().parse::<u32>() {
                    if let Ok(vram_mb) = parts[1].trim().parse::<f64>() {
                        result_map.insert(pid, vram_mb);
                    }
                }
            }
        }
    }
    result_map
}

fn read_nvidia_process_table() -> std::collections::HashMap<u32, f64> {
    let mut result_map = std::collections::HashMap::new();
    if let Ok(output) = hidden_command("nvidia-smi").output() {
        let text = String::from_utf8_lossy(&output.stdout);
        for line in text.lines().map(str::trim) {
            if !line.starts_with('|') || !line.contains("MiB") {
                continue;
            }

            let parts: Vec<&str> = line.trim_matches('|').split_whitespace().collect();
            let pid = parts.iter().find_map(|part| part.parse::<u32>().ok());
            let vram_mb = parts.iter().rev().find_map(|part| {
                part.strip_suffix("MiB")
                    .and_then(|value| value.parse::<f64>().ok())
            });

            if let (Some(pid), Some(vram_mb)) = (pid, vram_mb) {
                result_map.insert(pid, vram_mb);
            }
        }
    }
    result_map
}

#[cfg(windows)]
fn read_windows_gpu_process_memory() -> std::collections::HashMap<u32, f64> {
    let mut result_map = std::collections::HashMap::new();
    let script = "Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUProcessMemory | Select-Object Name,DedicatedUsage | ConvertTo-Csv -NoTypeInformation";
    if let Ok(output) = hidden_command("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()
    {
        let text = String::from_utf8_lossy(&output.stdout);
        for line in text.lines().skip(1) {
            let fields = parse_csv_fields(line);
            if fields.len() < 2 {
                continue;
            }
            if let (Some(pid), Ok(bytes)) = (
                parse_pid_from_gpu_counter_name(&fields[0]),
                fields[1].parse::<f64>(),
            ) {
                let mb = bytes / 1024.0 / 1024.0;
                result_map
                    .entry(pid)
                    .and_modify(|value| *value = f64::max(*value, mb))
                    .or_insert(mb);
            }
        }
    }
    result_map
}

#[cfg(not(windows))]
fn read_windows_gpu_process_memory() -> std::collections::HashMap<u32, f64> {
    std::collections::HashMap::new()
}

#[cfg(windows)]
fn read_windows_gpu_engine_usage() -> std::collections::HashMap<u32, f64> {
    let mut result_map = std::collections::HashMap::new();
    let script = "Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine | Select-Object Name,UtilizationPercentage | ConvertTo-Csv -NoTypeInformation";
    if let Ok(output) = hidden_command("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()
    {
        let text = String::from_utf8_lossy(&output.stdout);
        for line in text.lines().skip(1) {
            let fields = parse_csv_fields(line);
            if fields.len() < 2 {
                continue;
            }
            if let (Some(pid), Ok(gpu)) = (
                parse_pid_from_gpu_counter_name(&fields[0]),
                fields[1].parse::<f64>(),
            ) {
                result_map
                    .entry(pid)
                    .and_modify(|value| *value = f64::max(*value, gpu))
                    .or_insert(gpu);
            }
        }
    }
    result_map
}

#[cfg(not(windows))]
fn read_windows_gpu_engine_usage() -> std::collections::HashMap<u32, f64> {
    std::collections::HashMap::new()
}

fn parse_pid_from_gpu_counter_name(name: &str) -> Option<u32> {
    name.strip_prefix("pid_")?.split('_').next()?.parse().ok()
}

fn parse_csv_fields(line: &str) -> Vec<String> {
    line.split(',')
        .map(|field| field.trim().trim_matches('"').to_string())
        .collect()
}

fn read_nvidia_static_gpus() -> Vec<StaticSystemGpuInfo> {
    let mut gpus = Vec::new();
    if let Ok(output) = hidden_command("nvidia-smi")
        .args([
            "--query-gpu=index,name,memory.total",
            "--format=csv,noheader,nounits",
        ])
        .output()
    {
        if !output.status.success() {
            return gpus;
        }

        let text = String::from_utf8_lossy(&output.stdout);
        for line in text.lines().filter(|line| !line.trim().is_empty()) {
            if let Some(gpu) = parse_static_gpu_csv_line(line) {
                gpus.push(gpu);
            }
        }
    }
    gpus.sort_by_key(|gpu| gpu.index);
    gpus
}

fn parse_static_gpu_csv_line(line: &str) -> Option<StaticSystemGpuInfo> {
    let fields = parse_csv_fields(line);
    if fields.len() < 3 || fields[1].is_empty() {
        return None;
    }

    Some(StaticSystemGpuInfo {
        index: fields[0].parse().ok()?,
        name: fields[1].clone(),
        memory_total_bytes: fields[2].parse::<u64>().ok().map(|mb| mb * 1024 * 1024),
    })
}

fn read_nvidia_gpu_used_memory() -> std::collections::HashMap<usize, u64> {
    let mut used_memory_by_index = std::collections::HashMap::new();
    if let Ok(output) = hidden_command("nvidia-smi")
        .args([
            "--query-gpu=index,memory.used",
            "--format=csv,noheader,nounits",
        ])
        .output()
    {
        if !output.status.success() {
            return used_memory_by_index;
        }

        let text = String::from_utf8_lossy(&output.stdout);
        for line in text.lines().filter(|line| !line.trim().is_empty()) {
            if let Some((index, memory_used_bytes)) = parse_gpu_used_memory_csv_line(line) {
                used_memory_by_index.insert(index, memory_used_bytes);
            }
        }
    }
    used_memory_by_index
}

fn parse_gpu_used_memory_csv_line(line: &str) -> Option<(usize, u64)> {
    let fields = parse_csv_fields(line);
    if fields.len() < 2 {
        return None;
    }

    Some((
        fields[0].parse().ok()?,
        fields[1].parse::<u64>().ok()? * 1024 * 1024,
    ))
}

#[cfg(windows)]
fn read_windows_memory_modules() -> Vec<SystemMemoryModuleInfo> {
    let mut modules = Vec::new();
    let script = "Get-CimInstance Win32_PhysicalMemory | Select-Object Manufacturer,PartNumber,Capacity,Speed,SMBIOSMemoryType | ConvertTo-Csv -NoTypeInformation";
    if let Ok(output) = hidden_command("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()
    {
        if !output.status.success() {
            return modules;
        }

        let text = String::from_utf8_lossy(&output.stdout);
        for line in text.lines().skip(1).filter(|line| !line.trim().is_empty()) {
            let fields = parse_csv_fields(line);
            if fields.len() < 5 {
                continue;
            }
            modules.push(SystemMemoryModuleInfo {
                manufacturer: clean_optional_field(fields.get(0)),
                part_number: clean_optional_field(fields.get(1)),
                capacity_bytes: fields
                    .get(2)
                    .and_then(|value| value.trim().parse::<u64>().ok()),
                speed_mhz: fields
                    .get(3)
                    .and_then(|value| value.trim().parse::<u32>().ok()),
                memory_type: fields
                    .get(4)
                    .and_then(|value| value.trim().parse::<u32>().ok())
                    .and_then(format_memory_type),
            });
        }
    }
    modules
}

#[cfg(not(windows))]
fn read_windows_memory_modules() -> Vec<SystemMemoryModuleInfo> {
    Vec::new()
}

fn clean_optional_field(value: Option<&String>) -> Option<String> {
    value
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn format_memory_type(value: u32) -> Option<String> {
    match value {
        20 => Some("DDR".to_string()),
        21 => Some("DDR2".to_string()),
        24 => Some("DDR3".to_string()),
        26 => Some("DDR4".to_string()),
        30 => Some("LPDDR4".to_string()),
        34 => Some("DDR5".to_string()),
        35 => Some("LPDDR5".to_string()),
        _ => None,
    }
}

/// Detect common llama.cpp paths on Windows
pub fn detect_llama_cpp_paths() -> Vec<String> {
    let mut paths = Vec::new();
    let mut seen = HashSet::new();

    let add_if_exists = |p: String, paths: &mut Vec<String>, seen: &mut HashSet<String>| {
        if std::path::Path::new(&p).exists() && seen.insert(p.clone()) {
            paths.push(p);
        }
    };

    let appdata = std::env::var("APPDATA").unwrap_or_default();
    let localappdata = std::env::var("LOCALAPPDATA").unwrap_or_default();
    let programfiles = std::env::var("ProgramFiles").unwrap_or_default();
    let programfilesx86 = std::env::var("ProgramFiles(x86)").unwrap_or_default();
    let userprofile = std::env::var("USERPROFILE").unwrap_or_default();

    let common_dirs: Vec<String> = vec![
        format!("{}\\llama.cpp", programfiles),
        format!("{}\\llama.cpp", programfilesx86),
        format!("{}\\Ollama\\models\\llama.cpp", programfiles),
        format!("{}\\llama-cpp", localappdata),
        format!("{}\\llama.cpp", localappdata),
        format!("{}\\Ollama", localappdata),
        format!("{}\\llama.cpp", appdata),
        userprofile.clone(),
    ];

    for dir in &common_dirs {
        if !dir.is_empty() {
            for exe in &["server.exe", "llama-cpp.exe", "llama-server.exe"] {
                let full = format!("{}\\{}", dir, exe);
                add_if_exists(full, &mut paths, &mut seen);
            }
        }
    }

    if let Ok(cwd) = std::env::current_dir() {
        for exe in &["server.exe", "llama-cpp.exe", "llama-server.exe"] {
            let full = cwd.join(exe);
            if let Some(s) = full.to_str() {
                add_if_exists(s.to_string(), &mut paths, &mut seen);
            }
        }
    }

    if let Ok(path_env) = std::env::var("PATH") {
        for dir in path_env.split(';') {
            for exe in &["server.exe", "llama-cpp.exe", "llama-server.exe"] {
                let full = format!("{}\\{}", dir, exe);
                add_if_exists(full, &mut paths, &mut seen);
            }
        }
    }

    paths
}

/// Refresh resource data for running instances and emit to frontend.
/// Called by a background timer every 2 seconds.
pub fn refresh_and_emit_resources(
    instances: Vec<(String, u32)>,
    app: &tauri::AppHandle,
) -> Result<(), String> {
    if instances.is_empty() {
        return Ok(());
    }

    let mut sys = SYS.lock().unwrap();

    let mut instance_trees: Vec<(String, u32, Vec<Pid>)> = Vec::new();
    for (instance_id, pid) in instances {
        let root_pid = Pid::from(pid as usize);
        let tree_pids = collect_process_tree_pids(&sys, root_pid);
        instance_trees.push((instance_id, pid, tree_pids));
    }

    let refresh_pids: Vec<Pid> = instance_trees
        .iter()
        .flat_map(|(_, _, tree_pids)| tree_pids.iter().copied())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();

    if !refresh_pids.is_empty() {
        sys.refresh_processes_specifics(
            ProcessesToUpdate::Some(&refresh_pids),
            true,
            ProcessRefreshKind::nothing().with_cpu().with_memory(),
        );
    }

    let cpu_count = sys.cpus().len().max(1) as f64;
    let results: Vec<(String, u32, f64, f64, Vec<u32>)> = instance_trees
        .into_iter()
        .map(|(instance_id, pid, tree_pids)| {
            let ram_mb = tree_pids
                .iter()
                .filter_map(|p| sys.process(*p))
                .map(|p| p.memory() as f64 / 1024.0 / 1024.0)
                .sum();
            let cpu = tree_pids
                .iter()
                .filter_map(|p| sys.process(*p))
                .map(|p| p.cpu_usage() as f64 / cpu_count)
                .sum::<f64>()
                .clamp(0.0, 100.0);
            let os_pids = tree_pids.iter().map(|p| p.as_u32()).collect();
            (instance_id, pid, cpu, ram_mb, os_pids)
        })
        .collect();

    drop(sys);

    let now = chrono::Utc::now().timestamp_millis();
    for (instance_id, pid, cpu, ram_mb, os_pids) in results {
        let gpu_resource = get_process_gpu_resource(&os_pids);

        app.emit(
            &format!("instance:{}:resource", instance_id),
            serde_json::json!({
                "instanceId": instance_id,
                "pid": pid,
                "cpu": cpu,
                "gpu": gpu_resource.gpu,
                "ram": ram_mb,
                "vram": gpu_resource.vram_mb,
                "timestamp": now,
            }),
        )
        .ok();
    }

    Ok(())
}
