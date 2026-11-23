//! Команда `probe-rpf`: подойдут ли операции запроса архиву-основе, без записи.

use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use rage_rpf::{Archive, EntryId};
use serde_json::Value;

use super::{
    compose::{normalize_entry, Action},
    load_keys,
};
use crate::{
    args::Options,
    error::{EngineError, Result},
    paths::{existing_file, full_path},
    progress::Progress,
};

/// Расширения, которые годятся архиву-основе.
const BASE_EXTENSIONS: &[&str] = &[".rpf"];

/// Есть ли запись по пути из звеньев, считая от каталога `directory`.
pub fn exists(archive: &Archive, directory: EntryId, segments: &[String]) -> Result<bool> {
    Trail::new(archive).lookup(segments, directory)
}

/// Отказывает ли проверка для вида операции и признака «запись есть».
pub fn refused(kind: Action, present: bool) -> bool {
    matches!(
        (kind, present),
        (Action::Import, true) | (Action::Replace | Action::Delete, false)
    )
}

/// Больше операций в одном запросе не бывает.
const OPERATION_CAP: usize = 100_000;

pub fn probe_rpf(options: &Options, progress: &Progress) -> Result<Value> {
    let request: Request = Request::try_from(options)?;
    let operations = request.operations()?;
    let base = request.base()?;
    let total = base.size.max(1);
    let archive = base.open(options, |done| {
        progress.report_bytes("read", done, total);
    })?;

    let checked = operations
        .iter()
        .map(|operation| operation.check(&archive))
        .collect::<Result<Vec<Value>>>()?;

    Ok(record([
        ("status", "ready".into()),
        ("mode", "read-only".into()),
        ("bytes", base.size.into()),
        ("checkedOperations", checked.len().into()),
        ("operations", checked.into()),
    ]))
}

/// Тело запроса: объект JSON из файла, который назван в `--request`.
struct Request(Value);

impl TryFrom<&Options> for Request {
    type Error = EngineError;

    fn try_from(options: &Options) -> Result<Self> {
        let named = options.required("request")?;
        let text = fs::read_to_string(full_path(named)?)?;
        let body = text
            .trim_start_matches('\u{feff}')
            .parse::<Value>()
            .or(Err(EngineError::invalid_data("RPF request is not JSON.")))?;
        if body.is_object() {
            Ok(Self(body))
        } else {
            Err(EngineError::invalid_data("RPF request is not an object."))
        }
    }
}

impl Request {
    /// Форма и действие всех операций проверяются сразу, по порядку списка.
    fn operations(&self) -> Result<Vec<Operation>> {
        let items: &[Value] = match self.0.get("operations") {
            Some(Value::Array(items)) => items,
            _ => &[],
        };
        match items.len() {
            0..=OPERATION_CAP => items.iter().map(Operation::try_from).collect(),
            _ => Err(EngineError::invalid_data("RPF operation limit exceeded.")),
        }
    }

    /// Файл архива-основы из `baseArchive`.
    fn base(&self) -> Result<Base> {
        match self.0["baseArchive"].as_str() {
            Some(given) => {
                let path = existing_file(given, BASE_EXTENSIONS)?;
                Ok(Base {
                    size: path.metadata()?.len(),
                    path,
                })
            }
            None => Err(EngineError::argument("RPF base archive is required.")),
        }
    }
}

/// Одна операция запроса: путь как в запросе и действие.
struct Operation {
    entry: String,
    kind: Action,
}

impl TryFrom<&Value> for Operation {
    type Error = EngineError;

    fn try_from(item: &Value) -> Result<Self> {
        match item {
            Value::Object(fields) => {
                let text = |key: &str| fields.get(key).and_then(Value::as_str);
                Ok(Self {
                    entry: text("entry").unwrap_or_default().to_owned(),
                    kind: Action::parse(text("action"))?,
                })
            }
            _ => Err(EngineError::invalid_data("RPF operation is not an object.")),
        }
    }
}

impl Operation {
    /// Сверка с архивом; в ответ идёт строка про эту операцию.
    fn check(&self, archive: &Archive) -> Result<Value> {
        normalize_entry(&self.entry, !matches!(self.kind, Action::Delete))
            .and_then(|links| exists(archive, archive.root(), &links))
            .and_then(|present| self.verdict(present))
    }

