//! Манифест контейнера `_manifest.ymf`: какие карты (`.ymap`) какие файлы типов
//! (`.ytyp`) используют. Файл — PSO, числа big-endian.
//!
//! Модуль собирает новый манифест (`fresh`), проверяет его повторным чтением
//! (`verify_fresh`), вливает связи в чужой манифест (`merge`) и считает связи
//! готового файла (`count_links`). Имена модуль не проверяет: это дело слоя команд.

use crate::error::{Error, Result};
use crate::pso::{self, Array, Object};
use crate::ymap_write::meta_name;

/// Одна связь запроса: карта и файлы типов, которые она использует.
#[derive(Debug, Clone, PartialEq)]
pub struct Dependency {
    pub map: String,
    pub types: Vec<String>,
}

/// Имена блоков и размеры записей формата.
mod tag {
    pub const HASHES: u32 = 6;
    pub const LINKS: u32 = 0xc11f_3ee1;
    pub const ROOT: u32 = 0x93a6_8a2f;
    /// Тип элементов массива хешей.
    pub const HASH_ELEMENT: u8 = 0x0b;
    pub const LINK_SIZE: usize = 24;
    pub const ROOT_SIZE: usize = 96;
    /// Данные в файле начинаются сразу после 16-байтного заголовка раздела `PSIN`.
    pub const DATA_AT: usize = 16;
}

/// Смещение массива связей в корне и массива типов в записи связи.
const ROOT_LINKS: usize = 48;
const LINK_TYPES: usize = 8;

/// Число связей в корне хранится в u16: больше в файл не записать.
const LINKS_UP_TO: usize = 0xFFFF;
const MSG_REOPEN: &str = "Compiled _manifest.ymf failed semantic reopen.";
const MSG_NOT_PSO: &str = "Manifest base is not a PSO _manifest.ymf.";
const MSG_NOT_MANIFEST: &str = "Manifest base is not a CPackFileMetaData manifest.";
const MSG_NO_LINKS: &str = "Manifest base has no link array.";
const MSG_LINKS_SCALAR: &str = "Manifest base link array is not a list of links.";

/// Предельные числа, которые держит только `fresh`.
const TYPES_UP_TO: usize = 16;
const MAPS_UP_TO: usize = 64;

/// Раздел `PSCH`, одинаковый у любого набора связей (276 байт вместе с заголовком), шестнадцатеричной строкой.
const SCHEMA_HEX: &str = concat!(
    "505343480000011400000003c11f3ee10000002493a68a2f0000006c6452a05b",
    "0000010800000005000000180000000031af439f0b0700000000000000000100",
    "0e0000006452a05b6452a05b0f00000400200001000001000b07000000000000",
    "8fb42ae60d000008000000030000000c0000006000000000000001000c000000",
    "c25b3923b52cae230d00000000000000000001000c00000059869c63f78afb23",
    "0d00001000000002000001000c000000d0ad6e622bda143f0d00002000000004",
    "000001000c000000c11f3ee1dd4c5ccc0d00003000000006000001000c000000",
    "5a564e50d2611c990d00004000000008000001000c0000002c32529038767a8f",
    "0d0000500000000a010000012156909600000000",
);

/// Раздел `PSCH` байтами.
fn schema_bytes() -> Vec<u8> {
    (0..SCHEMA_HEX.len())
        .step_by(2)
        .map(|at| {
            u8::from_str_radix(&SCHEMA_HEX[at..at + 2], 16)
                .expect("схема: не шестнадцатеричная пара")
        })
        .collect()
}

// ------------------------------------------------------------ запись

/// Накопитель чисел big-endian.
#[derive(Default)]
struct Out(Vec<u8>);

impl Out {
    fn u32(&mut self, value: u32) -> &mut Self {
        self.0.extend(value.to_be_bytes());
        self
    }

    fn u16(&mut self, value: u16) -> &mut Self {
        self.0.extend(value.to_be_bytes());
        self
    }

    fn raw(&mut self, bytes: &[u8]) -> &mut Self {
        self.0.extend_from_slice(bytes);
        self
    }
}

