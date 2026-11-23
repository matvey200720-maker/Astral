//! Листы «стекла» фонаря: текстуры, которые светящийся шейдер берёт основным цветом.
//!
//! Модуль только описывает лист (положение данных и размеры) по словарю текстур
//! рисовалки; пиксели читает и собирает из них DDS слой команд.

use std::collections::{HashMap, HashSet};

use crate::{
    error::Result,
    hash::joaat,
    resource::Resource,
    texture::{read_dictionary_at, TextureRef},
};

/// Лист стекла и признак «его берёт ещё кто-то помимо светящегося диффузного слота».
#[derive(Debug, Clone)]
pub struct GlassTexture {
    pub texture: TextureRef,
    pub shared: bool,
}

/// Где что лежит в теле ресурса (смещения внутри записи).
mod pos {
    /// Рисовалка → указатель на группу шейдеров.
    pub const DRAWABLE_SHADERS: usize = 0x10;
    /// Группа: словарь текстур, список шейдеров, их число (u16).
    pub const GROUP_TEXTURES: usize = 0x08;
    pub const GROUP_SHADER_LIST: usize = 0x10;
    pub const GROUP_SHADER_COUNT: usize = 0x18;
    /// Шейдер: указатель на параметры и число слотов (u8).
    pub const SHADER_PARAMS: usize = 0x00;
    pub const SHADER_SLOT_COUNT: usize = 0x10;
    /// Слот параметров — 16 байт; у текстурного по +8 указатель на объект текстуры.
    pub const SLOT_SIZE: usize = 16;
    pub const SLOT_OBJECT: usize = 8;
    pub const OBJECT_NAME: usize = 0x28;
}

/// Слот шейдера: хеш метки и, для текстурного слота, имя листа.
struct Slot {
    hash: u32,
    sheet: Option<String>,
}

/// Имя листа в текстурном слоте, если у слота есть объект и у объекта имя.
fn sheet_name(res: &Resource, slot_at: usize) -> Result<Option<String>> {
    res.pointer_at(slot_at + pos::SLOT_OBJECT)
        .map(|object| res.u64(object + pos::OBJECT_NAME).map(|name| res.cstring(name)))
        .transpose()
        .map(Option::flatten)
}

/// Слоты шейдера по порядку; `None`, если у шейдера нет блока параметров.
fn read_slots(res: &Resource, shader: usize) -> Result<Option<Vec<Slot>>> {
    res.pointer_at(shader + pos::SHADER_PARAMS)
        .map(|params| -> Result<Vec<Slot>> {
            let count = usize::from(res.u8(shader + pos::SHADER_SLOT_COUNT)?);
            let kinds = (0..count)
                .map(|n| res.u8(params + n * pos::SLOT_SIZE))
                .collect::<Result<Vec<u8>>>()?;
            // За записями слотов идут данные векторов (k блоков по 16 байт), потом хеши слотов.
            let vector_bytes: usize = kinds.iter().map(|&k| pos::SLOT_SIZE * usize::from(k)).sum();
            let hashes_at = params + count * pos::SLOT_SIZE + vector_bytes;
            kinds
                .iter()
                .enumerate()
                .map(|(n, &kind)| {
                    let hash = res.u32(hashes_at + n * 4)?;
                    let sheet = match kind {
                        0 => sheet_name(res, params + n * pos::SLOT_SIZE)?,
                        _ => None,
                    };
                    Ok(Slot { hash, sheet })
                })
                .collect()
        })
        .transpose()
}

/// Кто как использует листы: стекло по порядку появления и все прочие слоты.
#[derive(Default)]
struct Usage {
    glass: Vec<String>,
    other: HashSet<String>,
}

impl Usage {
    fn record(&mut self, slots: Vec<Slot>, glow_hash: u32, diffuse_hash: u32) {
        let glowing = slots.iter().any(|s| s.hash == glow_hash);
        let sheets = slots.into_iter().filter_map(|s| s.sheet.map(|name| (s.hash, name)));
        for (hash, name) in sheets {
            if glowing && hash == diffuse_hash {
                if !self.glass.contains(&name) {
                    self.glass.push(name);
                }
            } else {
                self.other.insert(name);
            }
        }
    }

    /// Листы стекла из словаря: первая запись с таким именем, и только полная.
    fn resolve(&self, dictionary: &[TextureRef]) -> Vec<GlassTexture> {
        let mut by_name: HashMap<&str, &TextureRef> = HashMap::new();
        dictionary.iter().for_each(|t| {
            by_name.entry(t.name.as_str()).or_insert(t);
        });
        self.glass
            .iter()
            .filter_map(|name| {
                by_name
                    .get(name.as_str())
                    .copied()
                    .filter(|t| t.complete)
                    .map(|t| GlassTexture { texture: t.clone(), shared: self.other.contains(name) })
            })
            .collect()
    }
}

/// Группа шейдеров рисовалки.
struct ShaderGroup<'r> {
    res: &'r Resource,
    at: usize,
}

