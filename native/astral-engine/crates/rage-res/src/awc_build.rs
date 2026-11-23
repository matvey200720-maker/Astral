//! Сборка звукового потока из WAV для звуковых банков: разбор заголовка,
//! кодирование IMA ADPCM, пересчёт формы волны и банк из готовых потоков.

use std::borrow::Cow;

use crate::awc::{
    self, decode_adpcm_as_host as host_decode, NewStream, CHUNK_DATA as DATA,
    CHUNK_FORMAT as FORMAT, CHUNK_PEAK as PEAK, CODEC_ADPCM as ADPCM, CODEC_PCM as PCM,
    FORMAT_WITH_PEAK as PEAK_FORMAT_LEN, IMA_INDEX, IMA_STEP,
};
use crate::error::{Error, Result};

/// Сэмплов на один пик формы волны.
const PEAK_SPAN: usize = 4096;
/// Байт данных в блоке ADPCM после четырёхбайтного заголовка.
const ADPCM_BLOCK_BODY: usize = 2044;
const TOP_STEP_INDEX: i32 = 88;

// ---------------------------------------------------------------------------
// Разбор WAV
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Wav {
    pub sample_rate: u16,
    pub pcm: Vec<u8>,
}

/// Окно на байты WAV: любое чтение за концом — один и тот же отказ.
struct Window<'a>(&'a [u8]);

impl<'a> Window<'a> {
    fn span(&self, at: usize, len: usize) -> Result<&'a [u8]> {
        at.checked_add(len)
            .and_then(|end| self.0.get(at..end))
            .ok_or_else(|| Error::broken("WAV обрывается."))
    }

    /// Целое без знака из `width` байт (младший первым).
    fn uint(&self, at: usize, width: usize) -> Result<u64> {
        let raw = self.span(at, width)?;
        Ok(raw.iter().rev().fold(0, |acc, &byte| acc << 8 | u64::from(byte)))
    }
}

/// Поля заголовка, которые читаются по фиксированным местам: (смещение, ширина).
/// Порядок — длина блока формата, код формата, число каналов, частота.
const HEADER_FIELDS: [(usize, usize); 4] = [(16, 4), (20, 2), (22, 2), (24, 4)];

/// Что требуется от прочитанных полей: (номер поля, нужное значение, отказ).
const HEADER_RULES: [(usize, u64, &str); 2] = [
    (1, 1, "Only PCM format .wav files supported!"),
    (2, 1, "Only mono .wav files supported!"),
];

pub fn parse_wav(bytes: &[u8]) -> Result<Wav> {
    let window = Window(bytes);
    // Все чтения идут раньше проверок: обрыв файла важнее неподходящего формата.
    let mut head = [0u64; 4];
    for (slot, (at, width)) in head.iter_mut().zip(HEADER_FIELDS) {
        *slot = window.uint(at, width)?;
    }
    let data_tag = if head[0] == 20 { 40 } else { 36 };
    let declared = window.uint(data_tag + 4, 4)? as u32 as i32;
    let pcm = window.span(data_tag + 8, declared.max(0) as usize)?.to_vec();
    if let Some(&(_, _, refusal)) = HEADER_RULES.iter().find(|(field, want, _)| head[*field] != *want) {
        return Err(Error::broken(refusal));
    }
    Ok(Wav { sample_rate: head[3] as u16, pcm })
}

// ---------------------------------------------------------------------------
// IMA ADPCM
// ---------------------------------------------------------------------------

/// Кодировщик IMA: индекс шага и текущее предсказание.
#[derive(Default)]
struct Coder {
    index: i32,
    level: i32,
}

fn sample_at(raw: &[u8], at: usize) -> i32 {
    i32::from(i16::from_le_bytes(raw[at..at + 2].try_into().expect("пара байт")))
}

impl Coder {
    /// Заголовок блока: индекс шага и предсказание, оба как i16.
    fn header(&self) -> [u8; 4] {
        let [i0, i1] = (self.index as i16).to_le_bytes();
        let [l0, l1] = (self.level as i16).to_le_bytes();
        [i0, i1, l0, l1]
    }

