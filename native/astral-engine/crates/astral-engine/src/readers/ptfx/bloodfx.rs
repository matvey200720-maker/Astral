//! Чтение `bloodfx.dat`: версия, четыре таблицы «часть тела × класс оружия» и
//! два списка записей отверстий (входных и выходных).
//!
//! Окну нужны три числа: версия, число обычных входных записей и число обычных
//! выходных. Форма файла проверяется целиком: повреждённый файл — отказ команды,
//! а не пустой редактор. Модуль чистый: диска не касается, ничего не пишет.

use std::{collections::HashMap, fmt};

use crate::{
    error::{EngineError, Result},
    readers::js_text::{is_js_space, js_trim, utf16_len},
};

/// Разбирает текст `bloodfx.dat`.
pub fn parse(input: &str) -> Result<BloodFxSummary> {
    precheck(input)?;
    let summary = read_summary(input)?;
    Ok(summary)
}

/// Описывает публичную структуру по списку «поле => тип»: все поля открыты.
macro_rules! open_record {
    (
        $(#[$meta:meta])*
        $name:ident { $($field:ident => $ty:ty;)+ }
    ) => {
        $(#[$meta])*
        pub struct $name {
            $(pub $field: $ty,)+
        }
    };
}

open_record! {
    /// Что окно получает от файла.
    #[derive(Debug, Clone, PartialEq, Eq)]
    BloodFxSummary {
        version => String;
        entry => usize;
        exit => usize;
        irregular => Vec<IrregularRecord>;
    }
}

open_record! {
    /// Запись «не того вида»: разбор её не роняет, но запоминает.
    #[derive(Debug, Clone, PartialEq, Eq)]
    IrregularRecord {
        section => &'static str;
        id => String;
        line => usize;
        fields => usize;
        problem => String;
    }
}

/// Предел длины текста в единицах UTF-16.
const MAX_UNITS: usize = 4 << 20;

/// Столбцов у обычной записи отверстия.
const HOLE_COLUMNS: usize = 43;

/// Сколько из `SECTION_NAMES` — таблицы.
const TABLE_COUNT: usize = 4;

/// Полное имя секции: общая приставка и хвост.
macro_rules! section {
    ($tail:ident) => {
        concat!("BLOODFX_", stringify!($tail))
    };
}

/// Полные имена известных секций: сначала четыре таблицы (в порядке проверки наличия),
/// затем два списка записей — входные и выходные.
const SECTION_NAMES: [&str; 6] = [
    section!(TABLE_ALIVE),
    section!(TABLE_DEAD),
    section!(TABLE_ALIVE_MP),
    section!(TABLE_DEAD_MP),
    section!(ENTRY_INFO),
    section!(EXIT_INFO),
];

/// Части тела: порядок строк каждой таблицы.
const BODY_PARTS: &str = "BUTTOCKS THIGH_LEFT SHIN_LEFT FOOT_LEFT THIGH_RIGHT SHIN_RIGHT \
FOOT_RIGHT SPINE0 SPINE1 SPINE2 SPINE3 CLAVICLE_LEFT UPPER_ARM_LEFT LOWER_ARM_LEFT HAND_LEFT \
CLAVICLE_RIGHT UPPER_ARM_RIGHT LOWER_ARM_RIGHT HAND_RIGHT NECK HEAD ANIMAL_DEFAULT";

/// Столбец записи, где должно стоять имя эффекта.
fn is_effect_name_column(column: usize) -> bool {
    matches!(column, 34..=37 | 40..=42)
}

/// Причина отказа; `Display` — текст для человека, как его показывает окно.
enum Refusal<'a> {
    Empty,
    Oversized,
    NoVersion,
    Stray,
    Unclosed(&'a str),
    Unknown(&'a str),
    UnexpectedEnd(&'a str),
    Absent(&'a str),
    TableRows {
        label: &'a str,
        found: usize,
    },
    TableRowName {
        label: &'a str,
        at: usize,
        found: &'a str,
        expected: &'a str,
    },
    TableColumns {
        label: &'a str,
        part: &'a str,
        found: usize,
    },
}

impl fmt::Display for Refusal<'_> {
    fn fmt(&self, out: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Refusal::Empty => out.write_str("bloodfx.dat пуст."),
            Refusal::Oversized => out.write_str("bloodfx.dat превышает 4 МБ."),
            Refusal::NoVersion => out.write_str("bloodfx.dat начинается не с номера версии."),
            Refusal::Stray => out.write_str("Данные bloodfx.dat вне секции."),
            Refusal::Unclosed(name) => write!(out, "Секция {name} не закрыта."),
            Refusal::Unknown(name) => write!(out, "Неизвестная секция bloodfx.dat: {name}"),
            Refusal::UnexpectedEnd(name) => write!(out, "Неожиданное завершение секции: {name}"),
            Refusal::Absent(name) => write!(out, "В bloodfx.dat нет секции {name}."),
            Refusal::TableRows { label, found } => {
                write!(out, "{label}: ожидается 22 строк, найдено {found}.")
            }
            Refusal::TableRowName {
                label,
                at,
                found,
                expected,
            } => write!(out, "{label}: строка {at} — {found}, ожидается {expected}."),
            Refusal::TableColumns { label, part, found } => write!(
                out,
                "{label}/{part}: ожидается 24 или 25 колонок, найдено {found}."
            ),
        }
    }
}

impl From<Refusal<'_>> for EngineError {
    fn from(why: Refusal<'_>) -> Self {
        EngineError::invalid_data(why.to_string())
    }
}

type Outcome<'a, T> = std::result::Result<T, Refusal<'a>>;

/// Какая из известных секций: номер в `SECTION_NAMES`.
#[derive(Clone, Copy)]
struct Slot(usize);

impl Slot {
    fn named(name: &str) -> Option<Slot> {
        SECTION_NAMES
            .iter()
            .position(|known| *known == name)
            .map(Slot)
    }

    fn label(self) -> &'static str {
        SECTION_NAMES[self.0]
    }

    /// Таблица это или список записей, и номер в своём наборе.
    fn kind(self) -> Kind {
        match self.0.checked_sub(TABLE_COUNT) {
            None => Kind::Table(self.0),
            Some(n) => Kind::Holes(n),
        }
    }
}

/// Род секции с номером в своём наборе (0 — входные записи, 1 — выходные).
enum Kind {
    Table(usize),
    Holes(usize),
}

/// Какой край секции обозначает строка-маркер.
#[derive(Clone, Copy)]
enum Edge {
    Start,
    End,
}

/// Окончания маркеров; начало проверяется раньше конца.
const EDGES: [(&str, Edge); 2] = [("_START", Edge::Start), ("_END", Edge::End)];

/// `ИМЯ_START` или `ИМЯ_END`: имя непустое и состоит из заглавных ASCII, цифр и `_`.
fn marker(line: &str) -> Option<(Edge, &str)> {
    let well_formed = |stem: &str| {
        !stem.is_empty()
            && stem
                .bytes()
                .all(|b| matches!(b, b'A'..=b'Z' | b'0'..=b'9' | b'_'))
    };
    EDGES
        .iter()
        .find_map(|(suffix, edge)| line.strip_suffix(suffix).map(|stem| (*edge, stem)))
        .filter(|(_, stem)| well_formed(stem))
}

/// Версия: цифры, точка, цифры (только ASCII, с обеих сторон точки).
fn is_version(text: &str) -> bool {
    let lead = text.bytes().take_while(u8::is_ascii_digit).count();
    let fraction = text[lead..].strip_prefix('.');
    lead > 0 && fraction.is_some_and(|f| !f.is_empty() && f.bytes().all(|b| b.is_ascii_digit()))
}

/// Столбец начинается как число: необязательный знак и ASCII-цифра.
fn looks_numeric(column: &str) -> bool {
    match column.as_bytes() {
        [b'+' | b'-', first, ..] | [first, ..] => first.is_ascii_digit(),
        [] => false,
    }
}

/// Значимые строки файла — не пустые и не комментарии, обрезанные по краям, с номерами
/// среди всех строк. Файл режется по LF; один CR на конце строки отбрасывается, а
/// завершающий LF пустой строки не порождает.
fn significant_lines(text: &str) -> impl Iterator<Item = (usize, &str)> {
    text.strip_suffix('\n')
        .unwrap_or(text)
        .split('\n')
        .map(|line| line.strip_suffix('\r').unwrap_or(line))
        .enumerate()
        .map(|(number, line)| (number, js_trim(line)))
        .filter(|(_, line)| !line.is_empty() && !line.starts_with('#'))
}

/// Строка внутри секции: номер строки файла и её столбцы.
struct Row<'t>(usize, Vec<&'t str>);

