//! Маленькие искусственные архивы для проверок и генераторы байт для них.
//!
//! Содержимое зафиксировано: с этих деревьев снимались эталоны, поэтому менять в
//! них нельзя ни одного байта.

use std::iter;

use crate::tree::{Body, Compress, Data, DirNode, FileNode};

/// Один шаг xorshift по 64 битам: сдвиги 13 влево, 7 вправо, 17 влево.
fn xorshift(state: u64) -> u64 {
    let a = state ^ (state << 13);
    let b = a ^ (a >> 7);
    b ^ (b << 17)
}

/// Несжимаемые байты: выход — биты 32..39 каждого нового состояния, первое не выдаётся.
pub fn noise(len: usize, seed: u64) -> Vec<u8> {
    iter::successors(Some(seed | 1), |&s| Some(xorshift(s)))
        .skip(1)
        .take(len)
        .map(|s| (s >> 32) as u8)
        .collect()
}

/// Первые `len` байт бесконечного повтора строки `seed` с переводом строки на конце.
pub fn text(len: usize, seed: &str) -> Vec<u8> {
    let line: Vec<u8> = seed.bytes().chain(iter::once(b'\n')).collect();
    iter::repeat_with(|| line.iter().copied())
        .flatten()
        .take(len)
        .collect()
}

/// Файл ресурса целиком: «RSC7», слово 0x44, два слова флагов, тело.
pub fn resource(sys: u32, gfx: u32, body: &[u8]) -> Vec<u8> {
    let words = [u32::from_le_bytes(*b"RSC7"), 0x44, sys, gfx];
    let mut out: Vec<u8> = words.iter().flat_map(|w| w.to_le_bytes()).collect();
    out.extend_from_slice(body);
    out
}

/// `content.xml` по умолчанию: 568 байт, без завершающего перевода строки.
pub const CONTENT_XML: &str = concat!(
    "<?xml version=\"1.0\"?>\n",
    "<CDataFileMgr__ContentsOfDataFileXml>\n",
    "  <disabledFiles />\n",
    "  <includedXmlFiles />\n",
    "  <dataFiles />\n",
    "  <contentChangeSets>\n",
    "    <Item>\n",
    "      <changeSetName>CCS_TEST</changeSetName>\n",
    "      <filesToEnable>\n",
    "        <Item>update:/%PLATFORM%/data/cdimages/scaleform_generic.rpf</Item>\n",
    "        <Item>update:/%PLATFORM%/models/cdimages/panika.rpf</Item>\n",
    "        <Item>update:/common/data/a.meta</Item>\n",
    "        <Item>dlcpacks:/mine/dlc.rpf</Item>\n",
    "      </filesToEnable>\n",
    "    </Item>\n",
    "  </contentChangeSets>\n",
    "  <patchFiles />\n",
    "</CDataFileMgr__ContentsOfDataFileXml>",
);

/// Откуда берутся байты строки таблицы.
enum Src {
    Text(usize, &'static str),
    Noise(usize, u64),
    Bytes(Vec<u8>),
}

impl Src {
    fn make(self) -> Vec<u8> {
        match self {
            Src::Text(len, seed) => text(len, seed),
            Src::Noise(len, seed) => noise(len, seed),
            Src::Bytes(b) => b,
        }
    }
}

/// Строка таблицы дерева: имя, содержимое, режим, вложенность.
enum Row {
    Dir(&'static str, Vec<Row>),
    /// Вложенный архив: его корень безымянный.
    Pack(&'static str, Vec<Row>),
    File(&'static str, Src, Compress),
    Rsc(&'static str, (u32, u32), Src),
}

/// Общий построитель: порядок в векторах — порядок строк, каталоги и файлы раздельно.
fn assemble(name: &str, rows: Vec<Row>) -> DirNode {
    let leaf = |name: &str, body| FileNode {
        name: name.to_string(),
        body,
    };
    rows.into_iter().fold(DirNode::new(name), |mut node, row| {
        match row {
            Row::Dir(n, kids) => node.dirs.push(assemble(n, kids)),
            Row::Pack(n, kids) => node
                .files
                .push(leaf(n, Body::Nested(Box::new(assemble("", kids))))),
            Row::File(n, src, compress) => node.files.push(leaf(
                n,
                Body::Binary {
                    data: Data::memory(src.make()),
                    compress,
                },
            )),
            Row::Rsc(n, (sys, gfx), src) => node.files.push(leaf(
                n,
                Body::Resource {
                    data: Data::memory(resource(sys, gfx, &src.make())),
                },
            )),
        }
        node
    })
}

/// Дерево «update.rpf». `content_xml` подменяет содержимое `content.xml` (всегда `Auto`).
pub fn update_tree(content_xml: Option<Vec<u8>>) -> DirNode {
    use Compress::{Auto, Store};
    let content = content_xml.unwrap_or_else(|| CONTENT_XML.as_bytes().to_vec());
    let generic = vec![
        Row::Dir(
            "inner",
            vec![Row::File("deep.xml", Src::Text(700, "deep"), Auto)],
        ),
        Row::File("hud.gfx", Src::Noise(1800, 11), Auto),
        Row::File("mini.gfx", Src::Text(2500, "gfx"), Auto),
        Row::Rsc("tex.ytd", (0x6000_0001, 0x9000_0002), Src::Noise(900, 5)),
    ];
    let other = vec![Row::File("keep.xml", Src::Text(600, "keep"), Auto)];
    assemble(
        "",
        vec![
            Row::Dir(
                "common",
                vec![Row::Dir(
                    "data",
                    vec![
                        Row::File("a.xml", Src::Text(4000, "<a/>"), Auto),
                        Row::File("b.dat", Src::Noise(3000, 7), Auto),
                        Row::File("c.txt", Src::Text(900, "ccc"), Store),
                        Row::File("old.xml", Src::Text(500, "<old/>"), Auto),
                    ],
                )],
            ),
            Row::Dir(
                "x64",
                vec![Row::Dir(
                    "data",
                    vec![Row::Dir(
                        "cdimages",
                        vec![
                            Row::Pack("scaleform_generic.rpf", generic),
                            Row::Pack("scaleform_other.rpf", other),
                        ],
                    )],
                )],
            ),
            Row::File("content.xml", Src::Bytes(content), Auto),
            Row::File("setup2.xml", Src::Text(315, "<SSetupData/>"), Auto),
        ],
    )
}

/// Дерево «common.rpf».
pub fn common_tree() -> DirNode {
    assemble(
        "",
        vec![
            Row::Dir(
                "data",
                vec![Row::File("g.xml", Src::Text(1200, "<g/>"), Compress::Auto)],
            ),
            Row::File("readme.txt", Src::Text(100, "hi"), Compress::Store),
        ],
    )
}

/// Дерево архива-замены (`nested_new.rpf`).
pub fn replacement_tree() -> DirNode {
    assemble(
        "",
        vec![Row::File(
            "new_inside.xml",
            Src::Text(333, "<new/>"),
            Compress::Auto,
        )],
    )
}
