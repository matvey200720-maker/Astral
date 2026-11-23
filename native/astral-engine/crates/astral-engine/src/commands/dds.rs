//! `encode-dds`: сырая картинка RGBA → файл `.dds` нужного формата и числа уровней.
//!
//! Сборку делает `rage_res::dds_build::encode_dds`; здесь параметры командной
//! строки, чтение входа, порядок проверок, запись выхода и ответ.

use std::{fs, path::PathBuf};

use rage_res::dds_build;
use serde_json::{Map, Value};

use super::{shop::write_atomic, Command};
use crate::{
    args::Options,
    error::{EngineError, Result},
    paths,
    progress::Progress,
};

/// Расширения выходного файла.
const OUTPUT_EXTENSIONS: [&str; 1] = [".dds"];

/// Числовые параметры в том порядке, в котором их проверяют: ширина, высота, число уровней.
const COUNT_KEYS: [&str; 3] = ["width", "height", "mips"];

pub const COMMANDS: &[Command] = &[Command::new("encode-dds", encode_dds_file)];

/// Число для кодера (`u32`): всё, что больше, остаётся максимумом и отказывает как «вне границ», а не
/// превращается в младшие 32 бита (с ними `--mips 4294967297` когда-то давал один уровень и успех).
fn capped_word(value: usize) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}

/// Числовой параметр: нет параметра — отказ «Missing argument», не число — отказ разбора.
fn count_of(options: &Options, key: &str) -> Result<usize> {
    match options.parsed::<usize>(key)? {
        Some(count) => Ok(count),
        None => Err(EngineError::argument(format!("Missing argument: --{key}"))),
    }
}

/// Всё, что проверяется до чтения входа: файл, стороны, число уровней и формат.
struct Picture<'a> {
    file: PathBuf,
    sides: [usize; 2],
    levels: usize,
    format: &'a str,
}

impl<'a> Picture<'a> {
    /// Порядок проверок: вход, ширина, высота, уровни, формат; первый же отказ побеждает.
    fn from_options(options: &'a Options) -> Result<Self> {
        let file = paths::existing_file(options.required("input")?, &[])?;
        let counts = COUNT_KEYS
            .iter()
            .map(|key| count_of(options, key))
            .collect::<Result<Vec<_>>>()?;
        let format = options.required("format")?;
        Ok(Self {
            file,
            sides: [counts[0], counts[1]],
            levels: counts[2],
            format,
        })
    }

    /// Вход читается целиком; проверки кодера идут после чтения.
    fn encode(&self) -> Result<Vec<u8>> {
        let rgba = fs::read(&self.file)?;
        let [width, height] = self.sides;
        let levels = capped_word(self.levels);
        Ok(dds_build::encode_dds(
            width,
            height,
            self.format,
            levels,
            &rgba,
        )?)
    }
}

/// Выход проверяется после кодирования: каталог создаётся только здесь.
fn store(options: &Options, dds: &[u8]) -> Result<()> {
    let target = paths::output_file(options.required("output")?, &OUTPUT_EXTENSIONS)?;
    write_atomic(&target, dds)
}

