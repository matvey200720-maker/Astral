//! Каталоги, которые команда создала ради своего выхода: при отказе они убираются, пока пусты.
//!
//! Выход создаёт каталог раньше, чем команда проверит запрос, и отказ оставлял за собой пустую папку (у `compile-emblem-plates`
//! из-за неё повторный запуск проходил: «папка пуста»). Страж запоминает, каких каталогов на пути ещё нет, и при выходе
//! из команды без `keep` удаляет их, самый глубокий первым. `remove_dir` не трогает непустое, поэтому созданное,
//! куда уже что-то записано, остаётся.

use std::fs;
use std::path::{Path, PathBuf};

use crate::error::Result;
use crate::paths;

pub(super) struct FreshDirs {
    /// Отсутствующие каталоги пути, самый глубокий первым.
    absent: Vec<PathBuf>,
    armed: bool,
}

impl FreshDirs {
    /// Выход — файл: следят за каталогом рядом с ним и за его отсутствующими предками.
    /// Параметр — то, что вернул `options.required("output")`: нет параметра — следить не за чем.
    pub(super) fn beside(output: Result<&str>) -> Self {
        Self::of(output, |path| path.parent().map(Path::to_path_buf))
    }

    /// Выход — папка: следят за ней самой и за её отсутствующими предками.
    pub(super) fn at(output: Result<&str>) -> Self {
        Self::of(output, |path| Some(path.to_path_buf()))
    }

    fn of(output: Result<&str>, watched: impl Fn(&Path) -> Option<PathBuf>) -> Self {
        let absent = output
            .ok()
            .and_then(|text| paths::full_path(text).ok())
            .and_then(|path| watched(&path))
            .map(|dir| {
                dir.ancestors()
                    .take_while(|ancestor| !ancestor.exists())
                    .map(Path::to_path_buf)
                    .collect()
            })
            .unwrap_or_default();
        Self {
            absent,
            armed: true,
        }
    }

    /// Один страж за несколько выходов: общие каталоги не отдаются двум стражам, убирается всё, самое глубокое первым.
    pub(super) fn merged(parts: impl IntoIterator<Item = FreshDirs>) -> Self {
        let mut absent: Vec<PathBuf> = Vec::new();
        for mut part in parts {
            part.armed = false;
            absent.append(&mut part.absent);
        }
        absent.sort_by_key(|dir| std::cmp::Reverse(dir.components().count()));
        absent.dedup();
        Self {
            absent,
            armed: true,
        }
    }

    /// Команда дошла до результата: созданное остаётся.
    pub(super) fn keep(mut self) {
        self.armed = false;
    }
}

impl Drop for FreshDirs {
    fn drop(&mut self) {
        if self.armed {
            for dir in &self.absent {
                let _ = fs::remove_dir(dir);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(path: &Path) -> String {
        path.display().to_string()
    }

    #[test]
    fn a_refusal_removes_the_directories_it_watched_deepest_first() {
        let lab = tempfile::tempdir().unwrap();
        let output = lab.path().join("a/b/c/out.awc");
        {
            let _fresh = FreshDirs::beside(Ok(&text(&output)));
            fs::create_dir_all(output.parent().unwrap()).unwrap();
        }
        assert!(!lab.path().join("a").exists());
        assert!(lab.path().exists());
    }

    #[test]
    fn a_folder_output_is_watched_with_itself() {
        let lab = tempfile::tempdir().unwrap();
        let folder = lab.path().join("x/y");
        {
            let _fresh = FreshDirs::at(Ok(&text(&folder)));
            fs::create_dir_all(&folder).unwrap();
        }
        assert!(!lab.path().join("x").exists());
    }

    #[test]
    fn a_kept_result_and_a_nonempty_folder_stay() {
        let lab = tempfile::tempdir().unwrap();
        let kept = lab.path().join("kept/out.awc");
        let fresh = FreshDirs::beside(Ok(&text(&kept)));
        fs::create_dir_all(kept.parent().unwrap()).unwrap();
        fresh.keep();
        assert!(lab.path().join("kept").is_dir());

        let busy = lab.path().join("busy/out.awc");
        {
            let _fresh = FreshDirs::beside(Ok(&text(&busy)));
            fs::create_dir_all(busy.parent().unwrap()).unwrap();
            fs::write(busy.parent().unwrap().join("left.txt"), b"x").unwrap();
        }
        assert!(lab.path().join("busy/left.txt").is_file());
    }

    #[test]
    fn a_merged_guard_removes_shared_parents_after_their_children() {
        let lab = tempfile::tempdir().unwrap();
        let (first, second) = (
            lab.path().join("out/a/x.json"),
            lab.path().join("out/b/y.json"),
        );
        {
            let _fresh = FreshDirs::merged([
                FreshDirs::beside(Ok(&text(&first))),
                FreshDirs::beside(Ok(&text(&second))),
            ]);
            fs::create_dir_all(first.parent().unwrap()).unwrap();
            fs::create_dir_all(second.parent().unwrap()).unwrap();
        }
        assert!(!lab.path().join("out").exists());
    }

    #[test]
    fn directories_that_already_existed_are_never_touched() {
        let lab = tempfile::tempdir().unwrap();
        let existing = lab.path().join("there");
        fs::create_dir(&existing).unwrap();
        {
            let _fresh = FreshDirs::beside(Ok(&text(&existing.join("out.awc"))));
        }
        assert!(existing.is_dir());
        // Нет параметра или пустой путь: следить не за чем.
        let _none = FreshDirs::beside(Err(crate::error::EngineError::argument(
            "--output is required.",
        )));
        let _empty = FreshDirs::at(Ok(""));
    }
}
