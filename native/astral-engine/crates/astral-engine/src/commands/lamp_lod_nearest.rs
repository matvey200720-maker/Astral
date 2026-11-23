//! `lamp-lod-nearest`: какие дальние огни города стоят вплотную к фонарям мастерской.
//!
//! Дальние огни лежат в картах `distlodlights_*.ymap` (структура `DistantLODLightsSOA`:
//! позиции и упакованные цвета RGBI в параллельных массивах). Команда обходит архив
//! вместе с вложенными, читает огни каждой карты и для каждого якоря (точки в мировых
//! координатах) берёт огни не дальше пяти метров. Всё, что не разбирается точно,
//! отдаётся хосту отказом «пока на хосте». На диск ничего не пишется.

use {
    rage_res::{meta_graph, mlo, resource},
    rage_rpf::{Archive, EntryCipher, EntryId, EntryKind},
    serde_json::Value,
    std::{path::Path, rc::Rc, vec::IntoIter},
};

use super::{lamp_archive_scan as scan, lamp_mutations::refuse};
use crate::{archives, args::Options, error::Result, paths, progress::Progress};

pub const COMMANDS: &[super::Command] = &[super::Command::new(MODE, lamp_lod_nearest)];

const MODE: &str = "lamp-lod-nearest";

/// Пределы запроса и радиус отбора.
struct Limits {
    anchors: usize,
    id_bytes: usize,
    world: f32,
    reach_metres: i64,
    reach_squared: f32,
}

const LIMITS: Limits = Limits {
    anchors: 1024,
    id_bytes: 160,
    world: 20_000.0,
    reach_metres: 5,
    reach_squared: 25.0,
};

pub fn lamp_lod_nearest(options: &Options, _progress: &Progress) -> Result<Value> {
    let query = Query::read(options)?;
    let archive = open_archive(options, &query.archive)?;
    let mut hunt = Hunt::new(&query.anchors, query.depth);
    hunt.run(archive);
    Ok(hunt.report(&query.request))
}

/// Всё, что проверяется в запросе до обращения к игре.
struct Query {
    request: Value,
    archive: std::path::PathBuf,
    anchors: Vec<Anchor>,
    depth: usize,
}

impl Query {
    fn read(options: &Options) -> Result<Self> {
        let request = read_request(options)?;
        Ok(Self {
            archive: scan::archive_file(&request)?,
            anchors: anchors_of(&request)?,
            depth: scan::max_depth(&request)?,
            request,
        })
    }
}

/// Папка игры, набор ключей (метка их источника здесь не нужна), затем сам архив.
fn open_archive(options: &Options, path: &Path) -> Result<Archive> {
    let root = archives::game_root(options)?;
    let (keys, _) = archives::load_keys(&root.to_string_lossy(), options.optional("keys"))?;
    Ok(Archive::open_path(path, Some(keys))?)
}

// ---------------------------------------------------------------------------
// Запрос и якоря
// ---------------------------------------------------------------------------

fn read_request(options: &Options) -> Result<Value> {
    let input = options.required("input")?;
    let path = paths::existing_file(input, &[".json"])?;
    let parsed: Option<Value> = match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).ok(),
        Err(_) => None,
    };
    match parsed {
        None => Err(refuse("Запрос ближайших огней не читается")),
        Some(request) if request["mode"] == MODE => Ok(request),
        Some(_) => Err(refuse("Запрос ближайших огней другого режима")),
    }
}

/// Объект ответа из пар «ключ, значение» в заданном порядке.
fn record<'k>(pairs: impl IntoIterator<Item = (&'k str, Value)>) -> Value {
    Value::Object(
        pairs
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect(),
    )
}

struct Anchor {
    id: String,
    at: [f32; 3],
}

/// Якоря по порядку запроса; первый плохой якорь побеждает: сперва его id, потом x, y, z.
fn anchors_of(request: &Value) -> Result<Vec<Anchor>> {
    let Some(listed) = request["lampWorldAnchors"].as_array() else {
        return Err(refuse("Нет якорей"));
    };
    if !(1..=LIMITS.anchors).contains(&listed.len()) {
        return Err(refuse("Число якорей вне 1…1024"));
    }
    listed
        .iter()
        .try_fold(Vec::with_capacity(listed.len()), |mut kept, raw| {
            let id = anchor_id(raw, &kept)?;
            let at = [
                coordinate(raw, "x")?,
                coordinate(raw, "y")?,
                coordinate(raw, "z")?,
            ];
            kept.push(Anchor { id, at });
            Ok(kept)
        })
}

/// Id годится и ещё не встречался у предыдущих якорей (регистр различается).
fn anchor_id(raw: &Value, kept: &[Anchor]) -> Result<String> {
    let id = raw["anchorId"].as_str().unwrap_or("");
    match is_anchor_id(id) && kept.iter().all(|earlier| earlier.id != id) {
        true => Ok(id.to_owned()),
        false => Err(refuse("Id якоря не годится или повторяется")),
    }
}

/// Id: до 160 байт, не пустой, только ASCII-буквы, цифры и `_ - : .`.
fn is_anchor_id(id: &str) -> bool {
    let tame = |byte: &u8| byte.is_ascii_alphanumeric() || b"_-:.".contains(byte);
    !id.trim().is_empty() && id.len() <= LIMITS.id_bytes && id.as_bytes().iter().all(tame)
}

