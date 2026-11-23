//! Читатели игры: то, что окно мастерской получало от JS-читателей в главном
//! процессе и потоках (`readPtfxBase` и соседи), теперь считает движок.
//!
//! Оракул каждого читателя — его JS-прототип; паритет — `parity/readers/`.
//! Команды этой группы живут в `commands/readers.rs`, а сама работа — здесь, по
//! модулю на читателя и один общий доступ к архивам игры (`archive_access`).

pub mod archive_access;
pub mod ars2;
pub mod combat_decals;
pub mod js_text;
pub mod locator;
pub mod ptfx;
pub mod radar;
pub mod timecycle;
