//! Сводка словаря клипов (`.ycd`): анимации, кости и раскладка каналов.
//!
//! Значения каналов не читаются, только их типы и места.

use std::collections::BTreeMap;

use crate::error::{Error, Result};
use crate::resource::Resource;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BoneRef {
    pub bone: u16,
    pub unknown: u8,
    pub track: u8,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AnimationSummary {
    pub hash: u32,
    pub frames: u16,
    pub sequence_frame_limit: u16,
    pub duration: f32,
    pub signature: u32,
    pub bones: Vec<BoneRef>,
    pub sequences: Vec<Vec<Option<&'static str>>>,
}

/// Имена типов каналов; номер в файле равен позиции.
const CHANNEL_TYPES: [&str; 9] = [
    "StaticQuaternion",
    "StaticVector3",
    "StaticFloat",
    "RawFloat",
    "QuantizeFloat",
    "IndirectQuantizeFloat",
    "LinearFloat",
    "CachedQuaternion1",
    "CachedQuaternion2",
];

const MAX_CHAIN: usize = 4096;
/// Счётчики каналов: девять u16 сразу за областью кадров.
const COUNTERS_BYTES: usize = CHANNEL_TYPES.len() * 2;
const BLOCK_HEADER: usize = 0x20;

fn truncated() -> Error {
    Error::broken("Список каналов обрезан.")
}

/// Слот канала: у кэшированных кватернионов он задан типом, у остальных лежит в тегe.
fn slot_of(kind: usize, tag: u16) -> usize {
    match kind {
        7 => 3,
        8 => 4,
        _ => usize::from(tag & 3),
    }
}

/// Один блок последовательностей: группы каналов в порядке номеров.
fn read_block(res: &Resource, block: usize) -> Result<Vec<Vec<Option<&'static str>>>> {
    let data_len = res.u32(block + 4)? as usize;
    let frames_at = res.u32(block + 0x0C)? as usize;
    let frames = usize::from(res.u16(block + 0x16)?);
    let frame_len = usize::from(res.u16(block + 0x18)?);
    let chunk = res.u8(block + 0x1E)?;
    if frames == 0 || chunk == 0 {
        return Err(Error::broken("Последовательность клипа без кадров."));
    }
    let data = res.bytes(block + BLOCK_HEADER, data_len)?;

    let counters_at = frames_at
        .checked_add(frame_len * frames)
        .filter(|at| at.saturating_add(COUNTERS_BYTES) <= data.len())
        .ok_or_else(truncated)?;
    let tag_at = |index: usize| -> Result<u16> {
        data.get(index..index + 2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .ok_or_else(truncated)
    };

    // (группа, слот, тип) в порядке типов и тегов.
    let mut channels = Vec::new();
    let mut cursor = counters_at + COUNTERS_BYTES;
    for kind in 0..CHANNEL_TYPES.len() {
        let count = usize::from(tag_at(counters_at + kind * 2)?);
        for n in 0..count {
            let tag = tag_at(cursor + n * 2)?;
            channels.push((usize::from(tag >> 2), slot_of(kind, tag), kind));
        }
        // Теги добиты до кратного четырём.
        cursor += (count + (4 - count % 4) % 4) * 2;
    }

    let group_count = channels.iter().map(|c| c.0 + 1).max().unwrap_or(0);
    let mut groups: Vec<Vec<Option<&'static str>>> = vec![Vec::new(); group_count];
    for (group, slot, kind) in channels {
        let slots = &mut groups[group];
        if slots.len() <= slot {
            slots.resize(slot + 1, None);
        }
        slots[slot].get_or_insert(CHANNEL_TYPES[kind]);
    }
    Ok(groups)
}

fn read_animation(res: &Resource, hash: u32, anim: usize) -> Result<AnimationSummary> {
    let frames = res.u16(anim + 0x14)?;
    let sequence_frame_limit = res.u16(anim + 0x16)?;
    let duration = res.f32(anim + 0x18)?;
    let signature = res.u32(anim + 0x1C)?;
    let bone_count = usize::from(res.u16(anim + 0x58)?);

    let mut bones = Vec::new();
    if bone_count > 0 {
        let list = res
            .pointer_at(anim + 0x50)
            .ok_or_else(|| Error::broken("Анимация без списка костей."))?;
        for index in 0..bone_count {
            let at = list + index * 4;
            bones.push(BoneRef {
                bone: res.u16(at)?,
                unknown: res.u8(at + 2)?,
                track: res.u8(at + 3)?,
            });
        }
    }

    let block_count = usize::from(res.u16(anim + 0x48)?);
    let mut sequences = Vec::new();
    if block_count > 0 {
        let list = res
            .pointer_at(anim + 0x40)
            .ok_or_else(|| Error::broken("Анимация без последовательностей."))?;
        for index in 0..block_count {
            let block = res
                .pointer_at(list + index * 8)
                .ok_or_else(|| Error::broken("Последовательность без блока."))?;
            sequences.extend(read_block(res, block)?);
        }
    }

    Ok(AnimationSummary {
        hash,
        frames,
        sequence_frame_limit,
        duration,
        signature,
        bones,
        sequences,
    })
}

/// Обходит цепочку записей одной корзины и складывает анимации по хешу.
fn walk_chain(
    res: &Resource,
    first: usize,
    found: &mut BTreeMap<u32, AnimationSummary>,
) -> Result<()> {
    let mut entry = Some(first);
    for _ in 0..MAX_CHAIN {
        let Some(at) = entry else {
            return Ok(());
        };
        let hash = res.u32(at)?;
        if let Some(anim) = res.pointer_at(at + 8) {
            found.insert(hash, read_animation(res, hash, anim)?);
        }
        entry = res.pointer_at(at + 0x10);
    }
    match entry {
        None => Ok(()),
        Some(_) => Err(Error::broken("Цепочка карты анимаций слишком длинная.")),
    }
}

pub fn summarize(bytes: &[u8]) -> Result<Vec<AnimationSummary>> {
    let res = Resource::parse(bytes)?;
    let root = res
        .root()
        .ok_or_else(|| Error::broken("Словарь клипов без корня."))?;
    let table = res
        .pointer_at(root + 0x18)
        .and_then(|map| res.pointer_at(map + 0x18).map(|buckets| (map, buckets)));
    let Some((map, buckets)) = table else {
        return Ok(Vec::new());
    };
    let capacity = usize::from(res.u16(map + 0x20)?);

    let mut found = BTreeMap::new();
    for bucket in 0..capacity {
        if let Some(first) = res.pointer_at(buckets + bucket * 8) {
            walk_chain(&res, first, &mut found)?;
        }
    }
    Ok(found.into_values().collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::resource::{Header, RSC7_MAGIC};

    const SYSTEM: usize = 16 * 1024;
    const MAP: usize = 0x100;
    const BUCKETS: usize = 0x200;
    const ENTRIES: usize = 0x300;
    const ANIMS: usize = 0x1000;
    const BLOCKS: usize = 0x2000;

    fn ptr(offset: usize) -> u64 {
        0x5000_0000 + offset as u64
    }

    /// Системная область версии 46 из нулей с картой на 16 корзин.
    struct Image(Vec<u8>);

    impl Image {
        fn new() -> Self {
            let mut image = Image(vec![0; SYSTEM]);
            image.put64(0x18, ptr(MAP));
            image.put64(MAP + 0x18, ptr(BUCKETS));
            image.put16(MAP + 0x20, 16);
            image
        }

        fn put(&mut self, at: usize, bytes: &[u8]) {
            self.0[at..at + bytes.len()].copy_from_slice(bytes);
        }
        fn put16(&mut self, at: usize, v: u16) {
            self.put(at, &v.to_le_bytes());
        }
        fn put32(&mut self, at: usize, v: u32) {
            self.put(at, &v.to_le_bytes());
        }
        fn put64(&mut self, at: usize, v: u64) {
            self.put(at, &v.to_le_bytes());
        }

        /// Запись цепочки с анимацией (или без неё, если `anim` равен нулю).
        fn entry(&mut self, at: usize, hash: u32, anim: usize, next: usize) {
            self.put32(at, hash);
            if anim != 0 {
                self.put64(at + 8, ptr(anim));
            }
            if next != 0 {
                self.put64(at + 0x10, ptr(next));
            }
        }

        fn bucket(&mut self, index: usize, entry: usize) {
            self.put64(BUCKETS + index * 8, ptr(entry));
        }

        fn anim(&mut self, at: usize, frames: u16, limit: u16, duration: f32, signature: u32) {
            self.put16(at + 0x14, frames);
            self.put16(at + 0x16, limit);
            self.put(at + 0x18, &duration.to_le_bytes());
            self.put32(at + 0x1C, signature);
        }

        /// Одна запись в корзине 0 с простой анимацией; возвращает смещение анимации.
        fn single(&mut self) -> usize {
            self.entry(ENTRIES, 5, ANIMS, 0);
            self.bucket(0, ENTRIES);
            self.anim(ANIMS, 4, 5, 0.1, 0);
            ANIMS
        }

        fn bones(&mut self, anim: usize, list: usize, bones: &[(u16, u8, u8)]) {
            self.put16(anim + 0x58, bones.len() as u16);
            self.put64(anim + 0x50, ptr(list));
            for (i, (bone, unknown, track)) in bones.iter().enumerate() {
                self.put16(list + i * 4, *bone);
                self.0[list + i * 4 + 2] = *unknown;
                self.0[list + i * 4 + 3] = *track;
            }
        }

        /// Блоки анимации: каждый задан готовыми данными.
        fn blocks(&mut self, anim: usize, datas: &[Vec<u8>]) {
            let list = ANIMS + 0x100;
            self.put16(anim + 0x48, datas.len() as u16);
            self.put64(anim + 0x40, ptr(list));
            for (i, data) in datas.iter().enumerate() {
                let block = BLOCKS + i * 0x400;
                self.put64(list + i * 8, ptr(block));
                self.block(block, data, 0, 2, 2, 1);
            }
        }

        fn block(
            &mut self,
            at: usize,
            data: &[u8],
            frames_at: u32,
            frames: u16,
            frame_len: u16,
            chunk: u8,
        ) {
            self.put32(at + 4, data.len() as u32);
            self.put32(at + 0x0C, frames_at);
            self.put16(at + 0x16, frames);
            self.put16(at + 0x18, frame_len);
            self.0[at + 0x1E] = chunk;
            self.put(at + 0x20, data);
        }

        fn file(&self) -> Vec<u8> {
            let header = Header {
                system_flags: (2 << 28) | (2 << 17),
                graphics_flags: 0xE << 28,
                system_size: SYSTEM,
                graphics_size: 0,
                version: 46,
                declared_version: 46,
            };
            Resource::from_parts(header, self.0.clone())
                .to_file_bytes()
                .unwrap()
        }

        fn summary(&self) -> Result<Vec<AnimationSummary>> {
            summarize(&self.file())
        }
    }

    fn message(result: Result<Vec<AnimationSummary>>) -> String {
        let error = result.unwrap_err();
        assert_eq!(error.kind, crate::error::Kind::Broken);
        error.message
    }

    /// Данные блока: 4 байта кадров, счётчики и теги по типам с добивкой.
    fn channel_data(per_kind: [&[u16]; 9]) -> Vec<u8> {
        let mut data = vec![0u8; 4];
        for tags in per_kind {
            data.extend((tags.len() as u16).to_le_bytes());
        }
        for tags in per_kind {
            for tag in tags {
                data.extend(tag.to_le_bytes());
            }
            data.resize(data.len() + (4 - tags.len() % 4) % 4 * 2, 0);
        }
        data
    }

    const NONE: &[u16] = &[];

    fn tag(group: u16, slot: u16) -> u16 {
        group << 2 | slot
    }

    fn only(kind: usize, tags: &[u16]) -> Vec<u8> {
        let mut per_kind = [NONE; 9];
        per_kind[kind] = tags;
        channel_data(per_kind)
    }

    fn sequences_of(data: Vec<u8>) -> Vec<Vec<Option<&'static str>>> {
        let mut image = Image::new();
        let anim = image.single();
        image.blocks(anim, &[data]);
        image.summary().unwrap().remove(0).sequences
    }

    #[test]
    fn header_errors_pass_through() {
        assert_eq!(message(summarize(&[])), "Ресурс короче заголовка RSC7.");
        assert_eq!(
            message(summarize(&[0; 16])),
            "Файл не является ресурсом RSC7."
        );
        assert_eq!(
            message(summarize("это совсем не словарь клипов".as_bytes())),
            "Файл не является ресурсом RSC7."
        );
        let mut header = Vec::from(RSC7_MAGIC.to_le_bytes());
        header.extend([46, 0, 0, 0, 0, 0, 0x20, 0x20, 0, 0, 0, 0xe0]);
        assert_eq!(
            message(summarize(&header)),
            "Поток ресурса пуст или не распакован."
        );
    }

    #[test]
    fn empty_maps_give_nothing() {
        assert!(Image(vec![0; SYSTEM]).summary().unwrap().is_empty());
        let mut image = Image::new();
        image.put64(MAP + 0x18, 0);
        image.entry(ENTRIES, 5, ANIMS, 0);
        assert!(image.summary().unwrap().is_empty());

        let mut image = Image::new();
        image.single();
        image.put16(MAP + 0x20, 0);
        assert!(image.summary().unwrap().is_empty());

        let mut image = Image::new();
        image.put64(0x18, ptr(SYSTEM + 8));
        assert!(image.summary().unwrap().is_empty());

        let mut image = Image::new();
        image.entry(ENTRIES, 5, 0, 0);
        image.bucket(0, ENTRIES);
        assert!(image.summary().unwrap().is_empty());

        let file = Image::new().file();
        assert!(summarize(&file[..file.len() - 4]).unwrap().is_empty());
    }

    #[test]
    fn plain_animation_fields() {
        let mut image = Image::new();
        image.entry(ENTRIES, 5, ANIMS, 0);
        image.bucket(0, ENTRIES);
        image.anim(ANIMS, 40, 41, 1.333_333_4, 0xdead_beef);
        let got = image.summary().unwrap();
        assert_eq!(
            got,
            vec![AnimationSummary {
                hash: 5,
                frames: 40,
                sequence_frame_limit: 41,
                duration: 1.333_333_4,
                signature: 0xdead_beef,
                bones: vec![],
                sequences: vec![],
            }]
        );
    }

    #[test]
    fn capacity_beyond_real_buckets_is_harmless() {
        let mut image = Image::new();
        image.single();
        image.put16(MAP + 0x20, 65535);
        let got = image.summary().unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].hash, 5);
    }

    #[test]
    fn results_sorted_by_hash_and_later_duplicate_wins() {
        let mut image = Image::new();
        for (bucket, hash, frames) in [(0, 0x9000_0000u32, 1u16), (1, 0x10, 2), (2, 0x7000_0000, 3)]
        {
            let entry = ENTRIES + bucket * 0x20;
            let anim = ANIMS + bucket * 0x100;
            image.entry(entry, hash, anim, 0);
            image.bucket(bucket, entry);
            image.anim(anim, frames, 2, 0.5, 0);
        }
        let hashes: Vec<u32> = image.summary().unwrap().iter().map(|a| a.hash).collect();
        assert_eq!(hashes, [0x10, 0x7000_0000, 0x9000_0000]);

        // Один хеш в двух корзинах: побеждает пройденная позже.
        let mut image = Image::new();
        for (bucket, frames) in [(0, 5u16), (1, 7)] {
            let entry = ENTRIES + bucket * 0x20;
            let anim = ANIMS + bucket * 0x100;
            image.entry(entry, 0x4d, anim, 0);
            image.bucket(bucket, entry);
            image.anim(anim, frames, 8, 0.0, 0);
        }
        let got = image.summary().unwrap();
        assert_eq!((got.len(), got[0].frames), (1, 7));

        // То же внутри одной цепочки.
        let mut image = Image::new();
        image.entry(ENTRIES, 0x4d, ANIMS, ENTRIES + 0x20);
        image.entry(ENTRIES + 0x20, 0x4d, ANIMS + 0x100, 0);
        image.bucket(0, ENTRIES);
        image.anim(ANIMS, 5, 8, 0.0, 0);
        image.anim(ANIMS + 0x100, 7, 8, 0.0, 0);
        let got = image.summary().unwrap();
        assert_eq!((got.len(), got[0].frames), (1, 7));
    }

    #[test]
    fn chain_length_ceiling() {
        let build = |length: usize| {
            let mut image = Image(vec![0; 0x20 * 4200 + 0x400]);
            image.put64(0x18, ptr(MAP));
            image.put64(MAP + 0x18, ptr(BUCKETS));
            image.put16(MAP + 0x20, 16);
            let first = 0x400;
            image.bucket(0, first);
            for n in 0..length {
                let next = if n + 1 < length {
                    first + (n + 1) * 0x20
                } else {
                    0
                };
                image.entry(first + n * 0x20, n as u32, 0, next);
            }
            let size = image.0.len();
            let header = Header {
                system_flags: (2 << 28) | (17 << 17),
                graphics_flags: 0xE << 28,
                system_size: size,
                graphics_size: 0,
                version: 46,
                declared_version: 46,
            };
            Resource::from_parts(header, image.0)
                .to_file_bytes()
                .unwrap()
        };
        assert!(summarize(&build(4096)).unwrap().is_empty());
        assert_eq!(
            message(summarize(&build(4097))),
            "Цепочка карты анимаций слишком длинная."
        );

        let mut image = Image::new();
        image.entry(ENTRIES, 1, 0, ENTRIES);
        image.bucket(0, ENTRIES);
        assert_eq!(
            message(image.summary()),
            "Цепочка карты анимаций слишком длинная."
        );
    }

    #[test]
    fn bones_are_read_in_file_order() {
        let mut image = Image::new();
        let anim = image.single();
        image.bones(anim, 0x1800, &[(10, 3, 0), (20, 1, 1), (65535, 255, 255)]);
        let bones = image.summary().unwrap().remove(0).bones;
        let as_tuples: Vec<_> = bones.iter().map(|b| (b.bone, b.unknown, b.track)).collect();
        assert_eq!(as_tuples, [(10, 3, 0), (20, 1, 1), (65535, 255, 255)]);

        let mut image = Image::new();
        let anim = image.single();
        image.put16(anim + 0x58, 3);
        assert_eq!(message(image.summary()), "Анимация без списка костей.");

        let mut image = Image::new();
        let anim = image.single();
        image.bones(anim, 0x1800, &[(1, 0, 0); 3]);
        image.put16(anim + 0x58, 60000);
        assert_eq!(message(image.summary()), "Чтение за концом данных ресурса.");

        let mut image = Image::new();
        let anim = image.single();
        image.bones(anim, SYSTEM - 2, &[]);
        image.put16(anim + 0x58, 1);
        assert_eq!(message(image.summary()), "Чтение за концом данных ресурса.");

        let mut image = Image::new();
        image.entry(ENTRIES, 5, SYSTEM - 8, 0);
        image.bucket(0, ENTRIES);
        assert_eq!(message(image.summary()), "Чтение за концом данных ресурса.");
    }

    #[test]
    fn block_list_errors() {
        let mut image = Image::new();
        let anim = image.single();
        image.put16(anim + 0x48, 1);
        assert_eq!(
            message(image.summary()),
            "Анимация без последовательностей."
        );

        // Список есть, блок указывает на нули.
        let mut image = Image::new();
        let anim = image.single();
        image.put16(anim + 0x48, 1);
        image.put64(anim + 0x40, ptr(ANIMS + 0x100));
        image.put64(ANIMS + 0x100, ptr(BLOCKS));
        assert_eq!(
            message(image.summary()),
            "Последовательность клипа без кадров."
        );

        let mut image = Image::new();
        let anim = image.single();
        image.put16(anim + 0x48, 1);
        image.put64(anim + 0x40, ptr(ANIMS + 0x100));
        assert_eq!(message(image.summary()), "Последовательность без блока.");

        for (frames, chunk) in [(0u16, 1u8), (2, 0)] {
            let mut image = Image::new();
            let anim = image.single();
            image.blocks(anim, &[only(0, &[0])]);
            image.block(BLOCKS, &[0; 40], 0, frames, 2, chunk);
            assert_eq!(
                message(image.summary()),
                "Последовательность клипа без кадров."
            );
        }

        let mut image = Image::new();
        let anim = image.single();
        image.blocks(anim, &[only(0, &[0])]);
        image.put32(BLOCKS + 4, 0x10_0000);
        assert_eq!(message(image.summary()), "Чтение за концом данных ресурса.");
    }

    #[test]
    fn single_channel_and_layouts() {
        let q = Some("StaticQuaternion");
        assert_eq!(sequences_of(only(0, &[tag(0, 0)])), vec![vec![q]]);
        assert!(sequences_of(only(0, &[])).is_empty());

        let mut per_kind = [NONE; 9];
        let t0 = [tag(0, 0)];
        let t1 = [tag(0, 1), tag(1, 0)];
        let t2 = [tag(0, 2), tag(1, 1), tag(1, 2), tag(2, 0), tag(2, 1)];
        let t3 = [tag(0, 3)];
        let t7 = [tag(3, 1)];
        let t8 = [tag(3, 2)];
        per_kind[0] = &t0;
        per_kind[1] = &t1;
        per_kind[2] = &t2;
        per_kind[3] = &t3;
        per_kind[7] = &t7;
        per_kind[8] = &t8;
        let (sq, sv, sf, raw) = (
            Some("StaticQuaternion"),
            Some("StaticVector3"),
            Some("StaticFloat"),
            Some("RawFloat"),
        );
        assert_eq!(
            sequences_of(channel_data(per_kind)),
            vec![
                vec![sq, sv, sf, raw],
                vec![sv, sf, sf],
                vec![sf, sf],
                vec![
                    None,
                    None,
                    None,
                    Some("CachedQuaternion1"),
                    Some("CachedQuaternion2")
                ],
            ]
        );
    }

    #[test]
    fn sparse_groups_slots_and_collisions() {
        assert_eq!(
            sequences_of(only(8, &[tag(2, 0)])),
            vec![
                vec![],
                vec![],
                vec![None, None, None, None, Some("CachedQuaternion2")]
            ]
        );

        let mut per_kind = [NONE; 9];
        let (a, b, c) = ([tag(0, 0)], [tag(0, 0)], [tag(0, 0)]);
        per_kind[0] = &a;
        per_kind[1] = &b;
        per_kind[3] = &c;
        assert_eq!(
            sequences_of(channel_data(per_kind)),
            vec![vec![Some("StaticQuaternion")]]
        );

        let mut per_kind = [NONE; 9];
        let (raw, cached) = ([tag(0, 3)], [tag(0, 0)]);
        per_kind[3] = &raw;
        per_kind[7] = &cached;
        assert_eq!(
            sequences_of(channel_data(per_kind)),
            vec![vec![None, None, None, Some("RawFloat")]]
        );

        let mut per_kind = [NONE; 9];
        let (c1, c2) = ([tag(0, 0)], [tag(0, 3)]);
        per_kind[7] = &c1;
        per_kind[8] = &c2;
        assert_eq!(
            sequences_of(channel_data(per_kind)),
            vec![vec![
                None,
                None,
                None,
                Some("CachedQuaternion1"),
                Some("CachedQuaternion2")
            ]]
        );

        let huge = sequences_of(only(6, &[0xFFFF]));
        assert_eq!(huge.len(), 16384);
        assert!(huge[0].is_empty());
        assert_eq!(huge[16383], vec![None, None, None, Some("LinearFloat")]);
    }

    #[test]
    fn groups_of_blocks_are_appended() {
        let mut image = Image::new();
        let anim = image.single();
        image.blocks(
            anim,
            &[only(0, &[tag(0, 0), tag(1, 0)]), only(1, &[tag(0, 0)])],
        );
        assert_eq!(
            image.summary().unwrap().remove(0).sequences,
            vec![
                vec![Some("StaticQuaternion")],
                vec![Some("StaticQuaternion")],
                vec![Some("StaticVector3")],
            ]
        );
    }

    #[test]
    fn truncated_channel_lists() {
        let truncated_message = "Список каналов обрезан.";
        let run = |data: Vec<u8>, frames_at: u32, frames: u16, frame_len: u16| {
            let mut image = Image::new();
            let anim = image.single();
            image.blocks(anim, std::slice::from_ref(&data));
            image.block(BLOCKS, &data, frames_at, frames, frame_len, 1);
            message(image.summary())
        };
        assert_eq!(run(vec![0; 14], 0, 2, 2), truncated_message);
        // Заявлено три тега, дан один.
        let mut data = vec![0u8; 4];
        data.extend(3u16.to_le_bytes());
        data.extend([0; 16]);
        data.extend([0, 0]);
        assert_eq!(run(data, 0, 2, 2), truncated_message);
        assert_eq!(run(only(0, &[0]), 0xFFFF_FFF0, 2, 2), truncated_message);
        assert_eq!(run(only(0, &[0]), 0, 65535, 65535), truncated_message);
        assert_eq!(run(Vec::new(), 0, 2, 2), truncated_message);
    }

    #[test]
    fn extreme_header_values_pass() {
        let mut image = Image::new();
        image.entry(ENTRIES, 5, ANIMS, 0);
        image.bucket(0, ENTRIES);
        image.anim(ANIMS, 65535, 65535, f32::NAN, 0xFFFF_FFFF);
        let got = image.summary().unwrap().remove(0);
        assert_eq!(
            (got.frames, got.sequence_frame_limit, got.signature),
            (65535, 65535, u32::MAX)
        );
        assert!(got.duration.is_nan());
    }
}
