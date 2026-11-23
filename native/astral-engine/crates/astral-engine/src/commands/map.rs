//! `build-map-patch`: патч большой карты — в плитках `minimap_*.ytd` из архивов игры пиксели одной
//! текстуры заменяются данными из файла DDS.
//!
//! Плитки собираются в памяти и проверяются перечитыванием; на диск (файлы плиток и манифест для
//! установщика RPF) всё уходит одним заходом в самом конце. Игра и архивы только читаются.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use rage_res::dds::Dds;
use rage_res::texture::Format;
use rage_res::ytd_write::{Edit, Entry, NewTexture};
use serde_json::Value;

use super::{fresh_dirs::FreshDirs, shop::write_atomic};
use crate::archives::textures::Tile;
use crate::error::{EngineError, Result};

/// Плитки и базовая копия из командной строки, уже проверенные по числу и по путям.
struct Request {
    jobs: BTreeMap<String, Job>,
    base: Option<PathBuf>,
}

impl Request {
    /// Порядок: все `--tile` по очереди, потом `--base-archive`, потом счёт плиток.
    fn read(options: &crate::args::Options) -> Result<Self> {
        let jobs = collect_jobs(options.values("tile"))?;
        let base = options
            .optional("base-archive")
            .map(|given| crate::paths::existing_file(given, &[".rpf"]))
            .transpose()?;
        match jobs.len() {
            0 => Err(EngineError::invalid_data(
                "Не передано ни одной плитки для замены.",
            )),
            1..=64 => Ok(Self { jobs, base }),
            _ => Err(EngineError::invalid_data(
                "Слишком много плиток в одном патче.",
            )),
        }
    }
}

pub fn build_map_patch(
    options: &crate::args::Options,
    _progress: &crate::progress::Progress,
) -> Result<Value> {
    let root = crate::archives::game_root(options)?;
    let patch = crate::paths::full_path(options.required("output")?)?;
    // Папка патча создаётся раньше проверок ключей, плиток и DDS; отказ убирает созданное, пока оно пусто.
    let guard = FreshDirs::at(options.required("output"));
    std::fs::create_dir_all(&patch)?;
    let loaded = crate::archives::load_keys(&root.to_string_lossy(), options.optional("keys"))?;
    let Request { jobs, base } = Request::read(options)?;

    // Плитка ищется по имени и может лежать в позднем архиве; в памяти остаются только плитки из запроса.
    let wanted: BTreeSet<String> = jobs.keys().cloned().collect();
    let found =
        crate::archives::textures::find_named_map_tiles(&root, &loaded.0, base.as_deref(), &wanted);
    let rebuilt = jobs.iter().try_fold(
        Vec::with_capacity(jobs.len()),
        |mut done, (key, job)| -> Result<Vec<Rebuilt>> {
            done.push(rebuild(&found, key, job)?);
            Ok(done)
        },
    )?;

    let total = rebuilt.iter().map(|tile| tile.bytes.len()).sum::<usize>();
    store(&patch, &rebuilt, total)?;
    guard.keep();

    let summary = object([
        ("patch", patch.display().to_string().into()),
        ("size", total.into()),
        ("tiles", rebuilt.iter().map(Rebuilt::summary).collect()),
        ("targets", rebuilt.iter().map(Rebuilt::target).collect()),
    ]);
    let base_text = base.map(|path| path.display().to_string());
    Ok(object([
        ("keySource", loaded.1.into()),
        ("baseArchive", base_text.into()),
        ("map", summary),
    ]))
}

/// Объект из пар «ключ, значение» в том же порядке.
fn object<const N: usize>(pairs: [(&str, Value); N]) -> Value {
    Value::Object(
        pairs
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect(),
    )
}

/// Плитка из `--tile`: имя в написании первого упоминания и путь DDS из последнего.
struct Job {
    written: String,
    dds: PathBuf,
}

/// Все `--tile` по порядку; плитки с именами, равными без учёта регистра, сливаются в одну.
/// Ключ — имя в нижнем регистре, так что обход идёт по порядку имён.
fn collect_jobs(values: &[String]) -> Result<BTreeMap<String, Job>> {
    values.iter().try_fold(BTreeMap::new(), |mut jobs, value| {
        let (written, dds) = split_tile(value)?;
        match jobs.get_mut(&written.to_lowercase()) {
            Some(Job { dds: last, .. }) => *last = dds,
            None => {
                jobs.insert(written.to_lowercase(), Job { written, dds });
            }
        }
        Ok(jobs)
    })
}

/// `имя=путь`: делится по первому `=`, который обязан стоять не первым; путь проверяется раньше имени.
fn split_tile(value: &str) -> Result<(String, PathBuf)> {
    let Some(at) = value.find('=').filter(|&at| at > 0) else {
        return Err(EngineError::invalid_data(
            "Плитка задаётся как имя=путь к DDS.",
        ));
    };
    let name = value[..at].trim();
    let dds = crate::paths::existing_file(value[at + 1..].trim(), &[".dds"])?;
    let own_last_link = Path::new(name).file_name().is_some_and(|last| last == name);
    if name.is_empty() || !own_last_link {
        return Err(EngineError::invalid_data(format!(
            "Недопустимое имя плитки: {name}"
        )));
    }
    Ok((name.to_owned(), dds))
}

/// Собранная плитка вместе с тем, что нужно ответу и манифесту.
struct Rebuilt {
    file: String,
    archive: String,
    entry: String,
    textures: usize,
    texture: String,
    width: u32,
    height: u32,
    format: &'static str,
    bytes: Vec<u8>,
}

impl Rebuilt {
    fn digest(&self) -> String {
        rage_res::hash::sha256_hex(&self.bytes).to_uppercase()
    }

    fn summary(&self) -> Value {
        object([
            ("file", self.file.as_str().into()),
            ("archive", self.archive.as_str().into()),
            ("entry", self.entry.as_str().into()),
            ("textures", self.textures.into()),
            ("texture", self.texture.as_str().into()),
            ("width", self.width.into()),
            ("height", self.height.into()),
            ("format", format!("D3DFMT_{}", self.format).into()),
            ("bytes", self.bytes.len().into()),
            ("sha256", self.digest().into()),
        ])
    }