/// Координата проверяется уже после приведения к `f32`.
fn coordinate(raw: &Value, axis: &str) -> Result<f32> {
    match raw[axis].as_f64() {
        None => Err(refuse("Координата якоря не число")),
        Some(wide) => {
            let narrow = wide as f32;
            match narrow.is_finite() && narrow.abs() <= LIMITS.world {
                true => Ok(narrow),
                false => Err(refuse("Координата якоря вне пределов")),
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Обход архивов без рекурсии
// ---------------------------------------------------------------------------

enum Task {
    File(EntryId),
    Dir(EntryId),
}

/// Шаг обхода: где мы, на какой глубине и что сделать.
struct Step {
    archive: Rc<Archive>,
    prefix: String,
    depth: usize,
    task: Task,
}

/// Каталог, который ещё разбирается: сначала его файлы, потом подкаталоги.
struct Frame {
    archive: Rc<Archive>,
    prefix: String,
    depth: usize,
    tasks: IntoIter<Task>,
}

impl Frame {
    fn open(archive: Rc<Archive>, dir: EntryId, prefix: String, depth: usize) -> Self {
        let mut tasks: Vec<Task> = archive.files(dir).iter().copied().map(Task::File).collect();
        tasks.extend(archive.dirs(dir).iter().copied().map(Task::Dir));
        Self {
            archive,
            prefix,
            depth,
            tasks: tasks.into_iter(),
        }
    }

    fn advance(&mut self) -> Option<Step> {
        let task = self.tasks.next()?;
        Some(Step {
            archive: Rc::clone(&self.archive),
            prefix: self.prefix.clone(),
            depth: self.depth,
            task,
        })
    }
}

/// Дальний огонь карты.
struct Light {
    entry: String,
    index: usize,
    at: [f32; 3],
    packed: u32,
}

/// Огонь рядом с якорем: номер якоря, расстояние и сам огонь.
struct Hit {
    anchor: usize,
    gap: f32,
    light: Light,
}

/// Причины пропуска в parseErrors: карта или вложенный архив не читаются, а поиск идёт дальше.
const NESTED_LOST: &str = "Вложенный архив не открылся";
const MAP_UNPACKED: &str = "Запись .ymap не распакована";
const MAP_NOT_RSC7: &str = "Карта .ymap не в формате RSC7";
const MAP_UNREADABLE: &str = "Карта .ymap не читается";
const LIGHTS_UNREADABLE: &str = "Дальние огни карты не читаются";
const LIGHTS_UNPAIRED: &str = "Дальние огни карты не совпали по числу";

struct Hunt<'a> {
    anchors: &'a [Anchor],
    deepest: usize,
    maps: usize,
    hits: Vec<Hit>,
    /// Карты и вложенные архивы, которые не прочитались: имя и причина, порядок обхода.
    skipped: Vec<Value>,
}

impl<'a> Hunt<'a> {
    fn new(anchors: &'a [Anchor], deepest: usize) -> Self {
        Self {
            anchors,
            deepest,
            maps: 0,
            hits: Vec::new(),
            skipped: Vec::new(),
        }
    }

    /// Запись о пропущенном: что и почему.
    fn skip(&mut self, path: &str, reason: &str) {
        self.skipped
            .push(record([("entry", path.into()), ("error", reason.into())]));
    }

    fn run(&mut self, root: Archive) {
        let root = Rc::new(root);
        let mut stack = vec![Frame::open(Rc::clone(&root), root.root(), String::new(), 0)];
        while let Some(step) = stack.last_mut().map(Frame::advance) {
            let Some(Step {
                archive,
                prefix,
                depth,
                task,
            }) = step
            else {
                stack.pop();
                continue;
            };
            let deeper = match task {
                Task::Dir(id) => {
                    let inner = scan::join_path(&prefix, &archive.entry(id).name);
                    Some(Frame::open(Rc::clone(&archive), id, inner, depth))
                }
                Task::File(id) => self.visit_file(&archive, id, &prefix, depth),
            };
            stack.extend(deeper);
        }
    }

    /// Файл архива; если это вложенный архив, который можно открыть, отдаёт его каталог для обхода.
    /// Не открывшийся вложенный архив пропускается (раньше он ронял весь поиск) и попадает в parseErrors.
    fn visit_file(
        &mut self,
        archive: &Rc<Archive>,
        id: EntryId,
        prefix: &str,
        depth: usize,
    ) -> Option<Frame> {
        let entry = archive.entry(id);
        let path = scan::join_path(prefix, &entry.name);
        if is_map_name(&entry.name) {
            self.maps += 1;
            self.scan_map(archive, id, &path);
        }
        let nested = match entry.kind {
            EntryKind::Binary(_) => {
                depth < self.deepest && Archive::is_nested_archive_name(&entry.name)
            }
            _ => false,
        };
        if !nested {
            return None;
        }
        match archive.open_nested(id) {
            Ok(inner) => {
                let top = inner.root();
                Some(Frame::open(Rc::new(inner), top, path, depth + 1))
            }
            Err(_) => {
                self.skip(&path, NESTED_LOST);
                None
            }
        }
    }

    /// Нечитаемая карта пропускается и попадает в parseErrors (раньше она роняла весь поиск).
    fn scan_map(&mut self, archive: &Archive, id: EntryId, path: &str) {
        match self.map_hits(archive, id, path) {
            Ok(hits) => self.hits.extend(hits),
            Err(reason) => self.skip(path, reason),
        }
    }

    fn map_hits(
        &self,
        archive: &Archive,
        id: EntryId,
        path: &str,
    ) -> std::result::Result<Vec<Hit>, &'static str> {
        let bytes = archive
            .decode(id, EntryCipher::ByArchive)
            .map_err(|_| MAP_UNPACKED)?;
        if !matches!(bytes.get(..4), Some(b"RSC7")) {
            return Err(MAP_NOT_RSC7);
        }
        let lights = distant_lights(&bytes)?;
        let mut hits = Vec::new();
        for (index, (&at, &packed)) in lights.positions.iter().zip(&lights.colours).enumerate() {
            let near = self
                .anchors
                .iter()
                .enumerate()
                .filter_map(|(anchor, target)| {
                    reach(&at, &target.at).map(|gap| Hit {
                        anchor,
                        gap,
                        light: Light {
                            entry: path.to_owned(),
                            index,
                            at,
                            packed,
                        },
                    })
                });
            hits.extend(near);
        }
        Ok(hits)
    }

    fn report(mut self, request: &Value) -> Value {
        let anchors = self.anchors;
        // Якорь по байтам id, потом расстояние (у неотрицательных чисел порядок битов совпадает с числовым),
        // потом карта без учёта регистра и номер огня; равные остаются в порядке обхода.
        self.hits.sort_by(|left, right| {
            let key = |hit: &Hit| (anchors[hit.anchor].id.as_str(), hit.gap.to_bits());
            key(left)
                .cmp(&key(right))
                .then_with(|| scan::ordinal_ignore_case(&left.light.entry, &right.light.entry))
                .then_with(|| left.light.index.cmp(&right.light.index))
        });

        let mut matched: Vec<usize> = self.hits.iter().map(|hit| hit.anchor).collect();
        matched.sort_unstable();
        matched.dedup();
        let mut unmatched: Vec<&str> = anchors
            .iter()
            .enumerate()
            .filter(|(at, _)| matched.binary_search(at).is_err())
            .map(|(_, anchor)| anchor.id.as_str())
            .collect();
        unmatched.sort_unstable();

        let candidates: Vec<Value> = self
            .hits
            .iter()
            .map(|hit| candidate(&anchors[hit.anchor].id, hit))
            .collect();
        let complete = self.skipped.is_empty();
        // Как у хоста: при любом пропуске статус «incomplete», а не «ready».
        let status = if complete { "ready" } else { "incomplete" };
        record([
            ("status", status.into()),
            ("mode", MODE.into()),
            ("edition", request["edition"].clone()),
            ("archive", request["archiveTarget"].clone()),
            ("maximumDistance", LIMITS.reach_metres.into()),
            ("ymapCount", self.maps.into()),
            ("anchors", anchors.len().into()),
            ("candidates", candidates.into()),
            ("unmatchedAnchorIds", unmatched.into()),
            ("parseErrors", Value::Array(self.skipped)),
            ("complete", complete.into()),
        ])
    }
}

fn is_map_name(name: &str) -> bool {
    let (name, suffix) = (name.as_bytes(), b".ymap");
    name.len() >= suffix.len() && name[name.len() - suffix.len()..].eq_ignore_ascii_case(suffix)
}

/// Дальние огни карты. Карта без таблицы структур, без структуры огней или с нулём позиций огней не имеет.
fn distant_lights(bytes: &[u8]) -> std::result::Result<mlo::DistantLights, &'static str> {
    let res = resource::Resource::parse(bytes).map_err(|_| MAP_UNREADABLE)?;
    let schema = res
        .u64(scan::META_SCHEMA_POINTER)
        .map_err(|_| MAP_UNREADABLE)?;
    if res.at(schema).is_none() {
        return Ok(mlo::DistantLights::default());
    }
    let graph = meta_graph::read(bytes).map_err(|_| MAP_UNREADABLE)?;
    mlo::read_distant_lights(&graph)
        .map_err(|_| LIGHTS_UNREADABLE)
        .and_then(paired)
}

/// Лишние цвета при пустых позициях не мешают; при непустых позициях число цветов обязано совпасть.
fn paired(lights: mlo::DistantLights) -> std::result::Result<mlo::DistantLights, &'static str> {
    match (lights.positions.len(), lights.colours.len()) {
        (0, _) => Ok(lights),
        (have, colours) if have == colours => Ok(lights),
        _ => Err(LIGHTS_UNPAIRED),
    }
}

/// Квадрат расстояния в `f32` без слитного умножения; огонь не дальше радиуса (равенство включено) даёт расстояние.
fn reach(light: &[f32; 3], anchor: &[f32; 3]) -> Option<f32> {
    let gap = |axis: usize| light[axis] - anchor[axis];
    let squared = gap(0) * gap(0) + gap(1) * gap(1) + gap(2) * gap(2);
    match squared.is_finite() && squared <= LIMITS.reach_squared {
        true => Some(squared.sqrt()),
        false => None,
    }
}

