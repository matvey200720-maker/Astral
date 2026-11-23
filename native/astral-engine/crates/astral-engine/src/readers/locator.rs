//! Поиск записей эффектов в описи `update.rpf` игрока.
//!
//! У игрока ядро эффектов (`ptfx.rpf/core.ypt`) и словари-доноры могут лежать не
//! по штатному пути: сборки переносят их во вложенные архивы, а игра берёт то,
//! что подключает `content.xml`. Модуль чистый: опись, список подключённых
//! архивов и вопрос к `common.rpf` приходят от вызывающего.

use std::{
    cmp::Reverse,
    collections::{BTreeSet, HashSet},
};

/// Три варианта ядра по качеству частиц; штатное — первое.
pub const CORE_ARCHIVES: [&str; 3] = ["ptfx.rpf", "ptfx_hi.rpf", "ptfx_lo.rpf"];

/// Знаки препинания в порядке сортировки копий (пробел замыкает ряд).
const PUNCT_ORDER: &str = "_-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$ ";

// Короткие имена для типов из подписей: это те же самые типы.
type Place = Option<Located>;
type Hit = Option<Found>;
type Mounts = HashSet<String>;
type CopyKey = (bool, Reverse<usize>, Vec<(u8, u32)>, String);

// ---------- описания типов ----------