impl<'t> Row<'t> {
    fn line(&self) -> usize {
        self.0
    }

    fn cells(&self) -> &[&'t str] {
        &self.1
    }

    /// Первый столбец — номер записи или имя части тела.
    fn id(&self) -> &'t str {
        self.1[0]
    }
}

/// Закрытая секция со своими строками.
struct Section<'t>(Slot, Vec<Row<'t>>);

/// Читает следующую секцию целиком; `Ok(None)` — строки кончились между секциями.
fn read_section<'t>(
    items: &mut dyn Iterator<Item = (usize, &'t str)>,
) -> Outcome<'t, Option<Section<'t>>> {
    let Some((_, head)) = items.next() else {
        return Ok(None);
    };
    let name = match marker(head) {
        Some((Edge::Start, name)) => name,
        Some((Edge::End, name)) => return Err(Refusal::UnexpectedEnd(name)),
        None => return Err(Refusal::Stray),
    };
    let slot = Slot::named(name).ok_or(Refusal::Unknown(name))?;

    let mut rows = Vec::new();
    for (line, text) in items {
        match marker(text) {
            // Новая секция, пока эта открыта, — всё равно что конец файла: не закрыта.
            Some((Edge::Start, _)) => break,
            Some((Edge::End, closing)) if closing == name => {
                return Ok(Some(Section(slot, rows)));
            }
            Some((Edge::End, closing)) => return Err(Refusal::UnexpectedEnd(closing)),
            None => {
                let cells = text.split(is_js_space).filter(|c| !c.is_empty());
                rows.push(Row(line, cells.collect()));
            }
        }
    }
    Err(Refusal::Unclosed(name))
}

