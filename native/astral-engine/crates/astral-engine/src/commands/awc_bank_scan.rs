//! `awc-bank-scan`: опись звукового архива игры за один проход.
//!
//! Все банки `.awc` корня архива вынимаются в `<папка>/<банк>/bank.awc` и описываются так же, как
//! описывает один банк `awc-inspect` (`rage_res::awc::describe`). Что команда не вправе описать
//! уверенно (банк зашифрован, многоканальный, с шифрованными потоками или сломан), она не пропускает:
//! весь запуск отказывает словами «пока на хосте», и приложение отдаёт его помощнику. Помощник такой
//! банк изолирует в ответе полем `error`; здесь отдельных ошибок по банкам нет.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use rage_res::{awc, hash};
use rage_rpf::{Archive, EntryCipher, EntryId, EntryKind, FileSource};
use serde_json::{Map, Value};

use super::lamp_archive_scan::ordinal_ignore_case;
use crate::archives::load_keys;
use crate::args::Options;
use crate::error::{EngineError, Result};
use crate::paths;
use crate::progress::Progress;

pub const COMMANDS: &[super::Command] = &[super::Command::new(MODE, awc_bank_scan)];

const MODE: &str = "awc-bank-scan";

/// Сколько банков корня берётся за один запуск (после сортировки и отбора по именам).
const MAX_BANKS: usize = 200;
/// Имя банка в папке выхода: не длиннее 119 знаков, начало — буква или цифра.
const MAX_NAME_LEN: usize = 119;
/// Имя файла банка в своей папке.
const BANK_FILE: &str = "bank.awc";
const EXTENSION: &str = ".awc";
/// Банк, которого движок не разбирает уверенно, остаётся помощнику: слова те же, что у `awc-inspect`.
const NOT_BINARY: &str = "запись архива не двоичный файл — пока на хосте.";
const ZERO_RATE: &str = "поток с нулевой частотой — пока на хосте.";

fn invalid(message: &str) -> EngineError {
    EngineError::invalid_data(message)
}

/// Поля запроса, которые читает команда. Имена свойств сверяются без учёта регистра, как у помощника.
struct Request {
    base_archive: Option<String>,
    output_directory: Option<String>,
    entries: Vec<String>,
    target: Option<String>,
}

impl Request {
    fn load(options: &Options) -> Result<Self> {
        let path = paths::full_path(options.required("request")?)?;
        let text = fs::read_to_string(path)?;
        let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
        let root: Value =
            serde_json::from_str(text).map_err(|_| invalid("RPF request is not JSON."))?;
        let Value::Object(fields) = root else {
            return Err(invalid("RPF request is not an object."));
        };
        let find = |name: &str| {
            fields
                .iter()
                .find(|(key, _)| key.eq_ignore_ascii_case(name))
                .map(|(_, value)| value)
        };
        let text_of = |name: &str| find(name).and_then(Value::as_str).map(str::to_owned);
        let entries = find("scanEntries")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .map(|item| item.as_str().unwrap_or_default().to_owned())
                    .collect()
            })
            .unwrap_or_default();
        Ok(Self {
            base_archive: text_of("baseArchive"),
            output_directory: text_of("scanOutputDirectory"),
            entries,
            target: text_of("archiveTarget"),
        })
    }
}

/// Абсолютный путь: пустой, пробельный или не полностью заданный путь — отказ помощника.
fn absolute(value: &str) -> Result<PathBuf> {
    if value.trim().is_empty() || !Path::new(value).is_absolute() {
        return Err(invalid("Helper paths must be absolute."));
    }
    paths::full_path(value)
}

/// Существующий файл архива с расширением `.rpf`.
fn archive_file(value: Option<&str>) -> Result<PathBuf> {
    let path = absolute(value.unwrap_or_default())?;
    if !path.is_file() {
        return Err(EngineError::file_not_found("Input file not found."));
    }
    let name = path.to_string_lossy().to_lowercase();
    if !name.ends_with(".rpf") {
        return Err(invalid("Expected a .rpf archive."));
    }
    Ok(path)
}

/// Папка выхода: абсолютный путь; конечный разделитель, если он был в запросе, остаётся в ответе.
fn output_directory(value: Option<&str>) -> Result<(PathBuf, String)> {
    let raw = value.unwrap_or_default();
    if raw.trim().is_empty() || !Path::new(raw).is_absolute() {
        return Err(invalid("Absolute directory path required."));
    }
    let path = paths::full_path(raw)?;
    let mut shown = path.display().to_string();
    let ends_with_separator = raw.ends_with(['/', '\\']);
    if ends_with_separator && !shown.ends_with(std::path::MAIN_SEPARATOR) {
        shown.push(std::path::MAIN_SEPARATOR);
    }
    Ok((path, shown))
}

