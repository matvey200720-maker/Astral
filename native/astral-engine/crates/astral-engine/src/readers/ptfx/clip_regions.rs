//! Таблица сеток кадров листов эффектов (`ptxclipregions.dat`).
//!
//! От таблицы окну нужно лишь число столбцов и строк кадров на каждом листе:
//! по нему из листа вырезается кадр превью. Любое расхождение формата — отказ
//! без причины: вызывающий тогда считает, что сеток нет. Модуль чистый.

use std::collections::{BTreeMap, BTreeSet};

/// Файл длиннее этого не разбирается.
pub const MAX_BYTES: usize = 1024 * 1024;

/// Целое без знака из одних ASCII-цифр (хотя бы одна); не влезло в `usize` — `None`.
fn whole_number(text: &str) -> Option<usize> {
    if text.is_empty() {
        return None;
    }
    text.bytes().try_fold(0usize, |acc, byte| {
        let digit = byte.checked_sub(b'0').filter(|d| *d < 10)?;
        acc.checked_mul(10)?.checked_add(usize::from(digit))
    })
}

/// Сторона сетки: целое, но не ноль.
fn side(text: &str) -> Option<usize> {
    whole_number(text).filter(|n| *n > 0)
}

/// Число прямоугольника кадра: любое конечное в записи Rust для `f64`.
fn finite(text: &str) -> bool {
    matches!(text.parse::<f64>(), Ok(x) if x.is_finite())
}

/// Строки листов, накопленные в ходе разбора: словарь и счётчик кадров.
#[derive(Default)]
struct Sheets {
    by_name: BTreeMap<String, Grid>,
    frames: u64,
}

impl Sheets {
    /// Принимает строку листа: имя, столбцы, строки и ровно `столбцы·строки·4` чисел.
    fn admit(mut self, line: &str) -> Option<Sheets> {
        let mut tokens = line.split_whitespace();
        let name = tokens.next()?;
        let grid = Grid {
            columns: side(tokens.next()?)?,
            rows: side(tokens.next()?)?,
        };
        // Столбцы × строки × 4 не помещаются в число — строка отвергается, а не
        // заворачивается в малое «обещанное» число.
        let cells = (grid.columns as u64).checked_mul(grid.rows as u64)?;
        let promised = cells.checked_mul(4)?;
        let given = tokens.try_fold(0u64, |count, token| finite(token).then_some(count + 1))?;
        if given != promised {
            return None;
        }
        self.frames = self.frames.checked_add(cells)?;
        self.by_name.insert(name.to_ascii_lowercase(), grid);
        Some(self)
    }
}

/// Сколько кадров по горизонтали и вертикали на листе.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Grid {
    pub columns: usize,
    pub rows: usize,
}

/// Сетка листа по имени (нижний регистр); листа нет в таблице — один кадр.
pub(super) fn grid_for(grids: &BTreeMap<String, Grid>, name: &str) -> Grid {
    match grids.get(&name.to_lowercase()) {
        Some(grid) => *grid,
        None => Grid {
            columns: 1,
            rows: 1,
        },
    }
}

/// Кадровый лист Astral: в таблице у него должна быть строка. Имя уже в нижнем регистре. Картинки в один кадр
/// (`astral_impact_pic_*`) строки не требуют — игра и так рисует их целиком.
fn framed_astral_sheet(lower: &str) -> bool {
    let Some(rest) = lower.strip_prefix("astral_impact_") else {
        return false;
    };
    rest == "blood_spray"
        || ["sheet_", "tex_"]
            .iter()
            .any(|prefix| rest.strip_prefix(prefix).is_some_and(|tail| !tail.is_empty()))
}

/// Имена кадровых листов ядра, которых нет в таблице (`missingClipRows` прежнего читателя). Нет таблицы — пусто:
/// без неё сказать нечего. Имя без повтора, порядок по возрастанию — как у `.sort()` для латиницы.
pub fn missing_rows<'a>(
    names: impl IntoIterator<Item = &'a str>,
    grids: &BTreeMap<String, Grid>,
) -> Vec<String> {
    if grids.is_empty() {
        return Vec::new();
    }
    names
        .into_iter()
        .collect::<BTreeSet<&str>>()
        .into_iter()
        .filter(|name| {
            let lower = name.to_lowercase();
            framed_astral_sheet(&lower) && !grids.contains_key(&lower)
        })
        .map(str::to_owned)
        .collect()
}

/// Разбирает таблицу в словарь «имя листа (нижний регистр) → сетка».
pub fn parse(bytes: &[u8]) -> Option<BTreeMap<String, Grid>> {
    (1..=MAX_BYTES).contains(&bytes.len()).then_some(())?;
    // Latin-1: байт — знак с тем же кодом.
    let text: String = bytes.iter().copied().map(char::from).collect();
    // Перевод строки один на весь файл: CRLF, если пара встречается, иначе LF.
    let separator = ["\r\n", "\n"]
        .into_iter()
        .find(|candidate| text.contains(candidate))
        .unwrap_or("\n");
    let mut lines = text.split_terminator(separator);

    let declared_sheets = whole_number(lines.next()?.trim())?;
    let declared_frames = whole_number(lines.next()?.trim())?;
    let table = lines.try_fold(Sheets::default(), Sheets::admit)?;

    let counts_agree =
        table.by_name.len() == declared_sheets && table.frames == declared_frames as u64;
    counts_agree.then_some(table.by_name)
}

#[cfg(test)]
mod tests;
