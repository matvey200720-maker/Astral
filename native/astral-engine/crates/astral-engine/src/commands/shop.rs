//! `shop-embed-textures` и общие помощники соседних команд.
//!
//! Команда подменяет лист текстуры во встроенном словаре модели `.ydr`. Те же приёмы
//! нужны `decorate`, `lamp-pole`, `restyle*` и `split`, поэтому вписывание листа
//! (`embed_sheet`), проверка имени, чтение DDS и запись через черновик вынесены наружу.

use std::{
    ffi::OsStr,
    fmt, fs,
    ops::RangeInclusive,
    path::{Path, PathBuf},
};

use rage_res::{
    dds::{self, Dds},
    drawable::read_materials,
    hash::joaat,
    meta_graph::deflate_body,
    resource::{self, Resource},
    resource_graph::{self as rgraph, Address, Graph, Segment},
    texture::Format,
    ytd_write::{self, Edit, Entry, NewTexture, TEXTURE_BYTES},
};
use serde_json::{Map, Value};

use super::Command;
use crate::{
    args::Options,
    error::{EngineError, Result},
    paths,
    progress::Progress,
};

pub(super) use rage_res::donor::{redirect, texture_objects};

const REQUEST_FORMAT: &str = "astral.shop-embed-textures";
const SHEETS_ALLOWED: RangeInclusive<usize> = 1..=96;
const NAME_BYTES: RangeInclusive<usize> = 1..=160;
const SIDE_RANGE: RangeInclusive<u16> = 4..=4096;
const NAME_PUNCTUATION: &[u8] = b"_.+-";
const STAGE_SUFFIX: &str = ".shop-stage";
/// Предел длины одного имени файла: 255 единиц (знаков UTF-16 на Windows, байт на остальных ОС).
const NAME_UNITS_MAX: usize = 255;
const REQUEST_KINDS: &[&str] = &[".json"];
const MODEL_KINDS: &[&str] = &[".ydr"];
const PICTURE_KINDS: &[&str] = &[".dds"];
const DICTIONARY_KINDS: &[&str] = &[".ytd"];
/// Сторона листа-пустышки, по которому писатель делает свежий словарь ради заголовка.
const STAND_IN_SIDE: u16 = 4;
/// Указатель корня модели на группу шейдеров и указатель группы на встроенный словарь.
const GROUP_AT: usize = 0x10;
const DICTIONARY_AT: usize = 0x08;

// ---------------------------------------------------------------------------------------------
// Отказы
// ---------------------------------------------------------------------------------------------

/// Отказы с общей приставкой команды; все идут как `InvalidDataException`.
enum Refusal<'a> {
    Json,
    Format,
    Target,
    List,
    Count,
    SheetName,
    DonorName,
    NoRoot,
    NoGroup,
    GroupOutside,
    Unused(&'a str),
    Size(&'a str),
    NoDictionary,
    NoSource(&'a str),
    SourceLacks(&'a str),
}

impl Refusal<'_> {
    fn words(&self) -> String {
        let tail = match self {
            Refusal::Json => "JSON не разбирается.".to_owned(),
            Refusal::Format => "неизвестный формат запроса.".to_owned(),
            Refusal::Target => "нужен target.".to_owned(),
            Refusal::List => "нужен список textures.".to_owned(),
            Refusal::Count => "от 1 до 96 текстур.".to_owned(),
            Refusal::SheetName => "имя текстуры не допускается.".to_owned(),
            Refusal::DonorName => "имя штатной текстуры не допускается.".to_owned(),
            Refusal::NoRoot => "у модели нет корня.".to_owned(),
            Refusal::NoGroup => "у модели нет группы шейдеров.".to_owned(),
            Refusal::GroupOutside => "группа вне блоков.".to_owned(),
            Refusal::Unused(name) => format!("модель не использует текстуру {name}."),
            Refusal::Size(name) => format!("размер {name} вне 4–4096."),
            Refusal::NoDictionary => {
                "у группы нет словаря текстур; такая модель не поддержана.".to_owned()
            }
            Refusal::NoSource(name) => format!("нет источника для {name}."),
            Refusal::SourceLacks(name) => format!("в словаре источника нет текстуры {name}."),
        };
        format!("shop-embed-textures: {tail}")
    }
}

impl fmt::Display for Refusal<'_> {
    fn fmt(&self, out: &mut fmt::Formatter<'_>) -> fmt::Result {
        out.write_str(&self.words())
    }
}

impl From<Refusal<'_>> for EngineError {
    fn from(refusal: Refusal<'_>) -> Self {
        EngineError::invalid_data(refusal.words())
    }
}

