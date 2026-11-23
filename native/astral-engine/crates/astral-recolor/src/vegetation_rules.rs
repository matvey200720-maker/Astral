//! Правила имён листов растительности — те же, что у `apps/desktop/src/vegetation-build.js`: какой лист дальнего плана
//! — атлас земли (`isDistantAtlas`) и какое имя листа вблизи у уменьшенной копии (`distantSheetBase`).
//!
//! В JS это регулярные выражения (`ATLAS`, `BLOCK_ATLAS`, `DISTANT_SKIP`, `SHEET_SUFFIX`). Здесь они разложены
//! по условиям руками: движку не нужен разбор выражений, а имя листа проверяется на каждый лист каждого словаря.
//! Имена — ASCII строчными (приложение отдаёт движку только такие, остальные идут запасным путём).

/// Начало имени, при котором лист — не земля (`^(slod_prop_|slod\d?_veg_|prop_|test_tree)`).
fn skip_by_start(name: &str) -> bool {
    if name.starts_with("slod_prop_") || name.starts_with("prop_") || name.starts_with("test_tree") {
        return true;
    }
    /* `slod\d?_veg_`: слово slod, не больше одной цифры, `_veg_`. */
    let Some(rest) = name.strip_prefix("slod") else { return false };
    let rest = match rest.as_bytes().first() {
        Some(digit) if digit.is_ascii_digit() => &rest[1..],
        _ => rest,
    };
    rest.starts_with("_veg_")
}

/// Конец имени (`_pal$`, `_lut$`, `_n$`, `_nm$`, `_s$`, `_h$`).
const SKIP_ENDS: [&str; 6] = ["_pal", "_lut", "_n", "_nm", "_s", "_h"];

/// Что угодно внутри имени (остальные слова `DISTANT_SKIP`).
const SKIP_PARTS: &[&str] = &[
    "_pal_", "mask", "msk", "_n_", "_nrm", "normal", "_spec", "_height", "_bump", "emissive", "window", "night", "roof", "wall", "build", "_bld", "door",
    "fenc", "fnc", "rail", "bridge", "concrete", "tarmac", "asphalt", "road", "runway", "parking", "pavement", "kerb", "metal", "wood", "brick", "tile",
    "glass", "sign", "billb", "water", "river", "sea_", "_sea", "seabed", "_uw", "pool", "beach", "prison", "hangar", "helipad", "graffiti", "decal",
];

fn contains_any(name: &str, parts: &[&str]) -> bool {
    parts.iter().any(|part| name.contains(part))
}

/// `DISTANT_SKIP.test(name)`.
fn skipped(name: &str) -> bool {
    skip_by_start(name) || SKIP_ENDS.iter().any(|end| name.ends_with(end)) || contains_any(name, SKIP_PARTS)
}

/// `ATLAS.test(name)`: `(slod|superlod|xref|_lod\d*_s\d+[a-z]?$)`.
fn atlas_name(name: &str) -> bool {
    if name.contains("slod") || name.contains("superlod") || name.contains("xref") {
        return true;
    }
    /* `_lod\d*_s\d+[a-z]?$` с любого места имени. */
    name.match_indices("_lod").any(|(at, found)| {
        let rest = &name[at + found.len()..];
        let rest = rest.trim_start_matches(|c: char| c.is_ascii_digit());
        let Some(rest) = rest.strip_prefix("_s") else { return false };
        let digits = rest.len() - rest.trim_start_matches(|c: char| c.is_ascii_digit()).len();
        if digits == 0 {
            return false;
        }
        let tail = &rest[digits..];
        tail.is_empty() || (tail.len() == 1 && tail.as_bytes()[0].is_ascii_lowercase())
    })
}

/// Квартал загорода или города: `^(cs|ch|bh|dt|hw|id|kt|po|sc|sm|ss|sp|vb|ap)\d+[a-z]?_(\d+[a-z]?$|.*(ground|terrain|land|grnd))`.
fn block_atlas_name(name: &str) -> bool {
    const PREFIXES: [&str; 14] = ["cs", "ch", "bh", "dt", "hw", "id", "kt", "po", "sc", "sm", "ss", "sp", "vb", "ap"];
    let Some(rest) = PREFIXES.iter().find_map(|prefix| name.strip_prefix(prefix)) else { return false };
    let digits = rest.len() - rest.trim_start_matches(|c: char| c.is_ascii_digit()).len();
    if digits == 0 {
        return false;
    }
    let mut rest = &rest[digits..];
    if rest.as_bytes().first().is_some_and(|c| c.is_ascii_lowercase()) {
        rest = &rest[1..];
    }
    let Some(rest) = rest.strip_prefix('_') else { return false };
    /* Первая ветка: цифры, не больше одной буквы, конец имени. */
    let numeric = rest.len() - rest.trim_start_matches(|c: char| c.is_ascii_digit()).len();
    if numeric > 0 {
        let tail = &rest[numeric..];
        if tail.is_empty() || (tail.len() == 1 && tail.as_bytes()[0].is_ascii_lowercase()) {
            return true;
        }
    }
    /* Вторая: что угодно (кроме перевода строки), потом одно из слов. */
    !rest.contains('\n') && ["ground", "terrain", "land", "grnd"].iter().any(|word| rest.contains(word))
}

/// Атлас земли дальнего плана, который красится по цвету (`isDistantAtlas`).
pub fn is_distant_atlas(name: &str) -> bool {
    (atlas_name(name) || block_atlas_name(name)) && !skipped(name)
}

/// Имя листа вблизи для листа дальнего плана: `cs_x_lod` → `cs_x` (`distantSheetBase`).
pub fn distant_sheet_base(name: &str) -> String {
    let lower = name.to_ascii_lowercase();
    let lower = lower.strip_prefix("nxg_").unwrap_or(&lower);
    let bytes = lower.as_bytes();
    let cut = |suffix_len: usize| lower[..bytes.len() - suffix_len].to_owned();
    /* `(_slod\d?|_lod\d?|_l\d)$`: самый левый из подошедших концов. */
    for (word, digit_needed) in [("_slod", false), ("_lod", false), ("_l", true)] {
        /* Без цифры или с одной цифрой на конце. */
        if !digit_needed && lower.ends_with(word) {
            return cut(word.len());
        }
        if bytes.len() > word.len() && bytes[bytes.len() - 1].is_ascii_digit() && lower[..bytes.len() - 1].ends_with(word) {
            return cut(word.len() + 1);
        }
    }
    lower.to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vegetation_rules_samples::NAMES;

    #[test]
    fn names_match_what_js_said() {
        /* Ожидания сняты с `isDistantAtlas` и `distantSheetBase` из vegetation-build.js. */
        for &(name, atlas, base) in NAMES {
            assert_eq!(is_distant_atlas(name), atlas, "isDistantAtlas({name})");
            assert_eq!(distant_sheet_base(name), base, "distantSheetBase({name})");
        }
        assert!(NAMES.iter().any(|&(_, atlas, _)| atlas) && NAMES.iter().any(|&(_, atlas, _)| !atlas));
        assert!(NAMES.iter().any(|&(name, _, base)| name != base));
    }

    #[test]
    fn sheet_bases_cut_only_the_distant_suffixes() {
        for (name, expected) in [("cs_x_lod", "cs_x"), ("cs_x_slod2", "cs_x"), ("cs_x_l3", "cs_x"), ("NXG_cs_x_lod", "cs_x"), ("cs_x_lod12", "cs_x_lod12"), ("a_l", "a_l")] {
            assert_eq!(distant_sheet_base(name), expected, "{name}");
        }
    }
}
