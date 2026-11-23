//! Переименование текстуры в готовом словаре `.ytd` Legacy без пересборки файла.
//!
//! Игра ищет текстуру по хешу имени, а массивы хешей и указателей лежат рядом, отсортированные по хешу.
//! Поэтому правка — новая строка, новый хеш с новым указателем имени и перестановка двух массивов.
//! Графическая область и объекты текстур остаются как были. Здесь же общие для писателей словарей
//! мелочи: выравнивание, флаги одной страницы, смещения корня и сборка заголовка RSC7.

use miniz_oxide::deflate::compress_to_vec;

use crate::{
    error::{Error, Kind, Result},
    hash::joaat,
    resource::{Resource, RSC7_MAGIC, SYSTEM_BASE, VERSION_YTD, VERSION_YTD_ENHANCED},
    ytd_write::TEXTURE_BYTES,
};

#[derive(Debug)]
pub struct Renamed {
    pub bytes: Vec<u8>,
    pub was_noop: bool,
}

impl Renamed {
    /// Имя не менялось: файл возвращается как есть.
    fn untouched(original: &[u8]) -> Self {
        Self { bytes: original.to_vec(), was_noop: true }
    }
}

/// Переименовывает текстуру `from` в `to`; при поиске регистр не важен, новое имя пишется как есть.
pub fn rename_texture(bytes: &[u8], from: &str, to: &str) -> Result<Renamed> {
    let res = Resource::parse(bytes).and_then(|parsed| legacy_only(&parsed).map(|()| parsed))?;
    let table = Table::open(&res)?;

    let target = table.find(from).ok_or_else(|| table.missing(from))?;
    if from == to {
        return Ok(Renamed::untouched(bytes));
    }
    let usable = (1..=NAME_MAX).contains(&to.len()) && to.is_ascii() && !to.contains('\0');
    first_refusal([
        (!usable, Error::argument("The new texture name must be 1 to 255 ASCII characters.")),
        (table.named(to).any(|index| index != target), Error::operation(format!("texture '{to}' already exists inside YTD."))),
    ])?;

    let (name_at, growth) = table.room_for(target, to.len())?;
    let header = res.header;
    let old = &table.rows[target];

    // Новое тело: системная область (подросшая, если надо) и прежняя графическая.
    let (system, graphics) = res.data().split_at(header.system_size);
    let system_len = growth.map_or(system.len(), |(_, size)| size);
    let mut body = Vec::with_capacity(system_len.max(system.len()) + graphics.len());
    body.extend_from_slice(system);
    body.resize(system_len, 0);
    body.extend_from_slice(graphics);

    if !table.shares_name(target) {
        wipe_string(&mut body, old.name_at);
    }
    put(&mut body, name_at, to.as_bytes());
    // Строка без места под завершающий нуль (конец данных) остаётся без него.
    if let Some(end) = body.get_mut(name_at + to.len()) {
        *end = 0;
    }
    put(&mut body, old.object + offsets::OBJECT_NAME, &(SYSTEM_BASE + name_at as u64).to_le_bytes());

    // Порядок записей по новым хешам; у остальных хеш остаётся тем, что записан в файле.
    let mut keyed: Vec<(u32, u64)> = table.rows.iter().enumerate().map(|(index, row)| (if index == target { joaat(to) } else { row.hash }, row.pointer)).collect();
    keyed.sort_by_key(|&(hash, _)| hash);
    for (slot, (hash, pointer)) in keyed.into_iter().enumerate() {
        put(&mut body, table.hashes_at + slot * 4, &hash.to_le_bytes());
        put(&mut body, table.list_at + slot * 8, &pointer.to_le_bytes());
    }

    // Системная область выросла до одной страницы: так и записывается в блоке сведений о страницах.
    if let Some(count) = growth.and(res.pointer_at(table.root + offsets::ROOT_PAGES)).and_then(|at| body.get_mut(at + 8)) {
        *count = 1;
    }

    let system_flags = growth.map_or(header.system_flags, |(flags, _)| flags);
    Ok(Renamed { bytes: rsc_file(header.declared_version, system_flags, header.graphics_flags, pack(&body)), was_noop: false })
}

