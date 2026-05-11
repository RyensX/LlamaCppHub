# llama.cpp Manager - Tauri 桌面应用设计方案

## Context

在空目录下从零开发一个 Tauri 桌面应用，用于管理和启动 llama.cpp 本地推理实例。支持多配置管理、实时日志/资源监控、国际化（中/英）、多实例并发运行。

---

## 技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| **框架** | Tauri 2.x (Rust backend + Web frontend) | 轻量、原生、跨平台 |
| **前端框架** | React 18 + TypeScript | 成熟稳定 |
| **UI 组件** | shadcn/ui + Radix UI | 高质量无样式组件 |
| **样式** | Tailwind CSS 3.4 | 原子化 CSS，与当前 shadcn/ui 配置兼容 |
| **动画** | Framer Motion | 流畅过渡动画 |
| **国际化** | i18next + react-i18next | 中英双语 |
| **状态管理** | Zustand | 轻量状态库 |
| **后端** | Rust (Tauri v2 command) | 进程管理、配置持久化 |
| **配置存储** | JSON 文件 (`dirs::config_dir()/llama-cpp-manager/configs.json`) | 简单可靠 |
| **资源监控** | `sysinfo` crate (0.33+) | 跨平台进程资源读取 (CPU/RAM) |
| **显存监控** | `nvidia-smi` CLI 解析 (Windows NVIDIA) | per-process VRAM 检测，5s 缓存；失败返回 0 |
| **图表** | Recharts | 实时资源 usage 折线图 |
| **进程管理** | Windows Job Object | 应用退出时自动回收子进程 |

---

## 项目结构

```
llama-cpp-manager/
├── src/                        # Tauri frontend (React)
│   ├── main.tsx
│   ├── App.tsx
│   ├── i18n/
│   │   ├── index.ts
│   │   └── locales/
│   │       ├── zh/translation.json
│   │       └── en/translation.json
│   ├── contexts/
│   │   └── ThemeProvider.tsx   # 主题上下文 (system/light/dark)
│   ├── components/
│   │   ├── Layout.tsx              # 主布局 (Header + Sidebar + DetailView)
│   │   ├── Header.tsx              # 顶部栏 (Logo + 语言 + 主题 + 路径设置)
│   │   ├── Sidebar.tsx             # 左侧导航 (配置列表)
│   │   ├── ConfigItem.tsx          # 左侧单个配置项 (状态指示)
│   │   ├── DetailView.tsx          # 右侧详情区 (参数摘要 / 运行控制)
│   │   ├── ConfigEditor.tsx        # 配置编辑器 (参数表单抽屉)
│   │   ├── ParamField.tsx          # 单个参数输入组件 (开关 + 值输入)
│   │   ├── ParamTooltip.tsx        # 参数解释 tooltip
│   │   ├── LiveLog.tsx             # 实时日志滚动显示
│   │   ├── ResourceMonitor.tsx     # 资源监控卡片 (CPU/内存/显存)
│   │   ├── ResourceChart.tsx       # 资源趋势折线图 (Recharts)
│   │   ├── RunButton.tsx           # 启动/停止按钮
│   │   ├── GlobalStatusBar.tsx     # 底部全局状态栏 (多实例汇总)
│   │   ├── EmptyState.tsx          # 空状态提示
│   │   └── ThemeToggle.tsx         # 主题切换 (system→dark→light→system)
│   ├── hooks/
│   │   ├── useConfigs.ts           # 配置 CRUD hooks
│   │   ├── useInstances.ts         # 实例生命周期管理
│   │   └── useI18n.ts              # i18n 国际化
│   ├── stores/
│   │   ├── configStore.ts          # 配置状态 (Map<string, LlamaConfig>)
│   │   └── instanceStore.ts        # 实例状态 (Map<string, RunningInstance>)
│   └── types/
│       └── llama-params.ts         # 所有类型定义
├── src-tauri/                    # Tauri backend (Rust)
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/
│   │   └── default.json
│   ├── build.rs
│   ├── rust-toolchain.toml         # 固定 stable channel
│   └── src/
│       ├── main.rs                 # 入口, Tauri 注册, 托盘菜单
│       ├── settings.rs             # 配置持久化 (configs + app-config)
│       ├── process_mgr.rs          # 进程管理 (启动/停止/Job Object)
│       └── ipc.rs                  # Tauri command + 资源共享 (资源监控/路径检测)
├── public/
├── tailwind.config.ts
├── vite.config.ts
└── package.json
```

---

## 核心数据模型

### 1. 参数定义 (`llama-params.ts`)

所有 llama.cpp server 模式参数（基于最新源码），约 50+ 个参数。

