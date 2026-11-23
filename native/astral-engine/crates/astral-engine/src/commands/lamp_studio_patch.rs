//! `lamp-studio-patch`: правка огней и светящегося стекла в готовой модели фонаря на месте.
//!
//! Модели из запроса идут по очереди; для каждой работа делится на стадии над общим
//! рабочим местом (`Bench`): разбор описания, проверка правок по прочитанному списку
//! огней, подбор текстур стекла, запись в распакованное тело и сверка пересжатого
//! результата. Всё, что записано в тело, попадает в «журнал записей»: из него
//! берётся `changedBytes`, по нему же проверяется, что записанное легло точно.
//! Первый отказ прекращает всю команду, готовые выходы предыдущих моделей остаются.

use {
    rage_res::{dds, hash::sha256_hex, resource::Resource},
    serde_json::Value,
    std::{
        collections::HashSet,
        fs,
        path::{Path, PathBuf},
    },
};

use super::{fresh_dirs::FreshDirs, lamp_mutations::is_same_file};
use crate::{
    args::Options,
    error::{EngineError, Result},
    model_textures::{embedded_textures, Kind, Texture},
    paths::{existing_file, extension_with_dot, output_file},
    progress::Progress,
};

pub const COMMANDS: &[super::Command] = &[super::Command::new(COMMAND, lamp_studio_patch)];

const COMMAND: &str = "lamp-studio-patch";

/// Пределы запроса: моделей, правок и текстур на модель; длина записи огня (`LightAttributes`);
/// флаги, которые можно только поставить (объём луча и собственный цвет объёма).
struct Limits {
    models: usize,
    edits: usize,
    swaps: usize,
    record: usize,
    settable: u32,
}

const LIMITS: Limits = Limits {
    models: 512,
    edits: 64,
    swaps: 8,
    record: 168,
    settable: 0x1000 | 0x80000,
};

pub fn lamp_studio_patch(options: &Options, _progress: &Progress) -> Result<Value> {
    let specs = read_models(options.required("request")?)?;
    // Папки выходов создаются по ходу работы; отказ убирает те из них, куда так ничего и не легло.
    let created = FreshDirs::merged(
        specs
            .iter()
            .map(|spec| FreshDirs::beside(Ok(text(spec, "output")))),
    );
    let mut written: Vec<PathBuf> = Vec::new();
    let mut models = Vec::with_capacity(specs.len());
    for spec in &specs {
        models.push(patch_model(spec, &mut written)?);
    }
    created.keep();
    let checks = ["reopened", "onlyLightAndGlassBytesChanged", "exactValues"]
        .map(|key| (key, Value::Bool(true)));
    Ok(record([
        ("status", "ready".into()),
        ("mode", COMMAND.into()),
        ("models", models.into()),
        ("validation", record(checks)),
    ]))
}

/// Описания моделей из файла запроса: от одной до 512.
fn read_models(path: &str) -> Result<Vec<Value>> {
    let file = existing_file(path, &[".json"])?;
    let mut request: Value = match serde_json::from_slice(&fs::read(file)?) {
        Ok(parsed) => parsed,
        Err(_) => return Err(refusal("Запрос правки моделей пустой или сломан.")),
    };
    match request.get_mut("lampStudioPatches").map(Value::take) {
        Some(Value::Array(list)) if (1..=LIMITS.models).contains(&list.len()) => Ok(list),
        _ => Err(refusal("lamp-studio-patch needs 1-512 models.")),
    }
}

fn refusal(text: impl Into<String>) -> EngineError {
    EngineError::invalid_data(text)
}

/// Объект ответа из пар «ключ, значение» в заданном порядке.
fn record<'k>(pairs: impl IntoIterator<Item = (&'k str, Value)>) -> Value {
    Value::Object(
        pairs
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect(),
    )
}

/// Строка из ключа описания; не строка и отсутствие читаются как пустая.
fn text<'a>(spec: &'a Value, key: &str) -> &'a str {
    spec[key].as_str().unwrap_or("")
}

/// Список из ключа описания; не список читается как пустой.
fn items<'a>(spec: &'a Value, key: &str) -> &'a [Value] {
    match &spec[key] {
        Value::Array(list) => list,
        _ => &[],
    }
}

/// Значение ключа, если оно задано и не `null`.
fn settled<'a>(spec: &'a Value, key: &str) -> Option<&'a Value> {
    match &spec[key] {
        Value::Null => None,
        other => Some(other),
    }
}

// ---------------------------------------------------------------------------
// Одна модель
// ---------------------------------------------------------------------------

/// `written` — выходы, уже поставленные этим запросом: второй выход в тот же файл отказывает, а не заменяет первый.
fn patch_model(spec: &Value, written: &mut Vec<PathBuf>) -> Result<Value> {
    let label = text(spec, "model");
    let (source, model) = Model::locate(text(spec, "input"))?;
    let target = output_file(
        text(spec, "output"),
        &[extension_with_dot(&source).as_str()],
    )?;
    let (edits, swaps) = read_work(spec, label)?;

    let original = fs::read(&source)?;
    let (sealed, changed) = Bench::open(label, model, &original)?.process(&edits, &swaps)?;
    clash(label, &source, &target, written)?;
    publish(&target, &sealed)?;
    written.push(target.clone());

    Ok(record([
        ("model", label.into()),
        ("output", target.to_string_lossy().into_owned().into()),
        ("inputSha256", sha256_hex(&original).into()),
        ("outputSha256", sha256_hex(&sealed).into()),
        ("outputBytes", sealed.len().into()),
        ("lights", edits.len().into()),
        ("textures", swaps.len().into()),
        ("changedBytes", changed.into()),
    ]))
}

/// Правки огней и замены текстур модели: разбор по порядку, потом пределы числа.
fn read_work(spec: &Value, label: &str) -> Result<(Vec<LightEdit>, Vec<Swap>)> {
    let edits = items(spec, "mutations")
        .iter()
        .map(LightEdit::read)
        .collect::<Result<Vec<_>>>()?;
    let swaps = items(spec, "textures")
        .iter()
        .map(Swap::read)
        .collect::<Result<Vec<_>>>()?;
    let too_much = || {
        refusal(format!(
            "{label}: up to 64 light mutations and 8 textures, at least one of them."
        ))
    };
    match (edits.len(), swaps.len()) {
        (0, 0) => Err(too_much()),
        (many, _) if many > LIMITS.edits => Err(too_much()),
        (_, many) if many > LIMITS.swaps => Err(too_much()),
        _ => Ok((edits, swaps)),
    }
}

/// Выход не должен совпасть со входом и с выходом, уже поставленным этим запросом.
fn clash(label: &str, source: &Path, target: &Path, written: &[PathBuf]) -> Result<()> {
    if is_same_file(source, target) {
        return Err(refusal(format!(
            "{label}: output must not be the input file."
        )));
    }
    let taken = written
        .iter()
        .any(|done| done == target || is_same_file(done, target));
    match taken {
        true => Err(refusal(format!(
            "{label}: output is already written by an earlier model of this request."
        ))),
        false => Ok(()),
    }
}

/// Что за модель: от этого зависит, где лежит список огней и откуда брать рисовалку.
#[derive(Clone, Copy)]
enum Model {
    Fragment,
    Drawable,
}

/// Где в корне ресурса лежит список огней.
struct ListShape {
    name: &'static str,
    pointer_at: usize,
    count_at: usize,
}

/// По порядку вариантов `Model`.
static SHAPES: [ListShape; 2] = [
    ListShape {
        name: "fragment",
        pointer_at: 0x110,
        count_at: 0x118,
    },
    ListShape {
        name: "drawable",
        pointer_at: 0xB0,
        count_at: 0xB8,
    },
];

impl Model {
    /// Существующий файл модели и его вид; словарь `.ydd` отказывается хосту.
    fn locate(input: &str) -> Result<(PathBuf, Self)> {
        let source = existing_file(input, &[".yft", ".ydr", ".ydd"])?;
        let model = match extension_with_dot(&source).to_ascii_lowercase().as_str() {
            ".yft" => Self::Fragment,
            ".ydr" => Self::Drawable,
            _ => return Err(refusal("lamp-studio-patch: ydd пока на хосте")),
        };
        Ok((source, model))
    }

    fn shape(self) -> &'static ListShape {
        &SHAPES[self as usize]
    }

    fn texture_kind(self) -> Kind {
        [Kind::Yft, Kind::Ydr][self as usize]
    }
}

// ---------------------------------------------------------------------------
// Поля записи огня
// ---------------------------------------------------------------------------

#[derive(Clone, Copy)]
enum Slot {
    /// Три байта R, G, B.
    Tint,
    /// `f32` с допустимыми границами.
    Real { lo: f32, hi: f32 },
    /// `u32`: старое значение ИЛИ заданное.
    Flags,
}

struct Field {
    key: &'static str,
    at: usize,
    slot: Slot,
    /// Слово в отказе «did not land» после номера огня.
    lost: &'static str,
}

impl Field {
    const fn real(key: &'static str, at: usize, lo: f32, hi: f32) -> Self {
        Self {
            key,
            at,
            slot: Slot::Real { lo, hi },
            lost: "",
        }
    }

    /// Задано ли поле в правке; неверное значение цвета и флагов отказывает, чисел — пропускается.
    fn read(&self, edit: &Value) -> Result<Option<Given>> {
        let Some(raw) = settled(edit, self.key) else {
            return Ok(None);
        };
        match self.slot {
            Slot::Real { .. } => Ok(raw.as_f64().map(|number| Given::Real(number as f32))),
            Slot::Tint => tint_of(raw)
                .map(|rgb| Some(Given::Tint(rgb)))
                .ok_or_else(|| refusal("lamp-studio-patch: цвет — три байта от 0 до 255.")),
            Slot::Flags => match raw.as_u64() {
                Some(word) if word <= u64::from(u32::MAX) => Ok(Some(Given::Flags(word as u32))),
                _ => Err(refusal(
                    "lamp-studio-patch: флаги огня — целое число до 2^32.",
                )),
            },
        }
    }

    /// Граница чисел и допустимые флаги.
    fn vet(&self, given: &Given) -> Result<()> {
        match (self.slot, given) {
            (Slot::Real { lo, hi }, Given::Real(value)) if !(*value >= lo && *value <= hi) => Err(
                refusal(format!("Light {} {value} is outside {lo}…{hi}.", self.key)),
            ),
            (Slot::Flags, Given::Flags(set)) if set & !LIMITS.settable != 0 => Err(refusal(
                format!("Light flags 0x{set:X} are not allowed to be set."),
            )),
            _ => Ok(()),
        }
    }
}

/// Порядок строк — порядок границ, записи и сверки; разбор цветов и флагов тоже идёт сверху вниз.
static FIELDS: [Field; 10] = [
    Field {
        key: "color",
        at: 0x18,
        slot: Slot::Tint,
        lost: " colour",
    },
    Field::real("intensity", 0x1C, 0.0, 1000.0),
    Field::real("falloff", 0x2C, 0.05, 500.0),
    Field::real("falloffExponent", 0x30, 0.01, 256.0),
    Field::real("coronaIntensity", 0x6C, 0.0, 1000.0),
    Field::real("coronaSize", 0x5C, 0.0, 1000.0),
    Field::real("volumeIntensity", 0x4C, 0.0, 100.0),
    Field::real("volumeSizeScale", 0x50, 0.0, 100.0),
    Field {
        key: "volumeOuterColor",
        at: 0x54,
        slot: Slot::Tint,
        lost: " outer colour",
    },
    Field {
        key: "flagsSet",
        at: 0x20,
        slot: Slot::Flags,
        lost: " flags",
    },
];

