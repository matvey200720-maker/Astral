//! Растительность: файл игры с листами «Травы по миру» — `processVegetationJob` для заданий вида `game`
//! из `apps/desktop/src/vegetation-build.js` (листы мода на месте штатных, атласы дальних планов, газоны).
//!
//! Файл выходит тем же байт в байт, что у сборки на JS: те же листы, тот же порядок правок, тот же поток
//! deflate. Всё, чего этот путь не повторяет дословно (формат листа не DXT, спорная раскладка, отказ ядра
//! цвета, любой отказ разбора), — [`Game::Fallback`]: такой файл собирает приложение прежним кодом.
//!
//! Что считает приложение и передаёт числами: цвет травы файла (`fileColour`), цели цвета
//! (`grassTarget`: арктангенс и гипотенуза), полосу цветов эффекта зоны (257 ступеней) и рамки зон.
//! Движок считает пиксели (`grass.rs`) и сводит листы; синус, косинус и арктангенс на пиксель — порт `fdlibm`
//! (как у Node 24), у Electron 43 `Math.*` расходится с ним в последнем бите.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;

use rage_res::drawable::{self, FileKind};
use rage_res::dxt_block;
use rage_res::resource::Resource;
use rage_res::texture::{self, Format, TextureRef};

use crate::bc7;
use crate::dictionary::{open_resource, pack_patched, unique_refs, Clock, LEVEL_FALLBACK_BYTES};
use crate::grass::{self, BlockFormat, Oracle, Reference, Target, WeightsIn};
use crate::resize::{halve, max2, min2, resize_rgba};
use crate::sheet;
use crate::vegetation_rules::{distant_sheet_base, is_distant_atlas};

const HEADER_BYTES: usize = 16;

/* ------------------------------------------------------------------ *
 * Данные работы
 * ------------------------------------------------------------------ */

/// Лист мода из склада поставки (`plan.images[id]`): размер, формат и где лежат байты первого уровня.
pub struct Image {
    pub width: usize,
    pub height: usize,
    pub format: dxt_block::Format,
    /// Ровная картинка (`flat`): байты не нужны.
    pub flat: Option<[u8; 3]>,
    pub offset: usize,
    pub length: usize,
}

/// Листы мода по имени (`modSheetsOf`): `exact` — имя листа, `base` — имя листа вблизи; значение — номер картинки и оттенок.
#[derive(Default)]
pub struct ModSheets {
    pub exact: HashMap<String, (u32, bool)>,
    pub base: HashMap<String, (u32, bool)>,
}

/// Цвет травы файла: `#rrggbb` (ключ памяти листов), байты и цель (`grassTarget`, посчитанная приложением).
#[derive(Clone)]
pub struct Paint {
    pub key: String,
    pub rgb: [u8; 3],
    pub target: Target,
}

/// Откуда эффект зоны берёт долю в точке мира (`shareOfEffect`).
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    Along,
    Across,
    Height,
}

/// Цвет травы по карте (`sandyColourField`): полоса из `steps + 1` цветов и доля эффекта по месту.
#[derive(Clone)]
pub struct Field {
    pub direction: Direction,
    pub line: bool,
    pub width: f64,
    pub west: f64,
    pub south: f64,
    pub east: f64,
    pub north: f64,
    pub centre: [f64; 2],
    pub radius: f64,
    pub steps: usize,
}

impl Field {
    /// Доля эффекта в точке (`shareOfEffect`).
    fn share(&self, x: f64, y: f64) -> f64 {
        let span = match self.direction {
            Direction::Across => (y - self.south) / (self.north - self.south),
            Direction::Height => grass::v8::hypot(x - self.centre[0], y - self.centre[1]) / self.radius,
            Direction::Along => (x - self.west) / (self.east - self.west),
        };
        if !self.line {
            return min2(1.0, max2(0.0, span));
        }
        let length = match self.direction {
            Direction::Height => self.radius,
            Direction::Across => self.north - self.south,
            Direction::Along => self.east - self.west,
        };
        let metres = span * length;
        let period = self.width * 200.0;
        (((metres % period) + period) % period) / period
    }

    /// Номер цвета полосы в точке: `Math.round(доля × ступеней)`; `None` — вне полосы (у JS `undefined`).
    pub fn index(&self, x: f64, y: f64) -> Option<usize> {
        let at = crate::bc7::js_round(self.share(x, y) * self.steps as f64);
        (at >= 0.0 && at <= self.steps as f64).then_some(at as usize)
    }
}

