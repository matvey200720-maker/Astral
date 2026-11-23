//! `lamp-studio-glass`: стеклянные листы моделей фонарей выкладываются в файлы DDS.
//!
//! Лист — текстура, которую светящийся шейдер берёт как основной цвет. Выбор
//! листов делает `lamp_glass::glass_textures`, здесь собираются заголовок DDS и
//! имя файла, а сами файлы пишутся в папку вывода модели.

use std::collections::HashSet;
use std::path::PathBuf;

use rage_res::resource::Resource;
use rage_res::texture::TextureRef;
use serde_json::Value;

use super::lamp_mutations::refuse;
use crate::{args::Options, error::Result, progress::Progress};

/// Где в теле ресурса лежит рисовалка: у фрагмента по указателю из корня, у рисовалки — сам корень.
type DrawableAt = fn(&Resource, usize) -> Option<usize>;

/// Хвост имени файла и способ найти рисовалку; порядок строк — порядок проверки.
const SOURCES: [(&str, DrawableAt); 2] = [
    (".yft", |resource, root| resource.pointer_at(root + 0x30)),
    (".ydr", |_, root| Some(root)),
];

/// Слово заголовка DDS «глубина»: писатель заголовка кладёт 0, лист требует 1.
const DEPTH_WORD: usize = 24;
/// Слово признаков заголовка DDS и два признака: размер первого уровня целиком (сжатые форматы) и число уровней.
const FLAGS_WORD: usize = 8;
const LINEAR_SIZE_FLAG: u32 = 0x8_0000;
const MIP_COUNT_FLAG: u32 = 0x2_0000;

/// Предел помощника (`MaxModels` в `LampStudioCommands.cs`): мастерская фонарей отдаёт все 83 модели одним запросом
/// (сверка 16.11.2026); прежние 64 отдавали такой запрос помощнику.
const MAX_MODELS: usize = 512;

pub fn lamp_studio_glass(options: &Options, _progress: &Progress) -> Result<Value> {
    let request = read_request(options.required("input")?)?;
    let Some(models) = request
        .get("lampStudioGlassModels")
        .and_then(Value::as_array)
    else {
        return Err(refuse("Нет моделей стекла"));
    };
    if !(1..=MAX_MODELS).contains(&models.len()) {
        return Err(refuse("Число моделей вне 1…512"));
    }
    // Папки вывода создаются по ходу моделей; отказ дальше убирает созданные пустые.
    let guard = super::fresh_dirs::FreshDirs::merged(models.iter().map(|item| {
        let output = item.get("output").and_then(Value::as_str);
        super::fresh_dirs::FreshDirs::at(Ok(output.unwrap_or("")))
    }));
    let mut taken = HashSet::new();
    let mut done = Vec::with_capacity(models.len());
    for item in models {
        done.push(Model::of(item)?.export(&mut taken)?);
    }
    guard.keep();
    Ok(object([
        ("status", "ready".into()),
        ("mode", "lamp-studio-glass".into()),
        ("models", done.into()),
    ]))
}

fn object<const N: usize>(pairs: [(&str, Value); N]) -> Value {
    Value::Object(
        pairs
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect(),
    )
}

fn read_request(given: &str) -> Result<Value> {
    let file = crate::paths::existing_file(given, &[".json"])?;
    let bytes = std::fs::read(file)?;
    let root: Value =
        serde_json::from_slice(&bytes).map_err(|_| refuse("Запрос стекла не читается"))?;
    if root.get("mode").and_then(Value::as_str) == Some("lamp-studio-glass") {
        Ok(root)
    } else {
        Err(refuse("Запрос стекла другого режима"))
    }
}

/// Один лист, готовый к записи: описание текстуры, признак «общий» и байты DDS.
struct Sheet {
    texture: TextureRef,
    shared: bool,
    image: Vec<u8>,
}

/// Одна модель запроса, уже проверенная по форме и по пути.
struct Model<'a> {
    file: &'a str,
    name: &'a str,
    output: &'a str,
    suffix: &'static str,
    drawable_at: DrawableAt,
}

impl<'a> Model<'a> {
    fn of(item: &'a Value) -> Result<Self> {
        let field = |key: &str| item.get(key).and_then(Value::as_str);
        let file = field("file").ok_or_else(|| refuse("Модель без файла"))?;
        let name = field("model").ok_or_else(|| refuse("Модель без имени"))?;
        let output = field("output").ok_or_else(|| refuse("Модель без папки вывода"))?;
        let absolute = |text: &str| std::path::Path::new(text).is_absolute();
        if !absolute(file) || !absolute(output) {
            return Err(refuse("Пути стекла не абсолютные"));
        }
        let lowered = file.to_lowercase();
        let found = SOURCES.iter().find(|(suffix, _)| lowered.ends_with(suffix));
        let Some(&(suffix, drawable_at)) = found else {
            return Err(refuse("Стекло — только .yft и .ydr"));
        };
        Ok(Self {
            file,
            name,
            output,
            suffix,
            drawable_at,
        })
    }