/// Принимается только полный словарь Legacy; отказы проверяются в таком порядке: Enhanced, чужая версия, обрезан.
fn legacy_only(res: &Resource) -> Result<()> {
    match res.version() {
        VERSION_YTD_ENHANCED => Err(Error::new(Kind::Enhanced, "Словарь текстур из GTA V Enhanced: Astral читает Legacy.")),
        VERSION_YTD if res.complete => Ok(()),
        VERSION_YTD => Err(Error::broken("Словарь текстур обрезан: правка отменена.")),
        version => Err(Error::version(format!("Это не словарь текстур Legacy (версия {version})."))),
    }
}

fn put(body: &mut [u8], at: usize, bytes: &[u8]) {
    body[at..at + bytes.len()].copy_from_slice(bytes);
}

/// Затирает строку до её нуля вместе с ним: имя в таблице читается не длиннее предела, сама строка может быть длиннее.
fn wipe_string(body: &mut [u8], at: usize) {
    let end = body[at..].iter().position(|&byte| byte == 0).map_or(body.len(), |zero| at + zero + 1);
    body[at..end].fill(0);
}

// ---------------------------------------------------------------------------------------------
// Таблица записей словаря
// ---------------------------------------------------------------------------------------------

struct Row {
    hash: u32,
    pointer: u64,
    object: usize,
    name: String,
    name_at: usize,
}

struct Table<'a> {
    res: &'a Resource,
    root: usize,
    hashes_at: usize,
    list_at: usize,
    rows: Vec<Row>,
}

impl<'a> Table<'a> {
    fn open(res: &'a Resource) -> Result<Self> {
        let root = require(res.root(), "Корень словаря текстур недоступен.")?;
        let (hashes, list) = (res.pointer_list(root + offsets::ROOT_HASHES)?, res.pointer_list(root + offsets::ROOT_LIST)?);
        first_refusal([(hashes.count != list.count, Error::broken("Число хешей не сходится с числом текстур."))])?;
        let hashes_at = require(res.at(hashes.entries), "Массив хешей словаря недоступен.")?;
        let list_at = require(res.at(list.entries), "Массив текстур словаря недоступен.")?;
        let read_row = |index: usize| -> Result<Row> {
            let pointer = res.u64(list_at + index * 8)?;
            let object = require(res.at(pointer), "Указатель на текстуру пуст.")?;
            let name_pointer = res.u64(object + offsets::OBJECT_NAME)?;
            let (name, name_at) = require(res.cstring(name_pointer).zip(res.at(name_pointer)), "У текстуры нет имени.")?;
            let hash = res.u32(hashes_at + index * 4)?;
            Ok(Row { hash, pointer, object, name, name_at })
        };
        let rows = (0..usize::from(list.count)).map(read_row).collect::<Result<_>>()?;
        Ok(Table { res, root, hashes_at, list_at, rows })
    }

    /// Номера записей с таким именем, регистр не важен.
    fn named<'s>(&'s self, name: &'s str) -> impl Iterator<Item = usize> + 's {
        (0..self.rows.len()).filter(move |&index| self.rows[index].name.eq_ignore_ascii_case(name))
    }

    fn find(&self, name: &str) -> Option<usize> {
        self.named(name).next()
    }

    /// Указывает ли ещё чья-нибудь запись на ту же строку имени.
    fn shares_name(&self, row: usize) -> bool {
        let at = self.rows[row].name_at;
        self.rows.iter().filter(|other| other.name_at == at).count() > 1
    }

    fn missing(&self, name: &str) -> Error {
        let mut available = String::new();
        for (index, row) in self.rows.iter().enumerate() {
            if index > 0 {
                available.push_str(", ");
            }
            available.push_str(&row.name);
        }
        Error::operation(format!("texture '{name}' not found inside YTD. Available: {available}"))
    }