// ---------------------------------------------------------------------------------------------
// Помощники для соседей
// ---------------------------------------------------------------------------------------------

/// Имя листа в понимании хоста: 1…160 байт из `a–z 0–9 _ . + -`.
pub(super) fn valid_name(name: &str) -> bool {
    let allowed = |byte: &u8| {
        byte.is_ascii_lowercase() || byte.is_ascii_digit() || NAME_PUNCTUATION.contains(byte)
    };
    NAME_BYTES.contains(&name.len()) && name.as_bytes().iter().all(allowed)
}

/// Новый лист из DDS-файла; стороны обязаны лежать в 4…4096.
pub(super) fn texture_of(name: &str, dds_path: &Path) -> Result<NewTexture> {
    let bytes = fs::read(dds_path)?;
    let Dds {
        width,
        height,
        levels,
        format,
        payload,
    } = dds::parse(&bytes)?;
    let fits = |side: u32| {
        u16::try_from(side)
            .ok()
            .filter(|known| SIDE_RANGE.contains(known))
    };
    match (fits(width), fits(height)) {
        (Some(width), Some(height)) => Ok(NewTexture {
            name: name.to_owned(),
            width,
            height,
            format,
            levels,
            payload,
        }),
        _ => Err(Refusal::Size(name).into()),
    }
}

/// Черновик рядом с выходом: если до переименования дело не дошло, файл убирается.
struct Draft {
    path: PathBuf,
    settled: bool,
}

impl Drop for Draft {
    fn drop(&mut self) {
        if !self.settled {
            let _ = fs::remove_file(&self.path);
        }
    }
}

/// Запись через соседний черновик `<выход>.shop-stage`; родительскую папку не создаёт.
///
/// Прежний выход цел, пока новый не записан целиком: сбой записи черновика (диск полон, отказ ОС)
/// убирает черновик и ничего не меняет. Существующий выход остаётся под своим написанием имени,
/// как при прямой записи, а отказы на тех же входах такие же, как у неё. Имени, к которому
/// приставка черновика не влезает в предел длины имени, черновик не заводят: оно пишется прямо.
pub(super) fn write_atomic(output: &Path, bytes: &[u8]) -> Result<()> {
    write_atomic_with(output, bytes, |path, bytes| fs::write(path, bytes))
}

/// Тот же путь, но запись черновика подставляется: так проверяется сбой посреди записи.
fn write_atomic_with(
    output: &Path,
    bytes: &[u8],
    write_draft: impl FnOnce(&Path, &[u8]) -> std::io::Result<()>,
) -> Result<()> {
    let Some(path) = stage_beside(output) else {
        fs::write(output, bytes)?;
        return Ok(());
    };
    // Охранник встаёт до записи: обрезанный черновик тоже убирается.
    let mut draft = Draft {
        path,
        settled: false,
    };
    write_draft(&draft.path, bytes)?;
    rename_patiently(&draft.path, &spelled_like_existing(output))?;
    draft.settled = true;
    Ok(())
}

/// Паузы между попытками переименования, мс: растут вдвое, всего около 1,5 с.
const RENAME_PAUSES_MS: [u64; 5] = [50, 100, 200, 400, 800];

