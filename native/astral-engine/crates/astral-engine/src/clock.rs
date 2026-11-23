//! Текущее время в UTC без часовых поясов и без сторонних крейтов.
//!
//! Момент раскладывается на год, месяц, день, час, минуту, секунду и такты
//! по 100 нс; из раскладки печатаются три вида строки.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

const EPOCH_YEAR: i64 = 1970;
const SECONDS_PER_DAY: u64 = 86_400;
const NANOS_PER_TICK: u32 = 100;
/// Дни в месяцах невисокосного года.
const MONTH_LENGTHS: [u32; 12] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/// Описывает публичную структуру по списку «поле => тип»: все поля открыты.
macro_rules! open_fields {
    (
        $(#[$meta:meta])*
        $name:ident { $($(#[$fmeta:meta])* $field:ident => $ty:ty;)+ }
    ) => {
        $(#[$meta])*
        pub struct $name {
            $($(#[$fmeta])* pub $field: $ty,)+
        }
    };
}

/// Номер дня (от 1970-01-01), с которого начинается год `year >= 1970`.
fn first_day_of(year: i64) -> i64 {
    let leap_days = leap_years_through(year - 1) - leap_years_through(EPOCH_YEAR - 1);
    365 * (year - EPOCH_YEAR) + leap_days
}

/// Сколько високосных лет среди годов от 1-го до `year` включительно.
fn leap_years_through(year: i64) -> i64 {
    year / 4 - year / 100 + year / 400
}

fn is_leap(year: i64) -> bool {
    year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
}

/// Номер дня от 1970-01-01 в год, месяц и день месяца. Год берётся по грубой
/// оценке (в 400 годах 97 високосных дней) и поправляется до точного.
fn date_of_day(days: i64) -> (i64, u32, u32) {
    let mut year = EPOCH_YEAR + days * 400 / (365 * 400 + 97);
    while first_day_of(year) > days {
        year -= 1;
    }
    while first_day_of(year + 1) <= days {
        year += 1;
    }

    let mut left = (days - first_day_of(year)) as u32;
    let mut lengths = MONTH_LENGTHS;
    if is_leap(year) {
        lengths[1] += 1;
    }
    for (index, &length) in lengths.iter().enumerate() {
        if left < length {
            return (year, index as u32 + 1, left + 1);
        }
        left -= length;
    }
    // Остаток года не больше его длины, до сюда не доходит.
    (year, 12, 31)
}

open_fields! {
    /// Раскладка момента по UTC. Поля не проверяются: форматные методы печатают
    /// то, что в них лежит.
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    Utc {
        year => i64;
        month => u32;
        day => u32;
        hour => u32;
        minute => u32;
        second => u32;
        /// Доля секунды в единицах по 100 нс (в строках занимает семь знаков).
        ticks => u32;
    }
}

impl Utc {
    /// Время раньше 1970-01-01 даёт начало эпохи, без ошибки.
    pub fn from_system_time(time: SystemTime) -> Self {
        let since = time.duration_since(UNIX_EPOCH);
        let elapsed = since.unwrap_or(Duration::ZERO);
        let total_seconds = elapsed.as_secs();
        let seconds_today = (total_seconds % SECONDS_PER_DAY) as u32;
        let (minutes_today, second) = (seconds_today / 60, seconds_today % 60);
        let (year, month, day) = date_of_day((total_seconds / SECONDS_PER_DAY) as i64);
        Self {
            year,
            month,
            day,
            hour: minutes_today / 60,
            minute: minutes_today % 60,
            second,
            ticks: elapsed.subsec_nanos() / NANOS_PER_TICK,
        }
    }

    pub fn now() -> Self {
        let moment = SystemTime::now();
        Self::from_system_time(moment)
    }

    /// `2026-10-17T13:05:09.1234567Z`
    pub fn iso_z(&self) -> String {
        self.iso("Z")
    }

    /// `2026-10-17T13:05:09.1234567+00:00`
    pub fn iso_offset(&self) -> String {
        self.iso("+00:00")
    }

    fn iso(&self, zone: &str) -> String {
        let Self {
            year,
            month,
            day,
            hour,
            minute,
            second,
            ticks,
        } = *self;
        format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{ticks:07}{zone}")
    }

    /// `20261017-130509`, без доли секунды.
    pub fn compact(&self) -> String {
        let Self {
            year,
            month,
            day,
            hour,
            minute,
            second,
            ..
        } = *self;
        format!("{year:04}{month:02}{day:02}-{hour:02}{minute:02}{second:02}")
    }
}
