//! Группа «читатели игры»: двойники JS-читателей из главного процесса.
//! Восемь команд здесь только зарегистрированы (их тела живут в `crate::readers`),
//! семь собственных читают и переписывают словари клипов (`.ycd`), звуковые
//! банки (`.awc`) и снимают геометрию радара.

use std::path::{Path, PathBuf};

use serde_json::{Map, Value};

use super::{lamp_mutations::is_same_file, shop::write_atomic, Command};
use crate::{
    archives::{self, sha256_hex},
    args::Options,
    error::{EngineError, Result},
    paths,
    progress::Progress,
    readers::{ars2, combat_decals, ptfx, radar},
};
use rage_res::{
    awc,
    ycd::{self, AnimationSummary, BoneRef},
    ycd_pose::{self, PoseBone},
    ycd_uv::{self, UvClip},
    ycd_write,
};

/// Ответ-объект: ключи ложатся в порядке вызовов `put`.
#[derive(Default)]
struct Fields(Map<String, Value>);

impl Fields {
    fn put(mut self, key: &str, value: impl Into<Value>) -> Self {
        self.0.insert(key.to_owned(), value.into());
        self
    }

    fn done(self) -> Value {
        Value::Object(self.0)
    }
}

/// Куски текста, склеенные через `glue`; у пустого набора — пустая строка.
fn joined(parts: impl IntoIterator<Item = String>, glue: &str) -> String {
    parts
        .into_iter()
        .reduce(|mut text, part| {
            text.push_str(glue);
            text.push_str(&part);
            text
        })
        .unwrap_or_default()
}

/// Входной файл команды: имя для ответа и прочитанные байты.
struct Subject {
    name: String,
    bytes: Vec<u8>,
}

/// Входной файл из `--input`: путь с проверкой расширения (файл не читается) и сам файл.
trait InputArg {
    fn input_path(&self, extension: &str) -> Result<PathBuf>;
    fn input_file(&self, extension: &str) -> Result<Subject>;
}

impl InputArg for Options {
    fn input_path(&self, extension: &str) -> Result<PathBuf> {
        self.required("input")
            .and_then(|raw| paths::existing_file(raw, &[extension]))
    }

    fn input_file(&self, extension: &str) -> Result<Subject> {
        self.input_path(extension)
            .and_then(|path| Subject::read(&path))
    }
}

impl Subject {
    fn read(path: &Path) -> Result<Self> {
        Ok(Subject {
            name: path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            bytes: std::fs::read(path)?,
        })
    }

    /// Ответ с тремя общими полями — `file`, `bytes`, `sha256` — и ещё одним своим.
    fn stamped(&self, field: &str, value: Value) -> Value {
        Fields::default()
            .put("file", self.name.as_str())
            .put("bytes", self.bytes.len())
            .put("sha256", sha256_hex(&self.bytes))
            .put(field, value)
            .done()
    }

    /// Своё поле даёт `make` по байтам файла; штамп файла ставится поверх.
    fn stamp_with(self, field: &str, make: impl FnOnce(&[u8]) -> Result<Value>) -> Result<Value> {
        make(&self.bytes).map(|value| self.stamped(field, value))
    }
}

/// Записанный файл вывода.
struct Saved {
    output: String,
    bytes: usize,
    sha256: String,
}

impl Saved {
    /// Кладёт три общих поля ответа о записанном файле.
    fn into_fields(self, fields: Fields) -> Fields {
        fields
            .put("output", self.output)
            .put("bytes", self.bytes)
            .put("sha256", self.sha256)
    }
}

/// Записывает файл, создав родительские папки.
fn put_file(path: &Path, bytes: &[u8]) -> Result<Saved> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    write_atomic(path, bytes)?;
    Ok(Saved {
        output: path.to_string_lossy().into_owned(),
        bytes: bytes.len(),
        sha256: sha256_hex(bytes),
    })
}

/// `f32` как кратчайшая десятичная запись, прочитанная как `f64` (так число выглядит у `float` в .NET).
/// Нечисло и бесконечность становятся `null`.
fn via_text(value: f32) -> Value {
    Value::from(value.to_string().parse().unwrap_or(0.0_f64))
}

/// Записи костей через пробел: `кость/дорожка/unknown`.
fn bone_ids(bones: &[BoneRef]) -> String {
    joined(
        bones
            .iter()
            .map(|bone| format!("{}/{}/{}", bone.bone, bone.track, bone.unknown)),
        " ",
    )
}

/// Последовательности через « | », слоты каждой — через запятую; пустой слот — `null`.
fn channel_rows(rows: &[Vec<Option<&'static str>>]) -> String {
    let slots_of = |row: &Vec<Option<&'static str>>| {
        joined(
            row.iter().map(|slot| slot.unwrap_or("null").to_owned()),
            ",",
        )
    };
    joined(rows.iter().map(slots_of), " | ")
}