    /// Четыре бита кода для одного сэмпла; состояние идёт дальше.
    fn nibble(&mut self, sample: i32) -> u8 {
        let top = IMA_STEP[self.index as usize];
        // Величина кодируется тремя битами: шаг, полшага, четверть шага.
        let (_, _, delta, bits) = [4u8, 2, 1].into_iter().fold(
            ((sample - self.level).abs(), top, top >> 3, 0u8),
            |(gap, step, delta, bits), bit| {
                if gap > step {
                    (gap - step, step >> 1, delta + step, bits | bit)
                } else {
                    (gap, step >> 1, delta, bits)
                }
            },
        );
        let below = sample < self.level;
        self.level = (self.level + if below { -delta } else { delta })
            .clamp(i32::from(i16::MIN), i32::from(i16::MAX));
        self.index = (self.index + IMA_INDEX[usize::from(bits)]).clamp(0, TOP_STEP_INDEX);
        bits | if below { 8 } else { 0 }
    }

    /// Один байт данных из четырёх входных: младший полубайт — первый сэмпл.
    fn byte(&mut self, quad: &[u8]) -> u8 {
        let first = self.nibble(sample_at(quad, 0));
        let second = self.nibble(sample_at(quad, 2));
        first | second << 4
    }
}

pub fn encode_adpcm(pcm: &[u8], sample_count: i64) -> Result<Vec<u8>> {
    let limit = pcm.len() / 4;
    let mut quads = pcm.chunks_exact(4);
    let mut coder = Coder::default();
    let mut out: Vec<u8> = Vec::with_capacity(limit);
    let mut left = sample_count;
    while out.len() < limit && left > 0 {
        if limit - out.len() < 4 {
            return Err(Error::broken("Выход ADPCM короче заголовка блока."));
        }
        out.extend_from_slice(&coder.header());
        let room = (limit - out.len()).min(ADPCM_BLOCK_BODY);
        for _ in 0..room {
            if left <= 0 {
                break;
            }
            let quad = quads.next().ok_or_else(|| Error::broken("WAV обрывается."))?;
            out.push(coder.byte(quad));
            left -= 2;
        }
    }
    out.resize(limit, 0);
    Ok(out)
}

// ---------------------------------------------------------------------------
// Пики формы волны
// ---------------------------------------------------------------------------

/// Значения пиков по звуку: сэмпл с номером `i` читается по адресу `2i`, а последний
/// сэмпл данных и всё за ними идут нулём.
struct Levels<'a> {
    sound: &'a [u8],
}

impl Levels<'_> {
    fn readable(&self) -> usize {
        self.sound.len().saturating_sub(1) / 2
    }

    /// Наибольшее значение в окне из 4096 сэмплов; за данными окно нулевое.
    fn window(&self, n: usize) -> u16 {
        let from = n.saturating_mul(PEAK_SPAN);
        let to = from.saturating_add(PEAK_SPAN).min(self.readable());
        (from..to)
            .map(|i| (sample_at(self.sound, 2 * i).unsigned_abs() * 2).min(65535) as u16)
            .max()
            .unwrap_or(0)
    }
}

/// Замер пиков потока: где лежит формат, значение первого окна и список остальных.
struct Measured {
    format_at: usize,
    head: u16,
    tail: Vec<u8>,
}

