//! Рецепт сборки: всё, из чего движок собирает архив заново, и отпечаток
//! результата.
//!
//! Когда архив собирается сразу рядом с живым файлом (`install` с `before` и
//! `saveRecipe`), копии сборки в кэше нет. «Починить» после того, как лаунчер
//! Rockstar откатил архив, повторяет сборку по рецепту той же командой
//! (`install.useRecipe`) и сверяет отпечаток: байты те же или установка
//! отказывает до подмены. Рецепт — это запрос на сборку целиком (основа,
//! операции с источниками и их отпечатками, имя цели, издание) плюс отпечаток
//! и размер собранного. Файл целиком ASCII, как опись точки, и пишется
//! целиком или не пишется.

use std::{
    fs,
    path::{Path, PathBuf},
};

use serde_json::{json, Map, Value};

use super::{
    compose::{is_digest, Mode, Operation, Request},
    points,
};
use crate::{
    error::{EngineError, Result},
    response,
};

/// Версия формы рецепта.
pub const RECIPE_SCHEMA: u64 = 1;

/// Рецепт собранного архива.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Recipe {
    /// Путь архива в игре, который собирался (как задан в блоке установки).
    pub archive: String,
    /// Отпечаток результата, строчными.
    pub sha256: String,
    /// Размер результата.
    pub bytes: u64,
    pub mode: Mode,
    /// Основа сборки; `None` — собиралось поверх живого архива.
    pub base: Option<PathBuf>,
    pub archive_target: String,
    pub edition: Option<String>,
    pub allow_deletes: bool,
    pub operations: Vec<Operation>,
}

fn broken(what: &str) -> EngineError {
    EngineError::invalid_data(format!("Build recipe is invalid: {what}."))
}

impl Recipe {
    /// Рецепт запроса `request` и его результата.
    pub fn of(request: &Request, archive: &str, sha256: &str, bytes: u64) -> Recipe {
        Recipe {
            archive: archive.to_owned(),
            sha256: sha256.to_ascii_lowercase(),
            bytes,
            mode: request.mode,
            base: request.base.clone(),
            archive_target: request.archive_target.clone(),
            edition: request.edition.clone(),
            allow_deletes: request.allow_deletes,
            operations: request.operations.clone(),
        }
    }

    /// Запрос, который собирает этот рецепт: то, что рецепт хранит, подменяет
    /// одноимённые поля `request`, выход и служебная папка остаются его.
    pub fn apply(&self, request: &Request) -> Request {
        Request {
            mode: self.mode,
            base: self.base.clone(),
            archive_target: self.archive_target.clone(),
            edition: self.edition.clone(),
            allow_deletes: self.allow_deletes,
            operations: self.operations.clone(),
            ..request.clone()
        }
    }

    /// Текст рецепта: ASCII, ключи в порядке записи.
    pub fn text(&self) -> Result<String> {
        let mut document = Map::new();
        let rows = [
            ("schema", json!(RECIPE_SCHEMA)),
            ("archive", json!(self.archive)),
            ("sha256", json!(self.sha256)),
            ("bytes", json!(self.bytes)),
            ("mode", json!(self.mode.word())),
            (
                "baseArchive",
                self.base
                    .as_ref()
                    .map_or(Value::Null, |base| json!(base.to_string_lossy())),
            ),
            ("archiveTarget", json!(self.archive_target)),
            ("edition", json!(self.edition)),
            ("allowDeletes", json!(self.allow_deletes)),
            (
                "operations",
                Value::Array(self.operations.iter().map(Operation::to_json).collect()),
            ),
        ];
        document.extend(rows.map(|(key, value)| (key.to_owned(), value)));
        serde_json::to_string_pretty(&Value::Object(document))
            .map(|pretty| response::ascii_escape(&pretty))
            .map_err(|failure| EngineError::internal(failure.to_string()))
    }

    /// Кладёт рецепт в файл `path` целиком или не кладёт: временный файл рядом,
    /// сброс на диск, переименование поверх. Нет папки — создаётся.
    pub fn save(&self, path: &Path) -> Result<()> {
        let text = self.text()?;
        if let Some(folder) = path.parent() {
            fs::create_dir_all(folder)?;
        }
        let temporary = points::sibling_name(path, "tmp");
        let written = fs::write(&temporary, text.as_bytes())
            .and_then(|()| points::flush_to_disk(&temporary))
            .and_then(|()| points::rename_with_retry(&temporary, path));
        written.inspect_err(|_| drop(fs::remove_file(&temporary)))?;
        Ok(())
    }