```typescript
export type ParamType = "int" | "float" | "bool" | "string" | "path";
export type ParamCategory =
  | "model"      // 模型相关: -m, -t, -tb, -c, -ngl
  | "context"    // 上下文: --ctx-size, --batch, --ubatch, --repetition-penalty
  | "batch"      // 批处理: --batch, --ubatch, --split-mode, --max-batch
  | "gpu"        // GPU: -ngl, --tensor-split, --main-gpu, --rope-scaling
  | "server"     // 服务端: --host, --port, --embedding
  | "log"        // 日志: --log-disable, --log-prefix
  | "advanced";  // 高级: --mlock, --no-mmap, -fa, --numa, --low-vram

export interface ParamDef {
  key: string;           // 唯一标识 (用于 params record 的 key)
  flag: string;          // CLI 参数标志 (--flag 或 -t)
  category: ParamCategory;
  defaultValue: string;
  type: ParamType;
  min?: number;          // 数值类型最小值
  max?: number;          // 数值类型最大值
  name?: string;         // i18n 显示名 (可选, 优先从翻译取)
  description?: string;  // i18n 描述 (可选)
}

export const PARAM_DEFS: ParamDef[] = [ /* ... */ ];

export interface ParamValue {
  value: string;    // 参数值
  enabled: boolean; // 是否生效
}

export interface LlamaConfig {
  id: string;              // UUID v4
  name: string;            // 配置名称 (用户自定义)
  llamaCppPath: string;    // llama.cpp 可执行文件路径 (可为空, 使用全局路径)
  params: Record<string, ParamValue>;  // key → ParamValue
  createdAt: number;       // Unix timestamp (ms)
  updatedAt: number;
  isFavorite: boolean;
}
```

**参数分类说明:**

| 分类 | 参数示例 | 说明 |
|---|---|---|
| **model** | `-m/--model`, `-t/--threads`, `-tb/--threads-batch`, `-ngl/--n-gpu-layers` | 模型加载与线程配置 |
| **context** | `--ctx-size`, `--batch`, `--ubatch`, `--repetition-penalty`, `--frequency-penalty` | 上下文窗口与生成策略 |
| **batch** | `--batch`, `--ubatch`, `--split-mode`, `--max-batch` | 批处理与分片策略 |
| **gpu** | `-ngl`, `--tensor-split`, `--main-gpu`, `--rope-scaling`, `--rope-freq-base` | GPU 层分配与张量切分 |
| **server** | `--host`, `--port`, `--embedding` | HTTP 服务器配置 |
| **log** | `--log-disable`, `--log-prefix` | 日志开关与格式 |
| **advanced** | `--mlock`, `--no-mmap`, `-fa/--flash-attn`, `--numa`, `--low-vram`, `--seed` | 高级性能与行为控制 |

> **注意:** 仅覆盖 server.cpp 的 CLI 参数，不覆盖 main.cpp (CLI 交互模式) 的独有参数。

### 2. 运行实例模型

```typescript
export type InstanceStatus = "starting" | "running" | "error" | "stopped";

export interface ResourceSnapshot {
  cpu: number;        // CPU 使用率百分比
  ram: number;        // 物理内存 RSS (MB)
  vram: number;       // 显存使用 (MB), Windows NVIDIA 专用
  timestamp: number;  // 采集时间戳 (ms)
}

export interface RunningInstance {
  id: string;              // `${configId}-${Date.now()}`
  configId: string;
  configName: string;
  status: InstanceStatus;
  pid: number | null;      // 进程 PID (启动后填充)
  logs: string[];          // 日志行 (最新 1000 条)
  resource: ResourceSnapshot;  // 当前资源快照
  history: ResourceSnapshot[]; // 历史数据 (最新 120 个点, 约 2 分钟)
  startedAt: number;       // 启动时间戳 (ms)
  command: string;         // 完整命令行
}

// 日志条目 (Rust → Frontend 传输结构)
interface LogEntry {
  line: string;       // 日志文本
  type: "stdout" | "stderr";
}
```

**状态机:**

```
starting → running → stopped (正常退出)
starting → error (启动失败)
running → error (异常终止)
running → stopped (用户主动停止)

任何状态 → stopped (应用退出, Job Object 回收)
```

**状态指示 (Sidebar 卡片):**

| 状态 | 图标 | 颜色 | 动画 |
|---|---|---|---|
| 已停止 | ▢ | 灰色 | 无 |
| 运行中 | ● | 绿色 | 脉冲 |
| 启动中 | ↻ | 蓝色 | 旋转 |
| 错误 | ⚠ | 红色 | 无 |

### 3. 应用配置 (Rust `AppConfig`)

```rust
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub llama_cpp_path: Option<String>,  // 全局默认 llama.cpp 路径
    pub language: String,                 // "zh" | "en" | "en-US" 等
    pub theme: String,                    // "system" | "light" | "dark"
}
```

> `AppConfig` 不在设计文档初版中，是实际实现中新增的配置模块，用于管理用户偏好设置。