/// Переименование черновика с коротким повтором: антивирус или индексатор на доли секунды держат
/// свежий черновик или прежний результат, и Windows отвечает кодом 5 (доступ закрыт) или 32 (файл занят).
fn rename_patiently(from: &Path, to: &Path) -> std::io::Result<()> {
    rename_retrying(
        from,
        to,
        |from, to| fs::rename(from, to),
        |pause| std::thread::sleep(pause),
    )
}

/// Повтор с подставными переименованием и паузой. Повторяются только временные отказы
/// (см. `is_transient`); любая другая ошибка и последняя неудача отдаются как есть.
fn rename_retrying(
    from: &Path,
    to: &Path,
    mut rename: impl FnMut(&Path, &Path) -> std::io::Result<()>,
    mut pause: impl FnMut(std::time::Duration),
) -> std::io::Result<()> {
    let mut waits = RENAME_PAUSES_MS.iter();
    loop {
        match rename(from, to) {
            Err(failure) if is_transient(&failure, to) => match waits.next() {
                Some(ms) => pause(std::time::Duration::from_millis(*ms)),
                None => return Err(failure),
            },
            outcome => return outcome,
        }
    }
}

/// Занятость, которая может пройти сама: коды Windows 5 и 32. Постоянные причины с тем же кодом -
/// выход уже папка или файл только для чтения - отказывают сразу, как и раньше.
fn is_transient(failure: &std::io::Error, target: &Path) -> bool {
    cfg!(windows)
        && matches!(failure.raw_os_error(), Some(5 | 32))
        && !target.is_dir()
        && !fs::metadata(target).is_ok_and(|meta| meta.permissions().readonly())
}

/// Путь черновика рядом с выходом; `None`, если у выхода нет имени или приставка не влезает в имя.
fn stage_beside(output: &Path) -> Option<PathBuf> {
    let name = output.file_name()?;
    if name_units(name) + STAGE_SUFFIX.len() > NAME_UNITS_MAX {
        return None;
    }
    let mut stage_name = output.as_os_str().to_owned();
    stage_name.push(STAGE_SUFFIX);
    Some(PathBuf::from(stage_name))
}

/// Длина имени в тех единицах, что считает предел файловой системы: знаки UTF-16 на Windows, байты иначе.
fn name_units(name: &OsStr) -> usize {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        name.encode_wide().count()
    }
    #[cfg(not(windows))]
    {
        name.as_encoded_bytes().len()
    }
}

/// Куда ставить черновик: у существующего выхода - путь с его настоящим написанием имени
/// (переименование на путь другого регистра переименовало бы сам файл); иначе путь как есть.
fn spelled_like_existing(output: &Path) -> PathBuf {
    let real = fs::canonicalize(output).ok();
    let real = real.as_deref().and_then(Path::file_name);
    match (real, output.file_name()) {
        (Some(real), Some(asked)) if real != asked && same_letters(real, asked) => {
            output.with_file_name(real)
        }
        _ => output.to_path_buf(),
    }
}

/// Имена различаются только регистром букв.
fn same_letters(left: &OsStr, right: &OsStr) -> bool {
    left.to_string_lossy().to_lowercase() == right.to_string_lossy().to_lowercase()
}

/// Лист-пустышка, по которому писатель делает свежий словарь ради заголовка.
fn header_stand_in() -> NewTexture {
    let (format, levels) = (Format::Dxt1, 1);
    let side = usize::from(STAND_IN_SIDE);
    NewTexture {
        name: "astral_header".to_owned(),
        width: STAND_IN_SIDE,
        height: STAND_IN_SIDE,
        format,
        levels,
        payload: vec![0; ytd_write::payload_bytes(format, side, side, usize::from(levels))],
    }
}

/// Заголовок выделяемого словаря: у файла-источника либо у свежего словаря писателя.
pub(super) fn ytd_header(source: Option<&Path>) -> Result<resource::Header> {
    let bytes = match source {
        Some(path) => fs::read(path)?,
        None => ytd_write::write(&[header_stand_in()])?,
    };
    Ok(resource::read_header(&bytes)?)
}