/// Итог секции записей: сколько обычных и какие нерегулярные.
type HoleVerdict = (usize, Vec<IrregularRecord>);

/// Таблица: 22 строки, имена частей тела по порядку, 24 или 25 столбцов после имени.
fn check_table<'t>(label: &'static str, rows: &[Row<'t>]) -> Outcome<'t, ()> {
    let parts = BODY_PARTS.split(' ');
    if rows.len() != parts.clone().count() {
        return Err(Refusal::TableRows {
            label,
            found: rows.len(),
        });
    }
    for (at, (row, expected)) in rows.iter().zip(parts).enumerate() {
        match (row.id() == expected, row.cells().len() - 1) {
            (false, _) => {
                return Err(Refusal::TableRowName {
                    label,
                    at,
                    found: row.id(),
                    expected,
                })
            }
            (true, 24 | 25) => {}
            (true, found) => {
                return Err(Refusal::TableColumns {
                    label,
                    part: expected,
                    found,
                })
            }
        }
    }
    Ok(())
}

/// Первая сработавшая причина, по которой запись нерегулярна.
fn irregularity(row: &Row, id_counts: &HashMap<&str, usize>) -> Option<String> {
    let checks: [&dyn Fn() -> Option<String>; 3] = [
        &|| {
            let found = row.cells().len();
            (found != HOLE_COLUMNS)
                .then(|| format!("ожидается {HOLE_COLUMNS} полей, найдено {found}"))
        },
        &|| {
            let numeric = |&column: &usize| looks_numeric(row.cells()[column]);
            (0..HOLE_COLUMNS)
                .filter(|column| is_effect_name_column(*column))
                .find(numeric)
                .map(|column| format!("колонка {column} должна содержать имя эффекта"))
        },
        &|| (id_counts[row.id()] > 1).then(|| "номер записи встречается дважды".to_string()),
    ];
    checks.iter().find_map(|check| check())
}

fn judge_holes(label: &'static str, rows: &[Row]) -> HoleVerdict {
    let mut id_counts: HashMap<&str, usize> = HashMap::new();
    for row in rows {
        *id_counts.entry(row.id()).or_default() += 1;
    }
    let odd: Vec<IrregularRecord> = rows
        .iter()
        .filter_map(|row| {
            let problem = irregularity(row, &id_counts)?;
            Some(IrregularRecord {
                section: label,
                id: row.id().to_string(),
                line: row.line(),
                fields: row.cells().len(),
                problem,
            })
        })
        .collect();
    (rows.len() - odd.len(), odd)
}

/// Сводка из прочитанного: все таблицы и обе секции записей обязаны быть.
fn assemble<'t>(
    version: &str,
    tables_seen: [bool; TABLE_COUNT],
    verdicts: [Option<HoleVerdict>; 2],
) -> Outcome<'t, BloodFxSummary> {
    let missing_table = SECTION_NAMES
        .iter()
        .zip(tables_seen)
        .find_map(|(name, seen)| (!seen).then_some(*name));
    if let Some(name) = missing_table {
        return Err(Refusal::Absent(name));
    }
    let [entry, exit] = verdicts;
    let (entry_count, entry_odd) = entry.ok_or(Refusal::Absent(SECTION_NAMES[TABLE_COUNT]))?;
    let (exit_count, exit_odd) = exit.ok_or(Refusal::Absent(SECTION_NAMES[TABLE_COUNT + 1]))?;
    let mut irregular: Vec<IrregularRecord> = entry_odd.into_iter().chain(exit_odd).collect();
    irregular.sort_by_key(|record| record.line);
    Ok(BloodFxSummary {
        version: version.to_string(),
        entry: entry_count,
        exit: exit_count,
        irregular,
    })
}

/// Проверки текста целиком: пустой — раньше слишком длинного.
fn precheck(input: &str) -> Outcome<'static, ()> {
    if js_trim(input).is_empty() {
        Err(Refusal::Empty)
    } else if utf16_len(input) > MAX_UNITS {
        Err(Refusal::Oversized)
    } else {
        Ok(())
    }
}

/// Построчный проход: версия, потом секции одна за другой.
fn read_summary(input: &str) -> Outcome<'_, BloodFxSummary> {
    let mut items = significant_lines(input);
    let version = match items.next() {
        Some((_, line)) if is_version(line) => line,
        Some(_) => return Err(Refusal::NoVersion),
        None => "",
    };

    let mut tables_seen = [false; TABLE_COUNT];
    let mut verdicts: [Option<HoleVerdict>; 2] = [None, None];
    while let Some(Section(slot, rows)) = read_section(&mut items)? {
        match slot.kind() {
            Kind::Table(n) => {
                check_table(slot.label(), &rows)?;
                tables_seen[n] = true;
            }
            Kind::Holes(n) => verdicts[n] = Some(judge_holes(slot.label(), &rows)),
        }
    }
    assemble(version, tables_seen, verdicts)
}

#[cfg(test)]
mod tests;