/// Описывает публичную структуру по списку «поле => тип»: все поля открыты.
macro_rules! open_fields {
    (
        $(#[$meta:meta])*
        $name:ident $(<$life:lifetime>)? { $($(#[$fmeta:meta])* $field:ident => $ty:ty;)+ }
    ) => {
        $(#[$meta])*
        pub struct $name $(<$life>)? {
            $($(#[$fmeta])* pub $field: $ty,)+
        }
    };
}

/// Ставит над описанием перечень производных свойств.
macro_rules! with_derives {
    ([$($derived:ident),+ $(,)?] $item:item) => {
        #[derive($($derived),+)]
        $item
    };
}

/// Вопрос к `common.rpf` о записи.
type Ask<'a> = dyn Fn(&str) -> Option<bool> + 'a;

/// Спрашивает `common.rpf`: есть ли запись; `None` — архив не открылся.
pub type CommonHas<'a> = Box<Ask<'a>>;

open_fields! {
    /// Копия файла в другом месте описи.
    #[derive(Clone, Debug)]
    Relocated {
        mounted => bool;
        container => String;
        inner => String;
    }
}

open_fields! {
    #[derive(Clone, Debug, Default)]
    FindOptions<'a> {
        relocate => Relocate;
        alternatives => &'a [String];
        exclude => &'a [String];
    }
}

with_derives! {
    [Clone, Copy, Debug, Default, PartialEq, Eq]
    /// Насколько далеко искать копии вне заданных мест.
    pub enum Relocate {
        Any,
        Mounted,
        #[default]
        None,
    }
}

with_derives! {
    [Clone, Debug, PartialEq, Eq]
    pub enum Found {
        /// Пути внутри `update.rpf` нескольких подключённых копий: выбрать нечем.
        Ambiguous(Vec<String>),
        Entry(Located),
    }
}

open_fields! {
    /// Где читать запись: `update:/…` или `common:/…`.
    #[derive(Clone, Debug, PartialEq, Eq)]
    Located {
        /// Только у `relocated`: подключён ли архив с копией.
        mounted => Option<bool>;
        /// `standard`, `alternative`, `relocated` или `common`.
        how => &'static str;
        entry => String;
    }
}

impl Found {
    pub fn located(&self) -> Option<&Located> {
        match self {
            Found::Ambiguous(_) => None,
            Found::Entry(place) => Some(place),
        }
    }

    /// Место, если поиск дал ровно одно.
    fn into_place(self) -> Place {
        match self {
            Found::Ambiguous(_) => None,
            Found::Entry(place) => Some(place),
        }
    }
}

/// Место без признака подключения (всё, кроме `relocated`).
fn located(entry: String, how: &'static str) -> Located {
    Located {
        how,
        mounted: None,
        entry,
    }
}

// ---------- пути ----------

/// Единый вид пути: косые вперёд, регистр по Юникоду.
fn flatten(path: &str) -> String {
    str::to_lowercase(path).replace('\\', "/")
}

fn under_update(inner: &str) -> String {
    String::from("update:/") + inner
}

/// Словари пакетов DLC лежат под этой приставкой и копиями не считаются.
fn is_dlc_pack(inner: &str) -> bool {
    inner
        .strip_prefix("dlc_patch")
        .is_some_and(|rest| rest.starts_with('/'))
}

/// Путь внутри `update.rpf` из записи вида `update:/…` (без приставки — как есть).
pub fn update_inner(entry: &str) -> String {
    match flatten(entry) {
        flat if !flat.starts_with("update:") => flat,
        flat => flat["update:".len()..].trim_start_matches('/').to_string(),
    }
}

/// Вложенный архив, в котором лежит запись: всё до конца последнего `.rpf` перед косой.
pub fn container_of(inner: &str) -> &str {
    let end = inner.rfind(".rpf/").map_or(0, |at| at + 4);
    &inner[..end]
}

/// Штатное место ядра эффектов выбранного качества.
pub fn core_entry(archive: &str) -> String {
    let mut path = String::from("update:/x64/patch/data/effects/");
    path.push_str(archive);
    path.push_str("/core.ypt");
    path
}

// ---------- разбор content.xml без XML ----------

/// Начинается ли срез с образца (без учёта регистра ASCII).
fn begins_with_ci(bytes: &[u8], pattern: &str) -> bool {
    bytes.len() >= pattern.len() && bytes[..pattern.len()].eq_ignore_ascii_case(pattern.as_bytes())
}

/// Где конечный автомат стоит при поиске блока.
enum Seek {
    /// Ждём `<тег>`.
    Open,
    /// Тело блока началось с этого смещения, ждём `</тег>`.
    Body(usize),
}

/// Тела всех блоков `<тег>…</тег>` слева направо за один проход по знакам `<`: тег
/// ищется без учёта регистра ASCII, вложенность не учитывается (блок закрывает первая же
/// `</тег>`), тег без пары ничего не даёт.
fn tag_bodies<'t>(tag: &str, text: &'t str) -> Vec<&'t str> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let mut state = Seek::Open;
    let mut bodies = Vec::new();
    for (at, _) in text.match_indices('<') {
        let here = &text.as_bytes()[at..];
        match &state {
            Seek::Open => {
                if begins_with_ci(here, &open) {
                    state = Seek::Body(at + open.len());
                }
            }
            Seek::Body(from) => {
                if begins_with_ci(here, &close) {
                    bodies.push(&text[*from..at]);
                    state = Seek::Open;
                }
            }
        }
    }
    bodies
}

/// Текст первого блока тега: без краевых пробелов, не пустой и без `<` внутри.
fn tag_text<'t>(tag: &str, body: &'t str) -> Option<&'t str> {
    tag_bodies(tag, body)
        .first()
        .copied()
        .map(|first| first.trim_matches(char::is_whitespace))
        .filter(|inside| !inside.is_empty() && !inside.contains('<'))
}

/// Отрезает от начала строки заданные знаки ASCII без учёта регистра.
fn strip_ascii_ci<'t>(prefix: &str, text: &'t str) -> Option<&'t str> {
    text.get(prefix.len()..)
        .filter(|_| begins_with_ci(text.as_bytes(), prefix))
}

/// Хвост после `<disabled`: пробел, `value`, `=`, `"true"` (пробелы между — любые).
fn says_disabled(tail: &str) -> bool {
    let rest = tail.trim_start_matches(char::is_whitespace);
    // Между `<disabled` и `value` пробел обязателен.
    if rest.len() == tail.len() {
        return false;
    }
    let mut left = rest;
    for word in ["value", "=", "\"true\""] {
        let trimmed = left.trim_start_matches(char::is_whitespace);
        let Some(after) = strip_ascii_ci(word, trimmed) else {
            return false;
        };
        left = after;
    }
    true
}