/// Дальний план файла (`distantOptions`): что красить, яркость травы вблизи, цели цветов полосы и место файла.
#[derive(Clone)]
pub struct Distant {
    pub greens: bool,
    pub sand: bool,
    pub albedo: f64,
    /// Цель цвета на каждый цвет полосы (у цвета «как в моде» — один).
    pub targets: Vec<Target>,
    /// `None` — цвет один на весь файл (номер 0).
    pub field: Option<Field>,
    /// Рамка файла `[cx, cy, minX, minY, maxX, maxY]` (`places[имя]`) или середина зоны, если рамки нет.
    pub place: Option<[f64; 6]>,
    pub zone_centre: [f64; 2],
}

impl Distant {
    /// Те же настройки зоны для файла с рамкой `place` (`places[имя]`).
    pub fn with_place(&self, place: Option<[f64; 6]>) -> Self {
        Self { place, ..self.clone() }
    }
}

/// Одно задание: файл игры с правками листов.
pub struct GameJob {
    pub name: String,
    pub at: String,
    pub file: Option<std::path::PathBuf>,
    pub output: std::path::PathBuf,
    /// Зона файла — «за городом» (листы мода по имени ложатся только там).
    pub country: bool,
    pub paint: Option<Paint>,
    /// Листы мода плана: `[имя, картинка, оттенок]`.
    pub green: Option<Vec<(String, u32, bool)>>,
    pub distant: Option<Distant>,
    /// Имена листов штатной травы зоны (`lawns`).
    pub lawns: Option<Vec<String>>,
}

/// Всё общее у заданий сборки.
pub struct Sandy {
    pub images: HashMap<u32, Image>,
    /// Байты первых уровней листов мода подряд.
    pub bytes: Vec<u8>,
    pub mod_sheets: ModSheets,
    memo: GreenMemo,
}

impl Sandy {
    pub fn new(images: HashMap<u32, Image>, bytes: Vec<u8>, mod_sheets: ModSheets, memo_limit: usize) -> Self {
        Self { images, bytes, mod_sheets, memo: GreenMemo::new(memo_limit) }
    }
}

/* ------------------------------------------------------------------ *
 * Память готовых листов мода
 * ------------------------------------------------------------------ */

type Ready = Result<Option<Arc<Vec<u8>>>, String>;

/// Готовые листы мода между файлами (`greenCache` у JS), общие у всех потоков: одна картинка мода стоит в сотнях
/// файлов. Лист считает один поток, остальные ждут готового.
struct GreenMemo {
    entries: Mutex<HashMap<String, Arc<OnceLock<Ready>>>>,
    held: AtomicUsize,
    limit: usize,
}

impl GreenMemo {
    fn new(limit: usize) -> Self {
        Self { entries: Mutex::new(HashMap::new()), held: AtomicUsize::new(0), limit }
    }

    fn slot(&self, key: &str) -> Arc<OnceLock<Ready>> {
        match self.entries.lock() {
            Ok(mut entries) => Arc::clone(entries.entry(key.to_owned()).or_default()),
            Err(_) => Arc::default(),
        }
    }

    /// Учесть посчитанный лист; сверх потолка в памяти он не остаётся.
    fn account(&self, key: &str, size: usize) {
        if self.held.load(Ordering::Relaxed) + size > self.limit {
            if let Ok(mut entries) = self.entries.lock() {
                entries.remove(key);
            }
            return;
        }
        self.held.fetch_add(size, Ordering::Relaxed);
    }
}

/* ------------------------------------------------------------------ *
 * Разбор файла
 * ------------------------------------------------------------------ */

fn kind_of(file_name: &str) -> Option<Option<FileKind>> {
    match file_name.rsplit('.').next()?.to_ascii_lowercase().as_str() {
        "ytd" => Some(None),
        "ydr" => Some(Some(FileKind::Ydr)),
        "ydd" => Some(Some(FileKind::Ydd)),
        "yft" => Some(Some(FileKind::Yft)),
        _ => None,
    }
}

