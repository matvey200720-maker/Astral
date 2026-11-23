//! Звуковые банки `.awc` для HTTP-канала данных: оглавление и WAV.
//!
//! Разбор формата живёт в `rage_res::awc`; здесь только три ответа, которые
//! нужны каналу (`http`), и больше ничего: ни диска, ни сети, ни состояния.

use rage_res::awc;
use serde_json::Value;

use crate::error::Result;

/// Банк вместе с номером потока, который из него нужен.
type Pick<'a> = (&'a [u8], u32);

/// Достаёт моно-звук выбранного потока.
fn audio_of((bank, id): Pick<'_>) -> Result<awc::StreamAudio> {
    Ok(awc::stream_audio(bank, id)?)
}

/// Оглавление банка. Файл с чужим началом соседний читатель принимает за
/// зашифрованный банк игры и отказа не даёт.
pub fn overview(bytes: &[u8]) -> Result<Value> {
    let bank = awc::read_bank(bytes)?;
    Ok(awc::bank_json(&bank))
}

/// Моно WAV (16 бит) из одного потока банка.
pub fn mono_wav(bytes: &[u8], id: u32) -> Result<Vec<u8>> {
    let audio = audio_of((bytes, id))?;
    Ok(awc::wav(audio.sample_rate, &audio.pcm))
}