    /// Виртуальный путь: имя архива с прямыми слэшами, у `update/update.rpf` — `update`, у прочих без `.rpf`.
    fn target(&self) -> String {
        let archive = self.archive.replace('\\', "/");
        let lowered = archive.to_lowercase();
        let prefix = match lowered.as_str() {
            "update/update.rpf" => "update",
            other if other.ends_with(".rpf") => &archive[..archive.len() - 4],
            _ => &archive,
        };
        format!("{prefix}:/{}", self.entry)
    }
}

/// Размеры, число ступеней и формат: по ним решается, хватит ли замены байтов.
#[derive(PartialEq)]
struct Shape {
    width: u32,
    height: u32,
    levels: u8,
    format: Format,
}

impl From<&Entry> for Shape {
    fn from(entry: &Entry) -> Self {
        let [width, height] = [entry.width, entry.height].map(u32::from);
        Self {
            width,
            height,
            levels: entry.levels,
            format: entry.format,
        }
    }
}

impl From<&Dds> for Shape {
    fn from(image: &Dds) -> Self {
        Self {
            width: image.width,
            height: image.height,
            levels: image.levels,
            format: image.format,
        }
    }
}

fn locate<'a>(found: &'a [Tile], key: &str, name: &str) -> Result<&'a Tile> {
    let tile = found
        .iter()
        .find(|tile| tile.file.eq_ignore_ascii_case(key));
    tile.ok_or_else(|| {
        EngineError::file_not_found(format!("Плитка {name} не найдена в архивах игры."))
    })
}

/// Файл DDS целиком: не пустой и не больше 64 МиБ.
fn read_dds(path: &Path, name: &str) -> Result<Vec<u8>> {
    let raw = std::fs::read(path)?;
    if (1..=67_108_864).contains(&raw.len()) {
        return Ok(raw);
    }
    Err(EngineError::invalid_data(format!(
        "Некорректный DDS для плитки {name}."
    )))
}

/// Словарь плитки; нечитаемый уходит хосту, пустой — отказ.
fn dictionary(tile: &Tile, name: &str) -> Result<Vec<Entry>> {
    let entries = rage_res::ytd_write::read_entries(&tile.bytes).map_err(|_| {
        EngineError::argument(format!("Плитка {name} движок не читает: пока на хосте."))
    })?;
    if entries.is_empty() {
        return Err(EngineError::invalid_data(format!(
            "Плитка {name} не содержит текстур."
        )));
    }
    Ok(entries)
}

