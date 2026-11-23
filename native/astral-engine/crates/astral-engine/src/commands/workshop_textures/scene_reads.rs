//! Чтение игры по адресу `метка:путь` для сборщиков сцен (зоны, интерьеры): файлы, палитры тинта и средний цвет листа.
//!
//! Работает на **том же сеансе**, что `read-workshop-textures` (`session.rs`): пара «папка игры, папка ключей» даёт один читатель архивов и одну
//! таблицу разобранных ресурсов; вторых открытых архивов нет, разбор ресурса, что уже читал соседний вызов, берётся из таблицы. Ключ сеанса —
//! `session_key`, тот же, что собирает `run` команды листов.
//!
//! Пиксели считает `texture::decode_js` (блоки DXT округляются, как у JS: `bcdec` у `texture::decode` режет вниз, и палитры с цветами расходились бы на единицу).
//!
//! Повторяет JS: палитра — лист целиком (`decodeTextureRef(ref, { level: 0 })`), средний цвет — `meanColour(decodeTextureRef(ref, { maxSize: 32 }).rgba)`
//! из `world-place-scene.js`; лист, который не прочитался, — `None` (в JS `catch` отдаёт `null` или цвет земли — это решает сборщик).

use std::path::PathBuf;
use std::sync::Arc;

use rage_res::texture::{self, Image};

use super::probe::{Probe, Stage};
use super::session::{Game, Lease, Loaded, Parsed};
use super::{archive_file, label_of, parse_resource, stamp_of_file};
use crate::error::Result;

/// Предел стороны, до которой берётся уровень для среднего цвета (`maxSize` у `colourOf` в JS).
pub(crate) const MEAN_MAX_SIZE: u32 = 32;

/// Ключ общего сеанса: папка игры в нижнем регистре и папка ключей — как у `run` команды листов.
pub(crate) fn session_key(root_lower: &str, keys: Option<&str>) -> String {
    format!("{root_lower}|{}", keys.unwrap_or(""))
}

/// `meanColour` JS (`world-place-scene.js`): общая с построителем места функция `rage-res`.
pub(crate) use rage_res::texture_js::mean_colour_of;

/// Читатель одной игры на время вызова: файлы, разобранные ресурсы и листы по адресу.
pub(crate) struct SceneReads<'a> {
    lease: &'a Lease,
    game: Arc<Game>,
    root: PathBuf,
    probe: &'a Probe,
    budget: usize,
}

impl<'a> SceneReads<'a> {
    /// `game` берут у `lease.game(…)`: тот же объект получает и пачка `read-workshop-textures`, если у неё тот же ключ сеанса.
    pub(crate) fn new(
        lease: &'a Lease,
        game: Arc<Game>,
        root: PathBuf,
        probe: &'a Probe,
        budget: usize,
    ) -> Self {
        SceneReads {
            lease,
            game,
            root,
            probe,
            budget,
        }
    }

    /// Байты файла по адресу; `Ok(None)` — файла нет (в том числе не открылся архив).
    pub(crate) fn file(&self, place: &str) -> Result<Option<Vec<u8>>> {
        self.game.read(place, self.probe)
    }

    /// Разобранный ресурс адреса (`.ytd` — словарь, остальное — вшитые листы моделей): из таблицы сеанса или прочитанный.
    /// Слишком большой и не разобравшийся ресурс — пустой разбор, а не отказ.
    pub(crate) fn parsed(&self, place: &str) -> Result<Option<Arc<Parsed>>> {
        let base = format!("game:{place}");
        let stamp = stamp_of_file(&archive_file(&self.root, label_of(place)));
        let loaded = match stamp {
            Some(stamp) => {
                let (loaded, reused) = self
                    .lease
                    .resource(&base, &stamp, self.budget, || self.read_parsed(place))?;
                if reused {
                    Probe::count(&self.probe.reused, 1);
                }
                loaded
            }
            None => self.read_parsed(place)?,
        };
        Ok(match loaded {
            Loaded::Found(parsed) => Some(parsed),
            Loaded::Missing => None,
        })
    }

    fn read_parsed(&self, place: &str) -> Result<Loaded> {
        let began = std::time::Instant::now();
        let Some(bytes) = self.game.read(place, self.probe)? else {
            self.probe.add(Stage::Read, began);
            return Ok(Loaded::Missing);
        };
        if bytes.len() > super::parents::MAX_RESOURCE_BYTES {
            self.probe.add(Stage::Read, began);
            return Ok(Loaded::Found(Arc::new(Parsed::empty())));
        }
        let parsed = parse_resource(&bytes, place.ends_with(".ytd"));
        self.probe.add(Stage::Read, began);
        Probe::count(&self.probe.loaded, 1);
        Probe::count(&self.probe.bytes, bytes.len() as u64);
        Ok(Loaded::Found(Arc::new(parsed)))
    }

    /// Лист по имени (имя в нижнем регистре) в ресурсе адреса.
    fn decoded(
        &self,
        place: &str,
        name: &str,
        level: Option<u32>,
        max_size: Option<u32>,
    ) -> Result<Option<Image>> {
        let Some(parsed) = self.parsed(place)? else {
            return Ok(None);
        };
        let Some(resource) = parsed.resource.as_ref() else {
            return Ok(None);
        };
        let Some(reference) = parsed
            .refs
            .iter()
            .find(|item| item.name.to_lowercase() == name)
        else {
            return Ok(None);
        };
        // Лист, что не читается (формат, обрезанные байты), не отказ вызова: сборщик берёт запасной цвет, как `catch` в JS.
        Ok(texture::decode_js(resource, reference, level, max_size).ok())
    }

    /// Пиксели листа целиком (уровень 0): палитра тинта.
    pub(crate) fn palette(&self, place: &str, name: &str) -> Result<Option<Image>> {
        self.decoded(place, name, Some(0), None)
    }

    /// Средний цвет листа `#rrggbb` по уровню, чья большая сторона влезает в `MEAN_MAX_SIZE`.
    pub(crate) fn mean_colour(&self, place: &str, name: &str) -> Result<Option<String>> {
        Ok(self
            .decoded(place, name, None, Some(MEAN_MAX_SIZE))?
            .map(|image| mean_colour_of(&image.rgba)))
    }

    /// Игра, для которой читатель создан: общий объект сеанса.
    #[cfg(test)]
    pub(crate) fn game(&self) -> &Arc<Game> {
        &self.game
    }
}

#[cfg(test)]
mod tests;
