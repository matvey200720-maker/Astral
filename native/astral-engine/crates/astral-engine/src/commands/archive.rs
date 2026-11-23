//! Группа «Архивы и установка»: 32 команды над архивами `.rpf`.
//!
//! Модуль только называет команды: что каждая делает, лежит в `crate::archives`.
//! Имя команды и порядок строк — часть контракта с мостом приложения.

use super::Command as Row;
use crate::archives as handlers;

/// Собирает список строк реестра из пар «имя команды => обработчик».
macro_rules! registry {
    ($($name:literal => $handler:path),+ $(,)?) => {
        &[$(Row::new($name, $handler)),+]
    };
}

pub const COMMANDS: &[Row] = registry! {
    "validate-rpf-patch" => handlers::patch::validate_rpf_patch,
    "install-rpf-patch" => handlers::install::install_rpf_patch,
    "compose-rpf" => handlers::compose::compose_rpf,
    "describe-archive" => handlers::flags::describe_archive,
    "probe-rpf" => handlers::probe::probe_rpf,
    "search-rpf" => handlers::search::search_rpf,
    "extract-rpf" => handlers::extract::extract_rpf,
    "extract-many-rpf" => handlers::extract::extract_many_rpf,
    "inspect-ytd" => handlers::ytd::inspect_ytd,
    "inspect-ypt" => handlers::ypt::inspect_ypt,
    "restore-rpf-point" => handlers::restore::restore_rpf_point,
    "read-archive-file" => handlers::listing::read_archive_file,
    "list-archive-entries" => handlers::listing::list_archive_entries,
    "index-archive" => handlers::index::index_archive,
    "extract-archive-entries" => handlers::index::extract_archive_entries,
    "extract-sky-textures" => handlers::textures::extract_sky_textures,
    "extract-cloud-hats" => handlers::cloud::extract_cloud_hats,
    "extract-map-tiles" => handlers::textures::extract_map_tiles,
    "scan-preview-textures" => handlers::textures::scan_preview_textures,
    // Установка на Rust, этапы 2 и 3 (внесены 15.11.2026): дозапись, слои, новый
    // dlc-архив, разбор журналов. Приложение их пока не зовёт; у каждой свой
    // выключатель процесса (`ASTRAL_ENGINE_APPEND`, `_LAYERS`, `_NEWDLC`).
    "append-rpf" => handlers::append::append_rpf,
    "rollback-rpf-append" => handlers::append::rollback_rpf_append,
    "recover-rpf-append" => handlers::append::recover_rpf_append,
    "repair-rpf" => handlers::repair::repair_rpf,
    "switch-rpf-layers" => handlers::layers::switch_rpf_layers,
    "layout-rpf-plan" => handlers::newdlc::layout_rpf_plan,
    "build-rpf-dlc" => handlers::newdlc::build_rpf_dlc,
    "seal-rpf-dlc" => handlers::newdlc::seal_rpf_dlc,
    "cancel-rpf-dlc" => handlers::newdlc::cancel_rpf_dlc,
    "verify-rpf-dlc" => handlers::newdlc::verify_rpf_dlc,
    "release-rpf-dlc" => handlers::newdlc::release_rpf_dlc,
    "settle-rpf-journals" => handlers::settle::settle_rpf_journals,
    // 20.11.2026: хвост архива верхнего уровня (запас после последней записи), `docs/handoff/RPF-NESTED-TAIL.md`.
    "tail-rpf" => handlers::tail::tail_rpf,
};

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::find;
    use crate::progress::Progress;
    use crate::run;

    /// Имя команды и то, чего она требует первым, если вызвать её без параметров
    /// (примеры Аз1-Аз19 описания).
    const FIRST_DEMAND: [(&str, &str); 32] = [
        ("validate-rpf-patch", "--patch"),
        ("install-rpf-patch", "--game-root"),
        ("compose-rpf", "--request"),
        ("describe-archive", "--input"),
        ("probe-rpf", "--request"),
        ("search-rpf", "--request"),
        ("extract-rpf", "--request"),
        ("extract-many-rpf", "--request"),
        ("inspect-ytd", "--input"),
        ("inspect-ypt", "--input"),
        ("restore-rpf-point", "--restore-point"),
        ("read-archive-file", "--game-root"),
        ("list-archive-entries", "--game-root"),
        ("index-archive", "--input"),
        ("extract-archive-entries", "--input"),
        ("extract-sky-textures", "--game-root"),
        ("extract-cloud-hats", "--game-root"),
        ("extract-map-tiles", "--game-root"),
        ("scan-preview-textures", "--game-root"),
        ("append-rpf", "--request"),
        ("rollback-rpf-append", "--request"),
        ("recover-rpf-append", "--request"),
        ("repair-rpf", "--request"),
        ("switch-rpf-layers", "--request"),
        ("layout-rpf-plan", "--request"),
        ("build-rpf-dlc", "--request"),
        ("seal-rpf-dlc", "--request"),
        ("cancel-rpf-dlc", "--request"),
        ("verify-rpf-dlc", "--request"),
        ("release-rpf-dlc", "--request"),
        ("settle-rpf-journals", "--request"),
        ("tail-rpf", "--input"),
    ];

    fn call(words: &[&str]) -> (String, i32) {
        let argv: Vec<String> = words.iter().map(|word| (*word).to_owned()).collect();
        let outcome = run(&argv, &Progress::silent());
        (outcome.line, outcome.exit_code)
    }

    fn argument_refusal(message: &str) -> String {
        format!(r#"{{"ok":false,"error":{{"code":"ArgumentException","message":"{message}"}}}}"#)
    }

    #[test]
    fn the_list_has_thirty_two_rows_in_the_documented_order() {
        let names: Vec<&str> = COMMANDS.iter().map(|command| command.name).collect();
        let expected: Vec<&str> = FIRST_DEMAND.iter().map(|(name, _)| *name).collect();
        assert_eq!(names, expected);
    }

    #[test]
    fn every_name_is_found_and_reaches_its_handler() {
        for (name, demand) in FIRST_DEMAND {
            assert!(find(name).is_some(), "{name}");
            assert_eq!(
                call(&[name]),
                (argument_refusal(&format!("{demand} is required.")), 1),
                "{name}"
            );
        }
    }

    #[test]
    fn the_name_is_trimmed_and_lowercased_before_the_search() {
        let shouted = "  Extract-Many-RPF\t";
        assert_eq!(
            call(&[shouted]),
            (argument_refusal("--request is required."), 1)
        );
    }

    #[test]
    fn names_that_are_not_registered_stay_unknown() {
        for name in [
            "read-archive-files",
            "validate-rpf",
            "extract-archive",
            "describe-rpf",
        ] {
            assert!(find(name).is_none(), "{name}");
            assert_eq!(
                call(&[name]),
                (
                    argument_refusal(&format!("Unsupported native command: {name}")),
                    1
                )
            );
        }
    }

    #[test]
    fn the_registry_check_catches_a_swapped_row() {
        // Отрицательный контроль: порядок строк — часть контракта.
        let mut swapped: Vec<&str> = COMMANDS.iter().map(|command| command.name).collect();
        swapped.swap(0, 1);
        assert_ne!(swapped[0], FIRST_DEMAND[0].0);
    }
}
