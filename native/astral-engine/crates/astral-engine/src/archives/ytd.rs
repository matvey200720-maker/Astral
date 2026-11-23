//! Команда `inspect-ytd`: опись словаря текстур Legacy (имя, размеры, формат,
//! размер и отпечаток данных) и общие помощники описей `inspect-ytd` и
//! `inspect-ypt`: открытие файла, шапка ответа, строки текстур.

use std::{fs, path::PathBuf};

use rage_res::{
    texture::{read_dictionary, Format, TextureRef},
    Resource,
};
use serde_json::Value;

use crate::{
    archives::{sha256_file, sha256_hex},
    args::Options,
    error::{EngineError, Result},
    paths::existing_file,
    progress::Progress,
};

/// Файл крупнее этого не читается.
pub(super) const FILE_BYTES_CAP: u64 = 256 * 1024 * 1024;

/// Объект JSON из пар «ключ, значение»: порядок ключей равен порядку пар.
pub(super) fn record<const N: usize>(pairs: [(&str, Value); N]) -> Value {
    pairs.into_iter().collect()
}

/// Файл ресурса, открытый для описи: путь, размер и разобранное содержимое.
pub(super) struct InputFile {
    path: PathBuf,
    size: u64,
    pub(super) resource: Resource,
}

impl InputFile {
    /// Файл из `--input` с одним из расширений; размер сверяется до чтения.
    pub(super) fn open(extensions: &[&str], options: &Options) -> crate::error::Result<InputFile> {
        let requested = options.required("input")?;
        let path = existing_file(requested, extensions)?;
        let size = Some(fs::metadata(&path)?.len())
            .filter(|&len| len <= FILE_BYTES_CAP)
            .ok_or_else(|| EngineError::invalid_data("RPF resource is too large."))?;
        let resource = {
            let bytes = fs::read(&path)?;
            Resource::parse(&bytes)?
        };
        Ok(InputFile {
            path,
            size,
            resource,
        })
    }

