//! `engine-info`: кто на том конце процесса и что он умеет.
//!
//! Список команд берётся из реестра при каждом вызове, поэтому ответ всегда совпадает с тем,
//! что зарегистрировано в группах.

use std::collections::BinaryHeap;

use serde_json::{Map, Value};

use super::Command;
use crate::{args::Options, error::Result, progress::Progress};

const COMMAND_NAME: &str = "engine-info";

/// Что про себя говорит движок: имя и версия пакета на момент сборки.
struct Identity;

impl Identity {
    const NAME: &'static str = "astral-engine";
    const VERSION: &'static str = env!("CARGO_PKG_VERSION");
}

pub const COMMANDS: &[Command] = &[Command::new(COMMAND_NAME, engine_info)];

/// Имена реестра по возрастанию байтов. Куча отдаёт их уже упорядоченными, повторы остаются:
/// записей в ответе ровно столько, сколько строк в реестре.
fn registered_names() -> Vec<&'static str> {
    let heap = super::all().fold(BinaryHeap::new(), |mut heap, command| {
        heap.push(command.name);
        heap
    });
    heap.into_sorted_vec()
}

/// Ответ как пары «ключ, значение» в порядке записи.
fn engine_info(_: &Options, _: &Progress) -> Result<Value> {
    let names = registered_names().into_iter().map(Value::from).collect();
    let pairs = [
        ("name", Value::from(Identity::NAME)),
        ("version", Value::from(Identity::VERSION)),
        ("commands", Value::Array(names)),
    ];
    let mut answer = Map::new();
    answer.extend(
        pairs
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value)),
    );
    Ok(Value::Object(answer))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::{all, find};
    use crate::run;
    use serde_json::json;

    /// Полный список из описания (раздел 6): имена всех 128 команд в порядке ответа.
    const FULL_LIST: &str = "append-rpf, awc-bank-scan, awc-inspect, awc-layer-from-wav, awc-stream-from-wav, awc-stream-patch, awc-stream-pcm, billboards-build, build-map-patch, build-rpf-dlc, build-wallbang-base, build-world-place-scene, cancel-rpf-dlc, compile-climb-markers, compile-emblem-plates, compile-interior-layout, compile-manifest, compile-mega-mall-overlay, compile-mlo-models, compile-place-types, compile-placements, compile-sign-models, compile-sky-clip, compile-sky-flyer, compile-sky-rainbow, compile-star-clip, compile-star-model, compile-timecycle-box, compose-rpf, convert-gen9, convert-model, convert-models, convert-scene, create-image-card, decorate-drawable, describe-archive, downscale-textures, encode-dds, engine-info, extract-archive-entries, extract-cloud-hats, extract-many-rpf, extract-map-tiles, extract-rpf, extract-sky-textures, extract-textures, graft-drawable, index-archive, inspect-interior-ymap, inspect-interior-ytyp, inspect-map-files, inspect-minimap-tiles, inspect-ypt, inspect-ytd, install-rpf-patch, lamp-archive-scan, lamp-inspect, lamp-lod-inspect-pair, lamp-lod-nearest, lamp-lod-patch, lamp-patch, lamp-plan, lamp-pole, lamp-studio-glass, lamp-studio-inspect, lamp-studio-lod, lamp-studio-patch, lamp-studio-ytyp, lamp-verify, layout-rpf-plan, list-archive-entries, minimap-tile-colours, pack-textures, paint-minimap-tiles, patch-animal-model, probe-rpf, read-archive-file, read-awc, read-combat-decals, read-model-ars2, read-ptfx-base, read-radar-geometry, read-uv-clips, read-workshop-textures, read-ypt-digest, read-ypt-evolutions, read-ypt-export, read-ypt-keyframes, read-ypt-rules, recover-rpf-append, release-rpf-dlc, rename-texture, repair-rpf, restore-rpf-point, restyle-drawable, restyle-model, roads-build, rollback-rpf-append, rpf-listing, running-processes, sample-anim-pose, sample-anim-track, scan-preview-textures, seal-rpf-dlc, search-rpf, settle-rpf-journals, shop-embed-textures, skin-from-body, split-sheet-surfaces, style-pixels, style-texture, switch-rpf-layers, tail-rpf, trim-memory, validate-rpf-patch, vegetation-build, verify-rpf-dlc, water-build, weapons-meta-tracer-patch, write-ypt-texture-patch, ycd-from-xml, ycd-roundtrip, ycd-summary, ypt-clone-export, ypt-own-donor, ypt-patch, ytd-texture-patch, ytd-texture-set";

    /// Чем должна кончиться командная строка.
    enum Expect {
        Info,
        Refusal(&'static str),
    }

    type Calls<'a> = &'a [(&'a [&'a str], Expect)];

    /// Имя находится после обрезки и приведения регистра, параметры принимаются любые (Дв1–Дв5, Дв11).
    const ACCEPTED: Calls = &[
        (&["engine-info"], Expect::Info),
        (&["Engine-Info"], Expect::Info),
        (&["  engine-info\t"], Expect::Info),
        (
            &[
                "engine-info",
                "--anything",
                "value",
                "--Other",
                "x",
                "--empty",
                "",
            ],
            Expect::Info,
        ),
        (&["engine-info", "--a=b", "c"], Expect::Info),
    ];

    /// Разбор параметров идёт раньше поиска команды (Дв6–Дв10, Дв17).
    const BROKEN_OPTIONS: Calls = &[
        (
            &["engine-info", "--broken"],
            Expect::Refusal("A value is required for --broken."),
        ),
        (
            &["engine-info", "--a", "--b"],
            Expect::Refusal("A value is required for --a."),
        ),
        (
            &["engine-info", "stray"],
            Expect::Refusal("Invalid native option: stray"),
        ),
        (
            &["engine-info", "--", "x"],
            Expect::Refusal("Invalid native option: --"),
        ),
        (
            &["engine-info", "-x", "y"],
            Expect::Refusal("Invalid native option: -x"),
        ),
        (
            &["no-such-command", "--x"],
            Expect::Refusal("A value is required for --x."),
        ),
    ];

    /// Нет команды или она неизвестна (Дв12–Дв19).
    const UNKNOWN: Calls = &[
        (&[], Expect::Refusal("A native command is required.")),
        (
            &["no-such-command"],
            Expect::Refusal("Unsupported native command: no-such-command"),
        ),
        (
            &["  No-Such-Command "],
            Expect::Refusal("Unsupported native command: no-such-command"),
        ),
        (&[""], Expect::Refusal("Unsupported native command: ")),
        (&["   "], Expect::Refusal("Unsupported native command: ")),
        (
            &["engine_info"],
            Expect::Refusal("Unsupported native command: engine_info"),
        ),
        (
            &["engine"],
            Expect::Refusal("Unsupported native command: engine"),
        ),
    ];

    fn call(words: &[&str]) -> (Value, i32) {
        let argv: Vec<String> = words.iter().map(|word| (*word).to_owned()).collect();
        let outcome = run(&argv, &Progress::silent());
        (
            serde_json::from_str(&outcome.line).unwrap(),
            outcome.exit_code,
        )
    }

    fn info() -> Value {
        json!({
            "ok": true,
            "command": "engine-info",
            "result": {
                "name": "astral-engine",
                "version": "0.1.0",
                "commands": registered_names(),
            },
        })
    }

    fn settle(table: Calls) {
        for (words, expect) in table {
            let expected = match expect {
                Expect::Info => (info(), 0),
                Expect::Refusal(message) => (
                    json!({
                        "ok": false,
                        "error": { "code": "ArgumentException", "message": message },
                    }),
                    1,
                ),
            };
            assert_eq!(call(words), expected, "{words:?}");
        }
    }

    #[test]
    fn the_name_is_cleaned_and_any_option_pairs_are_ignored() {
        settle(ACCEPTED);
    }

    #[test]
    fn broken_options_beat_the_command_lookup() {
        settle(BROKEN_OPTIONS);
    }

    #[test]
    fn missing_and_unknown_commands_are_named_lowercase_and_trimmed() {
        settle(UNKNOWN);
    }

    #[test]
    fn the_answer_line_keeps_the_key_order() {
        let argv = ["engine-info".to_owned()];
        let line = run(&argv, &Progress::silent()).line;
        let head = r#"{"ok":true,"command":"engine-info","result":{"name":"astral-engine","version":"0.1.0","commands":["#;
        assert!(line.starts_with(head), "{line}");
        assert!(line.ends_with("]}}"), "{line}");
    }

    #[test]
    fn the_registry_view_is_sorted_and_complete() {
        let listed = registered_names();
        let checks: [(&str, bool); 3] = [
            ("itself", listed.contains(&"engine-info")),
            ("one per row", listed.len() == all().count()),
            (
                "strictly ascending",
                listed.windows(2).all(|pair| pair[0] < pair[1]),
            ),
        ];
        for (what, holds) in checks {
            assert!(holds, "{what}");
        }
    }

    #[test]
    fn the_registry_view_stays_inside_the_documented_list_in_order() {
        let documented: Vec<&str> = FULL_LIST.split(", ").collect();
        assert_eq!(documented.len(), 128);
        assert!(documented.windows(2).all(|pair| pair[0] < pair[1]));
        // Песочница знает не все группы; всё, что знает, стоит в полном списке в том же порядке.
        let mut remaining = documented.iter();
        for name in registered_names() {
            assert!(remaining.any(|known| *known == name), "{name}");
        }
    }

    #[test]
    fn the_name_is_found_exactly_and_the_handler_ignores_its_options() {
        assert!(find("engine-info").is_some());
        assert!(find("ENGINE-INFO").is_none());
        let direct = engine_info(&Options::default(), &Progress::silent()).unwrap();
        assert_eq!(direct, info()["result"]);
    }

    #[test]
    fn a_changed_registry_would_change_the_answer() {
        // Отрицательный контроль: без самой команды список короче на одну запись.
        let without_self = registered_names()
            .into_iter()
            .filter(|name| *name != COMMAND_NAME);
        assert_eq!(without_self.count() + 1, all().count());
    }
}
