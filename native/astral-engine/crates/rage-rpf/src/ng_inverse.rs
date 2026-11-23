// Обратный раунд шифра NG, выведенный из таблиц расшифровки.
//
// Раунд расшифровки собирает каждое из четырёх слов состояния из четырёх
// байт прежнего состояния: слово = ключ ^ T[p0][b0] ^ T[p1][b1] ^ T[p2][b2] ^ T[p3][b3],
// где T[p] — таблица положения p на 256 значений. Положения четырёх слов раунда
// не пересекаются, поэтому слова обращаются по отдельности.
//
// У каждой таблицы разности `T[p][b] ^ T[p][0]` лежат в подпространстве GF(2)
// размерности 8 (это проверяется при построении), и все 256 значений различны,
// то есть таблица — взаимно однозначное отображение байта на это подпространство.
// Подпространства четырёх таблиц слова независимы, их сумма — всё GF(2)^32
// (проверяется обратимостью матрицы 32 × 32). Поэтому слово без постоянной части
// раскладывается на четыре независимые координаты по восемь бит, а байт
// находится по таблице «координаты → байт» на 256 значений.
//
// Построение не даёт ничего, кроме таблиц самого набора: ни ключей, ни
// посторонних таблиц здесь нет, а по размеру обратный раунд — около 350 КиБ.

/// Положения входного блока, питающие каждое из четырёх слов раунда.
pub(crate) type Lanes = [[usize; 4]; 4];

/// Слов состояния и положений в блоке.
const STATE_WORDS: usize = 4;
const LANES_PER_WORD: usize = 4;
/// Значений байта.
const BYTE_VALUES: usize = 256;
/// Размерность подпространства одной таблицы.
const SPAN_DIM: usize = 8;

/// Обратное преобразование одного слова раунда.
pub(crate) struct WordInverse {
    /// XOR нулевых значений четырёх таблиц слова.
    base: u32,
    /// Разложение слова на координаты: по четыре байта, XOR слагаемых.
    unmix: [[u32; BYTE_VALUES]; 4],
    /// Координаты → байт, для каждой из четырёх таблиц.
    bytes: [[u8; BYTE_VALUES]; 4],
}

/// Обратные раунды целиком: по четыре слова на раунд, раундов столько же,
/// сколько в таблицах.
pub(crate) struct Inverse {
    words: Vec<WordInverse>,
    schedule: Vec<Lanes>,
}

/// Четность числа единичных бит.
#[inline(always)]
fn parity(value: u32) -> u32 {
    value.count_ones() & 1
}

/// Обратная матрица над GF(2). Матрица задана столбцами: образ бита `j` — `columns[j]`.
/// Ответ — строки обратной матрицы: бит `j` решения равен чётности `rows[j] & образ`.
fn invert_columns(columns: &[u32; 32]) -> Option<[u32; 32]> {
    let mut rows = [0u64; 32];
    for (bit, row) in rows.iter_mut().enumerate() {
        let mut mask = 0u32;
        for (column, &image) in columns.iter().enumerate() {
            mask |= ((image >> bit) & 1) << column;
        }
        *row = u64::from(mask) | (1u64 << (32 + bit));
    }
    for column in 0..32 {
        let pivot = (column..32).find(|&row| (rows[row] >> column) & 1 == 1)?;
        rows.swap(column, pivot);
        let keep = rows[column];
        for (at, row) in rows.iter_mut().enumerate() {
            if at != column && (*row >> column) & 1 == 1 {
                *row ^= keep;
            }
        }
    }
    Some(std::array::from_fn(|row| (rows[row] >> 32) as u32))
}

/// Восемь независимых разностей таблицы, в порядке байтов. `None`, если ранг
/// разностей не восемь.
fn independent_differences(table: &[u32]) -> Option<[u32; SPAN_DIM]> {
    let mut reduced = [0u32; 32];
    let mut chosen = [0u32; SPAN_DIM];
    let mut count = 0;
    for byte in 1..BYTE_VALUES {
        let difference = table[byte] ^ table[0];
        let mut rest = difference;
        for bit in (0..32).rev() {
            if (rest >> bit) & 1 == 0 {
                continue;
            }
            if reduced[bit] == 0 {
                if count == SPAN_DIM {
                    return None;
                }
                reduced[bit] = rest;
                chosen[count] = difference;
                count += 1;
                break;
            }
            rest ^= reduced[bit];
        }
    }
    (count == SPAN_DIM).then_some(chosen)
}

impl WordInverse {
    /// Строит обратное преобразование слова по четырём таблицам положений.
    fn build(tables: &[u32], lanes: &[usize; LANES_PER_WORD]) -> Result<Self, &'static str> {
        let mut base = 0u32;
        let mut columns = [0u32; 32];
        for (lane, &position) in lanes.iter().enumerate() {
            let table = &tables[position * BYTE_VALUES..][..BYTE_VALUES];
            base ^= table[0];
            let chosen = independent_differences(table)
                .ok_or("a table of the set does not span a space of eight dimensions")?;
            columns[lane * SPAN_DIM..][..SPAN_DIM].copy_from_slice(&chosen);
        }
        let rows = invert_columns(&columns)
            .ok_or("the four tables of a word do not cover the whole word")?;