---

## 后端详细设计 (Rust)

### Cargo.toml 依赖

```toml
[dependencies]
tauri = { version = "2", features = ["tray-icon", "unstable", "image-png"] }
tauri-plugin-shell = { version = "2" }
tauri-plugin-dialog = { version = "2" }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
uuid = { version = "1", features = ["v4"] }
chrono = "0.4"
tokio = { version = "1", features = ["rt", "sync", "macros", "rt-multi-thread"] }
thiserror = "1"
dirs = "5"
sysinfo = "0.33"              # 跨平台进程信息 (CPU/RAM)
windows-core = "0.58"

[target.'cfg(windows)'.dependencies]
windows = { version = "0.58", features = [
    "Win32_Foundation",
    "Win32_Security",
    "Win32_System_JobObjects",
    "Win32_System_Threading",
]}
```

> **注意:** 不使用 `psutil` crate (该 crate 在 Rust 生态中不存在)。使用 `sysinfo` 0.33 获取 CPU/RAM，使用 `nvidia-smi` CLI 获取 VRAM。`tokio` 不使用 `full` feature，仅启用需要的子 feature。

### 模块架构

```
main.rs              # 入口, Tauri Builder, Command 注册, 托盘, 窗口事件
settings.rs          # 配置持久化 (configs.json + app-config.json)
process_mgr.rs       # 进程管理 (启动/停止/Job Object/日志流)
ipc.rs               # Tauri Command 实现 + 资源共享 (资源监控/路径检测)
```

**为什么合并了 monitor.rs → ipc.rs:**
- 资源监控函数 (`get_process_resource`, `get_global_vram`) 是轻量级工具函数，不需要独立模块
- 路径检测 (`detect_llama_cpp_paths`) 也是工具函数，自然归入 ipc.rs
- 减少文件数量，保持项目简洁

### Tauri Commands

所有 command 在 `main.rs` 中通过 `tauri::generate_handler![]` 注册。

```rust
// ── 配置管理 (main.rs) ──

#[tauri::command]
async fn get_configs() -> Result<Vec<LlamaConfig>, String>;
    // 加载 configs.json, 返回配置列表

#[tauri::command]
async fn save_config(config: LlamaConfig) -> Result<(), String>;
    // 原子写入: tmp file + rename

#[tauri::command]
async fn delete_config(id: String) -> Result<(), String>;
    // 从列表中移除对应配置

#[tauri::command]
async fn duplicate_config(id: String) -> Result<LlamaConfig, String>;
    // 复制配置, 生成新 UUID, 名称追加 "(copy)"

// ── 进程管理 (main.rs → process_mgr.rs) ──

#[tauri::command]
async fn start_instance(
    config_id: String,
    instance_id: String,
    app: tauri::AppHandle,
) -> Result<InstanceInfo, String>;
    // 1. 查找配置, 解析 llama.cpp 路径 (三级策略)
    // 2. 校验路径存在性
    // 3. process_mgr::start_llama_instance(), 使用 instance_id 作为日志/退出事件 topic
    // 4. 返回 PID + 完整命令行

#[tauri::command]
fn stop_instance_cmd(pid: u32) -> Result<(), String>;
    // 同步命令: 通过 Job Object 或 TerminateProcess 终止进程

// ── 资源监控 (main.rs → ipc.rs) ──

#[tauri::command]
fn get_process_resource_cmd(pid: u32) -> Result<ProcessResource, String>;
    // sysinfo 获取 CPU + RAM
    // nvidia-smi 获取 VRAM (5s 缓存)

#[tauri::command]
fn detect_llama_cpp_paths_cmd() -> Result<Vec<String>, String>;
    // 在常见目录 + PATH 中扫描 llama.cpp 可执行文件

// ── 路径管理 (main.rs → settings.rs) ──

#[tauri::command]
fn get_llama_cpp_path() -> Result<Option<String>, String>;
    // 返回 AppConfig.llama_cpp_path

#[tauri::command]
fn set_llama_cpp_path(path: String) -> Result<(), String>;
    // 写入 AppConfig

#[tauri::command]
fn select_file() -> Result<String, String>;
    // PowerShell OpenFileDialog (仅 Windows)
    // 用户手动选择文件时返回路径

// ── 应用设置 (main.rs → settings.rs) ──

#[tauri::command]
fn get_language() -> Result<String, String>;
#[tauri::command]
fn set_language(lang: String) -> Result<(), String>;
#[tauri::command]
fn get_theme() -> Result<String, String>;
#[tauri::command]
fn set_theme(theme: String) -> Result<(), String>;
#[tauri::command]
async fn save_all_settings(
    llama_cpp_path: String,
    language: String,
    theme: String,
) -> Result<(), String>;
    // 一键保存所有设置 (减少 RPC 次数)

// ── 退出 (main.rs → process_mgr.rs) ──

#[tauri::command]
fn quit_app(app: tauri::AppHandle);
    // 关闭 Job Object handle, 调用 app.exit(0)
```