    /// Конец занятой части системной области: за ним начинается свободное место для новой строки.
    fn used_end(&self) -> usize {
        let res = self.res;
        let count = self.rows.len();
        let system = &res.data()[..res.header.system_size];
        let fixed = [sizes::ROOT, self.hashes_at + 4 * count, self.list_at + 8 * count];
        let page_info = res.pointer_at(self.root + offsets::ROOT_PAGES).map(|at| at + sizes::PAGE_INFO);
        let last_byte = system.iter().rposition(|&byte| byte != 0).map(|at| at + 1);
        let per_row = self.rows.iter().flat_map(|row| [row.object + TEXTURE_BYTES, row.name_at + row.name.len() + 1]);
        fixed.into_iter().chain(per_row).chain(page_info).chain(last_byte).max().unwrap_or(sizes::ROOT)
    }

    /// Куда лечь строке нового имени и во что вырастет системная область, если места не хватает.
    fn room_for(&self, row: usize, new_len: usize) -> Result<(usize, Option<(u32, usize)>)> {
        let old = &self.rows[row];
        if new_len <= old.name.len() && !self.shares_name(row) {
            return Ok((old.name_at, None));
        }
        let header = &self.res.header;
        let at = align16(self.used_end());
        let end = at + new_len + 1;
        let grown = (end > header.system_size)
            .then(|| {
                let flags = single_page_flags(header.system_flags >> 28, align16(end));
                require(flags, "Системная область не вмещает новое имя.")
            })
            .transpose()?;
        Ok((at, grown))
    }
}

// ---------------------------------------------------------------------------------------------
// Общие мелочи писателей словарей
// ---------------------------------------------------------------------------------------------

/// Первое сработавшее правило «условие → отказ»; порядок правил — порядок проверок.
pub(crate) fn first_refusal(rules: impl IntoIterator<Item = (bool, Error)>) -> Result<()> {
    rules.into_iter().find_map(|(hit, error)| hit.then_some(error)).map_or(Ok(()), Err)
}

/// Значение или отказ `Broken` с готовым текстом.
pub(crate) fn require<T>(found: Option<T>, text: &str) -> Result<T> {
    match found {
        Some(value) => Ok(value),
        None => Err(Error::broken(text)),
    }
}

/// Файл RSC7: заголовок из четырёх слов и уже сжатое тело.
pub(crate) fn rsc_file(declared: u32, system_flags: u32, graphics_flags: u32, packed: Vec<u8>) -> Vec<u8> {
    [RSC7_MAGIC, declared, system_flags, graphics_flags].into_iter().flat_map(u32::to_le_bytes).chain(packed).collect()
}

/// Тело, сжатое уровнем 6.
pub(crate) fn pack(body: &[u8]) -> Vec<u8> {
    compress_to_vec(body, PACK_LEVEL)
}

/// Наименьшее число, кратное 16 и не меньшее `value`.
pub(crate) fn align16(value: usize) -> usize {
    value.next_multiple_of(16)
}

/// Флаги и размер единственной страницы под `size` байт; `None`, если не вмещает и наибольшая.
pub(crate) fn single_page_flags(version_nibble: u32, size: usize) -> Option<(u32, usize)> {
    let shift = size.max(1).div_ceil(sizes::FIRST_PAGE).next_power_of_two().trailing_zeros();
    match shift {
        0..=LARGEST_SHIFT => Some((version_nibble << 28 | 0x2_0000 | shift, sizes::FIRST_PAGE << shift)),
        _ => None,
    }
}

const NAME_MAX: usize = 255;
const LARGEST_SHIFT: u32 = 15;
/// Уровень сжатия, которым пакуют словари Legacy.
pub(crate) const PACK_LEVEL: u8 = 6;

pub(crate) mod sizes {
    pub const FIRST_PAGE: usize = 0x2000;
    pub const PAGE_INFO: usize = 20;
    pub const ROOT: usize = 0x40;
}