fn check_counts(dependencies: &[Dependency]) -> Result<()> {
    let maps = dependencies.len();
    if maps == 0 || maps > MAPS_UP_TO {
        return Err(Error::argument("Manifest needs 1–64 map dependencies."));
    }
    match dependencies
        .iter()
        .find(|d| !(1..=TYPES_UP_TO).contains(&d.types.len()))
    {
        Some(d) => Err(Error::argument(format!(
            "Manifest map {} needs 1–16 types.",
            d.map
        ))),
        None => Ok(()),
    }
}

/// Блок хешей: хеши типов всех связей подряд.
fn hash_block(dependencies: &[Dependency]) -> Vec<u8> {
    dependencies.iter().flat_map(type_hashes).collect()
}

/// Блок связей: по записи на карту; указатель на её хеши растёт на длину предыдущих.
fn link_block(dependencies: &[Dependency]) -> Vec<u8> {
    let mut block = Out::default();
    let mut next_type = 0u32;
    for dep in dependencies {
        let count = dep.types.len() as u16;
        let pointer = 1 | (next_type << 12);
        next_type += 4 * u32::from(count);
        block
            .u32(meta_name(&dep.map))
            .u32(0)
            .u32(pointer)
            .u32(0)
            .u16(count)
            .u16(count)
            .u32(0);
    }
    block.0
}

/// Корень: нули, кроме указателя на блок 2 и числа связей (дважды).
fn root_block(map_count: usize) -> [u8; tag::ROOT_SIZE] {
    let mut root = [0u8; tag::ROOT_SIZE];
    let count = (map_count as u16).to_be_bytes();
    root[ROOT_LINKS..ROOT_LINKS + 4].copy_from_slice(&2u32.to_be_bytes());
    root[56..58].copy_from_slice(&count);
    root[58..60].copy_from_slice(&count);
    root
}

/// Новый манифест по списку связей; байты совпадают с тем, что пишет программа-хост.
pub fn fresh(dependencies: &[Dependency]) -> Result<Vec<u8>> {
    check_counts(dependencies)?;

    let hashes = hash_block(dependencies);
    let links = link_block(dependencies);
    let root = root_block(dependencies.len());

    // Блоки по порядку: хеши, связи, корень (корень — всегда последний).
    let blocks: [(u32, &[u8]); 3] = [
        (tag::HASHES, &hashes),
        (tag::LINKS, &links),
        (tag::ROOT, &root),
    ];
    let data_len = tag::DATA_AT + blocks.iter().map(|(_, body)| body.len()).sum::<usize>();

    let mut file = Out::default();
    file.raw(b"PSIN").u32(data_len as u32).raw(&[0; 8]);
    for (_, body) in &blocks {
        file.raw(body);
    }
    file.raw(b"PMAP")
        .u32((tag::DATA_AT + 16 * blocks.len()) as u32)
        .u32(blocks.len() as u32)
        .u16(blocks.len() as u16)
        .raw(&[0x70, 0x70]);
    let mut at = tag::DATA_AT;
    for (name, body) in &blocks {
        file.u32(*name).u32(at as u32).u32(0).u32(body.len() as u32);
        at += body.len();
    }
    file.raw(&schema_bytes());
    Ok(file.0)
}

// ------------------------------------------------------------ проверка записанного

/// Файл, прочитанный по фиксированным смещениям; любой выход за границы даёт `None`.
struct Scan<'a> {
    data: &'a [u8],
    map_at: usize,
    blocks: u16,
    root_id: u32,
}

impl<'a> Scan<'a> {
    fn bytes<const N: usize>(data: &[u8], at: usize) -> Option<[u8; N]> {
        data.get(at..at.checked_add(N)?)?.try_into().ok()
    }

    fn open(data: &'a [u8]) -> Option<Self> {
        if data.get(..4)? != b"PSIN" {
            return None;
        }
        let map_at = u32::from_be_bytes(Self::bytes(data, 4)?) as usize;
        if data.get(map_at..map_at.checked_add(4)?)? != b"PMAP" {
            return None;
        }
        let root_id = u32::from_be_bytes(Self::bytes(data, map_at.checked_add(8)?)?);
        let blocks = u16::from_be_bytes(Self::bytes(data, map_at.checked_add(12)?)?);
        Some(Self {
            data,
            map_at,
            blocks,
            root_id,
        })
    }

    fn be32(&self, at: usize) -> Option<u32> {
        Self::bytes(self.data, at).map(u32::from_be_bytes)
    }