/// Листы файла в порядке чтения: словарь — как есть, модель — встроенные листы всех её моделей подряд.
fn read_refs(res: &Resource, kind: Option<FileKind>) -> Result<Vec<TextureRef>, String> {
    let Some(kind) = kind else {
        return texture::read_dictionary(res).map_err(|error| error.to_string());
    };
    let model = drawable::open_model(res, Some(kind)).map_err(|error| error.to_string())?;
    let mut refs = Vec::new();
    for entry in &model.entries {
        let (_, _, embedded) = drawable::read_materials(res, entry.at).map_err(|error| error.to_string())?;
        refs.extend(embedded);
    }
    Ok(refs)
}

fn dxt_format(format: Format) -> Option<dxt_block::Format> {
    match format {
        Format::Dxt1 => Some(dxt_block::Format::Dxt1),
        Format::Dxt3 => Some(dxt_block::Format::Dxt3),
        Format::Dxt5 => Some(dxt_block::Format::Dxt5),
        _ => None,
    }
}

fn block_format(format: dxt_block::Format) -> BlockFormat {
    match format {
        dxt_block::Format::Dxt1 => BlockFormat::Dxt1,
        dxt_block::Format::Dxt3 => BlockFormat::Dxt3,
        dxt_block::Format::Dxt5 => BlockFormat::Dxt5,
    }
}

/// Лист файла для правок: сам лист, место его байт и сколько байт с начала принадлежат ему одному (`writable`).
struct View<'a> {
    item: &'a TextureRef,
    at: usize,
    writable: usize,
    lower: String,
}

impl View<'_> {
    /// `firstLevelBytes`: байт первого уровня.
    fn first_level(&self) -> usize {
        self.item.spans.first().map_or(0, |span| span.bytes)
    }

    /// Лист ложится целиком хотя бы первым уровнем (`writable >= firstLevelBytes`).
    fn paintable(&self) -> bool {
        self.writable >= self.first_level()
    }
}

fn views(refs: &[TextureRef]) -> Vec<View<'_>> {
    let list = unique_refs(refs);
    (0..list.len())
        .map(|index| {
            let (item, at) = list[index];
            let writable = match list.get(index + 1) {
                Some(&(_, next)) => item.bytes.min(next - at),
                None => item.bytes,
            };
            View { item, at, writable, lower: item.name.to_ascii_lowercase() }
        })
        .collect()
}

/* ------------------------------------------------------------------ *
 * Лист мода на месте штатного
 * ------------------------------------------------------------------ */

/// Один уровень листа в формате цели (`encodeLevel`); `None` — формат не пишется.
fn encode_level(format: Format, rgba: &[u8], width: usize, height: usize) -> Option<Vec<u8>> {
    if let Some(block) = dxt_format(format) {
        let mut out = vec![0u8; dxt_block::blocks_len(block, width, height)];
        dxt_block::encode_blocks(block, rgba, width, height, &mut out);
        return Some(out);
    }
    match format {
        Format::Bc7 => Some(bc7::encode(rgba, width, height)),
        Format::A8R8G8B8 | Format::A8B8G8R8 => {
            let swap = format == Format::A8R8G8B8;
            let mut out = vec![0u8; width * height * 4];
            for (target, pixel) in out.chunks_exact_mut(4).zip(rgba.chunks_exact(4)) {
                target[0] = if swap { pixel[2] } else { pixel[0] };
                target[1] = pixel[1];
                target[2] = if swap { pixel[0] } else { pixel[2] };
                target[3] = pixel[3];
            }
            Some(out)
        }
        _ => None,
    }
}

