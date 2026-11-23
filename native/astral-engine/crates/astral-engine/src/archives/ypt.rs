//! Команда `inspect-ypt`: опись ядра эффектов частиц `core.ypt` Legacy.

use super::ytd::{record, InputFile};

use std::cmp::Ordering;

use crate::{args::Options, error::Result, progress::Progress};
use rage_res::{
    texture::TextureRef,
    ypt::{self, cmp_ordinal_ignore_case, Core, EffectRule},
};
use serde_json::{json, Value};

/// Прочитанное ядро вместе с файлом, из которого берутся данные текстур.
struct CoreListing<'a> {
    input: &'a InputFile,
    core: &'a Core,
}

fn text_order(left: &&str, right: &&str) -> Ordering {
    cmp_ordinal_ignore_case(left, right)
}

fn texture_order(left: &&TextureRef, right: &&TextureRef) -> Ordering {
    cmp_ordinal_ignore_case(left.name.as_str(), right.name.as_str())
}

/// Имена в порядке .NET `OrdinalIgnoreCase`; равные остаются как прочитаны.
fn ordinal_names<'a>(names: impl Iterator<Item = &'a str>) -> Value {
    let mut ordered = Vec::from_iter(names);
    ordered.sort_by(text_order);
    Value::from(ordered)
}

/// Строка о проблеме клона: правило и причина.
fn problem_entry((effect, problem): (String, String)) -> Value {
    record([("effect", effect.into()), ("problem", problem.into())])
}

impl CoreListing<'_> {
    /// Текстуры в порядке `OrdinalIgnoreCase`; строки те же, что у `inspect-ytd`, без глубины.
    fn textures(&self) -> Value {
        let mut ordered = Vec::from_iter(&self.core.textures);
        ordered.sort_by(texture_order);
        ordered
            .iter()
            .map(|&item| record(self.input.texture_columns(item)))
            .collect()
    }

    fn problems(&self) -> Value {
        let found = self.core.clone_problems();
        found.into_iter().map(problem_entry).collect()
    }

    /// Объект `resource` ответа.
    fn describe(&self) -> Value {
        let core = self.core;
        let rules = &core.effect_rules;
        let effects = rules.iter().map(|EffectRule { name, .. }| name.as_str());
        record([
            ("name", json!(core.name)),
            ("textures", self.textures()),
            ("effectRules", ordinal_names(effects)),
            (
                "particleRules",
                ordinal_names(core.particle_rules.iter().map(String::as_str)),
            ),
            (
                "emitterRules",
                ordinal_names(core.emitter_rules.iter().map(String::as_str)),
            ),
            ("cloneProblems", self.problems()),
        ])
    }
}

pub fn inspect_ypt(options: &Options, _progress: &Progress) -> Result<Value> {
    InputFile::open(&[".ypt"], options).and_then(|input| {
        let core = ypt::read(&input.resource)?;
        let listing = CoreListing {
            input: &input,
            core: &core,
        };
        input.report("ypt-inspect", listing.describe())
    })
}

#[cfg(test)]
mod tests {
    use super::super::sha256_hex;
    use super::super::ytd::{format_label, FILE_BYTES_CAP};
    use super::*;
    use rage_res::resource::Header;
    use rage_res::texture::Format;
    use rage_res::Resource;
    use std::fs;
    use std::path::{Path, PathBuf};
    use tempfile::{tempdir, TempDir};

    const IMAGE_BYTES: usize = 16 * 1024;
    const BASE: u64 = 0x5000_0000;

    /// Образ ресурса версии 68: объекты кладутся подряд с 0x100, корень в начале.
    struct Image {
        data: Vec<u8>,
        top: usize,
    }

    impl Image {
        fn new() -> Image {
            let mut image = Image {
                data: vec![0; IMAGE_BYTES],
                top: 0x100,
            };
            let textures = image.dictionary(&[]);
            image.set_u64(0x20, textures);
            image
        }

