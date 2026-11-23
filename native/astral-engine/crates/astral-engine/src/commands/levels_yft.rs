//! `downscale-textures` для фрагментов `.yft` (выключатель `ASTRAL_RUST_DOWNSCALE_YFT`).
//!
//! Текстуры фрагмента лежат в словарях его рисовалок: основной и рисовалки ткани (`rage_res::fragment_textures`).
//! Запись проходит те же шаги, что модель `.ydr` в `levels.rs`: срез ступеней или пересжатие, стадии, правка описаний
//! и данных прямо в теле ресурса (`fragment_textures::patch_body`), проверка перечитыванием. Тела всех пределов
//! записи сжимаются разом (по потоку на предел) и распаковываются обратно для сверки.
//! Фрагмент с тканью или бьющимися стёклами остаётся как в игре: запись называет это в `kept` и файла не даёт.
//!
//! Вызывается из `levels::process_bytes` только когда выключатель стоит; без него `.yft` отказывает прежним текстом.

use std::{env, fs, path::Path, thread};

use rage_res::{
    fragment_textures::{self, Change, Fragment},
    hash,
    resource::{deflate_zlib9, Resource, HEADER_BYTES},
};
use serde_json::{Map, Value};

use super::shop::write_atomic;
use crate::{
    error::{EngineError, Result},
    texture_levels::{self, Level},
    texture_stages,
};

/// Переменная окружения движка: с `on` или `1` фрагменты `.yft` обрабатываются.
const GATE_ENV: &str = "ASTRAL_RUST_DOWNSCALE_YFT";

/// Почему фрагмент остаётся как в игре.
const KEPT_REASON: &str = "cloth or glass";

fn is_on(value: Option<&str>) -> bool {
    matches!(
        value
            .map(|text| text.trim().to_ascii_lowercase())
            .as_deref(),
        Some("on" | "1")
    )
}

/// Включён ли путь `.yft` в этом процессе.
pub(crate) fn enabled() -> bool {
    is_on(env::var(GATE_ENV).ok().as_deref())
}

fn not_loaded() -> EngineError {
    EngineError::invalid_data("resource did not load")
}

fn not_saved() -> EngineError {
    EngineError::invalid_data("model did not survive a save")
}

/// Объект из пар «ключ, значение» в том же порядке.
fn object(pairs: Vec<(&str, Value)>) -> Value {
    Value::Object(
        pairs
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect::<Map<_, _>>(),
    )
}

/// Открытый фрагмент: ресурс, его текстуры с описаниями и те же текстуры с данными.
struct Opened {
    resource: Resource,
    fragment: Fragment,
    levels: Vec<Level>,
}

/// Текстура фрагмента с её данными из ресурса.
fn level_of(resource: &Resource, texture: &fragment_textures::Texture) -> Result<Level> {
    let data = resource
        .bytes(texture.data_at, texture.payload_len)?
        .to_vec();
    Ok(Level {
        name: texture.name.clone(),
        format: texture.format,
        width: usize::from(texture.width),
        height: usize::from(texture.height),
        stride: usize::from(texture.stride),
        levels: usize::from(texture.levels),
        depth: usize::from(texture.depth),
        data,
    })
}

/// Разбор ресурса и описаний; любая неудача — «не открылся».
fn open(bytes: &[u8]) -> Result<Opened> {
    let resource = Resource::parse(bytes).map_err(|_| not_loaded())?;
    let fragment = fragment_textures::read(&resource).map_err(|_| not_loaded())?;
    let mut levels = Vec::with_capacity(fragment.textures.len());
    for texture in &fragment.textures {
        levels.push(level_of(&resource, texture)?);
    }
    Ok(Opened {
        resource,
        fragment,
        levels,
    })
}

/// Перечитанный фрагмент обязан дать те же текстуры: число, размеры, шаг, ступени, формат и байты.
fn reads_back_as(resource: &Resource, expected: &[Level]) -> bool {
    let Ok(found) = fragment_textures::read(resource) else {
        return false;
    };
    let shape = |level: &Level| {
        (
            level.width,
            level.height,
            level.stride,
            level.levels,
            level.format,
        )
    };
    found.textures.len() == expected.len()
        && found.textures.iter().zip(expected).all(|(texture, want)| {
            level_of(resource, texture)
                .is_ok_and(|read| shape(&read) == shape(want) && read.data == want.data)
        })
}