/// В теле записи есть хотя бы одно подходящее `<disabled value="true"`.
fn item_is_disabled(item: &str) -> bool {
    // Первый кусок — то, что до первого `<disabled`.
    item.to_ascii_lowercase()
        .split("<disabled")
        .skip(1)
        .find(|piece| says_disabled(piece))
        .is_some()
}

/// Путь внутри `update.rpf` из имени архива в `content.xml`; чужие устройства не годятся.
fn mounted_path(name: &str) -> Option<String> {
    let flat = flatten(name);
    let tidy = flat
        .trim_matches(char::is_whitespace)
        .replace("%platform%", "x64");
    tidy.starts_with("update:/")
        .then(|| tidy["update:/".len()..].trim_start_matches('/').to_owned())
}

/// Пути, которые наборы изменений `filesToEnable` включают принудительно.
fn enabled_by_change_sets(xml: &str) -> Mounts {
    tag_bodies("filesToEnable", xml)
        .into_iter()
        .fold(Mounts::new(), |mut forced, section| {
            let names = tag_bodies("Item", section)
                .into_iter()
                .map(|name| name.trim_matches(char::is_whitespace))
                .filter(|name| !name.is_empty() && !name.contains('<'));
            forced.extend(names.filter_map(mounted_path));
            forced
        })
}

/// Запись `dataFiles`: путь архива и выключена ли она; не `RPF_FILE` или без имени — нет.
fn listed_archive(item: &str) -> Option<(String, bool)> {
    let is_archive =
        tag_text("fileType", item).is_some_and(|kind| kind.eq_ignore_ascii_case("RPF_FILE"));
    let name = tag_text("filename", item).filter(|_| is_archive)?;
    mounted_path(name).map(|path| (path, item_is_disabled(item)))
}

/// Архивы внутри `update.rpf`, которые игра подключает по `content.xml`: записи
/// `RPF_FILE` блока `dataFiles`, не выключенные либо включённые набором `filesToEnable`.
/// Регистр путей приведён к нижнему, `%PLATFORM%` заменён на `x64`.
pub fn mounted_archives(xml: &str) -> Mounts {
    let forced = enabled_by_change_sets(xml);
    // Берётся только первый блок `dataFiles`; нет блока — нет и архивов.
    let Some(&block) = tag_bodies("dataFiles", xml).first() else {
        return Mounts::new();
    };
    let mut mounted = Mounts::new();
    for (path, disabled) in tag_bodies("Item", block)
        .into_iter()
        .filter_map(listed_archive)
    {
        if forced.contains(&path) || !disabled {
            mounted.insert(path);
        }
    }
    mounted
}

// ---------- порядок копий ----------

/// Вес знака в порядке копий: препинание, затем цифры, затем остальное.
fn glyph_rank(c: char) -> (u8, u32) {
    let digit = c.is_ascii_digit();
    if let Some(slot) = PUNCT_ORDER.find(c).filter(|_| !digit) {
        (0, slot as u32)
    } else if digit {
        (1, u32::from(c))
    } else {
        (2, u32::from(c))
    }
}

/// Ключ порядка копий: подключённые первыми, затем общий хвост пути (длиннее — раньше),
/// затем знаки по весам и, наконец, сама строка.
fn copy_order(copy: &Relocated, wanted: &str) -> CopyKey {
    let ours = wanted.rsplit('/').count();
    let theirs = copy.inner.rsplit('/').count();
    let shared_tail = wanted
        .rsplit('/')
        .zip(copy.inner.rsplit('/'))
        .position(|(left, right)| left != right)
        .unwrap_or(ours.min(theirs));
    let weights = Vec::from_iter(copy.inner.chars().map(glyph_rank));
    (
        !copy.mounted,
        Reverse(shared_tail),
        weights,
        copy.inner.clone(),
    )
}