    fn be16(&self, at: usize) -> Option<u16> {
        Self::bytes(self.data, at).map(u16::from_be_bytes)
    }

    /// Смещение блока `id` (с единицы), если у него то самое имя.
    fn block_at(&self, id: u32, wanted: u32) -> Option<usize> {
        if !(1..=u32::from(self.blocks)).contains(&id) {
            return None;
        }
        let entry = self.map_at.checked_add(16 + (id as usize - 1) * 16)?;
        let (name, offset) = (self.be32(entry)?, self.be32(entry.checked_add(4)?)?);
        (name == wanted).then_some(offset as usize)
    }

    /// Адрес по указателю массива: младшие 12 бит — номер блока, остальное — сдвиг.
    fn follow(&self, pointer: u32, wanted: u32) -> Option<usize> {
        self.block_at(pointer & 0xfff, wanted)?
            .checked_add((pointer >> 12) as usize)
    }

    /// Запись связи по адресу `record` описывает `dep`: карта, число типов и каждый их хеш.
    fn link_matches(&self, record: usize, dep: &Dependency) -> Option<()> {
        (self.be32(record)? == meta_name(&dep.map)).then_some(())?;
        let pointer = self.be32(record.checked_add(LINK_TYPES)?)?;
        let types_at = self.follow(pointer, tag::HASHES)?;
        (usize::from(self.be16(record.checked_add(16)?)?) == dep.types.len()).then_some(())?;
        dep.types.iter().enumerate().try_for_each(|(n, name)| {
            (self.be32(types_at.checked_add(n * 4)?)? == meta_name(name)).then_some(())
        })
    }
}

fn reopens(bytes: &[u8], dependencies: &[Dependency]) -> Option<()> {
    let scan = Scan::open(bytes)?;
    let root_at = scan.block_at(scan.root_id, tag::ROOT)?;
    let links_ptr = scan.be32(root_at.checked_add(ROOT_LINKS)?)?;
    let linked = scan.be16(root_at.checked_add(ROOT_LINKS + 8)?)?;
    if usize::from(linked) != dependencies.len() {
        return None;
    }
    let links_at = scan.follow(links_ptr, tag::LINKS)?;

    for (index, dep) in dependencies.iter().enumerate() {
        let record = links_at.checked_add(index * tag::LINK_SIZE)?;
        scan.link_matches(record, dep)?;
    }
    Some(())
}

/// Повторное чтение собранного файла по фиксированным смещениям.
pub fn verify_fresh(bytes: &[u8], dependencies: &[Dependency]) -> Result<()> {
    reopens(bytes, dependencies).ok_or_else(|| Error::broken(MSG_REOPEN))
}

// ------------------------------------------------------------ слияние

/// Сколько записей лежало в сохраняемых массивах корня основы до слияния.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Kept {
    pub map_data_groups: usize,
    pub imap_dependencies: usize,
    pub imap_dependencies2: usize,
    pub itype_dependencies2: usize,
    pub hd_txd_bindings: usize,
    pub interiors: usize,
}

fn array_in(root: &Object, offset: usize) -> Option<&Array> {
    root.arrays
        .iter()
        .find_map(|(at, array)| (*at == offset).then_some(array))
}

/// Число записей массива корня: у структур их число, у скаляров — байты, делённые на 4.
fn entries_at(root: &Object, offset: usize) -> usize {
    let Some(array) = array_in(root, offset) else {
        return 0;
    };
    match array {
        Array::Structs(items) => items.len(),
        Array::Scalars { bytes, .. } => bytes.len() / 4,
    }
}

fn measure_kept(root: &Object) -> Kept {
    let entries = |offset: usize| entries_at(root, offset);
    Kept {
        map_data_groups: entries(0),
        hd_txd_bindings: entries(16),
        imap_dependencies: entries(32),
        imap_dependencies2: entries(ROOT_LINKS),
        itype_dependencies2: entries(64),
        interiors: entries(80),
    }
}

fn type_hashes(dep: &Dependency) -> Vec<u8> {
    dep.types
        .iter()
        .flat_map(|t| meta_name(t).to_be_bytes())
        .collect()
}