pub(super) fn summary_json(item: &AnimationSummary) -> Value {
    Fields::default()
        .put("hash", item.hash)
        .put("frames", item.frames)
        .put("sequenceFrameLimit", item.sequence_frame_limit)
        .put("duration", via_text(item.duration))
        .put("signature", item.signature)
        .put("boneIds", bone_ids(&item.bones))
        .put("channels", channel_rows(&item.sequences))
        .done()
}

fn summaries_json(items: &[AnimationSummary]) -> Value {
    items.iter().map(summary_json).collect()
}

const YCD_SUMMARY: Command = Command::new("ycd-summary", ycd_summary);
pub fn ycd_summary(options: &Options, _progress: &Progress) -> Result<Value> {
    options.input_file(".ycd")?.stamp_with("summary", |bytes| {
        let list = ycd::summarize(bytes)?;
        Ok(summaries_json(&list))
    })
}

/// Число UV-клипа для печати: прибавление нуля убирает знак у минус нуля.
fn plain_number(value: f64) -> Value {
    Value::from(value + 0.0)
}

fn uv_clip_json(clip: &UvClip) -> Value {
    let frames: Value = clip
        .frames
        .iter()
        .map(|row| row.iter().copied().map(plain_number).collect::<Value>())
        .collect();
    Fields::default()
        .put("loop", plain_number(clip.loop_seconds))
        .put("frames", frames)
        .done()
}

const READ_UV_CLIPS: Command = Command::new("read-uv-clips", read_uv_clips_file);
pub fn read_uv_clips_file(options: &Options, _progress: &Progress) -> Result<Value> {
    options.input_file(".ycd")?.stamp_with("clips", |bytes| {
        let clips = ycd_uv::read_uv_clips(bytes)?;
        Ok(Value::Object(
            clips
                .iter()
                .map(|(hash, clip)| (hash.to_string(), uv_clip_json(clip)))
                .collect(),
        ))
    })
}

const READ_AWC: Command = Command::new("read-awc", read_awc_file);
pub fn read_awc_file(options: &Options, _progress: &Progress) -> Result<Value> {
    options.input_file(".awc")?.stamp_with("bank", |bytes| {
        let bank = awc::read_bank(bytes)?;
        Ok(awc::bank_json(&bank))
    })
}

/// Идентификатор потока из `--id`: `0x…` через соседа, иначе десятичное `u32`; затем маска 29 бит.
fn stream_id_of(raw: &str) -> Result<u32> {
    awc::parse_stream_id(raw)
        .or_else(|| {
            raw.trim()
                .parse::<u32>()
                .ok()
                .map(|number| number & 0x1FFF_FFFF)
        })
        .ok_or_else(|| EngineError::argument(format!("Неверный id потока: {raw}.")))
}

const AWC_STREAM_PCM: Command = Command::new("awc-stream-pcm", awc_stream_pcm);
pub fn awc_stream_pcm(options: &Options, _progress: &Progress) -> Result<Value> {
    options.input_path(".awc").and_then(|path| {
        let id = stream_id_of(options.required("id")?)?;
        let subject = Subject::read(&path)?;
        let audio = awc::stream_audio(&subject.bytes, id)?;
        Ok(Fields::default()
            .put("file", subject.name)
            .put("id", id)
            .put("sampleRate", audio.sample_rate)
            .put("pcm", audio.pcm)
            .done())
    })
}

fn pose_bone_json(bone: &PoseBone) -> Value {
    Fields::default()
        .put("tag", bone.tag)
        .put("track", bone.track)
        .put(
            "value",
            bone.value.iter().copied().map(via_text).collect::<Value>(),
        )
        .done()
}

/// Поза клипа `clip` в момент `time` (секунды, по умолчанию 0).
fn pose_answer(subject: Subject, clip: &str, time: Option<&str>) -> Result<Value> {
    let moment = time
        .and_then(|text| text.trim().parse::<f32>().ok())
        .unwrap_or_default();
    let pose = ycd_pose::sample_clip(&subject.bytes, clip, moment)?;
    Ok(Fields::default()
        .put("file", subject.name)
        .put("clip", pose.clip.as_str())
        .put("frames", pose.frames)
        .put("duration", via_text(pose.duration))
        .put("time", via_text(pose.time))
        .put(
            "bones",
            pose.bones.iter().map(pose_bone_json).collect::<Value>(),
        )
        .done())
}

const SAMPLE_ANIM_POSE: Command = Command::new("sample-anim-pose", sample_anim_pose);
pub fn sample_anim_pose(options: &Options, _progress: &Progress) -> Result<Value> {
    options.input_file(".ycd").and_then(|subject| {
        let wanted = options.optional("clip").and_then(|name| match name.trim() {
            "" => None,
            named => Some(named),
        });
        let Some(clip) = wanted else {
            let names = ycd_pose::clip_names(&subject.bytes)?;
            return Ok(Fields::default()
                .put("file", subject.name)
                .put("clips", names)
                .done());
        };
        pose_answer(subject, clip, options.optional("time"))
    })
}