        fn alloc(&mut self, size: usize) -> usize {
            let at = self.top;
            self.top += size.div_ceil(16) * 16;
            at
        }

        fn pointer(at: usize) -> u64 {
            BASE + at as u64
        }

        fn set_u64(&mut self, at: usize, value: u64) {
            self.data[at..at + 8].copy_from_slice(&value.to_le_bytes());
        }

        fn set_u16(&mut self, at: usize, value: u16) {
            self.data[at..at + 2].copy_from_slice(&value.to_le_bytes());
        }

        fn set_u32(&mut self, at: usize, value: u32) {
            self.data[at..at + 4].copy_from_slice(&value.to_le_bytes());
        }

        fn text(&mut self, text: &[u8]) -> u64 {
            let at = self.alloc(text.len() + 1);
            self.data[at..at + text.len()].copy_from_slice(text);
            Self::pointer(at)
        }

        fn pointer_list(&mut self, at: usize, items: &[u64]) {
            let array = self.alloc(items.len().max(1) * 8);
            for (n, item) in items.iter().enumerate() {
                self.set_u64(array + n * 8, *item);
            }
            self.set_u64(at, Self::pointer(array));
            self.set_u16(at + 8, items.len() as u16);
            self.set_u16(at + 10, items.len() as u16);
        }

        fn dictionary(&mut self, values: &[u64]) -> u64 {
            let at = self.alloc(0x40);
            self.pointer_list(at + 0x30, values);
            Self::pointer(at)
        }

        /// Объект с именем по смещению `name_at`.
        fn named(&mut self, size: usize, name_at: usize, name: &[u8]) -> u64 {
            let at = self.alloc(size);
            let text = self.text(name);
            self.set_u64(at + name_at, text);
            Self::pointer(at)
        }

        fn evolutions(&mut self, names: &[&str], frames: &[&[i32]]) -> u64 {
            let at = self.alloc(0x40);
            let array = self.alloc(names.len().max(1) * 0x18);
            for (n, name) in names.iter().enumerate() {
                let text = self.text(name.as_bytes());
                self.set_u64(array + n * 0x18, text);
            }
            self.set_u64(at, Self::pointer(array));
            self.set_u16(at + 8, names.len() as u16);
            let props = self.alloc(frames.len().max(1) * 0x18);
            for (n, ids) in frames.iter().enumerate() {
                let run = self.alloc(ids.len().max(1) * 0x30);
                for (k, id) in ids.iter().enumerate() {
                    self.set_u32(run + k * 0x30 + 0x20, *id as u32);
                }
                self.set_u64(props + n * 0x18, Self::pointer(run));
                self.set_u16(props + n * 0x18 + 8, ids.len() as u16);
            }
            self.set_u64(at + 0x10, Self::pointer(props));
            self.set_u16(at + 0x18, frames.len() as u16);
            Self::pointer(at)
        }

        fn effect(&mut self, name: &[u8], evolutions: Option<u64>) -> u64 {
            let rule = self.named(0x60, 0x20, name);
            if let Some(list) = evolutions {
                self.set_u64((rule - BASE) as usize + 0x48, list);
            }
            rule
        }

        /// Текстура: объект 0x90 и данные; `data` — готовый указатель или `None`.
        fn texture(
            &mut self,
            name: &str,
            size: (u16, u16),
            format: u32,
            levels: u8,
            data: Option<u64>,
        ) -> u64 {
            let object = self.alloc(0x90);
            let text = self.text(name.as_bytes());
            self.set_u64(object + 0x28, text);
            self.set_u16(object + 0x50, size.0);
            self.set_u16(object + 0x52, size.1);
            self.set_u16(object + 0x54, 0);
            self.set_u32(object + 0x58, format);
            self.data[object + 0x5d] = levels;
            if let Some(pointer) = data {
                self.set_u64(object + 0x70, pointer);
            }
            Self::pointer(object)
        }