    /// `taken` — файлы, уже записанные этим запросом: второй лист с тем же итоговым именем отказывает.
    fn export(&self, taken: &mut HashSet<String>) -> Result<Value> {
        let path = crate::paths::existing_file(self.file, &[self.suffix])?;
        let bytes = std::fs::read(path)?;
        let resource = Resource::parse(&bytes)?;
        let Some(root) = resource.at(rage_res::resource::SYSTEM_BASE) else {
            return Err(refuse("Фрагмент без корня"));
        };
        let textures = match (self.drawable_at)(&resource, root) {
            None => Vec::new(),
            Some(drawable) => {
                std::fs::create_dir_all(self.output)?;
                let sheets = self.sheets(&resource, drawable)?;
                self.store(sheets, taken)?
            }
        };
        Ok(object([
            ("model", self.name.into()),
            ("textures", textures.into()),
        ]))
    }

    fn sheets(&self, resource: &Resource, drawable: usize) -> Result<Vec<Sheet>> {
        rage_res::lamp_glass::glass_textures(resource, drawable)?
            .into_iter()
            .map(|glass| {
                let image = dds_file(resource, &glass.texture)?;
                Ok(Sheet {
                    texture: glass.texture,
                    shared: glass.shared,
                    image,
                })
            })
            .collect()
    }

    /// Пишет листы по одному и собирает их описания для ответа.
    fn store(&self, sheets: Vec<Sheet>, taken: &mut HashSet<String>) -> Result<Vec<Value>> {
        let mut entries = Vec::with_capacity(sheets.len());
        for Sheet {
            texture,
            shared,
            image,
        } in sheets
        {
            let file_name = format!("{}__{}.dds", safe_name(self.name), safe_name(&texture.name));
            let target = PathBuf::from(self.output).join(file_name);
            if !taken.insert(target.to_string_lossy().to_lowercase()) {
                return Err(refuse("Итоговое имя файла листа стекла повторяется"));
            }
            super::shop::write_atomic(&target, &image)?;
            let format = texture.format.map_or("", |format| format.name());
            entries.push(object([
                ("name", texture.name.as_str().into()),
                ("format", format!("D3DFMT_{format}").into()),
                ("width", texture.width.into()),
                ("height", texture.height.into()),
                ("levels", texture.levels.into()),
                ("bytes", texture.bytes.into()),
                ("file", target.display().to_string().into()),
                ("shared", shared.into()),
                ("sha256", rage_res::hash::sha256_hex(&image).into()),
            ]));
        }
        Ok(entries)
    }
}

/// Заголовок DDS с глубиной 1 и сразу за ним все ступени листа из тела ресурса.
fn dds_file(resource: &Resource, texture: &TextureRef) -> Result<Vec<u8>> {
    let (Some(format), Some(data_at)) = (texture.format, texture.data_at) else {
        return Err(match texture.format {
            None => refuse("Лист стекла без формата"),
            Some(_) => refuse("Лист стекла без данных"),
        });
    };
    let (width, height) = (texture.width as usize, texture.height as usize);
    let mut image =
        rage_res::dds_build::write_header(width, height, texture.levels, format.name())?;
    image[DEPTH_WORD..DEPTH_WORD + 4].copy_from_slice(&1u32.to_le_bytes());
    // Помощник у сжатых листов всегда поднимает признак числа уровней, и у листа в один уровень тоже: на настоящих
    // моделях игры 72 листа из 72 с `0xA1007`, один из них (`prop_wall_light_19a`, 4×4) в один уровень (сверка 16.11.2026).
    let flags = u32::from_le_bytes([image[FLAGS_WORD], image[FLAGS_WORD + 1], image[FLAGS_WORD + 2], image[FLAGS_WORD + 3]]);
    if flags & LINEAR_SIZE_FLAG != 0 {
        image[FLAGS_WORD..FLAGS_WORD + 4].copy_from_slice(&(flags | MIP_COUNT_FLAG).to_le_bytes());
    }
    image.extend_from_slice(resource.bytes(data_at, texture.bytes)?);
    Ok(image)
}

/// Серия подряд идущих знаков вне набора «латинская буква, цифра, `_`, `.`, `-`» — один `_`.
fn safe_name(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_run = false;
    for ch in text.chars() {
        let allowed = ch.is_ascii_alphanumeric() || "_.-".contains(ch);
        if allowed || !in_run {
            out.push(if allowed { ch } else { '_' });
        }
        in_run = !allowed;
    }
    out
}