    /// Читает рецепт; чужая или испорченная форма отказывает, ничего не меняя.
    pub fn load(path: &Path) -> Result<Recipe> {
        let bytes = match fs::read(path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Err(EngineError::file_not_found(format!(
                    "Build recipe does not exist: {}",
                    path.display()
                )))
            }
            Err(error) => return Err(error.into()),
        };
        let text = String::from_utf8_lossy(&bytes);
        let parsed: Value = serde_json::from_str(text.trim_start_matches('\u{feff}'))
            .map_err(|_| broken("not JSON"))?;
        let Value::Object(root) = parsed else {
            return Err(broken("not an object"));
        };
        if root.get("schema").and_then(Value::as_u64) != Some(RECIPE_SCHEMA) {
            return Err(broken("unknown schema"));
        }
        let text_of = |key: &str| root.get(key).and_then(Value::as_str);
        let sha256 = text_of("sha256")
            .filter(|digest| is_digest(digest))
            .ok_or_else(|| broken("no sha256"))?
            .to_ascii_lowercase();
        let archive = text_of("archive")
            .ok_or_else(|| broken("no archive"))?
            .to_owned();
        let mode = Mode::from_word(text_of("mode"))?;
        let mut operations = Vec::new();
        let listed = match root.get("operations") {
            Some(Value::Array(items)) => items,
            _ => return Err(broken("no operations")),
        };
        for item in listed {
            operations.push(Operation::from_json(item)?);
        }
        if operations.is_empty() {
            return Err(broken("no operations"));
        }
        let base = match root.get("baseArchive") {
            None | Some(Value::Null) => None,
            Some(Value::String(text)) => Some(PathBuf::from(text)),
            Some(_) => return Err(broken("base is not a path")),
        };
        Ok(Recipe {
            archive,
            sha256,
            bytes: root.get("bytes").and_then(Value::as_u64).unwrap_or(0),
            mode,
            base,
            archive_target: text_of("archiveTarget").unwrap_or_default().to_owned(),
            edition: text_of("edition").map(str::to_owned),
            allow_deletes: matches!(root.get("allowDeletes"), Some(Value::Bool(true))),
            operations,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::archives::compose::Action;
    use tempfile::tempdir;

    fn sample() -> Recipe {
        Recipe {
            archive: "update/update.rpf".to_owned(),
            sha256: "ab".repeat(32),
            bytes: 1234,
            mode: Mode::Compose,
            base: Some(PathBuf::from("C:\\кэш\\основа.rpf")),
            archive_target: "update:/update.rpf".to_owned(),
            edition: Some("Legacy".to_owned()),
            allow_deletes: true,
            operations: vec![
                Operation {
                    entry: "x64/a/a.ydd".to_owned(),
                    source: Some(PathBuf::from("C:\\store\\new.ydd")),
                    sha256: Some("cd".repeat(32)),
                    action: Action::Replace,
                    allow_delete: false,
                    allow_missing: false,
                },
                Operation {
                    entry: "x64/a/gone.ydd".to_owned(),
                    source: None,
                    sha256: None,
                    action: Action::Delete,
                    allow_delete: true,
                    allow_missing: true,
                },
            ],
        }
    }

    #[test]
    fn a_recipe_is_ascii_and_reads_back_the_same() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("recipes").join("one.recipe.json");
        let recipe = sample();
        recipe.save(&file).unwrap();
        let text = fs::read_to_string(&file).unwrap();
        assert!(text.is_ascii(), "{text}");
        assert!(text.starts_with("{\n  \"schema\": 1,\n  \"archive\": \"update/update.rpf\""));
        assert_eq!(Recipe::load(&file).unwrap(), recipe);
        assert!(
            !points::sibling_name(&file, "tmp").exists(),
            "временный файл убран"
        );
    }

    #[test]
    fn a_broken_recipe_is_refused_without_guessing() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("r.json");
        let good = sample().text().unwrap();
        let cases = [
            ("", "not JSON"),
            ("[]", "not an object"),
            (
                &good.replace("\"schema\": 1", "\"schema\": 2"),
                "unknown schema",
            ),
            (&good.replace(&"ab".repeat(32), "xyz"), "no sha256"),
            (&good.replace("\"operations\"", "\"ops\""), "no operations"),
        ];
        for (text, reason) in cases {
            fs::write(&file, text).unwrap();
            let error = Recipe::load(&file).unwrap_err();
            assert_eq!(
                error.message,
                format!("Build recipe is invalid: {reason}."),
                "{text}"
            );
        }
        let missing = Recipe::load(&dir.path().join("none.json")).unwrap_err();
        assert_eq!(missing.code, "FileNotFoundException");
    }
}