### 三级路径策略

```
┌──────────────────────────────────────────────────────────────────┐
│ llama.cpp 路径解析 (优先级从高到低)                               │
├──────────────────────────────────────────────────────────────────┤
│ 1. 配置级路径   config.llama_cpp_path (非空时优先)                │
│ 2. 全局路径     AppConfig.llama_cpp_path (用户在全局设置中配置)    │
│ 3. 自动检测     detect_llama_cpp_paths() 扫描 10+ 常见目录        │
└──────────────────────────────────────────────────────────────────┘
```

**自动检测扫描范围 (Windows):**

| 来源 | 目录 |
|---|---|
| `Program Files\llama.cpp\` | 标准安装目录 |
| `Program Files\Ollama\models\llama.cpp\` | Ollama 集成的 llama.cpp |
| `%LOCALAPPDATA%\llama-cpp\` | 用户自定义目录 |
| `%LOCALAPPDATA%\llama.cpp\` | 用户自定义目录 |
| `%LOCALAPPDATA%\Ollama\` | Ollama 目录 |
| `%APPDATA%\llama.cpp\` | Roaming 配置目录 |
| `%USERPROFILE%\` | 用户主目录 |
| `CWD\` | 应用当前工作目录 |
| `PATH` 中每个目录 | 系统环境变量 |

扫描文件名: `server.exe`, `llama-cpp.exe`, `llama-server.exe`

### 进程启动流程 (核心)

```rust
pub async fn start_llama_instance(
    llama_cpp_path: &str,
    params: &serde_json::Value,
    app: &tauri::AppHandle,
    instance_id: &str,
    job_handle_raw: Option<isize>,  // Windows Job Object handle
) -> Result<InstanceInfo, String> {
    // 1. 构建命令行 (build_command + extract_enabled_params)
    let command_str = build_command(llama_cpp_path, params)?;

    // 2. 启动进程
    let mut cmd = Command::new(llama_cpp_path);
    for (flag, value) in extract_enabled_params(params) {
        cmd.arg(&flag);
        if let Some(v) = value { if v != "true" { cmd.arg(v); } }
    }
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn()?;
    let pid = child.id();

    // 3. [Windows] 分配到 Job Object (5 次重试)
    #[cfg(windows)]
    {
        assign_to_job(pid, job_handle).map_err(|e| {
            // 分配失败 → 终止进程, 返回错误
            TerminateProcess(pid);
            return Err(e);
        });
    }

    // 4. 释放 std::process::Child, 保留 stdout/stderr handles
    drop(child);

    // 5. 异步日志流 (stdout + stderr)
    let stdout_task = tokio::task::spawn_blocking(|| {
        for line in BufReader::new(stdout).lines() {
            app.emit(&format!("instance:{instance_id}:log"), { "line", "type": "stdout" });
        }
    });

    // 6. Exit tracker: 等待双流 EOF → 触发 exited 事件
    tokio::spawn(async move {
        stdout_task.await;
        stderr_task.await;
        app.emit(&format!("instance:{instance_id}:exited"), { "code": 0 });
    });

    // 7. [Windows] Health check: 500ms 内进程存活检查
    #[cfg(windows)]
    {
        wait_for_process_ready(pid, 500).map_err(|e| {
            app.emit(&format!("instance:{instance_id}:log"), { "line": e.to_string(), "type": "stderr" });
        });
    }

    Ok(InstanceInfo { pid, command: command_str })
}
```

**关键设计决策:**

1. **Job Object 分配在日志流之前** — 确保进程即使在日志流异常时也能被 Job Object 回收
2. **`spawn_blocking` 而非 `spawn`** — `BufReader::lines()` 是同步阻塞 I/O，必须放在线程池中
3. **Exit tracker 等待双流 EOF** — 只有 stdout 和 stderr 都关闭（进程完全退出）才触发 exited 事件
4. **Health check 500ms** — 防止进程瞬间崩溃后前端收到过期的 "running" 状态
5. **`drop(child)` 保留 stdout/stderr** — `std::process::Child` 持有一个进程句柄，释放它可以避免某些平台上的双重关闭问题

### 资源监控实现

```rust
pub fn get_process_resource(pid: u32) -> Result<ProcessResource, String> {
    let mut sys = System::new();
    sys.refresh_all();

    // CPU: 通过 sysinfo 的 cpu_usage() 获取
    let cpu = process.map(|p| p.cpu_usage() as f64).unwrap_or(0.0);

    // RAM: RSS 物理内存, 转换为 MB
    let ram_mb = process.map(|p| p.memory() as f64 / 1024.0 / 1024.0).unwrap_or(0.0);

    // VRAM: 通过 nvidia-smi compute apps 获取 per-process 显存
    let vram_mb = get_process_vram(pid);  // 5s 缓存

    Ok(ProcessResource { pid, cpu, ram_mb, vram_mb })
}