impl<'r> ShaderGroup<'r> {
    fn of_drawable(res: &'r Resource, drawable_at: usize) -> Option<Self> {
        res.pointer_at(drawable_at + pos::DRAWABLE_SHADERS).map(|at| Self { res, at })
    }

    fn textures(&self) -> Result<Vec<TextureRef>> {
        read_dictionary_at(self.res, self.res.pointer_at(self.at + pos::GROUP_TEXTURES))
    }

    /// Адреса записей шейдеров: пустые указатели и места за концом тела пропущены.
    fn shader_addresses(&self) -> Result<Option<impl Iterator<Item = usize> + 'r>> {
        let res = self.res;
        res.pointer_at(self.at + pos::GROUP_SHADER_LIST)
            .map(|list| -> Result<_> {
                let count = usize::from(res.u16(self.at + pos::GROUP_SHADER_COUNT)?);
                Ok((0..count).filter_map(move |n| res.pointer_at(list + n * 8)))
            })
            .transpose()
    }

    fn usage(&self) -> Result<Option<Usage>> {
        let (glow, diffuse) = (joaat("emissiveMultiplier"), joaat("DiffuseSampler"));
        self.shader_addresses()?
            .map(|mut shaders| {
                shaders.try_fold(Usage::default(), |mut usage, shader| {
                    if let Some(slots) = read_slots(self.res, shader)? {
                        usage.record(slots, glow, diffuse);
                    }
                    Ok(usage)
                })
            })
            .transpose()
    }
}

