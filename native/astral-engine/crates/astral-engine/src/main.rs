//! Процесс `astral-engine`: одна команда на запуск либо резидентный режим `serve`.
//!
//! Мост читает последнюю строку stdout с булевым полем `ok`, а ход долгой
//! команды берёт из stderr; всё остальное решает библиотека.

use std::ffi::OsString;
use std::io::{self, Write};
use std::process::ExitCode;

use astral_engine::disk::LiveLimits;
use astral_engine::progress::{watch_stdin_live, Progress};
use astral_engine::{memory_limit, run, serve};

/// Первое слово, которое переключает процесс в резидентный режим.
const RESIDENT_WORD: &str = "serve";

enum Mode {
    Resident,
    Single,
}

/// Аргументы строками; то, что не читается как UTF-8, получает знаки U+FFFD.
fn gather_arguments(raw: impl IntoIterator<Item = OsString>) -> Vec<String> {
    let mut gathered = Vec::new();
    for argument in raw {
        gathered.push(match argument.into_string() {
            Ok(text) => text,
            Err(odd) => odd.to_string_lossy().into_owned(),
        });
    }
    gathered
}

/// Режим решает первое слово: края без пробельных знаков Unicode, нижний
/// регистр по правилам Unicode.
fn mode_for(argv: &[String]) -> Mode {
    match argv.first().map(|word| word.trim().to_lowercase()) {
        Some(word) if word == RESIDENT_WORD => Mode::Resident,
        _ => Mode::Single,
    }
}

/// Строка ответа и один LF; сбой записи (читатель закрыл трубу) ничего не меняет.
fn emit_answer(mut out: impl Write, line: &str) {
    let framed = format!(
        "{line}
"
    );
    let _ = out.write_all(framed.as_bytes()).and_then(|()| out.flush());
}

/// Код выхода сводится к одному байту.
fn status_byte(code: i32) -> u8 {
    (code & 0xFF) as u8
}

/// Ход идёт в stderr; строка `cancel` на stdin поднимает флаг отмены, строка `limits write=… read=…` меняет потолки идущей команды (регулятор диска, 20.11.2026).
fn watched_progress(live: &std::sync::Arc<LiveLimits>) -> Progress {
    let reporter = Progress::stderr();
    watch_stdin_live(reporter.cancel().clone(), std::sync::Arc::clone(live));
    reporter
}

fn run_single(argv: &[String]) -> ExitCode {
    // Живые потолки этой команды: пейсер записи и лента чтения берут их у контекста потока, команда идёт в этом же потоке.
    let live = LiveLimits::new();
    let _scope = live.enter();
    let reporter = watched_progress(&live);
    let outcome = run(argv, &reporter);
    emit_answer(io::stdout().lock(), &outcome.line);
    ExitCode::from(status_byte(outcome.exit_code))
}

