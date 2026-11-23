//! Сборка наборов перекраски Astral на Rust (14.11.2026, решение владельца «Astral нужно переписать на Rust»).
//!
//! Первый набор — «Дороги»: самая тяжёлая сборка мастерской (2442 словаря карты, 5 ГБ). Прежняя
//! сборка шла на JS потоками, у каждого своя память листов; здесь один процесс, общая память
//! готовых листов и побайтно тот же итог:
//!
//! * [`paint`] — разбор краски листа на группы (`road-paint.js`);
//! * [`roads`] — пиксели листа по облику работы (`roads.js`, `roadSheetPixels`);
//! * [`sheet`] — разбор блоков DXT, уровни и сборка листа (`block-codec.js`, `texture-payload.js`);
//! * [`dictionary`] — словарь целиком: листы, правка на месте, сжатие (`roads-build.js`);
//! * [`build`] — чтение словарей из архивов игры и сборка несколькими потоками.
//!
//! Второй набор — «Вода» (14.11.2026): плитки тумана моря, 96 % её сборки:
//!
//! * [`bc7`] — запись BC7 режима 6 (`bc7-encode.js`);
//! * [`water`] — цвет точки тумана и плитка целиком (`recolourWaterFogLevel`, `water-tiles.js`).
//!
//! «Билборды» (16.11.2026): файлы щитов — картинки щитов, укладка в листы, пережатие тронутых блоков:
//!
//! * [`billboards`] — `paintBillboardFile` и арифметика `billboards.js` / `building-images.js`.
//!
//! Цвет травы (15.11.2026): ядра `grass-colour.js` — чистые функции над байтами, их зовёт JS через `native/astral-rs`:
//!
//! * [`grass`] — `recolourGrass`, `recolourDistantBlocks`, `recolourDistantSand`, `grassInstanceColour` и математика V8, на которой они стоят;
//! * [`resize`] — `resizeRgba` из `vegetation-build.js` (картинка мода в размер штатной).
//!
//! Сборка растительности целиком (16.11.2026): файлы игры с листами «Травы по миру» одной командой движка:
//!
//! * [`vegetation_rules`] — правила имён листов (`isDistantAtlas`, `distantSheetBase`);
//! * [`vegetation`] — файл игры: листы мода на месте штатных, атласы дальних планов, газоны (`processVegetationJob`, вид `game`);
//! * [`vegetation_grass`] — карты травы в цвете травы зоны (`patchGrassMap`);
//! * [`vegetation_build`] — чтение файлов из архивов игры и сборка несколькими потоками.
//!
//! Правила «какой лист — дорога» остаются у приложения (`roadTextureFamily`): семейства листов
//! приходят в запросе, а про незнакомые имена движок отчитывается — приложение сверяет их само.

pub mod bc7;
pub mod billboards;
pub mod build;
pub mod dictionary;
pub mod grass;
pub mod paint;
pub mod resize;
#[cfg(test)]
mod resize_samples;
pub mod roads;
pub mod sheet;
pub mod vegetation;
pub mod vegetation_build;
pub mod vegetation_grass;
pub mod vegetation_rules;
#[cfg(test)]
mod vegetation_rules_samples;
pub mod water;
