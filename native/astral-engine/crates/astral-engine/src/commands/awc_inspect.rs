//! `awc-inspect`: опись плоского звукового банка `.awc`.
//!
//! Модуль ничего не разбирает сам: проверяет путь, читает файл целиком и
//! отдаёт его разбору `rage_res::awc`. Ответ собирается из пяти полей.

pub const COMMANDS: &[super::Command] = &[super::Command::new("awc-inspect", awc_inspect)];

fn awc_inspect(
    options: &crate::args::Options,
    _progress: &crate::progress::Progress,
) -> crate::error::Result<serde_json::Value> {
    // Порядок: параметр, путь (пусто, файл, расширение), чтение, разбор банка.
    let wanted = options.required("input")?;
    let path = crate::paths::existing_file(wanted, &[".awc"])?;
    let bytes = std::fs::read(&path)?;
    let resource = rage_res::awc::describe(&file_label(&path), &bytes)?;
    Ok(Card {
        path,
        bytes,
        resource,
    }
    .into_answer())
}

/// Входной файл с уже готовой описью банка.
struct Card {
    path: std::path::PathBuf,
    bytes: Vec<u8>,
    resource: serde_json::Value,
}

impl Card {
    /// Ключи ответа идут в порядке вставки: статус, режим, путь, сумма, опись.
    fn into_answer(self) -> serde_json::Value {
        let sha256 = rage_res::hash::sha256_hex(&self.bytes);
        let mut answer = serde_json::Map::with_capacity(5);
        answer.insert(String::from("status"), "ready".into());
        answer.insert(String::from("mode"), "awc-inspect".into());
        answer.insert(
            String::from("input"),
            self.path.display().to_string().into(),
        );
        answer.insert(String::from("sha256"), sha256.into());
        answer.insert(String::from("resource"), self.resource);
        answer.into()
    }
}