    /// Столбцы строки описи текстуры, общие для словаря и ядра эффектов; глубину
    /// в свою строку вставляет только словарь.
    pub(super) fn texture_columns(&self, item: &TextureRef) -> [(&'static str, Value); 7] {
        let payload = payload_fields(&self.resource, item);
        let format = match item.format {
            Some(known) => format_label(known),
            None => item.format_code.to_string(),
        };
        [
            ("name", item.name.as_str().into()),
            ("width", item.width.into()),
            ("height", item.height.into()),
            ("levels", item.levels.into()),
            ("format", format.into()),
            ("bytes", payload.0.into()),
            ("payloadSha256", payload.1.into()),
        ]
    }

    /// Ответ команды: общая шапка и опись ресурса. Отпечаток файла считается
    /// здесь, когда опись уже собрана.
    pub(super) fn report(&self, mode: &str, listing: Value) -> Result<Value> {
        Ok(record([
            ("status", "ready".into()),
            ("mode", mode.into()),
            ("input", self.path.to_string_lossy().into()),
            ("inputBytes", self.size.into()),
            ("inputSha256", sha256_file(&self.path)?.into()),
            ("resource", listing),
        ]))
    }
}

/// Имя формата для описи: `D3DFMT_` и имя из таблицы формата.
pub(super) fn format_label(format: Format) -> String {
    format!("D3DFMT_{}", format.name())
}

/// Размер данных текстуры и отпечаток этих данных.
type Payload = (usize, Option<String>);

/// Размер данных текстуры по формуле помощника и отпечаток этих данных.
/// Отпечатка нет, если текстура неполная, данных нет или размер нулевой.
pub(super) fn payload_fields(resource: &Resource, item: &TextureRef) -> Payload {
    let TextureRef {
        width,
        height,
        levels,
        ..
    } = item;
    let bytes = match item.format {
        Some(format) => format.helper_total_bytes(*width, *height, *levels),
        None => item.bytes,
    };
    let digest = match item.data_at {
        Some(at) if item.complete && bytes > 0 => resource.bytes(at, bytes).map(sha256_hex).ok(),
        _ => None,
    };
    (bytes, digest)
}

/// Текстуры словаря в порядке описи: имя в нижнем регистре, побайтно; равные
/// остаются как в словаре. Пустой словарь — отказ.
fn listed_textures(resource: &Resource) -> Result<Vec<TextureRef>> {
    let mut textures = read_dictionary(resource)?;
    match textures.len() {
        0 => Err(EngineError::invalid_data(
            "YTD could not be decoded or contains no textures.",
        )),
        _ => {
            textures.sort_by_cached_key(|TextureRef { name, .. }| name.to_lowercase());
            Ok(textures)
        }
    }
}

pub fn inspect_ytd(options: &Options, _progress: &Progress) -> Result<Value> {
    InputFile::open(&[".ytd"], options).and_then(|input| {
        let rows: Value = listed_textures(&input.resource)?
            .iter()
            .map(|item| {
                let [name, width, height, levels, format, bytes, digest] =
                    input.texture_columns(item);
                record([
                    name,
                    width,
                    height,
                    ("depth", item.depth.into()),
                    levels,
                    format,
                    bytes,
                    digest,
                ])
            })
            .collect();
        input.report("ytd-inspect", record([("textures", rows)]))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rage_res::resource::HEADER_BYTES;
    use rage_res::texture::Span;
    use rage_res::ytd_write::{payload_bytes, write, NewTexture};
    use rage_rpf::fixtures::noise;
    use std::path::{Path, PathBuf};
    use tempfile::{tempdir, TempDir};

    const ALL_FORMATS: [(Format, &str); 11] = [
        (Format::Dxt1, "D3DFMT_DXT1"),
        (Format::Dxt3, "D3DFMT_DXT3"),
        (Format::Dxt5, "D3DFMT_DXT5"),
        (Format::Ati1, "D3DFMT_ATI1"),
        (Format::Ati2, "D3DFMT_ATI2"),
        (Format::Bc7, "D3DFMT_BC7"),
        (Format::A8R8G8B8, "D3DFMT_A8R8G8B8"),
        (Format::X8R8G8B8, "D3DFMT_X8R8G8B8"),
        (Format::A8, "D3DFMT_A8"),
        (Format::A8B8G8R8, "D3DFMT_A8B8G8R8"),
        (Format::L8, "D3DFMT_L8"),
    ];

    /// Текстура с данными: байты по блокам, как их кладёт писатель.
    fn texture(name: &str, width: u16, height: u16, format: Format, levels: u8) -> NewTexture {
        let size = payload_bytes(format, width.into(), height.into(), levels.into());
        NewTexture {
            name: name.to_owned(),
            width,
            height,
            format,
            levels,
            payload: noise(
                size,
                u64::from(width) * 31 + u64::from(height) + u64::from(levels),
            ),
        }
    }

    struct Lab {
        dir: TempDir,
    }

    impl Lab {
        fn new() -> Lab {
            Lab {
                dir: tempdir().unwrap(),
            }
        }

        fn file(&self, name: &str, bytes: &[u8]) -> PathBuf {
            let path = self.dir.path().join(name);
            fs::write(&path, bytes).unwrap();
            path
        }

        fn run(&self, args: &[&str]) -> Result<Value> {
            let owned: Vec<String> = args.iter().map(|arg| (*arg).to_owned()).collect();
            inspect_ytd(&Options::parse(&owned).unwrap(), &Progress::silent())
        }

        fn inspect(&self, path: &Path) -> Result<Value> {
            self.run(&["--input", &path.display().to_string()])
        }
    }

    fn failure<T>(result: Result<T>) -> (String, String) {
        match result {
            Err(error) => (error.code, error.message),
            Ok(_) => panic!("ожидался отказ"),
        }
    }

    fn names(answer: &Value) -> Vec<String> {
        answer["resource"]["textures"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["name"].as_str().unwrap().to_owned())
            .collect()
    }

    /// Правка данных ресурса и новая упаковка.
    fn patched(bytes: &[u8], edit: impl FnOnce(&mut Resource)) -> Vec<u8> {
        let mut resource = Resource::parse(bytes).unwrap();
        edit(&mut resource);
        resource.to_file_bytes().unwrap()
    }

    /// Смещения объектов текстур словаря.
    fn objects(resource: &Resource) -> Vec<usize> {
        let root = resource.root().unwrap();
        let list = root + 0x30;
        let entries = resource.at(resource.u64(list).unwrap()).unwrap();
        let count = usize::from(resource.u16(list + 8).unwrap());
        (0..count)
            .map(|n| resource.pointer_at(entries + n * 8).unwrap())
            .collect()
    }

    #[test]
    fn format_labels_for_all_eleven_formats() {
        for (format, label) in ALL_FORMATS {
            assert_eq!(format_label(format), label);
        }
    }

    #[test]
    fn all_formats_are_listed_by_lowercase_name_with_helper_sizes() {
        let lab = Lab::new();
        let specs: [(&str, u16, u16, Format, u8); 11] = [
            ("zeta_tex", 16, 16, Format::Dxt1, 3),
            ("Beta_1", 32, 16, Format::Dxt3, 4),
            ("beta_2", 4, 4, Format::A8R8G8B8, 1),
            ("Alpha", 8, 8, Format::Dxt5, 2),
            ("alpha8", 4, 2, Format::A8, 2),
            ("ati_one", 8, 8, Format::Ati1, 1),
            ("ati_two", 8, 8, Format::Ati2, 1),
            ("bc7_tex", 8, 8, Format::Bc7, 2),
            ("x8r8", 2, 2, Format::X8R8G8B8, 1),
            ("abgr", 2, 2, Format::A8B8G8R8, 1),
            ("_under", 4, 4, Format::L8, 1),
        ];
        let textures: Vec<NewTexture> = specs
            .iter()
            .map(|(n, w, h, f, l)| texture(n, *w, *h, *f, *l))
            .collect();
        let path = lab.file("basic.ytd", &write(&textures).unwrap());
        let answer = lab.inspect(&path).unwrap();
        assert_eq!(
            names(&answer),
            [
                "_under", "abgr", "Alpha", "alpha8", "ati_one", "ati_two", "bc7_tex", "Beta_1",
                "beta_2", "x8r8", "zeta_tex"
            ]
        );
        let sizes: Vec<u64> = answer["resource"]["textures"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["bytes"].as_u64().unwrap())
            .collect();
        assert_eq!(sizes, [16, 16, 80, 10, 32, 64, 80, 680, 64, 16, 168]);
        for item in answer["resource"]["textures"].as_array().unwrap() {
            let name = item["name"].as_str().unwrap();
            let source = textures.iter().find(|t| t.name == name).unwrap();
            let bytes = item["bytes"].as_u64().unwrap() as usize;
            assert_eq!(
                item["payloadSha256"],
                sha256_hex(&source.payload[..bytes]),
                "{name}"
            );
            assert_eq!(item["depth"], 1);
            let keys: Vec<&str> = item
                .as_object()
                .unwrap()
                .keys()
                .map(String::as_str)
                .collect();
            assert_eq!(
                keys,
                [
                    "name",
                    "width",
                    "height",
                    "depth",
                    "levels",
                    "format",
                    "bytes",
                    "payloadSha256"
                ]
            );
        }
        let labels: Vec<&str> = answer["resource"]["textures"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["format"].as_str().unwrap())
            .collect();
        assert_eq!(labels[0], "D3DFMT_L8");
        assert_eq!(labels[2], "D3DFMT_DXT5");
        let top: Vec<&str> = answer
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(
            top,
            [
                "status",
                "mode",
                "input",
                "inputBytes",
                "inputSha256",
                "resource"
            ]
        );
        assert_eq!(answer["mode"], "ytd-inspect");
        assert_eq!(answer["input"], path.display().to_string());
        assert_eq!(answer["inputBytes"], fs::metadata(&path).unwrap().len());
        assert_eq!(answer["inputSha256"], sha256_hex(&fs::read(&path).unwrap()));
    }

    #[test]
    fn helper_formula_ignores_block_rounding() {
        let lab = Lab::new();
        let specs = [
            texture("odd_dxt1", 20, 12, Format::Dxt1, 5),
            texture("one_px", 1, 1, Format::Dxt1, 1),
            texture("tiny_dxt5", 4, 4, Format::Dxt5, 3),
        ];
        let path = lab.file("odd.ytd", &write(&specs).unwrap());
        let answer = lab.inspect(&path).unwrap();
        let by_name = |name: &str| {
            answer["resource"]["textures"]
                .as_array()
                .unwrap()
                .iter()
                .find(|t| t["name"] == name)
                .unwrap()
                .clone()
        };
        assert_eq!(by_name("odd_dxt1")["bytes"], 158);
        assert_eq!(
            by_name("odd_dxt1")["payloadSha256"],
            sha256_hex(&specs[0].payload[..158])
        );
        assert_eq!(by_name("one_px")["bytes"], 0);
        assert_eq!(by_name("one_px")["payloadSha256"], Value::Null);
        assert_eq!(by_name("tiny_dxt5")["bytes"], 21);
        assert_eq!(
            by_name("tiny_dxt5")["payloadSha256"],
            sha256_hex(&specs[2].payload[..21])
        );
    }

    #[test]
    fn edited_entries_keep_their_quirks() {
        let lab = Lab::new();
        let specs = [
            texture("bb", 4, 4, Format::Dxt1, 1),
            texture("cc", 4, 4, Format::Dxt1, 1),
            texture("dd", 4, 4, Format::Dxt1, 1),
            texture("ee", 4, 4, Format::Dxt1, 1),
            texture("deep7", 4, 4, Format::Dxt1, 1),
        ];
        let original = write(&specs).unwrap();
        let bytes = patched(&original, |resource| {
            let found = objects(resource);
            let by_name = |name: &str| {
                *found
                    .iter()
                    .find(|&&object| {
                        let pointer = resource.u64(object + 0x28).unwrap();
                        resource.cstring(pointer).as_deref() == Some(name)
                    })
                    .unwrap()
            };
            let accented = by_name("ee");
            let name_at = resource.u64(accented + 0x28).unwrap();
            let name_at = resource.at(name_at).unwrap();
            let (unknown, deep, far_data) = (by_name("bb"), by_name("deep7"), by_name("dd"));
            let data = resource.data_mut();
            data[name_at..name_at + 2].copy_from_slice("é".as_bytes());
            data[unknown + 0x58..unknown + 0x5c].copy_from_slice(&0x1234_5678u32.to_le_bytes());
            data[deep + 0x54] = 7;
            let far = (0x5000_0000u64 + 0x7fff_0000).to_le_bytes();
            data[far_data + 0x70..far_data + 0x78].copy_from_slice(&far);
        });
        let answer = lab.inspect(&lab.file("patched.ytd", &bytes)).unwrap();
        assert_eq!(names(&answer), ["bb", "cc", "dd", "deep7", "é"]);
        let all = answer["resource"]["textures"].as_array().unwrap();
        assert_eq!(all[0]["format"], "305419896");
        assert_eq!(all[0]["bytes"], 0);
        assert_eq!(all[0]["payloadSha256"], Value::Null);
        assert_eq!(all[1]["payloadSha256"], sha256_hex(&specs[1].payload[..8]));
        assert_eq!(all[2]["bytes"], 8);
        assert_eq!(all[2]["payloadSha256"], Value::Null);
        assert_eq!(all[3]["depth"], 7);
        assert_eq!(all[4]["name"], "é");
    }

    #[test]
    fn entries_without_name_size_or_levels_are_skipped() {
        let lab = Lab::new();
        let specs = [
            texture("keep", 4, 4, Format::Dxt1, 1),
            texture("nolevels", 4, 4, Format::Dxt1, 1),
            texture("nowidth", 4, 4, Format::Dxt1, 1),
            texture("x", 4, 4, Format::Dxt1, 1),
        ];
        let original = write(&specs).unwrap();
        let bytes = patched(&original, |resource| {
            for object in objects(resource) {
                let pointer = resource.u64(object + 0x28).unwrap();
                let name = resource.cstring(pointer).unwrap();
                let data = resource.data_mut();
                match name.as_str() {
                    "nolevels" => data[object + 0x5d] = 0,
                    "nowidth" => data[object + 0x50..object + 0x52].fill(0),
                    "x" => data[object + 0x28..object + 0x30].fill(0),
                    _ => {}
                }
            }
        });
        let answer = lab.inspect(&lab.file("skipped.ytd", &bytes)).unwrap();
        assert_eq!(names(&answer), ["keep"]);

        let nothing = patched(&original, |resource| {
            for object in objects(resource) {
                resource.data_mut()[object + 0x5d] = 0;
            }
        });
        assert_eq!(
            failure(lab.inspect(&lab.file("all-skipped.ytd", &nothing))),
            (
                "InvalidDataException".to_owned(),
                "YTD could not be decoded or contains no textures.".to_owned()
            )
        );
    }

    #[test]
    fn broken_dictionaries_are_refused_by_stage() {
        let lab = Lab::new();
        let original = write(&[texture("only", 4, 4, Format::Dxt1, 1)]).unwrap();
        let empty_text = (
            "InvalidDataException",
            "YTD could not be decoded or contains no textures.",
        );
        let check = |name: &str, bytes: &[u8], expected: (&str, &str)| {
            let got = failure(lab.inspect(&lab.file(name, bytes)));
            assert_eq!((got.0.as_str(), got.1.as_str()), expected, "{name}");
        };
        let zero_count = patched(&original, |r| {
            let root = r.root().unwrap();
            r.data_mut()[root + 0x38..root + 0x3a].fill(0);
        });
        check("zero-count.ytd", &zero_count, empty_text);
        let no_list = patched(&original, |r| {
            let root = r.root().unwrap();
            r.data_mut()[root + 0x30..root + 0x38].fill(0);
        });
        check("nolist.ytd", &no_list, empty_text);
        let many = patched(&original, |r| {
            let root = r.root().unwrap();
            r.data_mut()[root + 0x38..root + 0x3a].copy_from_slice(&4097u16.to_le_bytes());
        });
        check(
            "many.ytd",
            &many,
            (
                "InvalidOperationException",
                "Словарь текстур заявляет слишком много записей.",
            ),
        );

        let with_version = |version_high: u32, graphics_high: u32| {
            let mut bytes = original.clone();
            let system = u32::from_le_bytes(bytes[8..12].try_into().unwrap());
            let graphics = u32::from_le_bytes(bytes[12..16].try_into().unwrap());
            bytes[8..12]
                .copy_from_slice(&((system & 0x0fff_ffff) | (version_high << 28)).to_le_bytes());
            bytes[12..16]
                .copy_from_slice(&((graphics & 0x0fff_ffff) | (graphics_high << 28)).to_le_bytes());
            bytes
        };
        check(
            "enhanced.ytd",
            &with_version(0, 5),
            (
                "InvalidOperationException",
                "Словарь текстур из GTA V Enhanced: Astral читает Legacy.",
            ),
        );
        check(
            "version165.ytd",
            &with_version(10, 5),
            (
                "InvalidOperationException",
                "Это не словарь текстур Legacy (версия 165).",
            ),
        );

        let mut garbage = original[..HEADER_BYTES].to_vec();
        garbage.extend_from_slice(&[0xFF; 64]);
        check(
            "garbage.ytd",
            &garbage,
            (
                "InvalidOperationException",
                "Поток ресурса пуст или не распакован.",
            ),
        );
        check(
            "zero-body.ytd",
            &original[..HEADER_BYTES],
            (
                "InvalidOperationException",
                "Поток ресурса пуст или не распакован.",
            ),
        );
        check(
            "short.ytd",
            &original[..10],
            ("InvalidOperationException", "Ресурс короче заголовка RSC7."),
        );
        check(
            "empty-file.ytd",
            b"",
            ("InvalidOperationException", "Ресурс короче заголовка RSC7."),
        );
        let mut no_magic = original.clone();
        no_magic[0] = b'X';
        check(
            "nomagic.ytd",
            &no_magic,
            (
                "InvalidOperationException",
                "Файл не является ресурсом RSC7.",
            ),
        );
        let cut = lab.file("cut.ytd", &original[..original.len() / 2]);
        let cut_error = failure(lab.inspect(&cut));
        assert_eq!(cut_error.0, "InvalidDataException");
    }

    #[test]
    fn input_parameter_rules() {
        let lab = Lab::new();
        let single = lab.file(
            "single.ytd",
            &write(&[texture("only", 4, 4, Format::Dxt1, 1)]).unwrap(),
        );
        let basic = lab.file(
            "basic.ytd",
            &write(&[
                texture("a", 4, 4, Format::Dxt1, 1),
                texture("b", 4, 4, Format::Dxt1, 1),
            ])
            .unwrap(),
        );
        let argument = |text: &str| ("ArgumentException".to_owned(), text.to_owned());
        assert_eq!(failure(lab.run(&[])), argument("--input is required."));
        assert_eq!(
            failure(lab.run(&["--input", ""])),
            argument("The path is empty.")
        );
        let missing = lab.dir.path().join("nothere.ytd").display().to_string();
        assert_eq!(
            failure(lab.run(&["--input", &missing])),
            (
                "FileNotFoundException".to_owned(),
                format!("File was not found: {missing}")
            )
        );
        let folder = lab.dir.path().join("folder.ytd");
        fs::create_dir_all(&folder).unwrap();
        assert_eq!(failure(lab.inspect(&folder)).0, "FileNotFoundException");
        let wrong = lab.file("basic.ytd.txt", b"x");
        assert_eq!(
            failure(lab.inspect(&wrong)),
            argument("Unsupported file extension: .txt")
        );

        let (first, second) = (single.display().to_string(), basic.display().to_string());
        let last = lab.run(&["--input", &first, "--input", &second]).unwrap();
        assert_eq!(names(&last), ["a", "b"]);
        let upper = lab.file("UPPER.YTD", &fs::read(&single).unwrap());
        assert_eq!(names(&lab.inspect(&upper).unwrap()), ["only"]);
        let upper_name = lab
            .run(&[
                "--INPUT",
                &first,
                "--keys",
                "nowhere",
                "--game-root",
                "x",
                "--read-limit-mbps",
                "1",
            ])
            .unwrap();
        assert_eq!(names(&upper_name), ["only"]);
    }

    #[test]
    fn the_size_limit_is_checked_before_reading() {
        let lab = Lab::new();
        let exact = lab.dir.path().join("limit-ok.ytd");
        fs::File::create(&exact)
            .unwrap()
            .set_len(FILE_BYTES_CAP)
            .unwrap();
        assert_eq!(
            failure(lab.inspect(&exact)),
            (
                "InvalidOperationException".to_owned(),
                "Файл не является ресурсом RSC7.".to_owned()
            )
        );
        let over = lab.dir.path().join("limit-over.ytd");
        fs::File::create(&over)
            .unwrap()
            .set_len(FILE_BYTES_CAP + 1)
            .unwrap();
        assert_eq!(
            failure(lab.inspect(&over)),
            (
                "InvalidDataException".to_owned(),
                "RPF resource is too large.".to_owned()
            )
        );
    }

    #[test]
    fn payload_fields_follow_the_hash_conditions() {
        let data: Vec<u8> = (0..64u8).collect();
        let header = rage_res::resource::Header {
            system_flags: 2 << 17,
            graphics_flags: 0,
            system_size: data.len(),
            graphics_size: 0,
            version: 13,
            declared_version: 13,
        };
        let resource = Resource::from_parts(header, data.clone());
        let base = TextureRef {
            name: "t".into(),
            width: 8,
            height: 8,
            depth: 1,
            levels: 1,
            format: Some(Format::Dxt1),
            format_code: 0,
            bytes: 32,
            complete: true,
            data_at: Some(16),
            spans: vec![Span {
                offset: 0,
                bytes: 32,
            }],
        };
        assert_eq!(
            payload_fields(&resource, &base),
            (32, Some(sha256_hex(&data[16..48])))
        );
        let incomplete = TextureRef {
            complete: false,
            ..base.clone()
        };
        assert_eq!(payload_fields(&resource, &incomplete), (32, None));
        let no_data = TextureRef {
            data_at: None,
            ..base.clone()
        };
        assert_eq!(payload_fields(&resource, &no_data), (32, None));
        let past_end = TextureRef {
            data_at: Some(60),
            ..base.clone()
        };
        assert_eq!(payload_fields(&resource, &past_end), (32, None));
        let unknown = TextureRef {
            format: None,
            bytes: 0,
            ..base.clone()
        };
        assert_eq!(payload_fields(&resource, &unknown), (0, None));
        let tiny = TextureRef {
            width: 1,
            height: 1,
            ..base
        };
        assert_eq!(payload_fields(&resource, &tiny), (0, None));
    }
}