/// Номер заменяемой текстуры: по имени плитки без расширения, а если такой нет — единственная в словаре.
fn choose(entries: &[Entry], name: &str) -> Result<usize> {
    let stem = Path::new(name)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("");
    let lone = || (entries.len() == 1).then_some(0);
    let named = entries
        .iter()
        .enumerate()
        .find_map(|(slot, entry)| entry.name.eq_ignore_ascii_case(stem).then_some(slot));
    named.or_else(lone).ok_or_else(|| {
        let listed = entries
            .iter()
            .map(|entry| entry.name.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        EngineError::invalid_data(format!("В плитке {name} нет текстуры {stem}: {listed}"))
    })
}

fn parse_dds(raw: &[u8], name: &str) -> Result<Dds> {
    rage_res::dds::parse(raw).map_err(|_| {
        EngineError::argument(format!(
            "DDS плитки {name} движок не разбирает: пока на хосте."
        ))
    })
}

/// Одна плитка: поиск, DDS, словарь, выбор текстуры, замена и сверка перечитыванием.
fn rebuild(found: &[Tile], key: &str, job: &Job) -> Result<Rebuilt> {
    let name = job.written.as_str();
    let tile = locate(found, key, name)?;
    let raw = read_dds(&job.dds, name)?;
    let entries = dictionary(tile, name)?;
    let chosen = choose(&entries, name)?;
    let image = parse_dds(&raw, name)?;

    let edit = replacement(&entries[chosen], &image);
    let bytes =
        rage_res::ytd_write::edit_with(&tile.bytes, &[edit], rage_res::resource::deflate_zlib9)?;
    let again = rage_res::ytd_write::read_entries(&bytes)?;
    verify_reread(&image, chosen, (&entries, &again), name)?;
    Ok(assemble(job, tile, (&entries, chosen), image, bytes))
}

fn assemble(
    job: &Job,
    tile: &Tile,
    (entries, chosen): (&[Entry], usize),
    image: Dds,
    bytes: Vec<u8>,
) -> Rebuilt {
    let Dds {
        width,
        height,
        format,
        ..
    } = image;
    Rebuilt {
        file: job.written.clone(),
        archive: tile.archive.clone(),
        entry: tile.entry.clone(),
        textures: entries.len(),
        texture: entries[chosen].name.clone(),
        format: format.name(),
        width,
        height,
        bytes,
    }
}

/// Та же форма — заменяются только байты; другая — текстура ложится целиком на объект прежней.
fn replacement(old: &Entry, image: &Dds) -> Edit {
    let name = old.name.clone();
    let payload = image.payload.clone();
    if Shape::from(old) == Shape::from(image) {
        return Edit::Patch { name, payload };
    }
    let [width, height] = [image.width, image.height].map(|side| side as u16);
    let (format, levels) = (image.format, image.levels);
    let texture = NewTexture {
        name,
        width,
        height,
        format,
        levels,
        payload,
    };
    Edit::AddFrom {
        texture,
        template: old.object,
    }
}

/// Перечитанный словарь: те же имена в том же порядке, выбранная текстура равна DDS, остальные как были.
fn verify_reread(
    image: &Dds,
    chosen: usize,
    (before, after): (&[Entry], &[Entry]),
    name: &str,
) -> Result<()> {
    let lowered = |list: &[Entry]| -> Vec<String> {
        list.iter().map(|entry| entry.name.to_lowercase()).collect()
    };
    let ordered = |mut names: Vec<String>| {
        names.sort();
        names
    };
    let (was, now) = (lowered(before), lowered(after));
    if ordered(was.clone()) != ordered(now.clone()) {
        return Err(EngineError::invalid_data(format!(
            "Плитка {name} изменила список текстур."
        )));
    }
    if was != now {
        return Err(EngineError::invalid_data(format!(
            "Плитка {name} переставила текстуры."
        )));
    }
    let culprit = before
        .iter()
        .zip(after)
        .enumerate()
        .find_map(|(slot, (old, new))| {
            let sound = if slot == chosen {
                Shape::from(new) == Shape::from(image) && new.payload == image.payload
            } else {
                untouched(old, new)
            };
            (!sound).then_some(old)
        });
    match culprit {
        None => Ok(()),
        Some(old) => Err(EngineError::invalid_data(format!(
            "Плитка {name}: текстура {} легла не так.",
            old.name
        ))),
    }
}

/// Все поля записи словаря, по которым она сравнивается с прежней.
fn identity(e: &Entry) -> (&str, &[u8], [u16; 2], Shape, &[u8]) {
    (
        e.name.as_str(),
        &e.object[..],
        [e.depth, e.stride],
        Shape::from(e),
        e.payload.as_slice(),
    )
}

/// Запись словаря не изменилась ни в одном поле.
fn untouched(a: &Entry, b: &Entry) -> bool {
    identity(a) == identity(b)
}

/// Папка `payload`, файлы плиток по порядку имён и `manifest.json` (отступ два пробела, без перевода строки в конце).
fn store(patch: &Path, tiles: &[Rebuilt], total: usize) -> Result<()> {
    let payload = patch.join("payload");
    std::fs::create_dir_all(&payload)?;
    tiles
        .iter()
        .try_for_each(|tile| write_atomic(&payload.join(&tile.file), &tile.bytes))?;
    let action = |tile: &Rebuilt| {
        object([
            ("Type", "Replace".into()),
            ("TargetPath", tile.target().into()),
            ("SourcePath", format!("payload/{}", tile.file).into()),
            ("Size", tile.bytes.len().into()),
            ("Sha256", tile.digest().into()),
            ("IsWholeReplaceNestedRpf", false.into()),
        ])
    };
    let manifest = object([
        ("ReduxName", "Astral world map".into()),
        ("ParsedAt", crate::clock::Utc::now().iso_z().into()),
        ("TotalPatchSize", total.into()),
        ("Actions", tiles.iter().map(action).collect()),
    ]);
    // `{:#}` у `Value` — тот же вывод с отступом в два пробела, что у `to_string_pretty`.
    write_atomic(
        &patch.join("manifest.json"),
        format!("{manifest:#}").as_bytes(),
    )?;
    Ok(())
}

pub const COMMANDS: &[super::Command] = &[super::Command::new("build-map-patch", build_map_patch)];

#[cfg(test)]
mod tests {
    use super::*;
    use crate::progress::Progress;
    use rage_res::dds_build::write_header;
    use rage_res::hash::sha256_hex;
    use rage_res::texture::Format;
    use rage_res::ytd_write::read_entries;
    use rage_res::ytd_write::{payload_bytes, write};
    use rage_rpf::write::{write_archive, WriteContext};
    use rage_rpf::{Body, Compress, Data, DirNode, FileNode};
    use serde_json::json;
    use std::fs;
    use std::fs::File;

    /// Псевдослучайные байты по зерну.
    fn noise(seed: u8, size: usize) -> Vec<u8> {
        (0..size)
            .map(|i| {
                (i as u8)
                    .wrapping_mul(37)
                    .wrapping_add(seed)
                    .rotate_left(i as u32 % 5)
            })
            .collect()
    }

    fn format_of(code: &str) -> Format {
        match code {
            "DXT1" => Format::Dxt1,
            "DXT5" => Format::Dxt5,
            "ATI2" => Format::Ati2,
            other => panic!("нет формата {other}"),
        }
    }

    /// Словарь Legacy: текстура — имя, размеры, формат, число ступеней и зерно данных.
    fn ytd(textures: &[(&str, u16, u16, &str, u8, u8)]) -> Vec<u8> {
        let list: Vec<NewTexture> = textures
            .iter()
            .map(|&(name, width, height, format, levels, seed)| {
                let format = format_of(format);
                let size = payload_bytes(
                    format,
                    usize::from(width),
                    usize::from(height),
                    usize::from(levels),
                );
                NewTexture {
                    name: name.to_owned(),
                    width,
                    height,
                    format,
                    levels,
                    payload: noise(seed, size),
                }
            })
            .collect();
        write(&list).expect("словарь")
    }

    fn dds_file(width: usize, height: usize, levels: u32, format: &str, seed: u8) -> Vec<u8> {
        let mut file = write_header(width, height, levels, format).expect("заголовок");
        let size = payload_bytes(format_of(format), width, height, levels as usize);
        file.extend(noise(seed, size));
        file
    }

    fn resource_file(name: &str, bytes: Vec<u8>) -> FileNode {
        FileNode {
            name: name.to_owned(),
            body: Body::Resource {
                data: Data::memory(bytes),
            },
        }
    }

    fn dir(name: &str, dirs: Vec<DirNode>, files: Vec<FileNode>) -> DirNode {
        DirNode {
            name: name.to_owned(),
            dirs,
            files,
        }
    }

    struct World {
        dir: tempfile::TempDir,
    }

    impl World {
        fn new() -> Self {
            let world = Self {
                dir: tempfile::tempdir().expect("папка"),
            };
            fs::create_dir_all(world.game()).expect("папка");
            fs::write(world.game().join("GTA5.exe"), b"exe").expect("запись");
            let keys = world.dir.path().join("keys");
            fs::create_dir_all(&keys).expect("папка");
            for (name, size) in [
                ("gtav_aes_key.dat", 32),
                ("gtav_ng_key.dat", 27472),
                ("gtav_ng_decrypt_tables.dat", 278_528),
                ("gtav_hash_lut.dat", 256),
            ] {
                fs::write(keys.join(name), vec![7u8; size]).expect("запись");
            }
            world
        }

        fn game(&self) -> PathBuf {
            self.dir.path().join("game")
        }

        fn path(&self, tail: &str) -> PathBuf {
            tail.split('/')
                .fold(self.dir.path().to_path_buf(), |path, part| path.join(part))
        }

        fn archive_at(&self, target: &Path, root: &DirNode) {
            fs::create_dir_all(target.parent().expect("папка")).expect("папка");
            let staging = self.dir.path().join("staging");
            fs::create_dir_all(&staging).expect("папка");
            let mut file = File::create(target).expect("файл");
            let mut context = WriteContext {
                staging: &staging,
                keys: None,
                finalizer: None,
            };
            write_archive(root, &mut file, &mut context, &mut |_| {}).expect("архив");
        }

        fn archive(&self, relative: &str, root: &DirNode) {
            let target = relative
                .split('/')
                .fold(self.game(), |path, part| path.join(part));
            self.archive_at(&target, root);
        }

        fn put(&self, name: &str, bytes: &[u8]) -> String {
            let path = self.path(name);
            fs::write(&path, bytes).expect("запись");
            path.display().to_string()
        }

        fn run(&self, extra: &[&str]) -> (Value, i32) {
            let game = self.game().display().to_string();
            let output = self.path("out").display().to_string();
            let keys = self.path("keys").display().to_string();
            let mut args = vec![
                "build-map-patch",
                "--game-root",
                &game,
                "--output",
                &output,
                "--keys",
                &keys,
            ];
            args.extend_from_slice(extra);
            run_args(&args)
        }
    }

    fn run_args(args: &[&str]) -> (Value, i32) {
        let argv: Vec<String> = args.iter().map(|arg| (*arg).to_owned()).collect();
        let outcome = crate::run(&argv, &Progress::silent());
        (
            serde_json::from_str(&outcome.line).expect("JSON"),
            outcome.exit_code,
        )
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

    fn data(text: &str) -> (String, String) {
        ("InvalidDataException".to_owned(), text.to_owned())
    }

    /// Мир A в малом виде: `x64a.rpf` с двумя плитками и вложенным архивом, `update/update.rpf` с плитками разных видов.
    fn world_a() -> World {
        let world = World::new();
        let nested = dir(
            "",
            vec![],
            vec![
                resource_file(
                    "minimap_1_0.ytd",
                    ytd(&[("minimap_1_0", 16, 16, "ATI2", 1, 3)]),
                ),
                resource_file(
                    "minimap_sea_0_0.ytd",
                    ytd(&[("minimap_sea_0_0", 8, 8, "DXT1", 1, 4)]),
                ),
            ],
        );
        let minimap_rpf = FileNode {
            name: "minimap.rpf".to_owned(),
            body: Body::Nested(Box::new(nested)),
        };
        let lod_stub = FileNode {
            name: "minimap_lod_128.ytd".to_owned(),
            body: Body::Binary {
                data: Data::memory(vec![1; 40]),
                compress: Compress::Store,
            },
        };
        let x64a = dir(
            "",
            vec![dir(
                "levels",
                vec![dir("gta5", vec![], vec![minimap_rpf])],
                vec![],
            )],
            vec![
                resource_file(
                    "minimap_0_0.ytd",
                    ytd(&[("minimap_0_0", 16, 16, "DXT1", 1, 1)]),
                ),
                resource_file(
                    "minimap_0_1.ytd",
                    ytd(&[("minimap_0_1", 32, 32, "DXT5", 2, 2)]),
                ),
                lod_stub,
            ],
        );
        world.archive("x64a.rpf", &x64a);
        let levels = dir(
            "levels",
            vec![],
            vec![
                resource_file(
                    "minimap_2_2.ytd",
                    ytd(&[
                        ("extra", 8, 8, "DXT1", 1, 9),
                        ("minimap_2_2", 16, 16, "DXT1", 1, 5),
                    ]),
                ),
                resource_file(
                    "minimap_3_3.ytd",
                    ytd(&[("weird_name", 16, 16, "DXT1", 1, 6)]),
                ),
                resource_file(
                    "minimap_6_6.ytd",
                    ytd(&[("aaa", 8, 8, "DXT1", 1, 7), ("bbb", 8, 8, "DXT1", 1, 8)]),
                ),
            ],
        );
        world.archive(
            "update/update.rpf",
            &dir("", vec![dir("x64", vec![levels], vec![])], vec![]),
        );
        world
    }

    fn first_tile(response: &Value) -> Value {
        response["result"]["map"]["tiles"][0].clone()
    }

    fn entries_of(path: &Path) -> Vec<Entry> {
        read_entries(&fs::read(path).expect("файл")).expect("словарь")
    }

    /// Плитка из архива игры до правки.
    fn entries_of_tile(world: &World, archive: &str, name: &str) -> Vec<Entry> {
        let target = archive
            .split('/')
            .fold(world.game(), |path, part| path.join(part));
        let opened = rage_rpf::Archive::open_path(&target, None).expect("архив");
        let id = opened.find_file(opened.root(), name).or_else(|| {
            let levels = opened
                .find_dir(opened.root(), "x64")
                .and_then(|x64| opened.find_dir(x64, "levels"))?;
            opened.find_file(levels, name)
        });
        read_entries(&opened.export(id.expect("файл")).expect("байты")).expect("словарь")
    }

    #[test]
    fn same_shape_replaces_only_the_bytes() {
        let world = world_a();
        let image = dds_file(16, 16, 1, "DXT1", 50);
        let file = world.put("a.dds", &image);
        let (response, code) = world.run(&["--tile", &format!("minimap_0_0.ytd={file}")]);
        assert_eq!(code, 0, "{response}");
        let result = &response["result"];
        assert_eq!(
            (&result["keySource"], &result["baseArchive"]),
            (&json!("configured-key-directory"), &Value::Null)
        );
        let tile = first_tile(&response);
        let written = fs::read(world.path("out/payload/minimap_0_0.ytd")).expect("плитка");
        assert_eq!(
            tile,
            json!({
                "file": "minimap_0_0.ytd", "archive": "x64a.rpf", "entry": "minimap_0_0.ytd", "textures": 1,
                "texture": "minimap_0_0", "width": 16, "height": 16, "format": "D3DFMT_DXT1",
                "bytes": written.len(), "sha256": sha256_hex(&written).to_uppercase(),
            })
        );
        assert_eq!(result["map"]["targets"], json!(["x64a:/minimap_0_0.ytd"]));
        assert_eq!(result["map"]["size"], written.len());
        assert_eq!(
            result["map"]["patch"],
            world.path("out").display().to_string()
        );
        let after = entries_of(&world.path("out/payload/minimap_0_0.ytd"));
        assert_eq!(after[0].payload, image[128..]);
        let keys: Vec<&String> = tile.as_object().expect("объект").keys().collect();
        assert_eq!(
            keys,
            [
                "file", "archive", "entry", "textures", "texture", "width", "height", "format",
                "bytes", "sha256"
            ]
        );
        let top: Vec<&String> = result.as_object().expect("объект").keys().collect();
        assert_eq!(top, ["keySource", "baseArchive", "map"]);
        let map_keys: Vec<&String> = result["map"].as_object().expect("объект").keys().collect();
        assert_eq!(map_keys, ["patch", "size", "tiles", "targets"]);
    }

    #[test]
    fn manifest_layout_is_the_documented_one() {
        let world = world_a();
        let file = world.put("a.dds", &dds_file(16, 16, 1, "DXT1", 50));
        let (response, _) = world.run(&["--tile", &format!("minimap_0_0.ytd={file}")]);
        let text = fs::read_to_string(world.path("out/manifest.json")).expect("манифест");
        let written = fs::read(world.path("out/payload/minimap_0_0.ytd")).expect("плитка");
        let parsed: Value = serde_json::from_str(&text).expect("JSON");
        let stamp = parsed["ParsedAt"].as_str().expect("время");
        assert_eq!(stamp.len(), 28);
        assert!(
            stamp.ends_with('Z') && stamp.as_bytes()[10] == b'T' && stamp.as_bytes()[19] == b'.'
        );
        let expected = format!(
            "{{\n  \"ReduxName\": \"Astral world map\",\n  \"ParsedAt\": \"{stamp}\",\n  \"TotalPatchSize\": {size},\n  \"Actions\": [\n    {{\n      \"Type\": \"Replace\",\n      \"TargetPath\": \"x64a:/minimap_0_0.ytd\",\n      \"SourcePath\": \"payload/minimap_0_0.ytd\",\n      \"Size\": {size},\n      \"Sha256\": \"{sha}\",\n      \"IsWholeReplaceNestedRpf\": false\n    }}\n  ]\n}}",
            size = written.len(),
            sha = sha256_hex(&written).to_uppercase()
        );
        assert_eq!(text, expected);
        assert_eq!(response["result"]["map"]["size"], written.len());
    }

    #[test]
    fn another_shape_lays_the_texture_whole() {
        let world = world_a();
        let before = entries_of_tile(&world, "x64a.rpf", "minimap_0_0.ytd");
        let image = dds_file(64, 64, 3, "DXT1", 60);
        let file = world.put("a.dds", &image);
        let (response, code) = world.run(&["--tile", &format!("minimap_0_0.ytd={file}")]);
        assert_eq!(code, 0, "{response}");
        let tile = first_tile(&response);
        assert_eq!(
            (tile["width"].as_u64(), tile["height"].as_u64()),
            (Some(64), Some(64))
        );
        let after = entries_of(&world.path("out/payload/minimap_0_0.ytd"));
        assert_eq!(
            (
                after[0].width,
                after[0].height,
                after[0].levels,
                after[0].format
            ),
            (64, 64, 3, Format::Dxt1)
        );
        assert_eq!(after[0].payload, image[128..]);
        assert_eq!(after[0].name, "minimap_0_0");
        // Служебные поля объекта остаются прежними.
        assert_eq!(after[0].object[0..0x50], before[0].object[0..0x50]);
        // Другой формат при тех же размерах.
        let dxt5 = world.put("b.dds", &dds_file(16, 16, 1, "DXT5", 61));
        let (response, code) = world.run(&["--tile", &format!("minimap_0_0.ytd={dxt5}")]);
        assert_eq!(code, 0, "{response}");
        assert_eq!(first_tile(&response)["format"], "D3DFMT_DXT5");
        // Те же размеры и формат, но три ступени.
        let mips = world.put("c.dds", &dds_file(16, 16, 3, "DXT1", 62));
        let (response, _) = world.run(&["--tile", &format!("minimap_0_0.ytd={mips}")]);
        assert_eq!(
            entries_of(&world.path("out/payload/minimap_0_0.ytd"))[0].levels,
            3,
            "{response}"
        );
    }

    /// Мир, где первый архив отдаёт 70 плиток, а нужная лежит в позднем (`update/update.rpf`).
    fn world_with_a_late_tile() -> World {
        let world = World::new();
        let files = (0..70)
            .map(|n| {
                resource_file(
                    &format!("minimap_{n}_0.ytd"),
                    ytd(&[(&format!("minimap_{n}_0"), 8, 8, "DXT1", 1, 1)]),
                )
            })
            .collect();
        world.archive("x64a.rpf", &dir("", vec![], files));
        let levels = dir(
            "levels",
            vec![],
            vec![resource_file(
                "minimap_9_9.ytd",
                ytd(&[("minimap_9_9", 8, 8, "DXT1", 1, 2)]),
            )],
        );
        world.archive(
            "update/update.rpf",
            &dir("", vec![dir("x64", vec![levels], vec![])], vec![]),
        );
        world
    }

    /// Раньше поиск прекращался после первого архива с 64 плитками и больше: плитка из позднего архива
    /// (правка в `update.rpf`) не находилась и команда отказывала «Tile … not found» при существующей плитке.
    #[test]
    fn a_tile_in_a_later_archive_is_found_after_an_archive_with_seventy_tiles() {
        let world = world_with_a_late_tile();
        let image = world.put("late.dds", &dds_file(8, 8, 1, "DXT1", 60));
        let early = world.put("early.dds", &dds_file(8, 8, 1, "DXT1", 61));
        let (response, code) = world.run(&[
            "--tile",
            &format!("minimap_9_9.ytd={image}"),
            "--tile",
            &format!("minimap_3_0.ytd={early}"),
        ]);
        assert_eq!(code, 0, "{response}");
        let tiles = response["result"]["map"]["tiles"]
            .as_array()
            .expect("массив");
        assert_eq!(tiles.len(), 2);
        assert_eq!(tiles[0]["file"], "minimap_3_0.ytd");
        assert_eq!(tiles[0]["archive"], "x64a.rpf");
        assert_eq!(tiles[1]["file"], "minimap_9_9.ytd");
        assert_eq!(tiles[1]["archive"], "update/update.rpf");
        assert_eq!(
            response["result"]["map"]["targets"][1],
            "update:/x64/levels/minimap_9_9.ytd"
        );
        assert!(world.path("out/payload/minimap_9_9.ytd").is_file());
    }

    #[test]
    fn tiles_come_out_in_name_order_with_virtual_paths() {
        let world = world_a();
        let a = world.put("a.dds", &dds_file(16, 16, 1, "DXT1", 1));
        let b = world.put("b.dds", &dds_file(32, 32, 2, "DXT5", 2));
        let nested = world.put("n.dds", &dds_file(16, 16, 1, "ATI2", 3));
        let sea = world.put("s.dds", &dds_file(8, 8, 1, "DXT1", 4));
        let upd = world.put("u.dds", &dds_file(16, 16, 1, "DXT1", 5));
        let (response, code) = world.run(&[
            "--tile",
            &format!("minimap_0_1.ytd={b}"),
            "--tile",
            &format!("minimap_0_0.ytd={a}"),
            "--tile",
            &format!("minimap_1_0.ytd={nested}"),
            "--tile",
            &format!("minimap_sea_0_0.ytd={sea}"),
            "--tile",
            &format!("minimap_2_2.ytd={upd}"),
        ]);
        assert_eq!(code, 0, "{response}");
        let tiles = response["result"]["map"]["tiles"]
            .as_array()
            .expect("массив");
        let order: Vec<&str> = tiles
            .iter()
            .map(|tile| tile["file"].as_str().unwrap_or(""))
            .collect();
        assert_eq!(
            order,
            [
                "minimap_0_0.ytd",
                "minimap_0_1.ytd",
                "minimap_1_0.ytd",
                "minimap_2_2.ytd",
                "minimap_sea_0_0.ytd"
            ]
        );
        assert_eq!(
            response["result"]["map"]["targets"],
            json!([
                "x64a:/minimap_0_0.ytd",
                "x64a:/minimap_0_1.ytd",
                "x64a:/levels/gta5/minimap.rpf/minimap_1_0.ytd",
                "update:/x64/levels/minimap_2_2.ytd",
                "x64a:/levels/gta5/minimap.rpf/minimap_sea_0_0.ytd",
            ])
        );
        assert_eq!(tiles[3]["archive"], "update/update.rpf");
        assert_eq!(tiles[3]["entry"], "x64/levels/minimap_2_2.ytd");
        assert_eq!(tiles[3]["textures"], 2);
        assert_eq!(tiles[3]["texture"], "minimap_2_2");
        let total: u64 = tiles
            .iter()
            .map(|tile| tile["bytes"].as_u64().unwrap_or(0))
            .sum();
        assert_eq!(response["result"]["map"]["size"], total);
        let manifest: Value = serde_json::from_str(
            &fs::read_to_string(world.path("out/manifest.json")).expect("манифест"),
        )
        .expect("JSON");
        assert_eq!(manifest["Actions"].as_array().map(Vec::len), Some(5));
        assert_eq!(
            manifest["Actions"][2]["SourcePath"],
            "payload/minimap_1_0.ytd"
        );
        // Вторая текстура плитки осталась как была.
        let kept = entries_of(&world.path("out/payload/minimap_2_2.ytd"));
        let original = entries_of_tile(&world, "update/update.rpf", "minimap_2_2.ytd");
        let extra = |list: &[Entry]| {
            list.iter()
                .find(|entry| entry.name == "extra")
                .map(|entry| entry.payload.clone())
        };
        assert_eq!(extra(&kept), extra(&original));
    }

    #[test]
    fn texture_choice_by_name_then_by_loneliness() {
        let world = world_a();
        let image = world.put("a.dds", &dds_file(16, 16, 1, "DXT1", 11));
        let (response, code) = world.run(&["--tile", &format!("minimap_3_3.ytd={image}")]);
        assert_eq!(code, 0, "{response}");
        assert_eq!(first_tile(&response)["texture"], "weird_name");
        let (response, _) = world.run(&["--tile", &format!("minimap_6_6.ytd={image}")]);
        // Имена идут в порядке словаря (по хешу имени), а не по алфавиту.
        let stored: Vec<String> = entries_of_tile(&world, "update/update.rpf", "minimap_6_6.ytd")
            .into_iter()
            .map(|entry| entry.name)
            .collect();
        assert_eq!(
            refused(&response),
            data(&format!(
                "В плитке minimap_6_6.ytd нет текстуры minimap_6_6: {}",
                stored.join(", ")
            ))
        );
    }

    #[test]
    fn same_names_in_different_case_make_one_tile() {
        let world = world_a();
        let first = world.put("first.dds", &dds_file(16, 16, 1, "DXT1", 21));
        let last = world.put("last.dds", &dds_file(16, 16, 1, "DXT1", 22));
        let (response, code) = world.run(&[
            "--tile",
            &format!("Minimap_0_0.YTD={first}"),
            "--tile",
            &format!("minimap_0_0.ytd={last}"),
        ]);
        assert_eq!(code, 0, "{response}");
        let tiles = response["result"]["map"]["tiles"]
            .as_array()
            .expect("массив");
        assert_eq!(tiles.len(), 1);
        assert_eq!(tiles[0]["file"], "Minimap_0_0.YTD");
        let after = entries_of(&world.path("out/payload/Minimap_0_0.YTD"));
        assert_eq!(after[0].payload, dds_file(16, 16, 1, "DXT1", 22)[128..]);
    }

    #[test]
    fn tile_argument_rules() {
        let world = world_a();
        let image = world.put("a.dds", &dds_file(16, 16, 1, "DXT1", 31));
        let usage = data("Плитка задаётся как имя=путь к DDS.");
        for value in [format!("={image}"), "minimap_0_0.ytd".to_owned()] {
            assert_eq!(refused(&world.run(&["--tile", &value]).0), usage, "{value}");
        }
        for name in ["a/b.ytd", ".", "..", " ", "x\\y"] {
            let (response, _) = world.run(&["--tile", &format!("{name}={image}")]);
            assert_eq!(
                refused(&response),
                data(&format!("Недопустимое имя плитки: {}", name.trim())),
                "{name:?}"
            );
        }
        // Путь DDS проверяется раньше имени.
        let (response, _) = world.run(&["--tile", "a/b.ytd=nothing.dds"]);
        assert_eq!(refused(&response).0, "FileNotFoundException");
        let text = world.put("a.txt", b"x");
        let (response, _) = world.run(&["--tile", &format!("minimap_0_0.ytd={text}")]);
        assert_eq!(
            refused(&response),
            (
                "ArgumentException".to_owned(),
                "Unsupported file extension: .txt".to_owned()
            )
        );
        let (response, _) = world.run(&["--tile", "minimap_0_0.ytd="]);
        assert_eq!(refused(&response).1, "The path is empty.");
        // Пробелы вокруг имени и пути обрезаются, `=` в пути допустим.
        let odd = world.put("we=ird.dds", &dds_file(16, 16, 1, "DXT1", 32));
        let (response, code) = world.run(&["--tile", &format!("  minimap_0_0.ytd  =  {odd}  ")]);
        assert_eq!(code, 0, "{response}");
        // Без плиток и с лишними плитками.
        let (response, _) = world.run(&[]);
        assert_eq!(
            refused(&response),
            data("Не передано ни одной плитки для замены.")
        );
        let mut many = Vec::new();
        for i in 0..65 {
            many.push("--tile".to_owned());
            many.push(format!("t{i}.ytd={image}"));
        }
        let refs: Vec<&str> = many.iter().map(String::as_str).collect();
        assert_eq!(
            refused(&world.run(&refs).0),
            data("Слишком много плиток в одном патче.")
        );
    }

    #[test]
    fn per_tile_failures_and_what_is_left_behind() {
        let world = world_a();
        let good = world.put("a.dds", &dds_file(16, 16, 1, "DXT1", 41));
        let missing = |name: &str| format!("Плитка {name} не найдена в архивах игры.");
        let (response, _) = world.run(&["--tile", &format!("minimap_9_9.ytd={good}")]);
        assert_eq!(
            refused(&response),
            (
                "FileNotFoundException".to_owned(),
                missing("minimap_9_9.ytd")
            )
        );
        // Имя без `.ytd` допустимо и просто не находится.
        let (response, _) = world.run(&["--tile", &format!("minimap_0_0={good}")]);
        assert_eq!(refused(&response).1, missing("minimap_0_0"));
        // Пустой DDS у ненайденной плитки: отказ по плитке; у найденной — по DDS.
        let empty = world.put("empty.dds", b"");
        let (response, _) = world.run(&["--tile", &format!("minimap_9_9.ytd={empty}")]);
        assert_eq!(refused(&response).1, missing("minimap_9_9.ytd"));
        let (response, _) = world.run(&["--tile", &format!("minimap_0_0.ytd={empty}")]);
        assert_eq!(
            refused(&response),
            data("Некорректный DDS для плитки minimap_0_0.ytd.")
        );
        // Мусор вместо DDS и DX10-заголовок (BC7 и прочее уходит хосту).
        let junk = world.put("junk.dds", &noise(9, 300));
        let host_text = "DDS плитки minimap_0_0.ytd движок не разбирает: пока на хосте.";
        let (response, _) = world.run(&["--tile", &format!("minimap_0_0.ytd={junk}")]);
        assert_eq!(
            refused(&response),
            ("ArgumentException".to_owned(), host_text.to_owned())
        );
        let mut dx10 = dds_file(16, 16, 1, "DXT1", 42);
        dx10[84..88].copy_from_slice(b"DX10");
        let dx10 = world.put("dx10.dds", &dx10);
        let (response, _) = world.run(&["--tile", &format!("minimap_0_0.ytd={dx10}")]);
        assert_eq!(refused(&response).1, host_text);
        // Первая плитка годится, вторая не найдена: ничего не записано.
        let (response, _) = world.run(&[
            "--tile",
            &format!("minimap_0_0.ytd={good}"),
            "--tile",
            &format!("minimap_9_9.ytd={good}"),
        ]);
        assert_eq!(refused(&response).1, missing("minimap_9_9.ytd"));
        // Пустая папка патча, созданная отказавшей командой, убрана (раньше оставалась).
        assert!(!world.path("out").exists());
    }

    #[test]
    fn unreadable_tile_dictionary_goes_to_the_host() {
        let world = World::new();
        let broken = dir(
            "",
            vec![],
            vec![resource_file(
                "minimap_0_0.ytd",
                vec![
                    0x52, 0x53, 0x43, 0x37, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3,
                ],
            )],
        );
        world.archive("x64a.rpf", &broken);
        let image = world.put("a.dds", &dds_file(16, 16, 1, "DXT1", 1));
        let (response, _) = world.run(&["--tile", &format!("minimap_0_0.ytd={image}")]);
        assert_eq!(
            refused(&response),
            (
                "ArgumentException".to_owned(),
                "Плитка minimap_0_0.ytd движок не читает: пока на хосте.".to_owned()
            )
        );
    }

    #[test]
    fn game_keys_and_base_archive_rules() {
        let world = world_a();
        let image = world.put("a.dds", &dds_file(16, 16, 1, "DXT1", 71));
        let tile = format!("minimap_0_0.ytd={image}");
        let game = world.game().display().to_string();
        let output = world.path("out").display().to_string();
        let keys = world.path("keys").display().to_string();
        let (response, _) = run_args(&["build-map-patch"]);
        assert_eq!(refused(&response).1, "--game-root is required.");
        let (response, _) = run_args(&["build-map-patch", "--game-root", "  "]);
        assert_eq!(refused(&response).1, "The path is empty.");
        let notgame = world.path("nothing").display().to_string();
        let (response, _) = run_args(&[
            "build-map-patch",
            "--game-root",
            &notgame,
            "--output",
            &output,
        ]);
        assert_eq!(
            refused(&response),
            (
                "DirectoryNotFoundException".to_owned(),
                "The selected directory is not a GTA V installation.".to_owned()
            )
        );
        let (response, _) = run_args(&["build-map-patch", "--game-root", &game]);
        assert_eq!(refused(&response).1, "--output is required.");
        // Ключи: нет файла, неверная длина.
        let bare = world.path("nokeys").display().to_string();
        let (response, _) = run_args(&[
            "build-map-patch",
            "--game-root",
            &game,
            "--output",
            &output,
            "--keys",
            &bare,
            "--tile",
            &tile,
        ]);
        assert_eq!(refused(&response).0, "InvalidOperationException");
        assert!(refused(&response)
            .1
            .starts_with("The GTA V RPF key file gtav_aes_key.dat could not be read from"));
        fs::create_dir_all(world.path("short")).expect("папка");
        for name in [
            "gtav_aes_key.dat",
            "gtav_ng_key.dat",
            "gtav_ng_decrypt_tables.dat",
            "gtav_hash_lut.dat",
        ] {
            fs::write(world.path(&format!("short/{name}")), b"x").expect("запись");
        }
        let short = world.path("short").display().to_string();
        let (response, _) = run_args(&[
            "build-map-patch",
            "--game-root",
            &game,
            "--output",
            &output,
            "--keys",
            &short,
            "--tile",
            &tile,
        ]);
        assert_eq!(
            refused(&response),
            (
                "InvalidOperationException".to_owned(),
                "The GTA V RPF key set is incomplete.".to_owned()
            )
        );
        // Папка патча была создана раньше проверки ключей, но отказ её убрал (раньше она оставалась пустой).
        assert!(!Path::new(&output).exists());
        // Базовая копия: расширение и существование.
        let base_txt = world.put("base.txt", b"x");
        let (response, _) = run_args(&[
            "build-map-patch",
            "--game-root",
            &game,
            "--output",
            &output,
            "--keys",
            &keys,
            "--tile",
            &tile,
            "--base-archive",
            &base_txt,
        ]);
        assert_eq!(
            refused(&response),
            (
                "ArgumentException".to_owned(),
                "Unsupported file extension: .txt".to_owned()
            )
        );
        let absent = world.path("none.rpf").display().to_string();
        let (response, _) = run_args(&[
            "build-map-patch",
            "--game-root",
            &game,
            "--output",
            &output,
            "--keys",
            &keys,
            "--tile",
            &tile,
            "--base-archive",
            &absent,
        ]);
        assert_eq!(
            refused(&response),
            (
                "FileNotFoundException".to_owned(),
                format!("File was not found: {absent}")
            )
        );
    }

    #[test]
    fn base_archive_replaces_the_update_archive() {
        let world = world_a();
        let levels = dir(
            "levels",
            vec![],
            vec![resource_file(
                "minimap_2_2.ytd",
                ytd(&[("minimap_2_2", 16, 16, "DXT1", 1, 77)]),
            )],
        );
        let base = dir("", vec![dir("x64", vec![levels], vec![])], vec![]);
        let base_path = world.path("base.rpf");
        world.archive_at(&base_path, &base);
        let image = world.put("a.dds", &dds_file(16, 16, 1, "DXT1", 78));
        let base_text = base_path.display().to_string();
        let (response, code) = world.run(&[
            "--tile",
            &format!("minimap_2_2.ytd={image}"),
            "--base-archive",
            &base_text,
        ]);
        assert_eq!(code, 0, "{response}");
        assert_eq!(response["result"]["baseArchive"], base_text);
        assert_eq!(first_tile(&response)["textures"], 1);
        assert_eq!(first_tile(&response)["archive"], "update/update.rpf");
    }

    #[test]
    fn virtual_paths_follow_the_archive_name() {
        let tile = |archive: &str| Rebuilt {
            file: "a.ytd".to_owned(),
            archive: archive.to_owned(),
            entry: "dir/a.ytd".to_owned(),
            textures: 1,
            texture: "a".to_owned(),
            width: 1,
            height: 1,
            format: "DXT1",
            bytes: Vec::new(),
        };
        assert_eq!(tile("update/update.rpf").target(), "update:/dir/a.ytd");
        assert_eq!(tile("UPDATE\\Update.RPF").target(), "update:/dir/a.ytd");
        assert_eq!(
            tile("mods/update/update.rpf").target(),
            "mods/update/update:/dir/a.ytd"
        );
        assert_eq!(tile("x64e.rpf").target(), "x64e:/dir/a.ytd");
        assert_eq!(tile("odd.bin").target(), "odd.bin:/dir/a.ytd");
    }

    /// Файлы патча ложатся через черновик рядом: имя черновика занято папкой - запись
    /// отказывает, прежний файл цел. Прямая запись молча перезаписала бы его.
    #[test]
    fn patch_files_are_staged_beside_their_names() {
        let dir = tempfile::tempdir().unwrap();
        let patch = dir.path();
        let tile = Rebuilt {
            file: "t1.ytd".to_owned(),
            archive: "x64a.rpf".to_owned(),
            entry: "dir/t1.ytd".to_owned(),
            textures: 1,
            texture: "t1".to_owned(),
            width: 4,
            height: 4,
            format: "DXT1",
            bytes: b"new tile".to_vec(),
        };
        std::fs::create_dir_all(patch.join("payload")).unwrap();
        std::fs::write(patch.join("payload/t1.ytd"), b"old tile").unwrap();
        std::fs::create_dir(patch.join("payload/t1.ytd.shop-stage")).unwrap();
        let error = store(patch, std::slice::from_ref(&tile), 8).unwrap_err();
        assert_eq!(error.code, "UnauthorizedAccessException");
        assert_eq!(
            std::fs::read(patch.join("payload/t1.ytd")).unwrap(),
            b"old tile"
        );
        assert!(!patch.join("manifest.json").exists());

        std::fs::remove_dir(patch.join("payload/t1.ytd.shop-stage")).unwrap();
        std::fs::write(patch.join("manifest.json"), b"old manifest").unwrap();
        std::fs::create_dir(patch.join("manifest.json.shop-stage")).unwrap();
        let error = store(patch, std::slice::from_ref(&tile), 8).unwrap_err();
        assert_eq!(error.code, "UnauthorizedAccessException");
        assert_eq!(
            std::fs::read(patch.join("payload/t1.ytd")).unwrap(),
            b"new tile"
        );
        assert_eq!(
            std::fs::read(patch.join("manifest.json")).unwrap(),
            b"old manifest"
        );

        std::fs::remove_dir(patch.join("manifest.json.shop-stage")).unwrap();
        store(patch, std::slice::from_ref(&tile), 8).unwrap();
        assert!(std::fs::read(patch.join("manifest.json"))
            .unwrap()
            .starts_with(b"{"));
        assert!(!patch.join("payload/t1.ytd.shop-stage").exists());
    }
}