        /// Данные из `len` различных байт; возвращает указатель.
        fn payload(&mut self, len: usize, seed: u8) -> u64 {
            let at = self.alloc(len);
            for k in 0..len {
                self.data[at + k] = seed.wrapping_add((k % 251) as u8);
            }
            Self::pointer(at)
        }

        fn resource(&self) -> Resource {
            let header = Header {
                system_flags: (4 << 28) | (2 << 17),
                graphics_flags: 4 << 28,
                system_size: self.data.len(),
                graphics_size: 0,
                version: 68,
                declared_version: 68,
            };
            Resource::from_parts(header, self.data.clone())
        }

        fn file(&self) -> Vec<u8> {
            self.resource().to_file_bytes().unwrap()
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
            inspect_ypt(&Options::parse(&owned).unwrap(), &Progress::silent())
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

    fn strings(value: &Value) -> Vec<String> {
        value
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item.as_str().unwrap().to_owned())
            .collect()
    }

    fn set_version(bytes: &mut [u8], high: u32, low: u32) {
        let system = u32::from_le_bytes(bytes[8..12].try_into().unwrap());
        let graphics = u32::from_le_bytes(bytes[12..16].try_into().unwrap());
        bytes[8..12].copy_from_slice(&((system & 0x0fff_ffff) | (high << 28)).to_le_bytes());
        bytes[12..16].copy_from_slice(&((graphics & 0x0fff_ffff) | (low << 28)).to_le_bytes());
    }

    fn full_core() -> Image {
        let mut image = Image::new();
        let name = image.text(b"core_name");
        image.set_u64(0x10, name);

        let smoke = image.payload(2560, 1);
        let spark = image.payload(128, 2);
        let dot = image.payload(64, 3);
        let alpha = image.payload(64, 4);
        let textures = [
            image.texture("ptfx_smoke", (64, 32), 0x3554_5844, 2, Some(smoke)),
            image.texture("PTFX_Spark", (16, 16), 0x3154_5844, 1, Some(spark)),
            image.texture("_dot", (4, 4), 21, 1, Some(dot)),
            image.texture("ptfx_Alpha", (8, 8), 0x3249_5441, 1, Some(alpha)),
        ];
        let dictionary = image.dictionary(&textures);
        image.set_u64(0x20, dictionary);

        let six = image.evolutions(&["a", "b", "c", "d", "e", "f"], &[&[0]]);
        let outside = image.evolutions(&["a"], &[&[0, 3]]);
        let fine = image.evolutions(&["a", "b"], &[&[0, 1]]);
        let effects = [
            image.effect(b"veh_fx", None),
            image.effect(b"astral_fx_b", Some(six)),
            image.effect(b"ASTRAL_FX_A", Some(outside)),
            image.effect(b"Fx_a", None),
            image.effect(b"_fx", None),
            image.effect(b"fx_Z", None),
            image.effect(b"astral_ok", Some(fine)),
            image.effect(b"  ", None),
        ];
        let effect_dictionary = image.dictionary(&effects);
        image.set_u64(0x48, effect_dictionary);

        let emitters: Vec<u64> = [&b"emit_b"[..], b"Emit_a", b"_emit", b" "]
            .iter()
            .map(|name| image.named(0x140, 0x20, name))
            .collect();
        let emitter_dictionary = image.dictionary(&emitters);
        image.set_u64(0x50, emitter_dictionary);
        let particles: Vec<u64> = [&b"part_z"[..], b"Part_a", b"part_A"]
            .iter()
            .map(|name| image.named(0x140, 0x120, name))
            .collect();
        let particle_dictionary = image.dictionary(&particles);
        image.set_u64(0x38, particle_dictionary);
        image
    }