fn get_process_vram(pid: u32) -> f64 {
    // 5 秒缓存机制 — 避免频繁调用 nvidia-smi
    if cache_valid() { return cached_map.get(pid).unwrap_or(0.0); }

    let output = Command::new("nvidia-smi")
        .args(&["--query-compute-apps=pid,used_memory", "--format=csv,noheader,nounits"])
        .output();

    // 解析 "pid, xxx" → HashMap<pid, f64>
    // 失败或无 NVIDIA 驱动 → 0.0

    update_cache();
    result
}
```

> **VRAM 限制说明:**
> - 当前实现为 NVIDIA compute apps 的 per-process VRAM 检测，按 PID 匹配实例
> - Windows NVIDIA: 使用 `nvidia-smi` CLI (首选方案)
> - AMD / Intel / macOS: 暂不支持 VRAM 监控 (返回 0)
> - 如果进程未出现在 `nvidia-smi --query-compute-apps` 结果中，该实例显存显示 0

### 进程停止

```rust
pub fn stop_instance(pid: u32) -> Result<(), String> {
    #[cfg(windows)]
    {
        // 直接终止进程 (Job Object 会自动清理子进程)
        let handle = OpenProcess(PROCESS_TERMINATE, false, pid)?;
        TerminateProcess(handle, 1);
    }
    #[cfg(not(windows))]
    {
        Command::new("kill").arg("-9").arg(pid).output();
    }
    Ok(())
}
```

> 不使用 SIGTERM → SIGKILL 渐进式终止。直接 TerminateProcess 因为:
> 1. Job Object 已确保所有子进程会被自动回收
> 2. llama.cpp server 没有 graceful shutdown HTTP 端点集成
> 3. 用户期望停止时立即生效

### 配置持久化

```rust
// settings.rs

fn get_config_dir() -> PathBuf {
    dirs::config_dir().unwrap_or_default().join("llama-cpp-manager")
}

fn get_configs_path() -> PathBuf {
    get_config_dir().join("configs.json")
}

fn get_app_config_path() -> PathBuf {
    get_config_dir().join("app-config.json")
}