/// `greenTexturePayload`: лист мода в размере, формате и числе mip штатного (`target`). `Ok(None)` — формат не пишется
/// или байты не той длины; ошибка — отказ ядра цвета или оборванный лист мода (такой файл собирает приложение).
fn green_texture_payload(sandy: &Sandy, image: &Image, target: &TextureRef, format: Format, paint: Option<&Paint>, clock: &Clock) -> Result<Option<Vec<u8>>, String> {
    let (target_width, target_height) = (target.width as usize, target.height as usize);
    let (mut width, mut height) = (image.width, image.height);
    let from = Instant::now();
    let mut rgba;
    if let Some(flat) = image.flat {
        width = target_width;
        height = target_height;
        rgba = vec![255u8; width * height * 4];
        for pixel in rgba.chunks_exact_mut(4) {
            pixel[..3].copy_from_slice(&flat);
        }
    } else {
        let need = dxt_block::blocks_len(image.format, width, height);
        let Some(stored) = sandy.bytes.get(image.offset..image.offset + image.length.min(need)).filter(|stored| stored.len() == need) else {
            return Err("лист мода короче своего размера".to_owned());
        };
        rgba = sheet::decode_blocks(image.format, stored, width, height).ok_or_else(|| "лист мода оборван".to_owned())?;
    }
    Clock::add(&clock.decode, from);
    if let Some(paint) = paint {
        let from = Instant::now();
        let recoloured = grass::recolour_grass(&rgba, &paint.target, &mut Oracle::port()).map_err(str::to_owned)?;
        Clock::add(&clock.pixels, from);
        if let Some(next) = recoloured {
            rgba = next;
        }
    }
    let from = Instant::now();
    let mut resized = vec![0u8; target_width * target_height * 4];
    resize_rgba(&rgba, width, height, target_width, target_height, &mut resized);
    let mut out = Vec::with_capacity(target.bytes);
    let (mut level, mut level_width, mut level_height) = (resized, target_width, target_height);
    for index in 0..target.levels as usize {
        let Some(encoded) = encode_level(format, &level, level_width, level_height) else {
            Clock::add(&clock.encode, from);
            return Ok(None);
        };
        out.extend_from_slice(&encoded);
        if index + 1 < target.levels as usize {
            (level, level_width, level_height) = halve(&level, level_width, level_height);
        }
    }
    Clock::add(&clock.encode, from);
    Ok((out.len() == target.bytes).then_some(out))
}

/// Новые байты листа с общим хвостом mip (`keepSharedTail`): уровни целиком до хвоста — новые, дальше — прежние.
fn keep_shared_tail(payload: &[u8], view: &View, res: &Resource, format: Format) -> Result<Vec<u8>, String> {
    let mut boundary = 0;
    for level in 0..view.item.levels as usize {
        let size = format.level_bytes((view.item.width as usize >> level).max(1), (view.item.height as usize >> level).max(1));
        if boundary + size > view.writable {
            break;
        }
        boundary += size;
    }
    let original = res.bytes(view.at, view.item.bytes).map_err(|_| "лист выходит за данные".to_owned())?;
    let mut out = payload.to_vec();
    out[boundary..].copy_from_slice(&original[boundary..]);
    Ok(out)
}

/// Правки файла: имя листа (как в файле) → новые байты. Позднее присвоение под тем же именем заменяет прежнее на его месте,
/// как у `Object.assign` (`replacements[имя] = …`).
#[derive(Default)]
struct Replacements(Vec<(String, Arc<Vec<u8>>)>);

impl Replacements {
    fn assign(&mut self, name: &str, payload: Arc<Vec<u8>>) {
        match self.0.iter_mut().find(|(known, _)| known == name) {
            Some(slot) => slot.1 = payload,
            None => self.0.push((name.to_owned(), payload)),
        }
    }

    fn lowered(&self) -> HashSet<String> {
        self.0.iter().map(|(name, _)| name.to_ascii_lowercase()).collect()
    }
}

struct Laid {
    replacements: Replacements,
    count: u32,
}

/// `greenSheetPayloads`: листы мода `textures` (`[имя, картинка, оттенок]`) на места штатных листов файла.
#[allow(clippy::too_many_arguments)]
fn green_sheet_payloads(sandy: &Sandy, res: &Resource, views: &[View], by_lower: &HashMap<&str, usize>, textures: &[(String, u32, bool)], paint: Option<&Paint>, clock: &Clock) -> Result<Laid, String> {
    let mut laid = Laid { replacements: Replacements::default(), count: 0 };
    for (name, image_id, tint) in textures {
        let Some(&index) = by_lower.get(name.as_str()) else { continue };
        let view = &views[index];
        /* Нет текстуры (другая версия игры) или общий с соседней уже первый уровень — мимо. */
        if !view.paintable() {
            continue;
        }
        let Some(image) = sandy.images.get(image_id) else { continue };
        let own = if *tint { paint } else { None };
        let Some(format) = view.item.format else {
            /* Формат, которого `encodeLevel` не знает: у JS лист остаётся без правки. */
            continue;
        };
        let key = format!("{image_id}|{}|{}x{}|{}|{}", format.name(), view.item.width, view.item.height, view.item.levels, own.map_or("", |paint| paint.key.as_str()));
        let slot = sandy.memo.slot(&key);
        let mut computed = false;
        let ready = slot
            .get_or_init(|| {
                computed = true;
                green_texture_payload(sandy, image, view.item, format, own, clock).map(|payload| payload.map(Arc::new))
            })
            .clone();
        if computed {
            sandy.memo.account(&key, ready.as_ref().ok().and_then(Option::as_ref).map_or(0, |bytes| bytes.len()));
        }
        let Some(payload) = ready? else { continue };
        let payload = if view.writable < view.item.bytes { Arc::new(keep_shared_tail(&payload, view, res, format)?) } else { payload };
        laid.replacements.assign(&view.item.name, payload);
        laid.count += 1;
    }
    Ok(laid)
}

