//! Применение действий заплатки к дереву архива в памяти.
//!
//! Модуль знает правила прежнего хоста: что значат Replace, Import и Delete,
//! в каком порядке они идут, как находить место в дереве (в том числе внутри
//! вложенных `.rpf`), что считать ресурсом, какой режим сжатия ставить. На диске
//! он ничего не меняет: читает четыре первых байта файла нагрузки и открывает
//! вложенные архивы базы. Файлы нагрузки остаются в дереве по пути и читаются
//! позже, при записи архива. Цели, которых в дереве нет, молча пропускаются.

use std::{
    collections::BTreeMap,
    fs::File,
    io::{ErrorKind, Read},
    path::{Path, PathBuf},
};

use rage_rpf::{Archive, DirNode, EntryKind};
use rage_rpf::{Body, Compress, Data};

use super::{
    patch::{ActionKind, PatchAction},
    strip_archive_prefix,
};
use crate::{error::Result, paths};

/// Что должно оказаться на месте проверки.
#[derive(Clone, Debug)]
pub enum Expect {
    /// Записи нет.
    Absent,
    /// Запись есть, её распакованное содержимое совпадает с файлом.
    Binary { source: PathBuf },
    /// Запись — ресурс; байты кроме первых 16 и слова флагов равны файлу.
    Resource { source: PathBuf },
    /// Запись — вложенный архив с тем же составом, что у файла.
    Archive { source: PathBuf },
}

/// Одна проверка собранного архива.
#[derive(Clone, Debug)]
pub struct Check {
    pub expect: Expect,
    /// Путь от корня по звеньям, как написан в цели.
    pub segments: Vec<String>,
}

impl Check {
    fn at(segments: &[String], expect: Expect) -> Check {
        Check {
            expect,
            segments: segments.to_vec(),
        }
    }
}

/// Первые четыре байта файла-ресурса.
const RESOURCE_MAGIC: [u8; 4] = *b"RSC7";

/// Начинается ли файл с магии `RSC7`. Файл короче четырёх байт — не ресурс.
pub fn is_resource(path: &Path) -> Result<bool> {
    let mut file = File::open(path)?;
    let mut head = [0u8; RESOURCE_MAGIC.len()];
    match file.read_exact(&mut head) {
        Ok(()) => Ok(head == RESOURCE_MAGIC),
        Err(error) if error.kind() == ErrorKind::UnexpectedEof => Ok(false),
        Err(error) => Err(error.into()),
    }
}

/// Ключ порядка: цель с прямыми слэшами, без пробелов по краям, ASCII строчными.
/// Префикс архива в ключ входит.
fn order_key(action: &PatchAction) -> String {
    let fold = |ch: char| match ch {
        '\\' => '/',
        other => other.to_ascii_lowercase(),
    };
    action.target_path.trim().chars().map(fold).collect()
}

/// Ссылки на действия заплатки.
type Actions<'a> = [&'a PatchAction];

/// Действия одного архива в порядке применения: по ключу как по байтам UTF-8,
/// а из действий с одним ключом остаётся последнее.
pub fn ordered<'a>(actions: &Actions<'a>) -> Vec<&'a PatchAction> {
    let mut latest = BTreeMap::new();
    for &action in actions {
        latest.insert(order_key(action), action);
    }
    latest.into_values().collect()
}

/// Приёмник строк журнала.
type Sink<'a> = &'a mut dyn FnMut(String);

/// Применяет действия к дереву в порядке `ordered`. Ошибка (небезопасный путь,
/// источник, запись на имя каталога) прекращает работу: сделанное в дереве
/// остаётся, список проверок не возвращается.
pub fn apply(
    root: &mut DirNode,
    actions: &Actions<'_>,
    patch_dir: &Path,
    log: Sink<'_>,
) -> Result<Vec<Check>> {
    ordered(actions)
        .into_iter()
        .try_fold(Vec::new(), |mut checks, action| {
            let job = Job::parse(action, patch_dir)?;
            checks.extend(job.run(root, log)?);
            Ok(checks)
        })
}

/// Файл нагрузки и режим, в котором он ложится в дерево.
struct Placement {
    replacing: bool,
    source: PathBuf,
}

/// Что делать с действием, когда место в дереве найдено.
enum Work {
    Remove,
    Place(Placement),
}

/// Действие, разобранное до первого обращения к дереву.
struct Job {
    segments: Vec<String>,
    work: Work,
}

impl Job {
    /// Сначала путь цели, потом (кроме удаления) файл нагрузки: отказ по пути
    /// идёт раньше отказа по источнику.
    ///
    /// Удаление только ищет место в дереве архива в памяти: его звенья идут в
    /// поиск по дереву, в журнал и в список проверок, поэтому для цели удаления
    /// действует мягкое правило (`normalize_inner`), и цель, которой нет, молча
    /// пропускается. Import и Replace кладут запись, а её имя потом становится
    /// именем файла: вложенный `.rpf` писатель архива выкладывает на доводку в
    /// файл своего имени (`rage_rpf`, `Scratch::create`), запись читают в файл
    /// (`read-archive-file`). Поэтому их цель, как и файл нагрузки на диске,
    /// проверяется правилом диска.
    fn parse(action: &PatchAction, patch_dir: &Path) -> Result<Job> {
        let target = strip_archive_prefix(&action.target_path);
        let relative = match action.kind {
            ActionKind::Delete => paths::normalize_inner(&target)?,
            _ => paths::normalize_relative(&target)?,
        };
        let segments = relative.split('/').map(|part| part.to_owned()).collect();
        let work = match action.kind {
            ActionKind::Delete => Work::Remove,
            kind => {
                let payload = paths::normalize_relative(&action.source_path)?;
                Work::Place(Placement {
                    replacing: kind == ActionKind::Replace,
                    source: paths::inside(&patch_dir.to_string_lossy(), &payload)?,
                })
            }
        };
        Ok(Job { segments, work })
    }

    /// Новые каталоги на пути заводит только добавление.
    fn creates_dirs(&self) -> bool {
        match &self.work {
            Work::Place(placement) => !placement.replacing,
            Work::Remove => false,
        }
    }

    /// `Ok(None)` — действие пропущено (нет места в дереве, нечего заменять) или
    /// удалять было нечего.
    fn run(&self, root: &mut DirNode, log: Sink<'_>) -> Result<Option<Check>> {
        match parent_of(root, &self.segments, self.creates_dirs()) {
            None => Ok(None),
            Some((dir, leaf)) => match &self.work {
                Work::Remove => Ok(self.unlink(log, dir, leaf)),
                Work::Place(placement) => placement.land(log, dir, leaf, &self.segments),
            },
        }
    }

    fn unlink(&self, log: Sink<'_>, dir: &mut DirNode, leaf: &str) -> Option<Check> {
        dir.remove_file(leaf).then(|| {
            log(format!("[Injector] Удален: {}", self.segments.join("/")));
            Check::at(&self.segments, Expect::Absent)
        })
    }
}

impl Placement {
    /// `None` — заменять нечего: источник даже не читается.
    fn land(
        &self,
        log: Sink<'_>,
        dir: &mut DirNode,
        leaf: &str,
        segments: &[String],
    ) -> Result<Option<Check>> {
        match dir.find_file(leaf).map(|file| is_stored_plain(&file.body)) {
            None if self.replacing => Ok(None),
            plain_before => self
                .write(log, dir, (leaf, segments), plain_before)
                .map(Some),
        }
    }