/// Имя архива для читателя: последнее звено `archiveTarget`, а без него имя файла.
fn logical_name(target: Option<&str>, file: &Path) -> Result<String> {
    let cleaned = target.unwrap_or_default().replace('\\', "/");
    let cleaned = cleaned.trim_end_matches('/');
    let name = match cleaned.rsplit('/').next() {
        Some(last) if !cleaned.is_empty() => last.to_owned(),
        _ => file
            .file_name()
            .map(|last| last.to_string_lossy().into_owned())
            .unwrap_or_default(),
    };
    if !name.to_lowercase().ends_with(".rpf") {
        return Err(invalid("Logical RPF target name is missing."));
    }
    Ok(name)
}

/// Имена банков, которые просит приложение: края срезаны, буквы строчные, пустые выброшены.
fn wanted(entries: &[String]) -> HashSet<String> {
    entries
        .iter()
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty())
        .collect()
}

/// Имя банка без `.awc` строчными годится, если оно по шаблону помощника
/// `^[a-z0-9][a-z0-9._-]{0,118}$`.
fn bank_name_fits(name: &str) -> bool {
    let bytes = name.as_bytes();
    let plain = |byte: &u8| byte.is_ascii_lowercase() || byte.is_ascii_digit();
    !bytes.is_empty()
        && bytes.len() <= MAX_NAME_LEN
        && bytes.first().is_some_and(plain)
        && bytes[1..]
            .iter()
            .all(|byte| plain(byte) || matches!(byte, b'.' | b'_' | b'-'))
}

/// Имя кончается на `.awc` в любом регистре.
fn is_bank_file(name: &str) -> bool {
    let bytes = name.as_bytes();
    bytes.len() >= EXTENSION.len()
        && bytes[bytes.len() - EXTENSION.len()..].eq_ignore_ascii_case(EXTENSION.as_bytes())
}

/// Файлы этого запуска: при отказе они убираются, чтобы помощник начал с чистой папки.
#[derive(Default)]
struct Written {
    files: Vec<PathBuf>,
    folders: Vec<PathBuf>,
}

impl Written {
    fn undo(&self) {
        for file in &self.files {
            let _ = fs::remove_file(file);
        }
        for folder in self.folders.iter().rev() {
            let _ = fs::remove_dir(folder);
        }
    }
}

/// Содержимое двоичной записи так, как его читает игра.
fn read_bank(archive: &Archive, id: EntryId) -> Result<Vec<u8>> {
    let entry = archive.entry(id);
    match entry.kind {
        EntryKind::Binary(_) => Ok(archive.decode(id, EntryCipher::ByArchive)?),
        _ => Err(EngineError::invalid_operation(format!(
            "AWC {}: {NOT_BINARY}",
            entry.name
        ))),
    }
}

/// Опись банка, как её отдаёт помощник. `headerBytes` помощник берёт не из таблицы чанков, а из четвёртого слова
/// заголовка (`DataOffset`, байты 12…16): у банков с верным заголовком оно равно концу таблицы, у собранных
/// вручную (нулевое слово) — нет, и тогда ответ помощника другой. Движок повторяет слово как есть.
fn described(bytes: &[u8]) -> Result<Value> {
    let mut resource = awc::describe(BANK_FILE, bytes)?;
    let stored = i32::from_le_bytes([bytes[12], bytes[13], bytes[14], bytes[15]]);
    resource["headerBytes"] = Value::from(stored);
    if let Some(streams) = resource["streams"].as_array_mut() {
        for stream in streams {
            if stream["codec"].is_null() {
                // Поток без формата: помощник отвечает нулевой длительностью, а не пустым значением.
                stream["seconds"] = Value::from(0);
            } else if stream["sampleRate"] == 0 {
                // У помощника такой ответ не собирается (бесконечная длительность), у движка был бы другим.
                return Err(EngineError::invalid_operation(format!(
                    "AWC {BANK_FILE}: {ZERO_RATE}"
                )));
            }
        }
    }
    Ok(resource)
}

/// Кладёт банк в `<папка>/<банк>/bank.awc` через черновик рядом (`write_atomic`): прежний файл цел, пока новый не записан.
fn store(directory: &Path, bytes: &[u8], written: &mut Written) -> Result<PathBuf> {
    if !directory.is_dir() {
        fs::create_dir_all(directory)?;
        written.folders.push(directory.to_path_buf());
    }
    let output = directory.join(BANK_FILE);
    super::shop::write_atomic(&output, bytes)?;
    written.files.push(output.clone());
    Ok(output)
}

/// Одна запись ответа: что вынуто, куда и что в банке.
fn bank_record(entry: &str, bank: &str, output: &Path, bytes: &[u8], resource: Value) -> Value {
    let mut record = Map::with_capacity(6);
    record.insert("entry".into(), entry.into());
    record.insert("bank".into(), bank.into());
    record.insert("output".into(), output.display().to_string().into());
    record.insert("bytes".into(), bytes.len().into());
    record.insert("sha256".into(), hash::sha256_hex(bytes).into());
    record.insert("resource".into(), resource);
    Value::Object(record)
}

