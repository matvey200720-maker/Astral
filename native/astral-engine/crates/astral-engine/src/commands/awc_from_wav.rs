//! `awc-stream-from-wav` и `awc-layer-from-wav`: звуковой банк `.awc` прямо из WAV.
//!
//! Кодирование, поля формата и пики делает `rage_res::awc_build`. Здесь читаются
//! файлы, шаблоны потока переводятся из JSON в `StreamTemplate`, банк пишется на
//! диск одним переименованием. Числа читаются через `as_i64`; что не помещается
//! в поле формата, отказывает.

use crate::error::EngineError;
use rage_res::awc_build;
use serde_json::Value as Json;

type Outcome<T> = crate::error::Result<T>;

pub const COMMANDS: &[super::Command] = &[
    super::Command::new("awc-stream-from-wav", awc_stream_from_wav),
    super::Command::new("awc-layer-from-wav", awc_layer_from_wav),
];

fn awc_stream_from_wav(
    options: &crate::args::Options,
    _progress: &crate::progress::Progress,
) -> Outcome<Json> {
    let wav_path = existing(options, "wav", ".wav")?;
    let template_path = existing(options, "template", ".json")?;
    let target = Target::claim(options)?;

    let doc = read_json(&template_path, "Шаблон потока пустой или сломан.")?;
    let parsed = parse_template(&doc)?;
    // Номер версии спрашивается последним из чисел шаблона.
    let version = field::<u16>(&doc, "version")?;
    let chunk_indices = doc["chunkIndices"].as_bool() == Some(true);

    let sound = Sound::load(&wav_path)?;
    let stream = awc_build::stream_from_wav(&parsed, &sound.bytes)?;
    let bank = awc_build::bank_of_stream(version, chunk_indices, &stream)?;
    target.deliver(
        "awc-stream-from-wav",
        vec![
            ("id", hex_id(parsed.id).into()),
            ("codec", name_of(&CODEC_CODES, parsed.codec).into()),
            ("sampleRate", sound.rate.into()),
            ("samples", parsed.samples.into()),
        ],
        &bank,
    )
}

fn awc_layer_from_wav(
    options: &crate::args::Options,
    _progress: &crate::progress::Progress,
) -> Outcome<Json> {
    let request_path = existing(options, "request", ".json")?;
    let target = Target::claim(options)?;

    let doc = read_json(&request_path, "Запрос слоя пустой или сломан.")?;
    let version = field::<u16>(&doc, "version")?;
    let chunk_indices = doc["chunkIndices"].as_bool() == Some(true);
    let Some(entries) = doc["streams"].as_array() else {
        return Err(EngineError::argument("В запросе слоя нет списка потоков."));
    };

    // Каждая запись разбирается и собирается целиком, прежде чем начнётся следующая.
    let streams = entries
        .iter()
        .map(layer_stream)
        .collect::<Result<Vec<_>, _>>()?;
    // Идентификаторы в ответе идут в порядке запроса, до сортировки банком.
    let ids = streams
        .iter()
        .map(|stream| Json::String(hex_id(stream.id)))
        .collect();
    let bank = awc_build::bank_of_streams(version, chunk_indices, &streams)?;
    target.deliver(
        "awc-layer-from-wav",
        vec![("streams", Json::Array(ids))],
        &bank,
    )
}

/// Существующий входной файл с нужным расширением.
fn existing(
    options: &crate::args::Options,
    name: &str,
    extension: &str,
) -> Outcome<std::path::PathBuf> {
    crate::paths::existing_file(options.required(name)?, &[extension])
}

// ---------------------------------------------------------------------------
// Выход.
// ---------------------------------------------------------------------------

/// Выходной файл вместе со стражем каталогов, созданных ради него.
struct Target {
    fresh: super::fresh_dirs::FreshDirs,
    path: std::path::PathBuf,
}

impl Target {
    /// Страж встаёт раньше, чем выход создаст каталог.
    fn claim(options: &crate::args::Options) -> Outcome<Self> {
        let fresh = super::fresh_dirs::FreshDirs::beside(options.required("output"));
        let path = crate::paths::output_file(options.required("output")?, &[".awc"])?;
        Ok(Self { fresh, path })
    }

    /// Банк ложится на диск, созданное остаётся, ответ собирается из таблицы пар:
    /// статус, режим, выход, особые поля команды, размер и сумма банка.
    fn deliver(self, mode: &str, special: Vec<(&str, Json)>, bank: &[u8]) -> Outcome<Json> {
        super::shop::write_atomic(&self.path, bank)?;
        self.fresh.keep();
        let head = [
            ("status", Json::from("ready")),
            ("mode", Json::from(mode)),
            ("output", Json::from(self.path.display().to_string())),
        ];
        let tail = [
            ("bytes", Json::from(bank.len())),
            ("sha256", Json::from(rage_res::hash::sha256_hex(bank))),
        ];
        Ok(Json::Object(
            head.into_iter()
                .chain(special)
                .chain(tail)
                .map(|(key, value)| (key.to_owned(), value))
                .collect(),
        ))
    }
}

fn hex_id(id: u32) -> String {
    format!("0x{id:08X}")
}

// ---------------------------------------------------------------------------
// Входные файлы.
// ---------------------------------------------------------------------------

/// Прочитанный WAV, прошедший проверку, и его частота.
struct Sound {
    bytes: Vec<u8>,
    rate: u16,
}

impl Sound {
    fn load(path: &std::path::Path) -> Outcome<Self> {
        let bytes = std::fs::read(path)?;
        let rate = checked_wav(&bytes)?.sample_rate;
        Ok(Self { bytes, rate })
    }
}

/// Одна запись слоя: путь WAV, шаблон, сборка потока.
fn layer_stream(entry: &Json) -> Outcome<rage_res::awc::NewStream> {
    let wav = crate::paths::existing_file(entry["wav"].as_str().unwrap_or_default(), &[".wav"])?;
    let template = parse_template(&entry["template"])?;
    let sound = Sound::load(&wav)?;
    Ok(awc_build::stream_from_wav(&template, &sound.bytes)?)
}

