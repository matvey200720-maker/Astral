//! Запись и правка словарей текстур Legacy (`.ytd`, RSC7 версии 13).
//!
//! Любая запись собирает файл заново: раскладывает обе области, пересчитывает хеши и указатели,
//! упорядочивает текстуры по хешу имени и сжимает тело. Словарь читается в список записей
//! (`read_entries`), правится списком в памяти (`edit`) и собирается тем же сборщиком, что и `write`.

use std::collections::HashSet;

use crate::{
    bc_encode::{self, BcFormat},
    error::{Error, Result},
    hash::joaat,
    resource::{Resource, GRAPHICS_BASE, SYSTEM_BASE, VERSION_YTD},
    texture::Format,
    ytd_edit::{self, align16, first_refusal, pack, require, rsc_file, single_page_flags, sizes},
};

pub const TEXTURE_BYTES: usize = 0x90;

/// Пределы словаря.
pub(crate) mod limit {
    pub const DATA_ALIGN: usize = 0x2000;
    pub const LEVELS: u8 = 12;
    pub const NAME: usize = 255;
    pub const TEXTURES: usize = 4096;
}

// ---------------------------------------------------------------------------------------------
// Запись байт и чтение полей
// ---------------------------------------------------------------------------------------------

/// Область байт с записью чисел по смещению.
pub(crate) struct Image(Vec<u8>);

impl Image {
    pub(crate) fn zeroed(len: usize) -> Self {
        Image(vec![0; len])
    }

    pub(crate) fn put(&mut self, at: usize, bytes: &[u8]) {
        self.0[at..at + bytes.len()].copy_from_slice(bytes);
    }

    pub(crate) fn put16(&mut self, at: usize, value: u16) {
        self.put(at, &value.to_le_bytes());
    }

    pub(crate) fn put32(&mut self, at: usize, value: u32) {
        self.put(at, &value.to_le_bytes());
    }

    pub(crate) fn put64(&mut self, at: usize, value: u64) {
        self.put(at, &value.to_le_bytes());
    }

    pub(crate) fn bytes(&self) -> &[u8] {
        &self.0
    }
}

/// Чтение полей одного объекта по смещениям от его начала.
pub(crate) struct Fields<'a> {
    pub(crate) res: &'a Resource,
    pub(crate) at: usize,
}

impl Fields<'_> {
    pub(crate) fn u8(&self, offset: usize) -> Result<u8> {
        self.res.u8(self.at + offset)
    }

    pub(crate) fn u16(&self, offset: usize) -> Result<u16> {
        self.res.u16(self.at + offset)
    }

    pub(crate) fn u32(&self, offset: usize) -> Result<u32> {
        self.res.u32(self.at + offset)
    }

    pub(crate) fn u64(&self, offset: usize) -> Result<u64> {
        self.res.u64(self.at + offset)
    }
}

/// Для каждого имени: повторяет ли оно более раннее (без учёта регистра ASCII).
/// Видевшиеся написания копятся в множестве: «повтор» — то, что уже лежит в нём.
pub(crate) fn later_repeats<'a>(names: impl Iterator<Item = &'a str>) -> Vec<bool> {
    let mut seen = HashSet::new();
    names.map(|name| !seen.insert(name.to_ascii_lowercase())).collect()
}

// ---------------------------------------------------------------------------------------------
// Размеры данных и цепочка ступеней
// ---------------------------------------------------------------------------------------------

/// Сторона на ступени `level`: сдвиг вправо, нулевая сторона и ступени глубже 63 сдвигов считаются единицей.
fn side_at(side: usize, level: usize) -> usize {
    let shifted = u32::try_from(level).ok().and_then(|by| side.checked_shr(by));
    shifted.unwrap_or(0).max(1)
}

/// Байты данных всех ступеней.
pub fn payload_bytes(format: Format, width: usize, height: usize, levels: usize) -> usize {
    (0..levels).fold(0, |total, level| total + format.level_bytes(side_at(width, level), side_at(height, level)))
}

/// Среднее окна 2×2 в одном пикселе RGBA: сумма каналов с округлением половины вверх.
fn blend(window: [&[u8]; 4]) -> [u8; 4] {
    std::array::from_fn(|channel| {
        let sum: u32 = window.iter().map(|texel| u32::from(texel[channel])).sum();
        ((sum + 2) / 4) as u8
    })
}

/// Следующая ступень кадра RGBA: среднее окна 2×2 с округлением половины вверх, у края — последний пиксель.
fn halve(pixels: &[u8], width: usize, height: usize) -> (Vec<u8>, usize, usize) {
    let next_w = (width / 2).max(1);
    let next_h = (height / 2).max(1);
    let texel = |x: usize, y: usize| {
        let at = (y.min(height - 1) * width + x.min(width - 1)) * 4;
        &pixels[at..at + 4]
    };
    let mut next = Vec::with_capacity(next_w * next_h * 4);
    for y in 0..next_h {
        for x in 0..next_w {
            next.extend(blend([texel(2 * x, 2 * y), texel(2 * x + 1, 2 * y), texel(2 * x, 2 * y + 1), texel(2 * x + 1, 2 * y + 1)]));
        }
    }
    (next, next_w, next_h)
}

/// Все ступени кадра, сжатые блочным кодером и склеенные от верхней.
pub fn bc_mip_chain(rgba: &[u8], width: usize, height: usize, levels: usize, format: BcFormat) -> Option<Vec<u8>> {
    let filled = [width, height, levels].iter().all(|&n| n != 0) && rgba.len() == width * height * 4;
    let mut pixels = filled.then(|| rgba.to_vec())?;
    let (mut w, mut h) = (width, height);
    let mut chain = Vec::new();
    for level in 0..levels {
        chain.extend(bc_encode::compress(&pixels, w, h, format)?);
        if level + 1 < levels {
            (pixels, w, h) = halve(&pixels, w, h);
        }
    }
    Some(chain)
}

// ---------------------------------------------------------------------------------------------
// Записи
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct NewTexture {
    pub name: String,
    pub width: u16,
    pub height: u16,
    pub format: Format,
    pub levels: u8,
    pub payload: Vec<u8>,
}

/// Поля объекта текстуры Legacy.
mod field {
    pub const NAME: usize = super::ytd_edit::offsets::OBJECT_NAME;
    pub const FLAG: usize = 0x30;
    pub const FLAG_HIGH: usize = 0x32;
    pub const USAGE: usize = 0x40;
    pub const WIDTH: usize = 0x50;
    pub const HEIGHT: usize = 0x52;
    pub const DEPTH: usize = 0x54;
    pub const STRIDE: usize = 0x56;
    pub const FORMAT: usize = 0x58;
    pub const LEVELS: usize = 0x5D;
    pub const DATA: usize = 0x70;
}

