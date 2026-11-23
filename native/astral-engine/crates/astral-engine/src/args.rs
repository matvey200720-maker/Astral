//! Разбор параметров команды: `--имя значение --имя значение …`.
//!
//! Регистр имён не важен, имя можно повторять, значением не может быть
//! строка, начинающаяся с `--`. Форм `--имя=значение` и флагов без значения
//! нет: `=` просто буква имени.

use crate::error::{EngineError, Result};
use std::{collections::BTreeMap, str::FromStr};

const NAME_PREFIX: &str = "--";

/// Значения всех имён: имя в нижнем регистре, затем значения по порядку появления.
type Table = BTreeMap<String, Vec<String>>;

/// Ключ из элемента-имени: после `--` обязан остаться хотя бы один знак;
/// остаток переводится в нижний регистр.
fn key_of(token: &str) -> Result<String> {
    match token.strip_prefix(NAME_PREFIX) {
        Some(rest) if !rest.is_empty() => Ok(rest.to_lowercase()),
        _ => Err(EngineError::argument(format!(
            "Invalid native option: {token}"
        ))),
    }
}

fn value_missing(token: &str) -> EngineError {
    EngineError::argument(format!("A value is required for {token}."))
}

/// Набор значений по именам (в нижнем регистре), в порядке появления.
/// После разбора не меняется.
#[derive(Debug, Default, Clone)]
pub struct Options {
    values: Table,
}

impl Options {
    /// Последнее значение, разобранное в `T` после среза пробельных знаков по краям.
    pub fn parsed<T>(&self, key: &str) -> Result<Option<T>>
    where
        T: FromStr,
    {
        let Some(raw) = self.optional(key) else {
            return Ok(None);
        };
        match raw.trim().parse::<T>() {
            Ok(number) => Ok(Some(number)),
            Err(_) => Err(EngineError::argument(format!(
                "--{key} has an invalid value: {raw}"
            ))),
        }
    }
}

impl Options {
    /// Все значения имени так, как они шли в командной строке.
    pub fn values(&self, key: &str) -> &[String] {
        let lowered = key.to_lowercase();
        match self.values.get(lowered.as_str()) {
            Some(list) => list,
            None => Default::default(),
        }
    }
}

impl Options {
    /// Как `optional`, но отсутствие имени - отказ. Пустое значение - не отсутствие.
    pub fn required(&self, key: &str) -> Result<&str> {
        self.optional(key)
            .ok_or_else(|| EngineError::argument(format!("--{key} is required.")))
    }
}

impl Options {
    /// Последнее значение имени.
    pub fn optional(&self, key: &str) -> Option<&str> {
        self.values(key).last().map(String::as_str)
    }
}

impl Options {
    /// Список читается парами «имя, значение», по два элемента за раз; первая же
    /// ошибка (неверное имя или пропавшее значение) отказывает.
    pub fn parse(args: &[String]) -> Result<Self> {
        args.chunks(2)
            .try_fold(Table::new(), |mut values, pair| {
                let name = &pair[0];
                let key = key_of(name)?;
                match pair.get(1) {
                    Some(value) if !value.starts_with(NAME_PREFIX) => {
                        let bucket = values.entry(key).or_default();
                        bucket.push(String::from(value.as_str()));
                        Ok(values)
                    }
                    _ => Err(value_missing(name)),
                }
            })
            .map(|values| Self { values })
    }
}