/* ------------------------------------------------------------------ *
 * Дальние планы и газоны: цвет прямо в блоках DXT
 * ------------------------------------------------------------------ */

/// Каждый уровень mip листа DXT сжатым (`recolourTextureBlocks`): `recolour(байты уровня, ширина, высота)` → новые байты или
/// `None`. Уровни дальше `writable` (общий хвост mip) не трогаются.
fn recolour_blocks(res: &Resource, view: &View, format: dxt_block::Format, mut recolour: impl FnMut(&[u8], usize, usize) -> Result<Option<Vec<u8>>, String>) -> Result<Option<Arc<Vec<u8>>>, String> {
    let mut payload = res.bytes(view.at, view.item.bytes).map_err(|_| "лист выходит за данные".to_owned())?.to_vec();
    let limit = payload.len().min(view.writable);
    let mut offset = 0;
    let mut changed = false;
    for level in 0..view.item.levels as usize {
        let width = (view.item.width as usize >> level).max(1);
        let height = (view.item.height as usize >> level).max(1);
        let size = dxt_block::blocks_len(format, width, height);
        if offset + size > limit {
            break;
        }
        if let Some(next) = recolour(&payload[offset..offset + size], width, height)? {
            payload[offset..offset + size].copy_from_slice(&next[..size]);
            changed = true;
        }
        offset += size;
    }
    Ok(changed.then(|| Arc::new(payload)))
}

/// `recolourDistantBlocks` одного уровня: веса опорных цветов, цели по местам блоков, сдвиг. `colour_at(px, py)` — номер цели у блока.
#[allow(clippy::too_many_arguments)]
fn distant_blocks(
    bytes: &[u8],
    format: dxt_block::Format,
    width: usize,
    height: usize,
    greens: bool,
    sand: bool,
    albedo: f64,
    targets: &[Target],
    colour_at: &dyn Fn(usize, usize) -> Option<usize>,
    oracle: &mut Oracle,
) -> Result<Option<Vec<u8>>, String> {
    let kernel = block_format(format);
    let Some(found) = grass::blocks_weights(bytes, kernel, width, height, greens, sand).map_err(str::to_owned)? else { return Ok(None) };
    let columns = width.div_ceil(4).max(1);
    let rows = height.div_ceil(4).max(1);
    let mut slots = vec![-1i32; columns * rows];
    let mut table: Vec<Target> = Vec::new();
    let mut slot_of: HashMap<usize, i32> = HashMap::new();
    for &block in &found.touched {
        let block = block as usize;
        let (px, py) = (((block % columns) * 4 + 2).min(width - 1), ((block / columns) * 4 + 2).min(height - 1));
        if let Some(colour) = colour_at(px, py) {
            let slot = *slot_of.entry(colour).or_insert_with(|| {
                table.push(targets[colour]);
                (table.len() - 1) as i32
            });
            slots[block] = slot;
        }
    }
    let reference = |sums: &grass::Sums, oracle: &mut Oracle| -> Option<Reference> { sums.reference(oracle) };
    let grass_ref = reference(&found.weights.grass_sum, oracle);
    let sand_ref = reference(&found.weights.sand_sum, oracle);
    let weights = WeightsIn { grass: &found.weights.grass, sandy: &found.weights.sandy, grass_ref, sand_ref };
    grass::blocks_shift(bytes, kernel, width, height, weights, &table, &slots, albedo, oracle).map_err(str::to_owned)
}

/// `distantModSheets`: листы мода для словаря дальнего плана — по имени листа и по имени листа вблизи.
fn distant_mod_sheets(names: &[&str], sheets: &ModSheets, own: &HashSet<String>) -> Vec<(String, u32, bool)> {
    let mut out = Vec::new();
    for raw in names {
        let name = raw.to_ascii_lowercase();
        if own.contains(&name) {
            continue;
        }
        let base = distant_sheet_base(&name);
        let sheet = sheets.exact.get(&name).or_else(|| if base != name { sheets.base.get(&base) } else { None });
        if let Some(&(image, tint)) = sheet {
            out.push((name, image, tint));
        }
    }
    out
}