/// Листы стекла рисовалки, лежащей по адресу `drawable_at` в теле ресурса.
pub fn glass_textures(res: &Resource, drawable_at: usize) -> Result<Vec<GlassTexture>> {
    ShaderGroup::of_drawable(res, drawable_at)
        .map(|group| -> Result<Vec<GlassTexture>> {
            // Словарь читается раньше списка шейдеров: его ошибка побеждает.
            let dictionary = group.textures()?;
            Ok(group.usage()?.map_or_else(Vec::new, |usage| usage.resolve(&dictionary)))
        })
        .unwrap_or_else(|| Ok(Vec::new()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::resource::{deflate_zlib9, SYSTEM_BASE};

    const DXT1: u32 = 0x3154_5844;

    fn rsc7(body: &[u8]) -> Vec<u8> {
        let shift = (0..16u32).find(|s| (0x200usize << s) >= body.len()).unwrap();
        let mut out = Vec::new();
        for word in [0x3743_5352u32, 165, 0x0800_0000 | (165u32 << 28 & 0xf000_0000) | shift, 0x2000_0000] {
            out.extend_from_slice(&word.to_le_bytes());
        }
        out.extend(deflate_zlib9(body));
        out
    }

    /// Крошечный сборщик рисовалки: корень 0x40 байт, затем группа, словарь, листы и шейдеры.
    struct Rig {
        body: Vec<u8>,
    }

    impl Rig {
        fn grow(&mut self, size: usize) -> usize {
            while self.body.len() % 16 != 0 {
                self.body.push(0);
            }
            let at = self.body.len();
            self.body.resize(at + size, 0);
            at
        }

        fn point(&mut self, at: usize, target: usize) {
            self.body[at..at + 8].copy_from_slice(&(SYSTEM_BASE + target as u64).to_le_bytes());
        }

        /// `shaders`: для каждого шейдера слоты `(метка, Some(лист))` — текстурные, `(метка, None)` — вектор.
        fn build(sheets: &[&str], shaders: &[Vec<(&str, Option<usize>)>], dict_count: Option<u16>) -> Vec<u8> {
            let mut rig = Rig { body: vec![0; 0x40] };
            let group = rig.grow(0x20);
            rig.point(0x10, group);
            let dictionary = rig.grow(0x40);
            rig.point(group + 8, dictionary);
            let entries = rig.grow(sheets.len().max(1) * 8);
            rig.point(dictionary + 0x30, entries);
            let n = dict_count.unwrap_or(sheets.len() as u16);
            rig.body[dictionary + 0x38..dictionary + 0x3a].copy_from_slice(&n.to_le_bytes());
            let mut objects = Vec::new();
            for (i, name) in sheets.iter().enumerate() {
                let object = rig.grow(0x80);
                let text = rig.grow(name.len() + 1);
                rig.body[text..text + name.len()].copy_from_slice(name.as_bytes());
                rig.point(object + 0x28, text);
                rig.body[object + 0x50..object + 0x52].copy_from_slice(&16u16.to_le_bytes());
                rig.body[object + 0x52..object + 0x54].copy_from_slice(&16u16.to_le_bytes());
                rig.body[object + 0x54..object + 0x56].copy_from_slice(&1u16.to_le_bytes());
                rig.body[object + 0x58..object + 0x5c].copy_from_slice(&DXT1.to_le_bytes());
                rig.body[object + 0x5d] = 1;
                let data = rig.grow(128);
                rig.point(object + 0x70, data);
                rig.point(entries + i * 8, object);
                objects.push(object);
            }
            let list = rig.grow(shaders.len().max(1) * 8);
            rig.point(group + 0x10, list);
            rig.body[group + 0x18..group + 0x1a].copy_from_slice(&(shaders.len() as u16).to_le_bytes());
            for (index, slots) in shaders.iter().enumerate() {
                let record = rig.grow(0x20);
                rig.point(list + index * 8, record);
                let vectors = slots.iter().filter(|s| s.1.is_none()).count();
                let params = rig.grow(slots.len() * 16 + vectors * 16 + slots.len() * 4);
                rig.point(record, params);
                rig.body[record + 0x10] = slots.len() as u8;
                let table = params + slots.len() * 16 + vectors * 16;
                for (k, (label, sheet)) in slots.iter().enumerate() {
                    match sheet {
                        Some(i) => rig.point(params + k * 16 + 8, objects[*i]),
                        None => rig.body[params + k * 16] = 1,
                    }
                    rig.body[table + k * 4..table + k * 4 + 4].copy_from_slice(&joaat(label).to_le_bytes());
                }
            }
            rig.body
        }
    }

    fn glass(sheet: usize) -> Vec<(&'static str, Option<usize>)> {
        vec![("DiffuseSampler", Some(sheet)), ("emissiveMultiplier", None)]
    }

    fn plain(sheet: usize) -> Vec<(&'static str, Option<usize>)> {
        vec![("DiffuseSampler", Some(sheet))]
    }

    fn run(sheets: &[&str], shaders: &[Vec<(&str, Option<usize>)>]) -> Vec<(String, bool)> {
        let body = Rig::build(sheets, shaders, None);
        let res = Resource::parse(&rsc7(&body)).unwrap();
        glass_textures(&res, 0)
            .unwrap()
            .into_iter()
            .map(|g| (g.texture.name, g.shared))
            .collect()
    }

    #[test]
    fn single_glass_sheet_is_not_shared() {
        assert_eq!(run(&["lamp"], &[glass(0)]), vec![("lamp".to_string(), false)]);
    }

    #[test]
    fn plain_shader_alone_gives_nothing() {
        assert!(run(&["lamp"], &[plain(0)]).is_empty());
    }

    #[test]
    fn plain_shader_using_the_sheet_makes_it_shared() {
        assert_eq!(run(&["lamp"], &[glass(0), plain(0)]), vec![("lamp".to_string(), true)]);
        assert_eq!(
            run(&["lamp"], &[glass(0), vec![("BumpSampler", Some(0))]]),
            vec![("lamp".to_string(), true)]
        );
    }

    #[test]
    fn two_glow_shaders_on_one_sheet_stay_unshared() {
        assert_eq!(run(&["lamp"], &[glass(0), glass(0)]), vec![("lamp".to_string(), false)]);
    }

    #[test]
    fn order_follows_shaders_not_dictionary() {
        let got = run(&["A", "B", "C"], &[glass(2), glass(0), glass(1)]);
        let names: Vec<_> = got.iter().map(|g| g.0.as_str()).collect();
        assert_eq!(names, ["C", "A", "B"]);
    }

    #[test]
    fn glow_hash_on_a_texture_slot_still_counts() {
        let shader = vec![("emissiveMultiplier", Some(1)), ("DiffuseSampler", Some(0))];
        assert_eq!(run(&["A", "B"], &[shader]), vec![("A".to_string(), false)]);
    }

    #[test]
    fn dictionary_error_wins_over_missing_shader_list() {
        let mut body = Rig::build(&["A"], &[glass(0)], Some(4097));
        let group = 0x40;
        body[group + 0x10..group + 0x18].fill(0);
        let res = Resource::parse(&rsc7(&body)).unwrap();
        let err = glass_textures(&res, 0).unwrap_err();
        assert_eq!(err.message, "Словарь текстур заявляет слишком много записей.");
    }

    #[test]
    fn missing_group_is_empty() {
        let res = Resource::parse(&rsc7(&[0u8; 0x40])).unwrap();
        assert!(glass_textures(&res, 0).unwrap().is_empty());
    }

    #[test]
    fn truncated_hash_table_is_an_error() {
        let mut body = Rig::build(&["A"], &[glass(0)], None);
        body.truncate(body.len() - 2);
        let res = Resource::parse(&rsc7(&body)).unwrap();
        let err = glass_textures(&res, 0).unwrap_err();
        assert_eq!(err.message, "Чтение за концом данных ресурса.");
    }

    #[test]
    fn far_offsets_are_empty() {
        let body = Rig::build(&["A"], &[glass(0)], None);
        let res = Resource::parse(&rsc7(&body)).unwrap();
        assert!(glass_textures(&res, 1 << 40).unwrap().is_empty());
        assert!(glass_textures(&res, res.len()).unwrap().is_empty());
    }
}