/// Упакованный `u32` RGBI: яркость в старшем байте, затем красный, зелёный, синий.
fn candidate(anchor_id: &str, hit: &Hit) -> Value {
    let light = &hit.light;
    let head = [
        ("anchorId", Value::from(anchor_id)),
        ("ymapEntry", Value::from(light.entry.as_str())),
        ("alignedLightIndex", Value::from(light.index)),
        ("distance", scan::number(hit.gap)),
    ];
    let place = ["positionX", "positionY", "positionZ"]
        .into_iter()
        .zip(light.at)
        .map(|(key, value)| (key, scan::number(value)));
    let shades = [16, 8, 0].map(|shift| (light.packed >> shift) & 0xFF);
    let colour = ["colorR", "colorG", "colorB"]
        .into_iter()
        .zip(shades)
        .map(|(key, value)| (key, Value::from(value)));
    let intensity = [("intensity", Value::from(light.packed >> 24))];
    record(head.into_iter().chain(place).chain(colour).chain(intensity))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{args::Options, error::Result, progress::Progress};
    use rage_res::mlo::DistantLights;
    use rage_res::resource::Resource;
    use serde_json::json;
    use std::{fs, path::PathBuf};

    use rage_res::placements::{compile_map, ArchetypeSpec, EntitySpec};
    use rage_rpf::fixtures::noise;
    use rage_rpf::{write_archive, Body, Compress, Data, DirNode, FileNode, WriteContext};

    const KEY_SIZES: [(&str, usize); 4] = [
        ("gtav_aes_key.dat", 32),
        ("gtav_ng_key.dat", 27472),
        ("gtav_ng_decrypt_tables.dat", 278528),
        ("gtav_hash_lut.dat", 256),
    ];
    const FAR: [f32; 3] = [9000.0, 9000.0, 9000.0];
    const PAIRS: &str = "parity/host-port/lamp-lod-inspect-pair/pairs";

    struct Lab {
        dir: tempfile::TempDir,
    }

    type Failure = (String, String);

    impl Lab {
        fn new() -> Self {
            let lab = Self {
                dir: tempfile::tempdir().unwrap(),
            };
            fs::create_dir_all(lab.path("keys")).unwrap();
            for (name, size) in KEY_SIZES {
                fs::write(lab.path("keys").join(name), noise(size, 7)).unwrap();
            }
            fs::create_dir_all(lab.path("game")).unwrap();
            fs::write(lab.path("game").join("GTA5.exe"), b"").unwrap();
            lab
        }

        fn path(&self, name: &str) -> PathBuf {
            self.dir.path().join(name)
        }

        fn text(&self, name: &str) -> String {
            self.path(name).display().to_string()
        }

        fn put(&self, name: &str, bytes: &[u8]) -> String {
            fs::write(self.path(name), bytes).unwrap();
            self.text(name)
        }

        fn archive(&self, name: &str, root: &DirNode) -> String {
            let mut file = fs::File::create(self.path(name)).unwrap();
            let staging = self.path("staging");
            fs::create_dir_all(&staging).unwrap();
            let mut context = WriteContext {
                staging: &staging,
                keys: None,
                finalizer: None,
            };
            write_archive(root, &mut file, &mut context, &mut |_| {}).unwrap();
            self.text(name)
        }

        fn find(&self, request: &Value) -> Result<Value> {
            let input = self.put("req.json", request.to_string().as_bytes());
            let game = self.text("game");
            let keys = self.text("keys");
            self.run(&["--input", &input, "--game-root", &game, "--keys", &keys])
        }

        fn run(&self, args: &[&str]) -> Result<Value> {
            let argv: Vec<String> = args.iter().map(|arg| arg.to_string()).collect();
            lamp_lod_nearest(&Options::parse(&argv)?, &Progress::silent())
        }
    }

    fn failure(result: Result<Value>) -> Failure {
        let error = result.unwrap_err();
        (error.code, error.message)
    }

    fn refused(what: &str) -> Failure {
        (
            "ArgumentException".into(),
            format!("{what}: пока на хосте."),
        )
    }

    fn file(name: &str, body: Body) -> FileNode {
        FileNode {
            name: name.into(),
            body,
        }
    }

    fn stored(name: &str, bytes: &[u8]) -> FileNode {
        file(
            name,
            Body::Binary {
                data: Data::memory(bytes.to_vec()),
                compress: Compress::Store,
            },
        )
    }

    fn resource(name: &str, bytes: &[u8]) -> FileNode {
        file(
            name,
            Body::Resource {
                data: Data::memory(bytes.to_vec()),
            },
        )
    }

    fn pack(name: &str, root: DirNode) -> FileNode {
        file(name, Body::Nested(Box::new(root)))
    }

    fn folder(name: &str, dirs: Vec<DirNode>, files: Vec<FileNode>) -> DirNode {
        DirNode {
            name: name.into(),
            dirs,
            files,
        }
    }

    fn top(files: Vec<FileNode>) -> DirNode {
        folder("", Vec::new(), files)
    }

    fn request(archive: &str, anchors: Value) -> Value {
        json!({ "mode": MODE, "baseArchive": archive, "lampWorldAnchors": anchors })
    }

    fn origin() -> Value {
        json!([{ "anchorId": "o", "x": 0, "y": 0, "z": 0 }])
    }

    /// Карта дальних огней из настоящего образца: первые огни заменены, остальные унесены далеко.
    fn lights_map(lights: &[([f32; 3], u32)]) -> Option<Vec<u8>> {
        let base = fs::read(crate::test_support::engine(&format!(
            "{PAIRS}/distlodlights_small045.ymap"
        )))
        .ok()?;
        let read = meta_graph::read(&base).unwrap();
        let (positions, count) = mlo::soa_array(&read, "DistantLODLightsSOA", "position")
            .unwrap()
            .unwrap();
        let (colours, _) = mlo::soa_array(&read, "DistantLODLightsSOA", "RGBI")
            .unwrap()
            .unwrap();
        assert!(lights.len() <= count);
        let (position_at, colour_at) = (
            read.origins[positions].unwrap(),
            read.origins[colours].unwrap(),
        );
        let mut res = Resource::parse(&base).unwrap();
        for index in 0..count {
            let (xyz, packed) = lights.get(index).copied().unwrap_or((FAR, 0));
            for (axis, value) in xyz.iter().enumerate() {
                let at = position_at + index * 12 + axis * 4;
                res.data_mut()[at..at + 4].copy_from_slice(&value.to_le_bytes());
            }
            let at = colour_at + index * 4;
            res.data_mut()[at..at + 4].copy_from_slice(&packed.to_le_bytes());
        }
        Some(res.to_file_bytes().unwrap())
    }

    fn basic_lights() -> Vec<([f32; 3], u32)> {
        vec![
            ([0.0, 0.0, 0.0], 0xFF11_2233),
            ([3.0, 4.0, 0.0], 0x80FF_FFFF),
            ([3.0, 4.0, 0.001], 0),
            ([1.0, 1.0, 1.0], 0x7FAB_CDEF),
            ([-2.5, 0.5, 10.0], 0),
            ([100.0, 100.0, 100.0], 0),
            ([0.0, 0.0, 5.0], 0x1020_3040),
            ([0.0, 0.0, 5.000_000_5], 0),
        ]
    }

    fn edge_lights() -> Vec<([f32; 3], u32)> {
        let positions = [
            [5.0, 0.0, 0.0],
            [5.000_001, 0.0, 0.0],
            [4.999_999_5, 0.0, 0.0],
            [-5.0, 0.0, 0.0],
            [0.0, 5.0, 0.0],
            [0.0, 0.0, -5.0],
            [3.0, 4.0, 0.0],
            [2.999_999_8, 4.0, 0.0],
            [3.000_000_2, 4.0, 0.0],
        ];
        positions
            .iter()
            .enumerate()
            .map(|(index, &xyz)| (xyz, index as u32 + 1))
            .collect()
    }

    fn one_light() -> Vec<([f32; 3], u32)> {
        vec![([10.0, 20.0, 30.0], 0xAA00_00FF)]
    }

    /// Архив `near-basic`: три карты огней и пояснение.
    fn near_basic(lab: &Lab) -> Option<String> {
        let levels = folder(
            "levels",
            Vec::new(),
            vec![
                resource("dist-basic.ymap", &lights_map(&basic_lights())?),
                resource("dist-edge.ymap", &lights_map(&edge_lights())?),
                resource("dist-one.ymap", &lights_map(&one_light())?),
                stored("readme.txt", b"hello"),
            ],
        );
        Some(lab.archive("near-basic.rpf", &folder("", vec![levels], Vec::new())))
    }

    fn summary(done: &Value) -> Vec<String> {
        done["candidates"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| {
                format!(
                    "{}->{}#{} d={}",
                    row["anchorId"].as_str().unwrap(),
                    row["ymapEntry"].as_str().unwrap(),
                    row["alignedLightIndex"],
                    row["distance"]
                )
            })
            .collect()
    }

    // --- чистые части ---

    #[test]
    fn registry_and_limits() {
        let names: Vec<&str> = COMMANDS.iter().map(|command| command.name).collect();
        assert_eq!(names, ["lamp-lod-nearest"]);
    }

    #[test]
    fn the_radius_is_checked_on_the_square_in_f32() {
        let at = |light: [f32; 3]| reach(&light, &[0.0; 3]).map(|gap| gap.to_string());
        assert_eq!(at([0.0; 3]), Some("0".into()));
        assert_eq!(at([3.0, 4.0, 0.0]), Some("5".into()));
        assert_eq!(at([0.0, 0.0, 5.0]), Some("5".into()));
        assert_eq!(at([4.999_999_5, 0.0, 0.0]), Some("4.9999995".into()));
        assert_eq!(at([2.999_999_8, 4.0, 0.0]), Some("5".into()));
        assert_eq!(at([5.000_001, 0.0, 0.0]), None);
        assert_eq!(at([3.0, 4.0, 0.001]), None);
        assert_eq!(at([3.000_000_2, 4.0, 0.0]), None);
        assert_eq!(at([f32::NAN, 0.0, 0.0]), None);
        assert_eq!(at([f32::INFINITY, 0.0, 0.0]), None);
        assert_eq!(at([2e19, 0.0, 0.0]), None, "квадрат уходит в бесконечность");
        // расстояние до якоря не в начале координат
        assert_eq!(
            reach(&[11.0, 20.0, 30.0], &[10.0, 20.0, 30.0]).map(|gap| gap.to_string()),
            Some("1".into())
        );
    }

    #[test]
    fn packed_colour_splits_into_rgb_and_intensity() {
        let hit = Hit {
            anchor: 0,
            gap: 1.0,
            light: Light {
                entry: "m.ymap".into(),
                index: 7,
                at: [1.0, 2.0, 3.0],
                packed: 0x80AA_BBCC,
            },
        };
        let row = candidate("lod:a.1", &hit);
        assert_eq!(
            row.to_string(),
            concat!(
                r#"{"anchorId":"lod:a.1","ymapEntry":"m.ymap","alignedLightIndex":7,"distance":1,"#,
                r#""positionX":1,"positionY":2,"positionZ":3,"colorR":170,"colorG":187,"colorB":204,"intensity":128}"#
            )
        );
    }

    #[test]
    fn positions_without_matching_colours_are_refused() {
        let lights = |positions: usize, colours: usize| DistantLights {
            positions: vec![[0.0; 3]; positions],
            colours: vec![0; colours],
        };
        // Причина идёт в parseErrors (раньше отказом всего поиска).
        let mismatch = Err("Дальние огни карты не совпали по числу");
        assert_eq!(paired(lights(3, 2)).map(|_| ()), mismatch);
        assert_eq!(paired(lights(1, 3)).map(|_| ()), mismatch);
        assert_eq!(paired(lights(1, 0)).map(|_| ()), mismatch);
        assert_eq!(paired(lights(0, 2)).unwrap().colours.len(), 2);
        assert_eq!(paired(lights(0, 0)).unwrap().positions.len(), 0);
        assert_eq!(paired(lights(4, 4)).unwrap().positions.len(), 4);
    }

    // --- якоря ---

    type Found = std::result::Result<Vec<(String, [f32; 3])>, String>;

    fn failed(what: &str) -> Found {
        Err(format!("{what}: пока на хосте."))
    }

    fn anchors(list: Value) -> Found {
        anchors_of(&json!({ "lampWorldAnchors": list }))
            .map(|found| found.into_iter().map(|a| (a.id, a.at)).collect())
            .map_err(|error| error.message)
    }

    fn anchor(id: &str) -> Value {
        json!({ "anchorId": id, "x": 0, "y": 0, "z": 0 })
    }

    #[test]
    fn anchor_ids_must_be_unique_and_safe() {
        let bad_id = failed("Id якоря не годится или повторяется");
        let bad_name = bad_id.clone().map(|_| String::new());
        let fine = |id: &str| anchors(json!([anchor(id)])).map(|found| found[0].0.clone());
        assert_eq!(fine("lod:a.1"), Ok("lod:a.1".to_owned()));
        assert_eq!(fine("A_b-c:d.e9"), Ok("A_b-c:d.e9".to_owned()));
        assert_eq!(fine(&"x".repeat(160)), Ok("x".repeat(160)));
        for id in [
            "",
            "   ",
            "a b",
            "a/b",
            "якорь",
            "a ",
            " a",
            "a#1",
            "a+1",
            "a\u{0}b",
            "a\u{a0}b",
        ] {
            assert_eq!(fine(id), bad_name, "{id:?}");
        }
        assert_eq!(fine(&"x".repeat(161)), bad_name);
        // длина считается в байтах
        assert_eq!(fine(&"я".repeat(81)), bad_name);
        assert_eq!(anchors(json!([anchor("a"), anchor("a")])), bad_id);
        // регистр различает якоря
        assert_eq!(
            anchors(json!([anchor("a"), anchor("A")])).map(|a| a.len()),
            Ok(2)
        );
        for broken in [
            json!([{ "x": 0, "y": 0, "z": 0 }]),
            json!([{ "anchorId": 5, "x": 0, "y": 0, "z": 0 }]),
            json!([5]),
            json!([null]),
        ] {
            assert_eq!(anchors(broken), bad_id);
        }
    }

    #[test]
    fn anchor_lists_have_a_shape_and_a_size() {
        let absent = failed("Нет якорей");
        for value in [json!({}), json!("a"), json!(null), json!(5)] {
            assert_eq!(anchors(value), absent);
        }
        let size = failed("Число якорей вне 1…1024");
        assert_eq!(anchors(json!([])), size);
        let many = |count: usize| {
            json!((0..count)
                .map(|n| anchor(&format!("a{n}")))
                .collect::<Vec<_>>())
        };
        assert_eq!(anchors(many(1024)).map(|a| a.len()), Ok(1024));
        assert_eq!(anchors(many(1025)), size);
        assert_eq!(
            anchors_of(&json!({})).err().unwrap().message,
            "Нет якорей: пока на хосте."
        );
    }

    #[test]
    fn coordinates_are_checked_after_the_cast_to_f32() {
        let at = |x: Value| {
            anchors(json!([{ "anchorId": "a", "x": x, "y": 0, "z": 0 }]))
                .map(|found| found[0].1[0].to_string())
        };
        let outside = failed("Координата якоря вне пределов");
        let outside_text = outside.clone().map(|_| String::new());
        let not_number = failed("Координата якоря не число");
        let not_number_text = not_number.clone().map(|_| String::new());
        assert_eq!(at(json!(20000)), Ok("20000".to_owned()));
        assert_eq!(at(json!(-20000)), Ok("-20000".to_owned()));
        assert_eq!(at(json!(20000.0009)), Ok("20000".to_owned()));
        assert_eq!(at(json!(20000.001)), outside_text);
        assert_eq!(at(json!(20001)), outside_text);
        assert_eq!(at(json!(-20001)), outside_text);
        assert_eq!(at(json!(1e300)), outside_text);
        assert_eq!(at(json!(-1e39)), outside_text);
        assert_eq!(at(json!(1e-300)), Ok("0".to_owned()));
        assert_eq!(at(json!(-0.5)), Ok("-0.5".to_owned()));
        for bad in [json!("1"), json!(null), json!(true), json!([1]), json!({})] {
            assert_eq!(at(bad), not_number_text);
        }
        // координаты: нет x, y, z; позиция массивом вместо полей
        for key in ["x", "y", "z"] {
            let mut raw = anchor("a");
            raw.as_object_mut().unwrap().remove(key);
            assert_eq!(anchors(json!([raw])), not_number, "{key}");
        }
        assert_eq!(
            anchors(json!([{ "anchorId": "a", "position": [0, 0, 0] }])),
            not_number
        );
        // лишние поля игнорируются
        let extra = json!([{ "anchorId": "a", "x": 1, "y": 2, "z": 3, "w": 1, "name": "x" }]);
        assert_eq!(anchors(extra), Ok(vec![("a".to_owned(), [1.0, 2.0, 3.0])]));
    }

    #[test]
    fn the_first_bad_anchor_wins_and_inside_it_the_id_comes_first() {
        let id = failed("Id якоря не годится или повторяется");
        let number = failed("Координата якоря не число");
        let bad_x = json!({ "anchorId": "a", "x": "x", "y": 0, "z": 0 });
        let bad_id = anchor("");
        assert_eq!(anchors(json!([bad_x.clone(), bad_id.clone()])), number);
        assert_eq!(
            anchors(json!([{ "anchorId": "", "x": "x", "y": 0, "z": 0 }])),
            id
        );
        assert_eq!(
            anchors(json!([anchor("a"), anchor("b/"), { "anchorId": "c", "x": "x" }])),
            id
        );
        assert_eq!(
            anchors(json!([anchor("a"), anchor("a"), { "anchorId": "c", "x": "x" }])),
            id
        );
    }

    // --- запрос и параметры ---

    #[test]
    fn parameters_and_request_order() {
        let lab = Lab::new();
        let archive = lab.archive("a.rpf", &top(vec![stored("readme.txt", b"hi")]));
        let game = lab.text("game");
        let keys = lab.text("keys");
        let nowhere = lab.text("нет");
        let ok = request(&archive, origin());
        let input = lab.put("req.json", ok.to_string().as_bytes());

        assert_eq!(
            failure(lab.run(&["--game-root", &game, "--keys", &keys])).1,
            "--input is required."
        );
        assert_eq!(
            failure(lab.run(&["--input", &lab.text("нет.json"), "--game-root", &game])).0,
            "FileNotFoundException"
        );
        let text = lab.put("r.txt", b"{}");
        assert_eq!(
            failure(lab.run(&["--input", &text])).1,
            "Unsupported file extension: .txt"
        );
        assert_eq!(
            failure(lab.run(&["--input", &input, "--keys", &keys])).1,
            "--game-root is required."
        );
        assert_eq!(
            failure(lab.run(&["--input", &input, "--game-root", &nowhere])),
            (
                "DirectoryNotFoundException".into(),
                "The selected directory is not a GTA V installation.".into()
            )
        );
        // повтор и регистр имён параметров: берётся последний
        let other = lab.put("other.json", r#"{"mode":"другое"}"#.as_bytes());
        let done = lab
            .run(&[
                "--INPUT",
                &other,
                "--Input",
                &input,
                "--game-root",
                &nowhere,
                "--Game-Root",
                &game,
                "--keys",
                &keys,
                "--x",
                "y",
            ])
            .unwrap();
        assert_eq!(done["ymapCount"], 0);

        // содержимое запроса
        for body in [b"".to_vec(), b"nope".to_vec(), b"\xEF\xBB\xBF{}".to_vec()] {
            let path = lab.put("bad.json", &body);
            assert_eq!(
                failure(lab.run(&["--input", &path, "--game-root", &game])),
                refused("Запрос ближайших огней не читается")
            );
        }
        let mode = refused("Запрос ближайших огней другого режима");
        for body in [
            json!([]),
            json!({}),
            json!({ "mode": "other" }),
            json!({ "mode": "lamp-archive-scan", "baseArchive": archive, "lampWorldAnchors": origin() }),
        ] {
            assert_eq!(failure(lab.find(&body)), mode, "{body}");
        }
        let only = refused("Архив — только абсолютный .rpf");
        assert_eq!(failure(lab.find(&json!({ "mode": MODE }))), only);
        let missing = request(&lab.text("нет.rpf"), json!([]));
        assert_eq!(failure(lab.find(&missing)), refused("Архив не найден"));
        let mut no_anchors = request(&archive, json!(null));
        no_anchors
            .as_object_mut()
            .unwrap()
            .remove("lampWorldAnchors");
        assert_eq!(failure(lab.find(&no_anchors)), refused("Нет якорей"));
        // якоря раньше глубины, глубина раньше игровой папки, папка игры раньше открытия архива
        let mut empty = request(&archive, json!([]));
        empty["maxNestedDepth"] = json!("x");
        assert_eq!(
            failure(lab.find(&empty)),
            refused("Число якорей вне 1…1024")
        );
        let mut depth = request(&archive, origin());
        depth["maxNestedDepth"] = json!("x");
        let input = lab.put("depth.json", depth.to_string().as_bytes());
        assert_eq!(
            failure(lab.run(&["--input", &input, "--game-root", &nowhere, "--keys", &keys])),
            refused("Глубина вложенности не число")
        );
        let text_rpf = lab.put("t.rpf", "привет, это не архив".as_bytes());
        let input = lab.put(
            "text.json",
            request(&text_rpf, origin()).to_string().as_bytes(),
        );
        assert_eq!(
            failure(lab.run(&["--input", &input, "--game-root", &nowhere, "--keys", &keys])).0,
            "DirectoryNotFoundException"
        );
        assert_eq!(
            failure(lab.run(&["--input", &input, "--game-root", &game, "--keys", &keys])),
            (
                "InvalidDataException".into(),
                "t.rpf: The identifier 80D1BFD0 did not match the expected value of 0x52504637"
                    .into()
            )
        );
        let empty_rpf = lab.put("e.rpf", b"");
        assert_eq!(
            failure(lab.find(&request(&empty_rpf, origin()))).1,
            "e.rpf: the file is too short to be an RPF7 archive"
        );
    }

    // --- расчёт ---

    const NC01: &str = concat!(
        r#"{"status":"ready","mode":"lamp-lod-nearest","edition":null,"archive":null,"maximumDistance":5,"ymapCount":3,"anchors":1,"candidates":["#,
        r#"{"anchorId":"o","ymapEntry":"levels/dist-basic.ymap","alignedLightIndex":0,"distance":0,"positionX":0,"positionY":0,"positionZ":0,"colorR":17,"colorG":34,"colorB":51,"intensity":255},"#,
        r#"{"anchorId":"o","ymapEntry":"levels/dist-basic.ymap","alignedLightIndex":3,"distance":1.7320508,"positionX":1,"positionY":1,"positionZ":1,"colorR":171,"colorG":205,"colorB":239,"intensity":127},"#,
        r#"{"anchorId":"o","ymapEntry":"levels/dist-edge.ymap","alignedLightIndex":2,"distance":4.9999995,"positionX":4.9999995,"positionY":0,"positionZ":0,"colorR":0,"colorG":0,"colorB":3,"intensity":0},"#,
        r#"{"anchorId":"o","ymapEntry":"levels/dist-basic.ymap","alignedLightIndex":1,"distance":5,"positionX":3,"positionY":4,"positionZ":0,"colorR":255,"colorG":255,"colorB":255,"intensity":128},"#,
        r#"{"anchorId":"o","ymapEntry":"levels/dist-basic.ymap","alignedLightIndex":6,"distance":5,"positionX":0,"positionY":0,"positionZ":5,"colorR":32,"colorG":48,"colorB":64,"intensity":16},"#,
        r#"{"anchorId":"o","ymapEntry":"levels/dist-edge.ymap","alignedLightIndex":0,"distance":5,"positionX":5,"positionY":0,"positionZ":0,"colorR":0,"colorG":0,"colorB":1,"intensity":0},"#,
        r#"{"anchorId":"o","ymapEntry":"levels/dist-edge.ymap","alignedLightIndex":3,"distance":5,"positionX":-5,"positionY":0,"positionZ":0,"colorR":0,"colorG":0,"colorB":4,"intensity":0},"#,
        r#"{"anchorId":"o","ymapEntry":"levels/dist-edge.ymap","alignedLightIndex":4,"distance":5,"positionX":0,"positionY":5,"positionZ":0,"colorR":0,"colorG":0,"colorB":5,"intensity":0},"#,
        r#"{"anchorId":"o","ymapEntry":"levels/dist-edge.ymap","alignedLightIndex":5,"distance":5,"positionX":0,"positionY":0,"positionZ":-5,"colorR":0,"colorG":0,"colorB":6,"intensity":0},"#,
        r#"{"anchorId":"o","ymapEntry":"levels/dist-edge.ymap","alignedLightIndex":6,"distance":5,"positionX":3,"positionY":4,"positionZ":0,"colorR":0,"colorG":0,"colorB":7,"intensity":0},"#,
        r#"{"anchorId":"o","ymapEntry":"levels/dist-edge.ymap","alignedLightIndex":7,"distance":5,"positionX":2.9999998,"positionY":4,"positionZ":0,"colorR":0,"colorG":0,"colorB":8,"intensity":0}"#,
        r#"],"unmatchedAnchorIds":[],"parseErrors":[],"complete":true}"#
    );

    #[test]
    fn the_full_answer_of_the_basic_archive() {
        let lab = Lab::new();
        let Some(archive) = near_basic(&lab) else {
            eprintln!("образец карты дальних огней недоступен: пропущено");
            return;
        };
        let done = lab.find(&request(&archive, origin())).unwrap();
        assert_eq!(done.to_string(), NC01);
    }

    #[test]
    fn anchors_are_sorted_by_bytes_and_unmatched_ones_listed() {
        let lab = Lab::new();
        let Some(archive) = near_basic(&lab) else {
            eprintln!("образец карты дальних огней недоступен: пропущено");
            return;
        };
        // якорь у одиночного огня, второй рядом; id идут не по порядку запроса
        let two = json!([
            { "anchorId": "b", "x": 10, "y": 20, "z": 30 },
            { "anchorId": "a", "x": 11, "y": 20, "z": 30 },
        ]);
        let done = lab.find(&request(&archive, two)).unwrap();
        assert_eq!(
            summary(&done),
            [
                "a->levels/dist-one.ymap#0 d=1",
                "b->levels/dist-one.ymap#0 d=0"
            ]
        );
        assert_eq!(done["anchors"], 2);
        assert_eq!(done["unmatchedAnchorIds"], json!([]));
        // регистр различается: прописные раньше строчных, цифры раньше букв, «_» после прописных
        let ids = ["b", "B", "a", "A1", "_", "1", "Z", "z"];
        let list: Vec<Value> = ids
            .iter()
            .map(|id| {
                let far = *id == "Z" || *id == "z";
                let at = if far { 5000 } else { 0 };
                json!({ "anchorId": id, "x": at, "y": at, "z": at })
            })
            .collect();
        let done = lab.find(&request(&archive, json!(list))).unwrap();
        assert_eq!(done["unmatchedAnchorIds"], json!(["Z", "z"]));
        let order: Vec<String> = done["candidates"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| row["anchorId"].as_str().unwrap().to_owned())
            .fold(Vec::new(), |mut seen, id| {
                if seen.last() != Some(&id) {
                    seen.push(id);
                }
                seen
            });
        assert_eq!(order, ["1", "A1", "B", "_", "a", "b"]);
        assert_eq!(done["candidates"].as_array().unwrap().len(), 6 * 11);
        // якорь без огней рядом и якорь у границы мира
        let far = json!([{ "anchorId": "far", "x": 5000, "y": 5000, "z": 5000 }]);
        let done = lab.find(&request(&archive, far)).unwrap();
        assert_eq!(done["candidates"], json!([]));
        assert_eq!(done["unmatchedAnchorIds"], json!(["far"]));
        assert_eq!(done["ymapCount"], 3);
        let edge = json!([{ "anchorId": "a", "x": 20000, "y": -20000, "z": 20000 }]);
        let done = lab.find(&request(&archive, edge)).unwrap();
        assert_eq!(done["unmatchedAnchorIds"], json!(["a"]));
    }

    #[test]
    fn candidates_are_ordered_by_distance_map_and_light_index() {
        let lab = Lab::new();
        let Some(archive) = near_basic(&lab) else {
            eprintln!("образец карты дальних огней недоступен: пропущено");
            return;
        };
        // из точки (1,1,1): расстояния 0, 1.732…, 3.741…, 3.7416573
        let from = json!([{ "anchorId": "o", "x": 1, "y": 1, "z": 1 }]);
        let done = lab.find(&request(&archive, from)).unwrap();
        let rows = summary(&done);
        assert_eq!(rows[0], "o->levels/dist-basic.ymap#3 d=0");
        assert_eq!(rows[1], "o->levels/dist-basic.ymap#0 d=1.7320508");
        assert_eq!(rows.len(), 13);
        assert!(rows.windows(2).all(|pair| {
            let gap = |row: &String| row.rsplit("d=").next().unwrap().parse::<f64>().unwrap();
            gap(&pair[0]) <= gap(&pair[1])
        }));
        // смещённый якорь: расстояния от (3,4,0), малые различия не теряются
        let shifted = json!([{ "anchorId": "p", "x": 3, "y": 4, "z": 0 }]);
        let done = lab.find(&request(&archive, shifted)).unwrap();
        let rows = summary(&done);
        assert_eq!(rows[0], "p->levels/dist-basic.ymap#1 d=0");
        assert_eq!(rows[1], "p->levels/dist-edge.ymap#6 d=0");
        assert_eq!(rows[2], "p->levels/dist-edge.ymap#7 d=2.3841858e-7");
        assert_eq!(rows[3], "p->levels/dist-edge.ymap#8 d=2.3841858e-7");
    }

    #[test]
    fn equal_distances_follow_the_map_order_without_case_and_then_the_walk() {
        let lab = Lab::new();
        let Some(map) = lights_map(&one_light()) else {
            eprintln!("образец карты дальних огней недоступен: пропущено");
            return;
        };
        let folder_of =
            |name: &str, file: &str| folder(name, Vec::new(), vec![resource(file, &map)]);
        let archive = lab.archive(
            "near-case.rpf",
            &folder(
                "",
                vec![folder_of("a", "B.ymap"), folder_of("A", "z.ymap")],
                vec![
                    resource("A.ymap", &map),
                    resource("a.ymap", &map),
                    resource("B.ymap", &map),
                ],
            ),
        );
        let anchor = json!([{ "anchorId": "o", "x": 10, "y": 20, "z": 30 }]);
        let done = lab.find(&request(&archive, anchor)).unwrap();
        assert_eq!(
            summary(&done),
            [
                "o->A.ymap#0 d=0",
                "o->a.ymap#0 d=0",
                "o->a/B.ymap#0 d=0",
                "o->A/z.ymap#0 d=0",
                "o->B.ymap#0 d=0",
            ]
        );
        assert_eq!(done["ymapCount"], 5);
    }

    #[test]
    fn nested_archives_carry_their_names_and_the_depth_limits_them() {
        let lab = Lab::new();
        let (Some(one), Some(basic), Some(edge)) = (
            lights_map(&one_light()),
            lights_map(&basic_lights()),
            lights_map(&edge_lights()),
        ) else {
            eprintln!("образец карты дальних огней недоступен: пропущено");
            return;
        };
        let n3 = top(vec![resource("in3.ymap", &one)]);
        let n2 = top(vec![resource("in2.ymap", &edge), pack("n3.rpf", n3)]);
        let n1 = top(vec![resource("in1.ymap", &basic), pack("n2.rpf", n2)]);
        let archive = lab.archive(
            "near-nest.rpf",
            &top(vec![resource("top.ymap", &one), pack("n1.rpf", n1)]),
        );
        let anchors = json!([
            { "anchorId": "a", "x": 10, "y": 20, "z": 30 },
            { "anchorId": "o", "x": 0, "y": 0, "z": 0 },
        ]);
        let run = |depth: Option<i64>| {
            let mut asked = request(&archive, anchors.clone());
            if let Some(depth) = depth {
                asked["maxNestedDepth"] = json!(depth);
            }
            let done = lab.find(&asked).unwrap();
            (
                done["ymapCount"].as_u64().unwrap(),
                summary(&done).len(),
                done,
            )
        };
        let (maps, found, done) = run(None);
        assert_eq!((maps, found), (4, 13));
        assert_eq!(
            summary(&done)[..4],
            [
                "a->n1.rpf/n2.rpf/n3.rpf/in3.ymap#0 d=0",
                "a->top.ymap#0 d=0",
                "o->n1.rpf/in1.ymap#0 d=0",
                "o->n1.rpf/in1.ymap#3 d=1.7320508",
            ]
        );
        assert_eq!(run(Some(0)).0, 1);
        assert_eq!(run(Some(-1)).0, 1);
        assert_eq!(run(Some(0)).1, 1);
        assert_eq!(run(Some(1)).0, 2);
        assert_eq!((run(Some(2)).0, run(Some(2)).1), (3, 12));
        assert_eq!(run(Some(3)).0, 4);
        assert_eq!(run(Some(100)).0, 4);
        let (_, _, only_top) = run(Some(0));
        assert_eq!(only_top["unmatchedAnchorIds"], json!(["o"]));
    }

    #[test]
    fn lights_of_real_city_pairs_are_found_at_their_own_positions() {
        let lab = Lab::new();
        let read = |name: &str| {
            fs::read(crate::test_support::engine(&format!("{PAIRS}/{name}.ymap"))).ok()
        };
        let names = [
            "lodlights_medium017",
            "distlodlights_medium017",
            "lodlights_small008",
            "distlodlights_small008",
            "lodlights_small045",
            "distlodlights_small045",
        ];
        let Some(maps) = names
            .iter()
            .map(|name| read(name))
            .collect::<Option<Vec<_>>>()
        else {
            eprintln!("образцы пар карт города недоступны: пропущено");
            return;
        };
        let files: Vec<FileNode> = names
            .iter()
            .zip(&maps)
            .map(|(name, bytes)| resource(&format!("{name}.ymap"), bytes))
            .collect();
        let archive = lab.archive(
            "near-real.rpf",
            &folder("", vec![folder("lodlights", Vec::new(), files)], Vec::new()),
        );
        let find = |anchors: Value| lab.find(&request(&archive, anchors)).unwrap();

        // якорь в позиции огня 0 пары small045
        let done =
            find(json!([{ "anchorId": "l0", "x": 178.84366, "y": -716.1918, "z": 49.132206 }]));
        assert_eq!(done["ymapCount"], 6);
        assert_eq!(
            done["candidates"].to_string(),
            concat!(
                r#"[{"anchorId":"l0","ymapEntry":"lodlights/distlodlights_small045.ymap","alignedLightIndex":0,"#,
                r#""distance":0,"positionX":178.84366,"positionY":-716.1918,"positionZ":49.132206,"#,
                r#""colorR":255,"colorG":193,"colorB":99,"intensity":170}]"#
            )
        );
        assert_eq!(done["unmatchedAnchorIds"], json!([]));
        // в метре от огня
        let done =
            find(json!([{ "anchorId": "l0", "x": 179.84366, "y": -716.1918, "z": 49.132206 }]));
        assert_eq!(
            summary(&done),
            ["l0->lodlights/distlodlights_small045.ymap#0 d=1"]
        );
        // по якорю на огни двух других пар
        let done = find(json!([
            { "anchorId": "m0", "x": -2288.0417, "y": 3205.0974, "z": 40.457684 },
            { "anchorId": "s0", "x": -1257.8447, "y": 370.5361, "z": 78.22614 },
        ]));
        assert_eq!(
            summary(&done),
            [
                "m0->lodlights/distlodlights_medium017.ymap#0 d=0",
                "s0->lodlights/distlodlights_small008.ymap#0 d=0",
                "s0->lodlights/distlodlights_small008.ymap#25 d=0.96513337",
            ]
        );
        // малый кластер
        let done = find(json!([
            { "anchorId": "c3", "x": 121.45464, "y": -689.65424, "z": 44.07623 },
            { "anchorId": "c10", "x": 106.29006, "y": -695.65625, "z": 44.728405 },
        ]));
        assert_eq!(
            summary(&done),
            [
                "c10->lodlights/distlodlights_small045.ymap#10 d=0",
                "c10->lodlights/distlodlights_small045.ymap#123 d=3.4753497",
                "c3->lodlights/distlodlights_small045.ymap#3 d=0",
            ]
        );
        // якорь вне огней города
        let done = find(json!([{ "anchorId": "nowhere", "x": 0, "y": 0, "z": 0 }]));
        assert_eq!(done["candidates"], json!([]));
        assert_eq!(done["unmatchedAnchorIds"], json!(["nowhere"]));
        // цвет 255,255,255 и яркость у огня 100
        let done =
            find(json!([{ "anchorId": "c100", "x": 186.47285, "y": -716.7913, "z": 37.678707 }]));
        assert_eq!(
            summary(&done),
            ["c100->lodlights/distlodlights_small045.ymap#100 d=0"]
        );
        assert_eq!(done["candidates"][0]["colorR"], 255);
    }

    #[test]
    fn maps_that_cannot_be_read_precisely_are_skipped_and_named_in_parse_errors() {
        let lab = Lab::new();
        let scan = |name: &str, files: Vec<FileNode>, depth: Option<i64>| {
            let archive = lab.archive(name, &top(files));
            let mut asked = request(&archive, origin());
            if let Some(depth) = depth {
                asked["maxNestedDepth"] = json!(depth);
            }
            lab.find(&asked)
        };
        // Раньше одна нечитаемая карта или не открывшийся вложенный архив роняли весь поиск; теперь они пропускаются
        // и называются в parseErrors (complete становится false).
        let skipped = |done: &Value| -> Vec<(String, String)> {
            done["parseErrors"]
                .as_array()
                .unwrap()
                .iter()
                .map(|item| {
                    (
                        item["entry"].as_str().unwrap().to_owned(),
                        item["error"].as_str().unwrap().to_owned(),
                    )
                })
                .collect()
        };
        let pair = |entry: &str, reason: &str| (entry.to_owned(), reason.to_owned());
        let not_rsc7 = "Карта .ymap не в формате RSC7";
        let magic = rage_res::resource::RSC7_MAGIC.to_le_bytes();
        for text in [
            b"PSIN and the rest".to_vec(),
            b"text".to_vec(),
            Vec::new(),
            b"RSC".to_vec(),
        ] {
            let done = scan("m.rpf", vec![stored("m.ymap", &text)], None).unwrap();
            assert_eq!(skipped(&done), [pair("m.ymap", not_rsc7)]);
            assert_eq!(done["complete"], false);
            assert_eq!(done["status"], "incomplete");
            assert_eq!(done["ymapCount"], 1);
        }
        let unreadable = "Карта .ymap не читается";
        let rsc7_cut = [magic.to_vec(), vec![1u8, 2, 3]].concat();
        let rsc7_head = [magic.to_vec(), vec![0u8; 12]].concat();
        let rsc7_junk = [
            magic.to_vec(),
            vec![2, 0, 0, 0, 0, 0, 0, 8, 0, 0, 0, 0x20],
            vec![0xFF; 40],
        ]
        .concat();
        for junk in [rsc7_cut, rsc7_head, rsc7_junk] {
            let done = scan("m.rpf", vec![stored("m.ymap", &junk)], None).unwrap();
            assert_eq!(skipped(&done), [pair("m.ymap", unreadable)]);
            assert_eq!(done["complete"], false);
        }
        // PSO первым в порядке обхода пропускается, следом идёт хорошая карта и читается
        let flat = [
            magic.to_vec(),
            vec![2, 0, 0, 0],
            (1u32 << 27).to_le_bytes().to_vec(),
            vec![0, 0, 0, 0],
            rage_res::resource::deflate_zlib9(&[0u8; 0x200]),
        ]
        .concat();
        let flat_map = resource("z.ymap", &flat);
        let done = scan(
            "m.rpf",
            vec![stored("a.ymap", b"PSIN....."), flat_map.clone()],
            None,
        )
        .unwrap();
        assert_eq!(skipped(&done), [pair("a.ymap", not_rsc7)]);
        assert_eq!(done["ymapCount"], 2);
        // карта без таблицы структур дальних огней не имеет, но считается
        let done = scan("m.rpf", vec![flat_map.clone()], None).unwrap();
        assert_eq!(
            (
                done["ymapCount"].as_u64(),
                done["candidates"].as_array().map(Vec::len)
            ),
            (Some(1), Some(0))
        );
        assert_eq!(done["unmatchedAnchorIds"], json!(["o"]));
        // карта с сущностями вместо огней отказа не даёт
        let entities = compile_map(
            "m",
            &[ArchetypeSpec {
                name: "prop_a".into(),
                lod_dist: 100.0,
                bb_min: [-1.0; 3],
                bb_max: [1.0; 3],
                flags: 0,
                clip_dictionary: None,
            }],
            &[EntitySpec {
                archetype: 0,
                position: [0.0; 3],
                rotation: [0.0, 0.0, 0.0, 1.0],
                lod_dist: 100.0,
                flags: 0,
                guid: None,
            }],
            "exporter",
            "now",
        )
        .unwrap();
        let done = scan("m.rpf", vec![resource("e.ymap", &entities)], None).unwrap();
        assert_eq!(
            (
                done["ymapCount"].as_u64(),
                done["candidates"].as_array().map(Vec::len)
            ),
            (Some(1), Some(0))
        );
        // вложенный архив, который не архив
        let nested = "Вложенный архив не открылся";
        let bad = stored("z.rpf", b"not an archive");
        let done = scan("n.rpf", vec![bad.clone(), flat_map.clone()], None).unwrap();
        assert_eq!(skipped(&done), [pair("z.rpf", nested)]);
        assert_eq!(done["ymapCount"], 1);
        let done = scan("n.rpf", vec![bad.clone(), flat_map.clone()], Some(0)).unwrap();
        assert_eq!(done["ymapCount"], 1);
        assert_eq!(done["parseErrors"], json!([]));
        // ресурс с именем .rpf пропускается молча, запись .rpf не архив — попадает в parseErrors
        let fake = resource("r.rpf", &flat);
        let done = scan("f.rpf", vec![fake.clone(), stored("q.rpf", b"junk")], None).unwrap();
        assert_eq!(skipped(&done), [pair("q.rpf", nested)]);
        let done = scan("f.rpf", vec![fake], None).unwrap();
        assert_eq!(done["parseErrors"], json!([]));
        assert_eq!(done["complete"], true);
        // распаковка записи не удалась
        let archive = lab.archive("w.rpf", &top(vec![stored("a.ymap", &flat)]));
        let bytes = fs::read(&archive).unwrap();
        let cut = lab.put("cut.rpf", &bytes[..512]);
        let done = lab.find(&request(&cut, origin())).unwrap();
        let reasons: Vec<String> = skipped(&done)
            .into_iter()
            .map(|(_, reason)| reason)
            .collect();
        assert!(!reasons.is_empty());
        assert!(reasons
            .iter()
            .all(|reason| reason == "Запись .ymap не распакована"));
        assert_eq!(done["complete"], false);
        // пустой архив и архив без карт
        let done = scan("o.rpf", vec![stored("readme.txt", b"x")], None).unwrap();
        assert_eq!(done["ymapCount"], 0);
        assert_eq!(done["unmatchedAnchorIds"], json!(["o"]));
        let done = scan("o.rpf", Vec::new(), None).unwrap();
        assert_eq!(done["ymapCount"], 0);
        // файлы каталога идут раньше его подкаталогов: в parseErrors они встают в том же порядке
        let root = folder(
            "",
            vec![folder("a", Vec::new(), vec![stored("bad.rpf", b"junk")])],
            vec![stored("z.ymap", b"text")],
        );
        let archive = lab.archive("files-first.rpf", &root);
        let done = lab.find(&request(&archive, origin())).unwrap();
        assert_eq!(
            skipped(&done),
            [pair("z.ymap", not_rsc7), pair("a/bad.rpf", nested)]
        );
    }

    #[test]
    fn edition_and_archive_target_are_carried_as_they_are() {
        let lab = Lab::new();
        let archive = lab.archive("a.rpf", &top(vec![stored("readme.txt", b"hi")]));
        let mut asked = request(&archive, origin());
        asked["edition"] = json!({ "e": 1 });
        asked["archiveTarget"] = json!([1, "x"]);
        let done = lab.find(&asked).unwrap();
        assert_eq!(done["edition"], json!({ "e": 1 }));
        assert_eq!(done["archive"], json!([1, "x"]));
        let keys: Vec<&str> = done
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
                "edition",
                "archive",
                "maximumDistance",
                "ymapCount",
                "anchors",
                "candidates",
                "unmatchedAnchorIds",
                "parseErrors",
                "complete"
            ]
        );
        assert_eq!(done["maximumDistance"].to_string(), "5");
        let plain = lab.find(&request(&archive, origin())).unwrap();
        assert_eq!(plain["edition"], Value::Null);
        assert_eq!(plain["archive"], Value::Null);
    }
}