fn new_link(dep: &Dependency) -> Object {
    let mut bytes = vec![0u8; tag::LINK_SIZE];
    bytes[..4].copy_from_slice(&meta_name(&dep.map).to_be_bytes());
    let types = Array::Scalars {
        dtype: tag::HASH_ELEMENT,
        bytes: type_hashes(dep),
    };
    Object {
        name: tag::LINKS,
        bytes,
        arrays: vec![(LINK_TYPES, types)],
    }
}

/// Первые четыре байта записи связи — хеш имени карты.
fn link_map(link: &Object) -> u32 {
    u32::from_be_bytes(std::array::from_fn(|i| link.bytes[i]))
}

/// Хеши типов, записанные в связи; пусто, если массива нет или он не скалярный.
fn types_of_link(link: &Object) -> &[u8] {
    match array_in(link, LINK_TYPES) {
        Some(Array::Scalars { bytes, .. }) => bytes.as_slice(),
        _ => &[],
    }
}

/// Проверка готового файла: оставшиеся связи основы плюс по одной на запрос, и хвост
/// списка совпадает с запросом по карте и хешам типов. Возвращает число связей.
fn reread_links(bytes: &[u8], kept_links: usize, dependencies: &[Dependency]) -> Option<usize> {
    let root = pso::parse(bytes).ok()?.root_object().ok()?;
    let Some(Array::Structs(links)) = array_in(&root, ROOT_LINKS) else {
        return None;
    };
    if links.len() != kept_links + dependencies.len() {
        return None;
    }
    let tail = links[kept_links..].iter().zip(dependencies);
    let agrees = tail.into_iter().all(|(link, dep)| {
        link_map(link) == meta_name(&dep.map) && types_of_link(link) == type_hashes(dep).as_slice()
    });
    agrees.then_some(links.len())
}

#[derive(Debug, Clone, PartialEq)]
pub struct Merged {
    pub bytes: Vec<u8>,
    pub kept: Kept,
    pub replaced: usize,
    pub links: usize,
}

/// Список связей в корне основы; отказ — по тексту из документации.
fn link_list(root: &mut Object) -> Result<&mut Vec<Object>> {
    let found = root
        .arrays
        .iter_mut()
        .find_map(|(at, array)| (*at == ROOT_LINKS).then_some(array));
    match found {
        None => Err(Error::argument(MSG_NO_LINKS)),
        Some(Array::Scalars { .. }) => Err(Error::argument(MSG_LINKS_SCALAR)),
        Some(Array::Structs(items)) => Ok(items),
    }
}

/// Вливает связи запроса в основу: связь с уже перечисленной картой заменяется
/// (и уходит в конец списка), остальные добавляются в конец.
pub fn merge(base: &[u8], dependencies: &[Dependency]) -> Result<Merged> {
    check_counts(dependencies)?;
    let file = pso::parse(base).map_err(|_| Error::argument(MSG_NOT_PSO))?;
    if file.blocks.get(file.root).map(|b| b.name) != Some(tag::ROOT) {
        return Err(Error::argument(MSG_NOT_MANIFEST));
    }
    let mut root = file.root_object()?;
    let kept = measure_kept(&root);

    let list = link_list(&mut root)?;
    let requested: Vec<u32> = dependencies.iter().map(|d| meta_name(&d.map)).collect();
    let before = list.len();
    list.retain(|link| !requested.contains(&link_map(link)));
    let (kept_links, replaced) = (list.len(), before - list.len());
    if kept_links + dependencies.len() > LINKS_UP_TO {
        return Err(Error::argument(format!(
            "Manifest would hold {} map dependencies, at most {LINKS_UP_TO} fit.",
            kept_links + dependencies.len()
        )));
    }
    list.extend(dependencies.iter().map(new_link));

    // Схема основы плюс то, чего в ней не хватает из схемы `fresh`.
    let fresh_schema = schema_bytes();
    let mut schema = file.elements.clone();
    let missing: Vec<_> = pso::schema_elements(&fresh_schema)?
        .into_iter()
        .filter(|e| schema.iter().all(|have| have.name != e.name))
        .collect();
    schema.extend(missing);

    let bytes = pso::write(&schema, &mut root)?;
    let links =
        reread_links(&bytes, kept_links, dependencies).ok_or_else(|| Error::broken(MSG_REOPEN))?;
    Ok(Merged {
        bytes,
        kept,
        replaced,
        links,
    })
}