/// Стерео WAV: левый поток в первом канале, правый во втором. Сначала
/// разбирается левый, поэтому при двух отказах виден его текст.
pub fn pair_wav(left: (&[u8], u32), right: (&[u8], u32)) -> Result<Vec<u8>> {
    let (first, second) = (audio_of(left)?, audio_of(right)?);
    Ok(awc::stereo_wav(&first, &second))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use serde_json::json;
    use sha2::{Digest, Sha256};

    const TAG_FORMAT: u8 = 0xFA;
    const TAG_DATA: u8 = 0x55;

    /// Слово чанка: смещение (28 бит), размер (28 бит) и тип (8 бит).
    fn chunk_word(tag: u8, size: usize, offset: usize) -> [u8; 8] {
        let packed = (offset as u64) | ((size as u64) << 28) | (u64::from(tag) << 56);
        packed.to_le_bytes()
    }

    /// Банк из одного PCM-потока (22050 Гц, кодек 0) с жёсткой раскладкой.
    pub(crate) fn bank(id: u32, pcm: &[i16]) -> Vec<u8> {
        let data_len = pcm.len() * 2;
        let mut out = Vec::with_capacity(64 + data_len);
        out.extend_from_slice(b"ADAT");
        out.extend_from_slice(&255u16.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&1i32.to_le_bytes());
        out.extend_from_slice(&36i32.to_le_bytes());
        out.extend_from_slice(&((2u32 << 29) | id).to_le_bytes());
        out.extend_from_slice(&chunk_word(TAG_FORMAT, 20, 36));
        out.extend_from_slice(&chunk_word(TAG_DATA, data_len, 64));
        let mut format = [0u8; 20];
        format[..4].copy_from_slice(&(pcm.len() as u32).to_le_bytes());
        format[8..10].copy_from_slice(&22050u16.to_le_bytes());
        out.extend_from_slice(&format);
        out.extend_from_slice(&[0u8; 8]);
        out.extend(pcm.iter().flat_map(|sample| sample.to_le_bytes()));
        out
    }

    /// Поток будущего банка: номер и чанки «тип, содержимое».
    struct Strand {
        id: u32,
        chunks: Vec<(u8, Vec<u8>)>,
    }

    fn format_blob(samples: u32, rate: u16, codec: u8, peak: bool) -> Vec<u8> {
        let mut blob = vec![0u8; if peak { 24 } else { 20 }];
        blob[..4].copy_from_slice(&samples.to_le_bytes());
        blob[8..10].copy_from_slice(&rate.to_le_bytes());
        blob[19] = codec;
        blob
    }

    fn pcm_blob(pcm: &[i16]) -> Vec<u8> {
        pcm.iter().flat_map(|sample| sample.to_le_bytes()).collect()
    }

    fn pcm_strand(id: u32, rate: u16, pcm: &[i16]) -> Strand {
        Strand {
            id,
            chunks: vec![
                (TAG_FORMAT, format_blob(pcm.len() as u32, rate, 0, false)),
                (TAG_DATA, pcm_blob(pcm)),
            ],
        }
    }

    /// Собирает банк: заголовок, слова потоков, таблица чанков, затем
    /// содержимое чанков, каждое с выравниванием по 16 байт.
    fn assemble(version: u16, flags: u16, strands: &[Strand]) -> Vec<u8> {
        let mut out = b"ADAT".to_vec();
        out.extend_from_slice(&version.to_le_bytes());
        out.extend_from_slice(&flags.to_le_bytes());
        out.extend_from_slice(&(strands.len() as i32).to_le_bytes());
        out.extend_from_slice(&0i32.to_le_bytes());
        if flags & 1 != 0 {
            for index in 0..strands.len() {
                out.extend_from_slice(&(index as u16).to_le_bytes());
            }
        }
        for strand in strands {
            out.extend_from_slice(
                &(((strand.chunks.len() as u32) << 29) | strand.id).to_le_bytes(),
            );
        }
        let table_len: usize = strands.iter().map(|strand| strand.chunks.len() * 8).sum();
        let mut cursor = (out.len() + table_len) / 16 * 16 + 16;
        let mut placed = Vec::new();
        for strand in strands {
            for (tag, blob) in &strand.chunks {
                out.extend_from_slice(&chunk_word(*tag, blob.len(), cursor));
                placed.push((cursor, blob));
                cursor = (cursor + blob.len()).div_ceil(16) * 16;
            }
        }
        for (at, blob) in placed {
            out.resize(at, 0);
            out.extend_from_slice(blob);
        }
        out
    }

    fn adpcm_strand(id: u32) -> Strand {
        Strand {
            id,
            chunks: vec![
                (TAG_FORMAT, format_blob(8, 32000, 4, false)),
                (TAG_DATA, vec![0, 0, 0, 0, 0x12, 0x34, 0x56, 0x78]),
            ],
        }
    }

    fn bank_a() -> Vec<u8> {
        assemble(1, 0, &[pcm_strand(0x0339_2BEC, 22050, &[1, 2, 3])])
    }

    fn left_bank() -> Vec<u8> {
        assemble(1, 0, &[pcm_strand(7, 22050, &[1, 2, 3])])
    }

    fn right_bank() -> Vec<u8> {
        assemble(1, 0, &[pcm_strand(8, 44100, &[-1, -2])])
    }

    fn both_bank() -> Vec<u8> {
        assemble(
            1,
            0,
            &[
                pcm_strand(7, 22050, &[1, 2, 3]),
                pcm_strand(8, 44100, &[-1, -2]),
            ],
        )
    }

    /// Одиночный поток с любым набором чанков, чтобы получить оглавление.
    fn one_strand(id: u32, version: u16, flags: u16, chunks: Vec<(u8, Vec<u8>)>) -> Vec<u8> {
        assemble(version, flags, &[Strand { id, chunks }])
    }

    fn format_json(samples: u32, rate: u32, codec: u32, peak: bool) -> Value {
        json!({
            "samples": samples, "loopPoint": 0, "sampleRate": rate, "headroom": 0,
            "codec": codec, "loopBegin": 0, "loopEnd": 0, "playBegin": 0, "playEnd": 0,
            "peak": peak
        })
    }

    fn chunks_json(parts: &[(u32, u32, u32)]) -> Value {
        Value::Array(
            parts
                .iter()
                .map(|(kind, size, offset)| json!({"type": kind, "size": size, "offset": offset}))
                .collect(),
        )
    }

    fn refusal<T: std::fmt::Debug>(result: Result<T>) -> String {
        let error = result.unwrap_err();
        assert_eq!(error.code, "InvalidOperationException");
        error.message
    }

    fn wav_header(channels: u16, rate: u32, data_len: u32) -> Vec<u8> {
        let mut head = b"RIFF".to_vec();
        head.extend_from_slice(&(36 + data_len).to_le_bytes());
        head.extend_from_slice(b"WAVEfmt ");
        head.extend_from_slice(&16u32.to_le_bytes());
        head.extend_from_slice(&1u16.to_le_bytes());
        head.extend_from_slice(&channels.to_le_bytes());
        head.extend_from_slice(&rate.to_le_bytes());
        head.extend_from_slice(&(rate * 2 * u32::from(channels)).to_le_bytes());
        head.extend_from_slice(&(2 * channels).to_le_bytes());
        head.extend_from_slice(&16u16.to_le_bytes());
        head.extend_from_slice(b"data");
        head.extend_from_slice(&data_len.to_le_bytes());
        head
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|byte| format!("{byte:02x}")).collect()
    }

    fn digest(bytes: &[u8]) -> String {
        hex(&Sha256::digest(bytes))
    }

    #[test]
    fn helper_bank_has_the_documented_bytes() {
        let expected = [
            "41444154ff0000000100000024000000ec2b3943",
            "24000040010000fa40000060000000550300000000000000",
            "2256",
            &"00".repeat(18),
            "010002000300",
        ]
        .concat();
        let bytes = bank(0x0339_2BEC, &[1, 2, 3]);
        assert_eq!(bytes.len(), 70);
        assert_eq!(hex(&bytes), expected);
        assert_eq!(bank(7, &[1, 2, 3]).len(), 70);
        assert_eq!(bank(8, &[-1, -2]).len(), 68);
        let listing = overview(&bytes).unwrap();
        assert_eq!(
            listing,
            json!({
                "encrypted": false, "version": 255, "flags": 0, "multiChannel": false,
                "streams": [{
                    "id": 54078444,
                    "chunks": chunks_json(&[(250, 20, 36), (85, 6, 64)]),
                    "format": format_json(3, 22050, 0, false),
                    "pcmLength": 3
                }]
            })
        );
        assert_eq!(mono_wav(&bytes, 0x0339_2BEC).unwrap().len(), 50);
        let pair = pair_wav((&bank(7, &[1, 2, 3]), 7), (&bank(8, &[-1, -2]), 8)).unwrap();
        assert_eq!(pair.len(), 52);
        assert_eq!(&pair[44..48], &[0x01, 0x00, 0xff, 0xff]);
    }

    #[test]
    fn overview_of_plain_banks() {
        // Ао1, Ао2, Ао3, Ао4, Ао9 – Ао13
        let listing = overview(&bank_a()).unwrap();
        assert_eq!(
            listing,
            json!({
                "encrypted": false, "version": 1, "flags": 0, "multiChannel": false,
                "streams": [{
                    "id": 54078444,
                    "chunks": chunks_json(&[(250, 20, 48), (85, 6, 80)]),
                    "format": format_json(3, 22050, 0, false),
                    "pcmLength": 3
                }]
            })
        );
        assert_eq!(bank_a().len(), 86);
        let two = overview(&both_bank()).unwrap();
        assert_eq!(
            two["streams"],
            json!([
                {"id": 7, "chunks": chunks_json(&[(250, 20, 64), (85, 6, 96)]),
                 "format": format_json(3, 22050, 0, false), "pcmLength": 3},
                {"id": 8, "chunks": chunks_json(&[(250, 20, 112), (85, 4, 144)]),
                 "format": format_json(2, 44100, 0, false), "pcmLength": 2}
            ])
        );
        let adpcm = overview(&assemble(1, 0, &[adpcm_strand(5)])).unwrap();
        assert_eq!(
            adpcm["streams"],
            json!([{"id": 5, "chunks": chunks_json(&[(250, 20, 48), (85, 8, 80)]),
                    "format": format_json(8, 32000, 4, false), "pcmLength": 8}])
        );
        let overclaimed = one_strand(
            6,
            1,
            0,
            vec![
                (TAG_FORMAT, format_blob(10, 22050, 0, false)),
                (TAG_DATA, pcm_blob(&[1, 2, 3])),
            ],
        );
        let claimed = overview(&overclaimed).unwrap();
        assert_eq!(
            claimed["streams"][0]["format"],
            format_json(10, 22050, 0, false)
        );
        assert_eq!(claimed["streams"][0]["pcmLength"], json!(3));
        for (flags, multi) in [(1u16, false), (4, true), (2, false), (8, false)] {
            let bytes = assemble(1, flags, &[pcm_strand(7, 22050, &[1, 2, 3])]);
            let listing = overview(&bytes).unwrap();
            assert_eq!(listing["flags"], json!(flags));
            assert_eq!(listing["multiChannel"], json!(multi));
            assert_eq!(
                listing["streams"][0]["chunks"],
                chunks_json(&[(250, 20, 48), (85, 6, 80)])
            );
            assert_eq!(listing["streams"][0]["pcmLength"], json!(3));
        }
        let empty = overview(&assemble(1, 0, &[])).unwrap();
        assert_eq!(
            empty,
            json!({"encrypted": false, "version": 1, "flags": 0, "multiChannel": false, "streams": []})
        );
    }

    #[test]
    fn overview_of_odd_streams() {
        // Ао5 – Ао8, Ао24
        let no_format = one_strand(9, 1, 0, vec![(TAG_DATA, pcm_blob(&[1, 2]))]);
        assert_eq!(
            overview(&no_format).unwrap()["streams"],
            json!([{"id": 9, "chunks": chunks_json(&[(85, 4, 32)]), "format": null, "pcmLength": null}])
        );
        let no_data = one_strand(
            10,
            1,
            0,
            vec![(TAG_FORMAT, format_blob(2, 22050, 0, false))],
        );
        assert_eq!(
            overview(&no_data).unwrap()["streams"],
            json!([{"id": 10, "chunks": chunks_json(&[(250, 20, 32)]),
                    "format": format_json(2, 22050, 0, false), "pcmLength": null}])
        );
        let odd_codec = one_strand(
            11,
            1,
            0,
            vec![
                (TAG_FORMAT, format_blob(2, 22050, 9, false)),
                (TAG_DATA, pcm_blob(&[1, 2])),
            ],
        );
        assert_eq!(
            overview(&odd_codec).unwrap()["streams"],
            json!([{"id": 11, "chunks": chunks_json(&[(250, 20, 48), (85, 4, 80)]),
                    "format": format_json(2, 22050, 9, false), "pcmLength": null}])
        );
        let with_peak = one_strand(
            12,
            1,
            0,
            vec![
                (TAG_FORMAT, format_blob(2, 22050, 0, true)),
                (TAG_DATA, pcm_blob(&[1, 2])),
            ],
        );
        assert_eq!(
            overview(&with_peak).unwrap()["streams"],
            json!([{"id": 12, "chunks": chunks_json(&[(250, 24, 48), (85, 4, 80)]),
                    "format": format_json(2, 22050, 0, true), "pcmLength": 2}])
        );
        let unknown = one_strand(
            0x0339_2BEC,
            1,
            0,
            vec![
                (0x7f, format_blob(3, 22050, 0, false)),
                (TAG_DATA, pcm_blob(&[1, 2, 3])),
            ],
        );
        assert_eq!(
            overview(&unknown).unwrap()["streams"],
            json!([{"id": 54078444, "chunks": chunks_json(&[(127, 20, 48), (85, 6, 80)]),
                    "format": null, "pcmLength": null}])
        );
    }

    #[test]
    fn overview_of_foreign_and_broken_files() {
        // Ао14 – Ао23
        let encrypted = json!({"encrypted": true, "version": 0, "flags": 0, "multiChannel": false, "streams": []});
        let mut foreign = b"XXXX".to_vec();
        foreign.resize(32, 7);
        assert_eq!(overview(&foreign).unwrap(), encrypted);
        assert_eq!(overview(&[0u8; 16]).unwrap(), encrypted);
        assert_eq!(
            refusal(overview(b"TADA\0\0\0\0\0\0\0\0\0\0\0\0")),
            "Банк консольной версии игры (big-endian)."
        );
        assert_eq!(refusal(overview(&[b'A'; 15])), "Файл короче заголовка AWC.");
        assert_eq!(refusal(overview(&[])), "Файл короче заголовка AWC.");
        let with_count = |count: i32| {
            let mut bytes = b"ADAT".to_vec();
            bytes.extend_from_slice(&1u16.to_le_bytes());
            bytes.extend_from_slice(&0u16.to_le_bytes());
            bytes.extend_from_slice(&count.to_le_bytes());
            bytes.extend_from_slice(&[0u8; 4]);
            bytes
        };
        assert_eq!(
            refusal(overview(&with_count(5000))),
            "Невозможное число потоков: 5000."
        );
        assert_eq!(
            refusal(overview(&with_count(-1))),
            "Невозможное число потоков: -1."
        );
        assert_eq!(
            refusal(overview(&with_count(4096))),
            "Чтение за концом банка AWC."
        );
        let full = bank_a();
        let outside = "Чанк потока 0X03392BEC выходит за конец файла.";
        assert_eq!(refusal(overview(&full[..full.len() - 1])), outside);
        assert_eq!(refusal(overview(&full[..30])), outside);
    }

    #[test]
    fn mono_wav_of_plain_banks() {
        // Ам1, Ам2, Ам4, Ам6, Ам14, Ам16 – Ам19
        let mut expected = wav_header(1, 22050, 6);
        expected.extend_from_slice(&[1, 0, 2, 0, 3, 0]);
        assert_eq!(mono_wav(&bank_a(), 0x0339_2BEC).unwrap(), expected);
        assert_eq!(
            digest(&expected),
            "c5e6882c33772de0293b3739c4df7486fd0293b653ec80577e1b73be9361eea4"
        );
        assert_eq!(mono_wav(&bank_a(), 0xE339_2BEC).unwrap(), expected);
        let second = mono_wav(&both_bank(), 8).unwrap();
        let mut second_expected = wav_header(1, 44100, 4);
        second_expected.extend_from_slice(&[0xff, 0xff, 0xfe, 0xff]);
        assert_eq!(second, second_expected);
        assert_eq!(
            digest(&second),
            "f317947ec58cff275a08ab148f64bf545764db78e2f5956d435c5c6d7204da66"
        );
        let overclaimed = one_strand(
            6,
            1,
            0,
            vec![
                (TAG_FORMAT, format_blob(10, 22050, 0, false)),
                (TAG_DATA, pcm_blob(&[1, 2, 3])),
            ],
        );
        assert_eq!(mono_wav(&overclaimed, 6).unwrap(), expected);
        let indexed = assemble(1, 1, &[pcm_strand(7, 22050, &[1, 2, 3])]);
        assert_eq!(mono_wav(&indexed, 7).unwrap(), expected);
        let silent = one_strand(
            7,
            1,
            0,
            vec![
                (TAG_FORMAT, format_blob(0, 22050, 0, false)),
                (TAG_DATA, vec![]),
            ],
        );
        let silent_wav = mono_wav(&silent, 7).unwrap();
        assert_eq!(silent_wav, wav_header(1, 22050, 0));
        assert_eq!(silent_wav.len(), 44);
        assert_eq!(
            digest(&silent_wav),
            "24d5db4ca2d256752cd049a330cb406196c05f4cfe8036beb309e0e4533d21de"
        );
        for rate in [0u16, 65535] {
            let bytes = assemble(1, 0, &[pcm_strand(7, rate, &[1, 2])]);
            let wav = mono_wav(&bytes, 7).unwrap();
            assert_eq!(&wav[..44], wav_header(1, u32::from(rate), 4).as_slice());
            assert_eq!(&wav[44..], &[1, 0, 2, 0]);
        }
        let extremes = mono_wav(
            &assemble(1, 0, &[pcm_strand(7, 22050, &[-32768, 32767, -1, 0])]),
            7,
        )
        .unwrap();
        assert_eq!(
            &extremes[44..],
            &[0x00, 0x80, 0xff, 0x7f, 0xff, 0xff, 0x00, 0x00]
        );
        assert_eq!(
            digest(&extremes),
            "47a01a21808089d9bd7540316bf60963dde0f70fb95c0e08ae02bb94b6efa35b"
        );
    }

    #[test]
    fn mono_wav_of_adpcm() {
        // Ам5
        let wav = mono_wav(&assemble(1, 0, &[adpcm_strand(5)]), 5).unwrap();
        assert_eq!(wav.len(), 60);
        assert_eq!(&wav[..44], wav_header(1, 32000, 16).as_slice());
        let decoded = ["04000600", "0d001400", "21003400", "32005500"].concat();
        assert_eq!(hex(&wav[44..]), decoded);
        assert_eq!(
            digest(&wav),
            "a06255228ba6fddd10142c4b1ea60dbfeed9069f021549c7512654ea670100b6"
        );
    }

    #[test]
    fn mono_wav_refusals() {
        // Ам3, Ам7 – Ам13, Ам15
        assert_eq!(
            refusal(mono_wav(&bank_a(), 9)),
            "В банке нет потока 0X00000009."
        );
        let no_format = one_strand(9, 1, 0, vec![(TAG_DATA, pcm_blob(&[1, 2]))]);
        assert_eq!(
            refusal(mono_wav(&no_format, 9)),
            "У потока нет звука (только метки)."
        );
        let no_data = one_strand(
            10,
            1,
            0,
            vec![(TAG_FORMAT, format_blob(2, 22050, 0, false))],
        );
        assert_eq!(
            refusal(mono_wav(&no_data, 10)),
            "У потока нет звука (только метки)."
        );
        let odd_codec = one_strand(
            11,
            1,
            0,
            vec![
                (TAG_FORMAT, format_blob(2, 22050, 9, false)),
                (TAG_DATA, pcm_blob(&[1, 2])),
            ],
        );
        assert_eq!(
            refusal(mono_wav(&odd_codec, 11)),
            "Неизвестный кодек потока: 9."
        );
        let flagged = |flags: u16| assemble(1, flags, &[pcm_strand(7, 22050, &[1, 2, 3])]);
        assert_eq!(
            refusal(mono_wav(&flagged(4), 7)),
            "Многоканальный банк (музыка, радио) — не звук ствола."
        );
        assert_eq!(
            refusal(mono_wav(&flagged(2), 7)),
            "Данные потоков банка зашифрованы."
        );
        let mut foreign = b"XXXX".to_vec();
        foreign.resize(32, 7);
        assert_eq!(
            refusal(mono_wav(&foreign, 7)),
            "Банк зашифрован — это штатный банк игры."
        );
        assert_eq!(refusal(mono_wav(&[], 7)), "Файл короче заголовка AWC.");
        let huge = one_strand(
            5,
            1,
            0,
            vec![
                (TAG_FORMAT, format_blob(0x1000_0001, 32000, 4, false)),
                (TAG_DATA, vec![0, 0, 0, 0, 0x12, 0x34, 0x56, 0x78]),
            ],
        );
        assert_eq!(
            refusal(mono_wav(&huge, 5)),
            "Звук потока длиннее допустимого."
        );
    }

    #[test]
    fn pair_wav_variants() {
        // Ап1 – Ап4, Ап9 – Ап11
        let (left, right) = (left_bank(), right_bank());
        let mut expected = wav_header(2, 22050, 8);
        expected.extend_from_slice(&[1, 0, 0xff, 0xff, 2, 0, 0xfe, 0xff]);
        let stereo = pair_wav((&left, 7), (&right, 8)).unwrap();
        assert_eq!(stereo, expected);
        assert_eq!(
            digest(&stereo),
            "61a268dd82628a1ffd40a65eaefc0d2616c442d20c04e2473d140ab7778bcbbb"
        );
        let reversed = pair_wav((&right, 8), (&left, 7)).unwrap();
        let mut reversed_expected = wav_header(2, 44100, 8);
        reversed_expected.extend_from_slice(&[0xff, 0xff, 1, 0, 0xfe, 0xff, 2, 0]);
        assert_eq!(reversed, reversed_expected);
        assert_eq!(
            digest(&reversed),
            "0bf0ce3da8636fd40c9e8609cd89916cc1569032a461512cb05e284d1c6586d4"
        );
        let same_bank = both_bank();
        assert_eq!(
            pair_wav((&same_bank, 7), (&same_bank, 8)).unwrap(),
            expected
        );
        let twin = pair_wav((&left, 7), (&left, 7)).unwrap();
        assert_eq!(twin.len(), 56);
        assert_eq!(&twin[44..], &[1, 0, 1, 0, 2, 0, 2, 0, 3, 0, 3, 0]);
        assert_eq!(
            digest(&twin),
            "50ee9dc4ad2ee9031dcd09b8ea5f4b1803202b4de3240c3b1ab618664bcee84d"
        );
        assert_eq!(
            pair_wav((&left, 0xE000_0007), (&right, 0x8000_0008)).unwrap(),
            expected
        );
        let empty = assemble(1, 0, &[pcm_strand(7, 22050, &[])]);
        let blank = pair_wav((&empty, 7), (&right, 8)).unwrap();
        assert_eq!(blank, wav_header(2, 22050, 0));
        assert_eq!(
            digest(&blank),
            "19bf7a7759b2fc06c90ac5e7f8e77a0511d22f8c13350a6cd5430607c6692f23"
        );
    }

    #[test]
    fn pair_wav_mixed_codecs_and_refusals() {
        // Ап5 – Ап8, Ап10
        let (left, right) = (left_bank(), right_bank());
        let adpcm = assemble(1, 0, &[adpcm_strand(5)]);
        let mixed = pair_wav((&adpcm, 5), (&left, 7)).unwrap();
        assert_eq!(mixed.len(), 56);
        assert_eq!(&mixed[..44], wav_header(2, 32000, 12).as_slice());
        let frames = ["04000100", "06000200", "0d000300"].concat();
        assert_eq!(hex(&mixed[44..]), frames);
        assert_eq!(
            digest(&mixed),
            "64495a21182a50ea998a86ca43db86689ac926e91757198af825e522c4481adf"
        );
        let missing = "В банке нет потока 0X00000009.";
        assert_eq!(refusal(pair_wav((&left, 9), (&right, 8))), missing);
        assert_eq!(refusal(pair_wav((&left, 7), (&right, 9))), missing);
        assert_eq!(refusal(pair_wav((&left, 9), (&right, 9))), missing);
        let mut foreign = b"XXXX".to_vec();
        foreign.resize(32, 7);
        assert_eq!(
            refusal(pair_wav((&foreign, 7), (&right, 8))),
            "Банк зашифрован — это штатный банк игры."
        );
        // Отказ левого виден, даже когда правый банк пуст и тоже отказал бы.
        assert_eq!(
            refusal(pair_wav((&foreign, 7), (&[], 8))),
            "Банк зашифрован — это штатный банк игры."
        );
    }

    #[test]
    fn concurrent_callers_do_not_disturb_each_other() {
        let bytes = std::sync::Arc::new(both_bank());
        let workers: Vec<_> = (0..8)
            .map(|round| {
                let bytes = std::sync::Arc::clone(&bytes);
                std::thread::spawn(move || {
                    let id = 7 + (round % 2) as u32;
                    mono_wav(&bytes, id).unwrap().len()
                })
            })
            .collect();
        for (round, worker) in workers.into_iter().enumerate() {
            let expected = if round % 2 == 0 { 50 } else { 48 };
            assert_eq!(worker.join().unwrap(), expected);
        }
    }
}