/// `distantAtlasPayloads`: атласы земли дальнего плана файла в цвет травы. `skip` — листы, что уже положил мод.
fn distant_atlas_payloads(res: &Resource, views: &[View], distant: &Distant, skip: &HashSet<String>, clock: &Clock) -> Result<Replacements, String> {
    let mut out = Replacements::default();
    let place = distant.place.as_ref();
    let centre = place.map_or(distant.zone_centre, |place| [place[0], place[1]]);
    let framed = place.is_some_and(|place| place[4] > place[2] && place[5] > place[3]);
    let colour_of = |x: f64, y: f64| -> Option<usize> {
        match &distant.field {
            Some(field) => field.index(x, y),
            None => Some(0),
        }
    };
    let fixed = colour_of(centre[0], centre[1]);
    for view in views {
        if skip.contains(&view.lower) || !is_distant_atlas(&view.lower) || !view.paintable() {
            continue;
        }
        let Some(format) = view.item.format.and_then(dxt_format) else {
            return Err(format!("атлас {} не в DXT", view.item.name));
        };
        let payload = recolour_blocks(res, view, format, |bytes, width, height| {
            let from = Instant::now();
            let colour_at = |px: usize, py: usize| -> Option<usize> {
                match (framed, place) {
                    (true, Some(place)) => colour_of(
                        place[2] + ((px as f64 + 0.5) / width as f64) * (place[4] - place[2]),
                        place[5] - ((py as f64 + 0.5) / height as f64) * (place[5] - place[3]),
                    ),
                    _ => fixed,
                }
            };
            let result = distant_blocks(bytes, format, width, height, distant.greens, distant.sand, distant.albedo, &distant.targets, &colour_at, &mut Oracle::port());
            Clock::add(&clock.pixels, from);
            result
        })?;
        if let Some(payload) = payload {
            out.assign(&view.item.name, payload);
        }
    }
    Ok(out)
}

/// `lawnPayloads`: штатная трава зоны (`lawns`) в свой цвет прямо в блоках DXT.
fn lawn_payloads(res: &Resource, views: &[View], names: &[String], paint: &Paint, skip: &HashSet<String>, clock: &Clock) -> Result<Replacements, String> {
    let wanted: HashSet<&str> = names.iter().map(String::as_str).collect();
    let mut out = Replacements::default();
    let targets = [paint.target];
    for view in views {
        if !wanted.contains(view.lower.as_str()) || skip.contains(&view.lower) || !view.paintable() {
            continue;
        }
        let Some(format) = view.item.format.and_then(dxt_format) else {
            return Err(format!("лист газона {} не в DXT", view.item.name));
        };
        let payload = recolour_blocks(res, view, format, |bytes, width, height| {
            let from = Instant::now();
            let result = distant_blocks(bytes, format, width, height, true, false, 0.2, &targets, &|_, _| Some(0), &mut Oracle::port());
            Clock::add(&clock.pixels, from);
            result
        })?;
        if let Some(payload) = payload {
            out.assign(&view.item.name, payload);
        }
    }
    Ok(out)
}

/* ------------------------------------------------------------------ *
 * Файл целиком
 * ------------------------------------------------------------------ */

/// Итог файла.
pub enum Game {
    /// Файл с новыми листами: байты, виды правок (`kinds`) и счёт для отчёта (`counts`), как у JS.
    Built(GameBuilt),
    /// Ни один лист не изменился.
    Unchanged,
    /// Этот файл собирает приложение прежним кодом.
    Fallback(String),
}