/// Разбор WAV соседом плюс то, что он режет молча: частота не больше 16 бит и разрядность ровно 16.
/// Прежние отказы соседа идут первыми; раньше частота 96000 Гц превращалась в 30464, а 8- и 24-битный WAV
/// принимался за 16-битный и портил звук.
fn checked_wav(bytes: &[u8]) -> Outcome<awc_build::Wav> {
    let wav = awc_build::parse_wav(bytes)?;
    // Сосед прочёл заголовок до данных (не меньше 44 байт): поля частоты и разрядности на месте.
    let rate = u32::from_le_bytes([bytes[24], bytes[25], bytes[26], bytes[27]]);
    let bits = u16::from_le_bytes([bytes[34], bytes[35]]);
    match (rate > u32::from(u16::MAX), bits) {
        (true, _) => Err(EngineError::invalid_data(format!(
            "WAV: частота {rate} Гц не помещается в 16 бит (до {}).",
            u16::MAX
        ))),
        (false, 16) => Ok(wav),
        (false, other) => Err(EngineError::invalid_data(format!(
            "WAV: разрядность {other} бит, нужны 16."
        ))),
    }
}

fn read_json(path: &std::path::Path, broken: &str) -> Outcome<Json> {
    match serde_json::from_slice(&std::fs::read(path)?) {
        Ok(doc) => Ok(doc),
        Err(_) => Err(EngineError::invalid_data(broken)),
    }
}

// ---------------------------------------------------------------------------
// Шаблон потока.
// ---------------------------------------------------------------------------

/// Имена чанков шаблона и их коды в банке.
const CHUNK_CODES: [(&str, u8); 3] = [("data", 0x55), ("format", 0xFA), ("peak", 0x36)];
/// Имена кодеков шаблона и их коды.
const CODEC_CODES: [(&str, u8); 2] = [("PCM", 0), ("ADPCM", 4)];
/// Идентификатор потока в банке занимает 29 бит.
const ID_LIMIT: u32 = 0x1FFF_FFFF;

fn code_of(table: &[(&str, u8)], name: &str) -> Option<u8> {
    table
        .iter()
        .find_map(|&(known, code)| (known == name).then_some(code))
}

fn name_of<'t>(table: &[(&'t str, u8)], code: u8) -> &'t str {
    table
        .iter()
        .find_map(|&(name, known)| (known == code).then_some(name))
        .unwrap_or("")
}

/// Целое поле шаблона: чужой тип и отсутствие дают один и тот же отказ.
fn integer(doc: &Json, key: &str) -> Outcome<i64> {
    match doc[key].as_i64() {
        Some(number) => Ok(number),
        None => Err(EngineError::argument(format!(
            "В шаблоне потока нет числа «{key}»."
        ))),
    }
}

/// Число в пределах поля формата: что не помещается, отказывает, а не обрезается.
fn field<T: TryFrom<i64>>(doc: &Json, key: &str) -> Outcome<T> {
    T::try_from(integer(doc, key)?).map_err(|_| out_of_range(key))
}

fn out_of_range(key: &str) -> EngineError {
    EngineError::argument(format!(
        "В шаблоне потока число «{key}» не помещается в поле формата."
    ))
}

/// Разбор в порядке: чанки, кодек, `id`, семь чисел формата, `peakUnk`.
/// Первая же ошибка отказывает; число вне границ поля формата отказывает тоже.
fn parse_template(template: &Json) -> Outcome<awc_build::StreamTemplate> {
    let chunks = chunk_codes(template)?;
    let codec = match template["codec"]
        .as_str()
        .and_then(|name| code_of(&CODEC_CODES, name))
    {
        Some(code) => code,
        None => return Err(EngineError::argument("Кодек шаблона — PCM или ADPCM.")),
    };
    let id = match field::<u32>(template, "id")? {
        id if id > ID_LIMIT => return Err(out_of_range("id")),
        id => id,
    };
    // Поля структуры вычисляются в порядке записи: он же порядок проверок.
    Ok(awc_build::StreamTemplate {
        id,
        chunks,
        codec,
        samples: field(template, "samples")?,
        loop_point: field(template, "loopPoint")?,
        play_begin: field(template, "playBegin")?,
        play_end: field(template, "playEnd")?,
        loop_begin: field(template, "loopBegin")?,
        loop_end: field(template, "loopEnd")?,
        headroom: field(template, "headroom")?,
        peak_unk: match template["peakUnk"].as_u64() {
            Some(word) => Some(u16::try_from(word).map_err(|_| out_of_range("peakUnk"))?),
            None => None,
        },
    })
}