#[derive(Debug, Clone)]
pub struct Entry {
    pub name: String,
    pub object: [u8; TEXTURE_BYTES],
    pub width: u16,
    pub height: u16,
    pub depth: u16,
    pub stride: u16,
    pub format: Format,
    pub levels: u8,
    pub payload: Vec<u8>,
}

impl Entry {
    /// Запись из новой текстуры поверх готового объекта. Шаг строки — байты верхней ступени на строку,
    /// 16 бит; у нулевой высоты он нуль, а отказ даёт проверка записи.
    fn from_new(texture: &NewTexture, object: [u8; TEXTURE_BYTES]) -> Entry {
        let NewTexture { name, width, height, format, levels, payload } = texture.clone();
        let top_level = format.level_bytes(usize::from(width), usize::from(height));
        let stride = top_level.checked_div(usize::from(height)).unwrap_or(0) as u16;
        Entry { name, object, width, height, depth: 1, stride, format, levels, payload }
    }

    fn expected_payload(&self) -> usize {
        payload_bytes(self.format, usize::from(self.width), usize::from(self.height), usize::from(self.levels))
    }

    fn has_name(&self, name: &str) -> bool {
        self.name.eq_ignore_ascii_case(name)
    }
}

/// Правила проверки записи: условие нарушения и текст отказа; порядок — порядок проверок.
type EntryRule = (fn(&Entry, u8) -> bool, fn(&Entry) -> String);

const ENTRY_RULES: [EntryRule; 3] = [(bad_name, bad_name_text), (bad_shape, bad_shape_text), (wrong_payload, wrong_payload_text)];

fn bad_name(entry: &Entry, _levels_cap: u8) -> bool {
    let long_enough = (1..=limit::NAME).contains(&entry.name.len());
    !long_enough || !entry.name.bytes().all(|b| b.is_ascii() && b != 0)
}

fn bad_name_text(entry: &Entry) -> String {
    format!("Texture name '{}' is not a valid 1–255 ASCII name.", entry.name)
}

fn bad_shape(entry: &Entry, levels_cap: u8) -> bool {
    entry.width == 0 || entry.height == 0 || !(1..=levels_cap).contains(&entry.levels)
}

fn bad_shape_text(entry: &Entry) -> String {
    format!("Texture '{}' needs sides above zero and 1–12 levels.", entry.name)
}

fn wrong_payload(entry: &Entry, _levels_cap: u8) -> bool {
    entry.payload.len() != entry.expected_payload()
}

fn wrong_payload_text(entry: &Entry) -> String {
    format!("Texture '{}' payload is {} bytes, its {} levels of {} need {}.", entry.name, entry.payload.len(), entry.levels, entry.format.name(), entry.expected_payload())
}

// ---------------------------------------------------------------------------------------------
// Сборка файла
// ---------------------------------------------------------------------------------------------

/// Таблицы виртуальных функций: словаря, текстуры игры и «как у хоста».
mod vft {
    pub const DICTIONARY: u64 = 0x1_4057_3510;
    pub const TEXTURE: u64 = 0x1_4061_9668;
    pub const HOST: u64 = 0x1_0000_0000;
}

/// «Использование» штатных текстур игры.
const GAME_USAGE: u32 = 0x2000_ae16;
/// Старший полубайт графических флагов словаря Legacy.
const GRAPHICS_NIBBLE: u32 = 0xD;

/// Объект новой текстуры: служебные поля задаёт тот, кто собирает.
fn fresh_object(table: u64, flag: u16, flag_high: u16, usage: u32) -> [u8; TEXTURE_BYTES] {
    let mut object = [0u8; TEXTURE_BYTES];
    let words: [(usize, &[u8]); 4] =
        [(0, &table.to_le_bytes()), (field::FLAG, &flag.to_le_bytes()), (field::FLAG_HIGH, &flag_high.to_le_bytes()), (field::USAGE, &usage.to_le_bytes())];
    for (at, bytes) in words {
        object[at..at + bytes.len()].copy_from_slice(bytes);
    }
    object
}

/// Раскладывает записи подряд от `from`: каждая встаёт на ближайшую границу `align` и занимает свою длину.
/// Возвращает начала записей и конец последней.
fn lay_out(from: usize, align: usize, lens: impl Iterator<Item = usize>) -> (Vec<usize>, usize) {
    let mut starts = Vec::new();
    let end = lens.fold(from, |end, len| {
        let start = end.next_multiple_of(align);
        starts.push(start);
        start + len
    });
    (starts, end)
}

/// Куда что ляжет в обеих областях и какими флагами они описаны.
struct Plan {
    info: usize,
    list: usize,
    hashes: usize,
    names: Vec<usize>,
    data: Vec<usize>,
    system: (u32, usize),
    graphics: (u32, usize),
}

/// Словарь в памяти, готовый к сборке.
struct Dictionary {
    entries: Vec<Entry>,
    root_vft: u64,
    /// С какой границы начинаются данные каждой текстуры.
    align: usize,
    /// Больше скольких ступеней у листа быть не может.
    levels_cap: u8,
}

impl Dictionary {
    /// Словарь после правок: записи исходного файла и список правок по порядку.
    fn rebuilt(original: &[u8], edits: &[Edit]) -> Result<Self> {
        let mut shelf = Shelf(read_entries(original)?);
        edits.iter().try_for_each(|edit| edit.apply(&mut shelf))?;
        first_refusal([(shelf.0.is_empty(), Error::operation("Правка оставила словарь без текстур: отказ."))])?;
        Ok(Dictionary { entries: shelf.0, root_vft: vft::DICTIONARY, align: limit::DATA_ALIGN, levels_cap: limit::LEVELS })
    }

    fn vet(&self) -> Result<()> {
        first_refusal([(!(1..=limit::TEXTURES).contains(&self.entries.len()), Error::argument("A texture dictionary takes 1 to 4096 textures."))])?;
        let repeats = later_repeats(self.entries.iter().map(|entry| entry.name.as_str()));
        self.entries.iter().zip(repeats).try_for_each(|(entry, repeated)| {
            ENTRY_RULES.iter().find(|(violated, _)| violated(entry, self.levels_cap)).map_or(Ok(()), |(_, message)| Err(Error::argument(message(entry))))?;
            let twice = format!("Texture '{}' is listed twice (names are case-insensitive).", entry.name);
            first_refusal([(repeated, Error::argument(twice))])
        })
    }