pub const COMMANDS: &[super::Command] =
    &[super::Command::new("lamp-studio-glass", lamp_studio_glass)];

#[cfg(test)]
mod tests {
    use super::*;
    use crate::progress::Progress;
    use rage_res::hash::joaat;
    use rage_res::hash::sha256_hex;
    use serde_json::json;
    use std::fs;
    use std::path::Path;

    /// Лист стекла для сборки образца.
    struct Sheet {
        name: &'static str,
        width: u16,
        height: u16,
        levels: u8,
        code: u32,
        data: Vec<u8>,
    }

    /// Шейдер: текстурные слоты с хешем слота, светится ли он.
    struct Shader {
        emissive: bool,
        slots: Vec<(&'static str, usize)>,
    }

    const POINTER_BASE: u64 = 0x5000_0000;

    fn grow(body: &mut Vec<u8>, size: usize) -> usize {
        while body.len() % 16 != 0 {
            body.push(0);
        }
        let at = body.len();
        body.resize(at + size, 0);
        at
    }

    fn put_pointer(body: &mut [u8], at: usize, target: usize) {
        body[at..at + 8].copy_from_slice(&(POINTER_BASE + target as u64).to_le_bytes());
    }

    fn cstring(body: &mut Vec<u8>, text: &str) -> usize {
        let at = grow(body, text.len() + 1);
        body[at..at + text.len()].copy_from_slice(text.as_bytes());
        at
    }

    /// Рисовалка с группой шейдеров: словарь текстур и шейдеры по образцу правил выбора листов.
    fn drawable_body(
        sheets: &[Sheet],
        shaders: &[Shader],
        with_group: bool,
        base: usize,
    ) -> Vec<u8> {
        let mut body = vec![0u8; base + 0x40];
        if !with_group {
            return body;
        }
        let group = grow(&mut body, 0x20);
        put_pointer(&mut body, base + 0x10, group);
        let dictionary = grow(&mut body, 0x40);
        put_pointer(&mut body, group + 0x08, dictionary);
        let entries = grow(&mut body, sheets.len().max(1) * 8);
        put_pointer(&mut body, dictionary + 0x30, entries);
        body[dictionary + 0x38..dictionary + 0x3a]
            .copy_from_slice(&(sheets.len() as u16).to_le_bytes());
        let mut objects = Vec::new();
        for (index, sheet) in sheets.iter().enumerate() {
            let object = grow(&mut body, 0x80);
            let name = cstring(&mut body, sheet.name);
            put_pointer(&mut body, object + 0x28, name);
            body[object + 0x50..object + 0x52].copy_from_slice(&sheet.width.to_le_bytes());
            body[object + 0x52..object + 0x54].copy_from_slice(&sheet.height.to_le_bytes());
            body[object + 0x54..object + 0x56].copy_from_slice(&1u16.to_le_bytes());
            body[object + 0x58..object + 0x5c].copy_from_slice(&sheet.code.to_le_bytes());
            body[object + 0x5d] = sheet.levels;
            let data = grow(&mut body, sheet.data.len());
            body[data..data + sheet.data.len()].copy_from_slice(&sheet.data);
            put_pointer(&mut body, object + 0x70, data);
            put_pointer(&mut body, entries + index * 8, object);
            objects.push(object);
        }
        let list = grow(&mut body, shaders.len().max(1) * 8);
        put_pointer(&mut body, group + 0x10, list);
        body[group + 0x18..group + 0x1a].copy_from_slice(&(shaders.len() as u16).to_le_bytes());
        for (index, shader) in shaders.iter().enumerate() {
            let record = grow(&mut body, 0x20);
            put_pointer(&mut body, list + index * 8, record);
            let mut kinds: Vec<(Option<usize>, u32)> = shader
                .slots
                .iter()
                .map(|&(label, object)| (Some(objects[object]), joaat(label)))
                .collect();
            if shader.emissive {
                kinds.push((None, joaat("emissiveMultiplier")));
            }
            let params = grow(&mut body, kinds.len() * 16 + 16 + kinds.len() * 4);
            put_pointer(&mut body, record, params);
            body[record + 0x10] = kinds.len() as u8;
            let vectors = usize::from(shader.emissive);
            let hashes_at = params + kinds.len() * 16 + 16 * vectors;
            for (slot, (object, hash)) in kinds.iter().enumerate() {
                match object {
                    Some(object) => put_pointer(&mut body, params + slot * 16 + 8, *object),
                    None => body[params + slot * 16] = 1,
                }
                body[hashes_at + slot * 4..hashes_at + slot * 4 + 4]
                    .copy_from_slice(&hash.to_le_bytes());
            }
        }
        body
    }