    /// Ответ об операции, если запись `present` ей подходит, иначе отказ.
    fn verdict(&self, present: bool) -> Result<Value> {
        if !refused(self.kind, present) {
            return Ok(record([
                ("entry", self.entry.replace('\\', "/").into()),
                ("action", word(self.kind).into()),
                ("exists", present.into()),
            ]));
        }
        let message = format!("RPF preflight failed: {}", self.entry);
        Err(EngineError::invalid_data(message))
    }
}

/// Архив-основа запроса: файл на диске и его размер.
struct Base {
    path: PathBuf,
    size: u64,
}

impl Base {
    /// Открывает архив; `report` получает ход чтения в байтах.
    fn open(&self, options: &Options, report: impl Fn(u64)) -> Result<Archive> {
        report(0);
        let (keys, _) = load_keys(
            options.optional("game-root").unwrap_or_default(),
            options.optional("keys"),
        )?;
        let archive = Archive::open_path(&self.path, keys.into())?;
        report(self.size.max(1));
        Ok(archive)
    }
}

/// Слово действия, как оно стоит в ответе.
fn word(kind: Action) -> &'static str {
    match kind {
        Action::Replace => "replace",
        Action::Import => "import",
        Action::Upsert => "upsert",
        Action::Delete => "delete",
    }
}

/// Раскрытые по дороге контейнеры: пока их нет, поиск идёт в самом архиве.
struct Trail<'a> {
    outer: &'a Archive,
    opened: Vec<Arc<Archive>>,
}

impl<'a> Trail<'a> {
    fn new(outer: &'a Archive) -> Self {
        Self {
            outer,
            opened: Vec::new(),
        }
    }

    /// Архив, в котором сейчас идёт поиск.
    fn here(&self) -> &Archive {
        self.opened.last().map_or(self.outer, |inner| &**inner)
    }

    /// Идёт по звеньям `segments` от каталога `dir`; последнее звено — файл.
    fn lookup(&mut self, segments: &[String], mut dir: EntryId) -> Result<bool> {
        let (route, leaf) = match segments {
            [route @ .., leaf] => (route, leaf),
            [] => return Ok(false),
        };
        for name in route {
            match self.step(dir, name)? {
                Some(next) => dir = next,
                None => return Ok(false),
            }
        }
        let found = self.here().find_file(dir, leaf);
        Ok(found.is_some())
    }

    /// Шаг вниз по звену `name` от каталога `dir`: в подкаталог либо в корень
    /// раскрытого контейнера. `None` — такого звена нет.
    fn step(&mut self, dir: EntryId, name: &str) -> Result<Option<EntryId>> {
        if Archive::is_nested_archive_name(name) {
            self.dive(dir, name)
        } else {
            Ok(self.here().find_dir(dir, name))
        }
    }

    /// Раскрывает контейнер `name`; запись, не являющаяся двоичным файлом,
    /// контейнером не считается.
    fn dive(&mut self, dir: EntryId, name: &str) -> Result<Option<EntryId>> {
        let here = self.here();
        let found = here.find_file(dir, name);
        match found.map(|id| (id, &here.entry(id).kind)) {
            Some((container, rage_rpf::EntryKind::Binary(_))) => {
                // разобранный контейнер берётся из памяти внешнего архива: следующая
                // операция с тем же путём оглавление заново не читает
                let inner = here.open_nested_shared(container)?;
                let root = inner.root();
                self.opened.push(inner);
                Ok(Some(root))
            }
            _ => Ok(None),
        }
    }
}