impl Measured {
    /// `None`, если пересчитывать нечего (нет формата или у него нет слова пика).
    fn of(stream: &NewStream) -> Result<Option<Self>> {
        let found = stream.chunks.iter().enumerate().find(|(_, (kind, _))| *kind == FORMAT);
        let Some((format_at, (_, format))) = found else { return Ok(None) };
        if format.len() < PEAK_FORMAT_LEN {
            return Ok(None);
        }
        let raw = stream
            .chunks
            .iter()
            .find(|(kind, _)| *kind == DATA)
            .map(|(_, body)| body.as_slice())
            .ok_or_else(|| Error::broken("AWC: у потока нет данных для пика."))?;
        let samples = u32::from_le_bytes(format[..4].try_into().expect("четыре байта"));
        let sound = match format[19] {
            ADPCM => Cow::Owned(
                host_decode(raw, samples)
                    .ok_or_else(|| Error::broken("AWC: оборван заголовок блока ADPCM."))?,
            ),
            _ => Cow::Borrowed(raw),
        };
        let windows = (i64::from(samples) - PEAK_SPAN as i64) / PEAK_SPAN as i64;
        if windows < 0 {
            return Err(Error::broken("AWC: пустой поток с пиком."));
        }
        let levels = Levels { sound: &sound };
        Ok(Some(Measured {
            format_at,
            head: levels.window(0),
            tail: (1..=windows as usize).flat_map(|n| levels.window(n).to_le_bytes()).collect(),
        }))
    }

    fn store(self, stream: &mut NewStream) {
        let word = &mut stream.chunks[self.format_at].1[20..24];
        let old = u32::from_le_bytes((&*word).try_into().expect("слово пика"));
        word.copy_from_slice(&((old & 0xFFFF_0000) | u32::from(self.head)).to_le_bytes());
        put_chunk(stream, PEAK, (!self.tail.is_empty()).then_some(self.tail));
    }
}

/// Ставит чанк: меняет первый такой же, добавляет в конец или убирает, если нагрузки нет.
fn put_chunk(stream: &mut NewStream, kind: u8, body: Option<Vec<u8>>) {
    let slot = stream.chunks.iter().position(|(k, _)| *k == kind);
    if let Some(body) = body {
        match slot {
            Some(i) => stream.chunks[i].1 = body,
            None => stream.chunks.push((kind, body)),
        }
    } else if let Some(i) = slot {
        stream.chunks.remove(i);
    }
}