    fn pack(version: u32, body: &[u8]) -> Vec<u8> {
        let shift = (0..16u32)
            .find(|s| (0x200usize << s) >= body.len())
            .expect("размер");
        let mut out = Vec::new();
        for word in [
            0x3743_5352u32,
            version,
            0x0800_0000 | ((version << 28) & 0xf000_0000) | shift,
            0x2000_0000,
        ] {
            out.extend_from_slice(&word.to_le_bytes());
        }
        out.extend(rage_res::resource::deflate_zlib9(body));
        out
    }

    fn data_of(seed: u8, size: usize) -> Vec<u8> {
        (0..size)
            .map(|i| (i as u8).wrapping_mul(31).wrapping_add(seed))
            .collect()
    }

    fn dxt1(name: &'static str) -> Sheet {
        Sheet {
            name,
            width: 16,
            height: 16,
            levels: 1,
            code: 0x3154_5844,
            data: data_of(7, 128),
        }
    }

    fn ydr(sheets: &[Sheet], shaders: &[Shader]) -> Vec<u8> {
        pack(165, &drawable_body(sheets, shaders, true, 0))
    }

    fn glass_shader(slots: &[(&'static str, usize)]) -> Shader {
        Shader {
            emissive: true,
            slots: slots.to_vec(),
        }
    }

    struct Bench {
        dir: tempfile::TempDir,
    }

    impl Bench {
        fn new() -> Self {
            Self {
                dir: tempfile::tempdir().expect("папка"),
            }
        }

        fn put(&self, name: &str, bytes: &[u8]) -> String {
            let path = self.dir.path().join(name);
            fs::write(&path, bytes).expect("запись");
            path.display().to_string()
        }

        fn glass_dir(&self) -> String {
            self.dir.path().join("glass").display().to_string()
        }

        fn run(&self, request: &Value) -> (Value, i32) {
            self.run_text(&request.to_string())
        }

        fn run_text(&self, text: &str) -> (Value, i32) {
            let file = self.dir.path().join("req.json");
            fs::write(&file, text).expect("запись");
            let argv = vec![
                "lamp-studio-glass".to_owned(),
                "--input".to_owned(),
                file.display().to_string(),
            ];
            let outcome = crate::run(&argv, &Progress::silent());
            (
                serde_json::from_str(&outcome.line).expect("JSON"),
                outcome.exit_code,
            )
        }

        fn model(&self, file: &str, name: &str) -> (Value, i32) {
            self.run(&json!({"mode": "lamp-studio-glass", "lampStudioGlassModels": [{"file": file, "model": name, "output": self.glass_dir()}]}))
        }
    }

    fn refused(response: &Value) -> (String, String) {
        (
            response["error"]["code"].as_str().unwrap_or("").to_owned(),
            response["error"]["message"]
                .as_str()
                .unwrap_or("")
                .to_owned(),
        )
    }

    fn host(what: &str) -> (String, String) {
        (
            "ArgumentException".to_owned(),
            format!("{what}: пока на хосте."),
        )
    }

    fn word(bytes: &[u8], at: usize) -> u32 {
        u32::from_le_bytes(bytes[at..at + 4].try_into().expect("слово"))
    }

    /// Две модели с одним именем и одной папкой дают одни и те же файлы: вторая отказывает, а не затирает первую.
    #[test]
    fn a_repeated_final_file_name_is_refused_not_overwritten() {
        let bench = Bench::new();
        let file = bench.put(
            "a.ydr",
            &ydr(
                &[dxt1("glass_a")],
                &[glass_shader(&[("DiffuseSampler", 0)])],
            ),
        );
        let (response, code) = bench.run(
            &json!({"mode": "lamp-studio-glass", "lampStudioGlassModels": [
                {"file": file, "model": "lamp", "output": bench.glass_dir()},
                {"file": file, "model": "LAMP", "output": bench.glass_dir()},
            ]}),
        );
        assert_eq!(code, 1, "{response}");
        assert_eq!(
            refused(&response),
            (
                "ArgumentException".to_owned(),
                "Итоговое имя файла листа стекла повторяется: пока на хосте.".to_owned()
            )
        );
        // Первый лист записан и не затёрт.
        assert!(Path::new(&bench.glass_dir())
            .join("lamp__glass_a.dds")
            .is_file());
    }

    #[test]
    fn one_dxt1_sheet_becomes_a_dds_with_depth_one() {
        let bench = Bench::new();
        let sheet = dxt1("glass_a");
        let data = sheet.data.clone();
        let file = bench.put(
            "a.ydr",
            &ydr(&[sheet], &[glass_shader(&[("DiffuseSampler", 0)])]),
        );
        let (response, code) = bench.model(&file, "lamp");
        assert_eq!(code, 0, "{response}");
        let target = format!("{}\\lamp__glass_a.dds", bench.glass_dir());
        let image = fs::read(&target).expect("DDS");
        assert_eq!(image.len(), 256);
        assert_eq!(&image[..4], b"DDS ");
        let expected_words = [
            (4, 124),
            // 0x000A_1007: признак числа уровней поднят и у листа в один уровень, как у помощника (сверка 16.11.2026).
            (8, 0x000A_1007),
            (12, 16),
            (16, 16),
            (20, 128),
            (24, 1),
            (28, 1),
            (76, 32),
            (80, 4),
            (84, 0x3154_5844),
            (108, 0x1000),
        ];
        for (at, value) in expected_words {
            assert_eq!(word(&image, at), value, "смещение {at}");
        }
        assert_eq!(image[128..], data[..]);
        let entry = &response["result"]["models"][0]["textures"][0];
        assert_eq!(
            entry,
            &json!({
                "name": "glass_a", "format": "D3DFMT_DXT1", "width": 16, "height": 16, "levels": 1, "bytes": 128,
                "file": target, "shared": false, "sha256": sha256_hex(&image),
            })
        );
        let keys: Vec<&String> = entry.as_object().expect("объект").keys().collect();
        assert_eq!(
            keys,
            ["name", "format", "width", "height", "levels", "bytes", "file", "shared", "sha256"]
        );
        let top: Vec<&String> = response["result"]
            .as_object()
            .expect("объект")
            .keys()
            .collect();
        assert_eq!(top, ["status", "mode", "models"]);
    }

    #[test]
    fn other_formats_and_two_levels() {
        let bench = Bench::new();
        let bc7 = Sheet {
            name: "bc7",
            width: 8,
            height: 8,
            levels: 2,
            code: 0x2037_4342,
            data: data_of(1, 64 + 16),
        };
        let argb = Sheet {
            name: "argb",
            width: 4,
            height: 4,
            levels: 1,
            code: 21,
            data: data_of(2, 64),
        };
        let l8 = Sheet {
            name: "l8",
            width: 4,
            height: 2,
            levels: 1,
            code: 50,
            data: data_of(3, 8),
        };
        let ati2 = Sheet {
            name: "ati2",
            width: 8,
            height: 4,
            levels: 1,
            code: 0x3249_5441,
            data: data_of(4, 32),
        };
        let shader = glass_shader(&[("DiffuseSampler", 0)]);
        let more = [
            glass_shader(&[("DiffuseSampler", 1)]),
            glass_shader(&[("DiffuseSampler", 2)]),
            glass_shader(&[("DiffuseSampler", 3)]),
        ];
        let mut shaders = vec![shader];
        shaders.extend(more);
        let file = bench.put("m.ydr", &ydr(&[bc7, argb, l8, ati2], &shaders));
        let (response, code) = bench.model(&file, "m");
        assert_eq!(code, 0, "{response}");
        let names: Vec<&str> = response["result"]["models"][0]["textures"]
            .as_array()
            .expect("массив")
            .iter()
            .map(|t| t["name"].as_str().unwrap_or(""))
            .collect();
        assert_eq!(names, ["bc7", "argb", "l8", "ati2"]);
        let read =
            |name: &str| fs::read(format!("{}\\m__{name}.dds", bench.glass_dir())).expect("DDS");
        let bc7 = read("bc7");
        assert_eq!(bc7.len(), 148 + 80);
        for (at, value) in [
            (8, 0x0008_1007 | 0x2_0000),
            (24, 1),
            (28, 2),
            (84, 0x3031_5844),
            (128, 98),
            (132, 3),
            (140, 1),
            (108, 0x1000 | 0x40_0008),
        ] {
            assert_eq!(word(&bc7, at), value, "BC7 смещение {at}");
        }
        let argb = read("argb");
        for (at, value) in [
            (8, 0x1007 | 0x8),
            (20, 16),
            (24, 1),
            (80, 0x41),
            (88, 32),
            (92, 0x00ff_0000),
            (96, 0xff00),
            (100, 0xff),
            (104, 0xff00_0000),
        ] {
            assert_eq!(word(&argb, at), value, "A8R8G8B8 смещение {at}");
        }
        let l8 = read("l8");
        assert_eq!(
            (word(&l8, 80), word(&l8, 88), word(&l8, 92), l8.len()),
            (0x20000, 8, 0xff, 128 + 8)
        );
        let ati2 = read("ati2");
        assert_eq!((word(&ati2, 84), word(&ati2, 20)), (0x3249_5441, 32));
        assert_eq!(
            response["result"]["models"][0]["textures"][0]["format"],
            "D3DFMT_BC7"
        );
        assert_eq!(response["result"]["models"][0]["textures"][0]["bytes"], 80);
    }

    #[test]
    fn shared_flag_order_and_missing_sheets() {
        let bench = Bench::new();
        let sheets = [dxt1("b_sheet"), dxt1("a_sheet"), dxt1("plain"), dxt1("dup")];
        let shaders = [
            glass_shader(&[("DiffuseSampler", 0)]),
            // Тот же лист берёт несветящийся шейдер: лист общий.
            Shader {
                emissive: false,
                slots: vec![("DiffuseSampler", 0), ("BumpSampler", 2)],
            },
            glass_shader(&[("DiffuseSampler", 1), ("SpecSampler", 3)]),
            // Повтор листа не добавляется.
            glass_shader(&[("DiffuseSampler", 0)]),
        ];
        let file = bench.put("s.ydr", &ydr(&sheets, &shaders));
        let (response, _) = bench.model(&file, "s");
        let found: Vec<(String, bool)> = response["result"]["models"][0]["textures"]
            .as_array()
            .expect("массив")
            .iter()
            .map(|t| {
                (
                    t["name"].as_str().unwrap_or("").to_owned(),
                    t["shared"].as_bool().unwrap_or(false),
                )
            })
            .collect();
        assert_eq!(
            found,
            [("b_sheet".to_owned(), true), ("a_sheet".to_owned(), false)]
        );
        // Лист, которого нет в словаре, пропускается.
        let broken = [Sheet {
            name: "a",
            width: 16,
            height: 16,
            levels: 1,
            code: 0x3154_5844,
            data: data_of(1, 128),
        }];
        let mut body = drawable_body(&broken, &[glass_shader(&[("DiffuseSampler", 0)])], true, 0);
        // Число записей словаря обнуляется: в словаре листа нет.
        let pointer = |body: &[u8], at: usize| {
            (u64::from_le_bytes(body[at..at + 8].try_into().expect("указатель")) - POINTER_BASE)
                as usize
        };
        let group = pointer(&body, 0x10);
        let dictionary = pointer(&body, group + 8);
        body[dictionary + 0x38..dictionary + 0x3a].copy_from_slice(&0u16.to_le_bytes());
        let file = bench.put("gone.ydr", &pack(165, &body));
        let (response, code) = bench.model(&file, "g");
        assert_eq!(code, 0, "{response}");
        assert_eq!(response["result"]["models"][0]["textures"], json!([]));
    }

    /// Отказ на одной из моделей убирает пустые папки, которые успели создать предыдущие (раньше они оставались).
    #[test]
    fn a_refusal_on_a_later_model_removes_the_empty_folders_of_earlier_ones() {
        let bench = Bench::new();
        let bare = bench.put("bare.ydr", &pack(165, &drawable_body(&[], &[], false, 0)));
        let first = bench.dir.path().join("made/first").display().to_string();
        let absent = bench.dir.path().join("absent.ydr").display().to_string();
        let (response, code) = bench.run(
            &json!({"mode": "lamp-studio-glass", "lampStudioGlassModels": [
                {"file": bare, "model": "a", "output": first},
                {"file": absent, "model": "b", "output": first},
            ]}),
        );
        assert_eq!(code, 1, "{response}");
        assert!(!bench.dir.path().join("made").exists());
    }

    #[test]
    fn folder_is_created_whenever_there_is_a_drawable() {
        let bench = Bench::new();
        // `.ydr` без группы шейдеров: папка создаётся, листов нет.
        let bare = bench.put("bare.ydr", &pack(165, &drawable_body(&[], &[], false, 0)));
        let (response, code) = bench.model(&bare, "x");
        assert_eq!(code, 0, "{response}");
        assert_eq!(response["result"]["models"][0]["textures"], json!([]));
        assert!(Path::new(&bench.glass_dir()).is_dir());
        // Фрагмент без указателя на рисовалку: папка не создаётся.
        let other = Bench::new();
        let frag = other.put("f.yft", &pack(162, &[0u8; 0x140]));
        let (response, code) = other.model(&frag, "x");
        assert_eq!(code, 0, "{response}");
        assert_eq!(response["result"]["models"][0]["textures"], json!([]));
        assert!(!Path::new(&other.glass_dir()).exists());
        // Фрагмент с рисовалкой: указатель на +0x30, рисовалка со смещением 0x100.
        let mut body = drawable_body(
            &[dxt1("glass_f")],
            &[glass_shader(&[("DiffuseSampler", 0)])],
            true,
            0x100,
        );
        put_pointer(&mut body, 0x30, 0x100);
        let third = Bench::new();
        let file = third.put("g.yft", &pack(162, &body));
        let (response, code) = third.model(&file, "frag");
        assert_eq!(code, 0, "{response}");
        assert_eq!(
            response["result"]["models"][0]["textures"][0]["name"],
            "glass_f"
        );
        assert!(Path::new(&third.glass_dir())
            .join("frag__glass_f.dds")
            .is_file());
    }

    #[test]
    fn file_names_collapse_unsafe_runs() {
        assert_eq!(safe_name("my lamp  v2"), "my_lamp_v2");
        assert_eq!(safe_name("glass sheet/1*"), "glass_sheet_1_");
        assert_eq!(safe_name("  --x--  "), "_--x--_");
        assert_eq!(safe_name("фонарь"), "_");
        assert_eq!(safe_name(".."), "..");
        assert_eq!(safe_name(""), "");
        assert_eq!(safe_name("a_ b"), "a__b");
        assert_eq!(safe_name("prop street 01"), "prop_street_01");
        assert_eq!(safe_name("a/b\\c.dds"), "a_b_c.dds");
        let bench = Bench::new();
        let file = bench.put(
            "a.ydr",
            &ydr(
                &[dxt1("glass sheet/1*")],
                &[glass_shader(&[("DiffuseSampler", 0)])],
            ),
        );
        let (response, code) = bench.model(&file, "");
        assert_eq!(code, 0, "{response}");
        assert!(Path::new(&bench.glass_dir())
            .join("__glass_sheet_1_.dds")
            .is_file());
    }

    #[test]
    fn response_path_keeps_the_output_text_as_written() {
        let bench = Bench::new();
        let file = bench.put(
            "a.ydr",
            &ydr(&[dxt1("g")], &[glass_shader(&[("DiffuseSampler", 0)])]),
        );
        let output = format!("{}/glass/../glass2/", bench.dir.path().display());
        let request = json!({"mode": "lamp-studio-glass", "lampStudioGlassModels": [{"file": file, "model": "m", "output": output}]});
        let (response, code) = bench.run(&request);
        assert_eq!(code, 0, "{response}");
        assert_eq!(
            response["result"]["models"][0]["textures"][0]["file"],
            format!("{output}m__g.dds")
        );
        // Две модели с одним итоговым именем файла: вторая отказывает, на диске остаётся первая (раньше последняя затирала).
        let other = bench.put(
            "b.ydr",
            &ydr(
                &[Sheet {
                    data: data_of(99, 128),
                    ..dxt1("g")
                }],
                &[glass_shader(&[("DiffuseSampler", 0)])],
            ),
        );
        let out = bench.glass_dir();
        let both = json!({"mode": "lamp-studio-glass", "lampStudioGlassModels": [
            {"file": file, "model": "m", "output": out}, {"file": other, "model": "m", "output": out}]});
        let (response, code) = bench.run(&both);
        assert_eq!(code, 1, "{response}");
        assert_eq!(
            refused(&response).1,
            "Итоговое имя файла листа стекла повторяется: пока на хосте."
        );
        let on_disk = fs::read(Path::new(&out).join("m__g.dds")).expect("DDS");
        assert_eq!(on_disk.len(), 128 + 128);
    }

    #[test]
    fn model_level_refusals_in_their_order() {
        let bench = Bench::new();
        let file = bench.put("a.ydr", &ydr(&[], &[]));
        let out = bench.glass_dir();
        let model = |item: Value| {
            refused(
                &bench
                    .run(&json!({"mode": "lamp-studio-glass", "lampStudioGlassModels": [item]}))
                    .0,
            )
        };
        assert_eq!(model(json!(5)), host("Модель без файла"));
        assert_eq!(
            model(json!({"model": "m", "output": out})),
            host("Модель без файла")
        );
        assert_eq!(
            model(json!({"file": file, "output": out})),
            host("Модель без имени")
        );
        assert_eq!(
            model(json!({"file": file, "model": "m"})),
            host("Модель без папки вывода")
        );
        assert_eq!(
            model(json!({"file": file, "model": "m", "output": 5})),
            host("Модель без папки вывода")
        );
        assert_eq!(
            model(json!({"file": "a.ydr", "model": "m", "output": out})),
            host("Пути стекла не абсолютные")
        );
        assert_eq!(
            model(json!({"file": file, "model": "m", "output": "rel\\glass"})),
            host("Пути стекла не абсолютные")
        );
        let only = host("Стекло — только .yft и .ydr");
        let base = bench.dir.path().display().to_string();
        for tail in ["x.ydd", "x.ymap", "x.txt", "noext"] {
            assert_eq!(
                model(json!({"file": format!("{base}\\{tail}"), "model": "m", "output": out})),
                only,
                "{tail}"
            );
        }
        let absent = format!("{base}\\absent.ydr");
        assert_eq!(
            model(json!({"file": absent, "model": "m", "output": out})),
            (
                "FileNotFoundException".to_owned(),
                format!("File was not found: {absent}")
            )
        );
        let folder = bench.dir.path().join("d.yft");
        fs::create_dir(&folder).expect("папка");
        assert_eq!(
            model(json!({"file": folder.display().to_string(), "model": "m", "output": out})).0,
            "FileNotFoundException"
        );
        // Выход — файл на месте папки: ошибка ОС, но не раньше чтения файла.
        let blocker = bench.put("blocker", b"x");
        assert_eq!(
            model(json!({"file": file, "model": "m", "output": blocker})).0,
            "IOException"
        );
        let bad = bench.put("bad.ydr", &[1u8; 40]);
        assert_eq!(
            model(json!({"file": bad, "model": "m", "output": out})),
            (
                "InvalidOperationException".to_owned(),
                "Файл не является ресурсом RSC7.".to_owned()
            )
        );
    }

    #[test]
    fn failure_on_a_later_model_keeps_the_earlier_files() {
        let bench = Bench::new();
        let file = bench.put(
            "a.ydr",
            &ydr(&[dxt1("g")], &[glass_shader(&[("DiffuseSampler", 0)])]),
        );
        let absent = bench.dir.path().join("none.ydr").display().to_string();
        let out = bench.glass_dir();
        let request = json!({"mode": "lamp-studio-glass", "lampStudioGlassModels": [
            {"file": file, "model": "m", "output": out}, {"file": absent, "model": "n", "output": out}]});
        let (response, code) = bench.run(&request);
        assert_eq!(code, 1);
        assert_eq!(refused(&response).0, "FileNotFoundException");
        assert!(Path::new(&out).join("m__g.dds").is_file());
    }

    #[test]
    fn request_level_refusals_in_their_order() {
        let bench = Bench::new();
        let run_arg = |args: &[&str]| {
            let argv: Vec<String> = args.iter().map(|a| (*a).to_owned()).collect();
            let outcome = crate::run(&argv, &Progress::silent());
            serde_json::from_str::<Value>(&outcome.line).expect("JSON")
        };
        assert_eq!(
            refused(&run_arg(&["lamp-studio-glass"])).1,
            "--input is required."
        );
        let text = bench.put("req.txt", b"{}");
        assert_eq!(
            refused(&run_arg(&["lamp-studio-glass", "--input", &text])).1,
            "Unsupported file extension: .txt"
        );
        for text in ["", "not json"] {
            assert_eq!(
                refused(&bench.run_text(text).0),
                host("Запрос стекла не читается")
            );
        }
        for text in ["[]", "{}", "{\"mode\":\"lamp-studio-inspect\"}"] {
            assert_eq!(
                refused(&bench.run_text(text).0),
                host("Запрос стекла другого режима")
            );
        }
        for text in [
            "{\"mode\":\"lamp-studio-glass\"}",
            "{\"mode\":\"lamp-studio-glass\",\"lampStudioGlassModels\":{}}",
        ] {
            assert_eq!(refused(&bench.run_text(text).0), host("Нет моделей стекла"));
        }
        assert_eq!(
            refused(
                &bench
                    .run_text("{\"mode\":\"lamp-studio-glass\",\"lampStudioGlassModels\":[]}")
                    .0
            ),
            host("Число моделей вне 1…512")
        );
        let many = vec![json!({"file": "x", "model": "m", "output": "y"}); 513];
        assert_eq!(
            refused(
                &bench
                    .run(&json!({"mode": "lamp-studio-glass", "lampStudioGlassModels": many}))
                    .0
            ),
            host("Число моделей вне 1…512")
        );
        // Мастерская фонарей выгружает стекло сразу у 83 моделей (сверка 16.11.2026): число уже не отказ,
        // дальше запрос упирается в файл (его нет), а не в счёт.
        let workshop: Vec<Value> = (0..83)
            .map(|index| json!({"file": "absent.yft", "model": format!("m{index}"), "output": format!("o{index}")}))
            .collect();
        let (answer, _) = bench.run(&json!({"mode": "lamp-studio-glass", "lampStudioGlassModels": workshop}));
        let text = answer["error"]["message"].as_str().unwrap_or_default();
        assert!(!text.contains("Число моделей"), "{answer}");
    }
}
