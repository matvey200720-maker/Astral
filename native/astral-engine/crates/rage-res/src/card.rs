//! Карточка по картинке: GLB с одним двусторонним квадратом.

use crate::glb::{self, ImageData, MaterialData, MeshData, Scene};
use crate::shaders::AlphaMode;
use crate::{error::Result, png_io};

const HALF: f32 = 0.75;
const TITLE: &str = "Image card";

/// PNG и JPEG кладутся как есть, всё остальное (WebP) уходит в PNG.
fn embed(image_bytes: &[u8], decoded: png_io::Decoded) -> Result<ImageData> {
    let verbatim: [(&[u8], &str); 2] = [
        (&[0x89, b'P', b'N', b'G'], "image/png"),
        (&[0xff, 0xd8], "image/jpeg"),
    ];
    let same_format = verbatim
        .iter()
        .find_map(|&(magic, mime)| image_bytes.starts_with(magic).then_some(mime));
    let (bytes, mime_type) = match same_format {
        Some(mime) => (image_bytes.to_vec(), mime),
        None => {
            let recoded = png_io::encode(decoded.width, decoded.height, &decoded.rgba)?;
            (recoded, "image/png")
        }
    };
    Ok(ImageData { bytes, mime_type })
}

/// Квадрат с углами против часовой стрелки, начиная с левого нижнего.
fn quad() -> MeshData {
    let corners = [
        (-HALF, -HALF, 0.0, 1.0),
        (HALF, -HALF, 1.0, 1.0),
        (HALF, HALF, 1.0, 0.0),
        (-HALF, HALF, 0.0, 0.0),
    ];
    let positions = corners.iter().flat_map(|c| [c.0, c.1, 0.0]).collect();
    let normals = corners.iter().flat_map(|_| [0.0, 0.0, 1.0]).collect();
    let uvs = corners.iter().flat_map(|c| [c.2, c.3]).collect();
    MeshData {
        positions,
        normals: Some(normals),
        uvs: Some(uvs),
        name: TITLE.to_owned(),
        indices: vec![0, 1, 2, 0, 2, 3],
        material: Some(0),
        ..MeshData::default()
    }
}

/// Материал карточки: картинка целиком, двусторонний, с прозрачностью.
fn card_material() -> MaterialData {
    MaterialData {
        double_sided: true,
        alpha_mode: AlphaMode::Blend,
        base_color_texture: Some(0),
        name: TITLE.to_owned(),
        ..MaterialData::default()
    }
}