/// Смещения полей корня и объекта текстуры, одни и те же у Legacy и gen9.
pub(crate) mod offsets {
    pub const OBJECT_NAME: usize = 0x28;
    pub const ROOT_PAGES: usize = 0x08;
    pub const ROOT_HASHES: usize = 0x20;
    pub const ROOT_LIST: usize = 0x30;
    pub const ROOT_LIST_COUNT: usize = 0x38;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::resource::{page_flag_size, Header};
    use crate::texture::Format;
    use crate::ytd_write::{read_entries, write, NewTexture};

    /// Словарь из однобайтовых текстур 4×4: имя и заливка по номеру.
    fn ledger(names: &[&str]) -> Vec<u8> {
        let textures: Vec<NewTexture> = names
            .iter()
            .enumerate()
            .map(|(n, name)| NewTexture { name: name.to_string(), width: 4, height: 4, format: Format::A8, levels: 1, payload: vec![n as u8 + 1; 16] })
            .collect();
        write(&textures).unwrap()
    }

    fn names_of(file: &[u8]) -> Vec<String> {
        read_entries(file).unwrap().into_iter().map(|entry| entry.name).collect()
    }

    #[test]
    fn page_flags_step_up_exactly_past_each_boundary() {
        for shift in 0..=LARGEST_SHIFT {
            let page = sizes::FIRST_PAGE << shift;
            let up = (shift < LARGEST_SHIFT).then(|| ((1 << 17) | (shift + 1), page << 1));
            assert_eq!(single_page_flags(0, page), Some(((1 << 17) | shift, page)));
            assert_eq!(single_page_flags(0, page + 1), up);
            assert_eq!(page_flag_size((1 << 17) | shift), page);
        }
    }

    #[test]
    fn page_flags_carry_only_four_bits_of_version() {
        let cases = [
            (0xA, 0x2001, 0xa002_0001u32, 0x4000usize),
            (0xD, 0x2000, 0xd002_0000, 0x2000),
            (0xF, 0x10_0000, 0xf002_0007, 0x10_0000),
            (0x10, 0x2000, 0x0002_0000, 0x2000),
            (0xFF, 0x2000, 0xf002_0000, 0x2000),
        ];
        for (nibble, size, flags, page) in cases {
            assert_eq!(single_page_flags(nibble, size), Some((flags, page)), "{nibble:#x} {size:#x}");
        }
        for size in [0, 1, 0x1fff, 0x2000] {
            assert_eq!(single_page_flags(0, size), Some((1 << 17, 0x2000)));
        }
        for size in [0x1000_0001, usize::MAX / 2, usize::MAX] {
            assert_eq!(single_page_flags(0, size), None);
        }
    }

    #[test]
    fn alignment_rounds_up_to_sixteen() {
        for (value, aligned) in [(0, 0), (1, 16), (15, 16), (16, 16), (33, 48), (0x2000, 0x2000)] {
            assert_eq!(align16(value), aligned);
        }
        assert_eq!(align16(usize::MAX - 15), usize::MAX - 15);
    }

    #[cfg(debug_assertions)]
    #[test]
    #[should_panic(expected = "attempt to add with overflow")]
    fn alignment_overflows_at_the_very_top() {
        align16(usize::MAX - 14);
    }

