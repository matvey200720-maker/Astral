//! Блоки модели gen9 (GTA V Enhanced, ресурс 159), которые строятся из данных легаси-модели (165).
//!
//! Каждая функция собирает байты одного блока по явным аргументам: указатели и размеры приходят снаружи
//! и пишутся как есть. Раскладка снята с выхода хоста (CodeWalker); целого файла модели здесь нет.

use crate::vertex;

// ---------------------------------------------------------------------------------------------
// Сборка байт
// ---------------------------------------------------------------------------------------------

/// Блок фиксированной длины: поля пишутся по смещениям, остальное нули.
struct Block<const N: usize>([u8; N]);

impl<const N: usize> Block<N> {
    fn new() -> Self {
        Block([0; N])
    }

    fn put(mut self, at: usize, bytes: &[u8]) -> Self {
        self.0[at..at + bytes.len()].copy_from_slice(bytes);
        self
    }

    fn u8(self, at: usize, value: u8) -> Self {
        self.put(at, &[value])
    }

    fn u16(self, at: usize, value: u16) -> Self {
        self.put(at, &value.to_le_bytes())
    }

    fn u32(self, at: usize, value: u32) -> Self {
        self.put(at, &value.to_le_bytes())
    }

    fn u64(self, at: usize, value: u64) -> Self {
        self.put(at, &value.to_le_bytes())
    }

    fn done(self) -> [u8; N] {
        self.0
    }
}

/// Блок переменной длины: числа и куски байт подряд.
#[derive(Default)]
struct Stream(Vec<u8>);

impl Stream {
    fn u8(&mut self, value: u8) -> &mut Self {
        self.0.push(value);
        self
    }

    fn u32(&mut self, value: u32) -> &mut Self {
        self.bytes(&value.to_le_bytes())
    }

    fn u64(&mut self, value: u64) -> &mut Self {
        self.bytes(&value.to_le_bytes())
    }

    fn bytes(&mut self, bytes: &[u8]) -> &mut Self {
        self.0.extend_from_slice(bytes);
        self
    }

    fn zeros(&mut self, count: usize) -> &mut Self {
        self.0.resize(self.0.len() + count, 0);
        self
    }

    fn done(self) -> Vec<u8> {
        self.0
    }
}

// ---------------------------------------------------------------------------------------------
// Буферы
// ---------------------------------------------------------------------------------------------

pub const INDEX_BUFFER_VFT: u32 = 0x4061_D158;
pub const INDEX_BUFFER_GEN9_BYTES: usize = 64;
pub const INDEX_BUFFER_BIND_FLAGS: u32 = 0x0058_020A;

/// Индексный буфер: шестнадцатибитные индексы.
pub fn index_buffer_block(
    indices_count: u32,
    indices_pointer: u64,
    srv_pointer: u64,
) -> [u8; INDEX_BUFFER_GEN9_BYTES] {
    Block::new()
        .u32(0, INDEX_BUFFER_VFT)
        .u32(4, 1)
        .u32(8, indices_count)
        .u16(12, 2)
        .u32(16, INDEX_BUFFER_BIND_FLAGS)
        .u64(24, indices_pointer)
        .u64(48, srv_pointer)
        .done()
}

pub const SRV_VFT: u64 = 0x1_406b_77d8;
pub const SRV_BYTES: usize = 32;
pub const SRV_DIMENSION_BUFFER: u16 = 0x14;

/// Блок SRV одинаков у индексного и вершинного буфера.
pub fn buffer_srv_block() -> [u8; SRV_BYTES] {
    Block::new()
        .u64(0, SRV_VFT)
        .u16(16, SRV_DIMENSION_BUFFER)
        .u16(18, 0xFFFF)
        .u32(20, 0xFFFF_FFFF)
        .done()
}

pub const VERTEX_BUFFER_VFT: u32 = 0x4061_D3F8;
pub const VERTEX_BUFFER_GEN9_BYTES: usize = 64;
pub const VERTEX_BUFFER_BIND_FLAGS: u32 = 0x0058_0409;

pub fn vertex_buffer_block(
    vertex_count: u32,
    stride: u32,
    data_pointer: u64,
    srv_pointer: u64,
    declaration_pointer: u64,
) -> [u8; VERTEX_BUFFER_GEN9_BYTES] {
    Block::new()
        .u32(0, VERTEX_BUFFER_VFT)
        .u32(4, 1)
        .u32(8, vertex_count)
        .u32(12, stride)
        .u32(16, VERTEX_BUFFER_BIND_FLAGS)
        .u64(24, data_pointer)
        .u64(48, srv_pointer)
        .u64(56, declaration_pointer)
        .done()
}

// ---------------------------------------------------------------------------------------------
// Шейдер и описания параметров
// ---------------------------------------------------------------------------------------------

pub const SHADER_FX_GEN9_BYTES: usize = 64;