/// Как вписывать лист. Структуру собирают литералом, трейтов у неё нет.
pub(super) struct Flags<'a> {
    pub from: &'a str,
    pub source: Option<&'a Path>,
    pub keep_donor: bool,
    pub prefer_dictionary: bool,
}

/// Служебный объект листа с таким именем (регистр не важен).
fn object_named(entries: &[Entry], wanted: &str) -> Option<[u8; TEXTURE_BYTES]> {
    let found = entries
        .iter()
        .find(|entry| entry.name.eq_ignore_ascii_case(wanted));
    found.map(|entry| entry.object)
}

/// Откуда взять служебные поля нового листа: правила по очереди смотрят в словарь модели,
/// а если ни одно не сработало - в лист источника.
fn pick_template(
    dictionary: &[Entry],
    texture: &NewTexture,
    flags: &Flags,
) -> Result<[u8; TEXTURE_BYTES]> {
    let rules = [
        (flags.keep_donor, texture.name.as_str()),
        (flags.prefer_dictionary, flags.from),
    ];
    let inherited = rules
        .into_iter()
        .filter(|(enabled, _)| *enabled)
        .find_map(|(_, wanted)| object_named(dictionary, wanted));
    if let Some(found) = inherited {
        return Ok(found);
    }
    let source = flags.source.ok_or(Refusal::NoSource(flags.from))?;
    let listed = ytd_write::read_entries(&fs::read(source)?)?;
    object_named(&listed, flags.from).ok_or_else(|| Refusal::SourceLacks(flags.from).into())
}

/// Граф, собранный в файл без перестановок блоков.
fn rebuilt_in_place(graph: &Graph) -> Result<Vec<u8>> {
    let order = |segment| rgraph::identity_order(graph, segment);
    Ok(rgraph::rebuild_with(
        graph,
        &order(Segment::System),
        &order(Segment::Graphics),
        &deflate_body,
    )?)
}

/// Встроенный словарь как отдельный файл Legacy с заголовком источника.
fn standalone_dictionary(graph: &Graph, at: Address, header: &resource::Header) -> Result<Vec<u8>> {
    let mut carved = rgraph::subgraph(graph, at)?;
    (
        carved.declared_version,
        carved.system_flags,
        carved.graphics_flags,
    ) = (
        header.declared_version,
        header.system_flags,
        header.graphics_flags,
    );
    rebuilt_in_place(&carved)
}

/// Новый словарь, пришитый к копии графа: сама копия и адрес корня пришитого.
fn with_dictionary(graph: &Graph, edited: &[u8]) -> Result<(Graph, Address)> {
    let fresh = rgraph::scan(&Resource::parse(edited)?)?;
    Ok(rgraph::graft(graph, &fresh)?)
}

/// Шейдеры переводятся с прежних объектов текстур на одноимённые объекты нового словаря.
fn redirect_twins(
    graph: &mut Graph,
    replaced: Vec<(String, Address)>,
    fresh_root: Address,
) -> Result<()> {
    let current = texture_objects(graph, fresh_root)?;
    let moves: Vec<(Address, Address)> = replaced
        .into_iter()
        .filter_map(|(name, old)| {
            let twin = current
                .iter()
                .find(|(known, _)| known.eq_ignore_ascii_case(&name));
            twin.map(|&(_, new)| (old, new))
        })
        .collect();
    moves
        .into_iter()
        .for_each(|(old, new)| redirect(graph, old, new));
    Ok(())
}