fn main() -> ExitCode {
    // Потолок памяти ставится раньше всего; его исход на вывод не влияет.
    let _ = memory_limit::apply();
    let argv = gather_arguments(std::env::args_os().skip(1));
    match mode_for(&argv) {
        Mode::Resident => {
            serve::serve(io::stdin().lock(), io::stdout());
            ExitCode::SUCCESS
        }
        Mode::Single => run_single(&argv),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};
    use std::process::{Command, Stdio};
    use std::thread;
    use std::time::{Duration, Instant};

    fn words(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|part| (*part).to_owned()).collect()
    }

    #[test]
    fn resident_mode_is_chosen_by_the_first_argument_only() {
        // Гл7 – Гл14
        let resident: [&[&str]; 7] = [
            &["serve"],
            &["SERVE"],
            &["  Serve  "],
            &["serve", "extra"],
            &["serve", "--x"],
            &["serve", "--x", "y"],
            &["\tserve\n"],
        ];
        for argv in resident {
            assert!(matches!(mode_for(&words(argv)), Mode::Resident), "{argv:?}");
        }
        let ordinary: [&[&str]; 6] = [
            &[],
            &["serve-x"],
            &["engine-info", "serve"],
            &["x", "serve"],
            &[""],
            &["\u{feff}serve"],
        ];
        for argv in ordinary {
            assert!(
                !matches!(mode_for(&words(argv)), Mode::Resident),
                "{argv:?}"
            );
        }
    }

    #[test]
    fn arguments_keep_valid_text_and_replace_the_rest() {
        let plain = gather_arguments([OsString::from("engine-info"), OsString::from("--a")]);
        assert_eq!(plain, words(&["engine-info", "--a"]));
        assert!(gather_arguments(Vec::new()).is_empty());
        #[cfg(windows)]
        {
            use std::os::windows::ffi::OsStringExt;
            // Лп33 – Лп36: непарный суррогат превращается в U+FFFD
            let high = OsString::from_wide(&[0x61, 0xD800, 0x62]);
            let low = OsString::from_wide(&[0xDC00, 0x58]);
            assert_eq!(
                gather_arguments([high, low]),
                words(&["a\u{fffd}b", "\u{fffd}X"])
            );
        }
        #[cfg(unix)]
        {
            use std::os::unix::ffi::OsStringExt;
            let bad = OsString::from_vec(vec![b'a', 0xff, b'b']);
            assert_eq!(gather_arguments([bad]), words(&["a\u{fffd}b"]));
        }
    }

    #[test]
    fn answers_end_with_one_lf_and_a_closed_pipe_changes_nothing() {
        // Г-4, Гл16, Гл17
        let mut sink = Vec::new();
        emit_answer(&mut sink, "{\"ok\":true}");
        assert_eq!(sink, b"{\"ok\":true}\n");
        struct Severed;
        impl Write for Severed {
            fn write(&mut self, _: &[u8]) -> io::Result<usize> {
                Err(io::ErrorKind::BrokenPipe.into())
            }
            fn flush(&mut self) -> io::Result<()> {
                Err(io::ErrorKind::BrokenPipe.into())
            }
        }
        emit_answer(Severed, "{\"ok\":false}");
    }

    #[test]
    fn exit_codes_fit_one_byte() {
        // Г-5
        assert_eq!(
            [status_byte(0), status_byte(1), status_byte(130)],
            [0, 1, 130]
        );
        assert_eq!(status_byte(256), 0);
        assert_eq!(status_byte(-1), 255);
    }

    // ----- настоящий процесс -----

    /// Бинарь `astral-engine` рядом с каталогом `deps` тест-исполняемого файла.
    fn engine_exe() -> Option<PathBuf> {
        let me = std::env::current_exe().ok()?;
        let exe = me
            .parent()?
            .parent()?
            .join(format!("astral-engine{}", std::env::consts::EXE_SUFFIX));
        exe.is_file().then_some(exe)
    }

    macro_rules! engine_or_skip {
        () => {
            match engine_exe() {
                Some(exe) => exe,
                None => {
                    eprintln!("пропуск: рядом нет собранного бинаря (cargo build -p astral-engine)");
                    return;
                }
            }
        };
    }

    struct Finished {
        code: Option<i32>,
        out: Vec<u8>,
        err: Vec<u8>,
    }

    fn execute(exe: &Path, args: &[&str], stdin: &[u8]) -> Finished {
        let mut child = Command::new(exe)
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let mut pipe = child.stdin.take().unwrap();
        let data = stdin.to_vec();
        let feeder = thread::spawn(move || {
            let _ = pipe.write_all(&data);
        });
        let output = child.wait_with_output().unwrap();
        feeder.join().unwrap();
        Finished {
            code: output.status.code(),
            out: output.stdout,
            err: output.stderr,
        }
    }

    fn text(bytes: &[u8]) -> String {
        String::from_utf8(bytes.to_vec()).unwrap()
    }

    #[test]
    fn a_process_prints_one_ascii_line_and_exits_with_its_code() {
        // Лп1, Лп2 (Гл1), Лп9 (Гл2), Лп19, Лп30
        let exe = engine_or_skip!();
        let none = execute(&exe, &[], b"");
        assert_eq!(none.code, Some(1));
        assert_eq!(
            text(&none.out),
            "{\"ok\":false,\"error\":{\"code\":\"ArgumentException\",\"message\":\"A native command is required.\"}}\n"
        );
        assert!(none.err.is_empty());

        let info = execute(&exe, &["Engine-Info"], b"");
        assert_eq!(info.code, Some(0));
        assert!(info.out.is_ascii());
        assert_eq!(info.out.iter().filter(|&&byte| byte == b'\n').count(), 1);
        assert_eq!(&info.out[info.out.len() - 3..], b"}}\n");
        assert!(info
            .out
            .starts_with(b"{\"ok\":true,\"command\":\"engine-info\",\""));
        assert!(info.err.is_empty());

        let unknown = execute(&exe, &["teleport"], b"");
        assert_eq!(unknown.code, Some(1));
        assert_eq!(unknown.out.len(), 99);
        assert_eq!(&unknown.out[unknown.out.len() - 3..], b"}}\n");
        assert!(unknown.err.is_empty());

        let broken = execute(&exe, &["teleport", "--to"], b"");
        assert_eq!(
            text(&broken.out),
            "{\"ok\":false,\"error\":{\"code\":\"ArgumentException\",\"message\":\"A value is required for --to.\"}}\n"
        );
        let cut = execute(&exe, &["  ENCODE-DDS  ", "--input"], b"");
        assert_eq!(cut.code, Some(1));
        assert!(text(&cut.out).contains("A value is required for --input."));
    }

    #[test]
    fn stdin_does_not_change_an_ordinary_command() {
        // Гл4, Гл5, Гл6
        let exe = engine_or_skip!();
        let cancel = execute(&exe, &["engine-info"], b"cancel\n");
        assert_eq!(cancel.code, Some(0));
        assert!(cancel.out.starts_with(b"{\"ok\":true"));
        assert!(cancel.err.is_empty());
        let junk = execute(&exe, &["engine-info"], b"\xff\xfe\ncancel\n");
        assert_eq!(junk.code, Some(0));
        assert!(junk.out.starts_with(b"{\"ok\":true"));
        let refused = execute(&exe, &["teleport"], b"cancel\n");
        assert_eq!(refused.code, Some(1));
        assert!(text(&refused.out).contains("Unsupported native command: teleport"));
    }

    #[test]
    fn an_open_silent_stdin_does_not_hold_the_process() {
        // Гл3
        let exe = engine_or_skip!();
        let started = Instant::now();
        let mut child = Command::new(&exe)
            .arg("engine-info")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let keep_open = child.stdin.take().unwrap();
        let output = child.wait_with_output().unwrap();
        drop(keep_open);
        assert_eq!(output.status.code(), Some(0));
        assert!(output.stdout.starts_with(b"{\"ok\":true"));
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn serve_mode_answers_per_request_and_ignores_extra_arguments() {
        // Гл7 – Гл15
        let exe = engine_or_skip!();
        let request = b"{\"id\":1,\"argv\":[\"teleport\"]}\n";
        let expected = "{\"id\":1,\"exitCode\":1,\"response\":{\"ok\":false,\"error\":{\"code\":\"ArgumentException\",\"message\":\"Unsupported native command: teleport\"}}}\n";
        let forms: [&[&str]; 7] = [
            &["serve"],
            &["SERVE"],
            &["  Serve  "],
            &["serve", "extra"],
            &["serve", "--x"],
            &["serve", "--x", "y"],
            &["\tserve\n"],
        ];
        for form in forms {
            let done = execute(&exe, form, request);
            assert_eq!(done.code, Some(0), "{form:?}");
            assert_eq!(text(&done.out), expected, "{form:?}");
            assert!(done.err.is_empty());
        }
        let not_serve = execute(&exe, &["serve-x"], b"");
        assert_eq!(not_serve.code, Some(1));
        assert!(text(&not_serve.out).contains("Unsupported native command: serve-x"));
        let idle = execute(&exe, &["serve", "--x"], b"");
        assert_eq!(idle.code, Some(0));
        assert!(idle.out.is_empty() && idle.err.is_empty());
    }

    /// Синтетическая «игра»: архив `x64a.rpf` и четыре файла ключей.
    struct Lab {
        dir: tempfile::TempDir,
    }

    impl Lab {
        fn new() -> Lab {
            let dir = tempfile::tempdir().unwrap();
            let keys = dir.path().join("keys");
            std::fs::create_dir_all(&keys).unwrap();
            for (name, len) in [
                ("gtav_aes_key.dat", 32),
                ("gtav_ng_key.dat", 101 * 68 * 4),
                ("gtav_ng_decrypt_tables.dat", 17 * 4096 * 4),
                ("gtav_hash_lut.dat", 256),
            ] {
                std::fs::write(keys.join(name), vec![5u8; len]).unwrap();
            }
            Lab { dir }
        }

        fn keys(&self) -> String {
            self.dir.path().join("keys").display().to_string()
        }

        fn archive(&self) -> String {
            let path = self.dir.path().join("x64a.rpf");
            let mut file = std::fs::File::create(&path).unwrap();
            let mut context = rage_rpf::WriteContext {
                staging: self.dir.path(),
                keys: None,
                finalizer: None,
            };
            let tree = rage_rpf::fixtures::update_tree(None);
            rage_rpf::write_archive(&tree, &mut file, &mut context, &mut |_| {}).unwrap();
            path.display().to_string()
        }

        fn probe_request(&self) -> String {
            let body = serde_json::json!({
                "baseArchive": self.archive(),
                "operations": [{"entry": "common/data/a.xml", "action": "replace"}],
            });
            let path = self.dir.path().join("request.json");
            std::fs::write(&path, body.to_string()).unwrap();
            path.display().to_string()
        }
    }

    #[test]
    fn a_command_log_goes_to_stdout_before_the_answer() {
        // Гл19
        let exe = engine_or_skip!();
        let lab = Lab::new();
        let archive = lab.archive();
        let output = lab.dir.path().join("index.json").display().to_string();
        let keys = lab.keys();
        let done = execute(
            &exe,
            &[
                "index-archive",
                "--input",
                &archive,
                "--output",
                &output,
                "--keys",
                &keys,
            ],
            b"",
        );
        assert_eq!(done.code, Some(0), "{}", text(&done.out));
        let shown = text(&done.out);
        let lines: Vec<&str> = shown.lines().collect();
        assert_eq!(lines.len(), 3, "{shown}");
        assert!(lines[0].starts_with("[ContentXmlAnalyzer] "));
        assert!(lines[1].starts_with("[ContentXmlAnalyzer] "));
        assert!(lines[2].starts_with("{\"ok\":true,\"command\":\"index-archive\",\"result\""));
        assert!(
            done.err.is_empty()
                || text(&done.err)
                    .lines()
                    .all(|line| line.starts_with("{\"progress\""))
        );
    }

    #[test]
    fn serve_streams_progress_then_answer_and_keeps_the_log_apart() {
        // Сл-П2, Сл-П3, Сл42
        let exe = engine_or_skip!();
        let lab = Lab::new();
        let request = lab.probe_request();
        let keys = lab.keys();
        let probe = serde_json::json!({
            "id": "probe",
            "argv": ["probe-rpf", "--request", request, "--keys", keys],
        });
        let archive = lab.archive();
        let output = lab.dir.path().join("index.json").display().to_string();
        let index = serde_json::json!({
            "id": 9,
            "argv": ["index-archive", "--input", archive, "--output", output, "--keys", keys],
        });
        let input = format!("{probe}\n{index}\n");
        let done = execute(&exe, &["serve"], input.as_bytes());
        assert_eq!(done.code, Some(0));
        assert!(done.err.is_empty());
        let shown = text(&done.out);
        let mut progress_lines = 0;
        let mut answers = std::collections::HashMap::new();
        for line in shown.lines() {
            let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
                assert!(line.starts_with("[ContentXmlAnalyzer] "), "{line}");
                continue;
            };
            if value.get("response").is_some() {
                answers.insert(value["id"].to_string(), value);
            } else if value.get("progress").is_some() {
                assert!(value["progress"]["phase"].is_string());
                assert!(value["progress"]["copiedBytes"].is_u64());
                assert!(value["progress"]["totalBytes"].is_u64());
                progress_lines += 1;
            }
        }
        assert!(progress_lines >= 2, "{shown}");
        let probe_answer = &answers["\"probe\""];
        assert_eq!(probe_answer["exitCode"], 0);
        assert_eq!(probe_answer["response"]["result"]["status"], "ready");
        assert_eq!(answers["9"]["response"]["command"], "index-archive");
    }

    #[test]
    fn the_data_channel_comes_up_only_in_serve_mode() {
        // Нк4, Нк20 – Нк23, С-6
        use std::io::{BufRead, BufReader, Read};
        use std::net::TcpStream;
        let exe = engine_or_skip!();
        let assets = tempfile::tempdir().unwrap();
        let body = b"ARS2 model bytes for the window";
        let name = {
            use sha2::{Digest, Sha256};
            Sha256::digest(body)
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>()
        };
        std::fs::write(assets.path().join(&name), body).unwrap();
        let token = "0123456789abcdef0123456789abcdef-token";
        let assets_dir = assets.path().display().to_string();
        let configure = |command: &mut Command| {
            command
                .env("ASTRAL_ENGINE_HTTP_TOKEN", token)
                .env("ASTRAL_ENGINE_HTTP_ORIGIN", "http://127.0.0.1:4174/")
                .env("ASTRAL_ENGINE_ASSETS_DIR", &assets_dir);
        };
        let mut command = Command::new(&exe);
        command
            .arg("serve")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        configure(&mut command);
        let mut child = command.spawn().unwrap();
        let mut stdin = child.stdin.take().unwrap();
        let mut lines = BufReader::new(child.stdout.take().unwrap());
        let mut first = String::new();
        lines.read_line(&mut first).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&first).unwrap();
        assert_eq!(parsed.as_object().unwrap().len(), 1, "{first}");
        let port = parsed["http"]["port"].as_u64().unwrap() as u16;
        let ask = |token_header: &str| {
            let mut socket = TcpStream::connect(("127.0.0.1", port)).unwrap();
            let request = format!(
                "GET /a/{name} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nX-Astral-Engine-Token: {token_header}\r\nOrigin: http://127.0.0.1:4174\r\nConnection: close\r\n\r\n"
            );
            socket.write_all(request.as_bytes()).unwrap();
            let mut answer = Vec::new();
            socket.read_to_end(&mut answer).unwrap();
            String::from_utf8_lossy(&answer).into_owned()
        };
        let served = ask(token);
        assert!(
            served.starts_with(
                "HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: http://127.0.0.1:4174\r\n"
            ),
            "{served}"
        );
        assert!(served.ends_with("ARS2 model bytes for the window"));
        assert!(ask("wrong").starts_with("HTTP/1.1 401 Unauthorized\r\n"));
        // команды работают как обычно, первая строка уже была
        stdin
            .write_all(b"{\"id\":1,\"argv\":[\"teleport\"]}\n")
            .unwrap();
        let mut second = String::new();
        lines.read_line(&mut second).unwrap();
        assert!(second.starts_with("{\"id\":1,\"exitCode\":1,"), "{second}");
        drop(stdin);
        let status = child.wait().unwrap();
        assert_eq!(status.code(), Some(0));
        assert!(
            TcpStream::connect(("127.0.0.1", port)).is_err(),
            "канал умер вместе с процессом"
        );

        // обычный запуск с теми же переменными: канала нет, одна строка ответа
        let mut plain = Command::new(&exe);
        plain
            .arg("engine-info")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        configure(&mut plain);
        let output = plain.output().unwrap();
        assert_eq!(output.status.code(), Some(0));
        let shown = text(&output.stdout);
        assert_eq!(shown.lines().count(), 1);
        assert!(!shown.contains("\"http\""));
    }

    #[test]
    fn a_closed_stdout_keeps_the_exit_codes() {
        // Гл16, Гл17, Гл18
        let exe = engine_or_skip!();
        let cases: [(&[&str], &[u8], i32); 3] = [
            (&["engine-info"], b"", 0),
            (&["teleport"], b"", 1),
            (&["serve"], b"{\"id\":1,\"argv\":[\"teleport\"]}\n", 0),
        ];
        for (args, stdin, expected) in cases {
            let mut child = Command::new(&exe)
                .args(args)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .unwrap();
            drop(child.stdout.take());
            let mut pipe = child.stdin.take().unwrap();
            let _ = pipe.write_all(stdin);
            drop(pipe);
            let output = child.wait_with_output().unwrap();
            assert_eq!(output.status.code(), Some(expected), "{args:?}");
            assert!(output.stderr.is_empty(), "{args:?}");
        }
    }
}