        // Образ каждого бита слова в координатах, затем таблицы по байтам слова.
        let image: [u32; 32] = std::array::from_fn(|bit| {
            (0..32).fold(0u32, |acc, row| {
                acc | (parity(rows[row] & (1 << bit)) << row)
            })
        });
        let mut unmix = [[0u32; BYTE_VALUES]; 4];
        for (part, table) in unmix.iter_mut().enumerate() {
            for value in 1..BYTE_VALUES {
                let lowest = value.trailing_zeros() as usize;
                table[value] = table[value & (value - 1)] ^ image[part * 8 + lowest];
            }
        }
        let split = |x: u32| -> u32 {
            unmix[0][(x & 0xff) as usize]
                ^ unmix[1][((x >> 8) & 0xff) as usize]
                ^ unmix[2][((x >> 16) & 0xff) as usize]
                ^ unmix[3][(x >> 24) as usize]
        };

        let mut bytes = [[0u8; BYTE_VALUES]; 4];
        for (lane, &position) in lanes.iter().enumerate() {
            let table = &tables[position * BYTE_VALUES..][..BYTE_VALUES];
            let mut seen = [false; BYTE_VALUES];
            for byte in 0..BYTE_VALUES {
                let coordinates = split(table[byte] ^ table[0]);
                // разность таблицы лежит только в своём подпространстве
                if coordinates & !(0xffu32 << (lane * 8)) != 0 {
                    return Err("the tables of a word overlap");
                }
                let coordinate = ((coordinates >> (lane * 8)) & 0xff) as usize;
                if std::mem::replace(&mut seen[coordinate], true) {
                    return Err("a table of the set maps two bytes to one value");
                }
                bytes[lane][coordinate] = byte as u8;
            }
        }
        Ok(WordInverse { base, unmix, bytes })
    }

    /// Четыре байта прежнего состояния по новому слову без ключа.
    #[inline(always)]
    fn bytes_of(&self, word: u32) -> [u8; 4] {
        let x = word ^ self.base;
        let c = self.unmix[0][(x & 0xff) as usize]
            ^ self.unmix[1][((x >> 8) & 0xff) as usize]
            ^ self.unmix[2][((x >> 16) & 0xff) as usize]
            ^ self.unmix[3][(x >> 24) as usize];
        [
            self.bytes[0][(c & 0xff) as usize],
            self.bytes[1][((c >> 8) & 0xff) as usize],
            self.bytes[2][((c >> 16) & 0xff) as usize],
            self.bytes[3][(c >> 24) as usize],
        ]
    }
}

impl Inverse {
    /// Строит обратные раунды по таблицам расшифровки (раунд за раундом подряд,
    /// по 16 положений на 256 значений) и расписанию положений.
    pub(crate) fn build(
        tables: &[u32],
        schedule: &[&Lanes],
        round_words: usize,
    ) -> Result<Self, &'static str> {
        let mut words = Vec::with_capacity(schedule.len() * STATE_WORDS);
        for (round, lanes) in schedule.iter().enumerate() {
            let round_tables = &tables[round * round_words..][..round_words];
            for word_lanes in lanes.iter() {
                words.push(WordInverse::build(round_tables, word_lanes)?);
            }
        }
        Ok(Inverse {
            words,
            schedule: schedule.iter().map(|&lanes| *lanes).collect(),
        })
    }

    /// Один блок в 16 байт проходит раунды в обратном порядке. `key` — слова
    /// ключа по четыре на раунд.
    pub(crate) fn block(&self, key: &[u32], block: &mut [u8]) {
        let mut state = [0u32; STATE_WORDS];
        for (word, quad) in state.iter_mut().zip(block.chunks_exact(4)) {
            *word = u32::from_le_bytes([quad[0], quad[1], quad[2], quad[3]]);
        }
        for round in (0..self.schedule.len()).rev() {
            let lanes = &self.schedule[round];
            let mut old = [0u8; 16];
            for (word, positions) in lanes.iter().enumerate() {
                let at = round * STATE_WORDS + word;
                let bytes = self.words[at].bytes_of(state[word] ^ key[at]);
                for (&position, byte) in positions.iter().zip(bytes) {
                    old[position] = byte;
                }
            }
            for (word, quad) in state.iter_mut().zip(old.chunks_exact(4)) {
                *word = u32::from_le_bytes([quad[0], quad[1], quad[2], quad[3]]);
            }
        }
        for (quad, word) in block.chunks_exact_mut(4).zip(state) {
            quad.copy_from_slice(&word.to_le_bytes());
        }
    }
}
