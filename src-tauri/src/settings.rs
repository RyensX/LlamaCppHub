use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};

const CONFIG_DIR_NAME: &str = "llamacpphub";
const LEGACY_CONFIG_DIR_NAME: &str = "llama-cpp-manager";
const CONFIG_FILES: [&str; 2] = ["configs.json", "app-config.json"];

#[derive(Clone, Serialize, Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct CustomArg {
    pub id: String,
    pub enabled: bool,
    pub text: String,
}

#[derive(Clone, Serialize, Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct PreStartCommand {
    pub enabled: bool,
    pub command: String,
    pub continue_on_failure: bool,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LlamaConfig {
    pub id: String,
    pub name: String,
    pub llama_cpp_path: String,
    pub params: serde_json::Value,
    #[serde(default)]
    pub custom_args: Vec<CustomArg>,
    #[serde(default)]
    pub pre_start_command: PreStartCommand,
    pub created_at: u64,
    pub updated_at: u64,
    pub is_favorite: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub llama_cpp_path: Option<String>,
    pub language: String,
    pub theme: String,
}

fn base_config_dir() -> PathBuf {
    dirs::config_dir().unwrap_or_else(|| PathBuf::from("."))
}

fn get_config_dir() -> PathBuf {
    base_config_dir().join(CONFIG_DIR_NAME)
}

fn get_legacy_config_dir() -> PathBuf {
    base_config_dir().join(LEGACY_CONFIG_DIR_NAME)
}

pub fn migrate_legacy_config() -> std::io::Result<()> {
    migrate_config_dir(&get_legacy_config_dir(), &get_config_dir())
}

fn migrate_config_dir(old_dir: &Path, new_dir: &Path) -> std::io::Result<()> {
    let has_legacy_file = CONFIG_FILES.iter().any(|file_name| old_dir.join(file_name).exists());
    if !has_legacy_file {
        return Ok(());
    }

    fs::create_dir_all(new_dir)?;

    for file_name in CONFIG_FILES {
        let old_path = old_dir.join(file_name);
        let new_path = new_dir.join(file_name);
        if old_path.exists() {
            match OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&new_path)
            {
                Ok(mut dest) => {
                    let mut src = fs::File::open(&old_path)?;
                    io::copy(&mut src, &mut dest)?;
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(e) => return Err(e),
            }
        }
    }

    Ok(())
}

pub fn get_configs_path() -> PathBuf {
    get_config_dir().join("configs.json")
}

pub fn get_app_config_path() -> PathBuf {
    get_config_dir().join("app-config.json")
}

pub fn ensure_config_dir() -> std::io::Result<()> {
    fs::create_dir_all(get_config_dir())
}

pub fn load_configs() -> Vec<LlamaConfig> {
    let path = get_configs_path();
    if let Ok(content) = fs::read_to_string(&path) {
        if let Ok(configs) = serde_json::from_str(&content) {
            return configs;
        }
    }
    Vec::new()
}

pub fn save_configs(configs: &[LlamaConfig]) -> Result<(), String> {
    ensure_config_dir().map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(configs).map_err(|e| e.to_string())?;
    let path = get_configs_path();
    let tmp_path = path.with_extension("json.tmp");
    fs::write(&tmp_path, &json).map_err(|e| e.to_string())?;
    fs::rename(&tmp_path, &path).map_err(|e| e.to_string())
}

pub fn load_app_config() -> AppConfig {
    let path = get_app_config_path();
    if let Ok(content) = fs::read_to_string(&path) {
        if let Ok(config) = serde_json::from_str(&content) {
            return config;
        }
    }
    AppConfig {
        llama_cpp_path: None,
        language: "en".to_string(),
        theme: "system".to_string(),
    }
}

pub fn save_app_config(config: &AppConfig) -> Result<(), String> {
    ensure_config_dir().map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    let path = get_app_config_path();
    let tmp_path = path.with_extension("json.tmp");
    fs::write(&tmp_path, &json).map_err(|e| e.to_string())?;
    fs::rename(&tmp_path, &path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "llamacpphub-settings-test-{}-{}-{}",
            std::process::id(),
            name,
            nanos
        ))
    }

    #[test]
    fn migrate_config_dir_copies_legacy_files_without_overwriting_existing_files() {
        let root = test_dir("copy");
        let old_dir = root.join("llama-cpp-manager");
        let new_dir = root.join("llamacpphub");
        fs::create_dir_all(&old_dir).unwrap();
        fs::create_dir_all(&new_dir).unwrap();
        fs::write(old_dir.join("configs.json"), "legacy configs").unwrap();
        fs::write(old_dir.join("app-config.json"), "legacy app config").unwrap();
        fs::write(new_dir.join("app-config.json"), "current app config").unwrap();

        migrate_config_dir(&old_dir, &new_dir).unwrap();

        assert_eq!(
            fs::read_to_string(new_dir.join("configs.json")).unwrap(),
            "legacy configs"
        );
        assert_eq!(
            fs::read_to_string(new_dir.join("app-config.json")).unwrap(),
            "current app config"
        );
        assert_eq!(
            fs::read_to_string(old_dir.join("configs.json")).unwrap(),
            "legacy configs"
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn migrate_config_dir_does_nothing_when_no_legacy_files_exist() {
        let root = test_dir("empty");
        let old_dir = root.join("llama-cpp-manager");
        let new_dir = root.join("llamacpphub");
        fs::create_dir_all(&old_dir).unwrap();

        migrate_config_dir(&old_dir, &new_dir).unwrap();

        assert!(!new_dir.exists());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn llama_config_deserializes_old_json_without_new_fields() {
        let config: LlamaConfig = serde_json::from_value(serde_json::json!({
            "id": "cfg-1",
            "name": "Old Config",
            "llamaCppPath": "llama-server",
            "params": {},
            "createdAt": 1,
            "updatedAt": 2,
            "isFavorite": false
        }))
        .unwrap();

        assert!(config.custom_args.is_empty());
        assert!(!config.pre_start_command.enabled);
        assert!(config.pre_start_command.command.is_empty());
        assert!(!config.pre_start_command.continue_on_failure);
    }

    #[test]
    fn llama_config_deserializes_new_fields() {
        let config: LlamaConfig = serde_json::from_value(serde_json::json!({
            "id": "cfg-1",
            "name": "New Config",
            "llamaCppPath": "llama-server",
            "params": {},
            "customArgs": [
                { "id": "arg-1", "enabled": true, "text": "--foo bar" }
            ],
            "preStartCommand": {
                "enabled": true,
                "command": "echo ready",
                "continueOnFailure": true
            },
            "createdAt": 1,
            "updatedAt": 2,
            "isFavorite": true
        }))
        .unwrap();

        assert_eq!(config.custom_args.len(), 1);
        assert_eq!(config.custom_args[0].text, "--foo bar");
        assert!(config.pre_start_command.enabled);
        assert_eq!(config.pre_start_command.command, "echo ready");
        assert!(config.pre_start_command.continue_on_failure);
    }
}