/// Имя файла как написано в пути; непредставимые знаки заменяются.
fn file_label(path: &std::path::Path) -> String {
    match path.file_name() {
        Some(name) => name.to_string_lossy().to_string(),
        None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::args::Options;
    use crate::error::Result;
    use crate::progress::Progress;
    use rage_res::hash;
    use serde_json::json;
    use serde_json::Value;
    use std::fs;
    use std::path::Path;

    /// Описание чанка потока для сборки тестового банка: (тип, содержимое).
    type Chunk = (u8, Vec<u8>);

    const DATA: u8 = 0x55;
    const FORMAT: u8 = 0xfa;
    const PEAK: u8 = 0x36;

    fn format_chunk(samples: u32, rate: u16, codec: u8) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend(samples.to_le_bytes());
        out.extend(0i32.to_le_bytes());
        out.extend(rate.to_le_bytes());
        out.extend(0i16.to_le_bytes());
        out.extend([0u8; 6]);
        out.push(0);
        out.push(codec);
        out
    }

    /// Плоский банк по описанию структуры: оглавление, затем данные подряд.
    fn bank(version: u16, flags: u16, streams: &[(u32, Vec<Chunk>)]) -> Vec<u8> {
        let table: usize = streams.iter().map(|(_, chunks)| 4 + chunks.len() * 8).sum();
        let indices = if flags & 1 != 0 { streams.len() * 2 } else { 0 };
        let mut at = 16 + indices + table;
        let mut head = Vec::new();
        head.extend(b"ADAT");
        head.extend(version.to_le_bytes());
        head.extend(flags.to_le_bytes());
        head.extend((streams.len() as i32).to_le_bytes());
        head.extend(0i32.to_le_bytes());
        head.resize(head.len() + indices, 0);
        let mut tail: Vec<u8> = Vec::new();
        let mut chunk_words: Vec<u8> = Vec::new();
        for (id, chunks) in streams {
            head.extend((id | ((chunks.len() as u32) << 29)).to_le_bytes());
            for (kind, body) in chunks {
                let low = (at as u32 & 0x0fff_ffff) | (((body.len() & 15) as u32) << 28);
                let high = (*kind as u32) << 24 | (body.len() >> 4) as u32;
                chunk_words.extend(low.to_le_bytes());
                chunk_words.extend(high.to_le_bytes());
                tail.extend(body);
                at += body.len();
            }
        }
        head.extend(chunk_words);
        head.extend(tail);
        head
    }

    fn run_with(dir: &Path, args: &[&str]) -> Result<Value> {
        let argv: Vec<String> = args
            .iter()
            .map(|arg| arg.replace("{D}", &dir.display().to_string()))
            .collect();
        let options = Options::parse(&argv)?;
        awc_inspect(&options, &Progress::silent())
    }

    fn sample_bank() -> Vec<u8> {
        let pcm: Vec<u8> = (0..128u8).collect();
        let adpcm = vec![7u8; 48];
        bank(
            255,
            0xff01,
            &[
                (
                    0x28,
                    vec![(DATA, pcm), (FORMAT, format_chunk(64, 11025, 0))],
                ),
                (
                    0x29,
                    vec![
                        (
                            PEAK,
                            vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
                        ),
                        (DATA, adpcm),
                        (FORMAT, format_chunk(96, 22050, 4)),
                    ],
                ),
            ],
        )
    }

    #[test]
    fn answer_has_five_keys_in_order() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("synthetic.awc");
        let bytes = sample_bank();
        fs::write(&file, &bytes).unwrap();
        let value = run_with(dir.path(), &["--input", "{D}/synthetic.awc"]).unwrap();
        let keys: Vec<&str> = value
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(keys, ["status", "mode", "input", "sha256", "resource"]);
        assert_eq!(value["status"], "ready");
        assert_eq!(value["mode"], "awc-inspect");
        assert_eq!(value["input"], file.display().to_string());
        assert_eq!(value["sha256"], hash::sha256_hex(&bytes));
        let resource = &value["resource"];
        assert_eq!(resource["name"], "synthetic.awc");
        assert_eq!(resource["streamCount"], 2);
        assert_eq!(resource["version"], 255);
        assert_eq!(resource["flags"], 65281);
        assert_eq!(resource["streams"][0]["name"], "0x00000028");
        assert_eq!(resource["streams"][0]["type"], "PCM, 11025 Hz");
        assert_eq!(
            resource["streams"][1]["chunks"],
            json!(["peak", "data", "format"])
        );
        assert_eq!(resource["streams"][1]["codec"], "ADPCM");
    }

    #[test]
    fn name_keeps_case_and_unicode() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("UPPER.AWC"), sample_bank()).unwrap();
        fs::write(dir.path().join("звук ё.awc"), sample_bank()).unwrap();
        let upper = run_with(dir.path(), &["--input", "{D}/UPPER.AWC"]).unwrap();
        assert_eq!(upper["resource"]["name"], "UPPER.AWC");
        let unicode = run_with(dir.path(), &["--input", "{D}/звук ё.awc"]).unwrap();
        assert_eq!(unicode["resource"]["name"], "звук ё.awc");
    }

    #[test]
    fn dotdot_and_repeat_are_resolved_like_the_old_engine() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("b")).unwrap();
        fs::write(dir.path().join("b").join("in.awc"), sample_bank()).unwrap();
        let value = run_with(dir.path(), &["--input", "{D}/a/../b/in.awc"]).unwrap();
        assert_eq!(value["resource"]["name"], "in.awc");
        assert_eq!(
            value["input"],
            dir.path().join("b").join("in.awc").display().to_string()
        );
        let twice = run_with(
            dir.path(),
            &["--INPUT", "{D}/zzz.awc", "--input", "{D}/b/in.awc"],
        )
        .unwrap();
        assert_eq!(twice["resource"]["name"], "in.awc");
    }

    fn failure(dir: &Path, args: &[&str]) -> (String, String) {
        let error = run_with(dir, args).unwrap_err();
        (error.code, error.message)
    }

    #[test]
    fn argument_and_path_refusals() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("not-awc.txt"), b"x").unwrap();
        fs::write(dir.path().join("no-extension"), b"x").unwrap();
        fs::write(dir.path().join("a.awc "), sample_bank()).unwrap();
        fs::create_dir(dir.path().join("dir.awc")).unwrap();
        let d = dir.path().display().to_string();

        let blank = failure(dir.path(), &["--input", "   "]);
        assert_eq!(
            blank,
            ("ArgumentException".into(), "The path is empty.".into())
        );
        let empty = failure(dir.path(), &["--input", ""]);
        assert_eq!(empty.1, "The path is empty.");

        let missing = run_with(dir.path(), &[]).unwrap_err();
        assert_eq!(missing.message, "--input is required.");
        let no_value = Options::parse(&["--input".to_owned()]).unwrap_err();
        assert_eq!(no_value.message, "A value is required for --input.");

        let dir_awc = failure(dir.path(), &["--input", "{D}/dir.awc"]);
        assert_eq!(dir_awc.0, "FileNotFoundException");
        assert_eq!(
            dir_awc.1,
            format!("File was not found: {d}\\dir.awc")
                .replace('\\', std::path::MAIN_SEPARATOR_STR)
        );

        assert_eq!(
            failure(dir.path(), &["--input", "{D}/not-awc.txt"]).1,
            "Unsupported file extension: .txt"
        );
        assert_eq!(
            failure(dir.path(), &["--input", "{D}/no-extension"]).1,
            "Unsupported file extension: "
        );
        assert_eq!(
            failure(dir.path(), &["--input", "{D}/a.awc "]).1,
            "Unsupported file extension: .awc "
        );
        assert_eq!(
            failure(dir.path(), &["--input", "{D}/nope.txt"]).0,
            "FileNotFoundException"
        );
    }

    fn bad_bank(name: &str, bytes: &[u8]) -> (String, String) {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(name), bytes).unwrap();
        failure(dir.path(), &["--input", &format!("{{D}}/{name}")])
    }

    #[test]
    fn broken_banks_refuse_with_invalid_operation() {
        let op = "InvalidOperationException";
        assert_eq!(
            bad_bank("x-short.awc", &[1, 2, 3]),
            (op.into(), "Файл короче заголовка AWC.".into())
        );
        let mut big = sample_bank();
        big[..4].copy_from_slice(b"TADA");
        assert_eq!(
            bad_bank("x-bigendian.awc", &big),
            (
                op.into(),
                "Банк консольной версии игры (big-endian).".into()
            )
        );
        let mut foreign = sample_bank();
        foreign[..4].copy_from_slice(b"RIFF");
        assert_eq!(
            bad_bank("x-encrypted.awc", &foreign).1,
            "AWC x-encrypted.awc: зашифрованный или многоканальный банк — пока на хосте."
        );
        for (name, flags) in [
            ("x-flag-multi.awc", 4u16),
            ("x-flag-single-enc.awc", 2),
            ("x-flag-multi-enc.awc", 8),
        ] {
            let mut bytes = sample_bank();
            bytes[6..8].copy_from_slice(&(0xff01u16 | flags).to_le_bytes());
            assert_eq!(
                bad_bank(name, &bytes).1,
                format!("AWC {name}: зашифрованный или многоканальный банк — пока на хосте.")
            );
        }
        let mut count = sample_bank();
        count[8..12].copy_from_slice(&4097i32.to_le_bytes());
        assert_eq!(
            bad_bank("c.awc", &count).1,
            "Невозможное число потоков: 4097."
        );
        count[8..12].copy_from_slice(&(-1i32).to_le_bytes());
        assert_eq!(
            bad_bank("c.awc", &count).1,
            "Невозможное число потоков: -1."
        );
        count[8..12].copy_from_slice(&4096i32.to_le_bytes());
        assert_eq!(bad_bank("c.awc", &count).1, "Чтение за концом банка AWC.");
    }

    #[test]
    fn chunk_past_end_names_the_stream() {
        let mut bytes = sample_bank();
        let new_len = bytes.len() - 10;
        bytes.truncate(new_len);
        assert_eq!(
            bad_bank("x-chunk-out.awc", &bytes),
            (
                "InvalidOperationException".into(),
                "Чанк потока 0X00000029 выходит за конец файла.".into()
            )
        );
    }

    #[test]
    fn trailing_bytes_are_ignored() {
        let dir = tempfile::tempdir().unwrap();
        let mut bytes = sample_bank();
        let plain = {
            fs::write(dir.path().join("a.awc"), &bytes).unwrap();
            run_with(dir.path(), &["--input", "{D}/a.awc"]).unwrap()
        };
        bytes.extend([9u8; 33]);
        fs::write(dir.path().join("b.awc"), &bytes).unwrap();
        let tail = run_with(dir.path(), &["--input", "{D}/b.awc"]).unwrap();
        assert_eq!(
            plain["resource"]["contentBytes"],
            tail["resource"]["contentBytes"]
        );
        assert_eq!(
            plain["resource"]["headerBytes"],
            tail["resource"]["headerBytes"]
        );
        assert_ne!(plain["sha256"], tail["sha256"]);
    }
}