// 原子写入: tmp + rename (防止崩溃导致数据损坏)
pub fn save_configs(configs: &[LlamaConfig]) -> Result<(), String> {
    ensure_config_dir()?;
    let json = serde_json::to_string_pretty(configs)?;
    let tmp_path = path.with_extension("json.tmp");
    fs::write(&tmp_path, &json)?;     // 写入临时文件
    fs::rename(&tmp_path, &path)?;     // 原子重命名
    Ok(())
}
```

> **原子写入:** 先写入 `.tmp` 后缀文件再 rename，防止写入过程中崩溃导致 JSON 损坏。

### Job Object (Windows 进程生命周期管理)

```rust
// main.rs 中创建全局 Job Object
fn create_job_object() -> Result<isize, String> {
    let job_name = "llama-cpp-manager-llama-jobs";
    let handle = CreateJobObjectW(None, PCWSTR(job_name.as_ptr()))?;

    let info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
        BasicLimitInformation: {
            LimitFlags = JOB_OBJECT_LIMIT_BREAKAWAY_OK        // 子进程可以跳出
                | JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK       // 静默跳出
                | JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,        // 应用退出时终止所有
        },
    };
    SetInformationJobObject(handle, JobObjectExtendedLimitInformation, &info)?;

    Ok(handle.0 as isize)
}
```

**Job Object 属性:**

| 标志 | 效果 |
|---|---|
| `BREAKAWAY_OK` | Job 中的进程可以创建不属于该 Job 的子进程 |
| `SILENT_BREAKAWAY` | 跳出时不显示警告对话框 |
| `KILL_ON_JOB_CLOSE` | Job 对象关闭时 (应用退出), 所有进程被强制终止 |

**注册时机:** Tauri `.setup()` 回调中，窗口初始化之前

**关闭时机:** `quit_app` command 中，`app.exit(0)` 之前

---

## 前端详细设计

### 页面布局 (Master-Detail 模式)

```
┌─────────────────────────────────────────────────────────────────┐
│ Header: [Logo]              [语言切换] [主题切换] [路径设置]    │
├──────────┬──────────────────────────────────────────────────────┤
│ Sidebar  │  Detail View                                        │
│          │                                                     │
│ ➕ 新建  │  ┌───────────────────────────────────────────────┐  │
│          │  │ 空状态 (未选中配置)                            │  │
│ ─────────│  │ 选择一个配置查看详情，或新建配置开始使用       │  │
│ 📦 llama │  └───────────────────────────────────────────────┘  │
│   ● 运行 │                                                     │
│          │  ┌───────────────────────────────────────────────┐  │
│ 📦 mistral│  │ [选中配置: llama-7b-q4 (PID: 1234)]          │  │
│   ● 运行 │  │ ──────────────────────────────────────────── │  │
│          │  │ 模型: gguf/model.gguf | 线程: 16 | 上下文: 8K │  │
│ 📦 kodex  │  │ [▶ 启动] [⏹ 停止] [✏️ 编辑]                 │  │
│   ⏸ 停止 │  │ ──────────────────────────────────────────── │  │
│          │  │ [运行中]                                       │  │
│ ⚙️ 设置  │  │ 📜 实时日志 (滚动区域)                        │  │
│          │  │ 📊 CPU 12% | 内存 4.2G | 显存 6.1G          │  │
│          │  │ 🈳 资源趋势折线图                             │  │
│          │  └───────────────────────────────────────────────┘  │
├──────────┴──────────────────────────────────────────────────────┤
│ Status Bar: 2 个实例运行中                                      │
└─────────────────────────────────────────────────────────────────┘
```

**交互规则:**
- 首次进入: 右侧显示空状态提示
- 点击左侧配置: 右侧显示参数摘要 (未运行) 或运行信息 (已运行)
- 运行中的配置: 默认显示运行信息面板 (日志 + 资源)
- 多实例同时运行: 每个配置独立管理，互不干扰
- 底部状态栏: 仅显示运行实例数 `N 个实例运行中`

### 核心交互流程

**1. 新建配置**
- 点击 "新建" → 右侧滑入配置编辑器抽屉 (Framer Motion, 300ms spring)
- 先设置 llama.cpp 路径 (下拉/搜索/手动选择)
- 参数区域按分类折叠显示，每参数有启用开关
- 悬停显示参数解释 (ParamTooltip)
- 保存 → `saveConfig()` → Zustand store 更新 + 左侧 Sidebar 刷新

**2. 编辑配置**
- 点击左侧配置 → 右侧 DetailView 显示参数摘要
- 点击 "编辑" → 打开编辑器抽屉，预填已有参数
- 支持复制配置 (`duplicate_config`) → 快速创建参数变体

**3. 启动配置**

```typescript
// useInstances.ts
const startInstance = async (configId: string) => {
    // 1. 前端乐观创建 (立即显示 "starting" 状态)
    const instanceId = createInstance(configId);

    // 2. 调用 Tauri command, instanceId 必须传给后端用于事件 topic
    const { pid, command } = await invoke("start_instance", { configId, instanceId });

    // 3. 更新状态
    updateStatus(instanceId, "running");
    updatePid(instanceId, pid);
    updateCommand(instanceId, command);
};
```

**前端事件监听 (关键!):**

```typescript
// 在组件 mounted 时注册
useEffect(() => {
    // 日志事件: instance:{id}:log → { line, type }
    app.listen(`instance:${instanceId}:log`, (event: Event<{line: string, type: string}>) => {
        appendLog(instanceId, event.payload.line);
    });

    // 退出事件: instance:{id}:exited → { code }
    app.listen(`instance:${instanceId}:exited`, async (event) => {
        updateStatus(instanceId, "stopped");
    });

    return () => { /* cleanup listeners */ };
}, [instanceId]);
```

**4. 停止实例**
- DetailView 点击 "停止" → `stopInstance(instanceId)`
- 调用 `invoke("stop_instance_cmd", { pid })`
- Job Object 自动终止进程及其子进程
- 前端收到 exited event → 更新为 "stopped"

**5. 资源轮询**

```typescript
// 实例运行时启动轮询 (1s 间隔)
useEffect(() => {
    if (instance.status !== "running") return;

    const interval = setInterval(async () => {
        const resource = await invoke<ProcessResource>("get_process_resource_cmd", { pid: instance.pid });
        updateResource(instanceId, resource);
        addHistoryPoint(instanceId, resource);
    }, 1000);

    return () => clearInterval(interval);
}, [instanceId, instance.pid]);
```

### 动画设计 (Framer Motion)

| 场景 | 动画 | 时长 |
|---|---|---|
| 左侧配置项选中切换 | background highlight slide | 200ms |
| 右侧 DetailView 内容切换 | fade in + slide left | 250ms |
| 参数区域展开/折叠 | height spring animation | 300ms |
| 编辑器抽屉进出 | slide from right/left | 300ms spring |
| 启动按钮点击 | scale 0.95 → 1.0 + 脉冲环 | 150ms |
| 运行中状态指示 | 绿色脉冲圆点 | 无限循环 |
| 日志新行出现 | fade in | 100ms |
| 资源图表数据更新 | 平滑过渡 | 300ms |
| 主题切换 | 全局颜色渐变 | 400ms |

### 主题系统

```
ThemeProvider (React Context)
├── theme: AppTheme = "system" | "light" | "dark"
├── effectiveTheme: "light" | "dark"  (考虑 system 模式)
└── applyTheme(): 设置 document.documentElement.classList.toggle("dark", isDark)