    fn write(
        &self,
        log: Sink<'_>,
        dir: &mut DirNode,
        (leaf, segments): (&str, &[String]),
        plain_before: Option<bool>,
    ) -> Result<Check> {
        let shape: Shape = is_resource(&self.source)?.into();
        let data = Data::File(self.source.clone());
        let existed = dir.put_file(leaf, shape.body(data, plain_before))?;

        let word = match (existed, self.replacing) {
            (true, true) => "Заменен",
            _ => "Импортирован",
        };
        log(format!("  -> {} ({}): {}", word, shape.label(), leaf));
        let expect = shape.expected(leaf, self.source.clone());
        Ok(Check::at(segments, expect))
    }
}

/// Вид записи, которую кладут в дерево.
#[derive(Clone, Copy)]
enum Shape {
    Resource,
    Binary,
}

impl From<bool> for Shape {
    fn from(resource: bool) -> Shape {
        match resource {
            true => Shape::Resource,
            false => Shape::Binary,
        }
    }
}

impl Shape {
    fn label(self) -> &'static str {
        match self {
            Shape::Resource => "Resource",
            Shape::Binary => "Binary",
        }
    }

    /// Двоичная запись берёт `Store`, если прежняя хранится несжатой, иначе `Always`.
    fn body(self, data: Data, plain_before: Option<bool>) -> Body {
        match (self, plain_before) {
            (Shape::Resource, _) => Body::Resource { data },
            (Shape::Binary, Some(true)) => Body::Binary {
                data,
                compress: Compress::Store,
            },
            (Shape::Binary, _) => Body::Binary {
                data,
                compress: Compress::Always,
            },
        }
    }

    fn expected(self, leaf: &str, source: PathBuf) -> Expect {
        match self {
            Shape::Resource => Expect::Resource { source },
            Shape::Binary if Archive::is_nested_archive_name(leaf) => Expect::Archive { source },
            Shape::Binary => Expect::Binary { source },
        }
    }
}

/// Хранится ли прежняя запись несжатой: из архива как есть или уже поставлена
/// так же.
fn is_stored_plain(previous: &Body) -> bool {
    match previous {
        Body::Copy { archive, id } => match &archive.entry(*id).kind {
            EntryKind::Binary(info) => !info.is_compressed(),
            _ => false,
        },
        Body::Binary { compress, .. } => compress == &Compress::Store,
        _ => false,
    }
}

/// Каталог, в котором лежит последнее звено цели, и само звено; `None` —
/// действие пропускается.
fn parent_of<'a>(
    root: &'a mut DirNode,
    segments: &'a [String],
    creating: bool,
) -> Option<(&'a mut DirNode, &'a str)> {
    let (leaf, parents) = segments.split_last()?;
    let mut here = root;
    for name in parents {
        here = step_into(here, name, creating)?;
    }
    Some((here, leaf.as_str()))
}

/// Как пройти одно звено пути.
enum Hop {
    Existing,
    Nested,
    Fresh,
    Blocked,
}

/// Каталог с этим именем всегда в приоритете (даже названный как архив); иначе
/// `….rpf` открывается как вложенный архив; иначе при `creating` заводится новый
/// каталог. Отсутствующий `….rpf` каталогом не становится.
fn classify(node: &DirNode, name: &str, creating: bool) -> Hop {
    match (node.find_dir(name), Archive::is_nested_archive_name(name)) {
        (Some(_), _) => Hop::Existing,
        (None, true) => Hop::Nested,
        (None, false) if node.find_file(name).is_none() && creating => Hop::Fresh,
        (None, false) => Hop::Blocked,
    }
}

