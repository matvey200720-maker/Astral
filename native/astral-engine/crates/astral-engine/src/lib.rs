//! Нативный движок Astral.

pub mod archives;
pub mod args;
pub mod awc_channel;
pub mod clock;
pub mod commands;
pub mod disk;
pub mod error;
pub mod failpoint;
pub mod http;
pub mod memory_limit;
pub mod model_textures;
pub mod paths;
pub mod progress;
pub mod readers;
pub mod response;
pub mod serve;
pub mod shelf;
#[cfg(test)]
mod test_support;
pub mod texture_levels;
pub mod texture_stages;

use std::{any::Any, panic};

use serde_json::Value;

use crate::args::Options;
use crate::commands::Command;
use crate::disk::apply_read_limit;
use crate::error::{EngineError, Result};
use crate::progress::Progress;
use crate::response::{failure, success};

/// Итог одной команды: строка ответа (без перевода строки, только ASCII) и
/// код выхода процесса.
#[derive(Debug, Clone)]
// ответы сравниваются целиком: их сверяют проверки и тесты
#[derive(PartialEq, Eq)]
pub struct Outcome {
    pub line: String,
    pub exit_code: i32,
}

/// Чем кончается процесс; число для каждого вида исхода назначено один раз.
#[derive(Clone, Copy)]
enum Exit {
    Done,
    Refused,
    Cancelled,
}

impl Exit {
    /// Код отказа, который процесс превращает в код выхода 130.
    const CANCEL_CODE: &'static str = "Cancelled";

    fn after(error: &EngineError) -> Exit {
        if error.code == Self::CANCEL_CODE {
            Exit::Cancelled
        } else {
            Exit::Refused
        }
    }

    const fn status(self) -> i32 {
        match self {
            Exit::Done => 0,
            Exit::Refused => 1,
            Exit::Cancelled => 130,
        }
    }
}

/// Всё, что решено до запуска: имя для ответа, параметры и найденная команда.
struct Launch {
    name: String,
    options: Options,
    command: &'static Command,
}

impl Launch {
    /// Порядок отказов: нет имени, плохие параметры, неизвестное имя. Потолок
    /// чтения ставится после разбора параметров и до поиска команды, поэтому
    /// и для неизвестного имени.
    fn resolve(argv: &[String]) -> Result<Launch> {
        let Some((head, rest)) = argv.split_first() else {
            return Err(EngineError::argument("A native command is required."));
        };
        // края без пробельных знаков Unicode, нижний регистр по полным правилам Unicode
        let name = head.trim().to_lowercase();
        let options = Options::parse(rest)?;
        apply_read_limit(&options);
        match crate::commands::find(&name) {
            Some(command) => Ok(Launch {
                command,
                options,
                name,
            }),
            None => Err(EngineError::argument(format!(
                "Unsupported native command: {name}"
            ))),
        }
    }
}

/// Текст причины паники: `&str` или `String`, иначе запасная фраза.
fn panic_message(cause: &(dyn Any + Send)) -> String {
    if let Some(text) = cause.downcast_ref::<&str>() {
        return String::from(*text);
    }
    match cause.downcast_ref::<String>() {
        Some(text) => text.clone(),
        None => String::from("unknown failure"),
    }
}

/// Вызов обработчика под перехватом паник: паника становится отказом.
fn invoke(command: &Command, options: &Options, progress: &Progress) -> Result<Value> {
    let guarded = panic::AssertUnwindSafe(|| (command.run)(options, progress));
    match panic::catch_unwind(guarded) {
        Ok(verdict) => verdict,
        Err(cause) => Err(EngineError::internal(panic_message(cause.as_ref()))),
    }
}

/// Любой исход превращается в строку ответа и код выхода.
fn finish(verdict: Result<(String, Value)>) -> Outcome {
    let (line, exit) = verdict
        .map(|(name, value)| (success(&name, value), Exit::Done))
        .unwrap_or_else(|error| (failure(&error), Exit::after(&error)));
    Outcome {
        line,
        exit_code: exit.status(),
    }
}