/// Тело фрагмента с изменёнными против исходных текстурами (без сжатия); оно перечитывается и обязано дать `now`.
fn patched_body(opened: &Opened, before: &[Level], now: &[Level]) -> Result<Vec<u8>> {
    let changes: Vec<Change> = now
        .iter()
        .enumerate()
        .filter(|(index, level)| **level != before[*index])
        .map(|(index, level)| Change {
            texture: opened.fragment.textures[index].clone(),
            width: level.width as u16,
            height: level.height as u16,
            stride: level.stride as u16,
            levels: level.levels as u8,
            format: level.format,
            payload: level.data.clone(),
        })
        .collect();
    let Some(body) = fragment_textures::patch_body(&opened.resource, &changes) else {
        return Err(EngineError::invalid_data(
            "model textures could not be written in place",
        ));
    };
    let again = Resource::from_parts(opened.resource.header, body.clone());
    match reads_back_as(&again, now) {
        true => Ok(body),
        false => Err(not_saved()),
    }
}

/// Файл из заголовка исходного ресурса и сжатого тела (zlib-rs, уровень 9, как у `Resource::to_file_bytes`).
/// Побайтно со сжатием .NET у хоста не сойтись ни одним из доступных сжимателей; этот даёт файл не больше хостового
/// +1 % на всех замеренных файлах (libdeflate 9 — до +3,2 %), сумма меньше хостовой. Файл распаковывается обратно
/// и обязан дать то же тело.
fn pack(head: &[u8], body: &[u8]) -> Result<Vec<u8>> {
    let file = [head, &deflate_zlib9(body)[..]].concat();
    match Resource::parse(&file) {
        Ok(again) if again.data() == body => Ok(file),
        _ => Err(not_saved()),
    }
}

/// Файлы всех тел; тела сжимаются по потоку на каждое, если их больше одного.
fn pack_all(head: &[u8], bodies: &[Vec<u8>]) -> Result<Vec<Vec<u8>>> {
    if bodies.len() < 2 {
        return bodies.iter().map(|body| pack(head, body)).collect();
    }
    thread::scope(|scope| {
        let workers: Vec<_> = bodies
            .iter()
            .map(|body| scope.spawn(move || pack(head, body)))
            .collect();
        workers
            .into_iter()
            .map(|worker| worker.join().unwrap_or_else(|_| Err(not_saved())))
            .collect()
    })
}

/// Что сделал один предел.
#[derive(Default)]
struct Tally {
    changed: usize,
    resampled: usize,
    staged: usize,
}

/// Справочные текстуры (палитры, таблицы, полоски) не режутся, но стадии на них действуют.
fn is_reference(level: &Level) -> bool {
    let name = level.name.to_ascii_lowercase();
    let strip = level.height <= 8 && level.width >= 16 * level.height.max(1);
    strip
        || name.contains("palette")
        || name.contains("_pal_")
        || name.ends_with("_pal")
        || name.ends_with("_lut")
}

/// Один предел по всем текстурам на месте: срез и пересжатие (кроме справочных), затем стадии.
fn cut_to(
    textures: &mut [Level],
    cap: usize,
    stages: &[String],
    failures: &mut Vec<String>,
) -> Tally {
    textures
        .iter_mut()
        .fold(Tally::default(), |mut tally, level| {
            let (cut, resampled) = match is_reference(level) {
                true => (false, false),
                false => {
                    let cut = texture_levels::drop_to(level, cap);
                    let still_big = level.width.max(level.height) > cap;
                    (
                        cut,
                        still_big && texture_levels::resample_to(level, cap, failures),
                    )
                }
            };
            // Каждая стадия применяется, даже если предыдущая уже изменила данные.
            let painted = stages.iter().fold(false, |hit, stage| {
                texture_stages::apply(level, stage) | hit
            });
            tally.changed += usize::from(cut || resampled || painted);
            tally.resampled += usize::from(resampled);
            tally.staged += usize::from(painted);
            tally
        })
}

/// Предел, давший изменения: счёт, папка варианта и тело файла до сжатия.
struct Variant {
    cap: usize,
    tally: Tally,
    key: String,
    body: Vec<u8>,
}

/// Накопленное по пределам: текущие текстуры, сбои кодека и варианты.
struct Cut {
    current: Vec<Level>,
    failures: Vec<String>,
    variants: Vec<Variant>,
}