/// Вписывает лист во встроенный словарь группы шейдеров `group`. Старый словарь остаётся в
/// графе мусором; граф меняется целиком только после того, как все шаги прошли.
pub(super) fn embed_sheet(
    graph: &mut Graph,
    group: usize,
    texture: NewTexture,
    flags: Flags,
) -> Result<()> {
    let dictionary =
        rgraph::pointer_from(graph, group, DICTIONARY_AT).ok_or(Refusal::NoDictionary)?;
    let replaced = texture_objects(graph, dictionary)?;
    let header = ytd_header(flags.source)?;

    let standalone = standalone_dictionary(graph, dictionary, &header)?;
    let template = pick_template(&ytd_write::read_entries(&standalone)?, &texture, &flags)?;
    let edit = Edit::AddFrom { texture, template };
    let edited = ytd_write::edit(&standalone, &[edit])?;

    let (mut next, fresh_root) = with_dictionary(graph, &edited)?;
    rgraph::retarget(&mut next, group, DICTIONARY_AT, fresh_root)?;
    redirect_twins(&mut next, replaced, fresh_root)?;
    *graph = next;
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// Запрос
// ---------------------------------------------------------------------------------------------

/// Один лист запроса после проверки имён и файлов.
struct Sheet {
    name: String,
    from: String,
    dds: PathBuf,
    source: PathBuf,
}

struct Request {
    target: String,
    sheets: Vec<Sheet>,
}

fn text_at<'v>(node: &'v Value, key: &str) -> Option<&'v str> {
    node.get(key)?.as_str()
}

/// Имя из запроса: края срезаны, регистр нижний, допустимо только по правилу хоста.
fn tidy_name(raw: &str) -> Option<String> {
    let name = raw.trim().to_lowercase();
    valid_name(&name).then_some(name)
}

impl Sheet {
    fn from_node(node: &Value) -> Result<Sheet> {
        let name =
            tidy_name(text_at(node, "name").unwrap_or_default()).ok_or(Refusal::SheetName)?;
        let from = match text_at(node, "from").filter(|raw| !raw.is_empty()) {
            Some(raw) => tidy_name(raw).ok_or(Refusal::DonorName)?,
            None => name.clone(),
        };
        Ok(Sheet {
            dds: paths::existing_file(text_at(node, "dds").unwrap_or_default(), PICTURE_KINDS)?,
            source: paths::existing_file(
                text_at(node, "source").unwrap_or_default(),
                DICTIONARY_KINDS,
            )?,
            name,
            from,
        })
    }
}

impl Sheet {
    /// Правила вписывания команды: образец служебных полей берётся из источника запроса.
    fn flags(&self) -> Flags<'_> {
        let (from, source) = (self.from.as_str(), self.source.as_path());
        Flags {
            from,
            source: Some(source),
            keep_donor: true,
            prefer_dictionary: false,
        }
    }
}

impl Request {
    fn read(path: &Path) -> Result<Request> {
        let root: Value =
            serde_json::from_str(&fs::read_to_string(path)?).map_err(|_| Refusal::Json)?;
        let version_one = root.get("version").and_then(Value::as_u64) == Some(1);
        if text_at(&root, "format") != Some(REQUEST_FORMAT) || !version_one {
            return Err(Refusal::Format.into());
        }
        let target = text_at(&root, "target").ok_or(Refusal::Target)?;
        let listed = root
            .get("textures")
            .and_then(Value::as_array)
            .ok_or(Refusal::List)?;
        if !SHEETS_ALLOWED.contains(&listed.len()) {
            return Err(Refusal::Count.into());
        }
        Ok(Request {
            target: target.to_owned(),
            sheets: listed.iter().map(Sheet::from_node).collect::<Result<_>>()?,
        })
    }
}

// ---------------------------------------------------------------------------------------------
// Модель
// ---------------------------------------------------------------------------------------------

/// Чем модель «пользуется»: имена листов в сэмплерах шейдеров и хеши имён параметров.
struct Usage {
    names: Vec<String>,
    hashes: Vec<u32>,
}

impl Usage {
    fn of(resource: &Resource) -> Result<Usage> {
        let (_, materials, _) = read_materials(resource, 0)?;
        let samplers: Vec<_> = materials
            .iter()
            .flatten()
            .flat_map(|material| &material.samplers)
            .collect();
        Ok(Usage {
            names: samplers
                .iter()
                .filter_map(|sampler| sampler.texture.clone())
                .collect(),
            hashes: samplers.iter().map(|sampler| sampler.hash).collect(),
        })
    }

