//! Хеши: sha256 строкой и joaat (Jenkins one-at-a-time) для имён RAGE.

use sha2::{Digest, Sha256};

const HEX_DIGITS: &[u8; 16] = b"0123456789abcdef";

pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut text = String::with_capacity(digest.len() * 2);
    for &byte in digest.iter() {
        text.push(char::from(HEX_DIGITS[usize::from(byte >> 4)]));
        text.push(char::from(HEX_DIGITS[usize::from(byte & 0x0f)]));
    }
    text
}

/// Накопитель хеша Дженкинса «по одному байту»; сложения идут по модулю 2^32.
struct OneAtATime(u32);

impl OneAtATime {
    /// Подмешивает сдвинутое влево само состояние.
    fn spread(&mut self, left: u32) {
        self.0 = self.0.wrapping_add(self.0 << left);
    }

    /// Складывает состояние с его сдвигом вправо через исключающее «или».
    fn fold_down(&mut self, right: u32) {
        self.0 ^= self.0 >> right;
    }

    fn feed(&mut self, byte: u8) {
        self.0 = self.0.wrapping_add(u32::from(byte));
        self.spread(10);
        self.fold_down(6);
    }

    fn finish(mut self) -> u32 {
        self.spread(3);
        self.fold_down(11);
        self.spread(15);
        self.0
    }
}

/// Общее ядро: `fold` преобразует каждый байт перед подмешиванием.
fn jenkins(text: &str, fold: impl Fn(u8) -> u8) -> u32 {
    let mut hash = OneAtATime(0);
    text.bytes().for_each(|byte| hash.feed(fold(byte)));
    hash.finish()
}

/// Хеш без смены регистра.
pub fn joaat_case(text: &str) -> u32 {
    jenkins(text, std::convert::identity)
}

/// Хеш с приведением ASCII-букв к нижнему регистру.
pub fn joaat(text: &str) -> u32 {
    jenkins(text, |b| b.to_ascii_lowercase())
}

#[cfg(test)]
mod tests {
    use super::{joaat, joaat_case, sha256_hex};

    /// Вход должен дать свою sha256-строку.
    fn check_digest(input: &[u8], expected: &str) {
        assert_eq!(sha256_hex(input), expected, "sha256 {input:?}");
    }

    #[test]
    fn sha256_matches_the_known_digest() {
        let abc = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
        check_digest(b"abc", abc);
    }

    #[test]
    fn sha256_examples() {
        let empty = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
        let single = "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb";
        let zeros = "709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c";
        let cases: [(&[u8], &str); 3] = [(&[], empty), (b"a", single), (&[0, 0, 0], zeros)];
        for (input, expected) in cases {
            check_digest(input, expected);
        }
    }

    #[test]
    fn table_of_hashes() {
        // (текст, joaat, joaat_case)
        let table: [(&str, u32, u32); 15] = [
            ("", 0, 0),
            ("a", 3392050242, 3392050242),
            ("A", 3392050242, 2181104624),
            ("default", 3839837909, 3839837909),
            ("DEFAULT", 3839837909, 3756186228),
            ("Default", 3839837909, 1012917042),
            ("abc", 3977453403, 3977453403),
            ("assetName", 68488382, 2591541189),
            ("bbMin", 510364727, 3656352310),
            ("prop_streetlight_01", 3231494328, 3231494328),
            ("ÄÖ", 1336483834, 1336483834),
            ("я", 3360302315, 3360302315),
            ("hello world", 1045060183, 1045060183),
            ("\u{0}", 0, 0),
            ("a b", 3570742899, 3570742899),
        ];
        let (lower, exact): (Vec<_>, Vec<_>) = table
            .iter()
            .map(|&(text, lower, exact)| {
                ((text, lower, joaat(text)), (text, exact, joaat_case(text)))
            })
            .unzip();
        for (text, want, got) in lower {
            assert_eq!(got, want, "joaat {text:?}");
        }
        for (text, want, got) in exact {
            assert_eq!(got, want, "joaat_case {text:?}");
        }
    }

    #[test]
    fn known_names() {
        let [upper, lower] = ["DEFAULT", "default"].map(joaat);
        assert_eq!(lower, 3_839_837_909);
        assert_eq!(upper, lower);
        assert_eq!(joaat(""), 0);
    }
}