pub fn build(image_bytes: &[u8]) -> Result<Vec<u8>> {
    let decoded = png_io::decode(image_bytes)?;
    let image = embed(image_bytes, decoded)?;

    let (meshes, materials, images) = (vec![quad()], vec![card_material()], vec![image]);
    let scene = Scene {
        meshes,
        materials,
        images,
        name: TITLE.to_owned(),
        ..Scene::default()
    };
    glb::write(&scene)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::Kind;
    use serde_json::{json, Value};

    const NO_PICTURE: &str = "Картинка не PNG, не JPEG и не WebP.";

    fn tiny_png() -> Vec<u8> {
        png_io::encode(2, 1, &[1, 2, 3, 255, 4, 5, 6, 255]).unwrap()
    }

    /// Слово u32 (little-endian) контейнера по смещению `at`.
    fn word(glb: &[u8], at: usize) -> u32 {
        u32::from_le_bytes(glb[at..at + 4].try_into().unwrap())
    }

    fn json_of(glb: &[u8]) -> Value {
        let length = word(glb, 12) as usize;
        serde_json::from_slice(&glb[20..20 + length]).unwrap()
    }

    fn contains(haystack: &[u8], needle: &[u8]) -> bool {
        haystack.windows(needle.len()).any(|w| w == needle)
    }

    fn failure(bytes: &[u8]) -> String {
        let error = build(bytes).unwrap_err();
        assert_eq!(error.kind, Kind::Argument);
        error.to_string()
    }

    /// Каждое поле JSON по указателю должно быть равно ожидаемому.
    fn expect_fields(json: &Value, fields: &[(&str, Value)]) {
        for (pointer, want) in fields {
            assert_eq!(json.pointer(pointer), Some(want), "{pointer}");
        }
    }

    #[test]
    fn a_png_card_embeds_the_original_bytes() {
        let png = tiny_png();
        let glb = build(&png).unwrap();
        expect_fields(
            &json_of(&glb),
            &[
                ("/images/0/mimeType", json!("image/png")),
                ("/materials/0/name", json!(TITLE)),
                ("/materials/0/alphaMode", json!("BLEND")),
                ("/materials/0/doubleSided", json!(true)),
                ("/accessors/0/max", json!([0.75, 0.75, 0.0])),
            ],
        );
        assert!(contains(&glb, &png));
    }

    #[test]
    fn container_layout_for_the_sample() {
        let png = tiny_png();
        assert_eq!(png.len(), 75);
        let glb = build(&png).unwrap();
        assert_eq!(&glb[0..4], b"glTF");
        assert_eq!(word(&glb, 4), 2);
        assert_eq!(word(&glb, 8) as usize, glb.len());
        assert_eq!(glb.len(), 1532);
        assert_eq!(word(&glb, 12), 1288);
        assert_eq!(&glb[16..20], b"JSON");
        let bin = &glb[glb.len() - 216..];
        assert_eq!(
            &glb[glb.len() - 224..glb.len() - 216],
            &[216, 0, 0, 0, b'B', b'I', b'N', 0]
        );
        assert_eq!(&bin[..75], &png[..]);
        assert_eq!(&bin[76..80], &(-0.75f32).to_le_bytes());
        assert_eq!(
            crate::hash::sha256_hex(&glb),
            "cc728c3169dab09fc5f7a9a58cb3d60078ba1b76c2816056d66a494966386cea"
        );
        let offsets: Vec<u64> = json_of(&glb)["bufferViews"]
            .as_array()
            .unwrap()
            .iter()
            .map(|view| view["byteOffset"].as_u64().unwrap())
            .collect();
        assert_eq!(offsets, [0, 76, 124, 172, 204]);
    }

    #[test]
    fn jpeg_is_embedded_verbatim() {
        let rgba: Vec<u8> = (0..16 * 16).flat_map(|i| [i as u8, 90, 200, 255]).collect();
        let jpeg = png_io::encode_jpeg(16, 16, &rgba, 80).unwrap();
        let glb = build(&jpeg).unwrap();
        expect_fields(
            &json_of(&glb),
            &[("/images/0/mimeType", json!("image/jpeg"))],
        );
        assert!(contains(&glb, &jpeg));
    }

    #[test]
    fn webp_is_recoded_to_png() {
        let mut webp = Vec::new();
        image_webp::WebPEncoder::new(&mut webp)
            .encode(
                &[1, 2, 3, 255, 4, 5, 6, 255],
                2,
                1,
                image_webp::ColorType::Rgba8,
            )
            .unwrap();
        assert_eq!(&webp[..4], b"RIFF");
        let glb = build(&webp).unwrap();
        expect_fields(
            &json_of(&glb),
            &[("/images/0/mimeType", json!("image/png"))],
        );
        assert!(contains(&glb, &[0x89, b'P', b'N', b'G']));
        assert!(!contains(&glb, &webp));
        assert!(contains(&glb, &tiny_png()));
    }

    #[test]
    fn png_with_trailing_garbage_is_kept_whole() {
        let mut png = tiny_png();
        png.extend_from_slice(b"garbage!");
        let glb = build(&png).unwrap();
        assert!(contains(&glb, &png));
    }

    #[test]
    fn garbage_is_refused() {
        assert!(build(b"definitely not a picture").is_err());
        for bytes in [&b""[..], b"definitely not a picture", b"GIF89a"] {
            assert_eq!(failure(bytes), NO_PICTURE);
        }
    }

    #[test]
    fn broken_streams_are_refused() {
        let png = tiny_png();
        let mut corrupted = png.clone();
        corrupted[45] ^= 0xff;
        let cases: [(&[u8], &str); 6] = [
            (&png[..png.len() / 2], "PNG не прочитан: "),
            (&png[..8], "PNG не прочитан: "),
            (b"\x89PNG", "PNG не прочитан: "),
            (&corrupted, "PNG не прочитан: "),
            (&[0xff, 0xd8], "JPEG не прочитан: "),
            (b"RIFF\0\0\0\0WEBP\0", "WebP не прочитан: "),
        ];
        for (bytes, prefix) in cases {
            assert!(failure(bytes).starts_with(prefix), "{prefix}");
        }
    }
}