pub fn apply_peaks(stream: &mut NewStream) -> Result<()> {
    if let Some(measured) = Measured::of(stream)? {
        measured.store(stream);
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Поток из WAV
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StreamTemplate {
    pub id: u32,
    pub chunks: Vec<u8>,
    pub codec: u8,
    pub samples: u32,
    pub loop_point: i32,
    pub play_begin: u8,
    pub play_end: u16,
    pub loop_begin: u16,
    pub loop_end: u16,
    pub headroom: i16,
    pub peak_unk: Option<u16>,
}

impl StreamTemplate {
    /// Чанк формата: поля шаблона, частота из WAV, при `peak_unk` ещё слово пика (нулевое).
    fn format_bytes(&self, rate: u16) -> Vec<u8> {
        let peak_word = &[0u8; 4][..if self.peak_unk.is_some() { 4 } else { 0 }];
        let fields: [&[u8]; 9] = [
            &self.samples.to_le_bytes(),
            &self.loop_point.to_le_bytes(),
            &rate.to_le_bytes(),
            &self.headroom.to_le_bytes(),
            &self.loop_begin.to_le_bytes(),
            &self.loop_end.to_le_bytes(),
            &self.play_end.to_le_bytes(),
            &[self.play_begin, self.codec],
            peak_word,
        ];
        fields.concat()
    }
}

/// Заготовка потока по шаблону: звук и формат готовы, чанки собираются по порядку шаблона.
struct Kit<'t> {
    template: &'t StreamTemplate,
    sound: Vec<u8>,
    format: Vec<u8>,
}

impl<'t> Kit<'t> {
    fn prepare(template: &'t StreamTemplate, wav: &[u8]) -> Result<Self> {
        if ![PCM, ADPCM].contains(&template.codec) {
            return Err(Error::broken("AWC: кодек потока пока на хосте."));
        }
        let Wav { sample_rate, pcm } = parse_wav(wav)?;
        let sound = match template.codec {
            ADPCM => encode_adpcm(&pcm, pcm.len() as i64 * 2)?,
            _ => pcm,
        };
        Ok(Kit { template, sound, format: template.format_bytes(sample_rate) })
    }

    fn chunk(&self, kind: u8) -> Result<(u8, Vec<u8>)> {
        let body = match kind {
            DATA => self.sound.clone(),
            FORMAT => self.format.clone(),
            PEAK => Vec::new(),
            other => return Err(Error::broken(format!("AWC: чанк {other:#x} пока на хосте."))),
        };
        Ok((kind, body))
    }

    fn finish(self) -> Result<NewStream> {
        let chunks = self.template.chunks.iter().map(|&kind| self.chunk(kind)).collect::<Result<Vec<_>>>()?;
        let mut stream = NewStream { id: self.template.id, chunks };
        apply_peaks(&mut stream)?;
        Ok(stream)
    }
}

pub fn stream_from_wav(template: &StreamTemplate, wav: &[u8]) -> Result<NewStream> {
    Kit::prepare(template, wav)?.finish()
}

// ---------------------------------------------------------------------------
// Банк из потоков
// ---------------------------------------------------------------------------

pub fn bank_of_stream(version: u16, chunk_indices: bool, stream: &NewStream) -> Result<Vec<u8>> {
    bank_of_streams(version, chunk_indices, std::slice::from_ref(stream))
}

pub fn bank_of_streams(version: u16, chunk_indices: bool, streams: &[NewStream]) -> Result<Vec<u8>> {
    let mut ordered = streams.to_vec();
    ordered.sort_by_key(|s| s.id);
    let total = ordered.len();
    ordered.dedup_by_key(|s| s.id);
    if ordered.len() != total {
        return Err(Error::broken("AWC: дорожка повторяется в слое — пока на хосте."));
    }
    awc::encode(version, 0xFF00 | u16::from(chunk_indices), &ordered)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn header(rate: u32, channels: i16, kind: i16, body: &[u8]) -> Vec<u8> {
        let mut out = b"RIFF\0\0\0\0WAVEfmt ".to_vec();
        out.extend_from_slice(&16i32.to_le_bytes());
        out.extend_from_slice(&kind.to_le_bytes());
        out.extend_from_slice(&channels.to_le_bytes());
        out.extend_from_slice(&rate.to_le_bytes());
        out.extend_from_slice(&[0; 8]);
        out.extend_from_slice(b"data");
        out.extend_from_slice(&(body.len() as i32).to_le_bytes());
        out.extend_from_slice(body);
        out
    }

    fn template(codec: u8, chunks: &[u8], samples: u32, peak: Option<u16>) -> StreamTemplate {
        StreamTemplate {
            id: 0x0339_2bec,
            chunks: chunks.to_vec(),
            codec,
            samples,
            loop_point: 3,
            play_begin: 9,
            play_end: 0x1234,
            loop_begin: 0x0102,
            loop_end: 0x0304,
            headroom: -77,
            peak_unk: peak,
        }
    }

    #[test]
    fn wav_reader_follows_fixed_offsets() {
        let ok = parse_wav(&header(96000, 1, 1, &[1, 2, 3])).unwrap();
        assert_eq!((ok.sample_rate, ok.pcm), (30464, vec![1, 2, 3]));
        assert_eq!(
            parse_wav(&header(8000, 1, 3, &[0; 4])).unwrap_err().message,
            "Only PCM format .wav files supported!"
        );
        assert_eq!(
            parse_wav(&header(8000, 2, 3, &[0; 4])).unwrap_err().message,
            "Only PCM format .wav files supported!"
        );
        assert_eq!(
            parse_wav(&header(8000, 2, 1, &[0; 4])).unwrap_err().message,
            "Only mono .wav files supported!"
        );
        let cut = &header(8000, 1, 1, &[0; 4])[..47];
        assert_eq!(parse_wav(cut).unwrap_err().message, "WAV обрывается.");
    }

    #[test]
    fn adpcm_output_is_a_quarter_of_the_input_with_headers() {
        assert_eq!(encode_adpcm(&[0; 3], 99).unwrap(), Vec::<u8>::new());
        assert_eq!(encode_adpcm(&[0; 16], 99).unwrap(), vec![0; 4]);
        assert_eq!(
            encode_adpcm(&[0; 12], 99).unwrap_err().message,
            "Выход ADPCM короче заголовка блока."
        );
        assert_eq!(encode_adpcm(&[0; 80], -5).unwrap(), vec![0; 20]);
        let loud = [0xff, 0x7f].repeat(40);
        assert_eq!(&encode_adpcm(&loud, 1).unwrap()[..6], &[0, 0, 0, 0, 0x77, 0]);
    }

    #[test]
    fn peaks_take_blocks_after_the_first_and_drop_empty_lists() {
        let tone: Vec<u8> = (0..20_000i32).flat_map(|i| ((i % 100) as i16).to_le_bytes()).collect();
        let mut format = vec![0u8; 24];
        format[..4].copy_from_slice(&9000u32.to_le_bytes());
        format[20..24].copy_from_slice(&[0, 0, 0xaa, 0xbb]);
        let mut stream = NewStream {
            id: 1,
            chunks: vec![(FORMAT, format.clone()), (DATA, tone.clone())],
        };
        apply_peaks(&mut stream).unwrap();
        assert_eq!(&stream.chunks[0].1[20..24], &[198, 0, 0xaa, 0xbb]);
        assert_eq!(stream.chunks[2], (PEAK, vec![198, 0]));
        stream.chunks[0].1[..4].copy_from_slice(&100u32.to_le_bytes());
        apply_peaks(&mut stream).unwrap();
        assert!(stream.chunks.iter().all(|(kind, _)| *kind != PEAK));
        stream.chunks[0].1[..4].copy_from_slice(&0u32.to_le_bytes());
        assert_eq!(apply_peaks(&mut stream).unwrap_err().message, "AWC: пустой поток с пиком.");
        stream.chunks.pop();
        assert_eq!(
            apply_peaks(&mut stream).unwrap_err().message,
            "AWC: у потока нет данных для пика."
        );
    }

    #[test]
    fn stream_takes_rate_from_wav_and_the_rest_from_the_template() {
        let wav = header(11025, 1, 1, &[1, 0, 2, 0, 3, 0, 4, 0]);
        let stream = stream_from_wav(&template(0, &[0xFA, 0x55], 4, None), &wav).unwrap();
        assert_eq!(
            stream.chunks[0].1,
            [4, 0, 0, 0, 3, 0, 0, 0, 0x11, 0x2b, 0xb3, 0xff, 2, 1, 4, 3, 0x34, 0x12, 9, 0]
        );
        assert_eq!(stream.chunks[1].1, [1, 0, 2, 0, 3, 0, 4, 0]);
        let odd = template(0, &[0x68], 4, None);
        assert_eq!(stream_from_wav(&odd, &wav).unwrap_err().message, "AWC: чанк 0x68 пока на хосте.");
        let codec = template(3, &[0x55], 4, None);
        assert_eq!(stream_from_wav(&codec, &[]).unwrap_err().message, "AWC: кодек потока пока на хосте.");
    }

    #[test]
    fn bank_sorts_streams_and_refuses_repeats() {
        let one = |id| NewStream { id, chunks: vec![(DATA, vec![id as u8])] };
        let sorted = bank_of_streams(255, false, &[one(3), one(1)]).unwrap();
        let direct = awc::encode(255, 0xFF00, &[one(1), one(3)]).unwrap();
        assert_eq!(sorted, direct);
        let err = bank_of_streams(255, true, &[one(2), one(2)]).unwrap_err();
        assert_eq!(err.message, "AWC: дорожка повторяется в слое — пока на хосте.");
        assert_eq!(bank_of_streams(1, false, &[]).unwrap().len(), 16);
    }
}