/// Маска корзины рендера: её бит плюс общие `0xFF00`. У корзины от 32 своего бита нет.
pub fn render_bucket_mask(render_bucket: u8) -> u32 {
    1u32.checked_shl(u32::from(render_bucket)).unwrap_or(0) | 0xFF00
}

#[allow(clippy::too_many_arguments)]
pub fn shader_fx_block(
    name: u32,
    preset: u32,
    parameters_pointer: u64,
    texture_refs_pointer: u64,
    unknown_params_pointer: u64,
    param_infos_pointer: u64,
    render_bucket: u8,
    parameter_data_size: u16,
) -> [u8; SHADER_FX_GEN9_BYTES] {
    // Четыре указателя идут подряд с восьмого байта.
    let pointers = [parameters_pointer, texture_refs_pointer, unknown_params_pointer, param_infos_pointer];
    let head = Block::<SHADER_FX_GEN9_BYTES>::new().u32(0, name).u32(4, preset);
    let with_pointers = pointers
        .iter()
        .enumerate()
        .fold(head, |block, (n, &pointer)| block.u64(8 + 8 * n, pointer));
    with_pointers
        .u8(57, render_bucket)
        .u16(58, parameter_data_size)
        .u32(60, render_bucket_mask(render_bucket))
        .done()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ParamInfoG9 {
    pub name: u32,
    pub data: u32,
}

/// Вид параметра в младших двух битах слова описания.
const KIND_TEXTURE: u32 = 0;
const KIND_SAMPLER: u32 = 2;
const KIND_CBUFFER: u32 = 3;

/// Описание текстуры или сэмплера: вид и номер, сдвинутый на два бита.
fn indexed_info(name: u32, kind: u32, index: u8) -> ParamInfoG9 {
    ParamInfoG9 { name, data: kind | (u32::from(index) << 2) }
}

pub fn texture_info(name: u32, index: u8) -> ParamInfoG9 {
    indexed_info(name, KIND_TEXTURE, index)
}

pub fn sampler_info(name: u32, index: u8) -> ParamInfoG9 {
    indexed_info(name, KIND_SAMPLER, index)
}

/// Поля слова константного буфера после вида: (маска, сдвиг) для буфера, смещения и длины.
/// Лишние биты значений молча обрезаются.
const CBUFFER_FIELDS: [(u32, u32); 3] = [(0x3F, 2), (0xFFF, 8), (0xFFF, 20)];

pub fn cbuffer_info(name: u32, buffer: u8, offset: u16, length: u16) -> ParamInfoG9 {
    let values = [u32::from(buffer), u32::from(offset), u32::from(length)];
    let data = values
        .into_iter()
        .zip(CBUFFER_FIELDS)
        .fold(KIND_CBUFFER, |word, (value, (mask, shift))| word | ((value & mask) << shift));
    ParamInfoG9 { name, data }
}

pub const PARAM_INFOS_UNKNOWN1: u8 = 1;
pub const PARAM_INFOS_UNKNOWN2: u8 = 0xC;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParamInfosG9 {
    pub buffers: u8,
    pub textures: u8,
    pub unknowns: u8,
    pub samplers: u8,
    pub params: Vec<ParamInfoG9>,
}

/// Заголовок из восьми байт и по восемь байт на параметр; счётчики заголовка не сверяются с составом.
pub fn param_infos_block(infos: &ParamInfosG9) -> Vec<u8> {
    let mut stream = Stream::default();
    stream.bytes(&[infos.buffers, infos.textures, infos.unknowns, infos.samplers]);
    stream
        .u8(infos.params.len() as u8)
        .u8(0)
        .u8(PARAM_INFOS_UNKNOWN1)
        .u8(PARAM_INFOS_UNKNOWN2);
    for param in &infos.params {
        stream.u32(param.name).u32(param.data);
    }
    stream.done()
}

// ---------------------------------------------------------------------------------------------
// Значения параметров и группа шейдеров
// ---------------------------------------------------------------------------------------------

/// Копий блока значений: столько же, сколько в служебном байте описаний.
pub const PARAMETER_COPIES: usize = PARAM_INFOS_UNKNOWN2 as usize;

pub struct ParametersG9 {
    pub base: u64,
    pub buffers: Vec<Vec<u8>>,
    pub textures: Vec<u64>,
    pub unknowns: usize,
    pub samplers: Vec<u8>,
}

/// Блок значений: указатели на буферы, двенадцать копий буферов, адреса текстур (заполнена первая копия),
/// пустые неизвестные записи и сэмплеры. `base` — адрес начала блока.
pub fn parameters_block(params: &ParametersG9) -> Vec<u8> {
    const WORD: usize = 8;
    let pointers_len = params.buffers.len() * PARAMETER_COPIES * WORD;
    let copy_len: usize = params.buffers.iter().map(Vec::len).sum();
    // Где начинается каждый буфер внутри одной копии.
    let starts: Vec<usize> = params
        .buffers
        .iter()
        .scan(0usize, |taken, buffer| {
            let start = *taken;
            *taken += buffer.len();
            Some(start)
        })
        .collect();

    let pointers = (0..PARAMETER_COPIES).flat_map(|copy| {
        starts
            .iter()
            .map(move |&start| params.base + (pointers_len + copy * copy_len + start) as u64)
    });
    let mut stream = Stream::default();
    pointers.for_each(|pointer| {
        stream.u64(pointer);
    });
    (0..PARAMETER_COPIES).for_each(|_| {
        params.buffers.iter().for_each(|buffer| {
            stream.bytes(buffer);
        });
    });
    // Адреса текстур лежат только в первой копии, остальные одиннадцать — нули.
    params.textures.iter().for_each(|&address| {
        stream.u64(address);
    });
    stream.zeros(params.textures.len() * (PARAMETER_COPIES - 1) * WORD);
    stream.zeros(params.unknowns * PARAMETER_COPIES * WORD);
    stream.bytes(&params.samplers);
    stream.done()
}

pub const SHADER_GROUP_VFT: u32 = 0x4061_37F0;
pub const SHADER_GROUP_BYTES: usize = 64;

pub fn shader_group_block(
    texture_dictionary_pointer: u64,
    shaders_pointer: u64,
    shaders_count: u16,
) -> [u8; SHADER_GROUP_BYTES] {
    Block::new()
        .u32(0, SHADER_GROUP_VFT)
        .u32(4, 1)
        .u64(8, texture_dictionary_pointer)
        .u64(16, shaders_pointer)
        .u16(24, shaders_count)
        .u16(26, shaders_count)
        .done()
}

pub fn pointer_array(pointers: &[u64]) -> Vec<u8> {
    let mut stream = Stream::default();
    pointers.iter().for_each(|&pointer| {
        stream.u64(pointer);
    });
    stream.done()
}

// ---------------------------------------------------------------------------------------------
// Декларация вершины и перестановка
// ---------------------------------------------------------------------------------------------

pub const DECLARATION_SLOTS: usize = 52;
pub const DECLARATION_BYTES: usize = 320;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Declaration {
    pub offsets: [u32; DECLARATION_SLOTS],
    pub sizes: [u8; DECLARATION_SLOTS],
    pub types: [u8; DECLARATION_SLOTS],
    pub vertex_size: u8,
}

/// Соответствие «семантика и тип легаси → слот и формат gen9»; только то, что видно в корпусе хоста.
/// Строки идут по возрастанию семантики: в этом порядке `remap_vertices` пишет элементы.
struct Rule {
    semantic: usize,
    legacy_type: u8,
    slot: usize,
    format: u8,
}

static RULES: [Rule; 8] = [
    Rule { semantic: 0, legacy_type: 6, slot: 0, format: 6 },
    Rule { semantic: 1, legacy_type: 9, slot: 16, format: 28 },
    Rule { semantic: 2, legacy_type: 9, slot: 20, format: 30 },
    Rule { semantic: 3, legacy_type: 6, slot: 4, format: 6 },
    Rule { semantic: 4, legacy_type: 9, slot: 24, format: 28 },
    Rule { semantic: 6, legacy_type: 5, slot: 28, format: 16 },
    Rule { semantic: 7, legacy_type: 5, slot: 29, format: 16 },
    Rule { semantic: 14, legacy_type: 7, slot: 8, format: 2 },
];

const SEMANTICS: usize = 16;

/// Элемент раскладки легаси вместе с правилом, по которому он переходит в gen9.
type Translated = (vertex::Element, &'static Rule);

/// Разбирает раскладку легаси и сверяет шаг: `stride_ok` решает, годится ли он. Дальше каждому элементу
/// нужно правило из таблицы; нет хотя бы одного — `None`. Возвращает шаг и пары «элемент, правило»
/// в порядке возрастания семантики.
fn translate(flags: u32, types: u64, stride_ok: impl FnOnce(usize) -> bool) -> Option<(usize, Vec<Translated>)> {
    let layout = vertex::layout(flags, types).ok()?;
    if !stride_ok(layout.stride) {
        return None;
    }
    let present = (0..SEMANTICS).filter(|&semantic| layout.get(semantic).is_some()).count();
    let pairs: Vec<Translated> = RULES
        .iter()
        .filter_map(|rule| {
            let element = layout.get(rule.semantic)?;
            (element.type_code == rule.legacy_type).then_some((element, rule))
        })
        .collect();
    (pairs.len() == present).then_some((layout.stride, pairs))
}

/// Декларация gen9 для раскладки легаси; `None` — шаг не сошёлся или в раскладке есть то, чего нет в корпусе.
pub fn declaration(flags: u32, types: u64, stride: u8) -> Option<Declaration> {
    let (_, pairs) = translate(flags, types, |legacy_stride| legacy_stride == usize::from(stride))?;
    let mut taken = [0usize; DECLARATION_SLOTS];
    let mut format_at: [Option<u8>; DECLARATION_SLOTS] = [None; DECLARATION_SLOTS];
    for (element, rule) in &pairs {
        taken[rule.slot] = element.size;
        format_at[rule.slot] = Some(rule.format);
    }
    Some(Declaration {
        offsets: std::array::from_fn(|slot| taken[..slot].iter().sum::<usize>() as u32),
        sizes: std::array::from_fn(|slot| format_at[slot].map_or(0, |_| stride)),
        types: std::array::from_fn(|slot| format_at[slot].unwrap_or(0)),
        vertex_size: stride,
    })
}

/// 320 байт: смещения, размеры, типы и шаг вершины, умноженный на четыре; поля пишутся как есть.
pub fn declaration_block(decl: &Declaration) -> [u8; DECLARATION_BYTES] {
    let sizes_at = DECLARATION_SLOTS * 4;
    let types_at = sizes_at + DECLARATION_SLOTS;
    let tail_at = types_at + DECLARATION_SLOTS;
    let slots = decl.offsets.iter().zip(decl.sizes).zip(decl.types).enumerate();
    let filled = slots.fold(Block::<DECLARATION_BYTES>::new(), |block, (slot, ((&offset, size), kind))| {
        block.u32(slot * 4, offset).u8(sizes_at + slot, size).u8(types_at + slot, kind)
    });
    filled.u64(tail_at, u64::from(decl.vertex_size) * 4).done()
}

/// Вершины легаси, переложенные по декларации gen9: компонент за компонентом; всё или ничего.
pub fn remap_vertices(
    legacy: &[u8],
    flags: u32,
    types: u64,
    count: usize,
    decl: &Declaration,
) -> Option<Vec<u8>> {
    // Нулевой шаг и нехватка данных отсекаются до разбора правил; произведение может переполниться.
    let (stride, pairs) = translate(flags, types, |stride| stride != 0 && legacy.len() >= stride * count)?;
    let vertex_size = usize::from(decl.vertex_size);
    let mut out = vec![0u8; legacy.len()];
    for (element, rule) in &pairs {
        let target = decl.offsets[rule.slot] as usize;
        let sources = (0..count).map(|vertex| element.offset + stride * vertex);
        let targets = (0..count).map(|vertex| target + vertex_size * vertex);
        sources.zip(targets).try_for_each(|(from, to)| {
            let piece = legacy.get(from..from + element.size)?;
            out.get_mut(to..to + element.size)?.copy_from_slice(piece);
            Some(())
        })?;
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hash::sha256_hex;

    /// Слово типов вершины хоста: по четыре бита на семантику.
    const CORPUS_TYPES: u64 = 0x7755_5555_5599_6996;
    const SYS: u64 = 0x5000_0000;
    /// Семантики, которые видны в корпусе хоста.
    const KNOWN: [usize; 8] = [0, 1, 2, 3, 4, 6, 7, 14];

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    fn word32(bytes: &[u8], at: usize) -> u32 {
        u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap())
    }

    fn word64(bytes: &[u8], at: usize) -> u64 {
        u64::from_le_bytes(bytes[at..at + 8].try_into().unwrap())
    }

    /// Маска семантик по номерам подмножества `KNOWN`.
    fn mask_of(subset: usize) -> u32 {
        KNOWN
            .iter()
            .enumerate()
            .filter(|&(n, _)| subset & (1 << n) != 0)
            .fold(0, |mask, (_, &semantic)| mask | (1u32 << semantic))
    }

    fn honest_stride(mask: u32) -> u8 {
        vertex::layout(mask, CORPUS_TYPES).unwrap().stride as u8
    }

    /// Вершины из байт по формуле, чтобы видеть, куда каждый байт переехал.
    fn marked(len: usize) -> Vec<u8> {
        (0..len).map(|i| (7 * i + 5) as u8).collect()
    }

    /// Блок, который хост выдаёт побайтно, и строка его байт.
    struct HostBlock {
        what: &'static str,
        build: fn() -> Vec<u8>,
        bytes: &'static str,
    }

    #[test]
    fn the_blocks_of_the_reference_cone_equal_the_host_bytes() {
        let blocks = [
            HostBlock {
                what: "index buffer",
                build: || index_buffer_block(54, SYS + 4304, SYS + 4832).to_vec(),
                bytes: "58d161400100000036000000020000000a02580000000000d010005000000000\
                        00000000000000000000000000000000e0120050000000000000000000000000",
            },
            HostBlock {
                what: "buffer srv",
                build: || buffer_srv_block().to_vec(),
                bytes: "d8776b400100000000000000000000001400ffffffffffff0000000000000000",
            },
            HostBlock {
                what: "vertex buffer",
                build: || vertex_buffer_block(37, 32, SYS + 1472, SYS + 4864, SYS + 3696).to_vec(),
                bytes: "f8d361400100000025000000200000000904580000000000c005005000000000\
                        000000000000000000000000000000000013005000000000700e005000000000",
            },
            HostBlock {
                what: "shader",
                build: || {
                    shader_fx_block(0xB8F9_BAF0, 0x6D65_7461, SYS + 208, SYS + 1264, SYS + 1456, SYS + 4496, 1, 1250).to_vec()
                },
                bytes: "f0baf9b86174656dd000005000000000f004005000000000b005005000000000\
                        9011005000000000000000000000000000000000000000000001e20402ff0000",
            },
            HostBlock {
                what: "shader group",
                build: || shader_group_block(0, SYS + 4928, 1).to_vec(),
                bytes: "f0376140010000000000000000000000401300500000000001000100000000000000000000000000000000000000000000000000000000000000000000000000",
            },
            HostBlock { what: "pointer array", build: || pointer_array(&[SYS + 4576]), bytes: "e011005000000000" },
            HostBlock { what: "empty pointer array", build: || pointer_array(&[]), bytes: "" },
        ];
        for block in &blocks {
            assert_eq!(hex(&(block.build)()), block.bytes, "{}", block.what);
        }
    }

    #[test]
    fn block_functions_write_their_arguments_without_checks() {
        let nothing = index_buffer_block(0, 0, 0);
        assert_eq!(word32(&nothing, 0), INDEX_BUFFER_VFT);
        assert_eq!((word32(&nothing, 8), word64(&nothing, 24), word64(&nothing, 48)), (0, 0, 0));
        let widest = vertex_buffer_block(u32::MAX, u32::MAX, u64::MAX, u64::MAX, u64::MAX);
        assert_eq!((word32(&widest, 8), word32(&widest, 12)), (u32::MAX, u32::MAX));
        assert_eq!([24, 48, 56].map(|at| word64(&widest, at)), [u64::MAX; 3]);
        let group = shader_group_block(u64::MAX, u64::MAX, u16::MAX);
        assert_eq!(&group[24..28], &[0xff; 4]);
        assert!(group[28..].iter().all(|&b| b == 0));
    }

    #[test]
    fn bucket_masks_set_one_bit_over_the_common_mask() {
        for bucket in 0u8..32 {
            let mask = render_bucket_mask(bucket);
            let bit = 1u32 << bucket;
            match bucket {
                0..=7 => assert_eq!(mask, 0xFF00 | bit),
                8..=15 => assert_eq!(mask, 0xFF00),
                _ => assert_eq!((mask & 0xFFFF, mask >> 16), (0xFF00, 1 << (bucket - 16))),
            }
            let block = shader_fx_block(1, 2, 3, 4, 5, 6, bucket, 9);
            assert_eq!((block[57], word32(&block, 60), block[58]), (bucket, mask, 9));
        }
    }

    #[test]
    fn buckets_from_32_have_only_the_common_mask() {
        for bucket in [32u8, 33, 63, 200, 255] {
            assert_eq!(render_bucket_mask(bucket), 0xFF00, "корзина {bucket}");
        }
        let block = shader_fx_block(1, 2, 0, 0, 0, 0, 40, 0);
        assert_eq!(u32::from_le_bytes(block[60..64].try_into().unwrap()), 0xFF00);
    }

    #[test]
    fn info_words_pack_the_kind_the_index_and_the_masked_fields() {
        struct Cb {
            buffer: u8,
            offset: u16,
            length: u16,
            word: u32,
        }
        let cb = |buffer, offset, length, word| Cb { buffer, offset, length, word };
        let cases = [
            cb(0, 0, 16, 0x0100_0003),
            cb(0, 16, 16, 0x0100_1003),
            cb(0, 64, 4, 0x0040_4003),
            cb(1, 0, 0, 0x7),
            cb(63, 0, 0, 0xff),
            cb(64, 0, 0, 0x3),
            cb(255, 0, 0, 0xff),
            cb(0, 4095, 0, 0x000f_ff03),
            cb(0, 4096, 0, 0x3),
            cb(0, 0, 4095, 0xfff0_0003),
            cb(0, 0, 4096, 0x3),
            cb(255, 65535, 65535, 0xffff_ffff),
        ];
        for case in cases {
            let info = cbuffer_info(3, case.buffer, case.offset, case.length);
            assert_eq!(info, ParamInfoG9 { name: 3, data: case.word });
        }
        for index in [0u8, 1, 255] {
            assert_eq!(texture_info(1, index).data, u32::from(index) << 2);
            assert_eq!(sampler_info(2, index).data, 2 | u32::from(index) << 2);
        }
    }

    #[test]
    fn the_parameter_description_of_the_cone_equals_the_host_and_counts_in_a_byte() {
        let textures = [(0xc8e8_c282, 0), (0xf3b6_cac3, 1)].map(|(name, index)| texture_info(name, index));
        let samplers = [(0x77ca_165f, 0), (0xf1fe_2b71, 1)].map(|(name, index)| sampler_info(name, index));
        let fields = [(0xc194_ef36, 0, 16), (0x614e_d177, 16, 16), (0x7014_8243, 32, 16), (0xb04a_9ad0, 48, 16), (0x78ad_7209, 64, 4)]
            .map(|(name, offset, length)| cbuffer_info(name, 0, offset, length));
        let cone = ParamInfosG9 {
            buffers: 1,
            textures: 2,
            unknowns: 0,
            samplers: 2,
            params: textures.into_iter().chain(samplers).chain(fields).collect(),
        };
        assert_eq!(
            hex(&param_infos_block(&cone)),
            "010200020900010c82c2e8c800000000c3cab6f3040000005f16ca7702000000\
             712bfef10600000036ef94c10300000177d14e61031000014382147003200001\
             d09a4ab0033000010972ad7803404000"
        );
        for count in [0usize, 1, 255, 256, 300] {
            let params = (0..count as u32).map(|i| ParamInfoG9 { name: i, data: i << 8 }).collect();
            let infos = ParamInfosG9 { buffers: 0, textures: 0, unknowns: 0, samplers: 0, params };
            let block = param_infos_block(&infos);
            assert_eq!((block.len(), block[4]), (8 + 8 * count, count as u8));
            assert_eq!(block[6..8], [PARAM_INFOS_UNKNOWN1, PARAM_INFOS_UNKNOWN2]);
        }
    }

    fn cone_values() -> ParametersG9 {
        let mut buffer = vec![0u8; 80];
        for word in buffer[..16].chunks_mut(4) {
            word.copy_from_slice(&1.0f32.to_le_bytes());
        }
        ParametersG9 { base: SYS + 208, buffers: vec![buffer], textures: vec![SYS + 4416, 0], unknowns: 0, samplers: vec![0, 1] }
    }

    #[test]
    fn the_value_block_of_the_cone_has_the_host_hash() {
        let block = parameters_block(&cone_values());
        assert_eq!(block.len(), 1250);
        assert_eq!(sha256_hex(&block), "678f305d9daf764daf9cc17062ce5a59da0027f0c47be804b957d5a11287bf73");
    }

    #[test]
    fn every_buffer_pointer_leads_to_a_copy_of_that_buffer() {
        let params = ParametersG9 {
            base: SYS + 0x100,
            buffers: vec![vec![0xA1; 16], vec![], vec![0xB2; 8], vec![0xC3; 20]],
            textures: vec![7, 8, 9],
            unknowns: 2,
            samplers: vec![4, 5],
        };
        let block = parameters_block(&params);
        let pointer = |copy: usize, buffer: usize| word64(&block, 8 * (copy * params.buffers.len() + buffer));
        for copy in 0..PARAMETER_COPIES {
            for (n, data) in params.buffers.iter().enumerate() {
                let at = (pointer(copy, n) - params.base) as usize;
                assert_eq!(&block[at..at + data.len()], &data[..], "copy {copy} buffer {n}");
            }
        }
        // Копии лежат подряд: расстояние между одноимёнными указателями равно сумме длин буферов.
        assert_eq!(pointer(1, 0) - pointer(0, 0), 44);
        let tail = block.len() - params.samplers.len();
        assert_eq!(&block[tail..], &[4, 5]);
        let words_at = 8 * params.buffers.len() * PARAMETER_COPIES + PARAMETER_COPIES * 44;
        assert_eq!([7, 8, 9].map(|n| word64(&block, words_at + 8 * (n - 7))), [7, 8, 9]);
        assert!(block[words_at + 24..words_at + 96 * 3 + 2 * 96].iter().all(|&b| b == 0));
    }

    #[test]
    fn value_block_sizes_add_up_for_every_mix() {
        struct Mix {
            buffers: usize,
            each: usize,
            textures: usize,
            unknowns: usize,
            samplers: usize,
        }
        let mixes = [
            Mix { buffers: 0, each: 0, textures: 0, unknowns: 0, samplers: 0 },
            Mix { buffers: 1, each: 16, textures: 0, unknowns: 0, samplers: 0 },
            Mix { buffers: 2, each: 12, textures: 3, unknowns: 2, samplers: 4 },
            Mix { buffers: 0, each: 0, textures: 2, unknowns: 0, samplers: 0 },
            Mix { buffers: 3, each: 0, textures: 0, unknowns: 1000, samplers: 0 },
        ];
        for mix in mixes {
            let params = ParametersG9 {
                base: SYS,
                buffers: vec![vec![9; mix.each]; mix.buffers],
                textures: vec![1; mix.textures],
                unknowns: mix.unknowns,
                samplers: vec![0; mix.samplers],
            };
            let want = mix.buffers * 96 + 12 * mix.buffers * mix.each + mix.textures * 96 + mix.unknowns * 96 + mix.samplers;
            let block = parameters_block(&params);
            assert_eq!(block.len(), want);
            assert_eq!(block.is_empty(), want == 0);
        }
    }

    /// Занятый слот декларации.
    struct Slot {
        slot: usize,
        offset: u32,
        format: u8,
    }

    /// Раскладка легаси с ожидаемой деклараций gen9.
    struct Corpus {
        mask: u32,
        stride: u8,
        slots: Vec<Slot>,
    }

    fn slot(slot: usize, offset: u32, format: u8) -> Slot {
        Slot { slot, offset, format }
    }

    #[test]
    fn corpus_layouts_give_the_expected_slots_and_the_host_digests() {
        let corpus = [
            Corpus { mask: 0xD1, stride: 32, slots: vec![slot(0, 0, 6), slot(24, 12, 28), slot(28, 16, 16), slot(29, 24, 16)] },
            Corpus {
                mask: 0x5F,
                stride: 44,
                slots: vec![slot(0, 0, 6), slot(4, 12, 6), slot(16, 24, 28), slot(20, 28, 30), slot(24, 32, 28), slot(28, 36, 16)],
            },
            Corpus {
                mask: 0x405F,
                stride: 60,
                slots: vec![slot(0, 0, 6), slot(4, 12, 6), slot(8, 24, 2), slot(16, 40, 28), slot(20, 44, 30), slot(24, 48, 28), slot(28, 52, 16)],
            },
        ];
        let digests = [
            "b5465a28771903e8fa703dacd3a25fd5f6febefad03bbeb690c925f3f87c504c",
            "28fe743d3116a947d7117f28449cdb63cb6e4616725109616bd57dacbc141709",
            "f8130d9d7f6d873245daac709cbca17a126b33ebfacd666ed24b06671d928162",
        ];
        for (layout, digest) in corpus.iter().zip(digests) {
            let decl = declaration(layout.mask, CORPUS_TYPES, layout.stride).unwrap();
            let used: Vec<Slot> = (0..DECLARATION_SLOTS)
                .filter(|&n| decl.sizes[n] != 0)
                .map(|n| slot(n, decl.offsets[n], decl.types[n]))
                .collect();
            assert_eq!(used.len(), layout.slots.len(), "{:#x}", layout.mask);
            for (got, want) in used.iter().zip(&layout.slots) {
                assert_eq!((got.slot, got.offset, got.format), (want.slot, want.offset, want.format), "{:#x}", layout.mask);
            }
            assert!(decl.sizes.iter().all(|&s| s == 0 || s == layout.stride));
            assert_eq!(sha256_hex(&declaration_block(&decl)), digest);
        }
    }

    #[test]
    fn the_cone_declaration_block_is_the_host_block() {
        let host = "000000000c0000000c0000000c0000000c0000000c0000000c0000000c0000000c0000000c0000000c0000000c0000000c0000000c0000000c0000000c0000000c0000000c0000000c0000000c0000000c0000000c0000000c0000000c0000000c000000100000001000000010000000100000001800000020000000200000002000000020000000200000002000000020000000200000002000000020000000200000002000000020000000200000002000000020000000200000002000000020000000200000002000000020000000200000000000000000000000000000000000000000000000200000002020000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000001c0000001010000000000000000000000000000000000000000000008000000000000000";
        let block = declaration_block(&declaration(0xD1, CORPUS_TYPES, 32).unwrap());
        assert_eq!(hex(&block), host);
        // Шаг вершины, умноженный на четыре, стоит последним словом.
        assert_eq!(word64(&block, 312), 128);
    }

    #[test]
    fn layouts_outside_the_corpus_are_refused() {
        assert!(declaration(0xD1, CORPUS_TYPES ^ 1, 32).is_none());
        for wrong in [31u8, 33, 0] {
            assert!(declaration(0xD1, CORPUS_TYPES, wrong).is_none(), "шаг {wrong}");
        }
        for semantic in [5u32, 8, 9, 10, 11, 12, 13, 15] {
            let mask = 1u32 << semantic;
            assert!(declaration(mask, CORPUS_TYPES, honest_stride(mask)).is_none(), "семантика {semantic}");
        }
        assert!(declaration(0xFFFF, CORPUS_TYPES, honest_stride(0xFFFF)).is_none());
        assert!(declaration(0xD1 | 1 << 5, CORPUS_TYPES, 36).is_none());
        assert!(declaration(0, CORPUS_TYPES, 4).is_none());
        let empty = declaration(0, CORPUS_TYPES, 0).unwrap();
        assert_eq!(declaration_block(&empty), [0; DECLARATION_BYTES]);
        assert_eq!(declaration(0x1_00D1, CORPUS_TYPES, 32), declaration(0xD1, CORPUS_TYPES, 32));
    }

    #[test]
    fn every_subset_of_known_semantics_declares_and_remaps_without_losing_a_byte() {
        for subset in 0..(1usize << KNOWN.len()) {
            let mask = mask_of(subset);
            let stride = honest_stride(mask);
            let decl = declaration(mask, CORPUS_TYPES, stride).unwrap_or_else(|| panic!("{mask:#x}"));
            assert_eq!(decl.vertex_size, stride);
            assert_eq!(decl.offsets[DECLARATION_SLOTS - 1], u32::from(stride));
            let legacy = marked(usize::from(stride) * 3);
            let moved = remap_vertices(&legacy, mask, CORPUS_TYPES, 3, &decl);
            let Some(mut moved) = moved else {
                assert_eq!(stride, 0, "{mask:#x}");
                continue;
            };
            let mut before = legacy;
            before.sort_unstable();
            moved.sort_unstable();
            assert_eq!(before, moved, "{mask:#x}");
        }
    }

    /// Куда переезжает компонент вершины: байты `from..from + len` легаси оказываются на `to` в gen9.
    struct Move {
        semantic: &'static str,
        from: usize,
        len: usize,
        to: usize,
    }

    #[test]
    fn components_of_a_sixty_byte_vertex_land_on_the_host_offsets() {
        let moves = [
            Move { semantic: "position", from: 0, len: 12, to: 0 },
            Move { semantic: "normal", from: 20, len: 12, to: 12 },
            Move { semantic: "tangent", from: 44, len: 16, to: 24 },
            Move { semantic: "weights", from: 12, len: 4, to: 40 },
            Move { semantic: "indices", from: 16, len: 4, to: 44 },
            Move { semantic: "colour", from: 32, len: 4, to: 48 },
            Move { semantic: "uv0", from: 36, len: 8, to: 52 },
        ];
        let decl = declaration(0x405F, CORPUS_TYPES, 60).unwrap();
        let legacy = marked(60);
        let out = remap_vertices(&legacy, 0x405F, CORPUS_TYPES, 1, &decl).unwrap();
        for m in &moves {
            assert_eq!(out[m.to..m.to + m.len], legacy[m.from..m.from + m.len], "{}", m.semantic);
        }
        // Вершины рядом не смешиваются: вторая вершина сдвинута на шаг.
        let two = remap_vertices(&marked(120), 0x405F, CORPUS_TYPES, 2, &decl).unwrap();
        let second = marked(120);
        for m in &moves {
            assert_eq!(two[60 + m.to..60 + m.to + m.len], second[60 + m.from..60 + m.from + m.len], "{}", m.semantic);
        }
    }

    #[test]
    fn a_cone_vertex_stays_in_place_because_its_slots_follow_its_semantics() {
        let decl = declaration(0xD1, CORPUS_TYPES, 32).unwrap();
        let legacy = marked(96);
        assert_eq!(remap_vertices(&legacy, 0xD1, CORPUS_TYPES, 3, &decl), Some(legacy));
    }

    #[test]
    fn a_remap_is_all_or_nothing() {
        struct Attempt {
            what: &'static str,
            data: usize,
            mask: u32,
            count: usize,
            decl: fn(&Declaration) -> Declaration,
            expect_some: bool,
        }
        let same: fn(&Declaration) -> Declaration = Declaration::clone;
        let attempts = [
            Attempt { what: "one byte short", data: 95, mask: 0xD1, count: 3, decl: same, expect_some: false },
            Attempt { what: "one vertex too many", data: 96, mask: 0xD1, count: 4, decl: same, expect_some: false },
            Attempt { what: "no semantics, no vertices", data: 96, mask: 0, count: 0, decl: same, expect_some: false },
            Attempt { what: "no semantics", data: 96, mask: 0, count: 3, decl: same, expect_some: false },
            Attempt { what: "semantic 5", data: 96, mask: 0xD1 | 1 << 5, count: 2, decl: same, expect_some: false },
            Attempt { what: "no vertices", data: 96, mask: 0xD1, count: 0, decl: same, expect_some: true },
            Attempt { what: "no data at all", data: 0, mask: 0xD1, count: 0, decl: same, expect_some: true },
            Attempt { what: "wider vertex", data: 96, mask: 0xD1, count: 3, decl: |d| Declaration { vertex_size: 40, ..d.clone() }, expect_some: false },
            Attempt { what: "narrower vertex overlaps", data: 96, mask: 0xD1, count: 3, decl: |d| Declaration { vertex_size: 16, ..d.clone() }, expect_some: true },
            Attempt { what: "shifted offsets", data: 96, mask: 0xD1, count: 3, decl: |d| Declaration { offsets: d.offsets.map(|o| o + 4), ..d.clone() }, expect_some: false },
            Attempt { what: "absurd count", data: 96, mask: 0xD1, count: 1 << 58, decl: same, expect_some: false },
        ];
        let base = declaration(0xD1, CORPUS_TYPES, 32).unwrap();
        for attempt in attempts {
            let decl = (attempt.decl)(&base);
            let got = remap_vertices(&marked(attempt.data), attempt.mask, CORPUS_TYPES, attempt.count, &decl);
            assert_eq!(got.is_some(), attempt.expect_some, "{}", attempt.what);
            if let Some(out) = got {
                assert_eq!(out.len(), attempt.data, "{}", attempt.what);
            }
        }
        assert_eq!(remap_vertices(&[7; 96], 0xD1, CORPUS_TYPES, 0, &base), Some(vec![0; 96]));
    }
}