/// Цвет: объект с целыми `r`, `g`, `b` от 0 до 255.
fn tint_of(raw: &Value) -> Option<[u8; 3]> {
    let mut rgb = [0u8; 3];
    for (slot, key) in rgb.iter_mut().zip(["r", "g", "b"]) {
        *slot = u8::try_from(raw[key].as_u64()?).ok()?;
    }
    Some(rgb)
}

enum Given {
    Tint([u8; 3]),
    Real(f32),
    Flags(u32),
}

impl Given {
    /// Байты для записи; `word_now` — слово, которое сейчас лежит на месте поля.
    fn encode(&self, word_now: u32) -> Vec<u8> {
        match self {
            Given::Tint(rgb) => rgb.to_vec(),
            Given::Real(value) => value.to_le_bytes().to_vec(),
            Given::Flags(set) => (word_now | set).to_le_bytes().to_vec(),
        }
    }
}

/// Правка одного огня из запроса.
struct LightEdit {
    list: String,
    index: u64,
    given: Vec<(&'static Field, Given)>,
}

impl LightEdit {
    fn read(raw: &Value) -> Result<Self> {
        let Some(index) = raw["index"].as_u64() else {
            return Err(refusal("lamp-studio-patch: индекс огня — целое число."));
        };
        let mut given = Vec::new();
        for field in &FIELDS {
            if let Some(value) = field.read(raw)? {
                given.push((field, value));
            }
        }
        Ok(Self {
            list: text(raw, "list").to_owned(),
            index,
            given,
        })
    }
}

/// Замена встроенной текстуры: имя и файл DDS.
struct Swap {
    name: String,
    source: PathBuf,
}

impl Swap {
    fn read(raw: &Value) -> Result<Self> {
        Ok(Self {
            name: text(raw, "name").to_owned(),
            source: existing_file(text(raw, "source"), &[".dds"])?,
        })
    }
}

// ---------------------------------------------------------------------------
// Рабочее место
// ---------------------------------------------------------------------------

/// Список огней модели: имя, где лежит и сколько. Нет списка — пустое имя и ноль огней.
struct LightList {
    name: &'static str,
    base: usize,
    count: usize,
}

/// Запись в тело ресурса: где, что и какой отказ, если она не легла.
struct Landed {
    at: usize,
    bytes: Vec<u8>,
    lost: String,
}

/// Текстура, выбранная под замену.
struct Pick {
    at: usize,
    bytes: Vec<u8>,
    lost: String,
}

struct Bench<'a> {
    label: &'a str,
    model: Model,
    res: Resource,
    list: LightList,
    ledger: Vec<Landed>,
}

impl<'a> Bench<'a> {
    fn open(label: &'a str, model: Model, original: &[u8]) -> Result<Self> {
        let res = Resource::parse(original)?;
        let shape = model.shape();
        let mut list = LightList {
            name: "",
            base: 0,
            count: 0,
        };
        if let Some(root) = res.root() {
            if let Some(base) = res.pointer_at(root + shape.pointer_at) {
                list = LightList {
                    name: shape.name,
                    base,
                    count: usize::from(res.u16(root + shape.count_at)?),
                };
            }
        }
        Ok(Self {
            label,
            model,
            res,
            list,
            ledger: Vec::new(),
        })
    }

    /// Все стадии по порядку; отдаёт готовый файл и число записанных байт.
    fn process(mut self, edits: &[LightEdit], swaps: &[Swap]) -> Result<(Vec<u8>, usize)> {
        let spots = self.vet_lights(edits)?;
        let glass = self.pick_glass(swaps)?;
        self.write_lights(edits, &spots);
        self.write_glass(glass);
        let changed = self.changed_bytes();
        Ok((self.seal()?, changed))
    }

    /// Проверяет правки по порядку и отдаёт начало записи каждого огня.
    fn vet_lights(&self, edits: &[LightEdit]) -> Result<Vec<usize>> {
        let mut met = HashSet::new();
        edits
            .iter()
            .map(|edit| self.vet_edit(edit, &mut met))
            .collect()
    }

    /// Правила по порядку: повтор, список, номер, место в ресурсе, потом числа и флаги.
    fn vet_edit<'e>(
        &self,
        edit: &'e LightEdit,
        met: &mut HashSet<(&'e str, u64)>,
    ) -> Result<usize> {
        let (label, list, index) = (self.label, edit.list.as_str(), edit.index);
        match () {
            _ if !met.insert((list, index)) => Err(refusal(format!(
                "{label}: light {list}#{index} is mutated twice."
            ))),
            _ if list != self.list.name => Err(refusal(format!("{label}: no light list {list}."))),
            _ if index >= self.list.count as u64 => {
                Err(refusal(format!("{label}: light {index} is out of range.")))
            }
            _ => {
                let start = self.list.base + index as usize * LIMITS.record;
                if start + LIMITS.record > self.res.len() {
                    return Err(refusal(format!(
                        "{}: light {index} lies outside the resource.",
                        self.list.name
                    )));
                }
                edit.given
                    .iter()
                    .try_for_each(|(field, given)| field.vet(given))?;
                Ok(start)
            }
        }
    }

    /// Текстуры модели читаются всегда; затем для каждой замены имя, место, DDS и совпадение раскладки.
    fn pick_glass(&self, swaps: &[Swap]) -> Result<Vec<Pick>> {
        let present = embedded_textures(&self.res, self.model.texture_kind())?;
        swaps
            .iter()
            .map(|swap| self.pick_one(&present, swap))
            .collect()
    }

    fn pick_one(&self, present: &[Texture], swap: &Swap) -> Result<Pick> {
        let (label, name) = (self.label, swap.name.as_str());
        let Some(found) = present
            .iter()
            .position(|texture| texture.name.eq_ignore_ascii_case(name))
        else {
            return Err(refusal(format!("{label}: no embedded texture {name}.")));
        };
        let texture = &present[found];
        let end = texture.data_at.checked_add(texture.payload_len);
        if end.is_none_or(|end| end > self.res.len()) {
            return Err(refusal(format!(
                "{label}: texture {name} lies outside the resource."
            )));
        }
        let image = dds::parse(&fs::read(&swap.source)?)?;
        if !same_layout(&image, texture) {
            let layout = format!(
                "{:?} {}x{}, {} levels",
                texture.format, texture.width, texture.height, texture.levels
            );
            return Err(refusal(format!(
                "{label}: texture {name} must stay {layout}."
            )));
        }
        let Some(head) = image.payload.get(..texture.payload_len) else {
            return Err(refusal(format!(
                "{label}: texture {name} replacement is shorter than the original."
            )));
        };
        Ok(Pick {
            at: texture.data_at,
            bytes: head.to_vec(),
            lost: format!("{label}: texture {name} did not land."),
        })
    }

    fn write_lights(&mut self, edits: &[LightEdit], spots: &[usize]) {
        for (edit, &start) in edits.iter().zip(spots) {
            for (field, given) in &edit.given {
                let at = start + field.at;
                let bytes = given.encode(self.word_at(at));
                let lost = format!(
                    "{}: light {}{} did not land.",
                    self.label, edit.index, field.lost
                );
                self.put(at, bytes, lost);
            }
        }
    }

    fn write_glass(&mut self, picks: Vec<Pick>) {
        for pick in picks {
            self.put(pick.at, pick.bytes, pick.lost);
        }
    }

    fn word_at(&self, at: usize) -> u32 {
        let data = self.res.data();
        u32::from_le_bytes([data[at], data[at + 1], data[at + 2], data[at + 3]])
    }

    /// Пишет в распакованное тело и записывает это в журнал.
    fn put(&mut self, at: usize, bytes: Vec<u8>, lost: String) {
        self.res.data_mut()[at..at + bytes.len()].copy_from_slice(&bytes);
        self.ledger.push(Landed { at, bytes, lost });
    }

    fn changed_bytes(&self) -> usize {
        self.ledger.iter().map(|landed| landed.bytes.len()).sum()
    }

    /// Пересжимает тело, открывает результат заново и сверяет с журналом каждую запись.
    fn seal(self) -> Result<Vec<u8>> {
        let file = self.res.to_file_bytes()?;
        let reopened = Resource::parse(&file)?;
        let body = reopened.data();
        let missing = self.ledger.iter().find(|landed| {
            body.get(landed.at..landed.at + landed.bytes.len()) != Some(&landed.bytes[..])
        });
        match missing {
            Some(landed) => Err(refusal(landed.lost.clone())),
            None => Ok(file),
        }
    }
}

/// Формат, размеры и число уровней DDS обязаны остаться как у текстуры модели.
fn same_layout(image: &dds::Dds, texture: &Texture) -> bool {
    image.format == texture.format
        && image.width == u32::from(texture.width)
        && image.height == u32::from(texture.height)
        && image.levels == texture.levels
}