pub fn encode_dds_file(options: &Options, _: &Progress) -> Result<Value> {
    let dds = Picture::from_options(options)?.encode()?;
    store(options, &dds)?;
    Ok(Value::Object(Map::from_iter([(
        "bytes".to_owned(),
        Value::from(dds.len()),
    )])))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::run;
    use serde_json::json;
    use sha2::{Digest, Sha256};
    use std::path::Path;

    /// Узор RGBA без прозрачности: каждый пиксель зависит от места.
    fn pattern(width: usize, height: usize) -> Vec<u8> {
        (0..width * height)
            .flat_map(|index| {
                let (x, y) = (index % width, index / width);
                [
                    (x * 37 + 11) as u8,
                    (y * 53 + 7) as u8,
                    (x * y * 5 + 90) as u8,
                    255,
                ]
            })
            .collect()
    }

    struct Bench {
        dir: tempfile::TempDir,
    }

    impl Bench {
        fn new() -> Self {
            Self {
                dir: tempfile::tempdir().unwrap(),
            }
        }

        fn path(&self, name: &str) -> String {
            self.dir.path().join(name).to_string_lossy().into_owned()
        }

        fn raw(&self, name: &str, width: usize, height: usize) -> String {
            std::fs::write(self.dir.path().join(name), pattern(width, height)).unwrap();
            self.path(name)
        }

        fn exec(&self, args: &[&str]) -> (Value, i32) {
            let mut argv = vec!["encode-dds".to_owned()];
            argv.extend(args.iter().map(|arg| (*arg).to_owned()));
            let outcome = run(&argv, &Progress::silent());
            (
                serde_json::from_str(&outcome.line).unwrap(),
                outcome.exit_code,
            )
        }
    }

    fn refusal(code: &str, message: &str) -> (Value, i32) {
        (
            json!({ "ok": false, "error": { "code": code, "message": message } }),
            1,
        )
    }

    fn argument(message: &str) -> (Value, i32) {
        refusal("ArgumentException", message)
    }

    fn done(bytes: usize) -> (Value, i32) {
        (
            json!({ "ok": true, "command": "encode-dds", "result": { "bytes": bytes } }),
            0,
        )
    }

    fn le(bytes: &[u8], at: usize) -> u32 {
        u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap())
    }

    fn encoded(format: &str, width: usize, height: usize, mips: u32) -> Vec<u8> {
        let bench = Bench::new();
        let input = bench.raw("p.raw", width, height);
        let output = bench.path("o.dds");
        let (w, h, m) = (width.to_string(), height.to_string(), mips.to_string());
        let args = [
            "--input", &input, "--output", &output, "--width", &w, "--height", &h, "--format",
            format, "--mips", &m,
        ];
        let (line, code) = bench.exec(&args);
        assert_eq!(code, 0, "{line}");
        std::fs::read(output).unwrap()
    }

    #[test]
    fn sizes_of_the_documented_successes() {
        // (формат, ширина, высота, уровни, размер файла) из примеров Дд1-Дд21.
        let cases = [
            ("DXT1", 8, 8, 1, 160),
            ("DXT3", 8, 8, 1, 192),
            ("DXT5", 8, 8, 1, 192),
            ("A8R8G8B8", 8, 8, 1, 384),
            ("DXT1", 8, 8, 4, 184),
            ("DXT3", 8, 8, 4, 240),
            ("DXT5", 8, 8, 4, 240),
            ("A8R8G8B8", 8, 8, 4, 468),
            ("DXT5", 4, 4, 1, 144),
            ("DXT5", 4, 4, 3, 176),
            ("DXT5", 1, 1, 1, 144),
            ("DXT1", 1, 1, 1, 136),
            ("A8R8G8B8", 1, 1, 1, 132),
            ("DXT5", 2, 2, 2, 160),
            ("DXT5", 5, 3, 3, 192),
            ("A8R8G8B8", 5, 3, 3, 200),
            ("DXT3", 6, 10, 4, 288),
            ("DXT5", 16, 16, 5, 496),
            ("DXT5", 64, 32, 7, 2896),
            ("DXT1", 64, 32, 3, 1472),
            ("DXT5", 2, 8, 4, 208),
        ];
        for (format, width, height, mips, size) in cases {
            let bytes = encoded(format, width, height, mips);
            assert_eq!(bytes.len(), size, "{format} {width}x{height} m{mips}");
        }
    }

    #[test]
    fn the_header_follows_the_documented_dumps() {
        let dxt1 = encoded("DXT1", 8, 8, 1);
        assert_eq!(
            &dxt1[..64],
            [
                0x44, 0x44, 0x53, 0x20, 0x7c, 0, 0, 0, 0x07, 0x10, 0x08, 0, 0x08, 0, 0, 0, //
                0x08, 0, 0, 0, 0x20, 0, 0, 0, 0, 0, 0, 0, 0x01, 0, 0, 0, //
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, //
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            ]
        );
        let dxt5_chain = encoded("DXT5", 8, 8, 4);
        assert_eq!(le(&dxt5_chain, 8), 0x000a_1007);
        assert_eq!(le(&dxt5_chain, 20), 0x40);
        assert_eq!(le(&dxt5_chain, 28), 4);
        assert_eq!(le(&dxt5_chain, 108), 0x0040_1008);
        let argb = encoded("A8R8G8B8", 8, 8, 1);
        assert_eq!(le(&argb, 8), 0x1007 | 0x8);
        assert_eq!(le(&argb, 20), 32);
        assert_eq!(le(&argb, 80), 0x41);
        assert_eq!(le(&argb, 88), 32);
        assert_eq!(
            [le(&argb, 92), le(&argb, 96), le(&argb, 100), le(&argb, 104)],
            [0x00ff_0000, 0x0000_ff00, 0x0000_00ff, 0xff00_0000]
        );
        let one = encoded("DXT5", 1, 1, 1);
        assert_eq!((le(&one, 12), le(&one, 16), le(&one, 20)), (1, 1, 16));
    }

    #[test]
    fn an_uncompressed_level_holds_bgra_pixels_in_order() {
        let argb = encoded("A8R8G8B8", 8, 8, 1);
        let source = pattern(8, 8);
        for (pixel, rgba) in source.chunks(4).enumerate() {
            let got = &argb[128 + pixel * 4..128 + pixel * 4 + 4];
            assert_eq!(got, [rgba[2], rgba[1], rgba[0], rgba[3]], "{pixel}");
        }
    }

    #[test]
    fn the_answer_and_the_file_agree() {
        let bench = Bench::new();
        let input = bench.raw("p.raw", 8, 8);
        let output = bench.path("deep/er/still/o.dds");
        let reply = bench.exec(&[
            "--input", &input, "--output", &output, "--width", "8", "--height", "8", "--format",
            "DXT5", "--mips", "1",
        ]);
        assert_eq!(reply, done(192));
        let written = std::fs::read(&output).unwrap();
        assert_eq!(written.len(), 192);
        let digest = Sha256::digest(&written);
        assert_eq!(digest.len(), 32);
    }

    #[test]
    fn values_are_trimmed_names_ignore_case_and_the_last_repeat_wins() {
        let bench = Bench::new();
        let small = bench.raw("p4.raw", 4, 4);
        let big = bench.raw("p8.raw", 8, 8);
        let out = bench.path("o.dds");
        let padded = bench.exec(&[
            "--input", &big, "--output", &out, "--width", " 8 ", "--height", "\t8\n", "--format",
            "DXT5", "--mips", " 1",
        ]);
        assert_eq!(padded, done(192));
        let plus = bench.exec(&[
            "--input", &big, "--output", &out, "--width", "+8", "--height", "08", "--format",
            "DXT5", "--mips", "001",
        ]);
        assert_eq!(plus, done(192));
        let upper = bench.exec(&[
            "--INPUT", &big, "--Output", &out, "--WIDTH", "8", "--Height", "8", "--fOrMaT", "DXT5",
            "--MIPS", "1",
        ]);
        assert_eq!(upper, done(192));
        let repeats = bench.exec(&[
            "--input", &small, "--input", &big, "--output", &out, "--width", "4", "--width", "8",
            "--height", "8", "--format", "DXT1", "--format", "DXT5", "--mips", "1",
        ]);
        assert_eq!(repeats, done(192));
        let extra = bench.exec(&[
            "--input",
            &big,
            "--output",
            &out,
            "--width",
            "8",
            "--height",
            "8",
            "--format",
            "DXT5",
            "--mips",
            "1",
            "--bogus",
            "1",
            "--progress",
            "x",
        ]);
        assert_eq!(extra, done(192));
    }

    #[test]
    fn a_level_count_beyond_32_bits_is_refused_not_cut() {
        let bench = Bench::new();
        let input = bench.raw("p8.raw", 8, 8);
        let out = bench.path("o.dds");
        let base = |mips: &'static str| {
            bench.exec(&[
                "--input", &input, "--output", &out, "--width", "8", "--height", "8", "--format",
                "DXT5", "--mips", mips,
            ])
        };
        // Прежний код брал младшие 32 бита: 4294967297 превращалось в один уровень и давало успех.
        for count in [
            "4294967296",
            "4294967297",
            "4294967300",
            "18446744073709551615",
        ] {
            assert_eq!(
                base(count),
                argument("Число mip-уровней DDS вне допустимых границ."),
                "{count}"
            );
        }
        assert_eq!(capped_word(usize::MAX), u32::MAX);
        assert_eq!(capped_word(7), 7);
    }

    #[test]
    fn number_refusals_name_the_key_from_the_code_and_the_raw_value() {
        let bench = Bench::new();
        let input = bench.raw("p8.raw", 8, 8);
        let out = bench.path("o.dds");
        let with = |width: &str, height: &str, mips: &str| {
            bench.exec(&[
                "--input", &input, "--output", &out, "--WIDTH", width, "--height", height,
                "--format", "DXT5", "--mips", mips,
            ])
        };
        for bad in ["-8", "8.0", "abc", "", "18446744073709551616"] {
            assert_eq!(
                with(bad, "8", "1"),
                argument(&format!("--width has an invalid value: {bad}")),
                "{bad:?}"
            );
        }
        assert_eq!(
            with("8", "x", "1"),
            argument("--height has an invalid value: x")
        );
        assert_eq!(
            with("8", "8", "two"),
            argument("--mips has an invalid value: two")
        );
    }

    #[test]
    fn missing_parameters_are_refused_in_the_documented_order() {
        let bench = Bench::new();
        let input = bench.raw("p8.raw", 8, 8);
        let out = bench.path("out-miss.dds");
        let cases: [(Vec<&str>, (Value, i32)); 9] = [
            (
                vec![
                    "--output", &out, "--width", "8", "--height", "8", "--format", "DXT5",
                    "--mips", "1",
                ],
                argument("--input is required."),
            ),
            (
                vec![
                    "--input", &input, "--width", "8", "--height", "8", "--format", "DXT5",
                    "--mips", "1",
                ],
                argument("--output is required."),
            ),
            (
                vec![
                    "--input", &input, "--output", &out, "--height", "8", "--format", "DXT5",
                    "--mips", "1",
                ],
                argument("Missing argument: --width"),
            ),
            (
                vec![
                    "--input", &input, "--output", &out, "--width", "8", "--format", "DXT5",
                    "--mips", "1",
                ],
                argument("Missing argument: --height"),
            ),
            (
                vec![
                    "--input", &input, "--output", &out, "--width", "8", "--height", "8", "--mips",
                    "1",
                ],
                argument("--format is required."),
            ),
            (
                vec![
                    "--input", &input, "--output", &out, "--width", "8", "--height", "8",
                    "--format", "DXT5",
                ],
                argument("Missing argument: --mips"),
            ),
            (vec![], argument("--input is required.")),
            // Вход проверяется раньше чисел, числа раньше формата, формат раньше кодера.
            (
                vec!["--output", &out, "--format", "DXT5"],
                argument("--input is required."),
            ),
            (
                vec![
                    "--input", &input, "--output", &out, "--width", "8", "--height", "8", "--mips",
                    "zz",
                ],
                argument("--mips has an invalid value: zz"),
            ),
        ];
        for (args, expected) in cases {
            assert_eq!(bench.exec(&args), expected, "{args:?}");
        }
    }

    #[test]
    fn input_file_refusals() {
        let bench = Bench::new();
        let real = bench.raw("p8.raw", 8, 8);
        let out = bench.path("o.dds");
        let missing = bench.path("none.raw");
        let folder = bench.path("");
        let folder = folder.trim_end_matches(['\\', '/']).to_owned();
        let call = |input: &str| {
            bench.exec(&[
                "--input", input, "--output", &out, "--width", "8", "--height", "8", "--format",
                "DXT5", "--mips", "1",
            ])
        };
        assert_eq!(
            call(&missing),
            refusal(
                "FileNotFoundException",
                &format!("File was not found: {missing}")
            )
        );
        assert_eq!(
            call(&folder),
            refusal(
                "FileNotFoundException",
                &format!("File was not found: {folder}")
            )
        );
        assert_eq!(call(""), argument("The path is empty."));
        assert_eq!(call("   "), argument("The path is empty."));
        assert_eq!(call(&real), done(192));
        std::fs::write(bench.path("empty.raw"), []).unwrap();
        std::fs::write(bench.path("short.raw"), vec![0u8; 255]).unwrap();
        std::fs::write(bench.path("long.raw"), vec![0u8; 257]).unwrap();
        let mismatch = argument("Размер RGBA не совпадает с заявленным размером DDS.");
        for name in ["empty.raw", "short.raw", "long.raw"] {
            assert_eq!(call(&bench.path(name)), mismatch, "{name}");
        }
    }

    #[test]
    fn encoder_refusals_come_through_with_their_texts() {
        let bench = Bench::new();
        let input = bench.raw("p8.raw", 8, 8);
        let out = bench.path("o.dds");
        let with = |width: &str, height: &str, format: &str, mips: &str| {
            bench.exec(&[
                "--input", &input, "--output", &out, "--width", width, "--height", height,
                "--format", format, "--mips", mips,
            ])
        };
        let bounds = argument("Размер DDS вне допустимых границ.");
        for (w, h) in [
            ("0", "8"),
            ("8", "0"),
            ("8193", "8"),
            ("8", "8193"),
            ("99999", "8"),
            ("0", "0"),
        ] {
            assert_eq!(with(w, h, "DXT5", "1"), bounds, "{w}x{h}");
        }
        assert_eq!(
            with("8192", "8192", "DXT5", "1"),
            argument("Размер RGBA не совпадает с заявленным размером DDS.")
        );
        for format in [
            "dxt5", "Dxt1", "BC7", "A8", "L8", "X8R8G8B8", "ATI1", "a8r8g8b8", "", " DXT5", "DXT5 ",
        ] {
            assert_eq!(
                with("8", "8", format, "1"),
                argument(&format!("Формат DDS {format} не поддерживается.")),
                "{format:?}"
            );
        }
        let levels = argument("Число mip-уровней DDS вне допустимых границ.");
        for mips in ["0", "17", "100"] {
            assert_eq!(with("8", "8", "DXT5", mips), levels, "{mips}");
        }
        for mips in ["5", "14", "15", "16"] {
            assert_eq!(
                with("8", "8", "DXT5", mips),
                argument(&format!(
                    "Для 8\u{d7}8 нельзя построить {mips} mip-уровней."
                )),
                "{mips}"
            );
        }
        assert_eq!(with("8", "8", "DXT5", "4"), done(240));
    }

    #[test]
    fn output_path_rules_and_effects_on_disk() {
        let bench = Bench::new();
        let input = bench.raw("p4.raw", 4, 4);
        let call = |output: &str, format: &str| {
            bench.exec(&[
                "--input", &input, "--output", output, "--width", "4", "--height", "4", "--format",
                format, "--mips", "1",
            ])
        };
        assert_eq!(call(&bench.path("OUT-UP.DDS"), "DXT1"), done(136));
        assert_eq!(
            call(&bench.path("o.bin"), "DXT1"),
            argument("Unsupported output extension: .bin")
        );
        assert_eq!(
            call(&bench.path("noext"), "DXT1"),
            argument("Unsupported output extension: ")
        );
        assert_eq!(call("", "DXT1"), argument("The path is empty."));
        let rel = bench.path("rel/../rel2/o.dds");
        assert_eq!(call(&rel, "DXT1"), done(136));
        assert!(Path::new(&bench.path("rel2/o.dds")).is_file());

        // Отказ до записи не трогает прежний выход, удача заменяет его целиком.
        let keep = bench.path("keep.dds");
        std::fs::write(&keep, b"hello world").unwrap();
        assert_eq!(
            call(&keep, "BAD"),
            argument("Формат DDS BAD не поддерживается.")
        );
        assert_eq!(std::fs::read(&keep).unwrap(), b"hello world");
        assert_eq!(call(&keep, "DXT1"), done(136));
        assert_eq!(std::fs::read(&keep).unwrap().len(), 136);

        // Отказ раньше проверки выхода не создаёт каталогов.
        let refused = bench.path("never/made/o.dds");
        assert_eq!(
            call(&refused, "BAD"),
            argument("Формат DDS BAD не поддерживается.")
        );
        assert!(!Path::new(&bench.path("never")).exists());

        // Выход-каталог: системный отказ, каталог цел.
        let adir = bench.path("adir.dds");
        std::fs::create_dir(&adir).unwrap();
        let (line, code) = call(&adir, "DXT1");
        assert_eq!(code, 1);
        assert_eq!(
            line["error"]["code"], "UnauthorizedAccessException",
            "{line}"
        );
        assert!(Path::new(&adir).is_dir());
    }

    /// Результат ложится через черновик рядом: имя черновика занято папкой - запись отказывает,
    /// прежний файл цел. Прямая запись молча перезаписала бы его.
    #[test]
    fn a_result_that_cannot_be_staged_leaves_the_old_file() {
        let bench = Bench::new();
        let input = bench.raw("p4.raw", 4, 4);
        let keep = bench.path("keep.dds");
        let stage = bench.path("keep.dds.shop-stage");
        std::fs::write(&keep, b"hello world").unwrap();
        std::fs::create_dir(&stage).unwrap();
        let args = [
            "--input", &input, "--output", &keep, "--width", "4", "--height", "4", "--format",
            "DXT1", "--mips", "1",
        ];
        let (line, code) = bench.exec(&args);
        assert_eq!(code, 1, "{line}");
        assert_eq!(
            line["error"]["code"], "UnauthorizedAccessException",
            "{line}"
        );
        assert_eq!(std::fs::read(&keep).unwrap(), b"hello world");
        assert!(Path::new(&stage).is_dir());

        // без помехи результат заменяет файл целиком, черновика не остаётся
        std::fs::remove_dir(&stage).unwrap();
        assert_eq!(bench.exec(&args), done(136));
        assert_eq!(std::fs::read(&keep).unwrap().len(), 136);
        assert!(!Path::new(&stage).exists());
    }

    #[test]
    fn option_parsing_errors_beat_the_handler() {
        let bench = Bench::new();
        let input = bench.raw("p8.raw", 8, 8);
        assert_eq!(
            bench.exec(&["--input", &input, "--width"]),
            argument("A value is required for --width.")
        );
        assert_eq!(
            bench.exec(&["--input", "--output", "x.dds"]),
            argument("A value is required for --input.")
        );
        assert_eq!(
            bench.exec(&["stray"]),
            argument("Invalid native option: stray")
        );
    }

    #[test]
    fn a_wrong_expectation_is_caught() {
        // Отрицательный контроль: заниженный размер не должен совпасть.
        assert_ne!(encoded("DXT1", 8, 8, 1).len(), 184);
        assert_ne!(
            encoded("DXT5", 8, 8, 1)[..4],
            *b"DDS\0",
            "магическое слово — «DDS » с пробелом"
        );
    }
}