pub struct GameBuilt {
    pub bytes: Vec<u8>,
    pub kinds: Vec<&'static str>,
    pub counts: Vec<(&'static str, u32)>,
}

fn fallback(reason: impl Into<String>) -> Game {
    Game::Fallback(reason.into())
}

fn count(counts: &mut Vec<(&'static str, u32)>, key: &'static str, value: u32) {
    match counts.iter_mut().find(|(name, _)| *name == key) {
        Some(slot) => slot.1 += value,
        None => counts.push((key, value)),
    }
}

/// Файл игры `raw` по заданию `job` (`processVegetationJob`, вид `game`: `green`, `distant`, `lawns`).
pub fn process(raw: &[u8], job: &GameJob, sandy: &Sandy, clock: &Clock) -> Game {
    let Some(kind) = kind_of(&job.name) else {
        return fallback("вид файла не словарь и не модель");
    };
    if raw.len() < HEADER_BYTES {
        return fallback("файл короче заголовка");
    }
    let parse_from = Instant::now();
    let mut res = match open_resource(raw) {
        Ok(res) if res.complete => res,
        Ok(_) => return fallback("данные ресурса короче заявленных"),
        Err(error) => return fallback(error.to_string()),
    };
    let refs = match read_refs(&res, kind) {
        Ok(refs) => refs,
        Err(reason) => return fallback(reason),
    };
    Clock::add(&clock.parse, parse_from);
    if refs.iter().any(|item| item.complete && !item.name.is_ascii()) {
        return fallback("имя листа вне ASCII");
    }
    let (replacements, kinds, counts) = {
        let views = views(&refs);
        let by_lower: HashMap<&str, usize> = views.iter().enumerate().map(|(index, view)| (view.lower.as_str(), index)).collect();
        let mut replacements = Replacements::default();
        let mut kinds: Vec<&'static str> = Vec::new();
        let mut counts: Vec<(&'static str, u32)> = Vec::new();
        let own: HashSet<String> = job.green.iter().flatten().map(|(name, _, _)| name.clone()).collect();
        let paint = job.paint.as_ref();
        let done = (|| -> Result<(), String> {
            if let Some(textures) = &job.green {
                let green = green_sheet_payloads(sandy, &res, &views, &by_lower, textures, paint, clock)?;
                if green.count > 0 {
                    for (name, payload) in green.replacements.0 {
                        replacements.assign(&name, payload);
                    }
                    kinds.push("sandy");
                    count(&mut counts, "sandy", 1);
                    count(&mut counts, "textures", green.count);
                }
            }
            if let Some(distant) = &job.distant {
                let names: Vec<&str> = views.iter().map(|view| view.item.name.as_str()).collect();
                let sheets = if job.country { distant_mod_sheets(&names, &sandy.mod_sheets, &own) } else { Vec::new() };
                let laid = if sheets.is_empty() {
                    Laid { replacements: Replacements::default(), count: 0 }
                } else {
                    green_sheet_payloads(sandy, &res, &views, &by_lower, &sheets, paint, clock)?
                };
                let mut skip = own.clone();
                skip.extend(sheets.iter().map(|(name, _, _)| name.clone()));
                let atlases = distant_atlas_payloads(&res, &views, distant, &skip, clock)?;
                if laid.count > 0 || !atlases.0.is_empty() {
                    for (name, payload) in laid.replacements.0.into_iter().chain(atlases.0) {
                        replacements.assign(&name, payload);
                    }
                    kinds.push("distant");
                    count(&mut counts, "distant", 1);
                    count(&mut counts, "textures", laid.count);
                    count(&mut counts, "distantSheets", laid.count);
                }
            }
            if let (Some(lawns), Some(paint)) = (&job.lawns, paint) {
                let mut skip = own.clone();
                skip.extend(replacements.lowered());
                let lawns = lawn_payloads(&res, &views, lawns, paint, &skip, clock)?;
                let made = lawns.0.len() as u32;
                if made > 0 {
                    for (name, payload) in lawns.0 {
                        replacements.assign(&name, payload);
                    }
                    kinds.push("lawn");
                    count(&mut counts, "lawns", 1);
                    count(&mut counts, "lawnTextures", made);
                }
            }
            Ok(())
        })();
        if let Err(reason) = done {
            return fallback(reason);
        }
        (replacements, kinds, counts)
    };
    if replacements.0.is_empty() {
        return Game::Unchanged;
    }
    /* Два имени, что различаются только регистром: у JS правка берёт позднее по порядку ключей — этот случай собирает приложение. */
    if replacements.lowered().len() != replacements.0.len() {
        return fallback("имена листов различаются регистром");
    }
    match pack_patched(raw, &mut res, &refs, &replacements.0, Some(LEVEL_FALLBACK_BYTES), clock) {
        Ok(bytes) => Game::Built(GameBuilt { bytes, kinds, counts }),
        Err(reason) => fallback(reason),
    }
}

/// Цвет, как он записывается в ключ памяти листов, по байтам (`#rrggbb`).
pub fn hex_colour(rgb: [u8; 3]) -> String {
    format!("#{:02x}{:02x}{:02x}", rgb[0], rgb[1], rgb[2])
}