    fn plan(&self) -> Result<Plan> {
        let count = self.entries.len();
        let info = sizes::ROOT + TEXTURE_BYTES * count;
        let list = align16(info + sizes::PAGE_INFO);
        let hashes = list + 8 * count;
        let names_from = align16(hashes + 4 * count);
        // Имена идут подряд, каждое с нулём; данные — каждое с границы страницы данных.
        let (names, names_end) = lay_out(names_from, 1, self.entries.iter().map(|entry| entry.name.len() + 1));
        let Some(system) = single_page_flags(0, names_end) else {
            return Err(Error::argument("The texture names do not fit one system page."));
        };
        let (data, data_end) = lay_out(0, self.align, self.entries.iter().map(|entry| entry.payload.len()));
        let Some(graphics) = single_page_flags(GRAPHICS_NIBBLE, data_end.max(1)) else {
            return Err(Error::argument("The texture payloads do not fit one graphics page."));
        };
        Ok(Plan { info, list, hashes, names, data, system, graphics })
    }

    /// Тело файла: системная область, затем графическая.
    fn render(&self, plan: &Plan) -> Image {
        use ytd_edit::offsets as root_at;
        let graphics_at = plan.system.1;
        let mut image = Image::zeroed(graphics_at + plan.graphics.1);
        let count = self.entries.len() as u16;

        image.put64(0, self.root_vft);
        image.put64(root_at::ROOT_PAGES, SYSTEM_BASE + plan.info as u64);
        image.put32(0x18, 1);
        image.put64(root_at::ROOT_HASHES, SYSTEM_BASE + plan.hashes as u64);
        image.put64(root_at::ROOT_LIST, SYSTEM_BASE + plan.list as u64);
        let counters = [root_at::ROOT_HASHES + 8, root_at::ROOT_HASHES + 10, root_at::ROOT_LIST_COUNT, root_at::ROOT_LIST_COUNT + 2];
        counters.iter().for_each(|&at| image.put16(at, count));
        image.put(plan.info + 8, &[1, 1]);

        for (slot, entry) in self.entries.iter().enumerate() {
            let object_at = sizes::ROOT + TEXTURE_BYTES * slot;
            image.put(object_at, &entry.object);
            image.put64(object_at + field::NAME, SYSTEM_BASE + plan.names[slot] as u64);
            image.put64(object_at + field::DATA, GRAPHICS_BASE + plan.data[slot] as u64);
            image.put16(object_at + field::WIDTH, entry.width);
            image.put16(object_at + field::HEIGHT, entry.height);
            image.put16(object_at + field::DEPTH, entry.depth);
            image.put16(object_at + field::STRIDE, entry.stride);
            image.put32(object_at + field::FORMAT, entry.format.code());
            image.put(object_at + field::LEVELS, &[entry.levels]);

            image.put64(plan.list + 8 * slot, SYSTEM_BASE + object_at as u64);
            image.put32(plan.hashes + 4 * slot, joaat(&entry.name));
            image.put(plan.names[slot], entry.name.as_bytes());
            image.put(graphics_at + plan.data[slot], &entry.payload);
        }
        image
    }

    fn assemble<F>(mut self, deflate: F) -> Result<Vec<u8>>
    where
        F: Fn(&[u8]) -> Vec<u8>,
    {
        self.vet()?;
        self.entries.sort_by_cached_key(|entry| joaat(&entry.name));
        let plan = self.plan()?;
        let image = self.render(&plan);
        Ok(rsc_file(VERSION_YTD, plan.system.0, plan.graphics.0, deflate(image.bytes())))
    }
}

/// Объект записи «как у хоста»: образец с подменённой таблицей или нулевой с единицей на 0x30.
fn host_object(sample: Option<&[u8; TEXTURE_BYTES]>) -> [u8; TEXTURE_BYTES] {
    let mut object = sample.copied().unwrap_or_else(|| fresh_object(vft::HOST, 1, 0, 0));
    object[..8].copy_from_slice(&vft::HOST.to_le_bytes());
    object
}

/// Образец объекта текстуры «как у хоста, собравшего словарь из XML»: таблица хоста, `Unk32` = 128 и своё слово использования.
pub fn host_sample(usage: u32) -> [u8; TEXTURE_BYTES] {
    fresh_object(vft::HOST, 1, 0x80, usage)
}

/// Словарь «как у хоста»: служебные поля из образца или нулевые.
pub fn write_host(textures: &[(NewTexture, Option<[u8; TEXTURE_BYTES]>)]) -> Result<Vec<u8>> {
    Dictionary { entries: textures.iter().map(|(texture, sample)| Entry::from_new(texture, host_object(sample.as_ref()))).collect(), root_vft: vft::HOST, align: limit::DATA_ALIGN, levels_cap: limit::LEVELS }.assemble(pack)
}

/// Словарь из списка текстур со служебными полями штатных текстур игры.
pub fn write(textures: &[NewTexture]) -> Result<Vec<u8>> {
    write_with_usage(textures, GAME_USAGE)
}

/// То же, но слово использования листов своё: `usage` — вид (младшие 5 разрядов) и флаги размеров (остальные).
/// Нужно там, где хост пишет другой вид и флаги, чем у штатных листов игры (спектр радуги: `DIFFUSE`).
pub fn write_with_usage(textures: &[NewTexture], usage: u32) -> Result<Vec<u8>> {
    let service = fresh_object(vft::TEXTURE, 1, 0x80, usage);
    let entries = textures.iter().map(|texture| Entry::from_new(texture, service)).collect();
    Dictionary { entries, root_vft: vft::DICTIONARY, align: limit::DATA_ALIGN, levels_cap: limit::LEVELS }.assemble(pack)
}

/// Больше ступеней, чем у прочих листов, не бывает у листа 8192 пикселей с полной цепочкой.
pub const LONG_CHAIN_LEVELS: u8 = 14;

/// Словарь листов, у которых цепочка может быть полной до 8192 пикселей (до 14 ступеней): листы модели надписи.
/// Остальное — как у `write`.
pub fn write_long_chains(textures: &[NewTexture]) -> Result<Vec<u8>> {
    let service = fresh_object(vft::TEXTURE, 1, 0x80, GAME_USAGE);
    let entries = textures.iter().map(|texture| Entry::from_new(texture, service)).collect();
    Dictionary { entries, root_vft: vft::DICTIONARY, align: limit::DATA_ALIGN, levels_cap: LONG_CHAIN_LEVELS }.assemble(pack)
}

// ---------------------------------------------------------------------------------------------
// Чтение
// ---------------------------------------------------------------------------------------------

/// Разбор словаря: ресурс и список указателей на объекты.
struct Reader {
    res: Resource,
    list_at: usize,
    count: usize,
}

impl Reader {
    fn open(bytes: &[u8]) -> Result<Reader> {
        let res = Resource::parse(bytes)?;
        match res.version() {
            VERSION_YTD if res.complete => {}
            VERSION_YTD => return Err(Error::broken("Словарь текстур обрезан.")),
            version => return Err(Error::version(format!("Это не словарь текстур Legacy (версия {version})."))),
        }
        let root = require(res.root(), "Корень словаря текстур недоступен.")?;
        let list = res.pointer_list(root + ytd_edit::offsets::ROOT_LIST)?;
        let list_at = require(res.at(list.entries), "Список текстур словаря недоступен.")?;
        Ok(Reader { res, list_at, count: usize::from(list.count) })
    }