/// Число связей готового манифеста (имя корня не проверяется).
pub fn count_links(bytes: &[u8]) -> Result<usize> {
    let root = pso::parse(bytes)?.root_object()?;
    if let Some(Array::Structs(items)) = array_in(&root, ROOT_LINKS) {
        return Ok(items.len());
    }
    Ok(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hash::sha256_hex;

    const ONE: &[u8] = include_bytes!("../../../parity/host-port/manifest/one-map-one-type.ymf");
    const TWO: &[u8] =
        include_bytes!("../../../parity/host-port/manifest/two-maps-three-types.ymf");
    const THREE: &[u8] =
        include_bytes!("../../../parity/host-port/manifest/three-maps-nine-types.ymf");
    const MERGED: &[u8] =
        include_bytes!("../../../parity/host-port/manifest/merge-into-one-map.ymf");
    const MERGED2: &[u8] =
        include_bytes!("../../../parity/host-port/manifest/merge-two-into-one-map.ymf");

    fn dep(map: &str, types: &[&str]) -> Dependency {
        Dependency {
            map: map.to_string(),
            types: types.iter().map(|t| t.to_string()).collect(),
        }
    }

    /// Связи из списка «карта, её типы».
    fn deps_of(list: &[(&str, &[&str])]) -> Vec<Dependency> {
        list.iter().map(|&(map, types)| dep(map, types)).collect()
    }

    #[test]
    fn host_samples_are_reproduced_byte_for_byte() {
        let samples: [(Vec<Dependency>, &[u8]); 3] = [
            (
                deps_of(&[("astral_probe_map", &["astral_probe_type"])]),
                ONE,
            ),
            (
                deps_of(&[
                    ("astral_probe_map", &["t_one", "t_two"]),
                    ("other_map", &["t_three"]),
                ]),
                TWO,
            ),
            (
                deps_of(&[
                    ("prop_a", &["a1", "a2", "a3"]),
                    ("prop_bb", &["b1"]),
                    ("prop_ccc", &["c1", "c2", "c3", "c4", "c5"]),
                ]),
                THREE,
            ),
        ];
        for (deps, expected) in samples {
            assert_eq!(fresh(&deps).unwrap(), expected);
        }
        assert_eq!(
            sha256_hex(ONE),
            "c13c2ed3c9cb7799ea6df9cf373c0f22ab92b3dae398c2588fc7c2447fd1925e"
        );
    }

    #[test]
    fn written_file_reopens_only_with_the_same_maps_and_types() {
        let deps = deps_of(&[("prop_a", &["a1", "a2", "a3"]), ("prop_bb", &["b1"])]);
        let bytes = fresh(&deps).unwrap();
        assert!(verify_fresh(&bytes, &deps).is_ok());
        let other = deps_of(&[("prop_x", &["a1", "a2", "a3"]), ("prop_bb", &["b1"])]);
        assert_eq!(
            verify_fresh(&bytes, &other).unwrap_err().message,
            MSG_REOPEN
        );
        assert!(verify_fresh(&[], &deps).is_err());
        assert!(verify_fresh(&bytes[..195], &deps_of(&[("prop_a", &["a1", "a2", "a3"])])).is_err());
    }

    #[test]
    fn counts_are_limited_in_fresh_and_merge_alike() {
        let need_maps = "Manifest needs 1–64 map dependencies.";
        let need_types = "Manifest map m needs 1–16 types.";
        let many: Vec<Dependency> = (0..65).map(|i| dep(&format!("m{i}"), &["t"])).collect();
        let seventeen: Vec<String> = (0..17).map(|i| format!("t{i}")).collect();
        let refs: Vec<&str> = seventeen.iter().map(String::as_str).collect();
        assert_eq!(fresh(&[]).unwrap_err().message, need_maps);
        assert_eq!(fresh(&[dep("m", &[])]).unwrap_err().message, need_types);
        assert_eq!(fresh(&many).unwrap_err().message, need_maps);
        assert!(fresh(&[dep("m", &refs)]).is_err());
        // слияние держит те же пределы и говорит теми же словами
        let merge_message = |deps: &[Dependency]| merge(ONE, deps).unwrap_err().message;
        assert_eq!(merge_message(&[]), need_maps);
        assert_eq!(merge_message(&[dep("m", &[])]), need_types);
        assert_eq!(merge_message(&many), need_maps);
        assert_eq!(merge_message(&[dep("m", &refs)]), need_types);
        assert!(merge(ONE, &[dep("m", &refs[..16])]).is_ok());
    }

    /// Основа с `links` связями: корень `one-map-one-type`, дополненный записями `pad<i>`.
    fn base_with_links(links: usize) -> Vec<u8> {
        let file = pso::parse(ONE).unwrap();
        let mut root = file.root_object().unwrap();
        let items = link_list(&mut root).expect("нет массива связей");
        let have = items.len();
        items.extend((have..links).map(|i| new_link(&dep(&format!("pad{i}"), &["t"]))));
        pso::write(&file.elements, &mut root).unwrap()
    }

    #[test]
    fn merge_refuses_by_name_when_the_link_count_would_not_fit_in_u16() {
        let base = base_with_links(0xFFFF);
        assert_eq!(count_links(&base).unwrap(), 0xFFFF);
        let refusal = merge(&base, &[dep("one_more", &["t"])]).unwrap_err();
        assert_eq!(
            refusal.message,
            "Manifest would hold 65536 map dependencies, at most 65535 fit."
        );
        // Замена существующей связи число не меняет и проходит.
        let done = merge(&base, &[dep("pad7", &["t", "u"])]).unwrap();
        assert_eq!((done.replaced, done.links), (1, 0xFFFF));
        // Одна связь запаса: пара новых не влезает, одна новая влезает.
        let almost = base_with_links(0xFFFE);
        let pair = deps_of(&[("one_more", &["t"]), ("two_more", &["t"])]);
        assert_eq!(
            merge(&almost, &pair).unwrap_err().kind,
            crate::error::Kind::Argument
        );
        assert_eq!(
            merge(&almost, &[dep("one_more", &["t"])]).unwrap().links,
            0xFFFF
        );
    }

    #[test]
    fn merging_follows_the_host_chain() {
        let step = merge(ONE, &[dep("other_map", &["other_type_a", "other_type_b"])]).unwrap();
        assert_eq!(step.bytes, MERGED);
        let shape = (step.kept.imap_dependencies2, step.replaced, step.links);
        assert_eq!(shape, (1, 0, 2));
        let next = merge(MERGED, &[dep("third_map", &["third_type"])]).unwrap();
        assert_eq!(next.bytes, MERGED2);
        assert_eq!(count_links(&next.bytes).unwrap(), 3);
    }

    #[test]
    fn a_listed_map_is_replaced_and_moves_to_the_end() {
        let out = merge(MERGED, &[dep("other_map", &["x_one"])]).unwrap();
        assert_eq!((out.replaced, out.links), (1, 2));
        let root = pso::parse(&out.bytes).unwrap().root_object().unwrap();
        let Some(Array::Structs(links)) = array_in(&root, ROOT_LINKS) else {
            panic!("нет связей")
        };
        let order: Vec<u32> = links.iter().map(link_map).collect();
        assert_eq!(
            order[..2],
            [meta_name("astral_probe_map"), meta_name("other_map")]
        );
        assert_eq!(
            merge(MERGED, &[]).unwrap_err().message,
            "Manifest needs 1–64 map dependencies."
        );
    }

    #[test]
    fn bad_bases_are_refused_with_the_documented_texts() {
        let request = [dep("m", &["t"])];
        for junk in [&b""[..], b"not a pso", &[0u8; 480]] {
            assert_eq!(merge(junk, &request).unwrap_err().message, MSG_NOT_PSO);
        }
        let mut other_root = ONE.to_vec();
        let pmap = other_root.windows(4).position(|w| w == b"PMAP").unwrap();
        other_root[pmap + 16 + 2 * 16] ^= 1;
        assert_eq!(
            merge(&other_root, &request).unwrap_err().message,
            MSG_NOT_MANIFEST
        );
        assert!(count_links(&[]).is_err());
    }

    #[test]
    fn a_request_with_too_many_types_is_refused_before_the_file_is_built() {
        let names: Vec<String> = (0..65536).map(|i| format!("t{i}")).collect();
        let refs: Vec<&str> = names.iter().map(String::as_str).collect();
        let err = merge(ONE, &[dep("huge", &refs)]).unwrap_err();
        assert_eq!(
            (err.kind, err.message.as_str()),
            (
                crate::error::Kind::Argument,
                "Manifest map huge needs 1–16 types."
            )
        );
    }
}