/// Выполняет одну команду целиком: `argv[0]` — имя, дальше пары `--имя значение`.
/// Отказ и паника команды остаются внутри и становятся ответом.
pub fn run(argv: &[String], progress: &Progress) -> Outcome {
    let verdict = Launch::resolve(argv).and_then(|launch| {
        let value = invoke(launch.command, &launch.options, progress)?;
        Ok((launch.name, value))
    });
    finish(verdict)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rage_rpf::fixtures::update_tree;
    use rage_rpf::{write_archive, WriteContext};
    use serde_json::json;
    use std::fs::{self, File};
    use std::panic::panic_any;
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};
    use tempfile::TempDir;

    fn argv(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|part| (*part).to_owned()).collect()
    }

    fn answer(parts: &[&str]) -> Outcome {
        run(&argv(parts), &Progress::silent())
    }

    fn refusal_line(code: &str, message: &str) -> String {
        format!(r#"{{"ok":false,"error":{{"code":"{code}","message":"{message}"}}}}"#)
    }

    fn argument_line(message: &str) -> String {
        refusal_line("ArgumentException", message)
    }

    fn assert_info(outcome: &Outcome) {
        assert_eq!(outcome.exit_code, 0, "{}", outcome.line);
        assert!(outcome.line.is_ascii());
        let parsed: Value = serde_json::from_str(&outcome.line).unwrap();
        assert_eq!(parsed["ok"], json!(true));
        assert_eq!(parsed["command"], json!("engine-info"));
        assert_eq!(parsed["result"]["name"], json!("astral-engine"));
        assert_eq!(
            parsed["result"]["version"],
            json!(env!("CARGO_PKG_VERSION"))
        );
        let listed: Vec<&str> = parsed["result"]["commands"]
            .as_array()
            .unwrap()
            .iter()
            .map(|name| name.as_str().unwrap())
            .collect();
        let mut registered: Vec<&str> = commands::all().map(|command| command.name).collect();
        registered.sort_unstable();
        assert_eq!(listed, registered);
        assert!(outcome.line.starts_with(
            r#"{"ok":true,"command":"engine-info","result":{"name":"astral-engine","#
        ));
    }

    #[test]
    fn a_known_command_is_found_by_any_spelling() {
        // Лп2 – Лп7, Лп27, Лп28
        let spellings = [
            "engine-info",
            "Engine-Info",
            "ENGINE-INFO",
            "  engine-info  ",
            "\tengine-info\r\n",
            "\u{a0}engine-info\u{2003}",
        ];
        for spelling in spellings {
            assert_info(&answer(&[spelling]));
        }
        assert_info(&answer(&["engine-info", "--a", "b", "--A", "c"]));
        assert_info(&answer(&["engine-info", "--a", ""]));
        assert_eq!(
            commands::all().count(),
            128,
            "в реестре этой сборки 128 команд"
        );
    }

    #[test]
    fn unknown_names_are_reported_normalized() {
        // Лп8 – Лп18, Лп21, Лп31, Лп33, Лп36
        let cases: [(&str, &str); 14] = [
            ("\u{feff}engine-info", "\\uFEFFengine-info"),
            ("teleport", "teleport"),
            ("  Teleport  ", "teleport"),
            ("Tele port", "tele port"),
            (
                "ТЕЛЕПОРТ",
                "\\u0442\\u0435\\u043B\\u0435\\u043F\\u043E\\u0440\\u0442",
            ),
            ("İSTANBUL", "i\\u0307stanbul"),
            (
                "ΟΔΥΣΣΕΥΣ",
                "\\u03BF\\u03B4\\u03C5\\u03C3\\u03C3\\u03B5\\u03C5\\u03C2",
            ),
            ("ẞ", "\\u00DF"),
            ("", ""),
            ("   ", ""),
            ("serve-not", "serve-not"),
            ("a\u{fffd}b", "a\\uFFFDb"),
            ("\u{fffd}X", "\\uFFFDx"),
            ("serve", "serve"),
        ];
        for (name, shown) in cases {
            let outcome = answer(&[name]);
            assert_eq!(outcome.exit_code, 1, "{name:?}");
            assert_eq!(
                outcome.line,
                argument_line(&format!("Unsupported native command: {shown}")),
                "{name:?}"
            );
        }
        let long = "x".repeat(30_000);
        let outcome = answer(&[&long]);
        assert_eq!(outcome.exit_code, 1);
        assert_eq!(outcome.line.len() + 1, 30_091, "со строкой LF в конце");
        assert!(outcome.line.ends_with(&format!("{long}\"}}}}")));
        let unknown = answer(&["teleport", "--a", "b"]);
        assert_eq!(
            unknown.line,
            argument_line("Unsupported native command: teleport")
        );
    }

    #[test]
    fn option_errors_beat_unknown_commands() {
        // Лп1, Лп19, Лп20, Лп22 – Лп26, Лп30, Лп32
        let missing = answer(&[]);
        assert_eq!(missing.line, argument_line("A native command is required."));
        assert_eq!(missing.exit_code, 1);
        let rows: [(&[&str], &str); 10] = [
            (&["teleport", "--to"], "A value is required for --to."),
            (&["teleport", "x"], "Invalid native option: x"),
            (&["engine-info", "x"], "Invalid native option: x"),
            (&["engine-info", "--a"], "A value is required for --a."),
            (
                &["engine-info", "--a", "--b"],
                "A value is required for --a.",
            ),
            (&["engine-info", "--"], "Invalid native option: --"),
            (&["engine-info", "-a", "b"], "Invalid native option: -a"),
            (
                &["  ENCODE-DDS  ", "--input"],
                "A value is required for --input.",
            ),
            (
                &["teleport", "--a", "b c", "--d"],
                "A value is required for --d.",
            ),
            (&["encode-dds"], "--input is required."),
        ];
        for (parts, message) in rows {
            let outcome = answer(parts);
            assert_eq!(outcome.exit_code, 1, "{parts:?}");
            assert_eq!(outcome.line, argument_line(message), "{parts:?}");
        }
        // Лп34: имя параметра с U+FFFD, Лп35: значение с U+FFFD
        let odd_name = answer(&["engine-info", "a\u{fffd}b"]);
        assert_eq!(
            odd_name.line,
            argument_line("Invalid native option: a\\uFFFDb")
        );
        assert_info(&answer(&["engine-info", "--a", "a\u{fffd}b"]));
        // Пн12 – Пн14
        assert_eq!(
            answer(&[""]).line,
            argument_line("Unsupported native command: ")
        );
        assert_eq!(
            answer(&["engine-info", "--a"]).line,
            argument_line("A value is required for --a.")
        );
    }

    #[test]
    fn outcome_derives_debug_clone_and_eq() {
        // Пн10, Пн11
        let outcome = answer(&["teleport"]);
        assert_eq!(
            format!("{outcome:?}"),
            r#"Outcome { line: "{\"ok\":false,\"error\":{\"code\":\"ArgumentException\",\"message\":\"Unsupported native command: teleport\"}}", exit_code: 1 }"#
        );
        assert_eq!(outcome.clone(), outcome);
        assert_eq!(
            format!("{outcome:#?}"),
            "Outcome {\n    line: \"{\\\"ok\\\":false,\\\"error\\\":{\\\"code\\\":\\\"ArgumentException\\\",\\\"message\\\":\\\"Unsupported native command: teleport\\\"}}\",\n    exit_code: 1,\n}"
        );
    }

    #[test]
    fn only_the_exact_cancelled_code_gives_130() {
        // От-С3 на уровне перевода отказа в код
        let cancelled = finish(Err(EngineError::cancelled()));
        assert_eq!(cancelled.exit_code, 130);
        assert_eq!(
            cancelled.line,
            refusal_line(
                "Cancelled",
                "\\u041E\\u0442\\u043C\\u0435\\u043D\\u0435\\u043D\\u043E."
            )
        );
        assert_eq!(
            finish(Err(EngineError::new("Cancelled", "other"))).exit_code,
            130
        );
        for code in ["cancelled", "Cancelled ", "CANCELLED", "InternalError", ""] {
            assert_eq!(
                finish(Err(EngineError::new(code, "m"))).exit_code,
                1,
                "{code:?}"
            );
        }
        let fine = finish(Ok(("Some-Name".to_owned(), json!({"k": 1}))));
        assert_eq!(fine.exit_code, 0);
        assert_eq!(
            fine.line,
            r#"{"ok":true,"command":"Some-Name","result":{"k":1}}"#
        );
    }

    // ----- паники команды -----

    fn silent_options() -> Options {
        Options::parse(&[]).unwrap()
    }

    fn panicking(command: &'static Command) -> Outcome {
        let verdict = invoke(command, &silent_options(), &Progress::silent());
        finish(verdict.map(|value| (command.name.to_owned(), value)))
    }

    fn internal_line(message: &str) -> String {
        refusal_line("InternalError", message)
    }

    #[test]
    fn panic_payloads_become_internal_errors() {
        // Пн1 – Пн7 на обработчиках-пустышках
        static LITERAL: Command = Command::new("boom", |_, _| panic!("boom-str"));
        static FORMATTED: Command = Command::new("boom", |_, _| panic!("boom-{}", 42));
        static OWNED: Command = Command::new("boom", |_, _| panic_any(String::from("boom-owned")));
        static STATIC: Command = Command::new("boom", |_, _| panic_any("boom-static"));
        static NUMBER: Command = Command::new("boom", |_, _| panic_any(42u32));
        static EMPTY: Command = Command::new("boom", |_, _| panic!(""));
        static UNICODE: Command = Command::new("boom", |_, _| panic!("сбой 😀"));
        let rows: [(&'static Command, &str); 7] = [
            (&LITERAL, "boom-str"),
            (&FORMATTED, "boom-42"),
            (&OWNED, "boom-owned"),
            (&STATIC, "boom-static"),
            (&NUMBER, "unknown failure"),
            (&EMPTY, ""),
            (&UNICODE, "\\u0441\\u0431\\u043E\\u0439 \\uD83D\\uDE00"),
        ];
        for (command, shown) in rows {
            let outcome = panicking(command);
            assert_eq!(outcome.exit_code, 1);
            assert_eq!(outcome.line, internal_line(shown));
        }
    }

    // ----- настоящая команда, ход которой падает -----

    struct Lab {
        dir: TempDir,
    }

    impl Lab {
        fn new() -> Lab {
            let dir = tempfile::tempdir().unwrap();
            let keys = dir.path().join("keys");
            fs::create_dir_all(&keys).unwrap();
            for (name, len) in [
                ("gtav_aes_key.dat", 32),
                ("gtav_ng_key.dat", 101 * 68 * 4),
                ("gtav_ng_decrypt_tables.dat", 17 * 4096 * 4),
                ("gtav_hash_lut.dat", 256),
            ] {
                fs::write(keys.join(name), vec![5u8; len]).unwrap();
            }
            Lab { dir }
        }

        fn archive(&self) -> PathBuf {
            let path = self.dir.path().join("x64a.rpf");
            let mut file = File::create(&path).unwrap();
            let mut context = WriteContext {
                staging: self.dir.path(),
                keys: None,
                finalizer: None,
            };
            write_archive(&update_tree(None), &mut file, &mut context, &mut |_| {}).unwrap();
            path
        }

        /// Запрос к `probe-rpf`: подойдёт ли замена `common/data/a.xml`.
        fn probe_args(&self) -> (Vec<String>, u64) {
            let archive = self.archive();
            let size = fs::metadata(&archive).unwrap().len();
            let request = self.dir.path().join("request.json");
            let body = json!({
                "baseArchive": archive.display().to_string(),
                "operations": [{"entry": "common/data/a.xml", "action": "replace"}],
            });
            fs::write(&request, body.to_string()).unwrap();
            let keys = self.dir.path().join("keys");
            let args = vec![
                "probe-rpf".to_owned(),
                "--request".to_owned(),
                request.display().to_string(),
                "--keys".to_owned(),
                keys.display().to_string(),
            ];
            (args, size)
        }
    }

    fn expected_probe(size: u64) -> Value {
        json!({
            "status": "ready", "mode": "read-only", "bytes": size, "checkedOperations": 1,
            "operations": [{"entry": "common/data/a.xml", "action": "replace", "exists": true}]
        })
    }

    fn probe_with(args: &[String], progress: &Progress) -> Outcome {
        run(args, progress)
    }

    #[test]
    fn a_real_command_answers_and_survives_panicking_progress_sinks() {
        // Пн1 – Пн8 запуском probe-rpf
        let lab = Lab::new();
        let (args, size) = lab.probe_args();
        let healthy = probe_with(&args, &Progress::silent());
        assert_eq!(healthy.exit_code, 0, "{}", healthy.line);
        let parsed: Value = serde_json::from_str(&healthy.line).unwrap();
        assert_eq!(parsed["command"], json!("probe-rpf"));
        assert_eq!(parsed["result"], expected_probe(size));

        let sinks: Vec<(Progress, &str)> = vec![
            (Progress::with_sink(|_| panic!("boom-str")), "boom-str"),
            (Progress::with_sink(|_| panic!("boom-{}", 42)), "boom-42"),
            (
                Progress::with_sink(|_| panic_any(String::from("boom-owned"))),
                "boom-owned",
            ),
            (
                Progress::with_sink(|_| panic_any("boom-static")),
                "boom-static",
            ),
            (Progress::with_sink(|_| panic_any(42u32)), "unknown failure"),
            (Progress::with_sink(|_| panic!("")), ""),
            (
                Progress::with_sink(|_| panic!("сбой 😀")),
                "\\u0441\\u0431\\u043E\\u0439 \\uD83D\\uDE00",
            ),
        ];
        for (progress, shown) in sinks {
            let outcome = probe_with(&args, &progress);
            assert_eq!(outcome.exit_code, 1, "{shown}");
            assert_eq!(outcome.line, internal_line(shown));
        }
        // Пн8: один Progress переживает панику, дальше всё работает
        let armed = Arc::new(Mutex::new(true));
        let trigger = Arc::clone(&armed);
        let progress = Progress::with_sink(move |_| {
            let mut first = trigger.lock().unwrap();
            if std::mem::replace(&mut *first, false) {
                drop(first);
                panic!("first-only");
            }
        });
        let broken = probe_with(&args, &progress);
        assert_eq!(broken.line, internal_line("first-only"));
        assert_eq!(broken.exit_code, 1);
        let after = probe_with(&args, &progress);
        assert_eq!(after.exit_code, 0, "{}", after.line);
        let after_parsed: Value = serde_json::from_str(&after.line).unwrap();
        assert_eq!(after_parsed["result"], expected_probe(size));
        assert_info(&run(&argv(&["engine-info"]), &progress));
    }

    #[test]
    fn a_raised_cancel_flag_is_ignored_by_commands_without_checkpoints() {
        // Пн9
        let lab = Lab::new();
        let (args, size) = lab.probe_args();
        let progress = Progress::silent();
        progress.cancel().request();
        assert_info(&run(&argv(&["engine-info"]), &progress));
        let probed = run(&args, &progress);
        assert_eq!(probed.exit_code, 0, "{}", probed.line);
        let parsed: Value = serde_json::from_str(&probed.line).unwrap();
        assert_eq!(parsed["result"], expected_probe(size));
    }

    #[test]
    fn parallel_calls_are_independent() {
        // Л-9
        let workers: Vec<_> = (0..8)
            .map(|round| {
                std::thread::spawn(move || {
                    let name = format!("unknown-{round}");
                    answer(&[&name]).line
                })
            })
            .collect();
        for (round, worker) in workers.into_iter().enumerate() {
            assert_eq!(
                worker.join().unwrap(),
                argument_line(&format!("Unsupported native command: unknown-{round}"))
            );
        }
    }
}