fn scan(
    archive: &Archive,
    wanted: &HashSet<String>,
    folder: &Path,
    written: &mut Written,
) -> Result<Vec<Value>> {
    let mut files: Vec<(EntryId, &str)> = archive
        .files(archive.root())
        .iter()
        .map(|&id| (id, archive.entry(id).name.as_str()))
        .filter(|(_, name)| is_bank_file(name))
        .filter(|(_, name)| wanted.is_empty() || wanted.contains(&name.to_lowercase()))
        .collect();
    files.sort_by(|left, right| ordinal_ignore_case(left.1, right.1));
    files.truncate(MAX_BANKS);
    let mut banks = Vec::with_capacity(files.len());
    for (id, name) in files {
        let bank = name[..name.len() - EXTENSION.len()].to_lowercase();
        if !bank_name_fits(&bank) {
            continue;
        }
        let bytes = read_bank(archive, id)?;
        let resource = described(&bytes)?;
        let output = store(&folder.join(&bank), &bytes, written)?;
        banks.push(bank_record(name, &bank, &output, &bytes, resource));
    }
    Ok(banks)
}

pub fn awc_bank_scan(options: &Options, _progress: &Progress) -> Result<Value> {
    let request = Request::load(options)?;
    let (keys, _) = load_keys(
        options.optional("game-root").unwrap_or_default(),
        options.optional("keys"),
    )?;
    let file = archive_file(request.base_archive.as_deref())?;
    let (folder, shown_folder) = output_directory(request.output_directory.as_deref())?;
    let wanted = wanted(&request.entries);
    let name = logical_name(request.target.as_deref(), &file)?;
    let made_folder = !folder.is_dir();
    fs::create_dir_all(&folder)?;
    let mut written = Written::default();
    let opened = FileSource::open(&file)
        .map_err(rage_rpf::RpfError::from)
        .and_then(|source| Archive::open(Arc::new(source), &name, Some(keys)));
    let outcome = match opened {
        Ok(archive) => scan(&archive, &wanted, &folder, &mut written),
        Err(error) => Err(error.into()),
    };
    let banks = match outcome {
        Ok(banks) => banks,
        Err(error) => {
            written.undo();
            if made_folder {
                let _ = fs::remove_dir(&folder);
            }
            return Err(error);
        }
    };
    let mut answer = Map::with_capacity(5);
    answer.insert("status".into(), "ready".into());
    answer.insert("mode".into(), MODE.into());
    answer.insert("archive".into(), file.display().to_string().into());
    answer.insert("outputDirectory".into(), shown_folder.into());
    answer.insert("banks".into(), Value::Array(banks));
    Ok(Value::Object(answer))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::args::Options;
    use crate::error::Result;
    use crate::progress::Progress;
    use rage_res::awc;
    use rage_res::hash;
    use rage_rpf::{write_archive, Body, Compress, Data, DirNode, WriteContext};
    use serde_json::{json, Value};
    use std::fs;
    use std::path::{Path, PathBuf};

    const DATA: u8 = 0x55;
    const FORMAT: u8 = 0xfa;
    const PEAK: u8 = 0x36;

    type Chunk = (u8, Vec<u8>);

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

    /// Плоский банк без шифрованных данных: PCM и ADPCM, пик, индексная таблица.
    fn plain_bank(seed: u8) -> Vec<u8> {
        let pcm: Vec<u8> = (0..128u8).map(|byte| byte.wrapping_add(seed)).collect();
        let adpcm = vec![7u8.wrapping_add(seed); 48];
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
                        (PEAK, (1..=16u8).collect()),
                        (DATA, adpcm),
                        (FORMAT, format_chunk(96, 22050, 4)),
                    ],
                ),
            ],
        )
    }

    /// Банк с шифрованными данными потоков (бит 2 флагов): движок его не разбирает.
    fn sealed_bank() -> Vec<u8> {
        let mut bytes = plain_bank(0);
        bytes[6..8].copy_from_slice(&0xff0bu16.to_le_bytes());
        bytes
    }

    fn write_keys(dir: &Path) {
        let mut state = 0x2545_f491_4f6c_dd1du64;
        let mut fill = |len: usize| -> Vec<u8> {
            (0..len)
                .map(|_| {
                    state ^= state << 13;
                    state ^= state >> 7;
                    state ^= state << 17;
                    (state >> 24) as u8
                })
                .collect()
        };
        fs::create_dir_all(dir).unwrap();
        fs::write(dir.join("gtav_aes_key.dat"), fill(32)).unwrap();
        fs::write(dir.join("gtav_ng_key.dat"), fill(101 * 272)).unwrap();
        fs::write(
            dir.join("gtav_ng_decrypt_tables.dat"),
            fill(17 * 16 * 256 * 4),
        )
        .unwrap();
        fs::write(dir.join("gtav_hash_lut.dat"), fill(256)).unwrap();
    }

    /// Рабочая папка теста: ключи, архив, папка выхода.
    struct Lab {
        dir: tempfile::TempDir,
    }

    impl Lab {
        fn new() -> Self {
            let dir = tempfile::tempdir().unwrap();
            write_keys(&dir.path().join("keys"));
            Lab { dir }
        }

        fn path(&self, name: &str) -> PathBuf {
            self.dir.path().join(name)
        }

        fn out(&self) -> PathBuf {
            self.path("out")
        }

        /// Архив из файлов корня и, при желании, файла в подкаталоге `inner`.
        fn archive(
            &self,
            name: &str,
            files: &[(&str, Vec<u8>)],
            inner: &[(&str, Vec<u8>)],
        ) -> PathBuf {
            let mut root = DirNode::new("");
            for (file, bytes) in files {
                root.put_file(
                    file,
                    Body::Binary {
                        data: Data::memory(bytes.clone()),
                        compress: Compress::Store,
                    },
                )
                .unwrap();
            }
            if !inner.is_empty() {
                let sub = root.ensure_dir("inner").unwrap();
                for (file, bytes) in inner {
                    sub.put_file(
                        file,
                        Body::Binary {
                            data: Data::memory(bytes.clone()),
                            compress: Compress::Store,
                        },
                    )
                    .unwrap();
                }
            }
            let target = self.path(name);
            let mut file = fs::File::create(&target).unwrap();
            let mut context = WriteContext {
                staging: self.dir.path(),
                keys: None,
                finalizer: None,
            };
            write_archive(&root, &mut file, &mut context, &mut |_| {}).unwrap();
            target
        }

        fn run(&self, request: Value) -> Result<Value> {
            self.run_with(request, true)
        }

        fn run_with(&self, request: Value, with_keys: bool) -> Result<Value> {
            let file = self.path("request.json");
            fs::write(&file, request.to_string()).unwrap();
            let mut argv = vec!["--request".to_owned(), file.display().to_string()];
            if with_keys {
                argv.push("--keys".to_owned());
                argv.push(self.path("keys").display().to_string());
            }
            let options = Options::parse(&argv)?;
            awc_bank_scan(&options, &Progress::silent())
        }

        fn scan(&self, archive: &Path, entries: Value) -> Result<Value> {
            self.run(json!({
                "mode": "awc-bank-scan",
                "baseArchive": archive.display().to_string(),
                "scanOutputDirectory": self.out().display().to_string(),
                "scanEntries": entries,
                "edition": "Legacy",
            }))
        }
    }

    fn failure(result: Result<Value>) -> (String, String) {
        let error = result.unwrap_err();
        (error.code, error.message)
    }

    #[test]
    fn the_command_is_registered_by_name() {
        assert!(crate::commands::find("awc-bank-scan").is_some());
    }

    #[test]
    fn plain_banks_are_extracted_and_described_in_host_order() {
        let lab = Lab::new();
        let (zeta, alpha, beta) = (plain_bank(3), plain_bank(1), plain_bank(2));
        let archive = lab.archive(
            "sound.rpf",
            &[
                ("Zeta.awc", zeta.clone()),
                ("alpha.AWC", alpha.clone()),
                ("Beta.awc", beta.clone()),
                ("readme.txt", b"not a bank".to_vec()),
            ],
            &[("deep.awc", plain_bank(9))],
        );
        let answer = lab.scan(&archive, Value::Null).unwrap();
        let keys: Vec<&str> = answer
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(
            keys,
            ["status", "mode", "archive", "outputDirectory", "banks"]
        );
        assert_eq!(answer["status"], "ready");
        assert_eq!(answer["mode"], "awc-bank-scan");
        assert_eq!(answer["archive"], archive.display().to_string());
        assert_eq!(answer["outputDirectory"], lab.out().display().to_string());
        let banks = answer["banks"].as_array().unwrap();
        assert_eq!(banks.len(), 3, "банк подкаталога и текст не входят");
        let expected = [
            ("alpha.AWC", "alpha", &alpha),
            ("Beta.awc", "beta", &beta),
            ("Zeta.awc", "zeta", &zeta),
        ];
        for (item, (entry, name, bytes)) in banks.iter().zip(expected) {
            let order: Vec<&str> = item
                .as_object()
                .unwrap()
                .keys()
                .map(String::as_str)
                .collect();
            assert_eq!(
                order,
                ["entry", "bank", "output", "bytes", "sha256", "resource"]
            );
            assert_eq!(item["entry"], entry);
            assert_eq!(item["bank"], name);
            let output = lab.out().join(name).join("bank.awc");
            assert_eq!(item["output"], output.display().to_string());
            assert_eq!(item["bytes"], bytes.len());
            assert_eq!(item["sha256"], hash::sha256_hex(bytes));
            assert_eq!(fs::read(&output).unwrap(), **bytes);
            // Банки теста собраны вручную: слово `DataOffset` заголовка у них нулевое, и помощник отвечает им.
            let mut expected = awc::describe("bank.awc", bytes).unwrap();
            expected["headerBytes"] = json!(0);
            assert_eq!(item["resource"], expected);
        }
        assert!(!lab.out().join("deep").exists());
    }

    /// Помощник отвечает в `headerBytes` словом заголовка, а не концом таблицы чанков (снято зондом на банках
    /// со словом 77, 68, 5000 и −3: ответ равен слову).
    #[test]
    fn header_bytes_repeat_the_stored_header_word() {
        let lab = Lab::new();
        let mut shifted = plain_bank(1);
        shifted[12..16].copy_from_slice(&77i32.to_le_bytes());
        let mut negative = plain_bank(2);
        negative[12..16].copy_from_slice(&(-3i32).to_le_bytes());
        let mut honest = plain_bank(3);
        honest[12..16].copy_from_slice(&68i32.to_le_bytes());
        let archive = lab.archive(
            "sound.rpf",
            &[
                ("a_shifted.awc", shifted),
                ("b_negative.awc", negative),
                ("c_honest.awc", honest),
            ],
            &[],
        );
        let answer = lab.scan(&archive, Value::Null).unwrap();
        let shown: Vec<i64> = answer["banks"]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item["resource"]["headerBytes"].as_i64().unwrap())
            .collect();
        assert_eq!(shown, [77, -3, 68]);
    }

    /// Поток без формата: помощник отвечает `seconds: 0`; поток с нулевой частотой помощник не может записать в ответ.
    #[test]
    fn streams_without_a_format_have_zero_seconds_and_zero_rate_defers() {
        let lab = Lab::new();
        let without = bank(1, 0xff01, &[(0x5004, vec![(DATA, vec![1, 2, 3, 4])])]);
        let zero_rate = bank(
            1,
            0xff01,
            &[(
                0x5001,
                vec![(DATA, vec![0; 64]), (FORMAT, format_chunk(32, 0, 0))],
            )],
        );
        let archive = lab.archive("a.rpf", &[("no_format.awc", without)], &[]);
        let answer = lab.scan(&archive, Value::Null).unwrap();
        let stream = &answer["banks"][0]["resource"]["streams"][0];
        assert_eq!(stream["seconds"], 0);
        assert!(stream["codec"].is_null());
        let archive = lab.archive("b.rpf", &[("rate_zero.awc", zero_rate)], &[]);
        let (code, message) = failure(lab.scan(&archive, Value::Null));
        assert_eq!(code, "InvalidOperationException");
        assert_eq!(
            message,
            "AWC bank.awc: поток с нулевой частотой — пока на хосте."
        );
    }

    #[test]
    fn the_entry_filter_trims_and_lowercases_names() {
        let lab = Lab::new();
        let archive = lab.archive(
            "sound.rpf",
            &[
                ("one.awc", plain_bank(1)),
                ("Two.awc", plain_bank(2)),
                ("three.awc", plain_bank(3)),
            ],
            &[],
        );
        let answer = lab
            .scan(
                &archive,
                json!(["  TWO.awc ", "", "   ", null, "missing.awc", "one.awc"]),
            )
            .unwrap();
        let names: Vec<&str> = answer["banks"]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item["bank"].as_str().unwrap())
            .collect();
        assert_eq!(names, ["one", "two"]);
        assert!(!lab.out().join("three").exists());
        // Пустой список равен «все».
        let all = lab.scan(&archive, json!([])).unwrap();
        assert_eq!(all["banks"].as_array().unwrap().len(), 3);
        let blanks = lab.scan(&archive, json!(["", "  "])).unwrap();
        assert_eq!(blanks["banks"].as_array().unwrap().len(), 3);
    }

    #[test]
    fn two_hundred_names_are_taken_before_the_name_pattern_is_checked() {
        let lab = Lab::new();
        let mut files: Vec<(String, Vec<u8>)> = (0..=200)
            .map(|number| (format!("bank{number:03}.awc"), plain_bank(1)))
            .collect();
        files.push(("bad name.awc".to_owned(), plain_bank(2)));
        files.push((format!("{}.awc", "x".repeat(120)), plain_bank(3)));
        let borrowed: Vec<(&str, Vec<u8>)> = files
            .iter()
            .map(|(name, bytes)| (name.as_str(), bytes.clone()))
            .collect();
        let archive = lab.archive("many.rpf", &borrowed, &[]);
        let answer = lab.scan(&archive, Value::Null).unwrap();
        let banks = answer["banks"].as_array().unwrap();
        // 203 файла; первые 200 по порядку: «bad name», bank000…bank198, потом
        // bank199, bank200 и длинное имя остаются за пределом.
        assert_eq!(banks.len(), 199);
        assert_eq!(banks[0]["bank"], "bank000");
        assert_eq!(banks[198]["bank"], "bank198");
        assert!(!lab.out().join("bad name").exists());
    }

    #[test]
    fn requests_are_refused_with_the_host_texts() {
        let lab = Lab::new();
        let archive = lab.archive("sound.rpf", &[("one.awc", plain_bank(1))], &[]);
        let out = lab.out().display().to_string();
        let good = archive.display().to_string();
        let text = lab.path("note.zip");
        fs::write(&text, b"x").unwrap();
        let cases: [(Value, &str, &str); 7] = [
            (
                json!({"baseArchive": null, "scanOutputDirectory": out}),
                "InvalidDataException",
                "Helper paths must be absolute.",
            ),
            (
                json!({"baseArchive": "sound.rpf", "scanOutputDirectory": out}),
                "InvalidDataException",
                "Helper paths must be absolute.",
            ),
            (
                json!({"baseArchive": lab.path("nope.rpf").display().to_string(), "scanOutputDirectory": out}),
                "FileNotFoundException",
                "Input file not found.",
            ),
            (
                json!({"baseArchive": text.display().to_string(), "scanOutputDirectory": out}),
                "InvalidDataException",
                "Expected a .rpf archive.",
            ),
            (
                json!({"baseArchive": good, "scanOutputDirectory": "out"}),
                "InvalidDataException",
                "Absolute directory path required.",
            ),
            (
                json!({"baseArchive": good, "scanOutputDirectory": "   "}),
                "InvalidDataException",
                "Absolute directory path required.",
            ),
            (
                json!({"baseArchive": good, "scanOutputDirectory": out, "archiveTarget": "x/y.zip"}),
                "InvalidDataException",
                "Logical RPF target name is missing.",
            ),
        ];
        for (request, code, message) in cases {
            assert_eq!(
                failure(lab.run(request.clone())),
                (code.to_owned(), message.to_owned()),
                "{request}"
            );
        }
        assert!(
            !lab.out().exists(),
            "отказ до начала не создаёт папку выхода"
        );
    }

    #[test]
    fn a_request_that_is_not_json_or_not_an_object_is_refused() {
        let lab = Lab::new();
        let file = lab.path("request.json");
        let run = |body: &str| {
            fs::write(&file, body).unwrap();
            let argv = vec![
                "--request".to_owned(),
                file.display().to_string(),
                "--keys".to_owned(),
                lab.path("keys").display().to_string(),
            ];
            awc_bank_scan(&Options::parse(&argv).unwrap(), &Progress::silent())
        };
        assert_eq!(failure(run("{")).1, "RPF request is not JSON.");
        assert_eq!(failure(run("[]")).1, "RPF request is not an object.");
    }

    #[test]
    fn property_names_are_matched_without_case() {
        let lab = Lab::new();
        let archive = lab.archive("sound.rpf", &[("one.awc", plain_bank(1))], &[]);
        let answer = lab
            .run(json!({
                "BASEARCHIVE": archive.display().to_string(),
                "ScanOutputDirectory": lab.out().display().to_string(),
                "SCANENTRIES": ["ONE.AWC"],
            }))
            .unwrap();
        assert_eq!(answer["banks"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn without_keys_the_scan_refuses_before_touching_the_archive() {
        let lab = Lab::new();
        let archive = lab.archive("sound.rpf", &[("one.awc", plain_bank(1))], &[]);
        let result = lab.run_with(
            json!({
                "baseArchive": archive.display().to_string(),
                "scanOutputDirectory": lab.out().display().to_string(),
            }),
            false,
        );
        assert!(result.is_err());
        assert!(!lab.out().exists());
    }

    #[test]
    fn a_bank_the_engine_cannot_read_refuses_the_whole_scan_and_leaves_nothing() {
        let lab = Lab::new();
        let archive = lab.archive(
            "sound.rpf",
            &[("a_ok.awc", plain_bank(1)), ("b_sealed.awc", sealed_bank())],
            &[],
        );
        let (code, message) = failure(lab.scan(&archive, Value::Null));
        assert_eq!(code, "InvalidOperationException");
        assert_eq!(
            message,
            "AWC bank.awc: зашифрованный или многоканальный банк — пока на хосте."
        );
        assert!(
            !lab.out().join("a_ok").exists(),
            "файлы этого запуска убраны"
        );
        assert!(!lab.out().join("b_sealed").exists());
    }

    #[test]
    fn a_whole_file_encrypted_and_a_truncated_bank_refuse_as_well() {
        let lab = Lab::new();
        let mut foreign = plain_bank(1);
        foreign[..4].copy_from_slice(b"\x7fELF");
        let sealed = lab.archive("sealed.rpf", &[("x.awc", foreign)], &[]);
        assert_eq!(
            failure(lab.scan(&sealed, Value::Null)).1,
            "AWC bank.awc: зашифрованный или многоканальный банк — пока на хосте."
        );
        let short = lab.archive("short.rpf", &[("x.awc", vec![1, 2, 3])], &[]);
        assert_eq!(
            failure(lab.scan(&short, Value::Null)),
            (
                "InvalidOperationException".to_owned(),
                "Файл короче заголовка AWC.".to_owned()
            )
        );
        assert!(!lab.out().join("x").exists());
    }

    #[test]
    fn an_earlier_bank_file_is_replaced_and_no_staging_file_stays() {
        let lab = Lab::new();
        let folder = lab.out().join("one");
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join("bank.awc"), b"old").unwrap();
        let bytes = plain_bank(5);
        let archive = lab.archive("sound.rpf", &[("one.awc", bytes.clone())], &[]);
        lab.scan(&archive, Value::Null).unwrap();
        assert_eq!(fs::read(folder.join("bank.awc")).unwrap(), bytes);
        let names: Vec<String> = fs::read_dir(&folder)
            .unwrap()
            .map(|item| item.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, ["bank.awc"]);
    }

    #[test]
    fn an_archive_without_banks_gives_an_empty_list() {
        let lab = Lab::new();
        let archive = lab.archive("sound.rpf", &[("readme.txt", b"x".to_vec())], &[]);
        let answer = lab.scan(&archive, Value::Null).unwrap();
        assert_eq!(answer["banks"], json!([]));
        assert!(lab.out().is_dir(), "папку выхода помощник создаёт всегда");
    }

    #[test]
    fn the_archive_target_names_the_archive_for_the_reader() {
        let lab = Lab::new();
        let archive = lab.archive("sound.rpf", &[("one.awc", plain_bank(1))], &[]);
        let answer = lab
            .run(json!({
                "baseArchive": archive.display().to_string(),
                "scanOutputDirectory": lab.out().display().to_string(),
                "archiveTarget": "x64/audio/sfx/RESIDENT.rpf",
            }))
            .unwrap();
        assert_eq!(answer["banks"].as_array().unwrap().len(), 1);
    }

    /// Сборка банка движком: те же чанки, что у настоящих банков, но своя раскладка.
    fn encoded(version: u16, flags: u16, streams: &[(u32, Vec<Chunk>)]) -> Vec<u8> {
        let streams: Vec<awc::NewStream> = streams
            .iter()
            .map(|(id, chunks)| awc::NewStream {
                id: *id,
                chunks: chunks.clone(),
            })
            .collect();
        awc::encode(version, flags, &streams).unwrap()
    }

    /// Архивы для сверки с помощником (`parity/host-port/awc-bank-scan/compare.mjs`): сами записываются
    /// только по просьбе — `ASTRAL_PARITY_FIXTURES=<папка>`.
    /// `cargo test -p astral-engine --lib write_parity_fixtures -- --ignored`.
    #[test]
    #[ignore = "пишет архивы для сверки; нужен ASTRAL_PARITY_FIXTURES"]
    fn write_parity_fixtures() {
        let Some(target) = std::env::var_os("ASTRAL_PARITY_FIXTURES").map(PathBuf::from) else {
            eprintln!("пропущен: нет ASTRAL_PARITY_FIXTURES");
            return;
        };
        fs::create_dir_all(&target).unwrap();
        let samples = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../parity/awc/plain");
        let repo = |name: &str| fs::read(samples.join(name)).unwrap();
        let pcm = |len: usize, seed: u8| -> Vec<u8> {
            (0..len)
                .map(|n| (n as u8).wrapping_mul(7).wrapping_add(seed))
                .collect()
        };
        let shapes: Vec<(&str, Vec<u8>)> = vec![
            ("Alpha.awc", repo("synthetic-01.awc")),
            ("beta.AWC", repo("synthetic-02.awc")),
            ("gamma_3.awc", repo("synthetic-03.awc")),
            (
                "pcm_only.awc",
                encoded(
                    1,
                    0xff01,
                    &[
                        (
                            0x1001,
                            vec![(DATA, pcm(512, 1)), (FORMAT, format_chunk(256, 32000, 0))],
                        ),
                        (
                            0x1002,
                            vec![(DATA, pcm(64, 2)), (FORMAT, format_chunk(32, 11025, 0))],
                        ),
                    ],
                ),
            ),
            (
                "adpcm_peak.awc",
                encoded(
                    1,
                    0xff01,
                    &[(
                        0x2001,
                        vec![
                            (DATA, pcm(2048, 3)),
                            (FORMAT, format_chunk(4000, 22050, 4)),
                            (PEAK, pcm(480, 9)),
                        ],
                    )],
                ),
            ),
            (
                "no_format.awc",
                encoded(0, 0xff00, &[(0x3001, vec![(DATA, pcm(100, 4))])]),
            ),
            ("empty.awc", bank(1, 0xff01, &[])),
            ("dots.v1.awc", plain_bank(11)),
            ("dash-name.awc", plain_bank(12)),
            ("UPPER.awc", plain_bank(13)),
            ("bad name.awc", plain_bank(14)),
            ("readme.txt", b"not a bank".to_vec()),
        ];
        let named: Vec<(&str, Vec<u8>)> = shapes.clone();
        let inner = [("deep.awc", plain_bank(21))];
        let lab = Lab {
            dir: tempfile::tempdir().unwrap(),
        };
        let build = |name: &str, files: &[(&str, Vec<u8>)], inner: &[(&str, Vec<u8>)]| {
            let made = lab.archive(name, files, inner);
            fs::copy(&made, target.join(name)).unwrap();
        };
        build("plain-mix.rpf", &named, &inner);
        build(
            "sealed-mix.rpf",
            &[
                ("a_plain.awc", plain_bank(1)),
                ("b_sealed.awc", sealed_bank()),
                ("c_plain.awc", plain_bank(2)),
            ],
            &[],
        );
        let many: Vec<(String, Vec<u8>)> = (0..205)
            .map(|number| (format!("bank{number:03}.awc"), plain_bank(number as u8)))
            .collect();
        let many: Vec<(&str, Vec<u8>)> = many
            .iter()
            .map(|(name, bytes)| (name.as_str(), bytes.clone()))
            .collect();
        build("many.rpf", &many, &[]);
        build("no-banks.rpf", &[("readme.txt", b"x".to_vec())], &[]);
        build("truncated-bank.rpf", &[("x.awc", vec![1, 2, 3])], &[]);
        let zero_rate = bank(
            1,
            0xff01,
            &[(
                0x5001,
                vec![(DATA, pcm(64, 1)), (FORMAT, format_chunk(32, 0, 0))],
            )],
        );
        build("zero-rate.rpf", &[("rate_zero.awc", zero_rate)], &[]);
        println!("записано в {}", target.display());
    }

    // ------------------------------------------------------------------
    // Настоящие архивы игры: нужны `ASTRAL_TEST_GAME` и `ASTRAL_TEST_KEYS`, иначе тесты пропускаются.
    // ------------------------------------------------------------------

    fn real_game() -> Option<(PathBuf, PathBuf)> {
        let game = std::env::var_os("ASTRAL_TEST_GAME").map(PathBuf::from)?;
        let keys = std::env::var_os("ASTRAL_TEST_KEYS").map(PathBuf::from)?;
        (game.join("x64/audio/sfx").is_dir() && keys.is_dir()).then_some((game, keys))
    }

    fn scan_real(game: &Path, keys: &Path, archive: &str, out: &Path) -> Result<Value> {
        let lab = tempfile::tempdir().unwrap();
        let request = lab.path().join("request.json");
        let file = game.join("x64/audio/sfx").join(archive);
        fs::write(
            &request,
            json!({
                "baseArchive": file.display().to_string(),
                "scanOutputDirectory": out.display().to_string(),
                "scanEntries": null,
            })
            .to_string(),
        )
        .unwrap();
        let argv = vec![
            "--request".to_owned(),
            request.display().to_string(),
            "--keys".to_owned(),
            keys.display().to_string(),
        ];
        awc_bank_scan(&Options::parse(&argv).unwrap(), &Progress::silent())
    }

    /// Каждый банк оружия игры зашифрован целиком: запуск отказывает и не оставляет файлов.
    #[test]
    fn real_weapon_banks_are_sealed_and_the_scan_defers_to_the_host() {
        let Some((game, keys)) = real_game() else {
            eprintln!("пропущен: нет ASTRAL_TEST_GAME и ASTRAL_TEST_KEYS");
            return;
        };
        let out = tempfile::tempdir().unwrap();
        let target = out.path().join("scan");
        for archive in ["WEAPONS_PLAYER.rpf", "RESIDENT.rpf"] {
            let error = scan_real(&game, &keys, archive, &target).unwrap_err();
            assert_eq!(error.code, "InvalidOperationException", "{archive}");
            assert_eq!(
                error.message,
                "AWC bank.awc: зашифрованный или многоканальный банк — пока на хосте.",
                "{archive}"
            );
            assert!(!target.exists(), "{archive}: файлы запуска убраны");
        }
    }

    /// Каким видом банка встретил движок каждый `.awc` корня каждого звукового архива игры.
    /// Печатает таблицу: `cargo test -p astral-engine --lib real_game_sound_banks_by_kind -- --ignored --nocapture`.
    #[test]
    #[ignore = "читает все звуковые архивы игры (около 17 ГБ); запускать с --ignored --nocapture"]
    fn real_game_sound_banks_by_kind() {
        use std::collections::BTreeMap;
        let Some((game, keys)) = real_game() else {
            eprintln!("пропущен: нет ASTRAL_TEST_GAME и ASTRAL_TEST_KEYS");
            return;
        };
        let (keyset, _) = load_keys("", keys.to_str()).unwrap();
        let mut folder: Vec<_> = fs::read_dir(game.join("x64/audio/sfx"))
            .unwrap()
            .map(|item| item.unwrap().path())
            .filter(|path| {
                path.extension()
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("rpf"))
            })
            .collect();
        folder.sort();
        let mut total: BTreeMap<String, usize> = BTreeMap::new();
        for path in folder {
            let archive = Archive::open_path(&path, Some(keyset.clone())).unwrap();
            let mut kinds: BTreeMap<String, usize> = BTreeMap::new();
            for &id in archive.files(archive.root()) {
                if !is_bank_file(&archive.entry(id).name) {
                    continue;
                }
                let bytes = archive.decode(id, EntryCipher::ByArchive).unwrap();
                let kind = match awc::describe(BANK_FILE, &bytes) {
                    Ok(_) => "plain, described".to_owned(),
                    Err(error) if bytes.len() >= 8 && &bytes[..4] == b"ADAT" => format!(
                        "ADAT flags {:04X}: {}",
                        u16::from_le_bytes([bytes[6], bytes[7]]),
                        error.message
                    ),
                    Err(error) if bytes.len() >= 4 && &bytes[..4] == b"TADA" => {
                        format!("console bank: {}", error.message)
                    }
                    Err(_) => "whole file sealed (foreign magic)".to_owned(),
                };
                *kinds.entry(kind).or_default() += 1;
            }
            let name = path.file_name().unwrap().to_string_lossy().into_owned();
            for (kind, count) in &kinds {
                println!("{name}: {count} x {kind}");
                *total.entry(kind.clone()).or_default() += count;
            }
        }
        for (kind, count) in &total {
            println!("ALL: {count} x {kind}");
        }
    }
}