ThemeToggle: 循环切换 system → dark → light → system
```

**applyTheme 逻辑:**
```typescript
const isDark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
document.documentElement.classList.toggle("dark", isDark);
```

### i18n 方案

```typescript
// useI18n.ts hook
const { t, i18n } = useTranslation();

const changeLanguage = async (lang: string) => {
    i18n.changeLanguage(lang);           // 即时切换 UI
    await invoke("set_language", { lang });  // 持久化到后端
};
```

**翻译文件结构:**
```
src/i18n/locales/
├── en/translation.json   # 英文 (基准)
└── zh/translation.json   # 中文覆盖
```

> i18next 以英文为基准资源，中文翻译文件只包含需要覆盖的键值对。

---

## 前端 Store 设计

### ConfigStore

```typescript
interface ConfigStore {
  configs: LlamaConfig[];       // 所有配置列表
  activeConfigId: string | null; // 当前选中的配置 ID
  addInstance: (inst: RunningInstance) => void;
  // ... CRUD actions
}
```

### InstanceStore

```typescript
interface InstanceStore {
  instances: Map<string, RunningInstance>;  // instanceId → RunningInstance

  addInstance: (instance: RunningInstance) => void;
  updateStatus: (instanceId, status) => void;
  updatePid: (instanceId, pid) => void;
  updateCommand: (instanceId, command) => void;
  appendLog: (instanceId, line: string) => void;       // 截断至 1000 行
  updateResource: (instanceId, resource) => void;
  addHistoryPoint: (instanceId, point) => void;        // 截断至 120 个点
  removeInstance: (instanceId) => void;
  getRunningCount: () => number;                       // 用于全局状态栏
}
```

> 使用 `Map` 而非 `Array` 因为实例操作以 `instanceId` 为 key，Map 的 O(1) 查找更适合。

---

## 前端 Hooks 设计

### `useConfigs()` — 配置管理

```typescript
function useConfigs() {
    const configs = useConfigStore(s => s.configs);
    const refresh = useCallback(async () => {
        const result = await invoke<LlamaConfig[]>("get_configs");
        loadConfigs(result);
    }, []);
    return { configs, refresh, ... };
}
```

### `useInstances()` — 实例管理

```typescript
function useInstances() {
    const createInstance = useCallback((configId: string): string => { ... }, []);
    const startInstance = useCallback(async (configId: string) => { ... }, []);
    const stopInstance = useCallback(async (instanceId: string) => { ... }, []);
    return { createInstance, startInstance, stopInstance };
}
```

### `useI18n()` — 国际化

```typescript
function useI18n() {
    const { t, i18n } = useTranslation();
    const changeLanguage = useCallback(async (lang: string) => { ... }, [i18n]);
    return { t, changeLanguage, language: i18n.language };
}
```

---

## 实现步骤

### Phase 1: 项目初始化 (1-2h)
1. `npm create tauri-app -- --template react-ts` 创建项目骨架
2. 安装依赖: shadcn/ui, tailwind, framer-motion, i18next, zustand, recharts
3. 配置 Tailwind + shadcn/ui
4. 搭建目录结构 (src/, src-tauri/)
5. 实现 i18n 框架 (中英文切换)
6. 实现主题系统 (ThemeProvider + ThemeToggle)

### Phase 2: 后端核心 (2-3h)
1. 定义 Rust 数据模型 (`LlamaConfig`, `InstanceInfo`, `ProcessResource`)
2. 实现 `settings.rs` (配置读写, 原子写入)
3. 实现配置 CRUD Tauri commands
4. 实现 `process_mgr.rs` (进程启动, Job Object, 日志流)
5. 实现 `ipc.rs` (资源监控, 路径检测)
6. 集成 `rust-toolchain.toml` + `Cargo.toml` 依赖

### Phase 3: 前端 - 配置管理 (3-4h)
1. 实现 Layout 布局 (Header + Sidebar + DetailView)
2. 实现 Sidebar + ConfigItem (配置列表 + 状态指示)
3. 实现 DetailView (参数摘要展示 / 空状态)
4. 实现 ConfigEditor (参数编辑器抽屉, 分类折叠)
5. 实现 ParamField + ParamTooltip
6. 实现 `useConfigs()` hook + Zustand store 联动
7. 添加 Framer Motion 动画

### Phase 4: 前端 - 实例监控 (3-4h)
1. 实现 `useInstances()` hook
2. 实现 Tauri 事件监听 (日志推送 + 退出通知)
3. 实现 DetailView 运行模式 (日志 + 资源图表)
4. 实现 LiveLog (实时日志组件, 自动滚动)
5. 实现 ResourceMonitor (CPU/内存/显存卡片)
6. 实现 ResourceChart (Recharts 折线图, 1s 轮询)
7. 实现资源轮询逻辑 (实例运行时自动启动)
8. 实现 GlobalStatusBar (运行实例数汇总)

### Phase 5: 打磨与测试 (2-3h)
1. 完善所有参数的 i18n 翻译 (50+ 参数)
2. 补充动画细节 (hover, focus, loading states)
3. 暗色主题完整适配
4. 实际 llama.cpp 进程启动测试
5. 多实例并发运行测试
6. 修复 bug, 性能优化
7. Tauri 打包 (Windows .exe)

---

## 关键文件清单

| 文件 | 用途 | 重要性 |
|---|---|---|
| `src-tauri/src/main.rs` | Tauri 入口, command 注册, 托盘, 窗口事件 | 核心 |
| `src-tauri/src/settings.rs` | 配置持久化 (configs + app-config, 原子写入) | 核心 |
| `src-tauri/src/process_mgr.rs` | 进程管理 (Job Object, 启动/停止, 日志流) | 核心 |
| `src-tauri/src/ipc.rs` | Tauri command 实现 + 资源共享 (资源监控/路径检测) | 核心 |
| `src/components/ConfigEditor.tsx` | 参数编辑器 (核心交互) | 高 |
| `src/components/DetailView.tsx` | 右侧详情区 (参数/运行视图切换) | 高 |
| `src/components/ConfigItem.tsx` | 左侧配置项 (状态指示) | 高 |
| `src/components/LiveLog.tsx` | 实时日志显示 | 高 |
| `src/components/ResourceChart.tsx` | 资源趋势折线图 | 高 |
| `src/components/ThemeToggle.tsx` | 主题切换按钮 | 中 |
| `src/hooks/useConfigs.ts` | 配置管理 hook | 高 |
| `src/hooks/useInstances.ts` | 实例管理 hook | 高 |
| `src/hooks/useI18n.ts` | 国际化 hook | 高 |
| `src/stores/instanceStore.ts` | 实例状态 (Map, 日志截断, 历史点) | 高 |
| `src/types/llama-params.ts` | 类型定义 (ParamDef, LlamaConfig, RunningInstance) | 核心 |
| `src/contexts/ThemeProvider.tsx` | 主题上下文 | 中 |

---

## 验证方案

1. **配置管理**: 创建/编辑/删除/复制配置 → JSON 文件验证, 原子写入测试 (写入中 kill 进程, 文件不损坏)
2. **路径三级策略**: 配置级路径 → 全局路径 → 自动检测, 优先级正确
3. **参数生效**: 启动配置 → 检查实际命令行参数是否正确构建
4. **日志流**: 启动 llama.cpp → 实时日志是否通过 Tauri event 正确推送
5. **资源监控**: 启动实例 → CPU/RAM 数据是否通过 sysinfo 正确更新
6. **VRAM 监控**: 有 NVIDIA GPU → nvidia-smi 解析是否正确, 5s 缓存是否生效
7. **多实例并发**: 同时运行多个配置 → 各自日志/资源独立
8. **进程回收**: 应用退出 → Job Object 自动终止所有子进程
9. **停止进程**: 点击停止 → 进程是否正确终止
10. **语言切换**: 切换语言 → 所有文本即时切换, 设置持久化
11. **主题切换**: 切换主题 → document.documentElement.classList 正确更新
12. **打包**: `tauri build` → 生成 Windows .exe 可执行文件
13. **托盘**: 托盘菜单 Show/Quit 功能正常

---

## 已知限制与取舍

| 项目 | 限制 | 原因 |
|---|---|---|
| VRAM 监控 | 仅 NVIDIA compute apps per-process, 其他环境返回 0 | 跨平台 VRAM API 不可用 |
| AMD GPU | 不支持 VRAM 监控 | nvidia-smi 仅支持 NVIDIA |
| macOS/Linux | Job Object 不可用 | Windows 专有 API |
| 下载 llama.cpp | 未实现 | ZIP 解压 + GitHub API 解析复杂度高, 暂缓 |
| tokio "full" | 不使用 full feature | 减少二进制体积, 按需启用 feature |
| 日志保留 | 最多 1000 行 | 防止内存无限增长 |
| 历史数据 | 最多 120 个点 | 约 2 分钟图表窗口 |
| graceful shutdown | 不使用 SIGTERM | llama.cpp server 无 graceful HTTP 端点 |
| 配置路径 | 不自动搜索 .gguf 模型文件 | 用户手动选择, 避免扫描慢目录 |