fn level_record(cap: usize, tally: &Tally, built: &[u8], variant: &str) -> Value {
    object(vec![
        ("cap", cap.into()),
        ("changed", tally.changed.into()),
        ("bytes", built.len().into()),
        ("sha256", hash::sha256_hex(built).into()),
        ("variant", variant.into()),
        ("staged", tally.staged.into()),
        ("resampled", tally.resampled.into()),
    ])
}

/// Обрабатывает байты одного фрагмента: пишет файлы вариантов и возвращает запись отчёта.
pub(crate) fn process_bytes(
    at: &str,
    name: &str,
    bytes: &[u8],
    caps: &[usize],
    stages: &[String],
    output_directory: &Path,
) -> Result<Value> {
    let opened = open(bytes)?;
    let originals = &opened.levels;
    let mut fields: Vec<(&str, Value)> = vec![
        ("at", at.into()),
        ("name", name.into()),
        ("original", bytes.len().into()),
    ];
    if originals.is_empty() {
        fields.push(("textures", 0.into()));
        fields.push(("levels", Value::Array(Vec::new())));
        return Ok(object(fields));
    }
    if opened.fragment.cloth_or_glass {
        fields.push(("textures", originals.len().into()));
        fields.push(("levels", Value::Array(Vec::new())));
        fields.push(("kept", KEPT_REASON.into()));
        return Ok(object(fields));
    }
    let start = Cut {
        current: originals.clone(),
        failures: Vec::new(),
        variants: Vec::new(),
    };
    let mut cut = caps
        .iter()
        .try_fold(start, |mut cut, &cap| -> Result<Cut> {
            let tally = cut_to(&mut cut.current, cap, stages, &mut cut.failures);
            if tally.changed > 0 {
                let body = patched_body(&opened, originals, &cut.current)?;
                let key = texture_stages::variant_key(cap, stages);
                cut.variants.push(Variant {
                    cap,
                    tally,
                    key,
                    body,
                });
            }
            Ok(cut)
        })?;
    // Тела сжимаются разом; файлы пишутся после всех пределов записи.
    let bodies: Vec<Vec<u8>> = cut
        .variants
        .iter_mut()
        .map(|variant| std::mem::take(&mut variant.body))
        .collect();
    let files = pack_all(&bytes[..HEADER_BYTES], &bodies)?;
    let mut levels = Vec::with_capacity(files.len());
    for (variant, built) in cut.variants.iter().zip(&files) {
        levels.push(level_record(
            variant.cap,
            &variant.tally,
            built,
            &variant.key,
        ));
        let target = output_directory.join(&variant.key).join(name);
        if let Some(folder) = target.parent() {
            fs::create_dir_all(folder)?;
        }
        write_atomic(&target, built)?;
    }
    let smallest = caps.iter().copied().min().unwrap_or(0);
    let unmipped = cut
        .current
        .iter()
        .filter(|level| !is_reference(level) && level.width.max(level.height) > smallest)
        .count();
    fields.push(("textures", originals.len().into()));
    fields.push(("levels", Value::Array(levels)));
    fields.push(("unmipped", unmipped.into()));
    if !cut.failures.is_empty() {
        cut.failures.sort();
        cut.failures.dedup();
        fields.push(("codecFailures", cut.failures.into()));
    }
    Ok(object(fields))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    use rage_res::{
        fragment_textures,
        resource::{Header, Resource},
        texture::Format,
    };

    use crate::texture_levels::{codec_of, shrink};

    const SYSTEM: u64 = 0x5000_0000;
    const GRAPHICS: u64 = 0x6000_0000;

    fn put16(body: &mut [u8], at: usize, value: u16) {
        body[at..at + 2].copy_from_slice(&value.to_le_bytes());
    }

    fn put32(body: &mut [u8], at: usize, value: u32) {
        body[at..at + 4].copy_from_slice(&value.to_le_bytes());
    }

    fn put64(body: &mut [u8], at: usize, value: u64) {
        body[at..at + 8].copy_from_slice(&value.to_le_bytes());
    }

    fn format_of(text: &str) -> Format {
        match text {
            "DXT1" => Format::Dxt1,
            "DXT5" => Format::Dxt5,
            "A8R8G8B8" => Format::A8R8G8B8,
            other => panic!("{other}"),
        }
    }

    /// Градиент RGBA нужной стороны.
    fn picture(width: usize, height: usize) -> Vec<u8> {
        let mut rgba = Vec::with_capacity(width * height * 4);
        for y in 0..height {
            for x in 0..width {
                rgba.extend([(x * 255 / width) as u8, (y * 255 / height) as u8, 128, 255]);
            }
        }
        rgba
    }

    /// Данные всех ступеней по описанию `ширина x высота:ФОРМАТ:число ступеней`.
    fn payload_of(spec: &str) -> (u16, u16, Format, u8, Vec<u8>) {
        let parts: Vec<&str> = spec.split(':').collect();
        let (width, height) = parts[0].split_once('x').unwrap();
        let (width, height): (usize, usize) = (width.parse().unwrap(), height.parse().unwrap());
        let format = format_of(parts[1]);
        let count: usize = parts[2].parse().unwrap();
        let codec = codec_of(format).unwrap();
        let mut rgba = picture(width, height);
        let (mut w, mut h) = (width, height);
        let mut payload = Vec::new();
        for level in 0..count {
            if level > 0 {
                let (nw, nh) = ((w / 2).max(1), (h / 2).max(1));
                rgba = shrink(&rgba, w, h, nw, nh);
                (w, h) = (nw, nh);
            }
            payload.extend(codec.encode(&rgba, w, h).unwrap());
        }
        (width as u16, height as u16, format, count as u8, payload)
    }

    /// Что положить во фрагмент: текстуры основной рисовалки и рисовалки ткани, ткань и стёкла.
    #[derive(Default)]
    struct Parts<'a> {
        main: Vec<&'a str>,
        cloth: Vec<&'a str>,
        glass: u16,
        cloth_list: u16,
    }

    /// Цепочка рисовалка → группа → словарь → список с описаниями по `entries`.
    fn chain(body: &mut [u8], drawable: usize, entries: &[usize]) {
        let (group, dictionary, list) = (drawable + 0x100, drawable + 0x200, drawable + 0x300);
        put64(body, drawable + 0x10, SYSTEM + group as u64);
        put64(body, group + 0x08, SYSTEM + dictionary as u64);
        put64(body, dictionary + 0x30, SYSTEM + list as u64);
        put16(body, dictionary + 0x38, entries.len() as u16);
        for (index, entry) in entries.iter().enumerate() {
            put64(body, list + 8 * index, SYSTEM + *entry as u64);
        }
    }

    /// Описания и данные текстур одной рисовалки; возвращает смещения описаний.
    fn place_textures(
        body: &mut [u8],
        specs: &[&str],
        (first_desc, first_name): (usize, usize),
        graphics_at: &mut usize,
        prefix: &str,
    ) -> Vec<usize> {
        let mut entries = Vec::new();
        for (index, spec) in specs.iter().enumerate() {
            let (width, height, format, levels, payload) = payload_of(spec);
            let object = first_desc + 0x80 * index;
            let name_at = first_name + 0x20 * index;
            let text = format!("{prefix}{index}");
            body[name_at..name_at + text.len()].copy_from_slice(text.as_bytes());
            body[object..object + 0x78].fill(0);
            put64(body, object + 0x28, SYSTEM + name_at as u64);
            put16(body, object + 0x50, width);
            put16(body, object + 0x52, height);
            let stride = (format.level_bytes(usize::from(width), usize::from(height))
                / usize::from(height)) as u16;
            put16(body, object + 0x56, stride);
            put32(body, object + 0x58, format.code());
            body[object + 0x5D] = levels;
            put64(body, object + 0x70, GRAPHICS + *graphics_at as u64);
            let target = 0x2000 + *graphics_at;
            body[target..target + payload.len()].copy_from_slice(&payload);
            *graphics_at += payload.len().next_multiple_of(16);
            entries.push(object);
        }
        entries
    }

    /// Файл фрагмента (RSC7, версия 162): система 0x2000, графика 0x6000.
    fn fragment_file(parts: &Parts) -> Vec<u8> {
        let mut body = vec![0u8; 0x8000];
        let mut graphics_at = 0usize;
        put64(&mut body, 0x30, SYSTEM + 0x400);
        let main = place_textures(
            &mut body,
            &parts.main,
            (0x800, 0x1000),
            &mut graphics_at,
            "main",
        );
        chain(&mut body, 0x400, &main);
        if !parts.cloth.is_empty() {
            put64(&mut body, 0xf8, SYSTEM + 0x1000 + 0x400);
            let entries = place_textures(
                &mut body,
                &parts.cloth,
                (0x1800, 0x1e00),
                &mut graphics_at,
                "cloth",
            );
            chain(&mut body, 0x1400, &entries);
        }
        if parts.cloth_list > 0 {
            put64(&mut body, 0x60, SYSTEM + 0x1f00);
            put16(&mut body, 0x68, parts.cloth_list);
            put16(&mut body, 0x6a, parts.cloth_list);
        }
        put64(
            &mut body,
            0xd8,
            if parts.glass > 0 { SYSTEM + 0x1f80 } else { 0 },
        );
        put16(&mut body, 0xe0, parts.glass);
        assert!(graphics_at <= 0x6000);
        let header = Header {
            system_flags: 0xA800_0004,
            graphics_flags: 0x2C00_0004,
            system_size: 0x2000,
            graphics_size: 0x6000,
            version: 162,
            declared_version: 0xFFFF_FFFF,
        };
        Resource::from_parts(header, body).to_file_bytes().unwrap()
    }

    fn strings(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    fn run(
        file: &[u8],
        caps: &[usize],
        stages: &[&str],
        out: &Path,
    ) -> crate::error::Result<Value> {
        process_bytes("at", "frag.yft", file, caps, &strings(stages), out)
    }

    fn read(file: &[u8]) -> fragment_textures::Fragment {
        fragment_textures::read(&Resource::parse(file).unwrap()).unwrap()
    }

    fn sides(file: &[u8]) -> Vec<(String, u16, u16, u16, u8)> {
        read(file)
            .textures
            .iter()
            .map(|t| (t.name.clone(), t.width, t.height, t.stride, t.levels))
            .collect()
    }

    #[test]
    fn the_gate_wants_on_or_one() {
        // Сам выключатель — `enabled()`; здесь разбор значения.
        for (value, on) in [
            (Some("on"), true),
            (Some("ON"), true),
            (Some(" 1 "), true),
            (Some("true"), false),
            (Some("off"), false),
            (Some(""), false),
            (None, false),
        ] {
            assert_eq!(is_on(value), on, "{value:?}");
        }
    }

    #[test]
    fn textures_of_the_main_drawable_are_cut_and_written_in_place() {
        let dir = tempfile::tempdir().unwrap();
        let parts = Parts {
            main: vec!["128x128:DXT1:6", "64x64:DXT5:5", "32x32:A8R8G8B8:1"],
            ..Parts::default()
        };
        let file = fragment_file(&parts);
        let record = run(&file, &[32], &[], dir.path()).unwrap();
        assert_eq!(record["at"], "at");
        assert_eq!(record["name"], "frag.yft");
        assert_eq!(record["original"], file.len());
        assert_eq!(record["textures"], 3);
        assert_eq!(record["unmipped"], 0);
        let level = &record["levels"][0];
        assert_eq!(level["cap"], 32);
        assert_eq!(level["changed"], 2);
        assert_eq!(level["variant"], "32");
        assert_eq!(level["staged"], 0);
        assert_eq!(level["resampled"], 0);
        let written = fs::read(dir.path().join("32").join("frag.yft")).unwrap();
        assert_eq!(level["bytes"], written.len());
        assert_eq!(
            level["sha256"],
            Value::from(rage_res::hash::sha256_hex(&written))
        );
        assert_eq!(
            sides(&written),
            [
                ("main0".to_owned(), 32, 32, 16, 4),
                ("main1".to_owned(), 32, 32, 32, 4),
                ("main2".to_owned(), 32, 32, 128, 1),
            ]
        );
        // Заголовок прежний; число ресурса и порядок текстур те же.
        assert_eq!(written[..16], file[..16]);
        assert_eq!(read(&written).textures.len(), 3);
    }

    #[test]
    fn the_body_is_packed_like_a_resource_file_of_the_engine() {
        // Тело сжимается так же, как у `Resource::to_file_bytes` (zlib-rs, уровень 9): побайтно с сжатием .NET у
        // хоста не сойтись, а файл выходит не больше хостового +1 % (сумма меньше хостовой).
        let dir = tempfile::tempdir().unwrap();
        let file = fragment_file(&Parts {
            main: vec!["128x128:DXT1:6", "64x64:DXT5:5"],
            ..Parts::default()
        });
        run(&file, &[32], &[], dir.path()).unwrap();
        let written = fs::read(dir.path().join("32").join("frag.yft")).unwrap();
        let body = Resource::parse(&written).unwrap();
        assert_eq!(
            written[16..],
            rage_res::resource::deflate_zlib9(body.data())[..]
        );
    }

    #[test]
    fn caps_are_applied_one_after_another_on_the_same_textures() {
        let dir = tempfile::tempdir().unwrap();
        let parts = Parts {
            main: vec!["128x128:DXT1:6"],
            ..Parts::default()
        };
        let file = fragment_file(&parts);
        let record = run(&file, &[64, 16], &[], dir.path()).unwrap();
        assert_eq!(record["levels"][0]["cap"], 64);
        assert_eq!(record["levels"][1]["cap"], 16);
        let at = |cap: &str| sides(&fs::read(dir.path().join(cap).join("frag.yft")).unwrap());
        assert_eq!(at("64"), [("main0".to_owned(), 64, 64, 32, 5)]);
        assert_eq!(at("16"), [("main0".to_owned(), 16, 16, 8, 3)]);
    }

    #[test]
    fn a_cap_above_every_side_writes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let file = fragment_file(&Parts {
            main: vec!["64x64:DXT1:5"],
            ..Parts::default()
        });
        let record = run(&file, &[128], &[], dir.path()).unwrap();
        assert_eq!(record["levels"], Value::Array(Vec::new()));
        assert_eq!(record["unmipped"], 0);
        assert!(!dir.path().join("128").exists());
    }

    #[test]
    fn a_texture_without_steps_is_resampled_and_counted() {
        let dir = tempfile::tempdir().unwrap();
        let file = fragment_file(&Parts {
            main: vec!["64x64:A8R8G8B8:1"],
            ..Parts::default()
        });
        let record = run(&file, &[16], &[], dir.path()).unwrap();
        assert_eq!(record["levels"][0]["resampled"], 1);
        let written = fs::read(dir.path().join("16").join("frag.yft")).unwrap();
        assert_eq!(sides(&written)[0].1, 16);
    }

    #[test]
    fn the_stage_names_the_variant_folder() {
        let dir = tempfile::tempdir().unwrap();
        let file = fragment_file(&Parts {
            main: vec!["128x128:DXT1:6"],
            ..Parts::default()
        });
        let record = run(&file, &[32], &["grayscale"], dir.path()).unwrap();
        assert_eq!(record["levels"][0]["variant"], "32+grayscale");
        assert_eq!(record["levels"][0]["staged"], 1);
        assert!(dir.path().join("32+grayscale").join("frag.yft").is_file());
    }

    #[test]
    fn cloth_and_glass_fragments_stay_as_in_the_game() {
        for parts in [
            Parts {
                main: vec!["128x128:DXT1:6"],
                cloth: vec!["128x128:DXT1:6"],
                ..Parts::default()
            },
            Parts {
                main: vec!["128x128:DXT1:6"],
                cloth_list: 2,
                ..Parts::default()
            },
            Parts {
                main: vec!["128x128:DXT1:6"],
                glass: 3,
                ..Parts::default()
            },
        ] {
            let dir = tempfile::tempdir().unwrap();
            let file = fragment_file(&parts);
            let count = parts.main.len() + parts.cloth.len();
            let record = run(&file, &[32], &[], dir.path()).unwrap();
            assert_eq!(
                record.to_string(),
                format!(
                    r#"{{"at":"at","name":"frag.yft","original":{},"textures":{count},"levels":[],"kept":"cloth or glass"}}"#,
                    file.len()
                )
            );
            assert!(!dir.path().join("32").exists());
        }
    }

    #[test]
    fn a_cloth_fragment_without_textures_is_an_ordinary_empty_record() {
        let dir = tempfile::tempdir().unwrap();
        let file = fragment_file(&Parts {
            glass: 2,
            ..Parts::default()
        });
        let record = run(&file, &[32], &[], dir.path()).unwrap();
        assert_eq!(
            record.to_string(),
            format!(
                r#"{{"at":"at","name":"frag.yft","original":{},"textures":0,"levels":[]}}"#,
                file.len()
            )
        );
    }

    #[test]
    fn what_is_not_a_fragment_does_not_load() {
        let dir = tempfile::tempdir().unwrap();
        let loaded = |bytes: &[u8]| {
            let error = run(bytes, &[32], &[], dir.path()).unwrap_err();
            (error.code, error.message)
        };
        let expected = (
            "InvalidDataException".to_owned(),
            "resource did not load".to_owned(),
        );
        assert_eq!(loaded(b""), expected);
        assert_eq!(loaded(b"junk"), expected);
        // Словарь текстур (версия 13) под именем фрагмента.
        let mut header = Header {
            system_flags: 0xD800_0004,
            graphics_flags: 0x0800_0004,
            system_size: 0x2000,
            graphics_size: 0x2000,
            version: 13,
            declared_version: 0xFFFF_FFFF,
        };
        let dictionary = Resource::from_parts(header, vec![0u8; 0x4000])
            .to_file_bytes()
            .unwrap();
        assert_eq!(loaded(&dictionary), expected);
        // Рисовалка (версия 165).
        header.system_flags = 0xA800_0004;
        header.graphics_flags = 0x5800_0004;
        header.version = 165;
        let drawable = Resource::from_parts(header, vec![0u8; 0x4000])
            .to_file_bytes()
            .unwrap();
        assert_eq!(loaded(&drawable), expected);
        assert!(!dir.path().join("32").exists());
    }

    #[test]
    fn a_volume_texture_is_neither_cut_nor_resampled() {
        let dir = tempfile::tempdir().unwrap();
        let file = fragment_file(&Parts {
            main: vec!["128x128:DXT1:6", "64x64:DXT5:5"],
            ..Parts::default()
        });
        let mut resource = Resource::parse(&file).unwrap();
        // Глубина первой текстуры — 4: хост такую не трогает.
        put16(resource.data_mut(), 0x800 + 0x54, 4);
        let file = resource.to_file_bytes().unwrap();
        let record = run(&file, &[32], &[], dir.path()).unwrap();
        assert_eq!(record["levels"][0]["changed"], 1);
        assert_eq!(record["unmipped"], 1);
        let written = fs::read(dir.path().join("32").join("frag.yft")).unwrap();
        assert_eq!(
            sides(&written),
            [
                ("main0".to_owned(), 128, 128, 64, 6),
                ("main1".to_owned(), 32, 32, 32, 4),
            ]
        );
    }

    #[test]
    fn a_fragment_without_a_drawable_has_no_textures() {
        let dir = tempfile::tempdir().unwrap();
        let mut file = fragment_file(&Parts {
            main: vec!["128x128:DXT1:6"],
            ..Parts::default()
        });
        let mut resource = Resource::parse(&file).unwrap();
        put64(resource.data_mut(), 0x30, 0);
        file = resource.to_file_bytes().unwrap();
        let record = run(&file, &[32], &[], dir.path()).unwrap();
        assert_eq!(record["textures"], 0);
        assert_eq!(record["levels"], Value::Array(Vec::new()));
    }

    // -- выключатель в окружении движка: настоящая команда в дочернем процессе --------------------------------------
    //
    // Окружение общее для всех тестов процесса, а соседние тесты `levels.rs` ждут отказа на `.yft`, поэтому
    // значение переменной ставится только ребёнку.

    const CHILD_ENV: &str = "ASTRAL_YFT_GATE_CHILD";
    const REFUSAL: &str = "downscale-textures: фрагменты .yft ещё не перенесены в движок.";

    /// Игра-пустышка: `x64e.rpf` с фрагментами `levels/gta5/<имя>`, ключи из нулей (открытому архиву они не нужны).
    fn fake_game(root: &Path, fragments: &[(String, Vec<u8>)]) {
        use rage_rpf::keys::{AES_KEY_FILE, HASH_LUT_FILE, NG_KEY_FILE, NG_TABLES_FILE};
        use rage_rpf::{Body, Data, DirNode, FileNode, WriteContext};
        let mut gta5 = DirNode::new("gta5");
        for (name, bytes) in fragments {
            gta5.files.push(FileNode {
                name: name.clone(),
                body: Body::Resource {
                    data: Data::memory(bytes.clone()),
                },
            });
        }
        let mut levels = DirNode::new("levels");
        levels.dirs.push(gta5);
        let mut top = DirNode::new("");
        top.dirs.push(levels);
        fs::create_dir_all(root.join("game/update")).unwrap();
        for archive in ["game/x64e.rpf", "game/update/update.rpf"] {
            let tree = if archive.ends_with("x64e.rpf") {
                &top
            } else {
                &DirNode::new("")
            };
            let mut file = fs::File::create(root.join(archive)).unwrap();
            let mut context = WriteContext {
                staging: root,
                keys: None,
                finalizer: None,
            };
            rage_rpf::write::write_archive(tree, &mut file, &mut context, &mut |_| {}).unwrap();
        }
        fs::create_dir_all(root.join("keys")).unwrap();
        for (name, size) in [
            (AES_KEY_FILE, 32),
            (NG_KEY_FILE, 27_472),
            (NG_TABLES_FILE, 278_528),
            (HASH_LUT_FILE, 256),
        ] {
            fs::write(root.join("keys").join(name), vec![0u8; size]).unwrap();
        }
    }

    fn request_of(root: &Path) -> Value {
        let text = |name: &str| root.join(name).to_string_lossy().into_owned();
        serde_json::json!({
            "gameRoot": text("game"),
            "keys": text("keys"),
            "outputDirectory": text("levels"),
            "caps": [32],
            "items": [{ "at": "x64e.rpf:levels/gta5/frag.yft", "name": "frag.yft", "size": 1000 }],
        })
    }

    /// Ребёнок: команда по запросу из папки; ответ и отчёт остаются там же. Без переменной — пустой тест.
    #[test]
    fn child_gate() {
        let Some(root) = std::env::var_os(CHILD_ENV) else {
            return;
        };
        let root = std::path::PathBuf::from(root);
        let argv: Vec<String> = [
            "downscale-textures".to_owned(),
            "--input".to_owned(),
            root.join("request.json").to_string_lossy().into_owned(),
            "--output".to_owned(),
            root.join("report.json").to_string_lossy().into_owned(),
        ]
        .into();
        let outcome = crate::run(&argv, &crate::progress::Progress::silent());
        fs::write(root.join("answer.json"), outcome.line).unwrap();
    }

    /// Запись из отчёта и ответ команды после запуска ребёнка с выключателем `gate`.
    fn through_the_command(gate: Option<&str>) -> (Value, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let parts = Parts {
            main: vec!["128x128:DXT1:6"],
            ..Parts::default()
        };
        fake_game(
            dir.path(),
            &[("frag.yft".to_owned(), fragment_file(&parts))],
        );
        fs::write(
            dir.path().join("request.json"),
            request_of(dir.path()).to_string(),
        )
        .unwrap();
        let mut child = std::process::Command::new(std::env::current_exe().unwrap());
        child
            .args([
                "--exact",
                "commands::levels_yft::tests::child_gate",
                "--nocapture",
                "--test-threads=1",
            ])
            .env(CHILD_ENV, dir.path())
            .env_remove(GATE_ENV);
        if let Some(value) = gate {
            child.env(GATE_ENV, value);
        }
        let output = child.output().unwrap();
        assert!(output.status.success(), "{output:?}");
        let answer: Value =
            serde_json::from_slice(&fs::read(dir.path().join("answer.json")).unwrap()).unwrap();
        assert_eq!(answer["ok"], true, "{answer}");
        let report: Value =
            serde_json::from_slice(&fs::read(dir.path().join("report.json")).unwrap()).unwrap();
        (report["items"][0].clone(), dir)
    }

    #[test]
    fn the_environment_gate_chooses_between_the_refusal_and_the_fragment_route() {
        for gate in [None, Some("off"), Some(""), Some("true")] {
            let (record, dir) = through_the_command(gate);
            assert_eq!(record["error"], REFUSAL, "{gate:?}");
            assert!(!dir.path().join("levels/32/frag.yft").exists(), "{gate:?}");
        }
        for gate in ["on", "1"] {
            let (record, dir) = through_the_command(Some(gate));
            assert_eq!(record["textures"], 1, "{gate}");
            assert_eq!(record["levels"][0]["variant"], "32", "{gate}");
            assert!(dir.path().join("levels/32/frag.yft").is_file(), "{gate}");
        }
    }

    /// Служебный (не тест): собирает игру-пустышку из файлов папки `ASTRAL_YFT_PACK_DIR` в папку
    /// `ASTRAL_YFT_PACK_OUT` (`game/x64e.rpf`, `keys/`). Нужен сверке `parity/host-port/downscale-textures-yft`: хост
    /// читает выходы движка из такого архива как второй читатель.
    #[test]
    #[ignore = "служебный: готовит архив для сверки хостом"]
    fn pack_fixture_archive() {
        let (Some(from), Some(to)) = (
            std::env::var_os("ASTRAL_YFT_PACK_DIR"),
            std::env::var_os("ASTRAL_YFT_PACK_OUT"),
        ) else {
            return;
        };
        let mut fragments: Vec<(String, Vec<u8>)> = fs::read_dir(from)
            .unwrap()
            .map(|entry| {
                let path = entry.unwrap().path();
                let name = path.file_name().unwrap().to_string_lossy().into_owned();
                (name, fs::read(&path).unwrap())
            })
            .collect();
        fragments.sort();
        fake_game(Path::new(&to), &fragments);
    }
}