    #[test]
    fn every_refusal_keeps_its_place_in_the_order() {
        let file = ledger(&["red", "green", "blue"]);
        let missing = |name: &str| {
            let listed = names_of(&file).join(", ");
            format!("texture '{name}' not found inside YTD. Available: {listed}")
        };
        let bad = "The new texture name must be 1 to 255 ASCII characters.";
        let wide = "w".repeat(256);
        type Outcome = Option<(Kind, String)>;
        let cases: [(&str, &str, Outcome); 9] = [
            ("nothing", "x", Some((Kind::Operation, missing("nothing")))),
            ("nothing", "", Some((Kind::Operation, missing("nothing")))),
            ("red", "", Some((Kind::Argument, bad.into()))),
            ("red", wide.as_str(), Some((Kind::Argument, bad.into()))),
            ("red", "a\0b", Some((Kind::Argument, bad.into()))),
            ("red", "caf\u{e9}", Some((Kind::Argument, bad.into()))),
            ("red", "green", Some((Kind::Operation, "texture 'green' already exists inside YTD.".into()))),
            ("red", "BLUE", Some((Kind::Operation, "texture 'BLUE' already exists inside YTD.".into()))),
            ("red", "two words\nand a line", None),
        ];
        for (from, to, expected) in cases {
            match (rename_texture(&file, from, to), expected) {
                (Ok(done), None) => assert!(!done.was_noop),
                (Err(error), Some((kind, text))) => {
                    assert_eq!((error.kind, error.message), (kind, text))
                }
                (other, expected) => panic!("{from}->{to}: {other:?} against {expected:?}"),
            }
        }
    }

    #[test]
    fn the_same_spelling_is_returned_untouched_but_a_case_change_is_written() {
        let file = ledger(&["Mixed", "other"]);
        assert!(rename_texture(&file, "mixed", "mixed").unwrap().was_noop);
        let untouched = rename_texture(&file, "Mixed", "Mixed").unwrap();
        assert!(untouched.was_noop);
        assert_eq!(untouched.bytes, file);
        let recased = rename_texture(&file, "MIXED", "mIxEd").unwrap();
        assert!(!recased.was_noop);
        let after = read_entries(&recased.bytes).unwrap();
        assert!(after.iter().any(|entry| entry.name == "mIxEd"));
        assert_eq!(after.len(), 2);
    }

    #[test]
    fn renaming_moves_only_the_name_and_keeps_hash_order() {
        let file = ledger(&["one", "two_longer", "three"]);
        let done = rename_texture(&file, "TWO_LONGER", "zz").unwrap();
        let (before, after) = (read_entries(&file).unwrap(), read_entries(&done.bytes).unwrap());
        assert_eq!(after.len(), before.len());
        let payload_of = |list: &[crate::ytd_write::Entry], name: &str| list.iter().find(|entry| entry.name == name).map(|entry| entry.payload.clone());
        assert_eq!(payload_of(&after, "zz"), payload_of(&before, "two_longer"));
        assert!(after.windows(2).all(|pair| joaat(&pair[0].name) <= joaat(&pair[1].name)));
        assert!(!names_of(&done.bytes).contains(&"two_longer".to_string()));
    }

    #[test]
    fn a_crowded_name_area_grows_a_page_and_keeps_graphics() {
        let short: Vec<String> = (0..24).map(|n| format!("r{n:02}")).collect();
        let refs: Vec<&str> = short.iter().map(String::as_str).collect();
        let original = ledger(&refs);
        let before = Resource::parse(&original).unwrap();
        let mut file = original.clone();
        for (n, name) in short.iter().enumerate() {
            let long = format!("{n:03}{}", "q".repeat(200));
            file = rename_texture(&file, name, &long).unwrap().bytes;
        }
        let after = Resource::parse(&file).unwrap();
        assert!(after.complete);
        assert!(after.header.system_size > before.header.system_size);
        assert_eq!(after.data()[after.header.system_size..], before.data()[before.header.system_size..]);
        let entries = read_entries(&file).unwrap();
        assert_eq!(entries.len(), 24);
        assert!(entries.iter().all(|entry| entry.name.len() == 203));
        let pages = after.pointer_at(after.root().unwrap() + offsets::ROOT_PAGES).unwrap();
        assert_eq!(after.u8(pages + 8).unwrap(), 1);
    }

    #[test]
    fn inputs_that_are_not_dictionaries_are_refused() {
        let gen9 = crate::ytd_gen9::convert(&ledger(&["a"])).unwrap();
        let cases: [(&[u8], Kind); 4] = [(b"", Kind::Broken), (b"junk", Kind::Broken), (&[0u8; 16], Kind::Broken), (&gen9, Kind::Enhanced)];
        for (input, kind) in cases {
            assert_eq!(rename_texture(input, "a", "b").unwrap_err().kind, kind);
        }
    }