// ---------- локатор ----------

/// Опись `update.rpf` (в едином виде, отсортирована, без повторов) и подключённые игрой архивы.
struct Index {
    mounts: Mounts,
    sorted: Vec<String>,
}

impl Index {
    fn knows(&self, inner: &str) -> bool {
        self.sorted
            .binary_search_by_key(&inner, |known| known.as_str())
            .is_ok()
    }

    /// То же для записи в любом виде: сначала приводится к пути внутри `update.rpf`.
    fn knows_entry(&self, entry: &str) -> bool {
        self.knows(&update_inner(entry))
    }

    /// Подключён ли архив: простое членство; пустое имя (запись вне архива) особого
    /// случая не имеет и подключено, только если оно само есть в наборе.
    fn mounted(&self, container: &str) -> bool {
        self.mounts.contains(container)
    }
}

pub struct EntryLocator<'a> {
    index: Index,
    common_has: CommonHas<'a>,
}

impl<'a> EntryLocator<'a> {
    pub fn new<I>(entries: I, mounts: Mounts, common_has: CommonHas<'a>) -> Self
    where
        I: IntoIterator<Item = String>,
    {
        let sorted = entries
            .into_iter()
            .map(|entry| flatten(&entry))
            .collect::<BTreeSet<String>>()
            .into_iter()
            .collect();
        let index = Index { sorted, mounts };
        EntryLocator { common_has, index }
    }

    /// Файл данных: в `update.rpf` по штатному пути, иначе (для `common/…`) в `common.rpf`.
    pub fn data_file(&self, standard: &str) -> Place {
        let inner = update_inner(standard);
        match (self.index.knows(&inner), inner.strip_prefix("common/")) {
            (true, _) => Some(located(under_update(&inner), "standard")),
            (false, None) => None,
            // Нет ответа от общего архива — считаем, что запись там есть.
            (false, Some(rest)) => (self.common_has)(rest)
                .unwrap_or(true)
                .then(|| located(format!("common:/{rest}"), "common")),
        }
    }

    pub fn has(&self, entry: &str) -> bool {
        self.index.knows_entry(entry)
    }

    pub fn mounts(&self) -> &Mounts {
        &self.index.mounts
    }

    pub fn find(&self, standard: &str, options: &FindOptions) -> Hit {
        self.named_place(standard, options.alternatives)
            .map_or_else(
                || self.copy_place(standard, options),
                |place| Some(Found::Entry(place)),
            )
    }

    /// Файлы описи с тем же именем, что у `standard`, кроме него самого, `exclude` и
    /// словарей DLC. Подключённые архивы первыми, затем общий хвост пути, затем знаки.
    pub fn relocated(&self, standard: &str, exclude: &[String]) -> Vec<Relocated> {
        let wanted = update_inner(standard);
        let wanted = wanted.as_str();
        let skipped = Mounts::from_iter(exclude.iter().map(|path| update_inner(path)));

        let leaf = wanted.rsplit('/').next().unwrap_or_default();
        let kept = self.index.sorted.iter().filter(|inner| {
            inner.rsplit('/').next() == Some(leaf)
                && inner.as_str() != wanted
                && !skipped.contains(inner.as_str())
                && !is_dlc_pack(inner)
        });
        let mut copies = Vec::from_iter(kept.map(|inner| self.copy_at(inner)));
        copies.sort_by_cached_key(|copy| copy_order(copy, wanted));
        copies
    }

    /// Копия по записи описи: её архив и признак подключения.
    fn copy_at(&self, inner: &str) -> Relocated {
        let container = container_of(inner);
        Relocated {
            container: container.to_owned(),
            inner: inner.to_owned(),
            mounted: self.index.mounted(container),
        }
    }

    /// Штатный путь или первый из запасных, который есть в описи.
    fn named_place(&self, standard: &str, alternatives: &[String]) -> Place {
        let pick = |how, path: &str| {
            self.has(path)
                .then(|| located(under_update(&update_inner(path)), how))
        };
        pick("standard", standard).or_else(|| {
            alternatives
                .iter()
                .find_map(|alternative| pick("alternative", alternative))
        })
    }

    /// Копии вне заданных мест; запасные пути уже проверены и в копии не попадают.
    fn copy_place(&self, standard: &str, options: &FindOptions) -> Hit {
        if options.relocate == Relocate::None {
            return None;
        }
        let skip = [options.alternatives, options.exclude].concat();
        let mut copies = self.relocated(standard, &skip);
        if options.relocate == Relocate::Mounted {
            copies.retain(|copy| copy.mounted);
        }
        let found = |copy: &Relocated| {
            Found::Entry(Located {
                how: "relocated",
                entry: under_update(&copy.inner),
                mounted: Some(copy.mounted),
            })
        };
        match (options.relocate, copies.as_slice()) {
            (Relocate::Mounted, []) => None,
            (Relocate::Mounted, [only]) => Some(found(only)),
            (Relocate::Mounted, many) => Some(Found::Ambiguous(
                many.iter().map(|copy| copy.inner.clone()).collect(),
            )),
            (_, [first, ..]) => Some(found(first)),
            (_, []) => None,
        }
    }
}

// ---------- места чтения ----------

open_fields! {
    /// Словарь, который нужен только как источник правил.
    DonorFile {
        alternatives => &'static [&'static str];
        entry => &'static str;
        id => &'static str;
    }
}