    fn covers(&self, sheet: &str) -> bool {
        let named = self
            .names
            .iter()
            .any(|known| known.eq_ignore_ascii_case(sheet));
        named || self.hashes.contains(&joaat(sheet))
    }
}

/// Разобранная модель и блок её группы шейдеров.
struct Shell {
    graph: Graph,
    group: usize,
}

impl Shell {
    fn open(resource: &Resource) -> Result<Shell> {
        let graph = rgraph::scan(resource)?;
        let root = graph.root().ok_or(Refusal::NoRoot)?;
        let group_at = rgraph::pointer_from(&graph, root, GROUP_AT).ok_or(Refusal::NoGroup)?;
        let group = graph.block_at(group_at).ok_or(Refusal::GroupOutside)?;
        Ok(Shell { graph, group })
    }

    /// Один лист запроса: модель обязана им пользоваться, потом картинка, потом вписывание.
    fn embed_one(&mut self, sheet: &Sheet, usage: &Usage) -> Result<String> {
        if !usage.covers(&sheet.name) {
            return Err(Refusal::Unused(&sheet.name).into());
        }
        let texture = texture_of(&sheet.name, &sheet.dds)?;
        embed_sheet(&mut self.graph, self.group, texture, sheet.flags())?;
        Ok(sheet.name.clone())
    }

    /// Вписывает все листы по порядку; имена в ответе идут как в запросе.
    fn embed_all(&mut self, sheets: &[Sheet], usage: &Usage) -> Result<Vec<String>> {
        sheets
            .iter()
            .map(|sheet| self.embed_one(sheet, usage))
            .collect()
    }

    /// Файл модели: подграф от корня системной области без мусора старых словарей.
    fn to_file(&self) -> Result<Vec<u8>> {
        let root = Address {
            segment: Segment::System,
            offset: 0,
        };
        rebuilt_in_place(&rgraph::subgraph(&self.graph, root)?)
    }
}

fn answer(output: &Path, embedded: Vec<String>, written: usize) -> Value {
    let mut fields = Map::new();
    fields.insert("status".to_owned(), "ready".into());
    fields.insert("mode".to_owned(), "shop-embed-textures".into());
    fields.insert("output".to_owned(), output.display().to_string().into());
    fields.insert("embedded".to_owned(), embedded.into());
    fields.insert("outputBytes".to_owned(), written.into());
    Value::Object(fields)
}

/// Модель целиком: разбор, вписывание всех листов и готовые байты с именами листов.
fn rebuilt_model(target: &Path, sheets: &[Sheet]) -> Result<(Vec<String>, Vec<u8>)> {
    let resource = Resource::parse(&fs::read(target)?)?;
    let mut shell = Shell::open(&resource)?;
    let usage = Usage::of(&resource)?;
    let embedded = shell.embed_all(sheets, &usage)?;
    Ok((embedded, shell.to_file()?))
}

/// Проверенные пути и запрос: файл запроса, модель-цель и выход.
struct Job {
    request: Request,
    target: PathBuf,
    output: PathBuf,
}

impl Job {
    fn resolve(options: &Options) -> Result<Job> {
        let request_file = paths::existing_file(options.required("input")?, REQUEST_KINDS)?;
        let request = Request::read(&request_file)?;
        let target = paths::existing_file(&request.target, MODEL_KINDS)?;
        let output = paths::output_file(options.required("output")?, MODEL_KINDS)?;
        Ok(Job {
            request,
            target,
            output,
        })
    }
}

fn run_embed(options: &Options, _progress: &Progress) -> Result<Value> {
    let job = Job::resolve(options)?;
    let (embedded, bytes) = rebuilt_model(&job.target, &job.request.sheets)?;
    write_atomic(&job.output, &bytes)?;
    Ok(answer(&job.output, embedded, bytes.len()))
}

const EMBED_TEXTURES: Command = Command::new("shop-embed-textures", run_embed);

pub const COMMANDS: &[Command] = &[EMBED_TEXTURES];

#[cfg(test)]
mod tests;