    /// Файл, у которого имена первой записи лежат строкой по адресу `name_at` (системная область без графической).
    fn with_name_placed(names: &[&str], place: impl Fn(&mut Vec<u8>, &[Row])) -> Vec<u8> {
        let file = ledger(names);
        let res = Resource::parse(&file).unwrap();
        let table = Table::open(&res).unwrap();
        let mut body = res.data()[..res.header.system_size].to_vec();
        place(&mut body, &table.rows);
        let header = Header { graphics_size: 0, graphics_flags: res.header.graphics_flags & 0xF000_0000, ..res.header };
        Resource::from_parts(header, body).to_file_bytes().unwrap()
    }

    #[test]
    fn a_name_without_a_terminator_at_the_end_of_the_data_renames_without_panic() {
        let file = with_name_placed(&["abcd"], |body, rows| {
            let end = body.len();
            let row = &rows[0];
            body[row.name_at..row.name_at + 5].fill(0);
            body[end - 4..].copy_from_slice(b"abcd");
            put(body, row.object + offsets::OBJECT_NAME, &(SYSTEM_BASE + (end - 4) as u64).to_le_bytes());
        });
        for to in ["xy", "wxyz"] {
            let renamed = rename_texture(&file, "abcd", to).unwrap();
            assert!(!renamed.was_noop);
            let res = Resource::parse(&renamed.bytes).unwrap();
            let table = Table::open(&res).unwrap();
            let names: Vec<&str> = table.rows.iter().map(|row| row.name.as_str()).collect();
            assert_eq!(names, [to]);
        }
    }

    #[test]
    fn renaming_one_of_two_textures_that_share_a_name_string_keeps_the_other_name() {
        let file = ledger(&["aaa", "bbb"]);
        let res = Resource::parse(&file).unwrap();
        let table = Table::open(&res).unwrap();
        let first = table.find("aaa").unwrap();
        let second = table.find("bbb").unwrap();
        let mut body = res.data().to_vec();
        let shared = SYSTEM_BASE + table.rows[first].name_at as u64;
        put(&mut body, table.rows[second].object + offsets::OBJECT_NAME, &shared.to_le_bytes());
        let both_aaa = Resource::from_parts(res.header, body).to_file_bytes().unwrap();
        assert_eq!(names_of(&both_aaa), ["aaa", "aaa"]);

        for to in ["zzz", "zz"] {
            let renamed = rename_texture(&both_aaa, "aaa", to).unwrap();
            let mut names = names_of(&renamed.bytes);
            names.sort();
            let mut want = vec![to.to_string(), "aaa".to_string()];
            want.sort();
            assert_eq!(names, want, "в '{to}'");
        }
    }

    #[test]
    fn a_name_longer_than_the_read_limit_is_erased_to_its_terminator() {
        let file = ledger(&["abc"]);
        let res = Resource::parse(&file).unwrap();
        let table = Table::open(&res).unwrap();
        let mut body = res.data().to_vec();
        let at = align16(table.used_end());
        put(&mut body, at, &[b'x'; 300]);
        put(&mut body, table.rows[0].object + offsets::OBJECT_NAME, &(SYSTEM_BASE + at as u64).to_le_bytes());
        let long = Resource::from_parts(res.header, body).to_file_bytes().unwrap();

        let renamed = rename_texture(&long, &"x".repeat(256), "q").unwrap();
        let after = Resource::parse(&renamed.bytes).unwrap();
        assert_eq!(names_of(&renamed.bytes), ["q"]);
        let leftovers = after.data()[at + 2..at + 301].iter().filter(|&&byte| byte != 0).count();
        assert_eq!(leftovers, 0, "от длинной строки остались байты");
    }
}
