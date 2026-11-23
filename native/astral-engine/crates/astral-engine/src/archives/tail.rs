//! Команда `tail-rpf`: хвост архива верхнего уровня (20.11.2026, `docs/handoff/RPF-NESTED-TAIL.md`).
//!
//! Съёмка в игре: маленький вложенный архив последним в `update.rpf` роняет сюжет, нули после него лечат. Команда читает хвост файла и
//! (без `--check true`) доводит его до правила `rage_rpf::tail`: от начала последней записи до конца не меньше запаса, длина кратна
//! границе, ключ шапки прежний (дописываются только нули, оглавление не меняется).
//!
//! Параметры: `--input` (файл `.rpf`), `--keys`/`--game-root` (ключи, как у `describe-archive`), `--name` (имя, по которому игра берёт ключ
//! шапки, когда файл лежит под другим именем, например `update.rpf` во временной папке), `--check true` (только прочитать).

use rage_rpf::tail::{ensure_tail_with, inspect_tail, TailPolicy};
use serde_json::{json, Value};

use super::append::{engine_error, EngineHost};
use super::load_keys;
use crate::{args::Options, error::Result, paths, progress::Progress};

/// Команда `tail-rpf`.
pub fn tail_rpf(options: &Options, _progress: &Progress) -> Result<Value> {
    let named = options.required("input")?;
    // расширение не проверяется: сборка лежит под временным именем (`….stage`), ключ шапки берётся по `--name`
    let input = paths::existing_file(named, &[])?;
    let (keys, _source) = load_keys(
        options.optional("game-root").unwrap_or_default(),
        options.optional("keys"),
    )?;
    let name = options
        .optional("name")
        .filter(|name| !name.trim().is_empty())
        .map(str::to_owned)
        .or_else(|| {
            input
                .file_name()
                .map(|last| last.to_string_lossy().into_owned())
        })
        .unwrap_or_default();
    let policy = TailPolicy::STANDARD;
    let check_only = options.optional("check") == Some("true");
    let report = if check_only {
        inspect_tail(&input, &name, &keys, policy)?
    } else {
        // файл с двумя именами — отказ `Linked` до записи (то же имя и текст, что у дозаписи); `--check true` читает и такой файл
        ensure_tail_with(&input, &name, &keys, policy, &EngineHost).map_err(engine_error)?
    };
    Ok(json!({
        "input": input.to_string_lossy(),
        "name": name,
        "check": check_only,
        "ok": report.ok,
        "len": report.len,
        "lastStart": report.last_start,
        "end": report.end,
        "distance": report.distance,
        "key": report.key,
        "pad": report.pad,
        "afterLen": report.after_len,
        "min": policy.min,
        "align": policy.align,
    }))
}