    fn entry(&self, slot: usize) -> Result<Entry> {
        let res = &self.res;
        let at = require(res.pointer_at(self.list_at + slot * 8), "Указатель на текстуру пуст.")?;
        let object = <[u8; TEXTURE_BYTES]>::try_from(res.bytes(at, TEXTURE_BYTES)?).expect("длина объекта задана");
        let fields = Fields { res, at };

        let name = require(res.cstring(fields.u64(field::NAME)?), "У текстуры нет имени.")?;
        let code = fields.u32(field::FORMAT)?;
        let Some(format) = Format::from_code(code) else {
            return Err(Error::texture(format!("Текстура {name}: формат {code:#x} не поддерживается.")));
        };
        let (width, height) = (fields.u16(field::WIDTH)?, fields.u16(field::HEIGHT)?);
        let levels = fields.u8(field::LEVELS)?;
        let wanted = payload_bytes(format, width.into(), height.into(), levels.into());
        let payload = res.at(fields.u64(field::DATA)?).ok_or_else(|| Error::broken(format!("Текстура {name} без данных."))).and_then(|from| res.bytes(from, wanted))?.to_vec();
        let (depth, stride) = (fields.u16(field::DEPTH)?, fields.u16(field::STRIDE)?);
        Ok(Entry { name, object, width, height, depth, stride, format, levels, payload })
    }
}

/// Все записи словаря в порядке массива указателей.
pub fn read_entries(bytes: &[u8]) -> Result<Vec<Entry>> {
    Reader::open(bytes).and_then(|reader| (0..reader.count).map(|slot| reader.entry(slot)).collect())
}

// ---------------------------------------------------------------------------------------------
// Правки
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub enum Edit {
    Patch { name: String, payload: Vec<u8> },
    Remove { name: String },
    Add { texture: NewTexture, donor: Option<String> },
    AddFrom { texture: NewTexture, template: [u8; TEXTURE_BYTES] },
}

/// Список записей, который правят по очереди.
struct Shelf(Vec<Entry>);

fn not_found(name: &str) -> Error {
    Error::operation(format!("texture '{name}' not found inside YTD."))
}

impl Shelf {
    fn patch(&mut self, name: &str, payload: &[u8]) -> Result<()> {
        let entry = self.0.iter_mut().find(|e| e.has_name(name)).ok_or_else(|| not_found(name))?;
        let (stored, offered) = (entry.payload.len(), payload.len());
        let message = format!("Текстура {name}: новые данные {offered} байт, в словаре {stored} — размеры и ступени должны совпасть.");
        first_refusal([(stored != offered, Error::argument(message))])?;
        entry.payload.copy_from_slice(payload);
        Ok(())
    }

    fn remove(&mut self, name: &str) -> Result<()> {
        let (kept, dropped): (Vec<Entry>, Vec<Entry>) = std::mem::take(&mut self.0).into_iter().partition(|entry| !entry.has_name(name));
        self.0 = kept;
        first_refusal([(dropped.is_empty(), not_found(name))])
    }

    /// Объект донора. Названный донор обязан найтись; без имени берётся первая запись того же формата,
    /// а если такой нет — самая первая.
    fn donor_object(&self, format: Format, donor: Option<&str>) -> Result<[u8; TEXTURE_BYTES]> {
        let suits = |entry: &Entry| donor.map_or(entry.format == format, |name| entry.has_name(name));
        self.0
            .iter()
            .min_by_key(|entry| !suits(entry))
            .filter(|entry| donor.is_none() || suits(entry))
            .map(|entry| entry.object)
            .ok_or_else(|| Error::operation("В словаре нет штатной текстуры, у которой взять служебные поля."))
    }

    /// Новая запись встаёт на место одноимённой или в конец списка.
    fn settle(&mut self, entry: Entry) {
        if let Some(old) = self.0.iter_mut().find(|old| old.has_name(&entry.name)) {
            *old = entry;
        } else {
            self.0.push(entry);
        }
    }
}

impl Edit {
    fn apply(&self, shelf: &mut Shelf) -> Result<()> {
        match self {
            Edit::Patch { name, payload } => shelf.patch(name, payload),
            Edit::Remove { name } => shelf.remove(name),
            Edit::Add { texture, donor } => {
                let object = shelf.donor_object(texture.format, donor.as_deref())?;
                shelf.settle(Entry::from_new(texture, object));
                Ok(())
            }
            Edit::AddFrom { texture, template } => {
                shelf.settle(Entry::from_new(texture, *template));
                Ok(())
            }
        }
    }
}

/// Применяет правки по порядку и собирает файл; сжатие делает вызывающий.
pub fn edit_with(original: &[u8], edits: &[Edit], deflate: impl Fn(&[u8]) -> Vec<u8>) -> Result<Vec<u8>> {
    Dictionary::rebuilt(original, edits).and_then(|dictionary| dictionary.assemble(deflate))
}

/// Граница данных текстур «вплотную», как кладёт их хост: 16 байт. Данные каждой текстуры по умолчанию идут с границы
/// страницы (`limit::DATA_ALIGN`, 8 КБ), и словарь из мелких текстур занимает в памяти игры в разы больше хостового.
pub const TIGHT_DATA_ALIGN: usize = 16;

/// То же, что `edit_with`, но данные каждой текстуры начинаются с границы `align` байт (степень двойки, не меньше 16).
pub fn edit_aligned_with(original: &[u8], edits: &[Edit], deflate: impl Fn(&[u8]) -> Vec<u8>, align: usize) -> Result<Vec<u8>> {
    first_refusal([(align < 16 || !align.is_power_of_two(), Error::argument("Texture data alignment must be a power of two, 16 or more."))])?;
    let mut dictionary = Dictionary::rebuilt(original, edits)?;
    dictionary.align = align;
    dictionary.assemble(deflate)
}