/// Шаг вниз по дереву на одно звено. `None` — действие пропускается.
fn step_into<'a>(node: &'a mut DirNode, name: &str, creating: bool) -> Option<&'a mut DirNode> {
    match classify(node, name, creating) {
        Hop::Existing => node.find_dir_mut(name),
        Hop::Nested => node.find_file_mut(name)?.nested_root().ok(),
        Hop::Fresh => node.ensure_dir(name).ok(),
        Hop::Blocked => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::archives::sha256_file;
    use rage_rpf::describe::describe;
    use rage_rpf::fixtures::{common_tree, noise, replacement_tree, resource, text, update_tree};
    use rage_rpf::{write_archive, FileNode, WriteContext};
    use std::fs;
    use std::sync::Arc;
    use tempfile::{tempdir, TempDir};

    use ActionKind::{Delete, Import, Replace};

    // ----- стенд: базовые архивы, файлы нагрузки, прогон и разница деревьев -----

    const UPDATE_SHA: &str = "9571b6fb09619f76e82337993a808ef468c53aa71970eec9ef1f434577a587aa";
    const COMMON_SHA: &str = "da54fc37431e804a1a197874d9d207920ebae04058d517d6497d542e390415f0";
    const NESTED_SHA: &str = "7717728e6f79551df9f08d7b7d64730dc4c6d7913bd38bac3e62979f92059374";

    #[derive(Clone, Copy)]
    enum Base {
        Update,
        Custom,
    }

    fn plain(name: &str, bytes: Vec<u8>, compress: Compress) -> FileNode {
        FileNode {
            name: name.to_owned(),
            body: Body::Binary {
                data: Data::memory(bytes),
                compress,
            },
        }
    }

    fn folder(name: &str, dirs: Vec<DirNode>, files: Vec<FileNode>) -> DirNode {
        let mut node = DirNode::new(name);
        node.dirs = dirs;
        node.files = files;
        node
    }

    fn pack(name: &str, tree: DirNode) -> FileNode {
        FileNode {
            name: name.to_owned(),
            body: Body::Nested(Box::new(tree)),
        }
    }

    /// База с особенностями: сломанный `bad.rpf`, каталог с именем `z.rpf` и другое.
    fn custom_tree() -> DirNode {
        use Compress::{Auto, Store};
        let good = folder(
            "",
            vec![folder(
                "d",
                vec![],
                vec![plain("e.xml", text(250, "e"), Auto)],
            )],
            vec![plain("inner.xml", text(300, "inner"), Auto)],
        );
        let astral_c = folder("", vec![], vec![plain("one.ydd", text(300, "one"), Auto)]);
        let old_ytd = FileNode {
            name: "old.ytd".to_owned(),
            body: Body::Resource {
                data: Data::memory(resource(0x6000_0001, 0x9000_0002, &noise(300, 5))),
            },
        };
        folder(
            "",
            vec![
                folder("sub", vec![], vec![plain("file.txt", text(300, "f"), Auto)]),
                folder(
                    "x64",
                    vec![folder("astral", vec![], vec![pack("c.rpf", astral_c)])],
                    vec![],
                ),
                folder("z.rpf", vec![], vec![plain("y.txt", text(100, "y"), Auto)]),
            ],
            vec![
                plain("bad.rpf", noise(2000, 1), Store),
                plain("doc.txt", text(400, "doc"), Auto),
                pack("good.rpf", good),
                plain("noise.dat", noise(2000, 2), Store),
                old_ytd,
                plain("packed.txt", text(600, "packed"), Auto),
                plain("plain.txt", text(600, "plain"), Store),
            ],
        )
    }

    /// Файлы нагрузки заплатки: имя и содержимое.
    fn sources(scratch: &Path) -> Vec<(&'static str, Vec<u8>)> {
        let mut nested = Vec::new();
        {
            let path = scratch.join("nested-build.rpf");
            write_to(&replacement_tree(), &path);
            nested.extend(fs::read(&path).unwrap());
        }
        let long: Vec<u8> = b"RSC7".iter().copied().chain([0u8; 12]).collect();
        vec![
            ("new.xml", text(200, "new")),
            ("new2.xml", text(210, "new2")),
            ("a_new.xml", text(3000, "<a-new/>")),
            ("plain_text.txt", text(800, "plain text")),
            ("tiny.bin", b"tiny!!!".to_vec()),
            (
                "res.ytd",
                resource(0x6000_0001, 0x9000_0002, &noise(300, 3)),
            ),
            (
                "tex2.ytd",
                resource(0x6000_0001, 0x9000_0002, &noise(500, 6)),
            ),
            ("fake.ytd", text(500, "fake")),
            ("rsc3.bin", b"RSC".to_vec()),
            ("rsc4.bin", b"RSC7".to_vec()),
            ("rsc-long.bin", long),
            ("rsc7-lower.bin", b"rsc7 and more".to_vec()),
            ("empty.bin", Vec::new()),
            ("bank.awc", noise(5000, 13)),
            ("nested.rpf", nested),
            ("bad.rpf", noise(1500, 17)),
        ]
    }

    fn write_to(tree: &DirNode, path: &Path) {
        let mut file = fs::File::create(path).unwrap();
        let mut ctx = WriteContext {
            staging: path.parent().unwrap(),
            keys: None,
            finalizer: None,
        };
        write_archive(tree, &mut file, &mut ctx, &mut |_| {}).unwrap();
    }

    fn open(path: &Path) -> Arc<Archive> {
        Arc::new(Archive::open_path(path, None).unwrap())
    }

    /// Строки описания архива с полными путями: `путь  вид…`, у каталогов `путь/`.
    fn with_paths(lines: &[String]) -> Vec<String> {
        let mut stack: Vec<String> = Vec::new();
        let mut out = Vec::new();
        for line in lines {
            let body = line.trim_start();
            let depth = (line.len() - body.len()) / 2;
            stack.truncate(depth);
            let joined = |name: &str| {
                stack
                    .iter()
                    .map(String::as_str)
                    .chain([name])
                    .collect::<Vec<_>>()
                    .join("/")
            };
            if let Some(dir) = body.strip_suffix('/') {
                out.push(format!("{}/", joined(dir)));
                stack.push(dir.to_owned());
            } else {
                let (name, rest) = body.split_once("  ").unwrap_or((body, ""));
                out.push(format!("{}  {rest}", joined(name)));
                if rest.starts_with("archive") {
                    stack.push(name.to_owned());
                }
            }
        }
        out
    }

    fn masked(line: &str) -> String {
        match line.find("sha=") {
            Some(at) => format!("{}sha=*", &line[..at]),
            None => line.to_owned(),
        }
    }

    /// Что исчезло и что появилось (с затёртыми отпечатками), каждое по порядку.
    fn difference(before: &[String], after: &[String]) -> (Vec<String>, Vec<String>) {
        let gone = |from: &[String], other: &[String]| -> Vec<String> {
            let mut left = other.to_vec();
            let mut found = Vec::new();
            for line in from {
                match left.iter().position(|seen| seen == line) {
                    Some(at) => {
                        left.remove(at);
                    }
                    None => found.push(masked(line)),
                }
            }
            found
        };
        (gone(before, after), gone(after, before))
    }

    fn show_check(check: &Check) -> String {
        let path = check.segments.join("/");
        let name = |source: &Path| source.file_name().unwrap().to_string_lossy().into_owned();
        match &check.expect {
            Expect::Binary { source } => format!("Binary {path} \u{2190} {}", name(source)),
            Expect::Resource { source } => format!("Resource {path} \u{2190} {}", name(source)),
            Expect::Archive { source } => format!("Archive {path} \u{2190} {}", name(source)),
            Expect::Absent => format!("Absent {path}"),
        }
    }

    struct Report {
        log: Vec<String>,
        checks: Vec<String>,
        removed: Vec<String>,
        added: Vec<String>,
        sha: String,
        base_sha: String,
    }

    type Act<'a> = (ActionKind, &'a str, &'a str);

    fn action(act: &Act<'_>) -> PatchAction {
        PatchAction {
            kind: act.0,
            target_path: act.1.to_owned(),
            source_path: act.2.to_owned(),
            size: 0,
            sha256: None,
            whole_replace_nested: false,
        }
    }

    /// Применяет действия к базе, пишет результат и сравнивает деревья.
    /// Ошибка применения или записи - пара «код, текст».
    fn run(base: Base, acts: &[Act<'_>]) -> std::result::Result<Report, (String, String)> {
        let lab: TempDir = tempdir().unwrap();
        let patch = lab.path().join("patch");
        fs::create_dir_all(&patch).unwrap();
        for (name, bytes) in sources(lab.path()) {
            fs::write(patch.join(name), bytes).unwrap();
        }
        fs::create_dir(patch.join("srcdir")).unwrap();

        let tree = match base {
            Base::Update => update_tree(None),
            Base::Custom => custom_tree(),
        };
        let base_path = lab.path().join("base.rpf");
        write_to(&tree, &base_path);
        let base_archive = open(&base_path);
        let base_lines = with_paths(&describe(&base_archive));
        let mut root = DirNode::from_archive(&base_archive);

        let owned: Vec<PatchAction> = acts.iter().map(action).collect();
        let refs: Vec<&PatchAction> = owned.iter().collect();
        let mut log = Vec::new();
        let checks = apply(&mut root, &refs, &patch, &mut |line| log.push(line))
            .map_err(|error| (error.code, error.message))?;

        let out_path = lab.path().join("result.rpf");
        let mut file = fs::File::create(&out_path).unwrap();
        let mut ctx = WriteContext {
            staging: lab.path(),
            keys: None,
            finalizer: None,
        };
        write_archive(&root, &mut file, &mut ctx, &mut |_| {}).map_err(|error| {
            let error = crate::error::EngineError::from(error);
            (error.code, error.message)
        })?;
        drop(file);
        let after_lines = with_paths(&describe(&open(&out_path)));
        let (removed, added) = difference(&base_lines, &after_lines);
        Ok(Report {
            log,
            checks: checks.iter().map(show_check).collect(),
            removed,
            added,
            sha: sha256_file(&out_path).unwrap(),
            base_sha: sha256_file(&base_path).unwrap(),
        })
    }

    fn done(base: Base, acts: &[Act<'_>]) -> Report {
        match run(base, acts) {
            Ok(report) => report,
            Err((code, message)) => panic!("отказ {code}: {message}"),
        }
    }

    fn refused(base: Base, acts: &[Act<'_>]) -> (String, String) {
        match run(base, acts) {
            Ok(_) => panic!("ожидался отказ"),
            Err(error) => error,
        }
    }

    fn unchanged(report: &Report) {
        assert!(report.log.is_empty() && report.checks.is_empty());
        assert!(report.removed.is_empty() && report.added.is_empty());
        assert_eq!(report.sha, report.base_sha);
    }

    // ----- сами базы -----

    #[test]
    fn the_base_trees_are_the_documented_ones() {
        let lab = tempdir().unwrap();
        let (update, common) = (lab.path().join("u.rpf"), lab.path().join("c.rpf"));
        write_to(&update_tree(None), &update);
        write_to(&common_tree(), &common);
        assert_eq!(sha256_file(&update).unwrap(), UPDATE_SHA);
        assert_eq!(sha256_file(&common).unwrap(), COMMON_SHA);
        let lines = describe(&open(&update));
        let expected = [
            "common/",
            "  data/",
            "    a.xml  bin cmp=1 enc=0 unc=4000 sha=74f7ba8b5166",
            "    b.dat  bin cmp=0 enc=0 unc=3000 sha=59fd832607cd",
            "    c.txt  bin cmp=0 enc=0 unc=900 sha=bfb45e022f04",
            "    old.xml  bin cmp=1 enc=0 unc=500 sha=5eddcaf4402e",
            "content.xml  bin cmp=1 enc=0 unc=568 sha=f79c02c678e2",
            "setup2.xml  bin cmp=1 enc=0 unc=315 sha=0b7c7f849069",
            "x64/",
            "  data/",
            "    cdimages/",
            "      scaleform_generic.rpf  archive entries=6",
            "        hud.gfx  bin cmp=0 enc=0 unc=1800 sha=ff8e419148c2",
            "        inner/",
            "          deep.xml  bin cmp=1 enc=0 unc=700 sha=bcbc978d7aa7",
            "        mini.gfx  bin cmp=1 enc=0 unc=2500 sha=54ae3b953946",
            "        tex.ytd  res sys=0x60000001 gfx=0x90000002 stored=916 sha=173e3d617bb9",
            "      scaleform_other.rpf  archive entries=2",
            "        keep.xml  bin cmp=1 enc=0 unc=600 sha=a7df92e805b9",
        ];
        assert_eq!(lines, expected);
        let scratch = tempdir().unwrap();
        let nested = scratch.path().join("n.rpf");
        write_to(&replacement_tree(), &nested);
        assert_eq!(sha256_file(&nested).unwrap(), NESTED_SHA);
    }

    // ----- is_resource (Р1-Р8) -----

    #[test]
    fn a_file_is_a_resource_only_when_it_starts_with_rsc7() {
        let dir = tempdir().unwrap();
        let check = |name: &str, bytes: &[u8]| {
            let path = dir.path().join(name);
            fs::write(&path, bytes).unwrap();
            is_resource(&path).unwrap()
        };
        assert!(check("exact", b"RSC7"));
        assert!(!check("short", b"RSC"));
        assert!(!check("empty", b""));
        assert!(!check("lower", b"rsc7 and more"));
        assert!(check(
            "real",
            &resource(0x6000_0001, 0x9000_0002, &noise(40, 1))
        ));
        assert!(!check("text", b"hello there"));
        let missing = is_resource(&dir.path().join("nothing")).unwrap_err();
        assert_eq!(missing.code, "FileNotFoundException");
        assert!(missing.message.ends_with("(os error 2)"));
        #[cfg(windows)]
        {
            let folder = is_resource(dir.path()).unwrap_err();
            assert_eq!(folder.code, "UnauthorizedAccessException");
            assert!(folder.message.ends_with("(os error 5)"));
        }
    }

    // ----- ordered (О1-О10) -----

    fn order_of(list: &[(ActionKind, &str)]) -> Vec<String> {
        let owned: Vec<PatchAction> = list
            .iter()
            .map(|(kind, target)| action(&(*kind, *target, "")))
            .collect();
        let refs: Vec<&PatchAction> = owned.iter().collect();
        ordered(&refs)
            .into_iter()
            .map(|picked| {
                let at = owned
                    .iter()
                    .position(|candidate| std::ptr::eq(candidate, picked))
                    .unwrap();
                format!("{at}:{}", picked.target_path)
            })
            .collect()
    }

    #[test]
    fn actions_are_ordered_by_a_folded_path_and_the_last_one_per_path_wins() {
        assert!(order_of(&[]).is_empty());
        // О2
        assert_eq!(
            order_of(&[
                (Import, "update:/b/z.xml"),
                (Import, "update:/A/y.xml"),
                (Delete, "update:\\B\\Z.xml"),
            ]),
            ["1:update:/A/y.xml", "2:update:\\B\\Z.xml"]
        );
        // О3: последнее действие над путём занимает место ключа
        assert_eq!(
            order_of(&[
                (Import, "update:/m.xml"),
                (Import, "update:/a.xml"),
                (Delete, "update:/M.XML"),
                (Import, "update:/z.xml"),
            ]),
            ["1:update:/a.xml", "2:update:/M.XML", "3:update:/z.xml"]
        );
        // О4: с префиксом и без - разные ключи
        assert_eq!(
            order_of(&[(Import, "update:/common/a.xml"), (Import, "common/a.xml")]),
            ["1:common/a.xml", "0:update:/common/a.xml"]
        );
        // О5: пробелы по краям срезаются
        assert_eq!(
            order_of(&[(Import, "  update:/q.xml"), (Import, "update:/q.xml  ")]),
            ["1:update:/q.xml  "]
        );
        // О6: вложенный архив раньше его содержимого
        assert_eq!(
            order_of(&[
                (Import, "update:/x/c.rpf/b.xml"),
                (Replace, "update:/x/c.rpf"),
                (Import, "update:/x/c.rpf/a.xml"),
            ]),
            [
                "1:update:/x/c.rpf",
                "2:update:/x/c.rpf/a.xml",
                "0:update:/x/c.rpf/b.xml"
            ]
        );
        // О7: порядок байт - «-», «_», строчные; прописные ASCII приводятся к строчным
        assert_eq!(
            order_of(&[
                (Import, "update:/a_b"),
                (Import, "update:/ab"),
                (Import, "update:/AC"),
                (Import, "update:/a-b"),
            ]),
            [
                "3:update:/a-b",
                "0:update:/a_b",
                "1:update:/ab",
                "2:update:/AC"
            ]
        );
        // О8: не-ASCII регистр не сворачивается
        assert_eq!(
            order_of(&[
                (Import, "update:/\u{c4}.xml"),
                (Import, "update:/\u{e4}.xml"),
                (Import, "update:/z.xml"),
            ]),
            [
                "2:update:/z.xml",
                "0:update:/\u{c4}.xml",
                "1:update:/\u{e4}.xml"
            ]
        );
        // О9: точка и слэш
        assert_eq!(
            order_of(&[
                (Import, "update:/a.b"),
                (Import, "update:/a/b"),
                (Import, "update:/a-b"),
                (Import, "update:/a0"),
            ]),
            [
                "2:update:/a-b",
                "0:update:/a.b",
                "1:update:/a/b",
                "3:update:/a0"
            ]
        );
        // О10: пустые цели
        assert_eq!(
            order_of(&[(Import, ""), (Import, " "), (Delete, "")]),
            ["2:"]
        );
    }

    // ----- Replace, Import, режимы сжатия, ресурсы (Д1-Д17) -----

    #[test]
    fn replacing_an_entry_keeps_its_name_and_takes_the_case_of_the_target_in_the_journal() {
        // Д1
        let report = done(
            Base::Update,
            &[(Replace, "UPDATE:/COMMON/DATA/A.XML", "a_new.xml")],
        );
        assert_eq!(report.log, ["  -> Заменен (Binary): A.XML"]);
        assert_eq!(
            report.checks,
            ["Binary COMMON/DATA/A.XML \u{2190} a_new.xml"]
        );
        assert_eq!(
            report.removed,
            ["common/data/a.xml  bin cmp=1 enc=0 unc=4000 sha=*"]
        );
        assert_eq!(
            report.added,
            ["common/data/a.xml  bin cmp=1 enc=0 unc=3000 sha=*"]
        );
    }

    #[test]
    fn a_plain_stored_entry_stays_stored_and_a_packed_one_is_packed_whatever_the_new_file_is() {
        let case = |target: &str, source: &str, base: Base, removed: &str, added: &str| {
            let report = done(base, &[(Replace, target, source)]);
            assert_eq!(report.removed, [removed], "{target}");
            assert_eq!(report.added, [added], "{target}");
        };
        // Д2: хранимая c.txt получает хорошо сжимаемый текст и остаётся хранимой
        case(
            "update:/common/data/c.txt",
            "plain_text.txt",
            Base::Update,
            "common/data/c.txt  bin cmp=0 enc=0 unc=900 sha=*",
            "common/data/c.txt  bin cmp=0 enc=0 unc=800 sha=*",
        );
        // Д3: несжимаемая b.dat (хранится как есть) получает сжимаемый текст
        case(
            "update:/common/data/b.dat",
            "plain_text.txt",
            Base::Update,
            "common/data/b.dat  bin cmp=0 enc=0 unc=3000 sha=*",
            "common/data/b.dat  bin cmp=0 enc=0 unc=800 sha=*",
        );
        // Д4: сжатая a.xml получает семь байт - сжимается всё равно
        case(
            "update:/common/data/a.xml",
            "tiny.bin",
            Base::Update,
            "common/data/a.xml  bin cmp=1 enc=0 unc=4000 sha=*",
            "common/data/a.xml  bin cmp=1 enc=0 unc=7 sha=*",
        );
        // Д5: ресурс заменяется обычным файлом - режим Always
        case(
            "update:/x64/data/cdimages/scaleform_generic.rpf/tex.ytd",
            "a_new.xml",
            Base::Update,
            "x64/data/cdimages/scaleform_generic.rpf/tex.ytd  res sys=0x60000001 gfx=0x90000002 stored=916 sha=*",
            "x64/data/cdimages/scaleform_generic.rpf/tex.ytd  bin cmp=1 enc=0 unc=3000 sha=*",
        );
        // Д16: расширение источника ничего не решает, важно имя записи в архиве
        case(
            "update:/common/data/c.txt",
            "bank.awc",
            Base::Update,
            "common/data/c.txt  bin cmp=0 enc=0 unc=900 sha=*",
            "common/data/c.txt  bin cmp=0 enc=0 unc=5000 sha=*",
        );
        // Д62-Д64 на особой базе
        case(
            "update:/plain.txt",
            "plain_text.txt",
            Base::Custom,
            "plain.txt  bin cmp=0 enc=0 unc=600 sha=*",
            "plain.txt  bin cmp=0 enc=0 unc=800 sha=*",
        );
        case(
            "update:/packed.txt",
            "tiny.bin",
            Base::Custom,
            "packed.txt  bin cmp=1 enc=0 unc=600 sha=*",
            "packed.txt  bin cmp=1 enc=0 unc=7 sha=*",
        );
        case(
            "update:/old.ytd",
            "plain_text.txt",
            Base::Custom,
            "old.ytd  res sys=0x60000001 gfx=0x90000002 stored=316 sha=*",
            "old.ytd  bin cmp=1 enc=0 unc=800 sha=*",
        );
    }

    #[test]
    fn the_type_is_decided_by_the_first_four_bytes_not_by_the_name() {
        // Д6: ресурс ресурсом
        let report = done(
            Base::Update,
            &[(
                Replace,
                "update:/x64/data/cdimages/scaleform_generic.rpf/tex.ytd",
                "tex2.ytd",
            )],
        );
        assert_eq!(report.log, ["  -> Заменен (Resource): tex.ytd"]);
        assert_eq!(
            report.checks,
            ["Resource x64/data/cdimages/scaleform_generic.rpf/tex.ytd \u{2190} tex2.ytd"]
        );
        assert_eq!(
            report.added,
            ["x64/data/cdimages/scaleform_generic.rpf/tex.ytd  res sys=0x60000001 gfx=0x90000002 stored=516 sha=*"]
        );
        // Д7: двоичная запись заменяется файлом с RSC7
        let report = done(
            Base::Update,
            &[(Replace, "update:/common/data/a.xml", "res.ytd")],
        );
        assert_eq!(report.log, ["  -> Заменен (Resource): a.xml"]);
        assert_eq!(
            report.added,
            ["common/data/a.xml  res sys=0x60000001 gfx=0x90000002 stored=316 sha=*"]
        );
        // Д8-Д9: расширение .ytd без заголовка - обычный файл, .xml с заголовком - ресурс
        let report = done(
            Base::Update,
            &[(Import, "update:/common/data/fake.ytd", "fake.ytd")],
        );
        assert_eq!(report.log, ["  -> Импортирован (Binary): fake.ytd"]);
        assert_eq!(
            report.checks,
            ["Binary common/data/fake.ytd \u{2190} fake.ytd"]
        );
        assert_eq!(
            report.added,
            ["common/data/fake.ytd  bin cmp=1 enc=0 unc=500 sha=*"]
        );
        let report = done(
            Base::Update,
            &[(Import, "update:/common/data/res_as.xml", "res.ytd")],
        );
        assert_eq!(report.log, ["  -> Импортирован (Resource): res_as.xml"]);
        assert_eq!(
            report.checks,
            ["Resource common/data/res_as.xml \u{2190} res.ytd"]
        );
        assert_eq!(
            report.added,
            ["common/data/res_as.xml  res sys=0x60000001 gfx=0x90000002 stored=316 sha=*"]
        );
    }

    #[test]
    fn short_odd_and_empty_sources_are_binary_but_a_bare_magic_is_refused_by_the_writer() {
        // Д10, Д12, Д14: известные отпечатки результата сняты на старом хосте
        let cases = [
            (
                "short.bin",
                "rsc3.bin",
                "common/data/short.bin  bin cmp=1 enc=0 unc=3 sha=01224c0f77e0",
                "23836e33fed24b996b0d523b281580e81ecbc77f1289a6853cd5393934921a9f",
            ),
            (
                "lower.bin",
                "rsc7-lower.bin",
                "common/data/lower.bin  bin cmp=1 enc=0 unc=13 sha=*",
                "",
            ),
            (
                "empty.bin",
                "empty.bin",
                "common/data/empty.bin  bin cmp=1 enc=0 unc=0 sha=e3b0c44298fc",
                "b6b75c72c28c935ac92941a0825e25004d83f486711d5ccbd072595d321e546c",
            ),
        ];
        for (name, source, line, sha) in cases {
            let target = format!("update:/common/data/{name}");
            let report = done(Base::Update, &[(Import, &target, source)]);
            assert_eq!(report.log, [format!("  -> Импортирован (Binary): {name}")]);
            assert_eq!(
                report.checks,
                [format!("Binary common/data/{name} \u{2190} {source}")]
            );
            assert_eq!(report.added, [masked(line)]);
            if !sha.is_empty() {
                assert_eq!(report.sha, sha, "{name}");
            }
        }
        // Д13: «RSC7» и 12 нулей - ресурс из 16 байт
        let report = done(
            Base::Update,
            &[(Import, "update:/common/data/sixteen.bin", "rsc-long.bin")],
        );
        assert_eq!(report.log, ["  -> Импортирован (Resource): sixteen.bin"]);
        assert_eq!(
            report.added,
            ["common/data/sixteen.bin  res sys=0x0 gfx=0x0 stored=16 sha=*"]
        );
        assert_eq!(
            report.sha,
            "8c73dacd10c01ea8a09040f97b1984100bebfc1ab05843f4eeffe07b09a851c2"
        );
        // Д11: ровно «RSC7» - ресурс короче заголовка; отказывает писатель, не apply
        assert_eq!(
            refused(
                Base::Update,
                &[(Import, "update:/common/data/magic.bin", "rsc4.bin")]
            ),
            (
                "InvalidDataException".to_owned(),
                "magic.bin: the resource is shorter than its header.".to_owned()
            )
        );
    }

    #[test]
    fn an_awc_is_stored_and_an_import_over_an_existing_entry_is_called_an_import() {
        // Д15
        let report = done(
            Base::Update,
            &[(Import, "update:/common/data/bank.awc", "bank.awc")],
        );
        assert_eq!(
            report.added,
            ["common/data/bank.awc  bin cmp=0 enc=0 unc=5000 sha=*"]
        );
        // Д17
        let report = done(
            Base::Update,
            &[(Import, "update:/common/data/a.xml", "a_new.xml")],
        );
        assert_eq!(report.log, ["  -> Импортирован (Binary): a.xml"]);
        assert_eq!(
            report.added,
            ["common/data/a.xml  bin cmp=1 enc=0 unc=3000 sha=*"]
        );
    }

    // ----- создание каталогов, пропуски (Д18-Д21, Д36, Д40-Д51) -----

    #[test]
    fn an_import_makes_missing_folders_with_the_case_of_the_target() {
        // Д18
        let report = done(
            Base::Update,
            &[(Import, "update:/NewDir/Sub/Deep.xml", "new.xml")],
        );
        assert_eq!(report.log, ["  -> Импортирован (Binary): Deep.xml"]);
        assert_eq!(
            report.checks,
            ["Binary NewDir/Sub/Deep.xml \u{2190} new.xml"]
        );
        assert_eq!(
            report.added,
            [
                "NewDir/",
                "NewDir/Sub/",
                "NewDir/Sub/Deep.xml  bin cmp=1 enc=0 unc=200 sha=*"
            ]
        );
        // Д19: внутри вложенного архива
        let report = done(
            Base::Update,
            &[(
                Import,
                "update:/x64/data/cdimages/scaleform_generic.rpf/newdir/z.xml",
                "new.xml",
            )],
        );
        assert_eq!(
            report.removed,
            ["x64/data/cdimages/scaleform_generic.rpf  archive entries=6"]
        );
        assert_eq!(
            report.added,
            [
                "x64/data/cdimages/scaleform_generic.rpf  archive entries=8",
                "x64/data/cdimages/scaleform_generic.rpf/newdir/",
                "x64/data/cdimages/scaleform_generic.rpf/newdir/z.xml  bin cmp=1 enc=0 unc=200 sha=*"
            ]
        );
    }

    #[test]
    fn missing_targets_are_skipped_without_a_word() {
        let skipped = [
            // Д20: замена в каталоге, которого нет
            (Replace, "update:/nodir/a.xml", "new.xml"),
            // Д21: замены записи, которой нет; источник даже не читается
            (Replace, "update:/common/data/none.xml", "no-such-file.xml"),
            // Д36: двоеточие после префикса остаётся в имени
            (Delete, "update:/common/data:old.xml", ""),
            // Д40, Д41, Д44, Д45
            (Delete, "update:/common/data/none.xml", ""),
            (Delete, "update:/common/data", ""),
            (Delete, "update:/x64/data/cdimages/nope.rpf/a.xml", ""),
            (Delete, "update:/nodir/sub/a.xml", ""),
            // Д48: Replace на имя каталога (каталог есть, файла нет)
            (Replace, "update:/common/data", "new.xml"),
            // Д49-Д50: на пути лежит файл вместо каталога
            (Import, "update:/content.xml/sub/x.xml", "new.xml"),
            (Replace, "update:/content.xml/sub/x.xml", "new.xml"),
            // Д51: вложенного архива нет, каталог для него не заводится
            (
                Import,
                "update:/x64/data/cdimages/brand.rpf/x.xml",
                "new.xml",
            ),
        ];
        for act in skipped {
            unchanged(&done(Base::Update, &[act]));
        }
    }

    // ----- ошибки (Д22-Д31, Д47) -----

    #[test]
    fn source_errors_are_not_hidden_and_come_before_the_tree_is_looked_at() {
        let io_error = |code: &str, tail: &str, acts: &[Act<'_>]| {
            let (got, message) = refused(Base::Update, acts);
            assert_eq!(got, code);
            assert!(message.ends_with(tail), "{message}");
        };
        // Д22, Д23: источника нет на диске
        io_error(
            "FileNotFoundException",
            "(os error 2)",
            &[(Import, "update:/common/data/x.xml", "no-such-file.xml")],
        );
        io_error(
            "FileNotFoundException",
            "(os error 2)",
            &[(Replace, "update:/common/data/a.xml", "no-such-file.xml")],
        );
        // Д24: небезопасный источник даже при цели, которой нет
        assert_eq!(
            refused(
                Base::Update,
                &[(Replace, "update:/nodir/a.xml", "../new.xml")]
            ),
            (
                "InvalidDataException".to_owned(),
                "Unsafe relative path: ../new.xml".to_owned()
            )
        );
        // Д26: пустой источник
        assert_eq!(
            refused(Base::Update, &[(Import, "update:/common/data/x.xml", "")]),
            (
                "InvalidDataException".to_owned(),
                "Unsafe relative path: ".to_owned()
            )
        );
        // Д25: источник - каталог
        #[cfg(windows)]
        io_error(
            "UnauthorizedAccessException",
            "(os error 5)",
            &[(Import, "update:/common/data/dirsrc.xml", "srcdir")],
        );
        // Д47: запись на имя каталога
        assert_eq!(
            refused(Base::Update, &[(Import, "update:/common/data", "new.xml")]),
            (
                "ArgumentException".to_owned(),
                "data is a directory, but a file is needed here.".to_owned()
            )
        );
    }

    #[test]
    fn unsafe_targets_name_what_is_left_after_the_prefix() {
        let table = [
            ("", ""),
            ("update:", ""),
            ("update:/common//data/a.xml", "/common//data/a.xml"),
            ("update:/common/../content.xml", "/common/../content.xml"),
            ("update:/common/./data/old.xml", "/common/./data/old.xml"),
        ];
        for (target, shown) in table {
            assert_eq!(
                refused(Base::Update, &[(Delete, target, "")]),
                (
                    "InvalidDataException".to_owned(),
                    format!("Unsafe relative path: {shown}")
                ),
                "{target:?}"
            );
        }
    }

    /// Удаление только ищет место в дереве архива: имя, которое Windows понимает
    /// иначе, чем написано, для него — место, которого нет. Import и Replace кладут
    /// запись, а её имя потом становится именем файла (вложенный `.rpf` уходит на
    /// доводку в файл своего имени, запись читают в файл): у них цель проверяется
    /// правилом диска, как и файл нагрузки (разбор безопасности 23.11.2026, H3-03).
    #[test]
    fn windows_name_rules_bind_what_lands_as_a_file_and_not_a_delete_target() {
        let odd_targets = [
            "update:/common/data:old.xml",
            "update:/common/data/old.xml.",
            "update:/common/data /old.xml",
            "update:/common/nul/old.xml",
            "update:/common/data/a?b.xml",
            "update:/x64/C:probe.rpf",
            "update:/x64/nul.rpf",
            "update:/x64/probe.rpf::$DATA",
        ];
        // удаление: такого места в дереве нет, действие молча пропущено, как прежде
        for target in odd_targets {
            unchanged(&done(Base::Update, &[(Delete, target, "")]));
        }
        // Import и Replace: отказ до чтения нагрузки и до взгляда на дерево
        for target in odd_targets {
            for kind in [Import, Replace] {
                assert_eq!(
                    refused(Base::Update, &[(kind, target, "new.xml")]),
                    (
                        "InvalidDataException".to_owned(),
                        format!(
                            "Unsafe relative path: {}",
                            target.trim_start_matches("update:")
                        )
                    ),
                    "{target:?}"
                );
            }
        }
        // у файла нагрузки: отказ до чтения диска и до взгляда на дерево
        for source in [
            "new.xml::$DATA",
            "new.xml:x",
            "new.xml.",
            "new.xml ",
            "nul",
            "COM1.xml",
            "sub /new.xml",
        ] {
            assert_eq!(
                refused(
                    Base::Update,
                    &[(Import, "update:/common/data/x.xml", source)]
                ),
                (
                    "InvalidDataException".to_owned(),
                    format!("Unsafe relative path: {source}")
                ),
                "{source:?}"
            );
        }
    }

    // ----- Delete (Д32-Д46) -----

    #[test]
    fn a_delete_works_whatever_the_prefix_and_the_spelling_of_the_target() {
        // Д32-Д35, Д39: результат один и тот же, отпечаток известен по старому хосту
        for target in [
            "update:/common/data/old.xml",
            "update://common/data/old.xml",
            "  update:\\common\\data\\old.xml  ",
            "common/data/old.xml",
            "x64a:/common/data/old.xml",
        ] {
            let report = done(Base::Update, &[(Delete, target, "")]);
            assert_eq!(
                report.log,
                ["[Injector] Удален: common/data/old.xml"],
                "{target:?}"
            );
            assert_eq!(report.checks, ["Absent common/data/old.xml"]);
            assert_eq!(
                report.removed,
                ["common/data/old.xml  bin cmp=1 enc=0 unc=500 sha=*"]
            );
            assert!(report.added.is_empty());
            assert_eq!(
                report.sha,
                "5835978dd143d89d63b6fb72f007406d46ccac3c81b8dbf7484c14a6e17eb553"
            );
        }
        // Д46: у удаления источник не смотрится вовсе
        let report = done(
            Base::Update,
            &[(Delete, "update:/common/data/old.xml", "../../not/there")],
        );
        assert_eq!(report.checks, ["Absent common/data/old.xml"]);
        // Д37-Д38: двоеточие где угодно - конец префикса
        for target in ["common/data:content.xml", ":/content.xml"] {
            let report = done(Base::Update, &[(Delete, target, "")]);
            assert_eq!(report.log, ["[Injector] Удален: content.xml"]);
            assert_eq!(
                report.sha,
                "871a962f111df7cd13f83901fed229051221da45cc91c948e747a655cdec0b46"
            );
        }
    }

    #[test]
    fn deleting_a_nested_archive_or_an_entry_inside_one() {
        // Д42
        let report = done(
            Base::Update,
            &[(Delete, "update:/x64/data/cdimages/scaleform_other.rpf", "")],
        );
        assert_eq!(
            report.log,
            ["[Injector] Удален: x64/data/cdimages/scaleform_other.rpf"]
        );
        assert_eq!(
            report.sha,
            "a3caeb87e6b04d3727db8a145906e8405876cb9c793ecb6e1a04f1ee7293b765"
        );
        // Д43
        let report = done(
            Base::Update,
            &[(
                Delete,
                "update:/x64/data/cdimages/scaleform_generic.rpf/inner/deep.xml",
                "",
            )],
        );
        assert_eq!(
            report.checks,
            ["Absent x64/data/cdimages/scaleform_generic.rpf/inner/deep.xml"]
        );
        assert_eq!(
            report.removed,
            [
                "x64/data/cdimages/scaleform_generic.rpf  archive entries=6",
                "x64/data/cdimages/scaleform_generic.rpf/inner/deep.xml  bin cmp=1 enc=0 unc=700 sha=*"
            ]
        );
        assert_eq!(
            report.added,
            ["x64/data/cdimages/scaleform_generic.rpf  archive entries=5"]
        );
        assert_eq!(
            report.sha,
            "336c5d86da09055cff030abc0f156924cbd29b5e1c3f6b4154b91e09597de377"
        );
    }

    // ----- вложенные архивы (Д52-Д61, Д65-Д67) -----

    #[test]
    fn reaching_a_nested_archive_rewrites_it_even_when_nothing_changes_inside() {
        // Д52 и e5-nested-dir-missing: состав тот же, байты корня другие
        let report = done(
            Base::Update,
            &[(
                Import,
                "update:/x64/data/cdimages/scaleform_generic.rpf/sub.rpf/y.xml",
                "new.xml",
            )],
        );
        assert!(report.log.is_empty() && report.checks.is_empty());
        assert!(report.removed.is_empty() && report.added.is_empty());
        assert_eq!(
            report.sha,
            "402a58b51c7a99e0f61908f718ea2daf58ed363f4eae634c73095a20c0ebbf84"
        );
        assert_ne!(report.sha, report.base_sha);
        assert_eq!(report.base_sha, UPDATE_SHA);
    }

    #[test]
    fn a_whole_nested_archive_is_a_binary_entry_and_silences_what_follows_inside_it() {
        let other = "update:/x64/data/cdimages/scaleform_other.rpf";
        // Д53
        let report = done(
            Base::Update,
            &[(
                Import,
                "update:/x64/data/cdimages/imported.rpf",
                "nested.rpf",
            )],
        );
        assert_eq!(report.log, ["  -> Импортирован (Binary): imported.rpf"]);
        assert_eq!(
            report.checks,
            ["Archive x64/data/cdimages/imported.rpf \u{2190} nested.rpf"]
        );
        assert_eq!(
            report.added,
            [
                "x64/data/cdimages/imported.rpf  archive entries=2",
                "x64/data/cdimages/imported.rpf/new_inside.xml  bin cmp=1 enc=0 unc=333 sha=*"
            ]
        );
        assert_eq!(
            report.sha,
            "92b1fd7db7bb2b01290a2d8ec0fa19e0b58f91b6b4421ce89530b8581a08529b"
        );
        // Д54, Д55, Д56: записи внутри целиком положенного архива пропускаются
        let acts_sets: [Vec<Act<'_>>; 3] = [
            vec![(Replace, other, "nested.rpf")],
            vec![
                (Replace, other, "nested.rpf"),
                (
                    Import,
                    "update:/x64/data/cdimages/scaleform_other.rpf/extra.xml",
                    "new.xml",
                ),
            ],
            vec![
                (Replace, other, "nested.rpf"),
                (
                    Delete,
                    "update:/x64/data/cdimages/scaleform_other.rpf/new_inside.xml",
                    "",
                ),
            ],
        ];
        for acts in &acts_sets {
            let report = done(Base::Update, acts);
            assert_eq!(report.log, ["  -> Заменен (Binary): scaleform_other.rpf"]);
            assert_eq!(
                report.checks,
                ["Archive x64/data/cdimages/scaleform_other.rpf \u{2190} nested.rpf"]
            );
            assert_eq!(
                report.sha,
                "40ad8d720172131d6ba2bfcd71a295e42515e018df63143e0e9509524f4d333a"
            );
        }
        // Д57: файл, который не архив, принимается; проверка готового файла разберётся
        let report = done(Base::Update, &[(Replace, other, "bad.rpf")]);
        assert_eq!(
            report.checks,
            ["Archive x64/data/cdimages/scaleform_other.rpf \u{2190} bad.rpf"]
        );
        assert_eq!(
            report.removed,
            [
                "x64/data/cdimages/scaleform_other.rpf  archive entries=2",
                "x64/data/cdimages/scaleform_other.rpf/keep.xml  bin cmp=1 enc=0 unc=600 sha=*"
            ]
        );
        assert_eq!(
            report.added,
            ["x64/data/cdimages/scaleform_other.rpf  bin cmp=0 enc=0 unc=1500 sha=*"]
        );
    }

    #[test]
    fn a_broken_nested_archive_and_a_folder_named_like_one() {
        // Д58-Д59: записи внутри не открывающегося вложенного архива пропускаются
        for act in [
            (Import, "update:/bad.rpf/x.xml", "new.xml"),
            (Delete, "update:/bad.rpf/x.xml", ""),
        ] {
            unchanged(&done(Base::Custom, &[act]));
        }
        // Д60: каталог z.rpf важнее архива
        let report = done(Base::Custom, &[(Replace, "update:/z.rpf/y.txt", "new.xml")]);
        assert_eq!(report.log, ["  -> Заменен (Binary): y.txt"]);
        assert_eq!(report.checks, ["Binary z.rpf/y.txt \u{2190} new.xml"]);
        assert_eq!(
            report.removed,
            ["z.rpf/y.txt  bin cmp=1 enc=0 unc=100 sha=*"]
        );
        assert_eq!(report.added, ["z.rpf/y.txt  bin cmp=1 enc=0 unc=200 sha=*"]);
        // Д61
        let report = done(
            Base::Custom,
            &[(Import, "update:/z.rpf/deeper/y.txt", "new.xml")],
        );
        assert_eq!(
            report.checks,
            ["Binary z.rpf/deeper/y.txt \u{2190} new.xml"]
        );
        assert_eq!(
            report.added,
            [
                "z.rpf/deeper/",
                "z.rpf/deeper/y.txt  bin cmp=1 enc=0 unc=200 sha=*"
            ]
        );
    }

    #[test]
    fn entries_inside_nested_archives_of_the_custom_base() {
        // Д65
        let report = done(
            Base::Custom,
            &[(Replace, "update:/x64/astral/c.rpf/one.ydd", "new.xml")],
        );
        assert_eq!(report.log, ["  -> Заменен (Binary): one.ydd"]);
        assert_eq!(
            report.removed,
            ["x64/astral/c.rpf/one.ydd  bin cmp=1 enc=0 unc=300 sha=*"]
        );
        assert_eq!(
            report.added,
            ["x64/astral/c.rpf/one.ydd  bin cmp=1 enc=0 unc=200 sha=*"]
        );
        // Д66: удаление единственной записи
        let report = done(
            Base::Custom,
            &[(Delete, "update:/x64/astral/c.rpf/one.ydd", "")],
        );
        assert_eq!(report.log, ["[Injector] Удален: x64/astral/c.rpf/one.ydd"]);
        assert_eq!(
            report.removed,
            [
                "x64/astral/c.rpf  archive entries=2",
                "x64/astral/c.rpf/one.ydd  bin cmp=1 enc=0 unc=300 sha=*"
            ]
        );
        assert_eq!(report.added, ["x64/astral/c.rpf  archive entries=1"]);
        // Д67: импорт рядом с каталогом d
        let report = done(
            Base::Custom,
            &[(Import, "update:/good.rpf/d/new.xml", "new.xml")],
        );
        assert_eq!(report.removed, ["good.rpf  archive entries=4"]);
        assert_eq!(
            report.added,
            [
                "good.rpf  archive entries=5",
                "good.rpf/d/new.xml  bin cmp=1 enc=0 unc=200 sha=*"
            ]
        );
    }

    // ----- порядок и схлопывание (Д68-Д71) и пустой список -----

    #[test]
    fn the_last_action_over_a_path_wins_and_the_prefix_makes_a_different_path() {
        // Д68: два действия над одним путём в разном написании
        let report = done(
            Base::Update,
            &[
                (Import, "update:/common/data/dup.xml", "new.xml"),
                (Import, "UPDATE:\\Common\\Data\\DUP.xml", "new2.xml"),
            ],
        );
        assert_eq!(report.log, ["  -> Импортирован (Binary): DUP.xml"]);
        assert_eq!(
            report.checks,
            ["Binary Common/Data/DUP.xml \u{2190} new2.xml"]
        );
        assert_eq!(
            report.added,
            ["common/data/DUP.xml  bin cmp=1 enc=0 unc=210 sha=*"]
        );
        // Д69: с префиксом и без него - разные ключи, применяются оба: сначала без префикса
        let report = done(
            Base::Update,
            &[
                (Import, "update:/common/data/dup.xml", "new.xml"),
                (Import, "common/data/dup.xml", "new2.xml"),
            ],
        );
        assert_eq!(
            report.log,
            [
                "  -> Импортирован (Binary): dup.xml",
                "  -> Импортирован (Binary): dup.xml"
            ]
        );
        assert_eq!(
            report.checks,
            [
                "Binary common/data/dup.xml \u{2190} new2.xml",
                "Binary common/data/dup.xml \u{2190} new.xml"
            ]
        );
        assert_eq!(
            report.added,
            ["common/data/dup.xml  bin cmp=1 enc=0 unc=200 sha=*"]
        );
        // Д70: импорт, удаление, снова импорт одного пути - остаётся последний импорт
        let report = done(
            Base::Update,
            &[
                (Import, "update:/common/data/dup.xml", "new.xml"),
                (Delete, "update:/common/data/dup.xml", ""),
                (Import, "update:/common/data/dup.xml", "new2.xml"),
            ],
        );
        assert_eq!(report.log, ["  -> Импортирован (Binary): dup.xml"]);
        assert_eq!(
            report.added,
            ["common/data/dup.xml  bin cmp=1 enc=0 unc=210 sha=*"]
        );
        // и наоборот: последним стоит удаление
        let report = done(
            Base::Update,
            &[
                (Import, "update:/common/data/old.xml", "new.xml"),
                (Delete, "update:/common/data/old.xml", ""),
            ],
        );
        assert_eq!(report.log, ["[Injector] Удален: common/data/old.xml"]);
        // без действий дерево и записанный архив те же
        unchanged(&done(Base::Update, &[]));
    }

    #[test]
    fn actions_run_in_the_order_of_the_paths_not_of_the_manifest() {
        // Д71
        let report = done(
            Base::Update,
            &[
                (
                    Import,
                    "update:/x64/data/cdimages/scaleform_generic.rpf/added.xml",
                    "new.xml",
                ),
                (Import, "update:/x64/data/a.xml", "new2.xml"),
                (Delete, "update:/common/data/old.xml", ""),
                (Replace, "update:/content.xml", "new.xml"),
            ],
        );
        assert_eq!(
            report.log,
            [
                "[Injector] Удален: common/data/old.xml",
                "  -> Заменен (Binary): content.xml",
                "  -> Импортирован (Binary): a.xml",
                "  -> Импортирован (Binary): added.xml"
            ]
        );
        assert_eq!(
            report.checks,
            [
                "Absent common/data/old.xml",
                "Binary content.xml \u{2190} new.xml",
                "Binary x64/data/a.xml \u{2190} new2.xml",
                "Binary x64/data/cdimages/scaleform_generic.rpf/added.xml \u{2190} new.xml"
            ]
        );
    }

    #[test]
    fn a_failure_keeps_what_was_done_but_returns_no_checks() {
        // А-13: после небезопасной цели прежние изменения остаются в дереве
        let lab = tempdir().unwrap();
        let patch = lab.path().join("patch");
        fs::create_dir_all(&patch).unwrap();
        fs::write(patch.join("new.xml"), text(200, "new")).unwrap();
        let base = lab.path().join("base.rpf");
        write_to(&update_tree(None), &base);
        let mut root = DirNode::from_archive(&open(&base));
        let owned = [
            action(&(Delete, "update:/common/data/old.xml", "")),
            action(&(Delete, "update:/zzz/../content.xml", "")),
        ];
        let refs: Vec<&PatchAction> = owned.iter().collect();
        let mut log = Vec::new();
        let error = apply(&mut root, &refs, &patch, &mut |line| log.push(line)).unwrap_err();
        assert_eq!(error.code, "InvalidDataException");
        assert_eq!(log, ["[Injector] Удален: common/data/old.xml"]);
        let data = root.find_dir("common").unwrap().find_dir("data").unwrap();
        assert!(data.find_file("old.xml").is_none() && data.find_file("a.xml").is_some());
    }
}