pub const IMPACT_DONOR_FILES: [DonorFile; 1] = [DonorFile {
    alternatives: &["x64/patch/data/effects/ptfx_lo.rpf/scr_rcbarry2.ypt"],
    entry: "x64/patch/data/effects/ptfx_hi.rpf/scr_rcbarry2.ypt",
    id: "scr_rcbarry2",
}];

/// Файл данных по штатному пути; без описи — этот путь как есть.
pub fn data_read_entry(locator: Option<&EntryLocator<'_>>, standard_entry: &str) -> Place {
    locator.map_or_else(
        || Some(located(standard_entry.to_owned(), "standard")),
        |found| found.data_file(standard_entry),
    )
}

/// Донор годится из любой копии: штатный путь, запасной, затем любая копия вне DLC.
pub fn donor_read_entry(locator: Option<&EntryLocator<'_>>, item: &DonorFile) -> Place {
    let standard = under_update(item.entry);
    let Some(found) = locator else {
        return Some(located(standard, "standard"));
    };
    let fallbacks = Vec::from_iter(item.alternatives.iter().map(|alt| under_update(alt)));
    let wide = FindOptions {
        alternatives: &fallbacks,
        relocate: Relocate::Any,
        exclude: &[],
    };
    found.find(&standard, &wide).and_then(Found::into_place)
}

/// Откуда читать ядро: штатное, подключённая копия, затем качество `hi`/`lo`, затем любая копия.
pub fn core_read_entry(locator: Option<&EntryLocator<'_>>) -> Place {
    let standard = core_entry(CORE_ARCHIVES[0]);
    let Some(locator) = locator else {
        return Some(located(standard, "standard"));
    };
    let lesser = Vec::from_iter(
        CORE_ARCHIVES
            .iter()
            .skip(1)
            .map(|quality| core_entry(quality)),
    );
    let search = |relocate, alternatives: &[String], exclude: &[String]| {
        let options = FindOptions {
            relocate,
            alternatives,
            exclude,
        };
        locator
            .find(&standard, &options)
            .and_then(Found::into_place)
    };
    search(Relocate::Mounted, &[], &lesser).or_else(|| search(Relocate::Any, &lesser, &[]))
}

#[cfg(test)]
mod tests;