pub fn edit(original: &[u8], edits: &[Edit]) -> Result<Vec<u8>> {
    let rebuilt = Dictionary::rebuilt(original, edits)?;
    rebuilt.assemble(pack)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::Kind;
    use crate::hash::sha256_hex;
    use crate::resource::HEADER_BYTES;
    use crate::texture;
    use std::collections::BTreeMap;

    /// Описание текстуры для испытаний: имя, размеры, формат, ступени.
    struct Swatch {
        name: &'static str,
        w: u16,
        h: u16,
        format: Format,
        levels: u8,
    }

    const fn swatch(name: &'static str, w: u16, h: u16, format: Format, levels: u8) -> Swatch {
        Swatch { name, w, h, format, levels }
    }

    impl Swatch {
        fn size(&self) -> usize {
            payload_bytes(self.format, usize::from(self.w), usize::from(self.h), usize::from(self.levels))
        }

        fn with(&self, fill: impl Fn(usize) -> u8) -> NewTexture {
            NewTexture { name: self.name.into(), width: self.w, height: self.h, format: self.format, levels: self.levels, payload: (0..self.size()).map(fill).collect() }
        }

        /// Данные по формуле, зависящей от имени.
        fn woven(&self) -> NewTexture {
            let salt = self.name.len();
            self.with(|i| ((i * 29 + salt * 3) % 251) as u8)
        }

        fn solid(&self, byte: u8) -> NewTexture {
            self.with(|_| byte)
        }
    }

    fn named(base: &NewTexture, name: &str) -> NewTexture {
        NewTexture { name: name.into(), ..base.clone() }
    }

    fn mossy_set() -> Vec<u8> {
        let specs = [swatch("moss", 64, 64, Format::Dxt1, 4), swatch("pebble", 32, 32, Format::Dxt5, 3), swatch("dune", 16, 16, Format::Dxt1, 2)];
        let textures: Vec<NewTexture> = specs.iter().map(Swatch::woven).collect();
        write(&textures).unwrap()
    }

    fn refusal<T>(outcome: Result<T>) -> (Kind, String) {
        match outcome {
            Ok(_) => panic!("ждали отказ"),
            Err(error) => (error.kind, error.message),
        }
    }

    fn find(list: &[Entry], name: &str) -> Entry {
        list.iter().find(|entry| entry.name == name).cloned().expect(name)
    }

    #[test]
    fn written_dictionaries_read_back_ordered_by_ascending_hash() {
        let input = vec![
            swatch("w_ar_test_b", 128, 256, Format::Dxt1, 6).solid(0x11),
            swatch("w_ar_test_a", 64, 64, Format::Dxt5, 5).solid(0x22),
            swatch("w_ar_test_c", 32, 16, Format::A8R8G8B8, 1).solid(0x33),
            swatch("extra", 8, 8, Format::Ati2, 2).woven(),
        ];
        let file = write(&input).unwrap();
        let res = Resource::parse(&file).unwrap();
        assert_eq!(res.version(), VERSION_YTD);

        let by_hash: BTreeMap<u32, &NewTexture> = input.iter().map(|t| (joaat(&t.name), t)).collect();
        let refs = texture::read_dictionary(&res).unwrap();
        let read_order: Vec<&str> = refs.iter().map(|r| r.name.as_str()).collect();
        let want_order: Vec<&str> = by_hash.values().map(|t| t.name.as_str()).collect();
        assert_eq!(read_order, want_order);
        for (got, source) in refs.iter().zip(by_hash.values()) {
            let at = got.data_at.expect("данные на месте");
            assert!(got.complete);
            assert_eq!(got.format, Some(source.format));
            assert_eq!((got.width, got.height, got.levels, got.bytes), (u32::from(source.width), u32::from(source.height), u32::from(source.levels), source.payload.len()));
            assert_eq!(res.data()[at..at + got.bytes], source.payload[..]);
        }
    }

    #[test]
    fn known_inputs_give_the_known_files() {
        let tiny = swatch("a", 4, 4, Format::Dxt1, 1).with(|i| (i * 7 + 1) as u8);
        let trio = vec![
            swatch("w_ar_test_b", 128, 256, Format::Dxt1, 6).solid(0x11),
            swatch("w_ar_test_a", 64, 64, Format::Dxt5, 5).solid(0x22),
            swatch("w_ar_test_c", 32, 16, Format::A8R8G8B8, 1).solid(0x33),
        ];
        let known = [
            (vec![tiny], 156, "da55321149bea016cef7f51a404b9916397b8b021883d7043be6290ac3ca5128"),
            (trio, 299, "029a808c746a23332ba9151d66141a1766fbbc6760c8004f21eef719dfb75e53"),
        ];
        for (textures, len, sha) in &known {
            let file = write(textures).unwrap();
            assert_eq!(file.len(), *len);
            assert_eq!(sha256_hex(&file), *sha);
        }
    }

    #[test]
    fn a_fresh_object_carries_the_game_service_fields() {
        let file = write(&[swatch("a", 4, 4, Format::Dxt1, 1).solid(0)]).unwrap();
        let entry = read_entries(&file).unwrap().remove(0);
        let words: Vec<(&str, &[u8], Vec<u8>)> = vec![
            ("table", &entry.object[..8], vft::TEXTURE.to_le_bytes().to_vec()),
            ("flags", &entry.object[0x30..0x34], vec![1, 0, 0x80, 0]),
            ("usage", &entry.object[0x40..0x44], GAME_USAGE.to_le_bytes().to_vec()),
        ];
        for (label, got, want) in words {
            assert_eq!(got, &want[..], "{label}");
        }
        assert_eq!((entry.depth, entry.stride), (1, 2));
    }

    #[test]
    fn checks_fire_in_the_documented_order() {
        let base = swatch("ok", 4, 4, Format::Dxt1, 1).solid(1);
        let wide = "n".repeat(256);
        let name_rule = |shown: &str| format!("Texture name '{shown}' is not a valid 1–255 ASCII name.");
        let shape = "Texture 'ok' needs sides above zero and 1–12 levels.";
        let payload = |len: usize| format!("Texture 'ok' payload is {len} bytes, its 1 levels of DXT1 need 8.");
        type Mutation = Box<dyn Fn(&mut NewTexture)>;
        let mutations: Vec<(String, Mutation)> = vec![
            (name_rule(&wide), Box::new(|t| t.name = "n".repeat(256))),
            (name_rule(""), Box::new(|t| t.name.clear())),
            (name_rule("a\0b"), Box::new(|t| t.name = "a\0b".into())),
            (name_rule("имя"), Box::new(|t| t.name = "имя".into())),
            (shape.into(), Box::new(|t| t.width = 0)),
            (shape.into(), Box::new(|t| t.levels = 0)),
            (shape.into(), Box::new(|t| t.levels = 13)),
            (shape.into(), Box::new(|t| t.levels = 255)),
            (payload(7), Box::new(|t| t.payload.truncate(7))),
            (payload(9), Box::new(|t| t.payload.push(0))),
        ];
        for (text, mutate) in &mutations {
            let mut texture = base.clone();
            mutate(&mut texture);
            assert_eq!(refusal(write(&[texture])), (Kind::Argument, text.clone()));
        }

        // Раньше стоящая запись решает: сначала её проверка, потом её повтор, потом следующая запись.
        let bad = named(&base, "é");
        assert!(refusal(write(&[base.clone(), base.clone(), bad.clone()])).1.contains("is listed twice"));
        assert!(refusal(write(&[bad, base.clone(), base.clone()])).1.contains("Texture name 'é'"));
        let clash = [named(&base, "Same"), named(&base, "sAME"), named(&base, "same")];
        assert_eq!(refusal(write(&clash)).1, "Texture 'sAME' is listed twice (names are case-insensitive).");
        assert_eq!(refusal(write(&[])).1, "A texture dictionary takes 1 to 4096 textures.");
    }

    #[test]
    fn repeats_are_marked_on_the_later_spelling_only() {
        let names = ["b", "A", "a", "c", "B", "a"];
        assert_eq!(later_repeats(names.iter().copied()), [false, false, true, false, true, true]);
        assert!(later_repeats(std::iter::empty()).is_empty());
    }

    #[test]
    fn a_dictionary_takes_at_most_4096_textures() {
        let proto = swatch("x", 4, 4, Format::A8, 1).solid(0);
        let batch = |count: usize| -> Vec<NewTexture> { (0..count).map(|n| named(&proto, &format!("t{n:04}"))).collect() };
        assert!(write(&batch(limit::TEXTURES)).is_ok());
        assert_eq!(refusal(write(&batch(limit::TEXTURES + 1))).1, "A texture dictionary takes 1 to 4096 textures.");
    }

    #[test]
    fn row_stride_equals_top_level_bytes_over_height_cut_to_16_bits() {
        let rows = [
            (Format::Dxt1, 4, 4, 2),
            (Format::Dxt1, 5, 3, 5),
            (Format::Dxt1, 1, 16, 2),
            (Format::Dxt1, 7, 7, 4),
            (Format::Dxt5, 3, 5, 6),
            (Format::Ati2, 8, 2, 16),
            (Format::A8R8G8B8, 5, 3, 20),
            (Format::A8R8G8B8, 40000, 1, 28928),
            (Format::Dxt1, 65535, 4, 32768),
            (Format::L8, 9, 9, 9),
        ];
        for (format, w, h, stride) in rows {
            let file = write(&[swatch("t", w, h, format, 1).solid(0)]).unwrap();
            assert_eq!(read_entries(&file).unwrap()[0].stride, stride, "{format:?} {w}x{h}");
        }
    }

    #[test]
    fn graphics_page_doubles_when_the_data_passes_its_edge() {
        // A8 шириной 1024: целое число строк — ровно в страницу, и на строку больше.
        for shift in 0..8u32 {
            let page = 0x2000usize << shift;
            for (rows, extra) in [(page / 1024, 0u32), (page / 1024 + 1, 1)] {
                let texture = NewTexture { name: "t".into(), width: 1024, height: rows as u16, format: Format::A8, levels: 1, payload: vec![0; 1024 * rows] };
                let header = Resource::parse(&write(&[texture]).unwrap()).unwrap().header;
                assert_eq!(header.graphics_size, page << extra);
                assert_eq!(header.graphics_flags, 0xd002_0000 | (shift + extra));
                assert_eq!(header.system_flags, 0x0002_0000);
            }
        }
    }

    #[test]
    fn level_totals_follow_the_chain_and_zero_sides_count_as_one() {
        let cases = [
            (Format::Dxt1, 128, 128, 8, 10936),
            (Format::Dxt1, 96, 96, 2, 5760),
            (Format::Dxt1, 5, 3, 3, 32),
            (Format::Dxt1, 0, 0, 1, 8),
            (Format::Dxt1, 0, 8, 2, 24),
            (Format::Dxt1, 4, 4, 0, 0),
            (Format::Dxt3, 128, 128, 8, 21872),
            (Format::A8R8G8B8, 128, 128, 8, 87380),
            (Format::A8R8G8B8, 5, 3, 3, 72),
            (Format::L8, 5, 3, 3, 18),
            (Format::A8, 0, 0, 1, 1),
            (Format::A8, 1024, 1024, 63, 1_398_153),
            (Format::A8, 1024, 1024, 64, 1_398_154),
        ];
        for (format, w, h, levels, total) in cases {
            assert_eq!(payload_bytes(format, w, h, levels), total, "{format:?} {w}x{h} {levels}");
        }
    }

    #[test]
    fn host_dictionaries_differ_only_in_service_fields() {
        let texture = swatch("host_a", 8, 8, Format::Dxt1, 2).woven();
        let ours = Resource::parse(&write(std::slice::from_ref(&texture)).unwrap()).unwrap();
        let host = Resource::parse(&write_host(&[(texture.clone(), None)]).unwrap()).unwrap();
        let moved: Vec<usize> = (0..ours.len()).filter(|&i| ours.data()[i] != host.data()[i]).collect();
        let service = |i: &usize| *i < 4 || (64..68).contains(i) || [114, 128, 129, 131].contains(i);
        assert!(moved.iter().all(service), "{moved:?}");
        assert_eq!(host.u64(0).unwrap(), vft::HOST);

        let sample: [u8; TEXTURE_BYTES] = std::array::from_fn(|i| (5 * i + 2) as u8);
        let object = read_entries(&write_host(&[(texture, Some(sample))]).unwrap()).unwrap().remove(0).object;
        assert_eq!(object[..8], vft::HOST.to_le_bytes());
        assert_eq!(object[0x08..0x20], sample[0x08..0x20]);
    }

    #[test]
    fn unreadable_files_are_named_in_read_entries() {
        let base = write(&[swatch("aa", 8, 8, Format::Dxt1, 2).woven(), swatch("bb", 4, 4, Format::A8R8G8B8, 1).woven()]).unwrap();
        assert_eq!(read_entries(&base).unwrap().len(), 2);
        let tampered = |at: usize, bytes: &[u8]| {
            let mut res = Resource::parse(&base).unwrap();
            let list_at = res.at(res.u64(0x30).unwrap()).unwrap();
            let object = res.pointer_at(list_at).unwrap();
            res.data_mut()[object + at..][..bytes.len()].copy_from_slice(bytes);
            res.to_file_bytes().unwrap()
        };
        let odd_format = tampered(field::FORMAT, &0x1234_5678u32.to_le_bytes());
        let (kind, text) = refusal(read_entries(&odd_format));
        assert_eq!(kind, Kind::Texture);
        assert!(text.ends_with("формат 0x12345678 не поддерживается."), "{text}");
        let nameless = tampered(field::NAME, &[0; 8]);
        assert_eq!(refusal(read_entries(&nameless)), (Kind::Broken, "У текстуры нет имени.".into()));
        let dataless = tampered(field::DATA, &[0; 8]);
        assert!(refusal(read_entries(&dataless)).1.ends_with("без данных."));
        assert_eq!(refusal(read_entries(&[])).1, "Ресурс короче заголовка RSC7.");
        let gen9 = crate::ytd_gen9::convert(&base).unwrap();
        assert_eq!(refusal(read_entries(&gen9)).1, "Это не словарь текстур Legacy (версия 5).");
    }

    #[test]
    fn a_mixed_edit_changes_what_it_names_and_keeps_the_rest() {
        let base = mossy_set();
        let before = read_entries(&base).unwrap();
        let fresh = swatch("fresh", 32, 32, Format::Dxt1, 3).solid(0x99);
        let edits = [Edit::Patch { name: "PEBBLE".into(), payload: vec![0x77; 1344] }, Edit::Remove { name: "Dune".into() }, Edit::Add { texture: fresh.clone(), donor: None }];
        let after = read_entries(&edit(&base, &edits).unwrap()).unwrap();
        let mut names: Vec<&str> = after.iter().map(|e| e.name.as_str()).collect();
        names.sort_unstable();
        assert_eq!(names, ["fresh", "moss", "pebble"]);

        let (was, now) = (find(&before, "moss"), find(&after, "moss"));
        assert_eq!(was.payload, now.payload);
        let pointers_zeroed = |mut object: [u8; TEXTURE_BYTES]| {
            for at in [field::NAME, field::DATA] {
                object[at..at + 8].fill(0);
            }
            object
        };
        assert_eq!(pointers_zeroed(was.object), pointers_zeroed(now.object));
        assert_eq!(find(&after, "pebble").payload, vec![0x77; 1344]);
        assert_eq!(find(&after, "fresh").payload, fresh.payload);
    }

    #[test]
    fn edit_refusals_have_their_own_wording() {
        let solo = swatch("solo", 16, 16, Format::Dxt1, 2);
        let base = write(&[solo.woven()]).unwrap();
        let newcomer = swatch("n", 4, 4, Format::Dxt1, 1).solid(0);
        let no_donor = "В словаре нет штатной текстуры, у которой взять служебные поля.";
        let named = |name: &str| name.to_string();
        let cases: Vec<(Vec<Edit>, Kind, &str)> = vec![
            (
                vec![Edit::Patch { name: named("solo"), payload: vec![0; 3] }],
                Kind::Argument,
                "Текстура solo: новые данные 3 байт, в словаре 160 — размеры и ступени должны совпасть.",
            ),
            (vec![Edit::Patch { name: named("nope"), payload: vec![] }], Kind::Operation, "texture 'nope' not found inside YTD."),
            (vec![Edit::Remove { name: named("solo") }], Kind::Operation, "Правка оставила словарь без текстур: отказ."),
            (vec![Edit::Remove { name: named("gone") }], Kind::Operation, "texture 'gone' not found inside YTD."),
            (vec![Edit::Remove { name: named("solo") }, Edit::Add { texture: newcomer.clone(), donor: None }], Kind::Operation, no_donor),
            (vec![Edit::Add { texture: newcomer, donor: Some(named("absent")) }], Kind::Operation, no_donor),
        ];
        for (edits, kind, text) in cases {
            assert_eq!(refusal(edit(&base, &edits)), (kind, text.to_string()));
        }
    }

    #[test]
    fn donors_are_picked_by_name_then_by_format_then_by_position() {
        let base = mossy_set();
        // Помечаем байт 8 каждого объекта, чтобы видеть, откуда он пришёл.
        let marked = {
            let mut res = Resource::parse(&base).unwrap();
            let list_at = res.at(res.u64(0x30).unwrap()).unwrap();
            for slot in 0..3 {
                let object = res.pointer_at(list_at + slot * 8).unwrap();
                res.data_mut()[object + 8] = 0xA0 + slot as u8;
            }
            res.to_file_bytes().unwrap()
        };
        let marks: BTreeMap<String, u8> = read_entries(&marked).unwrap().into_iter().map(|e| (e.name, e.object[8])).collect();
        let first_in_file = read_entries(&marked).unwrap()[0].object[8];
        let borrowed = |format: Format, donor: Option<&str>| {
            let texture = swatch("fresh", 8, 8, format, 1).solid(1);
            let edits = [Edit::Add { texture, donor: donor.map(str::to_string) }];
            find(&read_entries(&edit(&marked, &edits).unwrap()).unwrap(), "fresh").object[8]
        };
        let scenarios =
            [(Format::Dxt1, Some("DUNE"), marks["dune"]), (Format::Dxt5, None, marks["pebble"]), (Format::A8, None, first_in_file), (Format::A8, Some("moss"), marks["moss"])];
        for (format, donor, mark) in scenarios {
            assert_eq!(borrowed(format, donor), mark, "{format:?} {donor:?}");
        }
    }

    #[test]
    fn a_template_replaces_by_name_and_the_new_spelling_wins() {
        let base = mossy_set();
        let template: [u8; TEXTURE_BYTES] = std::array::from_fn(|i| (7 * i + 3) as u8);
        let texture = swatch("MOSS", 8, 8, Format::Dxt5, 2).solid(9);
        let after = read_entries(&edit(&base, &[Edit::AddFrom { texture, template }]).unwrap()).unwrap();
        assert_eq!(after.len(), 3);
        let renewed = find(&after, "MOSS");
        assert_eq!((renewed.object[..8].to_vec(), renewed.object[8], renewed.depth), (template[..8].to_vec(), template[8], 1));
    }

    #[test]
    fn an_empty_edit_list_reproduces_our_own_file() {
        let base = mossy_set();
        assert_eq!(edit(&base, &[]).unwrap(), base);
    }

    #[test]
    fn the_compressor_gets_the_whole_body_once_and_only_on_success() {
        use std::cell::Cell;
        let calls = Cell::new(0usize);
        let seen_len = Cell::new(0usize);
        let spy = |body: &[u8]| {
            calls.set(calls.get() + 1);
            seen_len.set(body.len());
            pack(body)
        };
        let base = mossy_set();
        let file = edit_with(&base, &[Edit::Remove { name: "dune".into() }], spy).unwrap();
        let res = Resource::parse(&file).unwrap();
        assert_eq!((calls.get(), seen_len.get()), (1, res.len()));
        assert!(res.complete);

        calls.set(0);
        assert!(edit_with(&base, &[Edit::Remove { name: "none".into() }], spy).is_err());
        assert_eq!(calls.get(), 0);

        let hollow = edit_with(&base, &[], |_| Vec::new()).unwrap();
        assert_eq!(hollow.len(), HEADER_BYTES);
        assert_eq!(refusal(read_entries(&hollow)).1, "Поток ресурса пуст или не распакован.");
    }

    #[test]
    fn tightly_aligned_data_keeps_the_textures_and_shrinks_the_resource() {
        // Хост кладёт данные текстур вплотную (по 16 байт), а писатель по умолчанию — с границы страницы в 8 КБ: у словаря
        // из мелких текстур это в разы больше памяти ресурса в игре (замер 16.11: ступень 8 px, 118 словарей — 28,5 МБ против 2,1 МБ).
        let tiny = [swatch("a_tiny", 8, 8, Format::Dxt1, 4), swatch("b_tiny", 8, 8, Format::Dxt5, 4), swatch("c_tiny", 16, 8, Format::Dxt1, 3), swatch("d_tiny", 4, 4, Format::Dxt1, 1)];
        let base = write(&tiny.iter().map(Swatch::woven).collect::<Vec<_>>()).unwrap();
        let edits = [Edit::Remove { name: "d_tiny".into() }];
        let loose = edit_with(&base, &edits, pack).unwrap();
        let tight = edit_aligned_with(&base, &edits, pack, TIGHT_DATA_ALIGN).unwrap();
        let (first, second) = (read_entries(&loose).unwrap(), read_entries(&tight).unwrap());
        assert_eq!(first.len(), second.len());
        for (one, other) in first.iter().zip(&second) {
            assert_eq!((&one.name, one.width, one.height, one.levels, one.format, &one.payload), (&other.name, other.width, other.height, other.levels, other.format, &other.payload));
        }
        let (loose_body, tight_body) = (Resource::parse(&loose).unwrap().len(), Resource::parse(&tight).unwrap().len());
        assert!(tight_body * 2 <= loose_body, "{tight_body} против {loose_body}");
        assert!(Resource::parse(&tight).unwrap().complete);
        // Выравнивание по умолчанию не тронуто, а негодное отклоняется.
        assert_eq!(edit(&base, &edits).unwrap(), loose);
        assert!(refusal(edit_aligned_with(&base, &edits, pack, 8)).1.contains("alignment"));
        assert!(refusal(edit_aligned_with(&base, &edits, pack, 48)).1.contains("alignment"));
    }

    #[test]
    fn mip_chains_have_the_right_size_and_open_with_the_top_level() {
        let frame: Vec<u8> = (0..32usize * 16).flat_map(|i| [(i * 5 % 256) as u8, (i / 32 * 15) as u8, 120u8.wrapping_add(i as u8), 255]).collect();
        let chain = bc_mip_chain(&frame, 32, 16, 3, BcFormat::Bc1).unwrap();
        assert_eq!(chain.len(), payload_bytes(Format::Dxt1, 32, 16, 3));
        let top = bc_encode::compress(&frame, 32, 16, BcFormat::Bc1).unwrap();
        assert_eq!(chain[..top.len()], top[..]);
        let single = bc_mip_chain(&frame, 32, 16, 1, BcFormat::Bc1).unwrap();
        assert_eq!(single, top);

        let px = vec![7u8; 64];
        let refused: [(&[u8], usize, usize, usize); 5] = [(&px, 0, 4, 1), (&px, 4, 0, 1), (&px, 4, 4, 0), (&px[1..], 4, 4, 1), (&[], 0, 0, 1)];
        for (data, w, h, levels) in refused {
            assert!(bc_mip_chain(data, w, h, levels, BcFormat::Bc1).is_none());
        }
    }

    #[test]
    fn halving_averages_the_window_and_drops_the_odd_edge() {
        // (кадр, ширина, высота, ожидаемый пиксель)
        let cases: [(&[u8], usize, usize, [u8; 4]); 3] = [
            // Три пикселя в ряд: окно берёт первые два, третий не участвует.
            (&[0, 0, 0, 255, 255, 0, 0, 255, 90, 90, 90, 255], 3, 1, [128, 0, 0, 255]),
            // Среднее 5/4 округляется до 1, 2/4 — вверх до 1.
            (&[1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0], 2, 2, [1, 0, 0, 0]),
            (&[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0], 2, 2, [1, 0, 0, 0]),
        ];
        for (frame, w, h, pixel) in cases {
            let (next, nw, nh) = halve(frame, w, h);
            assert_eq!((next, nw, nh), (pixel.to_vec(), 1, 1));
        }
    }

    #[test]
    fn a_texture_of_zero_height_is_refused_by_every_writer() {
        let base = write(&[swatch("keep", 8, 8, Format::Dxt1, 1).solid(2)]).unwrap();
        let flat = NewTexture { height: 0, payload: Vec::new(), ..swatch("flat", 8, 8, Format::Dxt1, 1).solid(1) };
        let sample = [0u8; TEXTURE_BYTES];
        let outcomes = [
            ("write", write(std::slice::from_ref(&flat))),
            ("write_host", write_host(&[(flat.clone(), None)])),
            ("edit add", edit(&base, &[Edit::Add { texture: flat.clone(), donor: None }])),
            ("edit add_from", edit(&base, &[Edit::AddFrom { texture: flat.clone(), template: sample }])),
        ];
        for (label, outcome) in outcomes {
            let refused = outcome.expect_err(label);
            assert_eq!(refused.kind, Kind::Argument, "{label}");
            assert_eq!(refused.message, "Texture 'flat' needs sides above zero and 1–12 levels.", "{label}");
        }
    }

    /// Лист слова надписи 4096 × 512 — полная цепочка из 13 ступеней: общие писатели её отказывают (у них потолок 12), словарь
    /// листов модели надписи берёт до 14 и отдаёт ту же текстуру при чтении.
    #[test]
    fn a_long_chain_is_written_only_by_the_long_writer() {
        let word = NewTexture { name: "word".to_owned(), width: 4096, height: 512, format: Format::Dxt1, levels: 13, payload: vec![9; payload_bytes(Format::Dxt1, 4096, 512, 13)] };
        let refused = write(std::slice::from_ref(&word)).expect_err("общий писатель");
        assert_eq!(refused.message, "Texture 'word' needs sides above zero and 1–12 levels.");
        assert!(write_host(&[(word.clone(), None)]).is_err());
        let bytes = write_long_chains(std::slice::from_ref(&word)).expect("длинная цепочка");
        let entries = read_entries(&bytes).unwrap();
        assert_eq!((entries[0].name.as_str(), entries[0].width, entries[0].height, entries[0].levels), ("word", 4096, 512, 13));
        assert_eq!(entries[0].payload, word.payload);
        // Потолок длинной цепочки — 14 ступеней.
        let too_long = NewTexture { levels: 15, payload: vec![0; payload_bytes(Format::Dxt1, 4096, 512, 15)], ..word };
        assert!(write_long_chains(&[too_long]).is_err());
    }

    #[test]
    fn levels_past_the_width_of_a_shift_count_as_one_pixel() {
        for levels in [64usize, 65, 66, 200, 255] {
            let want: usize = (0..levels)
                .map(|level| {
                    let side = (4096usize >> level.min(12)).max(1);
                    side.div_ceil(4).pow(2) * 8
                })
                .sum();
            assert_eq!(payload_bytes(Format::Dxt1, 4096, 4096, levels), want, "{levels} ступеней");
        }
    }
}