fn chunk_codes(template: &Json) -> Outcome<Vec<u8>> {
    let Some(list) = template["chunks"].as_array() else {
        return Err(EngineError::argument("В шаблоне потока нет списка чанков."));
    };
    list.iter()
        .map(|item| {
            // Не строка читается как пустое имя: отказ тот же.
            let name = item.as_str().unwrap_or_default();
            code_of(&CHUNK_CODES, name)
                .ok_or_else(|| EngineError::argument(format!("Чанк {name} пока на хосте.")))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::args::Options;
    use crate::error::Result;
    use crate::progress::Progress;
    use rage_res::hash;
    use serde_json::{json, Value};
    use std::fs;
    use std::path::PathBuf;

    /// WAV с обычным заголовком в 44 байта: PCM 16 бит, моно.
    fn wav(rate: u32, samples: &[i16]) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend(b"RIFF");
        out.extend((36 + samples.len() as u32 * 2).to_le_bytes());
        out.extend(b"WAVEfmt ");
        out.extend(16u32.to_le_bytes());
        out.extend(1u16.to_le_bytes());
        out.extend(1u16.to_le_bytes());
        out.extend(rate.to_le_bytes());
        out.extend((rate * 2).to_le_bytes());
        out.extend(2u16.to_le_bytes());
        out.extend(16u16.to_le_bytes());
        out.extend(b"data");
        out.extend((samples.len() as u32 * 2).to_le_bytes());
        for sample in samples {
            out.extend(sample.to_le_bytes());
        }
        out
    }

    fn hex(text: &str) -> Vec<u8> {
        text.split_whitespace()
            .map(|byte| u8::from_str_radix(byte, 16).unwrap())
            .collect()
    }

    fn ramp(count: usize) -> Vec<i16> {
        (0..count as i32).map(|n| (13 * n % 3000) as i16).collect()
    }

    struct Lab {
        dir: tempfile::TempDir,
    }

    impl Lab {
        fn new() -> Self {
            Self {
                dir: tempfile::tempdir().unwrap(),
            }
        }

        fn path(&self, name: &str) -> PathBuf {
            self.dir.path().join(name)
        }

        fn put(&self, name: &str, bytes: &[u8]) -> String {
            let path = self.path(name);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, bytes).unwrap();
            path.display().to_string().replace('\\', "/")
        }

        fn run(&self, command: Handler, args: &[&str]) -> Result<Value> {
            let argv: Vec<String> = args.iter().map(|arg| arg.to_string()).collect();
            command(&Options::parse(&argv)?, &Progress::silent())
        }

        /// Поток из WAV `wav.wav` и шаблона `t.json` с выходом `out.awc`.
        fn stream(&self, template: &str) -> Result<Value> {
            self.put("t.json", template.as_bytes());
            let (wav, tpl, out) = (
                self.path("wav.wav"),
                self.path("t.json"),
                self.path("out.awc"),
            );
            self.run(
                awc_stream_from_wav,
                &[
                    "--wav",
                    &wav.display().to_string(),
                    "--template",
                    &tpl.display().to_string(),
                    "--output",
                    &out.display().to_string(),
                ],
            )
        }

        fn layer(&self, request: &str) -> Result<Value> {
            self.put("r.json", request.as_bytes());
            let (req, out) = (self.path("r.json"), self.path("out.awc"));
            self.run(
                awc_layer_from_wav,
                &[
                    "--request",
                    &req.display().to_string(),
                    "--output",
                    &out.display().to_string(),
                ],
            )
        }
    }

    type Handler = fn(&Options, &Progress) -> Result<Value>;

    const STD: &str = r#""chunks":["format","data"],"codec":"PCM","samples":300,"loopPoint":-1,"playBegin":0,"playEnd":0,"loopBegin":0,"loopEnd":0,"headroom":0"#;

    fn template(extra: &str) -> String {
        format!(r#"{{"version":255,"chunkIndices":false,"id":41,{STD}{extra}}}"#)
    }

    fn message(result: Result<Value>) -> (String, String) {
        let error = result.unwrap_err();
        (error.code, error.message)
    }

    #[test]
    fn host_c1_pcm_short_is_byte_exact() {
        let lab = Lab::new();
        lab.put("wav.wav", &wav(44100, &ramp(300)));
        let t = r#"{"id":2,"chunks":["data","format"],"codec":"PCM","samples":300,"loopPoint":-1,"playBegin":0,"playEnd":0,"loopBegin":0,"loopEnd":0,"headroom":0,"peakUnk":null,"version":255,"chunkIndices":true}"#;
        let value = lab.stream(t).unwrap();
        assert_eq!(value["id"], "0x00000002");
        assert_eq!(value["codec"], "PCM");
        assert_eq!(value["sampleRate"], 44100);
        assert_eq!(value["samples"], 300);
        assert_eq!(value["bytes"], 664);
        let bank = fs::read(lab.path("out.awc")).unwrap();
        assert_eq!(hash::sha256_hex(&bank), value["sha256"].as_str().unwrap());
        // начало и конец файла из таблицы описания
        assert_eq!(
            bank[..64],
            hex("41 44 41 54 ff 00 01 ff 01 00 00 00 26 00 00 00 00 00 02 00 00 40 40 00 00 80 25 00 00 55 26 00 00 40 01 00 00 fa 2c 01 00 00 ff ff ff ff 44 ac 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00")
        );
        assert_eq!(
            bank[bank.len() - 24..],
            hex("e8 02 f5 02 02 03 0f 03 1c 03 29 03 36 03 43 03 50 03 5d 03 6a 03 77 03")
        );
    }

    #[test]
    fn sizes_from_the_pcm_and_adpcm_tables() {
        let lab = Lab::new();
        let size = |lab: &Lab, count: usize, tpl: String| {
            lab.put("wav.wav", &wav(22050, &ramp(count)));
            lab.stream(&tpl)
                .map(|value| value["bytes"].as_u64().unwrap())
        };
        for (count, bytes) in [
            (0usize, 64u64),
            (1, 66),
            (2, 68),
            (3, 70),
            (5, 74),
            (100, 264),
            (300, 664),
        ] {
            let t = template("").replace("\"samples\":300", &format!("\"samples\":{count}"));
            assert_eq!(size(&lab, count, t).unwrap(), bytes, "pcm {count}");
        }
        let adpcm = |count: usize| {
            template("")
                .replace("\"PCM\"", "\"ADPCM\"")
                .replace("\"samples\":300", &format!("\"samples\":{count}"))
        };
        for (count, bytes) in [
            (0usize, 64u64),
            (1, 64),
            (100, 114),
            (300, 214),
            (2044, 1086),
            (4096, 2112),
        ] {
            assert_eq!(
                size(&lab, count, adpcm(count)).unwrap(),
                bytes,
                "adpcm {count}"
            );
        }
        for tiny in [2usize, 3, 4, 6, 7] {
            let bytes_wav: Vec<i16> = ramp(tiny);
            lab.put("wav.wav", &wav(22050, &bytes_wav));
            let error = lab.stream(&adpcm(tiny)).unwrap_err();
            assert_eq!(
                (error.code.as_str(), error.message.as_str()),
                (
                    "InvalidOperationException",
                    "Выход ADPCM короче заголовка блока."
                )
            );
        }
    }

    #[test]
    fn peak_formats_and_range() {
        let lab = Lab::new();
        lab.put("wav.wav", &wav(22050, &ramp(9000)));
        let peaked = |unk: &str| {
            let mut t = template(unk);
            t = t.replace(
                r#""chunks":["format","data"]"#,
                r#""chunks":["data","format","peak"]"#,
            );
            t.replace("\"samples\":300", "\"samples\":9000")
        };
        assert_eq!(
            lab.stream(&peaked(r#","peakUnk":7"#)).unwrap()["bytes"],
            18080
        );
        for absent in [
            "",
            r#","peakUnk":null"#,
            r#","peakUnk":-1"#,
            r#","peakUnk":"7""#,
            r#","peakUnk":true"#,
        ] {
            assert_eq!(
                lab.stream(&peaked(absent)).unwrap()["bytes"],
                18064,
                "{absent}"
            );
        }
        // Раньше 4294967296 молча становилось 0: слово пика не помещается в 16 бит, теперь отказ.
        assert_eq!(
            message(lab.stream(&peaked(r#","peakUnk":4294967296"#))).1,
            "В шаблоне потока число «peakUnk» не помещается в поле формата."
        );
        let no_data =
            template(r#","peakUnk":7"#).replace(r#"["format","data"]"#, r#"["format","peak"]"#);
        assert_eq!(
            message(lab.stream(&no_data)).1,
            "AWC: у потока нет данных для пика."
        );
        let zero = peaked(r#","peakUnk":7"#).replace("\"samples\":9000", "\"samples\":0");
        assert_eq!(message(lab.stream(&zero)).1, "AWC: пустой поток с пиком.");
    }

    #[test]
    fn numbers_beyond_their_format_field_are_refused_not_cut() {
        let lab = Lab::new();
        lab.put("wav.wav", &wav(22050, &ramp(300)));
        let refused = |key: &str, value: &str| {
            let mut doc: Value = serde_json::from_str(&template("")).unwrap();
            doc[key] = serde_json::from_str(value).unwrap();
            message(lab.stream(&doc.to_string()))
        };
        // Раньше эти значения молча обрезались приведением `as` (-1 как id давало 0xFFFFFFFF, version 65543 — 7).
        for (key, value) in [
            ("version", "-1"),
            ("version", "65543"),
            ("id", "-1"),
            ("id", "536870912"),
            ("id", "4294967296"),
            ("id", "2147483648"),
            ("samples", "-1"),
            ("samples", "4294967296"),
            ("loopPoint", "-2147483649"),
            ("loopPoint", "2147483648"),
            ("playBegin", "-1"),
            ("playBegin", "256"),
            ("playEnd", "65536"),
            ("loopBegin", "-1"),
            ("loopEnd", "65536"),
            ("headroom", "-32769"),
            ("headroom", "32768"),
        ] {
            let (code, text) = refused(key, value);
            assert_eq!(code, "ArgumentException", "{key} {value}");
            assert_eq!(
                text,
                format!("В шаблоне потока число «{key}» не помещается в поле формата."),
                "{key} {value}"
            );
        }
        // Границы полей проходят: максимум идентификатора, u32 samples, края u8/u16/i16/i32.
        let edge = r#"{"version":65535,"chunkIndices":false,"id":536870911,"chunks":["format","data"],"codec":"PCM","samples":4294967295,"loopPoint":-2147483648,"playBegin":255,"playEnd":65535,"loopBegin":65535,"loopEnd":65535,"headroom":-32768}"#;
        let value = lab.stream(edge).unwrap();
        assert_eq!(value["id"], "0x1FFFFFFF");
        assert_eq!(value["samples"], 4294967295u64);
        assert_eq!(&fs::read(lab.path("out.awc")).unwrap()[4..6], [0xff, 0xff]);
    }

    #[test]
    fn wav_rate_beyond_16_bits_and_other_depths_are_refused_not_cut() {
        let lab = Lab::new();
        // Раньше частота 96000 Гц превращалась в 30464, а 8- и 24-битный WAV принимался за 16-битный.
        lab.put("wav.wav", &wav(96000, &ramp(300)));
        assert_eq!(
            message(lab.stream(&template(""))),
            (
                "InvalidDataException".to_owned(),
                "WAV: частота 96000 Гц не помещается в 16 бит (до 65535).".to_owned()
            )
        );
        lab.put("wav.wav", &wav(65536, &ramp(300)));
        assert_eq!(
            message(lab.stream(&template(""))).1,
            "WAV: частота 65536 Гц не помещается в 16 бит (до 65535)."
        );
        lab.put("wav.wav", &wav(65535, &ramp(300)));
        assert_eq!(lab.stream(&template("")).unwrap()["sampleRate"], 65535);
        for bits in [8u16, 24, 32, 0] {
            let mut bytes = wav(22050, &ramp(300));
            bytes[34..36].copy_from_slice(&bits.to_le_bytes());
            lab.put("wav.wav", &bytes);
            assert_eq!(
                message(lab.stream(&template(""))),
                (
                    "InvalidDataException".to_owned(),
                    format!("WAV: разрядность {bits} бит, нужны 16.")
                ),
                "{bits}"
            );
        }
        // Прежние отказы соседа идут первыми: не PCM остаётся «Only PCM format…».
        let mut float = wav(96000, &ramp(300));
        float[20..22].copy_from_slice(&3u16.to_le_bytes());
        lab.put("wav.wav", &float);
        assert_eq!(
            message(lab.stream(&template(""))).1,
            "Only PCM format .wav files supported!"
        );
    }

    #[test]
    fn template_errors_follow_the_documented_order() {
        let lab = Lab::new();
        lab.put("wav.wav", &wav(22050, &ramp(100)));
        let arg = "ArgumentException";
        let cases: [(&str, &str); 16] = [
            (
                r#"{"version":255,"id":41,"codec":"PCM"}"#,
                "В шаблоне потока нет списка чанков.",
            ),
            (
                r#"{"chunks":"data"}"#,
                "В шаблоне потока нет списка чанков.",
            ),
            (r#"[]"#, "В шаблоне потока нет списка чанков."),
            (r#"null"#, "В шаблоне потока нет списка чанков."),
            (r#""x""#, "В шаблоне потока нет списка чанков."),
            (r#"{"chunks":[null],"codec":"PCM"}"#, "Чанк  пока на хосте."),
            (
                r#"{"chunks":[85,"format"],"codec":"PCM"}"#,
                "Чанк  пока на хосте.",
            ),
            (
                r#"{"chunks":["data ","format"],"codec":"PCM"}"#,
                "Чанк data  пока на хосте.",
            ),
            (
                r#"{"chunks":["Data","format"]}"#,
                "Чанк Data пока на хосте.",
            ),
            (
                r#"{"chunks":["bogus"],"codec":"X"}"#,
                "Чанк bogus пока на хосте.",
            ),
            (
                r#"{"chunks":["seektable"],"codec":"OGG"}"#,
                "Чанк seektable пока на хосте.",
            ),
            (
                r#"{"chunks":["format"],"codec":"X","id":1}"#,
                "Кодек шаблона — PCM или ADPCM.",
            ),
            (
                r#"{"chunks":["format"],"codec":4,"id":1}"#,
                "Кодек шаблона — PCM или ADPCM.",
            ),
            (
                r#"{"chunks":["format"],"codec":"PCM"}"#,
                "В шаблоне потока нет числа «id».",
            ),
            (
                r#"{"chunks":["format"],"codec":"ADPCM","id":9223372036854775808}"#,
                "В шаблоне потока нет числа «id».",
            ),
            (
                r#"{"chunks":["format"],"codec":"PCM","id":1,"samples":1e2}"#,
                "В шаблоне потока нет числа «samples».",
            ),
        ];
        for (text, expected) in cases {
            assert_eq!(
                message(lab.stream(text)),
                (arg.into(), expected.into()),
                "{text}"
            );
        }
        // у каждого числа свой отказ, какой бы тип ни стоял
        for key in [
            "id",
            "samples",
            "loopPoint",
            "playBegin",
            "playEnd",
            "loopBegin",
            "loopEnd",
            "headroom",
            "version",
        ] {
            for replacement in [None, Some("1.5"), Some("\"5\""), Some("null")] {
                let mut doc: Value = serde_json::from_str(&template("")).unwrap();
                match replacement {
                    None => {
                        doc.as_object_mut().unwrap().remove(key);
                    }
                    Some(text) => {
                        doc[key] = serde_json::from_str(text).unwrap();
                    }
                }
                assert_eq!(
                    lab.stream(&doc.to_string()).unwrap_err().message,
                    format!("В шаблоне потока нет числа «{key}»."),
                    "{key} {replacement:?}"
                );
            }
        }
        // версия проверяется после всех чисел шаблона
        let both = r#"{"chunkIndices":false,"id":41,"chunks":["format","data"],"codec":"PCM","samples":300,"loopPoint":-1,"playBegin":0,"playEnd":0,"loopBegin":0,"loopEnd":0}"#;
        assert_eq!(
            lab.stream(both).unwrap_err().message,
            "В шаблоне потока нет числа «headroom»."
        );
    }

    #[test]
    fn template_file_refusals() {
        let lab = Lab::new();
        lab.put("wav.wav", &wav(22050, &ramp(100)));
        for text in [
            "",
            "not json",
            &format!("\u{feff}{}", template("")),
            &format!("{} x", template("")),
        ] {
            assert_eq!(
                message(lab.stream(text)),
                (
                    "InvalidDataException".into(),
                    "Шаблон потока пустой или сломан.".into()
                ),
            );
        }
        let dup = r#"{"version":255,"id":1,"id":2,"chunks":["data"],"codec":"PCM","samples":1,"loopPoint":0,"playBegin":0,"playEnd":0,"loopBegin":0,"loopEnd":0,"headroom":0}"#;
        assert_eq!(lab.stream(dup).unwrap()["id"], "0x00000002");
        // Семь чанков в потоке ещё умещаются в слово потока, восьмой и дальше отказ (раньше число
        // чанков молча оборачивалось через три бита, и банк получался порченым).
        let seven = vec!["\"data\""; 7].join(",");
        let t7 = template("").replace(r#"["format","data"]"#, &format!("[{seven}]"));
        assert!(lab.stream(&t7).is_ok());
        for count in [8usize, 16] {
            let many = vec!["\"data\""; count].join(",");
            let t = template("").replace(r#"["format","data"]"#, &format!("[{many}]"));
            assert_eq!(
                message(lab.stream(&t)),
                (
                    "InvalidOperationException".into(),
                    "AWC: в потоке 0X00000029 больше 7 чанков, число чанков не умещается в слово потока.".into()
                ),
                "{count}"
            );
        }
        let seventeen = vec!["\"data\""; 17].join(",");
        let t17 = template("").replace(r#"["format","data"]"#, &format!("[{seventeen}]"));
        assert_eq!(
            message(lab.stream(&t17)),
            (
                "InvalidOperationException".into(),
                "AWC: сборка банка больше 16 чанков пока на хосте.".into()
            )
        );
    }

    #[test]
    fn chunk_indices_flag_only_from_a_json_boolean() {
        let lab = Lab::new();
        lab.put("wav.wav", &wav(22050, &ramp(100)));
        let flags = |value: &str| {
            let t = format!(r#"{{"version":255,"chunkIndices":{value},"id":41,{STD}}}"#);
            lab.stream(&t).unwrap();
            u16::from_le_bytes(
                fs::read(lab.path("out.awc")).unwrap()[6..8]
                    .try_into()
                    .unwrap(),
            )
        };
        assert_eq!(flags("true"), 0xff01);
        for other in ["false", "null", "\"true\"", "1", "0"] {
            assert_eq!(flags(other), 0xff00, "{other}");
        }
        let t = format!(r#"{{"version":255,"id":41,{STD}}}"#);
        lab.stream(&t).unwrap();
        assert_eq!(fs::read(lab.path("out.awc")).unwrap()[6..8], [0x00, 0xff]);
    }

    fn broken_wav(kind: &str) -> Vec<u8> {
        let mut bytes = wav(22050, &ramp(100));
        match kind {
            "stereo" => bytes[22] = 2,
            "channels0" => bytes[22] = 0,
            "float" => bytes[20] = 3,
            "format0" => bytes[20] = 0,
            "cut20" => bytes.truncate(20),
            "cut40" => bytes.truncate(40),
            "zero-data" => {
                bytes.truncate(44);
                bytes[40..44].fill(0);
            }
            "empty" => bytes.clear(),
            "datalen-big" => bytes[40..44].copy_from_slice(&(10_000i32).to_le_bytes()),
            "datalen-neg" => bytes[40..44].copy_from_slice(&i32::MIN.to_le_bytes()),
            _ => unreachable!(),
        }
        bytes
    }

    #[test]
    fn wav_refusals_come_from_the_neighbor() {
        let lab = Lab::new();
        let op = "InvalidOperationException";
        for (kind, text) in [
            ("stereo", "Only mono .wav files supported!"),
            ("channels0", "Only mono .wav files supported!"),
            ("float", "Only PCM format .wav files supported!"),
            ("format0", "Only PCM format .wav files supported!"),
            ("cut20", "WAV обрывается."),
            ("cut40", "WAV обрывается."),
            ("empty", "WAV обрывается."),
            ("datalen-big", "WAV обрывается."),
        ] {
            lab.put("wav.wav", &broken_wav(kind));
            assert_eq!(
                message(lab.stream(&template(""))),
                (op.into(), text.into()),
                "{kind}"
            );
        }
        lab.put("wav.wav", &broken_wav("zero-data"));
        assert_eq!(lab.stream(&template("")).unwrap()["bytes"], 64);
        lab.put("wav.wav", &broken_wav("datalen-neg"));
        assert_eq!(lab.stream(&template("")).unwrap()["bytes"], 64);
    }

    #[test]
    fn stream_parameters_and_output() {
        let lab = Lab::new();
        lab.put("wav.wav", &wav(22050, &ramp(100)));
        lab.put("t.json", template("").as_bytes());
        let wav_path = lab.path("wav.wav").display().to_string();
        let tpl = lab.path("t.json").display().to_string();
        let out = lab.path("out.awc").display().to_string();
        let run = |args: &[&str]| lab.run(awc_stream_from_wav, args);
        assert_eq!(run(&[]).unwrap_err().message, "--wav is required.");
        assert_eq!(
            run(&["--wav", &wav_path]).unwrap_err().message,
            "--template is required."
        );
        assert_eq!(
            run(&["--wav", &wav_path, "--template", &tpl])
                .unwrap_err()
                .message,
            "--output is required."
        );
        // порядок: wav проверяется до создания каталога выхода
        let nope = lab.path("nope.wav").display().to_string();
        let made = lab.path("made/out.awc").display().to_string();
        let missing = lab.path("missing.json").display().to_string();
        assert_eq!(
            run(&["--wav", &nope, "--template", &missing, "--output", &made])
                .unwrap_err()
                .message,
            format!("File was not found: {nope}")
        );
        assert!(!lab.path("made").exists());
        // шаблон: файла нет, а расширение выхода неверное - побеждает файл
        let bad_out = lab.path("made/out.bank").display().to_string();
        assert_eq!(
            run(&[
                "--wav",
                &wav_path,
                "--template",
                &missing,
                "--output",
                &bad_out
            ])
            .unwrap_err()
            .message,
            format!("File was not found: {missing}")
        );
        assert_eq!(
            run(&["--wav", &wav_path, "--template", &tpl, "--output", &bad_out])
                .unwrap_err()
                .message,
            "Unsupported output extension: .bank"
        );
        // каталог выхода создаётся и остаётся после отказа
        let nested = lab.path("a/b/out.awc").display().to_string();
        let broken_tpl = lab.put("broken.json", b"nope");
        let error = run(&[
            "--wav",
            &wav_path,
            "--template",
            &broken_tpl,
            "--output",
            &nested,
        ])
        .unwrap_err();
        assert_eq!(error.message, "Шаблон потока пустой или сломан.");
        // Каталог, который создала отказавшая команда, не остаётся (раньше оставался пустым).
        assert!(!lab.path("a").exists());
        let ok = run(&[
            "--WAV",
            &wav_path,
            "--template",
            &tpl,
            "--output",
            &out,
            "--x",
            "y",
        ])
        .unwrap();
        assert_eq!(ok["bytes"], 264);
        let keys: Vec<&str> = ok.as_object().unwrap().keys().map(String::as_str).collect();
        assert_eq!(
            keys,
            [
                "status",
                "mode",
                "output",
                "id",
                "codec",
                "sampleRate",
                "samples",
                "bytes",
                "sha256"
            ]
        );
        assert_eq!(ok["mode"], "awc-stream-from-wav");
        assert_eq!(ok["output"], lab.path("out.awc").display().to_string());
        // выход - каталог
        fs::remove_file(lab.path("out.awc")).unwrap();
        fs::create_dir(lab.path("out.awc")).unwrap();
        let error = run(&["--wav", &wav_path, "--template", &tpl, "--output", &out]).unwrap_err();
        assert_eq!(error.code, "UnauthorizedAccessException");
        assert!(!lab.path("out.awc.shop-stage").exists());
    }

    fn layer_entry(wav: &str, id: u64, extra: &str) -> String {
        format!(
            r#"{{"wav":"{wav}","template":{{"id":{id},"chunks":["data","format"],"codec":"PCM","samples":300,"loopPoint":-1,"playBegin":0,"playEnd":0,"loopBegin":0,"loopEnd":0,"headroom":0,"peakUnk":null{extra}}}}}"#
        )
    }

    fn request(version: &str, indices: &str, streams: &[String]) -> String {
        format!(
            r#"{{"version":{version},"chunkIndices":{indices},"streams":[{}]}}"#,
            streams.join(",")
        )
    }

    #[test]
    fn layer_sorts_streams_and_answers_in_request_order() {
        let lab = Lab::new();
        let w100 = lab.put("w100.wav", &wav(22050, &ramp(100)));
        let w300 = lab.put("w300.wav", &wav(22050, &ramp(300)));
        let one = lab
            .layer(&request(
                "255",
                "true",
                &[
                    layer_entry(&w100, 30, ""),
                    layer_entry(&w300, 20, ""),
                    layer_entry(&w100, 10, ""),
                ],
            ))
            .unwrap();
        assert_eq!(
            one["streams"],
            json!(["0x0000001E", "0x00000014", "0x0000000A"])
        );
        assert_eq!(one["bytes"], 1160);
        let keys: Vec<&str> = one
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(
            keys,
            ["status", "mode", "output", "streams", "bytes", "sha256"]
        );
        let bank = fs::read(lab.path("out.awc")).unwrap();
        let ids: Vec<u32> = (0..3)
            .map(|i| {
                u32::from_le_bytes(bank[16 + 6 + i * 4..16 + 10 + i * 4].try_into().unwrap())
                    & 0x1fff_ffff
            })
            .collect();
        assert_eq!(ids, [10, 20, 30]);
        // Раньше id шире 29 бит проходили с маской (и два id с одинаковыми младшими битами давали банк с повтором);
        // теперь это отказ.
        for id in [536870917u64, 4294967295, 4294967296] {
            let error = lab
                .layer(&request("255", "true", &[layer_entry(&w100, id, "")]))
                .unwrap_err();
            assert_eq!(
                error.message, "В шаблоне потока число «id» не помещается в поле формата.",
                "{id}"
            );
        }
    }

    #[test]
    fn a_refused_layer_leaves_no_output_directory_behind() {
        let lab = Lab::new();
        let broken = lab.put("broken.json", b"nope");
        let nested = lab.path("made/by/failure/out.awc").display().to_string();
        let error = lab
            .run(
                awc_layer_from_wav,
                &["--request", &broken, "--output", &nested],
            )
            .unwrap_err();
        assert_eq!(error.message, "Запрос слоя пустой или сломан.");
        assert!(!lab.path("made").exists());
    }

    #[test]
    fn layer_empty_banks_and_version_wrap() {
        let lab = Lab::new();
        let empty = |text: &str| {
            lab.layer(text)
                .map(|value| (value["bytes"].clone(), value["streams"].clone()))
        };
        assert_eq!(
            empty(r#"{"version":255,"chunkIndices":false,"streams":[]}"#).unwrap(),
            (json!(16), json!([]))
        );
        assert_eq!(
            empty(r#"{"version":255,"chunkIndices":false,"streams":[]}"#).unwrap(),
            empty(r#"{"version":255,"streams":[]}"#).unwrap()
        );
        assert_eq!(
            empty(r#"{"version":255,"chunkIndices":"true","streams":[]}"#).unwrap(),
            empty(r#"{"version":255,"streams":[]}"#).unwrap()
        );
        assert_eq!(
            lab.layer(r#"{"version":65543,"chunkIndices":false,"streams":[]}"#)
                .unwrap_err()
                .message,
            "В шаблоне потока число «version» не помещается в поле формата."
        );
        empty(r#"{"version":65535,"chunkIndices":false,"streams":[]}"#).unwrap();
        assert_eq!(fs::read(lab.path("out.awc")).unwrap()[4..6], [0xff, 0xff]);
        let sha_of = |text: &str| lab.layer(text).unwrap()["sha256"].clone();
        assert_eq!(
            sha_of(r#"{"version":255,"chunkIndices":false,"streams":[]}"#),
            "50ecc7063b0c8a60938a6cce61b44788a985d31ca68499d62b5daf958a886203"
        );
        assert_eq!(
            sha_of(r#"{"version":255,"chunkIndices":true,"streams":[]}"#),
            "e62c23860be3eeaf079cf5cab8d004796a0dc98674b90b609035a5d3b3838533"
        );
    }

    #[test]
    fn layer_refusals_in_documented_order() {
        let lab = Lab::new();
        let w100 = lab.put("w100.wav", &wav(22050, &ramp(100)));
        let stereo = lab.put("stereo.wav", &broken_wav("stereo"));
        let nope = lab
            .path("nope.wav")
            .display()
            .to_string()
            .replace('\\', "/");
        let (arg, op, data) = (
            "ArgumentException",
            "InvalidOperationException",
            "InvalidDataException",
        );
        let version = "В шаблоне потока нет числа «version».";
        let cases: Vec<(String, &str, String)> = vec![
            ("nope".into(), data, "Запрос слоя пустой или сломан.".into()),
            ("".into(), data, "Запрос слоя пустой или сломан.".into()),
            (
                "\u{feff}{\"version\":255,\"streams\":[]}".into(),
                data,
                "Запрос слоя пустой или сломан.".into(),
            ),
            ("[]".into(), arg, version.into()),
            ("null".into(), arg, version.into()),
            (
                r#"{"chunkIndices":true,"streams":[]}"#.into(),
                arg,
                version.into(),
            ),
            (
                r#"{"version":"255","streams":[]}"#.into(),
                arg,
                version.into(),
            ),
            (
                r#"{"version":2.5,"streams":[]}"#.into(),
                arg,
                version.into(),
            ),
            (
                r#"{"version":"x","streams":"y"}"#.into(),
                arg,
                version.into(),
            ),
            (
                r#"{"version":255}"#.into(),
                arg,
                "В запросе слоя нет списка потоков.".into(),
            ),
            (
                r#"{"version":255,"streams":{}}"#.into(),
                arg,
                "В запросе слоя нет списка потоков.".into(),
            ),
            (
                r#"{"version":255,"streams":null}"#.into(),
                arg,
                "В запросе слоя нет списка потоков.".into(),
            ),
            (
                r#"{"version":255,"streams":["x"]}"#.into(),
                arg,
                "The path is empty.".into(),
            ),
            (
                r#"{"version":255,"streams":[null]}"#.into(),
                arg,
                "The path is empty.".into(),
            ),
            (
                r#"{"version":255,"streams":[{"wav":5}]}"#.to_owned(),
                arg,
                "The path is empty.".into(),
            ),
            (
                format!(r#"{{"version":255,"streams":[{{"wav":"{w100}"}}]}}"#),
                arg,
                "В шаблоне потока нет списка чанков.".into(),
            ),
            (
                format!(r#"{{"version":255,"streams":[{{"wav":"{w100}","template":null}}]}}"#),
                arg,
                "В шаблоне потока нет списка чанков.".into(),
            ),
            (
                format!(r#"{{"version":255,"streams":[{{"wav":"{w100}","template":"x"}}]}}"#),
                arg,
                "В шаблоне потока нет списка чанков.".into(),
            ),
            (
                request(
                    "255",
                    "true",
                    &[
                        layer_entry(&stereo, 2, ""),
                        format!(r#"{{"wav":"{nope}","template":{{}}}}"#),
                    ],
                ),
                op,
                "Only mono .wav files supported!".into(),
            ),
            (
                request(
                    "255",
                    "true",
                    &[
                        layer_entry(&w100, 2, ""),
                        layer_entry(&nope, 9, ""),
                        format!(r#"{{"wav":"{w100}","template":{{}}}}"#),
                    ],
                ),
                "FileNotFoundException",
                format!("File was not found: {}", lab.path("nope.wav").display()),
            ),
            (
                request(
                    "255",
                    "true",
                    &[layer_entry(&w100, 2, ""), layer_entry(&w100, 2, "")],
                ),
                op,
                "AWC: дорожка повторяется в слое — пока на хосте.".into(),
            ),
        ];
        for (text, code, expected) in cases {
            assert_eq!(
                message(lab.layer(&text)),
                (code.to_owned(), expected),
                "{text}"
            );
        }
        let sixteen = vec!["\"data\""; 17].join(",");
        let wide =
            layer_entry(&w100, 2, "").replace(r#"["data","format"]"#, &format!("[{sixteen}]"));
        assert_eq!(
            message(lab.layer(&request("255", "true", &[wide]))),
            (
                op.into(),
                "AWC: сборка банка больше 16 чанков пока на хосте.".into()
            )
        );
    }

    #[test]
    fn layer_ignores_version_inside_stream_template() {
        let lab = Lab::new();
        let w = lab.put("w.wav", &wav(44100, &ramp(300)));
        let plain = lab
            .layer(&request("255", "true", &[layer_entry(&w, 2, "")]))
            .unwrap();
        let with = lab
            .layer(&request(
                "255",
                "true",
                &[layer_entry(&w, 2, r#","version":3,"chunkIndices":false"#)],
            ))
            .unwrap();
        assert_eq!(plain["sha256"], with["sha256"]);
        let no_indices = lab
            .layer(&request("255", "false", &[layer_entry(&w, 2, "")]))
            .unwrap();
        // без оглавления чанков тот же поток весит столько же, но файл другой
        assert_eq!(no_indices["bytes"], plain["bytes"]);
        assert_ne!(no_indices["sha256"], plain["sha256"]);
    }

    /// Банки, в которых все входные байты известны из описания: пустой и тихий звук.
    #[test]
    fn silent_banks_match_the_recorded_sums() {
        let lab = Lab::new();
        let std = |codec: &str, samples: u32, chunks: &str, unk: &str| {
            format!(
                r#"{{"version":255,"chunkIndices":false,"id":41,"chunks":{chunks},"codec":"{codec}","samples":{samples},"loopPoint":-1,"playBegin":0,"playEnd":0,"loopBegin":0,"loopEnd":0,"headroom":0{unk}}}"#
            )
        };
        let sum = |lab: &Lab, tpl: String| {
            let value = lab.stream(&tpl).unwrap();
            (
                value["bytes"].as_u64().unwrap(),
                value["sha256"].as_str().unwrap().to_owned(),
            )
        };
        let fd = r#"["format","data"]"#;
        lab.put("wav.wav", &wav(22050, &[]));
        assert_eq!(
            sum(&lab, std("PCM", 0, fd, "")),
            (
                64,
                "9db4908b97bff452e8131d8854d9736b369e80df308a8373ac1742b207f02fcb".into()
            )
        );
        assert_eq!(
            sum(&lab, std("ADPCM", 0, fd, "")),
            (
                64,
                "a1d8bf9e9e290a3b2a262ed2fdc3ac8c98c8fb1fcae09895bb6fee44da9b2529".into()
            )
        );
        lab.put("wav.wav", &wav(22050, &vec![0; 10000]));
        assert_eq!(
            sum(
                &lab,
                std(
                    "PCM",
                    10000,
                    r#"["data","format","peak"]"#,
                    r#","peakUnk":7"#
                )
            ),
            (
                20080,
                "f0045449109c67718ab7edd8ca0815edeabbfbe590ed455043c06384f8113829".into()
            )
        );
        assert_eq!(
            sum(&lab, std("ADPCM", 10000, fd, "")),
            (
                5064,
                "9f1b50680e4005840a7b5d35e081423aa2bafd31792b19d2a14e180d5312c85d".into()
            )
        );
    }
}