const YCD_ROUNDTRIP: Command = Command::new("ycd-roundtrip", ycd_roundtrip);
pub fn ycd_roundtrip(options: &Options, _progress: &Progress) -> Result<Value> {
    options.input_path(".ycd").and_then(|path| {
        let output = paths::full_path(options.required("output")?)?;
        let subject = Subject::read(&path)?;
        let before = ycd::summarize(&subject.bytes)?;
        // Файл переписывается без правок; потом сверяются байты и описание клипов.
        let rewritten = ycd_write::add_clips(&subject.bytes, &[])?;
        let same_summary = ycd::summarize(&rewritten)? == before;
        if output == path || is_same_file(&path, &output) {
            return Err(EngineError::argument(
                "--output must not be the input file.",
            ));
        }
        let saved = put_file(&output, &rewritten)?;
        let roundtrip = saved
            .into_fields(Fields::default())
            .put("byteIdentical", rewritten == subject.bytes)
            .put("summaryIdentical", same_summary)
            .done();
        Ok(Fields::default()
            .put("stock", subject.stamped("summary", summaries_json(&before)))
            .put("roundtrip", roundtrip)
            .done())
    })
}

/// Размеры атласа плиток; нет атласа — `null`.
fn atlas_json(atlas: Option<radar::Atlas>) -> Value {
    match atlas {
        Some(found) => Fields::default()
            .put("tileUnits", f64::from(found.tile_units))
            .put("originX", f64::from(found.origin_x))
            .put("originY", f64::from(found.origin_y))
            .done(),
        None => Value::Null,
    }
}

/// Геометрия радара, прочитанная из игры, и откуда взяты ключи.
struct Scan {
    geometry: radar::Geometry,
    atlas: Option<radar::Atlas>,
    key_source: &'static str,
}

impl Scan {
    fn of(root: &Path, options: &Options) -> Result<Scan> {
        let (keys, key_source) =
            archives::load_keys(&root.to_string_lossy(), options.optional("keys"))?;
        radar::read_from_game(root, &keys).map(|(geometry, atlas)| Scan {
            geometry,
            atlas,
            key_source,
        })
    }
}

const READ_RADAR_GEOMETRY: Command = Command::new("read-radar-geometry", read_radar_geometry);
pub fn read_radar_geometry(options: &Options, _progress: &Progress) -> Result<Value> {
    archives::game_root(options).and_then(|root| {
        let output = paths::full_path(options.required("output")?)?;
        let Scan {
            geometry,
            atlas,
            key_source,
        } = Scan::of(&root, options)?;
        let saved = put_file(&output, &radar::encode(&geometry))?;
        Ok(saved
            .into_fields(Fields::default())
            .put("tiles", geometry.tiles)
            .put("triangles", geometry.triangles)
            .put("groups", geometry.groups.len())
            .put("atlas", atlas_json(atlas))
            .put("keySource", key_source)
            .put("implemented", Value::from(["geometry", "atlas"].as_slice()))
            .done())
    })
}

// Чужие обработчики: тела в `crate::readers`, здесь только имена команд.
const READ_PTFX_BASE: Command = Command::new("read-ptfx-base", ptfx::base::read);
const READ_YPT_RULES: Command = Command::new("read-ypt-rules", ptfx::rules::read_ypt_rules);
const READ_YPT_EXPORT: Command = Command::new("read-ypt-export", ptfx::rules::read_ypt_export);
const READ_YPT_DIGEST: Command = Command::new("read-ypt-digest", ptfx::rules::read_ypt_digest);
const READ_YPT_EVOLUTIONS: Command =
    Command::new("read-ypt-evolutions", ptfx::rules::read_ypt_evolutions);
const READ_YPT_KEYFRAMES: Command =
    Command::new("read-ypt-keyframes", ptfx::rules::read_ypt_keyframes);
const READ_COMBAT_DECALS: Command = Command::new("read-combat-decals", combat_decals::read);
const READ_MODEL_ARS2: Command = Command::new("read-model-ars2", ars2::read_model_ars2);

pub const COMMANDS: &[Command] = &[
    READ_PTFX_BASE,
    READ_YPT_RULES,
    READ_YPT_EXPORT,
    READ_YPT_DIGEST,
    READ_YPT_EVOLUTIONS,
    READ_YPT_KEYFRAMES,
    READ_RADAR_GEOMETRY,
    READ_COMBAT_DECALS,
    READ_MODEL_ARS2,
    YCD_SUMMARY,
    READ_UV_CLIPS,
    READ_AWC,
    AWC_STREAM_PCM,
    SAMPLE_ANIM_POSE,
    YCD_ROUNDTRIP,
];

#[cfg(test)]
mod tests;