/// Выход пишется через временный файл рядом и переименование поверх; при сбое временный файл удаляется.
fn publish(target: &Path, bytes: &[u8]) -> Result<()> {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |since| since.as_nanos());
    let mut scratch = target.as_os_str().to_owned();
    scratch.push(format!(".lamp-studio-{}-{stamp}", std::process::id()));
    match fs::write(&scratch, bytes).and_then(|()| fs::rename(&scratch, target)) {
        Ok(()) => Ok(()),
        Err(failure) => {
            let _ = fs::remove_file(&scratch);
            Err(failure.into())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rage_res::resource::{deflate_zlib9, GRAPHICS_BASE, RSC7_MAGIC, SYSTEM_BASE};
    use rage_res::texture::Format;
    use serde_json::json;

    // --- сборка моделей: системная часть 0x4000, графическая 0x1000 ---

    /// Длина записи огня задана здесь своим числом: сверка не должна зависеть от константы модуля.
    const RECORD_BYTES: usize = 168;
    const SYSTEM_FLAGS: u32 = 0xA004_0000;
    const GRAPHICS_FLAGS: u32 = 0x2100_0000;
    const SYSTEM_LEN: usize = 0x4000;
    const GRAPHICS_LEN: usize = 0x1000;
    const DRAWABLE_AT: usize = 0x200;
    const GROUP_AT: usize = 0x300;
    const DICTIONARY_AT: usize = 0x340;
    const LIST_AT: usize = 0x380;
    const OBJECT_AT: [usize; 3] = [0x400, 0x480, 0x500];
    const NAME_AT: [usize; 3] = [0x600, 0x620, 0x640];
    const LIGHTS_AT: usize = 0x800;
    /// Имя, формат, ширина, высота, уровни, место данных в графической части.
    const GLASS: [(&str, Format, u16, u16, u8, usize); 3] = [
        ("Lamp_Glass_A", Format::Dxt1, 16, 16, 3, 0x000),
        ("lamp_b", Format::Dxt5, 8, 8, 1, 0x0B0),
        ("lamp_c", Format::A8R8G8B8, 8, 8, 2, 0x0F0),
    ];

    fn put_bytes(body: &mut [u8], at: usize, bytes: &[u8]) {
        body[at..at + bytes.len()].copy_from_slice(bytes);
    }

    fn put_u16(body: &mut [u8], at: usize, value: u16) {
        put_bytes(body, at, &value.to_le_bytes());
    }

    fn put_u32(body: &mut [u8], at: usize, value: u32) {
        put_bytes(body, at, &value.to_le_bytes());
    }

    fn put_u64(body: &mut [u8], at: usize, value: u64) {
        put_bytes(body, at, &value.to_le_bytes());
    }

    fn sys(at: usize) -> u64 {
        SYSTEM_BASE + at as u64
    }

    fn gfx(at: usize) -> u64 {
        GRAPHICS_BASE + at as u64
    }

    /// Тело модели: фрагмент или рисовалка, число огней и число стёкол (первых из `GLASS`).
    fn blank(fragment: bool, lights: u16, glass: usize) -> Vec<u8> {
        let mut body = vec![0u8; SYSTEM_LEN + GRAPHICS_LEN];
        let (light_pointer, count_at, owner) = if fragment {
            (0x110, 0x118, DRAWABLE_AT)
        } else {
            (0xB0, 0xB8, 0)
        };
        if lights > 0 {
            put_u64(&mut body, light_pointer, sys(LIGHTS_AT));
        }
        put_u16(&mut body, count_at, lights);
        if glass > 0 {
            if fragment {
                put_u64(&mut body, 0x30, sys(DRAWABLE_AT));
            }
            put_u64(&mut body, owner + 0x10, sys(GROUP_AT));
            put_u64(&mut body, GROUP_AT + 0x08, sys(DICTIONARY_AT));
            put_u64(&mut body, DICTIONARY_AT + 0x30, sys(LIST_AT));
            put_u16(&mut body, DICTIONARY_AT + 0x38, glass as u16);
        }
        for (n, &(name, format, width, height, levels, data_at)) in
            GLASS.iter().take(glass).enumerate()
        {
            put_u64(&mut body, LIST_AT + n * 8, sys(OBJECT_AT[n]));
            let object = OBJECT_AT[n];
            put_u64(&mut body, object + 0x28, sys(NAME_AT[n]));
            put_bytes(&mut body, NAME_AT[n], name.as_bytes());
            put_u16(&mut body, object + 0x50, width);
            put_u16(&mut body, object + 0x52, height);
            put_u16(&mut body, object + 0x56, width * 2);
            put_u32(&mut body, object + 0x58, format.code());
            body[object + 0x5D] = levels;
            put_u64(&mut body, object + 0x70, gfx(data_at));
        }
        for index in 0..usize::from(lights) {
            let start = LIGHTS_AT + index * RECORD_BYTES;
            for (offset, byte) in body[start..start + RECORD_BYTES].iter_mut().enumerate() {
                *byte = (index * 53 + offset * 7 + 11) as u8;
            }
            // у огня 1 цвет 1,2,3 и флаг 0x1000, у огня 2 флаг 0x80000, у огня 0 флагов нет
            put_u32(&mut body, start + 0x20, [0, 0x1000, 0x80000][index.min(2)]);
            if index == 1 {
                put_bytes(&mut body, start + 0x18, &[1, 2, 3]);
            }
        }
        for (offset, byte) in body[SYSTEM_LEN..].iter_mut().enumerate() {
            *byte = (offset * 5) as u8 ^ 0x5A;
        }
        // данные стёкол в графической части лежат поверх узора
        body
    }

    fn file_of(body: &[u8], declared: u32) -> Vec<u8> {
        let mut out = Vec::new();
        for word in [RSC7_MAGIC, declared, SYSTEM_FLAGS, GRAPHICS_FLAGS] {
            out.extend(word.to_le_bytes());
        }
        out.extend(deflate_zlib9(body));
        out
    }

    fn frag3_body() -> Vec<u8> {
        blank(true, 3, 3)
    }

    fn drw2_body() -> Vec<u8> {
        blank(false, 2, 1)
    }

    /// Поле `body[at..]` как слово: нужно сверять записанное с узором.
    fn after(body: &[u8], writes: &[(usize, &[u8])]) -> Vec<u8> {
        let mut out = body.to_vec();
        for (at, bytes) in writes {
            put_bytes(&mut out, *at, bytes);
        }
        out
    }

    fn real(value: f32) -> [u8; 4] {
        value.to_le_bytes()
    }

    fn body_of(file: &[u8]) -> Vec<u8> {
        Resource::parse(file).unwrap().data().to_vec()
    }

    // --- DDS ---

    fn pattern(len: usize, seed: u8) -> Vec<u8> {
        (0..len)
            .map(|n| (n as u8).wrapping_mul(13).wrapping_add(seed))
            .collect()
    }

    fn dds_header(fourcc: &[u8; 4], width: u32, height: u32, mips: u32) -> Vec<u8> {
        let mut head = vec![0u8; 128];
        put_bytes(&mut head, 0, b"DDS ");
        put_u32(&mut head, 4, 124);
        put_u32(&mut head, 8, 0x1007 | if mips > 0 { 0x2_0000 } else { 0 });
        put_u32(&mut head, 12, height);
        put_u32(&mut head, 16, width);
        put_u32(&mut head, 28, mips);
        put_u32(&mut head, 76, 32);
        put_u32(&mut head, 80, 4);
        put_bytes(&mut head, 84, fourcc);
        head
    }

    fn dds_of(fourcc: &[u8; 4], width: u32, height: u32, mips: u32, payload: &[u8]) -> Vec<u8> {
        [dds_header(fourcc, width, height, mips), payload.to_vec()].concat()
    }

    fn argb_dds(width: u32, height: u32, mips: u32, payload: &[u8]) -> Vec<u8> {
        let mut head = dds_header(&[0; 4], width, height, mips);
        put_u32(&mut head, 80, 0x41);
        put_u32(&mut head, 88, 32);
        for (at, mask) in [
            (92, 0x00ff_0000u32),
            (96, 0x0000_ff00),
            (100, 0x0000_00ff),
            (104, 0xff00_0000),
        ] {
            put_u32(&mut head, at, mask);
        }
        [head, payload.to_vec()].concat()
    }

    fn a_payload() -> Vec<u8> {
        pattern(168, 1)
    }

    fn b_payload() -> Vec<u8> {
        pattern(64, 2)
    }

    fn c_payload() -> Vec<u8> {
        pattern(320, 3)
    }

    // --- рабочее место ---

    struct Lab {
        dir: tempfile::TempDir,
    }

    type Failure = (String, String);

    impl Lab {
        fn new() -> Self {
            Self {
                dir: tempfile::tempdir().unwrap(),
            }
        }

        fn path(&self, name: &str) -> PathBuf {
            name.split('/')
                .fold(self.dir.path().to_path_buf(), |path, part| path.join(part))
        }

        fn text(&self, name: &str) -> String {
            self.path(name).display().to_string()
        }

        fn put(&self, name: &str, bytes: &[u8]) -> String {
            let path = self.path(name);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, bytes).unwrap();
            path.display().to_string()
        }

        fn read(&self, name: &str) -> Vec<u8> {
            fs::read(self.path(name)).unwrap()
        }

        fn exists(&self, name: &str) -> bool {
            self.path(name).exists()
        }

        fn run(&self, request: &Value) -> Result<Value> {
            let path = self.put("req.json", request.to_string().as_bytes());
            self.args(&["--request", &path])
        }

        fn args(&self, args: &[&str]) -> Result<Value> {
            let argv: Vec<String> = args.iter().map(|arg| arg.to_string()).collect();
            lamp_studio_patch(&Options::parse(&argv)?, &Progress::silent())
        }

        /// Стандартные входы: модели в `models`, DDS в `dds`.
        fn stock(&self) {
            self.put("models/frag3.yft", &file_of(&frag3_body(), 162));
            self.put("models/drw2.ydr", &file_of(&drw2_body(), 165));
            self.put("models/frag1.yft", &file_of(&blank(true, 1, 0), 162));
            self.put("dds/a.dds", &dds_of(b"DXT1", 16, 16, 3, &a_payload()));
            self.put("dds/a2.dds", &dds_of(b"DXT1", 16, 16, 3, &pattern(168, 9)));
            self.put("dds/b.dds", &dds_of(b"DXT5", 8, 8, 1, &b_payload()));
            self.put("dds/c.dds", &argb_dds(8, 8, 2, &c_payload()));
        }
    }

    fn failure(result: Result<Value>) -> Failure {
        let error = result.unwrap_err();
        (error.code, error.message)
    }

    fn invalid(text: &str) -> Failure {
        ("InvalidDataException".into(), text.into())
    }

    fn request(specs: Vec<Value>) -> Value {
        json!({ "lampStudioPatches": specs })
    }

    fn spec(lab: &Lab, input: &str, output: &str, model: &str) -> Value {
        json!({ "input": lab.text(input), "output": lab.text(output), "model": model })
    }

    fn with(mut spec: Value, key: &str, value: Value) -> Value {
        spec[key] = value;
        spec
    }

    fn tint(r: u8, g: u8, b: u8) -> Value {
        json!({ "r": r, "g": g, "b": b })
    }

    fn light(index: u64, fields: Value) -> Value {
        let mut edit = json!({ "list": "fragment", "index": index });
        for (key, value) in fields.as_object().unwrap() {
            edit[key] = value.clone();
        }
        edit
    }

    fn intensity(value: f64) -> Value {
        light(0, json!({ "intensity": value }))
    }

    /// Модель frag3 с правками огней: запрос из одной модели.
    fn edit_frag3(lab: &Lab, edits: Vec<Value>) -> Result<Value> {
        let model = with(
            spec(lab, "models/frag3.yft", "out/m.yft", "m"),
            "mutations",
            json!(edits),
        );
        lab.run(&request(vec![model]))
    }

    fn first(done: &Value) -> &Value {
        &done["models"][0]
    }

    // ------------------------------------------------------------------------------------------

    #[test]
    fn registry() {
        let names: Vec<&str> = COMMANDS.iter().map(|command| command.name).collect();
        assert_eq!(names, ["lamp-studio-patch"]);
    }

    #[test]
    fn the_request_is_read_as_a_json_file_with_1_to_512_models() {
        let lab = Lab::new();
        lab.stock();
        assert_eq!(failure(lab.args(&[])).1, "--request is required.");
        assert_eq!(
            failure(lab.args(&["--request", &lab.text("нет.json")])),
            (
                "FileNotFoundException".into(),
                format!("File was not found: {}", lab.text("нет.json"))
            )
        );
        let text = lab.put("req.txt", b"{}");
        assert_eq!(
            failure(lab.args(&["--request", &text])).1,
            "Unsupported file extension: .txt"
        );
        assert_eq!(
            failure(lab.args(&["--request", ""])).1,
            "The path is empty."
        );
        fs::create_dir_all(lab.path("d.json")).unwrap();
        assert_eq!(
            failure(lab.args(&["--request", &lab.text("d.json")])).0,
            "FileNotFoundException"
        );

        let broken = invalid("Запрос правки моделей пустой или сломан.");
        let path = |bytes: &[u8]| lab.put("req.json", bytes);
        for bytes in [&b""[..], b"nope", b"\xEF\xBB\xBF{}"] {
            assert_eq!(failure(lab.args(&["--request", &path(bytes)])), broken);
        }
        let ok = request(vec![with(
            spec(&lab, "models/frag3.yft", "out/m.yft", "m"),
            "mutations",
            json!([intensity(2.0)]),
        )]);
        // число вне диапазона ломает весь запрос
        let huge = ok
            .to_string()
            .replace("\"intensity\":2.0", "\"intensity\":1e999");
        assert!(huge.contains("1e999"));
        assert_eq!(
            failure(lab.args(&["--request", &path(huge.as_bytes())])),
            broken
        );

        let needs = invalid("lamp-studio-patch needs 1-512 models.");
        for body in [
            "5",
            "[]",
            "{}",
            r#"{"lampStudioPatches":[]}"#,
            r#"{"lampStudioPatches":{}}"#,
            r#"{"lampStudioPatches":null}"#,
        ] {
            assert_eq!(
                failure(lab.args(&["--request", &path(body.as_bytes())])),
                needs,
                "{body}"
            );
        }
        let many = |count: usize| request(vec![json!({}); count]);
        assert_eq!(failure(lab.run(&many(513))), needs);
        // 512 пустых моделей: отказ по первой
        assert_eq!(
            failure(lab.run(&many(512))),
            ("ArgumentException".into(), "The path is empty.".into())
        );
        assert_eq!(
            failure(lab.run(&request(vec![json!(5), json!(null), json!("x")]))),
            ("ArgumentException".into(), "The path is empty.".into())
        );
        // повторённый ключ: берётся последний
        let one = ok.to_string();
        let doubled = format!("{},\"lampStudioPatches\":[]}}", &one[..one.len() - 1]);
        assert_eq!(
            failure(lab.args(&["--request", &path(doubled.as_bytes())])),
            needs
        );
        // лишние ключи запроса игнорируются
        let extra = format!("{{\"mode\":\"другое\",\"extra\":1,{}", &one[1..]);
        let done = lab.args(&["--request", &path(extra.as_bytes())]).unwrap();
        assert_eq!(first(&done)["changedBytes"], 4);
        // имя параметра в другом регистре и повтор: берётся последний; лишний параметр
        let empty = path(br#"{"lampStudioPatches":[]}"#);
        let good = lab.put("good.json", one.as_bytes());
        let done = lab
            .args(&["--REQUEST", &empty, "--Request", &good, "--other", "x"])
            .unwrap();
        assert_eq!(first(&done)["lights"], 1);
        // расширение запроса в верхнем регистре
        let upper = lab.put("REQ.JSON", one.as_bytes());
        assert!(lab.args(&["--request", &upper]).is_ok());
    }

    /// Путь относительно текущей папки процесса, если он на том же диске.
    fn relative_from_cwd(target: &Path) -> Option<String> {
        let cwd = std::env::current_dir().ok()?;
        let (here, there): (Vec<_>, Vec<_>) =
            (cwd.components().collect(), target.components().collect());
        if here.first() != there.first() {
            return None;
        }
        let common = here
            .iter()
            .zip(&there)
            .take_while(|(left, right)| left == right)
            .count();
        let mut out = PathBuf::new();
        (common..here.len()).for_each(|_| out.push(".."));
        there[common..].iter().for_each(|part| out.push(part));
        Some(out.display().to_string())
    }

    #[test]
    fn relative_paths_are_taken_from_the_process_folder() {
        let lab = Lab::new();
        lab.stock();
        let (Some(request_path), Some(input), Some(output)) = (
            relative_from_cwd(&lab.path("rel.json")),
            relative_from_cwd(&lab.path("models/frag3.yft")),
            relative_from_cwd(&lab.path("rel/./x/../m.yft")),
        ) else {
            return;
        };
        let body = request(vec![json!({
            "input": input, "output": output, "model": "m",
            "mutations": [intensity(2.0)],
        })]);
        fs::write(lab.path("rel.json"), body.to_string()).unwrap();
        let done = lab.args(&["--request", &request_path]).unwrap();
        assert_eq!(first(&done)["output"], lab.text("rel/m.yft"));
        assert!(lab.exists("rel/m.yft"));
    }

    #[test]
    fn input_and_output_paths() {
        let lab = Lab::new();
        lab.stock();
        let edit = json!([intensity(2.0)]);
        let model = |input: Value, output: Value| {
            let mut one = json!({ "model": "m", "mutations": edit });
            if !input.is_null() {
                one["input"] = input;
            }
            if !output.is_null() {
                one["output"] = output;
            }
            request(vec![one])
        };
        let frag3 = json!(lab.text("models/frag3.yft"));
        let empty_path = (
            "ArgumentException".to_owned(),
            "The path is empty.".to_owned(),
        );
        assert_eq!(
            failure(lab.run(&model(Value::Null, json!(lab.text("o.yft"))))),
            empty_path
        );
        assert_eq!(
            failure(lab.run(&model(json!(5), json!(lab.text("o.yft"))))),
            empty_path
        );
        assert_eq!(
            failure(lab.run(&model(json!("   "), json!(lab.text("o.yft"))))),
            empty_path
        );
        assert_eq!(
            failure(lab.run(&model(frag3.clone(), Value::Null))),
            empty_path
        );
        let gone = lab.text("нет.yft");
        assert_eq!(
            failure(lab.run(&model(json!(gone), json!(lab.text("o.yft"))))),
            (
                "FileNotFoundException".into(),
                format!("File was not found: {gone}")
            )
        );
        fs::create_dir_all(lab.path("d.yft")).unwrap();
        assert_eq!(
            failure(lab.run(&model(json!(lab.text("d.yft")), json!(lab.text("o.yft"))))).0,
            "FileNotFoundException"
        );
        let txt = lab.put("m.txt", b"x");
        assert_eq!(
            failure(lab.run(&model(json!(txt), json!(lab.text("o.yft"))))).1,
            "Unsupported file extension: .txt"
        );
        // словарь .ydd отказывается хосту, раньше проверки выхода
        let ydd = lab.put("models/dict.ydd", &file_of(&drw2_body(), 165));
        let host = invalid("lamp-studio-patch: ydd пока на хосте");
        assert_eq!(
            failure(lab.run(&model(json!(ydd.clone()), json!(lab.text("out/m.ydd"))))),
            host
        );
        assert_eq!(
            failure(lab.run(&model(json!(ydd), json!(lab.text("out/m"))))),
            host
        );
        assert!(!lab.exists("out"), "папки выхода для .ydd не создаются");
        // расширение выхода
        assert_eq!(
            failure(lab.run(&model(frag3.clone(), json!(lab.text("out/m.ydr"))))),
            (
                "ArgumentException".into(),
                "Unsupported output extension: .ydr".into()
            )
        );
        assert_eq!(
            failure(lab.run(&model(frag3.clone(), json!(lab.text("out/m"))))),
            (
                "ArgumentException".into(),
                "Unsupported output extension: ".into()
            )
        );
        // выход в новых вложенных папках; верхний регистр расширений
        let upper_in = lab.put("IN.YFT", &file_of(&frag3_body(), 162));
        let done = lab
            .run(&model(json!(upper_in), json!(lab.text("out/OUT.YFT"))))
            .unwrap();
        assert_eq!(first(&done)["outputBytes"], lab.read("out/OUT.YFT").len());
        assert!(lab.exists("out/OUT.YFT"));
        lab.run(&model(frag3.clone(), json!(lab.text("a/b/c/m.yft"))))
            .unwrap();
        assert!(lab.path("a/b/c").is_dir());
        // выход совпадает со входом: раньше вход заменялся, теперь отказ, вход цел
        let same = lab.put("in.yft", &file_of(&frag3_body(), 162));
        let before = lab.read("in.yft");
        assert_eq!(
            failure(lab.run(&model(json!(same.clone()), json!(same)))),
            invalid("m: output must not be the input file.")
        );
        assert_eq!(lab.read("in.yft"), before);
        // то же под другим написанием пути (регистр букв, `..`)
        let spelled = lab.text("sub/../in.yft");
        assert_eq!(
            failure(lab.run(&model(json!(lab.text("in.yft")), json!(spelled)))),
            invalid("m: output must not be the input file.")
        );
        assert_eq!(lab.read("in.yft"), before);
        // выход уже существует: заменяется целиком
        lab.put("out/old.yft", b"old contents that are longer than nothing");
        lab.run(&model(frag3.clone(), json!(lab.text("out/old.yft"))))
            .unwrap();
        assert_eq!(lab.read("out/old.yft")[..4], RSC7_MAGIC.to_le_bytes());
        // отказ после создания папок: папки остаются, файла нет
        let bad_index = request(vec![json!({
            "input": lab.text("models/frag3.yft"), "output": lab.text("made/deep/m.yft"), "model": "m",
            "mutations": [light(9, json!({}))],
        })]);
        assert_eq!(
            failure(lab.run(&bad_index)),
            invalid("m: light 9 is out of range.")
        );
        // раньше созданные ради выхода папки оставались пустыми
        assert!(!lab.exists("made"));
        if cfg!(windows) {
            // выход — существующий каталог с именем .yft; лишних файлов не остаётся
            fs::create_dir_all(lab.path("blocked/m.yft")).unwrap();
            let code = failure(lab.run(&model(frag3.clone(), json!(lab.text("blocked/m.yft"))))).0;
            assert_eq!(code, "UnauthorizedAccessException");
            let leftovers = fs::read_dir(lab.path("blocked")).unwrap().count();
            assert_eq!(leftovers, 1, "временный файл удалён");
            // родитель выхода — обычный файл
            lab.put("blocker", b"x");
            let result = lab.run(&model(frag3, json!(lab.text("blocker/m.yft"))));
            assert_eq!(failure(result).0, "IOException");
        }
    }

    #[test]
    fn mutation_fields_are_parsed_strictly_and_counts_are_limited() {
        let lab = Lab::new();
        lab.stock();
        let one_in = |mutations: Value, textures: Value| {
            let mut model = spec(&lab, "models/frag3.yft", "out/m.yft", "m");
            if !mutations.is_null() {
                model["mutations"] = mutations;
            }
            if !textures.is_null() {
                model["textures"] = textures;
            }
            lab.run(&request(vec![model]))
        };
        let limit = invalid("m: up to 64 light mutations and 8 textures, at least one of them.");
        assert_eq!(failure(one_in(Value::Null, Value::Null)), limit);
        assert_eq!(failure(one_in(json!([]), json!([]))), limit);
        assert_eq!(
            failure(one_in(json!({ "list": "fragment" }), Value::Null)),
            limit
        );
        let named = request(vec![json!({
            "input": lab.text("models/frag3.yft"), "output": lab.text("out/m.yft"), "model": "",
        })]);
        assert_eq!(
            failure(lab.run(&named)),
            invalid(": up to 64 light mutations and 8 textures, at least one of them.")
        );
        // 65 правок: отказ по числу раньше чтения входа
        let sixty_five: Vec<Value> = (0..65).map(|n| light(n, json!({}))).collect();
        assert_eq!(failure(one_in(json!(sixty_five), Value::Null)), limit);
        // 9 текстур
        let swap = |name: &str| json!({ "name": name, "source": lab.text("dds/b.dds") });
        let nine: Vec<Value> = (0..9).map(|n| swap(&format!("t{n}"))).collect();
        assert_eq!(failure(one_in(Value::Null, json!(nine))), limit);
        // источник текстуры проверяется раньше числа
        let mut missing = nine.clone();
        missing.push(json!({ "name": "x", "source": lab.text("нет.dds") }));
        assert_eq!(
            failure(one_in(Value::Null, json!(missing))),
            (
                "FileNotFoundException".into(),
                format!("File was not found: {}", lab.text("нет.dds"))
            )
        );
        // 8 замен одной текстуры одними данными принимаются, каждая считается
        let eight: Vec<Value> = (0..8).map(|_| swap("lamp_b")).collect();
        let done = one_in(Value::Null, json!(eight)).unwrap();
        assert_eq!(
            (
                first(&done)["textures"].as_u64(),
                first(&done)["changedBytes"].as_u64()
            ),
            (Some(8), Some(512))
        );

        let index = invalid("lamp-studio-patch: индекс огня — целое число.");
        let broken_index = |raw: &str| {
            let text = format!(r#"[{{"list":"fragment","index":{raw}}}]"#);
            one_in(serde_json::from_str(&text).unwrap(), Value::Null)
        };
        for raw in [
            "-1",
            "1.5",
            "\"0\"",
            "null",
            "18446744073709552000",
            "true",
            "1e0",
            "0.0",
            "[0]",
        ] {
            assert_eq!(failure(broken_index(raw)), index, "{raw}");
        }
        assert_eq!(
            failure(one_in(json!([{ "list": "fragment" }]), Value::Null)),
            index
        );
        assert_eq!(failure(one_in(json!([5]), Value::Null)), index);
        assert_eq!(
            failure(one_in(
                json!([light(0, json!({})), { "list": "fragment" }]),
                Value::Null
            )),
            index
        );
        let source = json!([{ "name": "x", "source": lab.text("dds/нет.dds") }]);
        assert_eq!(
            failure(one_in(json!([{ "list": "fragment" }]), source)),
            index
        );
        assert!(broken_index("1").is_ok());

        let colour = invalid("lamp-studio-patch: цвет — три байта от 0 до 255.");
        for key in ["color", "volumeOuterColor"] {
            for raw in [
                r#"{"r":256,"g":0,"b":0}"#,
                r#"{"r":-1,"g":0,"b":0}"#,
                r#"{"r":1.5,"g":0,"b":0}"#,
                r#"{"r":1}"#,
                "{}",
                r#""red""#,
                "[1,2,3]",
                r#"{"r":"1","g":2,"b":3}"#,
                r#"{"r":0,"g":256,"b":0}"#,
            ] {
                let value: Value = serde_json::from_str(raw).unwrap();
                assert_eq!(
                    failure(one_in(
                        json!([light(0, json!({ key: value }))]),
                        Value::Null
                    )),
                    colour,
                    "{key} {raw}"
                );
            }
            for raw in [
                "null",
                r#"{"r":1,"g":2,"b":3,"a":9}"#,
                r#"{"r":255,"g":0,"b":128}"#,
            ] {
                let value: Value = serde_json::from_str(raw).unwrap();
                assert!(
                    one_in(json!([light(0, json!({ key: value }))]), Value::Null).is_ok(),
                    "{key} {raw}"
                );
            }
        }
        // цвет раньше внешнего цвета объёма, внешний цвет — раньше флагов
        let tangled = light(
            0,
            json!({ "color": "x", "volumeOuterColor": "y", "flagsSet": "z" }),
        );
        assert_eq!(failure(one_in(json!([tangled]), Value::Null)), colour);
        let tangled = light(0, json!({ "volumeOuterColor": "y", "flagsSet": "z" }));
        assert_eq!(failure(one_in(json!([tangled]), Value::Null)), colour);
        let flags = invalid("lamp-studio-patch: флаги огня — целое число до 2^32.");
        for raw in ["-1", "4294967296", "1.5", "\"4096\"", "true"] {
            let value: Value = serde_json::from_str(raw).unwrap();
            assert_eq!(
                failure(one_in(
                    json!([light(0, json!({ "flagsSet": value }))]),
                    Value::Null
                )),
                flags,
                "{raw}"
            );
        }
        assert!(one_in(json!([light(0, json!({ "flagsSet": null }))]), Value::Null).is_ok());
        // числовые поля не чисел молча пропускаются, правка без полей считается
        let skipped = light(
            0,
            json!({ "intensity": "5", "falloff": null, "falloffExponent": true, "coronaIntensity": [1],
                    "coronaSize": {}, "volumeIntensity": "x", "volumeSizeScale": false }),
        );
        let done = one_in(json!([skipped]), Value::Null).unwrap();
        assert_eq!(
            (
                first(&done)["lights"].as_u64(),
                first(&done)["changedBytes"].as_u64()
            ),
            (Some(1), Some(0))
        );
        assert_eq!(body_of(&lab.read("out/m.yft")), frag3_body());
        // лишние поля правки игнорируются
        let extra = light(0, json!({ "intensity": 2, "lightIndex": 7, "unknown": 1 }));
        assert_eq!(
            first(&one_in(json!([extra]), Value::Null).unwrap())["changedBytes"],
            4
        );
        // 64 правки на модели с 64 огнями
        lab.put("models/lights64.yft", &file_of(&blank(true, 64, 0), 162));
        let edits: Vec<Value> = (0..64)
            .map(|n| light(n, json!({ "intensity": 1.0 + n as f64 * 0.125 })))
            .collect();
        let model = with(
            spec(&lab, "models/lights64.yft", "out/l64.yft", "m"),
            "mutations",
            json!(edits),
        );
        let done = lab.run(&request(vec![model])).unwrap();
        assert_eq!(
            (
                first(&done)["lights"].as_u64(),
                first(&done)["changedBytes"].as_u64()
            ),
            (Some(64), Some(256))
        );
        let writes: Vec<(usize, [u8; 4])> = (0..64)
            .map(|n| {
                (
                    LIGHTS_AT + n * RECORD_BYTES + 0x1C,
                    real(1.0 + n as f32 * 0.125),
                )
            })
            .collect();
        let slices: Vec<(usize, &[u8])> =
            writes.iter().map(|(at, bytes)| (*at, &bytes[..])).collect();
        assert_eq!(
            body_of(&lab.read("out/l64.yft")),
            after(&blank(true, 64, 0), &slices)
        );
    }

    #[test]
    fn lights_are_vetted_in_order_by_list_range_and_place() {
        let lab = Lab::new();
        lab.stock();
        lab.put("models/nolights.yft", &file_of(&blank(true, 0, 0), 162));
        lab.put("models/nolights.ydr", &file_of(&blank(false, 0, 0), 165));
        let mut zero = blank(true, 3, 0);
        put_u16(&mut zero, 0x118, 0);
        lab.put("models/zerocount.yft", &file_of(&zero, 162));
        let mut wide = blank(true, 3, 0);
        put_u16(&mut wide, 0x118, 65535);
        lab.put("models/lights-wide.yft", &file_of(&wide, 162));
        let run = |model: &str, ext: &str, edits: Vec<Value>| {
            let model = with(
                spec(&lab, model, &format!("out/m.{ext}"), "m"),
                "mutations",
                json!(edits),
            );
            lab.run(&request(vec![model]))
        };
        let on = |list: &str, index: u64| json!({ "list": list, "index": index });
        let frag3 = |edits: Vec<Value>| run("models/frag3.yft", "yft", edits);
        assert_eq!(
            failure(frag3(vec![
                on("fragment", 1),
                light(1, json!({ "intensity": 2 }))
            ])),
            invalid("m: light fragment#1 is mutated twice.")
        );
        assert_eq!(
            failure(frag3(vec![on("drawable", 0)])),
            invalid("m: no light list drawable.")
        );
        assert_eq!(
            failure(frag3(vec![on("FRAGMENT", 0)])),
            invalid("m: no light list FRAGMENT.")
        );
        assert_eq!(
            failure(frag3(vec![json!({ "index": 0 })])),
            invalid("m: no light list .")
        );
        assert_eq!(
            failure(frag3(vec![on("fragment", 3)])),
            invalid("m: light 3 is out of range.")
        );
        assert_eq!(
            failure(frag3(vec![on("fragment", u64::MAX)])),
            invalid("m: light 18446744073709551615 is out of range.")
        );
        assert_eq!(
            failure(frag3(vec![on("drawable", 0), on("drawable", 0)])),
            invalid("m: no light list drawable.")
        );
        assert_eq!(
            failure(frag3(vec![on("x", 0), on("fragment", 99)])),
            invalid("m: no light list x.")
        );
        assert_eq!(
            failure(frag3(vec![
                on("fragment", 99),
                on("fragment", 0),
                on("fragment", 0)
            ])),
            invalid("m: light 99 is out of range.")
        );
        assert_eq!(
            failure(frag3(vec![
                on("fragment", 0),
                on("fragment", 2),
                on("fragment", 0)
            ])),
            invalid("m: light fragment#0 is mutated twice.")
        );
        // огни в обратном порядке
        let reversed = vec![
            light(2, json!({ "intensity": 5 })),
            light(0, json!({ "intensity": 6 })),
            light(1, json!({ "intensity": 7 })),
        ];
        let done = frag3(reversed).unwrap();
        assert_eq!(
            (
                first(&done)["lights"].as_u64(),
                first(&done)["changedBytes"].as_u64()
            ),
            (Some(3), Some(12))
        );
        let step = RECORD_BYTES;
        assert_eq!(
            body_of(&lab.read("out/m.yft")),
            after(
                &frag3_body(),
                &[
                    (LIGHTS_AT + 2 * step + 0x1C, &real(5.0)),
                    (LIGHTS_AT + 0x1C, &real(6.0)),
                    (LIGHTS_AT + step + 0x1C, &real(7.0)),
                ]
            )
        );
        // рисовалка: свой список
        let drawable = run("models/drw2.ydr", "ydr", vec![on("drawable", 1)]);
        assert!(drawable.is_ok());
        assert_eq!(
            failure(run("models/drw2.ydr", "ydr", vec![on("fragment", 0)])),
            invalid("m: no light list fragment.")
        );
        // модель без списка: имя пустое, огней нет
        assert_eq!(
            failure(run("models/nolights.yft", "yft", vec![on("fragment", 0)])),
            invalid("m: no light list fragment.")
        );
        assert_eq!(
            failure(run(
                "models/nolights.yft",
                "yft",
                vec![json!({ "index": 0 })]
            )),
            invalid("m: light 0 is out of range.")
        );
        assert_eq!(
            failure(run("models/nolights.yft", "yft", vec![on("", 0)])),
            invalid("m: light 0 is out of range.")
        );
        assert_eq!(
            failure(run("models/nolights.ydr", "ydr", vec![on("drawable", 0)])),
            invalid("m: no light list drawable.")
        );
        assert_eq!(
            failure(run("models/zerocount.yft", "yft", vec![on("fragment", 0)])),
            invalid("m: light 0 is out of range.")
        );
        // число огней 65535, запись за концом ресурса: в отказе имя списка
        assert_eq!(
            failure(run(
                "models/lights-wide.yft",
                "yft",
                vec![on("fragment", 65534)]
            )),
            invalid("fragment: light 65534 lies outside the resource.")
        );
        assert!(run(
            "models/lights-wide.yft",
            "yft",
            vec![light(1, json!({ "intensity": 3 }))]
        )
        .is_ok());
        // фрагмент под именем .ydr: список рисовалки пуст
        lab.put("models/fragment-as.ydr", &file_of(&frag3_body(), 162));
        assert_eq!(
            failure(run(
                "models/fragment-as.ydr",
                "ydr",
                vec![on("drawable", 0)]
            )),
            invalid("m: no light list drawable.")
        );
        // корень короче 0x11A байт: число огней за концом данных
        let mut short = vec![0u8; 0x118];
        put_u64(&mut short, 0x110, sys(0x10));
        lab.put("models/short-root.yft", &file_of(&short, 162));
        assert_eq!(
            failure(run("models/short-root.yft", "yft", vec![on("fragment", 0)])),
            (
                "InvalidOperationException".into(),
                "Чтение за концом данных ресурса.".into()
            )
        );
    }

    #[test]
    fn numbers_are_bounded_in_f32_and_the_first_field_in_the_table_wins() {
        let lab = Lab::new();
        lab.stock();
        let try_one = |key: &str, value: &str| {
            let raw: Value = serde_json::from_str(value).unwrap();
            edit_frag3(&lab, vec![light(0, json!({ key: raw }))])
        };
        // (поле, границы текстом, ниже, ниже текстом, выше, выше текстом, на нижней границе, на верхней)
        type Row = (
            &'static str,
            &'static str,
            &'static str,
            &'static str,
            &'static str,
            &'static str,
            &'static str,
            &'static str,
        );
        let table: [Row; 7] = [
            (
                "intensity",
                "0…1000",
                "-0.5",
                "-0.5",
                "1000.5",
                "1000.5",
                "0",
                "1000",
            ),
            (
                "falloff",
                "0.05…500",
                "0.049",
                "0.049",
                "500.5",
                "500.5",
                "0.05",
                "500",
            ),
            (
                "falloffExponent",
                "0.01…256",
                "0.009",
                "0.009",
                "256.5",
                "256.5",
                "0.01",
                "256",
            ),
            (
                "coronaIntensity",
                "0…1000",
                "-0.5",
                "-0.5",
                "1000.5",
                "1000.5",
                "0",
                "1000",
            ),
            (
                "coronaSize",
                "0…1000",
                "-0.5",
                "-0.5",
                "1000.5",
                "1000.5",
                "0",
                "1000",
            ),
            (
                "volumeIntensity",
                "0…100",
                "-0.5",
                "-0.5",
                "100.5",
                "100.5",
                "0",
                "100",
            ),
            (
                "volumeSizeScale",
                "0…100",
                "-0.5",
                "-0.5",
                "100.5",
                "100.5",
                "0",
                "100",
            ),
        ];
        for (key, bounds, below, below_text, above, above_text, lo, hi) in table {
            let outside = |text: &str| invalid(&format!("Light {key} {text} is outside {bounds}."));
            assert_eq!(failure(try_one(key, below)), outside(below_text), "{key}");
            assert_eq!(failure(try_one(key, above)), outside(above_text), "{key}");
            assert_eq!(
                first(&try_one(key, lo).unwrap())["changedBytes"],
                4,
                "{key}"
            );
            assert_eq!(
                first(&try_one(key, hi).unwrap())["changedBytes"],
                4,
                "{key}"
            );
        }
        // приведение к f32 до проверки
        let intensity_outside =
            |text: &str| invalid(&format!("Light intensity {text} is outside 0…1000."));
        assert_eq!(
            failure(try_one("intensity", "1e39")),
            intensity_outside("inf")
        );
        assert_eq!(
            failure(try_one("intensity", "-1e39")),
            intensity_outside("-inf")
        );
        assert_eq!(
            failure(try_one("intensity", "123456789")),
            intensity_outside("123456790")
        );
        assert_eq!(
            failure(try_one("intensity", "1000.001")),
            intensity_outside("1000.001")
        );
        assert!(try_one("intensity", "1000.00001").is_ok());
        assert_eq!(
            failure(try_one("falloff", "1e-46")),
            invalid("Light falloff 0 is outside 0.05…500.")
        );
        assert_eq!(
            failure(try_one("falloff", "0.0499999")),
            invalid("Light falloff 0.0499999 is outside 0.05…500.")
        );
        // ноль со знаком пишется как есть
        try_one("intensity", "-0.0").unwrap();
        assert_eq!(
            body_of(&lab.read("out/m.yft")),
            after(&frag3_body(), &[(LIGHTS_AT + 0x1C, &[0, 0, 0, 0x80])])
        );
        try_one("intensity", "0.1").unwrap();
        assert_eq!(
            body_of(&lab.read("out/m.yft")),
            after(&frag3_body(), &[(LIGHTS_AT + 0x1C, &real(0.1))])
        );
        // порядок полей: intensity, falloff, falloffExponent, coronaIntensity, coronaSize, volumeIntensity, volumeSizeScale
        let both = |first: &str, second: &str| {
            edit_frag3(&lab, vec![light(0, json!({ first: 9999, second: 9999 }))])
        };
        assert_eq!(
            failure(both("falloff", "intensity")).1,
            "Light intensity 9999 is outside 0…1000."
        );
        assert_eq!(
            failure(both("coronaIntensity", "falloffExponent")).1,
            "Light falloffExponent 9999 is outside 0.01…256."
        );
        let late = json!({ "volumeSizeScale": 101, "volumeIntensity": 101, "coronaSize": 1001, "coronaIntensity": 1001 });
        assert_eq!(
            failure(edit_frag3(&lab, vec![light(0, late)])).1,
            "Light coronaIntensity 1001 is outside 0…1000."
        );
        // правки идут по порядку, и индекс следующей проверяется после чисел предыдущей
        let bad_number = light(0, json!({ "intensity": 5000 }));
        let outside = invalid("Light intensity 5000 is outside 0…1000.");
        let out_of_range = invalid("m: light 99 is out of range.");
        assert_eq!(
            failure(edit_frag3(
                &lab,
                vec![
                    light(0, json!({ "intensity": 3 })),
                    light(1, json!({ "intensity": 5000 }))
                ]
            )),
            outside
        );
        assert_eq!(
            failure(edit_frag3(
                &lab,
                vec![bad_number.clone(), light(99, json!({}))]
            )),
            outside
        );
        assert_eq!(
            failure(edit_frag3(
                &lab,
                vec![light(99, json!({})), light(0, json!({ "intensity": 5000 }))]
            )),
            out_of_range
        );
        // огни проверяются раньше текстур
        let model = with(
            spec(&lab, "models/frag3.yft", "out/m.yft", "m"),
            "mutations",
            json!([bad_number]),
        );
        let model = with(
            model,
            "textures",
            json!([{ "name": "нет", "source": lab.text("dds/a.dds") }]),
        );
        assert_eq!(failure(lab.run(&request(vec![model]))), outside);
    }

    #[test]
    fn only_the_beam_flags_may_be_set_and_they_are_added_to_the_old_ones() {
        let lab = Lab::new();
        lab.stock();
        let set = |index: u64, flags: u64| {
            edit_frag3(&lab, vec![light(index, json!({ "flagsSet": flags }))])
        };
        let refused =
            |text: &str| invalid(&format!("Light flags 0x{text} are not allowed to be set."));
        for (flags, text) in [
            (0x1u64, "1"),
            (0x81001, "81001"),
            (0x100, "100"),
            (0xFFFF_FFFF, "FFFFFFFF"),
            (0x2000, "2000"),
            (0x100_0000, "1000000"),
        ] {
            assert_eq!(failure(set(0, flags)), refused(text), "{flags:#x}");
        }
        let flags_at = |index: usize| LIGHTS_AT + index * RECORD_BYTES + 0x20;
        let flags_after = |file: &str, index: usize| {
            let body = body_of(&lab.read(file));
            u32::from_le_bytes(
                body[flags_at(index)..flags_at(index) + 4]
                    .try_into()
                    .unwrap(),
            )
        };
        for (index, flags, expected) in [
            (0, 0x1000u64, 0x1000u32),
            (0, 0x80000, 0x80000),
            (0, 0x81000, 0x81000),
            (1, 0x1000, 0x1000),
            (1, 0x80000, 0x81000),
            (2, 0x1000, 0x81000),
            (0, 0, 0),
        ] {
            let done = set(index, flags).unwrap();
            assert_eq!(first(&done)["changedBytes"], 4);
            assert_eq!(
                flags_after("out/m.yft", index as usize),
                expected,
                "{index} {flags:#x}"
            );
        }
        // недопустимые флаги раньше неверного числа следующей правки, неверное число — раньше флагов в той же правке
        let tail = light(1, json!({ "intensity": 5000 }));
        assert_eq!(
            failure(edit_frag3(
                &lab,
                vec![light(0, json!({ "flagsSet": 2 })), tail]
            )),
            refused("2")
        );
        assert_eq!(
            failure(edit_frag3(
                &lab,
                vec![light(0, json!({ "flagsSet": 2, "intensity": 5000 }))]
            )),
            invalid("Light intensity 5000 is outside 0…1000.")
        );
    }

    #[test]
    fn every_field_lands_at_its_offset_in_the_light_record() {
        let lab = Lab::new();
        lab.stock();
        let at = |field: usize| LIGHTS_AT + field;
        type Case = (Value, Vec<(usize, Vec<u8>)>, u64);
        let cases: Vec<Case> = vec![
            (
                json!({ "color": tint(9, 8, 7) }),
                vec![(at(0x18), vec![9, 8, 7])],
                3,
            ),
            (
                json!({ "intensity": 2.5 }),
                vec![(at(0x1C), real(2.5).to_vec())],
                4,
            ),
            (
                json!({ "falloff": 6.5, "falloffExponent": 48 }),
                vec![
                    (at(0x2C), real(6.5).to_vec()),
                    (at(0x30), real(48.0).to_vec()),
                ],
                8,
            ),
            (
                json!({ "coronaIntensity": 12, "coronaSize": 3 }),
                vec![
                    (at(0x6C), real(12.0).to_vec()),
                    (at(0x5C), real(3.0).to_vec()),
                ],
                8,
            ),
            (
                json!({ "volumeIntensity": 2.5, "volumeSizeScale": 1.5, "volumeOuterColor": tint(10, 20, 30) }),
                vec![
                    (at(0x4C), real(2.5).to_vec()),
                    (at(0x50), real(1.5).to_vec()),
                    (at(0x54), vec![10, 20, 30]),
                ],
                11,
            ),
            (
                json!({ "flagsSet": 4096 }),
                vec![(at(0x20), 0x1000u32.to_le_bytes().to_vec())],
                4,
            ),
            (
                json!({
                    "color": tint(200, 120, 40), "intensity": 0.8, "falloff": 6.5, "falloffExponent": 48,
                    "coronaIntensity": 12, "coronaSize": 3, "volumeIntensity": 2.5, "volumeSizeScale": 1.5,
                    "volumeOuterColor": tint(10, 20, 30), "flagsSet": 528384,
                }),
                vec![
                    (at(0x18), vec![200, 120, 40]),
                    (at(0x1C), real(0.8).to_vec()),
                    (at(0x20), 0x81000u32.to_le_bytes().to_vec()),
                    (at(0x2C), real(6.5).to_vec()),
                    (at(0x30), real(48.0).to_vec()),
                    (at(0x4C), real(2.5).to_vec()),
                    (at(0x50), real(1.5).to_vec()),
                    (at(0x54), vec![10, 20, 30]),
                    (at(0x5C), real(3.0).to_vec()),
                    (at(0x6C), real(12.0).to_vec()),
                ],
                38,
            ),
            (
                json!({ "intensity": 1.5, "flagsSet": 0 }),
                vec![(at(0x1C), real(1.5).to_vec()), (at(0x20), vec![0; 4])],
                8,
            ),
            (json!({}), vec![], 0),
        ];
        let input = file_of(&frag3_body(), 162);
        for (fields, writes, changed) in cases {
            let done = edit_frag3(&lab, vec![light(0, fields.clone())]).unwrap();
            let model = first(&done);
            let output = lab.read("out/m.yft");
            let slices: Vec<(usize, &[u8])> =
                writes.iter().map(|(at, bytes)| (*at, &bytes[..])).collect();
            assert_eq!(body_of(&output), after(&frag3_body(), &slices), "{fields}");
            assert_eq!(model["changedBytes"], changed, "{fields}");
            assert_eq!(model["lights"], 1);
            assert_eq!(model["textures"], 0);
            assert_eq!(model["model"], "m");
            assert_eq!(model["output"], lab.text("out/m.yft"));
            assert_eq!(model["inputSha256"], sha256_hex(&input));
            assert_eq!(model["outputSha256"], sha256_hex(&output));
            assert_eq!(model["outputBytes"], output.len());
            // заголовок RSC7 тот же, остальное — пересжатое тело
            assert_eq!(&output[..16], &input[..16]);
        }
        // три огня разными полями (в записи цвета нулевые байты, цвет огня 1 был 1,2,3)
        let mixed = vec![
            light(0, json!({ "intensity": 1 })),
            light(1, json!({ "color": tint(0, 0, 0) })),
            light(2, json!({ "flagsSet": 4096 })),
        ];
        let done = edit_frag3(&lab, mixed).unwrap();
        assert_eq!(first(&done)["changedBytes"], 11);
        assert_eq!(
            body_of(&lab.read("out/m.yft")),
            after(
                &frag3_body(),
                &[
                    (at(0x1C), &real(1.0)),
                    (at(RECORD_BYTES + 0x18), &[0, 0, 0]),
                    (at(2 * RECORD_BYTES + 0x20), &0x81000u32.to_le_bytes()),
                ]
            )
        );
        // рисовалка: оба огня
        let drawable = with(
            spec(&lab, "models/drw2.ydr", "out/m.ydr", "m"),
            "mutations",
            json!([
                { "list": "drawable", "index": 0, "intensity": 3 },
                { "list": "drawable", "index": 1, "color": tint(1, 1, 1) },
            ]),
        );
        let done = lab.run(&request(vec![drawable])).unwrap();
        assert_eq!(
            (
                first(&done)["lights"].as_u64(),
                first(&done)["changedBytes"].as_u64()
            ),
            (Some(2), Some(7))
        );
        assert_eq!(
            body_of(&lab.read("out/m.ydr")),
            after(
                &drw2_body(),
                &[
                    (at(0x1C), &real(3.0)),
                    (at(RECORD_BYTES + 0x18), &[1, 1, 1])
                ]
            )
        );
        // имя модели: нет, не строка, кириллица
        let nameless = with(
            spec(&lab, "models/frag3.yft", "out/m.yft", "m"),
            "model",
            json!(5),
        );
        let nameless = with(nameless, "mutations", json!([intensity(2.0)]));
        let done = lab.run(&request(vec![nameless])).unwrap();
        assert_eq!(first(&done)["model"], "");
        let named = with(
            spec(&lab, "models/frag3.yft", "out/m.yft", "фонарь №1"),
            "mutations",
            json!([intensity(2.0)]),
        );
        assert_eq!(
            first(&lab.run(&request(vec![named])).unwrap())["model"],
            "фонарь №1"
        );
    }

    #[test]
    fn the_answer_has_a_fixed_shape() {
        let lab = Lab::new();
        lab.stock();
        let done = edit_frag3(&lab, vec![intensity(2.0)]).unwrap();
        let keys = |value: &Value| {
            value
                .as_object()
                .unwrap()
                .keys()
                .cloned()
                .collect::<Vec<_>>()
        };
        assert_eq!(keys(&done), ["status", "mode", "models", "validation"]);
        assert_eq!(done["status"], "ready");
        assert_eq!(done["mode"], "lamp-studio-patch");
        assert_eq!(
            keys(first(&done)),
            [
                "model",
                "output",
                "inputSha256",
                "outputSha256",
                "outputBytes",
                "lights",
                "textures",
                "changedBytes"
            ]
        );
        assert_eq!(
            done["validation"].to_string(),
            r#"{"reopened":true,"onlyLightAndGlassBytesChanged":true,"exactValues":true}"#
        );
    }

    #[test]
    fn glass_is_replaced_by_the_first_bytes_of_the_dds_in_place() {
        let lab = Lab::new();
        lab.stock();
        let swap = |name: &str, dds: &str| json!({ "name": name, "source": lab.text(&format!("dds/{dds}.dds")) });
        let run = |textures: Vec<Value>, mutations: Vec<Value>| {
            let model = with(
                spec(&lab, "models/frag3.yft", "out/m.yft", "m"),
                "textures",
                json!(textures),
            );
            let model = with(model, "mutations", json!(mutations));
            lab.run(&request(vec![model]))
        };
        let start = |glass: usize| SYSTEM_LEN + GLASS[glass].5;
        let a = a_payload();
        let done = run(vec![swap("Lamp_Glass_A", "a")], vec![]).unwrap();
        assert_eq!(
            (
                first(&done)["lights"].as_u64(),
                first(&done)["textures"].as_u64(),
                first(&done)["changedBytes"].as_u64()
            ),
            (Some(0), Some(1), Some(168))
        );
        assert_eq!(
            body_of(&lab.read("out/m.yft")),
            after(&frag3_body(), &[(start(0), &a)])
        );
        // имя в другом регистре
        let done = run(vec![swap("LAMP_GLASS_A", "a")], vec![]).unwrap();
        assert_eq!(first(&done)["changedBytes"], 168);
        // три текстуры, в том числе без сжатия, и огонь
        let all = run(
            vec![
                swap("Lamp_Glass_A", "a"),
                swap("lamp_b", "b"),
                swap("lamp_c", "c"),
            ],
            vec![intensity(2.0)],
        )
        .unwrap();
        assert_eq!(first(&all)["changedBytes"], 4 + 168 + 64 + 320);
        assert_eq!(
            body_of(&lab.read("out/m.yft")),
            after(
                &frag3_body(),
                &[
                    (LIGHTS_AT + 0x1C, &real(2.0)),
                    (start(0), &a),
                    (start(1), &b_payload()),
                    (start(2), &c_payload()),
                ]
            )
        );
        // одна текстура дважды одними данными: пишется дважды и считается дважды
        let twice = run(vec![swap("lamp_b", "b"), swap("LAMP_B", "b")], vec![]).unwrap();
        assert_eq!(first(&twice)["changedBytes"], 128);
        // дважды разными данными не ложится обратно
        let clash = run(
            vec![swap("Lamp_Glass_A", "a"), swap("Lamp_Glass_A", "a2")],
            vec![],
        );
        assert_eq!(
            failure(clash),
            invalid("m: texture Lamp_Glass_A did not land.")
        );
        // textures — объект: считается пустым
        let model = with(
            spec(&lab, "models/frag3.yft", "out/o.yft", "m"),
            "mutations",
            json!([intensity(2.0)]),
        );
        let model = with(model, "textures", json!({ "name": "x" }));
        let done = lab.run(&request(vec![model])).unwrap();
        assert_eq!(first(&done)["textures"], 0);
        // рисовалка
        let drawable = with(
            spec(&lab, "models/drw2.ydr", "out/m.ydr", "m"),
            "textures",
            json!([swap("Lamp_Glass_A", "a")]),
        );
        let done = lab.run(&request(vec![drawable])).unwrap();
        assert_eq!(first(&done)["changedBytes"], 168);
        assert_eq!(
            body_of(&lab.read("out/m.ydr")),
            after(&drw2_body(), &[(start(0), &a)])
        );
        // DDS с расширенным заголовком DX10 (DXGI 71)
        let mut dx10 = dds_header(b"DX10", 16, 16, 3);
        let mut extension = [0u8; 20];
        put_u32(&mut extension, 0, 71);
        put_u32(&mut extension, 12, 1);
        dx10.extend(extension);
        dx10.extend(&a);
        lab.put("dds/a-dx10.dds", &dx10);
        let done = run(vec![swap("Lamp_Glass_A", "a-dx10")], vec![]).unwrap();
        assert_eq!(first(&done)["changedBytes"], 168);
    }

    #[test]
    fn texture_refusals_come_in_the_documented_order() {
        let lab = Lab::new();
        lab.stock();
        let swap = |name: &str, dds: &str| json!({ "name": name, "source": lab.text(&format!("dds/{dds}.dds")) });
        let run = |model: &str, textures: Vec<Value>| {
            let spec = with(
                spec(&lab, &format!("models/{model}.yft"), "out/m.yft", "m"),
                "textures",
                json!(textures),
            );
            lab.run(&request(vec![spec]))
        };
        assert_eq!(
            failure(run("frag3", vec![swap("нет", "a")])),
            invalid("m: no embedded texture нет.")
        );
        assert_eq!(
            failure(run("frag3", vec![swap("", "a")])),
            invalid("m: no embedded texture .")
        );
        assert_eq!(
            failure(run("frag3", vec![swap(" lamp_b", "b")])),
            invalid("m: no embedded texture  lamp_b.")
        );
        assert_eq!(
            failure(run("frag1", vec![swap("x", "a")])),
            invalid("m: no embedded texture x.")
        );
        // раскладка DDS должна остаться
        lab.put(
            "dds/a-dxt5.dds",
            &dds_of(b"DXT5", 16, 16, 3, &pattern(336, 4)),
        );
        lab.put(
            "dds/a-32.dds",
            &dds_of(b"DXT1", 32, 32, 3, &pattern(672, 4)),
        );
        lab.put(
            "dds/a-16x8.dds",
            &dds_of(b"DXT1", 16, 8, 3, &pattern(88, 4)),
        );
        lab.put(
            "dds/a-1lvl.dds",
            &dds_of(b"DXT1", 16, 16, 1, &pattern(128, 4)),
        );
        let must = invalid("m: texture Lamp_Glass_A must stay Dxt1 16x16, 3 levels.");
        for name in ["a-dxt5", "a-32", "a-16x8", "a-1lvl"] {
            assert_eq!(
                failure(run("frag3", vec![swap("Lamp_Glass_A", name)])),
                must,
                "{name}"
            );
        }
        assert_eq!(
            failure(run("frag3", vec![swap("lamp_c", "a")])),
            invalid("m: texture lamp_c must stay A8R8G8B8 8x8, 2 levels.")
        );
        // разбор DDS: тексты соседа
        let junk = (
            "InvalidOperationException".to_owned(),
            "Файл не DDS: нет заголовка.".to_owned(),
        );
        lab.put("dds/junk.dds", b"not a dds at all");
        lab.put("dds/empty.dds", b"");
        lab.put("dds/cut-header.dds", &[0u8; 64]);
        for name in ["junk", "empty", "cut-header"] {
            assert_eq!(
                failure(run("frag3", vec![swap("Lamp_Glass_A", name)])),
                junk,
                "{name}"
            );
        }
        lab.put(
            "dds/extra.dds",
            &dds_of(b"DXT1", 16, 16, 3, &pattern(184, 4)),
        );
        lab.put(
            "dds/short.dds",
            &dds_of(b"DXT1", 16, 16, 3, &pattern(100, 4)),
        );
        lab.put(
            "dds/a-nomipflag.dds",
            &[dds_header(b"DXT1", 16, 16, 0), pattern(168, 4)].concat(),
        );
        let sized = |have: usize, levels: usize, need: usize| {
            (
                "InvalidOperationException".to_owned(),
                format!("DDS: данных {have} байт, для 16\u{d7}16 и {levels} ступеней DXT1 нужно {need}."),
            )
        };
        assert_eq!(
            failure(run("frag3", vec![swap("Lamp_Glass_A", "extra")])),
            sized(184, 3, 168)
        );
        assert_eq!(
            failure(run("frag3", vec![swap("Lamp_Glass_A", "short")])),
            sized(100, 3, 168)
        );
        assert_eq!(
            failure(run("frag3", vec![swap("Lamp_Glass_A", "a-nomipflag")])),
            sized(168, 1, 128)
        );
        lab.put("dds/wide.dds", &dds_of(b"DXT1", 8193, 4, 1, &[0; 8]));
        assert_eq!(
            failure(run("frag3", vec![swap("Lamp_Glass_A", "wide")])),
            (
                "InvalidOperationException".into(),
                "DDS: размеры вне 1–8192.".into()
            )
        );
        lab.put(
            "dds/fourcc-bc7.dds",
            &dds_of(b"BC7 ", 16, 16, 3, &a_payload()),
        );
        assert_eq!(
            failure(run("frag3", vec![swap("Lamp_Glass_A", "fourcc-bc7")])).1,
            "DDS формат \"BC7 \" не поддерживается: нужен DXT1/DXT3/DXT5, ATI1/ATI2 или BC1–BC5."
        );
        // не .dds, не существует, нет source
        let png = lab.put("dds/b.png", b"x");
        assert_eq!(
            failure(run(
                "frag3",
                vec![json!({ "name": "lamp_b", "source": png })]
            )),
            (
                "ArgumentException".into(),
                "Unsupported file extension: .png".into()
            )
        );
        let absent = lab.text("dds/нет.dds");
        assert_eq!(
            failure(run("frag3", vec![swap("lamp_b", "нет")])),
            (
                "FileNotFoundException".into(),
                format!("File was not found: {absent}")
            )
        );
        assert_eq!(
            failure(run("frag3", vec![json!({ "name": "lamp_b" })])),
            ("ArgumentException".into(), "The path is empty.".into())
        );
        // два имени, различающиеся регистром: берётся первое
        let mut dup = blank(true, 0, 2);
        for (n, (name, side, at)) in [("SAME", 4u16, 0usize), ("same", 8, 0x20)]
            .into_iter()
            .enumerate()
        {
            put_bytes(&mut dup, NAME_AT[n], &[0; 8]);
            put_bytes(&mut dup, NAME_AT[n], name.as_bytes());
            put_u16(&mut dup, OBJECT_AT[n] + 0x50, side);
            put_u16(&mut dup, OBJECT_AT[n] + 0x52, side);
            body_levels(&mut dup, OBJECT_AT[n], 1);
            put_u32(&mut dup, OBJECT_AT[n] + 0x58, Format::Dxt1.code());
            put_u64(&mut dup, OBJECT_AT[n] + 0x70, gfx(at));
        }
        lab.put("models/dupnames.yft", &file_of(&dup, 162));
        lab.put("dds/t4.dds", &dds_of(b"DXT1", 4, 4, 1, &pattern(8, 5)));
        lab.put("dds/e8.dds", &dds_of(b"DXT1", 8, 8, 1, &pattern(32, 5)));
        let done = run("dupnames", vec![swap("SAME", "t4")]).unwrap();
        assert_eq!(first(&done)["changedBytes"], 8);
        assert_eq!(
            failure(run("dupnames", vec![swap("same", "e8")])),
            invalid("m: texture same must stay Dxt1 4x4, 1 levels.")
        );
    }

    fn body_levels(body: &mut [u8], object: usize, levels: u8) {
        body[object + 0x5D] = levels;
    }

    #[test]
    fn a_damaged_texture_of_the_model_breaks_even_a_light_only_patch() {
        let lab = Lab::new();
        lab.stock();
        let broken = |name: &str, tweak: &dyn Fn(&mut Vec<u8>)| {
            let mut body = blank(true, 3, 1);
            tweak(&mut body);
            lab.put(&format!("models/{name}.yft"), &file_of(&body, 162));
            let model = with(
                spec(&lab, &format!("models/{name}.yft"), "out/m.yft", "m"),
                "mutations",
                json!([intensity(2.0)]),
            );
            lab.run(&request(vec![model]))
        };
        let object = OBJECT_AT[0];
        assert_eq!(
            failure(broken("texbad-format", &|body| {
                put_bytes(body, NAME_AT[0], b"weird\0");
                put_u32(body, object + 0x58, 0x1234_5678);
            })),
            invalid("текстура weird: формат 0x12345678 не поддержан")
        );
        assert_eq!(
            failure(broken("texbad-noname", &|body| put_u64(
                body,
                object + 0x28,
                0
            ))),
            invalid("у текстуры нет имени")
        );
        assert_eq!(
            failure(broken("texbad-nodata", &|body| {
                put_bytes(body, NAME_AT[0], b"nodata\0");
                put_u64(body, object + 0x70, 0);
            })),
            invalid("текстура nodata без данных")
        );
        // данные текстуры за концом ресурса: правка одних огней проходит, замена — нет
        let outside = |body: &mut Vec<u8>| {
            put_bytes(body, NAME_AT[0], b"tail\0");
            put_u64(body, object + 0x70, gfx(0xFF0));
        };
        let done = broken("tex-outside", &outside).unwrap();
        assert_eq!(first(&done)["changedBytes"], 4);
        let model = with(
            spec(&lab, "models/tex-outside.yft", "out/m.yft", "m"),
            "textures",
            json!([{ "name": "tail", "source": lab.text("dds/a.dds") }]),
        );
        assert_eq!(
            failure(lab.run(&request(vec![model]))),
            invalid("m: texture tail lies outside the resource.")
        );
    }

    #[test]
    fn a_light_inside_the_glass_data_does_not_land() {
        let lab = Lab::new();
        lab.stock();
        let mut body = blank(true, 3, 1);
        put_bytes(&mut body, NAME_AT[0], b"ovl\0");
        put_u64(&mut body, OBJECT_AT[0] + 0x70, sys(LIGHTS_AT));
        lab.put("models/overlap.yft", &file_of(&body, 162));
        let run = |fields: Value| {
            let model = with(
                spec(&lab, "models/overlap.yft", "out/m.yft", "m"),
                "mutations",
                json!([light(0, fields)]),
            );
            let model = with(
                model,
                "textures",
                json!([{ "name": "ovl", "source": lab.text("dds/a.dds") }]),
            );
            lab.run(&request(vec![model]))
        };
        assert_eq!(
            failure(run(json!({ "intensity": 2 }))),
            invalid("m: light 0 did not land.")
        );
        assert_eq!(
            failure(run(json!({ "color": tint(9, 9, 9) }))),
            invalid("m: light 0 colour did not land.")
        );
        assert_eq!(
            failure(run(json!({ "volumeOuterColor": tint(9, 9, 9) }))),
            invalid("m: light 0 outer colour did not land.")
        );
        assert_eq!(
            failure(run(json!({ "flagsSet": 4096 }))),
            invalid("m: light 0 flags did not land.")
        );
        assert!(
            !lab.exists("out/m.yft"),
            "файл выхода появляется только после сверки"
        );
        // правка без полей ложится: пишется только стекло
        let done = run(json!({})).unwrap();
        assert_eq!(first(&done)["changedBytes"], 168);
        assert_eq!(
            body_of(&lab.read("out/m.yft")),
            after(&body, &[(LIGHTS_AT, &a_payload())])
        );
    }

    #[test]
    fn broken_models_are_refused_with_the_neighbours_words() {
        let lab = Lab::new();
        lab.stock();
        let run = |name: &str, bytes: &[u8]| {
            lab.put(&format!("models/{name}"), bytes);
            let model = with(
                spec(&lab, &format!("models/{name}"), "newdir/m.yft", "m"),
                "mutations",
                json!([light(0, json!({}))]),
            );
            lab.run(&request(vec![model]))
        };
        let operation = |text: &str| ("InvalidOperationException".to_owned(), text.to_owned());
        assert_eq!(
            failure(run("empty.yft", b"")),
            operation("Ресурс короче заголовка RSC7.")
        );
        assert!(
            !lab.path("newdir").exists(),
            "созданная ради отказа папка убрана"
        );
        assert_eq!(
            failure(run("text.yft", b"this is just a text file.....")),
            operation("Файл не является ресурсом RSC7.")
        );
        let header = file_of(&[], 162)[..16].to_vec();
        assert_eq!(
            failure(run("head-only.yft", &header)),
            operation("Поток ресурса пуст или не распакован.")
        );
        // поток, из которого распаковалась только системная часть: текстура без данных
        let mut cut = blank(true, 3, 1);
        cut.truncate(SYSTEM_LEN);
        let model = with(
            spec(&lab, "models/cut.yft", "out/m.yft", "m"),
            "mutations",
            json!([intensity(2.0)]),
        );
        lab.put("models/cut.yft", &file_of(&cut, 162));
        assert_eq!(
            failure(lab.run(&request(vec![model]))),
            invalid("текстура Lamp_Glass_A без данных")
        );
        // рисовалка под именем .yft: огни читаются по смещениям фрагмента
        lab.put("models/drawable-as.yft", &file_of(&drw2_body(), 165));
        let model = with(
            spec(&lab, "models/drawable-as.yft", "out/m.yft", "m"),
            "mutations",
            json!([intensity(2.0)]),
        );
        assert_eq!(
            failure(lab.run(&request(vec![model]))),
            invalid("m: no light list fragment.")
        );
    }

    #[test]
    fn several_models_run_in_order_and_nothing_is_rolled_back() {
        let lab = Lab::new();
        lab.stock();
        let frag = |out: &str, label: &str, edits: Value| {
            with(
                spec(&lab, "models/frag3.yft", out, label),
                "mutations",
                edits,
            )
        };
        let drawable = with(
            with(
                spec(&lab, "models/drw2.ydr", "out/b.ydr", "b"),
                "mutations",
                json!([{ "list": "drawable", "index": 0, "color": tint(1, 2, 3) }]),
            ),
            "textures",
            json!([{ "name": "Lamp_Glass_A", "source": lab.text("dds/a.dds") }]),
        );
        let done = lab
            .run(&request(vec![
                frag("out/a.yft", "a", json!([intensity(2.0)])),
                drawable,
            ]))
            .unwrap();
        let models = done["models"].as_array().unwrap();
        assert_eq!(models.len(), 2);
        assert_eq!(
            (
                models[0]["model"].as_str(),
                models[0]["changedBytes"].as_u64()
            ),
            (Some("a"), Some(4))
        );
        assert_eq!(
            (
                models[1]["model"].as_str(),
                models[1]["lights"].as_u64(),
                models[1]["textures"].as_u64(),
                models[1]["changedBytes"].as_u64()
            ),
            (Some("b"), Some(1), Some(1), Some(171))
        );
        assert_eq!(models[1]["output"], lab.text("out/b.ydr"));
        // отказ второй модели: выход первой остаётся, пустые папки второй убраны (раньше оставались)
        let later = with(
            spec(&lab, "models/drw2.ydr", "later/deeper/b.ydr", "b"),
            "mutations",
            json!([light(0, json!({}))]),
        );
        let third = frag(
            "out/c.yft",
            "c",
            json!([light(0, json!({ "intensity": 3 }))]),
        );
        let result = lab.run(&request(vec![
            frag("out2/a.yft", "a", json!([intensity(2.0)])),
            later,
            third,
        ]));
        assert_eq!(failure(result), invalid("b: no light list fragment."));
        assert!(lab.exists("out2/a.yft"));
        assert!(!lab.exists("later"));
        assert!(!lab.exists("out/c.yft"));
        // два запроса в один выход: раньше второй заменял первый и в ответе были оба, теперь второй отказывает, первый остаётся
        let result = lab.run(&request(vec![
            frag("out/x.yft", "a", json!([intensity(2.0)])),
            frag("out/x.yft", "b", json!([intensity(3.0)])),
        ]));
        assert_eq!(
            failure(result),
            invalid("b: output is already written by an earlier model of this request.")
        );
        assert_eq!(
            body_of(&lab.read("out/x.yft")),
            after(&frag3_body(), &[(LIGHTS_AT + 0x1C, &real(2.0))])
        );
        // то же под другим написанием пути
        let result = lab.run(&request(vec![
            frag("out/x.yft", "a", json!([intensity(2.0)])),
            frag("out/sub/../x.yft", "b", json!([intensity(3.0)])),
        ]));
        assert_eq!(
            failure(result),
            invalid("b: output is already written by an earlier model of this request.")
        );
        // вход второй модели — выход первой: читается уже новым
        let chain = lab
            .run(&request(vec![
                frag("out/x.yft", "a", json!([intensity(2.0)])),
                with(
                    spec(&lab, "out/x.yft", "out/y.yft", "b"),
                    "mutations",
                    json!([light(1, json!({ "intensity": 3 }))]),
                ),
            ]))
            .unwrap();
        assert_eq!(
            chain["models"][1]["inputSha256"],
            chain["models"][0]["outputSha256"]
        );
        assert_eq!(
            body_of(&lab.read("out/y.yft")),
            after(
                &frag3_body(),
                &[
                    (LIGHTS_AT + 0x1C, &real(2.0)),
                    (LIGHTS_AT + RECORD_BYTES + 0x1C, &real(3.0))
                ]
            )
        );
        // один вход в двух выходах: файлы равны
        let twin = lab
            .run(&request(vec![
                frag("out/x1.yft", "a", json!([intensity(2.0)])),
                frag("out/x2.yft", "a", json!([intensity(2.0)])),
            ]))
            .unwrap();
        assert_eq!(
            twin["models"][0]["outputSha256"],
            twin["models"][1]["outputSha256"]
        );
        assert_eq!(lab.read("out/x1.yft"), lab.read("out/x2.yft"));
        // 512 моделей за один запрос
        let batch: Vec<Value> = (0..512)
            .map(|n| {
                frag(
                    &format!("many/m{n}.yft"),
                    &format!("m{n}"),
                    json!([light(0, json!({ "intensity": n as f64 }))]),
                )
            })
            .collect();
        let done = lab.run(&request(batch)).unwrap();
        assert_eq!(done["models"].as_array().unwrap().len(), 512);
        assert_eq!(done["models"][511]["model"], "m511");
        assert!(lab.exists("many/m511.yft"));
    }
}