    #[test]
    fn empty_core_inspects_with_a_null_name() {
        let lab = Lab::new();
        let bytes = Image::new().file();
        let path = lab.file("core-empty.ypt", &bytes);
        let answer = lab.inspect(&path).unwrap();
        assert_eq!(
            answer,
            json!({
                "status": "ready", "mode": "ypt-inspect",
                "input": path.display().to_string(),
                "inputBytes": bytes.len(),
                "inputSha256": sha256_hex(&bytes),
                "resource": {"name": null, "textures": [], "effectRules": [], "particleRules": [],
                             "emitterRules": [], "cloneProblems": []}
            })
        );
        let keys: Vec<&str> = answer
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(
            keys,
            [
                "status",
                "mode",
                "input",
                "inputBytes",
                "inputSha256",
                "resource"
            ]
        );
        let upper = lab.file("CORE-UPPER.YPT", &bytes);
        assert_eq!(
            lab.inspect(&upper).unwrap()["resource"]["name"],
            Value::Null
        );
    }

    #[test]
    fn full_core_lists_are_ordered_like_dotnet_ordinal_ignore_case() {
        let lab = Lab::new();
        let image = full_core();
        let path = lab.file("core-full.ypt", &image.file());
        let answer = lab.inspect(&path).unwrap();
        let resource = &answer["resource"];
        assert_eq!(resource["name"], "core_name");
        assert_eq!(
            strings(&resource["effectRules"]),
            [
                "ASTRAL_FX_A",
                "astral_fx_b",
                "astral_ok",
                "Fx_a",
                "fx_Z",
                "veh_fx",
                "_fx"
            ]
        );
        assert_eq!(
            strings(&resource["particleRules"]),
            ["Part_a", "part_A", "part_z"]
        );
        assert_eq!(
            strings(&resource["emitterRules"]),
            ["Emit_a", "emit_b", "_emit"]
        );
        assert_eq!(
            resource["cloneProblems"],
            json!([
                {"effect": "ASTRAL_FX_A", "problem": "has evolution frames outside its evolution list."},
                {"effect": "astral_fx_b", "problem": "carries 6 evolutions; game rules carry at most 5."}
            ])
        );
        let keys: Vec<&str> = resource
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(
            keys,
            [
                "name",
                "textures",
                "effectRules",
                "particleRules",
                "emitterRules",
                "cloneProblems"
            ]
        );

        let textures = resource["textures"].as_array().unwrap();
        let names: Vec<&str> = textures
            .iter()
            .map(|t| t["name"].as_str().unwrap())
            .collect();
        assert_eq!(names, ["ptfx_Alpha", "ptfx_smoke", "PTFX_Spark", "_dot"]);
        let formats: Vec<&str> = textures
            .iter()
            .map(|t| t["format"].as_str().unwrap())
            .collect();
        assert_eq!(
            formats,
            [
                "D3DFMT_ATI2",
                "D3DFMT_DXT5",
                "D3DFMT_DXT1",
                "D3DFMT_A8R8G8B8"
            ]
        );
        let sizes: Vec<u64> = textures
            .iter()
            .map(|t| t["bytes"].as_u64().unwrap())
            .collect();
        assert_eq!(sizes, [64, 2560, 128, 64]);
        let keys: Vec<&str> = textures[0]
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
                "levels",
                "format",
                "bytes",
                "payloadSha256"
            ]
        );
        for item in textures {
            assert!(item["payloadSha256"].is_string(), "{item}");
        }
        // повтор --input: берётся последнее значение
        let empty = lab.file("core-empty.ypt", &Image::new().file());
        let (first, second) = (empty.display().to_string(), path.display().to_string());
        let last = lab.run(&["--input", &first, "--input", &second]).unwrap();
        assert_eq!(last["resource"]["name"], "core_name");
    }

    #[test]
    fn texture_edges_have_null_hashes_and_numeric_formats() {
        let lab = Lab::new();
        let mut image = Image::new();
        let cut = image.texture(
            "cut_tex",
            (64, 64),
            0x3554_5844,
            1,
            Some(Image::pointer(IMAGE_BYTES - 16)),
        );
        let odd = image.texture("odd_fmt", (8, 8), 195_948_557, 1, None);
        let nameless = image.texture("", (8, 8), 21, 1, None);
        let flat = image.texture("flat", (0, 8), 21, 1, None);
        let dictionary = image.dictionary(&[cut, odd, nameless, flat]);
        image.set_u64(0x20, dictionary);
        let answer = lab
            .inspect(&lab.file("core-texture-edge.ypt", &image.file()))
            .unwrap();
        assert_eq!(
            answer["resource"]["textures"],
            json!([
                {"name": "cut_tex", "width": 64, "height": 64, "levels": 1, "format": "D3DFMT_DXT5",
                 "bytes": 4096, "payloadSha256": null},
                {"name": "odd_fmt", "width": 8, "height": 8, "levels": 1, "format": "195948557",
                 "bytes": 0, "payloadSha256": null}
            ])
        );
    }

    #[test]
    fn rule_names_are_kept_raw_but_cut_at_256_characters() {
        let lab = Lab::new();
        let mut image = Image::new();
        let keep = image.effect(b"  keep  ", None);
        let long = image.effect(&[b'n'; 300], None);
        let blank = image.effect(b"\t", None);
        let dictionary = image.dictionary(&[keep, long, blank]);
        image.set_u64(0x48, dictionary);
        let answer = lab
            .inspect(&lab.file("core-longname.ypt", &image.file()))
            .unwrap();
        let names = strings(&answer["resource"]["effectRules"]);
        assert_eq!(names.len(), 2);
        assert_eq!(names[0], "  keep  ");
        assert_eq!(names[1].len(), 256);
        assert_eq!(answer["resource"]["cloneProblems"], json!([]));
    }

    #[test]
    fn duplicates_keep_reading_order() {
        let mut image = Image::new();
        let rules: Vec<u64> = [&b"dup"[..], b"DUP", b"Dup"]
            .iter()
            .map(|name| image.effect(name, None))
            .collect();
        let dictionary = image.dictionary(&rules);
        image.set_u64(0x48, dictionary);
        let lab = Lab::new();
        let answer = lab.inspect(&lab.file("dups.ypt", &image.file())).unwrap();
        assert_eq!(
            strings(&answer["resource"]["effectRules"]),
            ["dup", "DUP", "Dup"]
        );
    }

    #[test]
    fn core_reading_refusals_keep_their_russian_text() {
        let lab = Lab::new();
        let operation = |text: &str| ("InvalidOperationException".to_owned(), text.to_owned());
        for (version, high, low) in [(13u32, 0u32, 13u32), (5, 0, 5), (69, 4, 5), (0, 0, 0)] {
            let mut bytes = Image::new().file();
            set_version(&mut bytes, high, low);
            assert_eq!(
                failure(lab.inspect(&lab.file("v.ypt", &bytes))),
                operation(&format!(
                    "core.ypt версии {version} не поддерживается; ожидается Legacy 68."
                ))
            );
        }
        let mut bare = Image::new();
        bare.set_u64(0x20, 0);
        assert_eq!(
            failure(lab.inspect(&lab.file("core-notex.ypt", &bare.file()))),
            operation("В core.ypt нет словаря текстур.")
        );

        let mut many_textures = Image::new();
        let dictionary = many_textures.dictionary(&[]);
        many_textures.set_u64(0x20, dictionary);
        many_textures.set_u16((dictionary - BASE) as usize + 0x38, 4097);
        assert_eq!(
            failure(lab.inspect(&lab.file("core-tex-4097.ypt", &many_textures.file()))),
            operation("Словарь текстур заявляет слишком много записей.")
        );

        let mut many_events = Image::new();
        let rule = many_events.effect(b"many", None);
        let at = (rule - BASE) as usize;
        let array = many_events.alloc(8);
        many_events.set_u64(at + 0x38, Image::pointer(array));
        many_events.set_u16(at + 0x40, 4097);
        let dictionary = many_events.dictionary(&[rule]);
        many_events.set_u64(0x48, dictionary);
        assert_eq!(
            failure(lab.inspect(&lab.file("core-events-4097.ypt", &many_events.file()))),
            operation("У правила «many» заявлено слишком много событий.")
        );

        let mut many_evolutions = Image::new();
        let list = many_evolutions.evolutions(&[], &[]);
        many_evolutions.set_u16((list - BASE) as usize + 8, 4097);
        let rule = many_evolutions.effect(b"evo", Some(list));
        let dictionary = many_evolutions.dictionary(&[rule]);
        many_evolutions.set_u64(0x48, dictionary);
        assert_eq!(
            failure(lab.inspect(&lab.file("core-evo-4097.ypt", &many_evolutions.file()))),
            operation("Список эволюций заявляет слишком много записей.")
        );

        let mut past = Image::new();
        let at = IMAGE_BYTES - 0x30;
        let name = past.text(b"late");
        past.set_u64(at + 0x20, name);
        let rule = Image::pointer(at);
        let dictionary = past.dictionary(&[rule]);
        past.set_u64(0x48, dictionary);
        assert_eq!(
            failure(lab.inspect(&lab.file("core-past-end.ypt", &past.file()))),
            operation("Чтение за концом данных ресурса.")
        );
    }

    #[test]
    fn file_level_refusals() {
        let lab = Lab::new();
        let good = Image::new().file();
        let operation = |text: &str| ("InvalidOperationException".to_owned(), text.to_owned());
        let argument = |text: &str| ("ArgumentException".to_owned(), text.to_owned());
        assert_eq!(
            failure(lab.inspect(&lab.file("short.ypt", &good[..10]))),
            operation("Ресурс короче заголовка RSC7.")
        );
        assert_eq!(
            failure(lab.inspect(&lab.file("empty.ypt", b""))),
            operation("Ресурс короче заголовка RSC7.")
        );
        let mut no_magic = good.clone();
        no_magic[0] = b'X';
        assert_eq!(
            failure(lab.inspect(&lab.file("nomagic.ypt", &no_magic))),
            operation("Файл не является ресурсом RSC7.")
        );
        assert_eq!(
            failure(lab.inspect(&lab.file("core-v68.txt", &good))),
            argument("Unsupported file extension: .txt")
        );
        assert_eq!(
            failure(lab.inspect(&lab.file("single.ytd", &good))),
            argument("Unsupported file extension: .ytd")
        );
        assert_eq!(failure(lab.run(&[])), argument("--input is required."));
        assert_eq!(
            failure(lab.run(&["--input", ""])),
            argument("The path is empty.")
        );
        let missing = lab.dir.path().join("nothere.ypt").display().to_string();
        assert_eq!(
            failure(lab.run(&["--input", &missing])),
            (
                "FileNotFoundException".to_owned(),
                format!("File was not found: {missing}")
            )
        );
        let folder = lab.dir.path().join("folder.ypt");
        fs::create_dir_all(&folder).unwrap();
        assert_eq!(failure(lab.inspect(&folder)).0, "FileNotFoundException");

        let exact = lab.dir.path().join("limit-ok.ypt");
        fs::File::create(&exact)
            .unwrap()
            .set_len(FILE_BYTES_CAP)
            .unwrap();
        assert_eq!(
            failure(lab.inspect(&exact)),
            operation("Файл не является ресурсом RSC7.")
        );
        let over = lab.dir.path().join("limit-over.ypt");
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
    fn texture_formats_reuse_the_dictionary_labels() {
        assert_eq!(format_label(Format::Ati2), "D3DFMT_ATI2");
    }
}