/// Объект JSON с ключами в заданном порядке.
fn record<'k>(fields: impl IntoIterator<Item = (&'k str, Value)>) -> Value {
    let pairs = fields
        .into_iter()
        .map(|(key, value)| (key.to_owned(), value));
    Value::Object(pairs.collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::archives::KEYS_ENV;
    use rage_rpf::fixtures::{noise, resource, text, update_tree};
    use rage_rpf::{write_archive, Body, Compress, Data, DirNode, FileNode, WriteContext};
    use serde_json::json;
    use std::fs::File;
    use std::path::{Path, PathBuf};
    use std::sync::{Arc, Mutex};
    use tempfile::{tempdir, TempDir};

    fn memory_file(name: &str, bytes: Vec<u8>) -> FileNode {
        FileNode {
            name: name.into(),
            body: Body::Binary {
                data: Data::memory(bytes),
                compress: Compress::Auto,
            },
        }
    }

    fn pack(name: &str, inner: DirNode) -> FileNode {
        FileNode {
            name: name.into(),
            body: Body::Nested(Box::new(inner)),
        }
    }

    fn write_tree(tree: &DirNode, path: &Path) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut file = File::create(path).unwrap();
        let mut context = WriteContext {
            staging: path.parent().unwrap(),
            keys: None,
            finalizer: None,
        };
        write_archive(tree, &mut file, &mut context, &mut |_| {}).unwrap();
    }

    /// Архив с негодными контейнерами (`x64`) из примеров описания.
    fn badnested_tree() -> DirNode {
        let mut x64 = DirNode::new("x64");
        x64.files.push(memory_file("bad.rpf", noise(3000, 4)));
        x64.files.push(memory_file("SHORT.RPF", noise(10, 5)));
        let mut inner = DirNode::new("");
        inner.files.push(memory_file("in.xml", text(900, "in")));
        x64.files.push(pack("plain.rpf", inner.clone()));
        x64.files.push(pack("packed.rpf", inner));
        x64.files.push(FileNode {
            name: "res.rpf".into(),
            body: Body::Resource {
                data: Data::memory(resource(1, 2, &noise(300, 6))),
            },
        });
        let mut root = DirNode::new("");
        root.dirs.push(x64);
        root
    }

    fn containers_tree() -> DirNode {
        let mut folder = DirNode::new("Folder");
        folder.files.push(memory_file("Deep.txt", text(66, "d")));
        let mut inner = DirNode::new("");
        inner.files.push(memory_file("Inside.TXT", text(55, "i")));
        inner.dirs.push(folder);
        let mut mods = DirNode::new("Mods");
        mods.files.push(pack("Pack.RPF", inner));
        let mut root = DirNode::new("");
        root.files.push(memory_file("Root.txt", text(10, "r")));
        root.dirs.push(mods);
        root
    }

    struct Lab {
        dir: TempDir,
    }

    impl Lab {
        fn new() -> Lab {
            let dir = tempdir().unwrap();
            let keys = dir.path().join("keys");
            fs::create_dir_all(&keys).unwrap();
            for (name, len) in [
                ("gtav_aes_key.dat", 32),
                ("gtav_ng_key.dat", 101 * 68 * 4),
                ("gtav_ng_decrypt_tables.dat", 17 * 4096 * 4),
                ("gtav_hash_lut.dat", 256),
            ] {
                fs::write(keys.join(name), vec![5u8; len]).unwrap();
            }
            Lab { dir }
        }

        fn at(&self, tail: &str) -> PathBuf {
            self.dir.path().join(tail)
        }

        fn archive(&self, name: &str, tree: &DirNode) -> String {
            let path = self.at("arch").join(name);
            write_tree(tree, &path);
            path.display().to_string()
        }

        fn open(&self, name: &str, tree: &DirNode) -> Archive {
            let path = self.archive(name, tree);
            Archive::open_path(Path::new(&path), None).unwrap()
        }

        /// Запуск с текстом запроса; возвращает ответ и строки хода.
        fn run(&self, body: &[u8], extra: &[&str]) -> (Result<Value>, Vec<String>) {
            let request = self
                .at("req")
                .join(format!("{}.json", crate::archives::random_hex(8)));
            fs::create_dir_all(request.parent().unwrap()).unwrap();
            fs::write(&request, body).unwrap();
            let mut args = vec!["--request".to_owned(), request.display().to_string()];
            args.extend(extra.iter().map(|arg| (*arg).to_owned()));
            let lines = Arc::new(Mutex::new(Vec::new()));
            let sink = Arc::clone(&lines);
            let progress =
                Progress::with_sink(move |line| sink.lock().unwrap().push(line.to_owned()));
            let result = probe_rpf(&Options::parse(&args).unwrap(), &progress);
            let seen = lines.lock().unwrap().clone();
            (result, seen)
        }

        fn probe(&self, request: &Value) -> (Result<Value>, Vec<String>) {
            let keys = self.at("keys").display().to_string();
            self.run(request.to_string().as_bytes(), &["--keys", &keys])
        }
    }

    fn failure<T>(result: Result<T>) -> (String, String) {
        match result {
            Err(error) => (error.code, error.message),
            Ok(_) => panic!("ожидался отказ"),
        }
    }

    fn refusal(code: &str, message: &str) -> (String, String) {
        (code.to_owned(), message.to_owned())
    }

    fn progress_line(done: u64, total: u64) -> String {
        format!(
            "{{\"progress\":{{\"phase\":\"read\",\"copiedBytes\":{done},\"totalBytes\":{total}}}}}"
        )
    }

    fn operations_of(answer: &Value) -> Vec<(String, String, bool)> {
        answer["operations"]
            .as_array()
            .unwrap()
            .iter()
            .map(|op| {
                (
                    op["entry"].as_str().unwrap().to_owned(),
                    op["action"].as_str().unwrap().to_owned(),
                    op["exists"].as_bool().unwrap(),
                )
            })
            .collect()
    }

    // ----- refused, exists -----

    #[test]
    fn refusal_table() {
        let rows = [
            (Action::Import, false, false),
            (Action::Import, true, true),
            (Action::Upsert, false, false),
            (Action::Upsert, true, false),
            (Action::Replace, false, true),
            (Action::Replace, true, false),
            (Action::Delete, false, true),
            (Action::Delete, true, false),
        ];
        for (kind, present, expected) in rows {
            assert_eq!(refused(kind, present), expected, "{kind:?} {present}");
        }
    }

    fn segs(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|part| (*part).to_owned()).collect()
    }

    #[test]
    fn existence_follows_files_directories_and_containers() {
        let lab = Lab::new();
        let update = lab.open("update.rpf", &update_tree(None));
        let probe = |parts: &[&str]| exists(&update, update.root(), &segs(parts)).unwrap();
        let cd = ["x64", "data", "cdimages"];
        let with = |tail: &[&str]| -> Vec<String> {
            cd.iter()
                .chain(tail.iter())
                .map(|part| (*part).to_owned())
                .collect()
        };
        let deep = |tail: &[&str]| exists(&update, update.root(), &with(tail)).unwrap();
        assert!(!probe(&[]));
        assert!(probe(&["content.xml"]));
        assert!(probe(&["CONTENT.XML"]));
        assert!(probe(&["setup2.xml"]));
        assert!(!probe(&["nope.xml"]));
        assert!(!probe(&["common"]));
        assert!(!probe(&["common", "data"]));
        assert!(probe(&["common", "data", "a.xml"]));
        assert!(probe(&["COMMON", "DATA", "A.XML"]));
        assert!(!probe(&["common", "a.xml"]));
        assert!(!probe(&["common", "data", "a.xml", "deeper"]));
        assert!(deep(&["scaleform_generic.rpf"]));
        assert!(deep(&["scaleform_generic.rpf", "hud.gfx"]));
        assert!(deep(&["scaleform_generic.rpf", "inner", "deep.xml"]));
        assert!(!deep(&["scaleform_generic.rpf", "inner"]));
        assert!(deep(&["scaleform_generic.rpf", "tex.ytd"]));
        assert!(!deep(&["scaleform_generic.rpf", "nothere"]));
        assert!(deep(&["SCALEFORM_GENERIC.RPF", "hud.gfx"]));
        assert!(deep(&["Scaleform_Generic.Rpf", "INNER", "DEEP.XML"]));
        assert!(!deep(&["SCALEFORM_GENERIC.RPF", "nothere"]));
        assert!(deep(&["SCALEFORM_GENERIC.RPF"]));
        assert!(deep(&["scaleform_other.rpf", "keep.xml"]));
        assert!(!deep(&["missing.rpf", "keep.xml"]));
        assert!(!deep(&["missing.rpf"]));
        assert!(!probe(&[""]));
        assert!(!probe(&["common", ""]));
        assert!(!probe(&["common", "data", ""]));
        assert!(!probe(&["nope", "common", "data", "a.xml"]));
    }

    #[test]
    fn existence_inside_damaged_and_unusual_containers() {
        let lab = Lab::new();
        let bad = lab.open("badnested.rpf", &badnested_tree());
        let ask = |parts: &[&str]| exists(&bad, bad.root(), &segs(parts));
        assert!(ask(&["x64", "bad.rpf"]).unwrap());
        let (code, message) = failure(ask(&["x64", "bad.rpf", "anything.xml"]));
        assert_eq!(code, "InvalidDataException");
        assert!(message.starts_with("bad.rpf: The identifier "));
        assert_eq!(
            failure(ask(&["x64", "SHORT.RPF", "anything.xml"])),
            refusal(
                "InvalidDataException",
                "SHORT.RPF: the file is too short to be an RPF7 archive"
            )
        );
        assert_eq!(
            failure(ask(&["x64", "short.rpf", "anything.xml"])),
            refusal(
                "InvalidDataException",
                "SHORT.RPF: the file is too short to be an RPF7 archive"
            )
        );
        assert!(!ask(&["x64", "res.rpf", "anything.xml"]).unwrap());
        assert!(ask(&["x64", "res.rpf"]).unwrap());
        assert!(ask(&["x64", "plain.rpf", "in.xml"]).unwrap());
        assert!(ask(&["x64", "packed.rpf", "in.xml"]).unwrap());

        let boxed = lab.open("containers.rpf", &containers_tree());
        let ask = |parts: &[&str]| exists(&boxed, boxed.root(), &segs(parts)).unwrap();
        assert!(ask(&["mods", "pack.rpf", "inside.txt"]));
        assert!(ask(&["Mods", "Pack.RPF", "Inside.TXT"]));
        assert!(ask(&["Mods", "Pack.RPF", "Folder", "Deep.txt"]));
        assert!(ask(&["Mods", "Pack.RPF", "FOLDER", "DEEP.TXT"]));
        assert!(ask(&["MODS", "pack.rpf", "folder", "deep.txt"]));
    }

    // ----- запрос и порядок отказов -----

    #[test]
    fn empty_and_default_requests_are_ready() {
        let lab = Lab::new();
        let arch = lab.archive("update.rpf", &update_tree(None));
        let size = fs::metadata(&arch).unwrap().len();
        let expect = json!({"status": "ready", "mode": "read-only", "bytes": size, "checkedOperations": 0, "operations": []});
        for request in [
            json!({"baseArchive": arch, "operations": []}),
            json!({"baseArchive": arch}),
            json!({"baseArchive": arch, "operations": "nope"}),
        ] {
            let (answer, lines) = lab.probe(&request);
            assert_eq!(answer.unwrap(), expect);
            assert_eq!(lines, [progress_line(0, size), progress_line(size, size)]);
        }
        let keys: Vec<String> = expect.as_object().unwrap().keys().cloned().collect();
        assert_eq!(
            keys,
            ["status", "mode", "bytes", "checkedOperations", "operations"]
        );
    }

    #[test]
    fn operations_are_checked_in_order_with_words_normalised() {
        let lab = Lab::new();
        let arch = lab.archive("update.rpf", &update_tree(None));
        let request = json!({"baseArchive": arch, "operations": [
            {"entry": "common/data/new.xml", "action": "import"},
            {"entry": "common/data/a.xml", "action": "upsert"},
            {"entry": "common/data/zz.xml", "action": "UPSERT"},
            {"entry": "common/data/old.xml", "action": " Delete "},
            {"entry": "Common\\Data\\B.DAT", "action": "replace"},
            {"entry": "common/data/a.xml"},
            {"entry": "common/data/a.xml", "action": 5},
            {"entry": "  common/data/a.xml  ", "action": "replace"},
            {"entry": "common", "action": "import"},
        ]});
        let (answer, _) = lab.probe(&request);
        let answer = answer.unwrap();
        assert_eq!(answer["checkedOperations"], 9);
        assert_eq!(
            operations_of(&answer),
            [
                ("common/data/new.xml", "import", false),
                ("common/data/a.xml", "upsert", true),
                ("common/data/zz.xml", "upsert", false),
                ("common/data/old.xml", "delete", true),
                ("Common/Data/B.DAT", "replace", true),
                ("common/data/a.xml", "replace", true),
                ("common/data/a.xml", "replace", true),
                ("  common/data/a.xml  ", "replace", true),
                ("common", "import", false),
            ]
            .map(|(entry, action, present)| (
                entry.to_owned(),
                action.to_owned(),
                present
            ))
        );
    }

    #[test]
    fn a_bad_operation_stops_the_check_with_the_entry_as_written() {
        let lab = Lab::new();
        let arch = lab.archive("update.rpf", &update_tree(None));
        let size = fs::metadata(&arch).unwrap().len();
        let failing = |entry: &str, action: &str| {
            let (answer, lines) = lab.probe(
                &json!({"baseArchive": arch, "operations": [{"entry": entry, "action": action}]}),
            );
            assert_eq!(
                lines,
                [progress_line(0, size), progress_line(size, size)],
                "{entry} {action}"
            );
            failure(answer)
        };
        let preflight = |entry: &str| {
            refusal(
                "InvalidDataException",
                &format!("RPF preflight failed: {entry}"),
            )
        };
        assert_eq!(
            failing("common/data/a.xml", "import"),
            preflight("common/data/a.xml")
        );
        assert_eq!(
            failing("common/data/nothere.xml", "replace"),
            preflight("common/data/nothere.xml")
        );
        assert_eq!(
            failing("common/data/nothere.xml", "delete"),
            preflight("common/data/nothere.xml")
        );
        assert_eq!(failing("common", "replace"), preflight("common"));
        assert_eq!(failing("common/data", "delete"), preflight("common/data"));
        assert_eq!(
            failing("Common\\Data\\Nope.XML ", "replace"),
            preflight("Common\\Data\\Nope.XML ")
        );
        assert_eq!(
            failing("../x", "import"),
            refusal("InvalidDataException", "Unsafe RPF entry path.")
        );
        assert_eq!(
            failing("", "upsert"),
            refusal("InvalidDataException", "Invalid RPF entry path.")
        );
        let pack = "x64/data/cdimages/scaleform_generic.rpf";
        assert_eq!(failing(pack, "import"), preflight(pack));
        assert_eq!(
            failing(pack, "delete"),
            refusal(
                "InvalidDataException",
                "RPF entry must point to a file inside the archive."
            )
        );
        assert_eq!(
            failing("x64/data/cdimages/missing.rpf/a.xml", "replace"),
            preflight("x64/data/cdimages/missing.rpf/a.xml")
        );
        assert_eq!(
            failing("x64/data/cdimages/missing.rpf/a.xml", "delete"),
            preflight("x64/data/cdimages/missing.rpf/a.xml")
        );
        let (second, _) = lab.probe(&json!({"baseArchive": arch, "operations": [
            {"entry": "common/data/a.xml", "action": null}, {"entry": 5}]}));
        assert_eq!(
            failure(second),
            refusal("InvalidDataException", "Invalid RPF entry path.")
        );
        let (missing_entry, _) =
            lab.probe(&json!({"baseArchive": arch, "operations": [{"action": "import"}]}));
        assert_eq!(
            failure(missing_entry),
            refusal("InvalidDataException", "Invalid RPF entry path.")
        );
    }

    #[test]
    fn containers_inside_the_archive_and_around_it() {
        let lab = Lab::new();
        let update = lab.archive("update.rpf", &update_tree(None));
        let ok = |request: Value| {
            let (answer, _) = lab.probe(&request);
            operations_of(&answer.unwrap())
        };
        let nested = ok(json!({"baseArchive": update, "operations": [
            {"entry": "x64/data/cdimages/scaleform_generic.rpf/hud.gfx", "action": "replace"},
            {"entry": "x64/data/cdimages/scaleform_generic.rpf/inner/deep.xml", "action": "replace"},
            {"entry": "x64/data/cdimages/scaleform_generic.rpf/new.xml", "action": "import"},
            {"entry": "x64/data/cdimages/scaleform_generic.rpf/inner/new.xml", "action": "import"},
        ]}));
        assert_eq!(
            nested.iter().map(|op| op.2).collect::<Vec<_>>(),
            [true, true, false, false]
        );
        let whole = ok(json!({"baseArchive": update, "operations": [
            {"entry": "x64/data/cdimages/scaleform_generic.rpf", "action": "upsert"},
            {"entry": "x64/data/cdimages/newpack.rpf", "action": "import"},
            {"entry": "x64/data/cdimages/missing.rpf/a.xml", "action": "import"},
            {"entry": "Ünï/ñ.xml", "action": "import"},
        ]}));
        assert_eq!(
            whole.iter().map(|op| op.2).collect::<Vec<_>>(),
            [true, false, false, false]
        );
        assert_eq!(whole[3].0, "Ünï/ñ.xml");
        let replace_pack = ok(json!({"baseArchive": update, "operations": [
            {"entry": "x64/data/cdimages/scaleform_generic.rpf", "action": "replace"}]}));
        assert!(replace_pack[0].2);

        let bad = lab.archive("badnested.rpf", &badnested_tree());
        let bad_size = fs::metadata(&bad).unwrap().len();
        let (open_failure, lines) = lab.probe(&json!({"baseArchive": bad, "operations": [
            {"entry": "x64/bad.rpf/a.xml", "action": "import"}]}));
        let (code, message) = failure(open_failure);
        assert_eq!(code, "InvalidDataException");
        assert!(message.starts_with("bad.rpf: The identifier "));
        assert_eq!(lines.len(), 2);
        let (res_inside, _) = lab.probe(&json!({"baseArchive": bad, "operations": [
            {"entry": "x64/res.rpf/a.xml", "action": "import"},
            {"entry": "x64/res.rpf/a.xml", "action": "replace"}]}));
        assert_eq!(
            failure(res_inside),
            refusal(
                "InvalidDataException",
                "RPF preflight failed: x64/res.rpf/a.xml"
            )
        );
        let (as_leaf, lines) = lab.probe(&json!({"baseArchive": bad, "operations": [
            {"entry": "x64/res.rpf", "action": "replace"}, {"entry": "x64/bad.rpf", "action": "replace"}]}));
        assert_eq!(as_leaf.unwrap()["bytes"], bad_size);
        assert_eq!(lines[1], progress_line(bad_size, bad_size));

        let boxed = lab.archive("containers.rpf", &containers_tree());
        let (answer, _) = lab.probe(&json!({"baseArchive": boxed, "operations": [
            {"entry": "Mods/Pack.RPF/Inside.TXT", "action": "replace"},
            {"entry": "mods/pack.rpf/inside.txt", "action": "replace"},
            {"entry": "MODS/PACK.RPF/FOLDER/DEEP.TXT", "action": "delete"}]}));
        assert!(operations_of(&answer.unwrap()).iter().all(|op| op.2));
    }

    #[test]
    fn action_and_shape_errors_beat_everything_else() {
        let lab = Lab::new();
        let arch = lab.archive("update.rpf", &update_tree(None));
        let (answer, lines) = lab.probe(&json!({"baseArchive": arch, "operations": [
            {"entry": "common/data/a.xml", "action": "move"}]}));
        assert_eq!(
            failure(answer),
            refusal("InvalidDataException", "Unsupported RPF action: move")
        );
        assert!(lines.is_empty());
        let (answer, lines) = lab.probe(&json!({"baseArchive": arch, "operations": [
            {"entry": "common/data/a.xml", "action": "replace"}, {"entry": "../x", "action": "import"},
            {"entry": "nothere", "action": "move"}]}));
        assert_eq!(
            failure(answer),
            refusal("InvalidDataException", "Unsupported RPF action: move")
        );
        assert!(lines.is_empty());
        let (answer, _) = lab.probe(&json!({"operations": [{"entry": "a", "action": "move"}]}));
        assert_eq!(
            failure(answer),
            refusal("InvalidDataException", "Unsupported RPF action: move")
        );
        for bad in [json!("x"), json!(null), json!([])] {
            let (answer, lines) = lab.probe(&json!({"baseArchive": arch, "operations": [bad]}));
            assert_eq!(
                failure(answer),
                refusal("InvalidDataException", "RPF operation is not an object.")
            );
            assert!(lines.is_empty());
        }
        for request in [
            json!({"operations": [{"entry": "a"}]}),
            json!({"baseArchive": 5, "operations": []}),
            json!({"baseArchive": null, "operations": []}),
        ] {
            let (answer, _) = lab.probe(&request);
            assert_eq!(
                failure(answer),
                refusal("ArgumentException", "RPF base archive is required.")
            );
        }
    }

    #[test]
    fn request_text_problems() {
        let lab = Lab::new();
        let arch = lab.archive("update.rpf", &update_tree(None));
        let keys = lab.at("keys").display().to_string();
        let run = |body: &[u8]| lab.run(body, &["--keys", &keys]).0;
        for (body, message) in [
            (&b"not json"[..], "RPF request is not JSON."),
            (b"", "RPF request is not JSON."),
            (b"[1]", "RPF request is not an object."),
            (b"5", "RPF request is not an object."),
            (b"null", "RPF request is not an object."),
        ] {
            assert_eq!(failure(run(body)), refusal("InvalidDataException", message));
        }
        let ok = json!({"baseArchive": arch, "operations": []}).to_string();
        let with_bom = [&[0xEF, 0xBB, 0xBF][..], ok.as_bytes()].concat();
        assert_eq!(run(&with_bom).unwrap()["checkedOperations"], 0);
        let (code, message) = failure(run(&[b'{', 0xFF, 0xFE]));
        assert_eq!(
            (code.as_str(), message.as_str()),
            ("IOException", "stream did not contain valid UTF-8")
        );
        let no_request = Options::parse(&["--keys".to_owned(), keys.clone()]).unwrap();
        assert_eq!(
            failure(probe_rpf(&no_request, &Progress::silent())),
            refusal("ArgumentException", "--request is required.")
        );
    }

    #[test]
    fn archive_and_key_problems_are_reported_after_the_first_progress_line() {
        let lab = Lab::new();
        let arch = lab.archive("update.rpf", &update_tree(None));
        let size = fs::metadata(&arch).unwrap().len();
        let gone = lab.at("arch").join("nothere.rpf").display().to_string();
        let (answer, lines) = lab.probe(&json!({"baseArchive": gone, "operations": []}));
        assert_eq!(
            failure(answer),
            refusal(
                "FileNotFoundException",
                &format!("File was not found: {gone}")
            )
        );
        assert!(lines.is_empty());
        let txt = lab.at("u.txt");
        fs::write(&txt, b"x").unwrap();
        let (answer, _) =
            lab.probe(&json!({"baseArchive": txt.display().to_string(), "operations": []}));
        assert_eq!(
            failure(answer),
            refusal("ArgumentException", "Unsupported file extension: .txt")
        );

        for (name, bytes, total) in [
            ("garbage.rpf", vec![7u8; 2000], 2000u64),
            ("tiny.rpf", vec![1u8; 5], 5),
            ("zero.rpf", Vec::new(), 1),
        ] {
            let path = lab.at(name);
            fs::write(&path, bytes).unwrap();
            let (answer, lines) =
                lab.probe(&json!({"baseArchive": path.display().to_string(), "operations": []}));
            assert_eq!(failure(answer).0, "InvalidDataException");
            assert_eq!(lines, [progress_line(0, total)]);
        }

        let nokeys = lab.at("nokeys").display().to_string();
        let body = json!({"baseArchive": arch, "operations": []}).to_string();
        let (answer, lines) = lab.run(body.as_bytes(), &["--keys", &nokeys]);
        let (code, message) = failure(answer);
        assert_eq!(code, "InvalidOperationException");
        assert!(
            message.starts_with("The GTA V RPF key file gtav_aes_key.dat could not be read from")
        );
        assert_eq!(lines, [progress_line(0, size)]);
        if std::env::var_os(KEYS_ENV).is_none() {
            let (answer, lines) = lab.run(body.as_bytes(), &[]);
            assert_eq!(
                failure(answer),
                refusal(
                    "FileNotFoundException",
                    "GTA V executable was not found for in-memory key discovery."
                )
            );
            assert_eq!(lines, [progress_line(0, size)]);
        }
    }

    #[test]
    fn the_operation_cap_is_applied_while_the_request_is_parsed() {
        let lab = Lab::new();
        let arch = lab.archive("update.rpf", &update_tree(None));
        let one = json!({"entry": "common/data/a.xml", "action": "upsert"});
        let exact = json!({"baseArchive": arch, "operations": vec![one.clone(); OPERATION_CAP]});
        let (answer, _) = lab.probe(&exact);
        assert_eq!(answer.unwrap()["checkedOperations"], OPERATION_CAP);
        let over = json!({"baseArchive": arch, "operations": vec![one; OPERATION_CAP + 1]});
        let (answer, lines) = lab.probe(&over);
        assert_eq!(
            failure(answer),
            refusal("InvalidDataException", "RPF operation limit exceeded.")
        );
        assert!(lines.is_empty());
    }
}
