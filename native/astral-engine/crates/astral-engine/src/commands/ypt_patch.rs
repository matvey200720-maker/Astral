//! `ypt-patch`: режим `ypt-texture-patch` помощника в движке — один проход по ядру эффектов `core.ypt`.
//!
//! `--request <файл.json>` с тем же телом, что получает помощник: `inputFile`, `outputFile`, `edition`,
//! `texturePatches`, `rulePatches`, `slotReservations`, `effectClones`, `effectCloneReset`, `stockKeyframes`,
//! `stockKeyframesFrom`. Ответ — форма ответа помощника.
//!
//! Порядок прохода — порядок помощника (`YptTexturePatchAsync`): словари и опись (при правке структуры) → сброс прежних
//! клонов → кадры штатных правил → слоты следа → клоны эффектов → подмена текстур → правки правил следа → проверка
//! графа → запись → перечитывание. Ядро разбирается один раз (`ypt::image`, открывается `Structure::parse`), все шаги
//! правят один образ, файл собирается один раз: слова-хеши и пиксели не двигаются. Текстуры ложатся в образ
//! (`ypt::pixels`), прежний писатель (`ypt::writer`) здесь не зовётся. Редакция Enhanced со слотами и клонами
//! отказывается кодом `NotInEngine`: её пишет помощник.
//!
//! Слоты и клоны раньше шли временными командами `ypt-slots-patch` и `ypt-clones-patch` (сверка 16.11.2026); их случаи
//! идут через эту команду, а сами команды из реестра убраны. Остаются `ypt-clone-export` и `ypt-own-donor`.

use std::{
    collections::{BTreeSet, HashSet},
    fs,
};

use rage_res::{
    hash::sha256_hex,
    texture::TextureRef,
    ypt::{
        self,
        effect_clones::{self as clones, EffectClone},
        image::Image,
        pixels,
        rule_patch::{self, NearHide, RulePatch},
        slot_reservations::{self as slots, Reservation},
        stock_keyframes::{self, StockPatch},
        vanilla,
    },
};
use serde_json::Value;

use super::shop::write_atomic;
use super::ypt_clones as clone_io;
use super::ypt_io::{
    flag_field, graph_answer, helper_file, helper_path, lift, lift_dds, list_field, named_twice, number,
    number_field, object, read_core, read_payloads, remarks_answer, text_field, texture_draft, verification_answer,
    wrong, TextureDraft, PATCH_CAP,
};
use super::ypt_slots as slot_io;
use super::Command;
use crate::{
    args::Options,
    error::{EngineError, Result},
    paths,
    progress::Progress,
};

const COMMAND_NAME: &str = "ypt-patch";
/// Код отказа для частей запроса, которые пока пишет помощник.
pub const NOT_IN_ENGINE: &str = "NotInEngine";

// ---------------------------------------------------------------------------------------------
// Запрос
// ---------------------------------------------------------------------------------------------

struct RuleDraft {
    rule: Option<String>,
    patch: RulePatch,
}

/// Запрос целиком, как его читает помощник. Поля разбираются в порядке записи помощника: так совпадает и то, какой
/// отказ типа значения придёт первым.
struct Request {
    input: Option<String>,
    output: Option<String>,
    edition: Option<String>,
    textures: Vec<TextureDraft>,
    rules: Vec<RuleDraft>,
    reservations: Vec<Reservation>,
    clones: Vec<EffectClone>,
    reset: Vec<String>,
    stock: Vec<StockPatch>,
    stock_from: Option<String>,
}

impl Request {
    fn parse(document: &Value) -> Result<Request> {
        let each = |name: &str| -> Result<Vec<(String, &Value)>> {
            Ok(list_field(document, name)?
                .iter()
                .enumerate()
                .map(|(k, item)| (format!("$.{name}[{k}]"), item))
                .collect())
        };
        Ok(Request {
            input: text_field(document, "inputFile", "$")?,
            output: text_field(document, "outputFile", "$")?,
            edition: text_field(document, "edition", "$")?,
            textures: each("texturePatches")?
                .into_iter()
                .map(|(path, item)| texture_draft(item, &path))
                .collect::<Result<_>>()?,
            rules: each("rulePatches")?
                .into_iter()
                .map(|(path, item)| rule_draft(item, &path))
                .collect::<Result<_>>()?,
            reservations: each("slotReservations")?
                .into_iter()
                .map(|(path, item)| slot_io::reservation(item, &path))
                .collect::<Result<_>>()?,
            clones: clone_io::parse_clones(document)?,
            reset: clone_io::parse_reset(document)?,
            stock: each("stockKeyframes")?
                .into_iter()
                .map(|(path, item)| stock_patch(item, &path))
                .collect::<Result<_>>()?,
            stock_from: text_field(document, "stockKeyframesFrom", "$")?,
        })
    }
}

fn rule_draft(item: &Value, path: &str) -> Result<RuleDraft> {
    let near_hide = match super::ypt_io::field(item, "nearHide") {
        None => None,
        Some(near @ Value::Object(_)) => {
            let at = format!("{path}.nearHide");
            // decimal в записи, float в помощнике: `(float)near.From`
            let from = number_field(near, "from", &at)?.unwrap_or(0.0) as f32;
            let to = number_field(near, "to", &at)?.unwrap_or(0.0) as f32;
            Some(NearHide { from, to })
        }
        Some(_) => {
            return Err(wrong(
                &format!("{path}.nearHide"),
                "Modovik.RpfHelper.YptNearHide",
            ))
        }
    };
    let rule = text_field(item, "rule", path)?;
    Ok(RuleDraft {
        patch: RulePatch {
            rule: rule.clone().unwrap_or_default(),
            width: number_field(item, "width", path)?,
            length: number_field(item, "length", path)?,
            neutral_colour: flag_field(item, "neutralColour", path)?.unwrap_or(false),
            near_hide,
        },
        rule,
    })
}

fn stock_patch(item: &Value, path: &str) -> Result<StockPatch> {
    let values = match super::ypt_io::field(item, "values") {
        None => None,
        Some(Value::Array(rows)) => Some(
            rows.iter()
                .enumerate()
                .map(|(r, row)| match row {
                    Value::Array(numbers) => numbers
                        .iter()
                        .enumerate()
                        .map(|(n, number)| match number {
                            Value::Number(number) => Ok(number.as_f64().unwrap_or(0.0)),
                            _ => Err(wrong(&format!("{path}.values[{r}][{n}]"), "System.Decimal")),
                        })
                        .collect::<Result<Vec<f64>>>(),
                    _ => Err(wrong(
                        &format!("{path}.values[{r}]"),
                        "System.Collections.Generic.IReadOnlyList",
                    )),
                })
                .collect::<Result<Vec<_>>>()?,
        ),
        Some(_) => {
            return Err(wrong(
                &format!("{path}.values"),
                "System.Collections.Generic.IReadOnlyList",
            ))
        }
    };
    Ok(StockPatch {
        kind: text_field(item, "kind", path)?.unwrap_or_default(),
        name: text_field(item, "name", path)?.unwrap_or_default(),
        prop: text_field(item, "prop", path)?.unwrap_or_default(),
        values,
        optional: flag_field(item, "optional", path)?.unwrap_or(false),
        from_donor: flag_field(item, "fromDonor", path)?.unwrap_or(false),
    })
}

// ---------------------------------------------------------------------------------------------
// Текстуры
// ---------------------------------------------------------------------------------------------

/// `--structure on|off` принимается, как у `write-ypt-texture-patch`, но раскладку файла не меняет: текстуры правятся в
/// том же образе, что остальное, и файл собирается один раз («как есть»).
fn check_structure(given: Option<&str>) -> Result<()> {
    match given.unwrap_or("off") {
        "off" | "on" => Ok(()),
        other => Err(EngineError::argument(format!(
            "--structure: on или off, пришло «{other}»."
        ))),
    }
}

/// Текстура словаря по имени без учёта регистра; два одноимённых — как у `SingleOrDefault`.
fn texture_named<'a>(textures: &'a [TextureRef], wanted: &str) -> Result<Option<&'a TextureRef>> {
    let mut found = None;
    for texture in textures {
        if ypt::cmp_ordinal_ignore_case(&texture.name, wanted) != std::cmp::Ordering::Equal {
            continue;
        }
        if found.replace(texture).is_some() {
            return Err(EngineError::invalid_operation(
                "Sequence contains more than one matching element",
            ));
        }
    }
    Ok(found)
}

/// Проверенные правки текстур: что писать в образ и что назвать в ответе.
struct Textures {
    writer: Vec<pixels::Payload>,
    answer: Vec<Value>,
    names: HashSet<String>,
}

/// Правки текстур по порядку помощника: сумма файла, лист в словаре, DDS и его раскладка. Листы слотов `skip` уже
/// построены из тех же DDS: подмена дала бы те же пиксели, поэтому в образ их второй раз не пишут.
fn check_textures(
    drafts: &[TextureDraft],
    textures: &[TextureRef],
    skip: &HashSet<String>,
) -> Result<Textures> {
    let mut out = Textures {
        writer: Vec::new(),
        answer: Vec::new(),
        names: HashSet::new(),
    };
    for draft in drafts {
        let name = draft.texture.as_deref().unwrap_or_default();
        let source = helper_file(draft.source.as_deref(), ".dds")?;
        let bytes = fs::read(&source)?;
        let digest = sha256_hex(&bytes);
        if let Some(wanted) = draft
            .sha256
            .as_deref()
            .filter(|text| !text.trim().is_empty())
        {
            if !wanted.eq_ignore_ascii_case(&digest) {
                return Err(EngineError::invalid_data(format!(
                    "YPT texture checksum mismatch: {name}"
                )));
            }
        }
        let target = texture_named(textures, name.trim())?.ok_or_else(|| {
            EngineError::invalid_data(format!("YPT texture does not exist: {name}"))
        })?;
        // Чтение DDS помощником: без подписи `DDS ` оно падает своим исключением, дальше — «не разобран».
        let image = slots::read_app_dds(&bytes, name).map_err(lift_dds)?;
        // Длина данных листа — как её держит помощник и считает приложение (`yptTextureDds`): у `ptfx_blood_spurt` и
        // `ptfx_insects_rgb` она короче длины «по блокам», и DDS «по блокам» помощник отказывает. Лист слота построен
        // движком из того же DDS: его длина — длина этого DDS.
        let wanted = if skip.contains(&name.trim().to_uppercase()) {
            target.bytes
        } else {
            pixels::leaf_bytes(target)
        };
        let same = target.width == image.width
            && target.height == image.height
            && target.levels == u32::from(image.levels)
            && target.format == Some(image.format)
            && wanted == image.payload.len();
        if !same {
            return Err(EngineError::invalid_data(format!(
                "DDS layout must match the existing YPT texture exactly: {name}"
            )));
        }
        out.names.insert(name.trim().to_uppercase());
        out.answer.push(object([
            ("texture", Value::from(target.name.as_str())),
            ("source", Value::from(source.display().to_string())),
            ("width", Value::from(target.width)),
            ("height", Value::from(target.height)),
            ("levels", Value::from(target.levels)),
            (
                "format",
                Value::from(format!("D3DFMT_{}", image.format.name())),
            ),
            ("bytes", Value::from(image.payload.len())),
            ("sourceSha256", Value::from(digest)),
        ]));
        if !skip.contains(&name.trim().to_uppercase()) {
            out.writer.push((name.trim().to_owned(), image.payload));
        }
    }
    Ok(out)
}

// ---------------------------------------------------------------------------------------------
// Ответ
// ---------------------------------------------------------------------------------------------

fn rules_answer(reports: &[rule_patch::Report]) -> Value {
    reports
        .iter()
        .map(|report| {
            object([
                ("rule", Value::from(report.rule.as_str())),
                (
                    "before",
                    object([
                        ("width", number(report.before_width)),
                        ("length", number(report.before_length)),
                    ]),
                ),
                ("width", number(report.width)),
                ("length", number(report.length)),
                ("proportional", Value::from(report.proportional)),
                ("keyframes", Value::from(report.keyframes)),
            ])
        })
        .collect()
}

fn stock_answer(report: &Option<stock_keyframes::StockReport>) -> Value {
    match report {
        None => Value::Null,
        Some(report) => object([
            ("applied", Value::from(report.applied)),
            ("objects", Value::from(report.objects.clone())),
            ("skipped", Value::from(report.skipped.clone())),
        ]),
    }
}

// ---------------------------------------------------------------------------------------------
// Команда
// ---------------------------------------------------------------------------------------------

pub(super) fn run(options: &Options, _progress: &Progress) -> Result<Value> {
    let request_path = paths::existing_file(options.required("request")?, &[".json"])?;
    check_structure(options.optional("structure"))?;
    let text = fs::read_to_string(&request_path)?;
    let document: Value = serde_json::from_str(&text).map_err(|error| {
        EngineError::invalid_data(format!("The request is not valid JSON: {error}"))
    })?;
    let request = Request::parse(&document)?;
    let rebuilds = !request.reservations.is_empty() || !request.clones.is_empty() || !request.reset.is_empty();
    if rebuilds
        && request
            .edition
            .as_deref()
            .is_some_and(|edition| edition.eq_ignore_ascii_case("Enhanced"))
    {
        return Err(EngineError::new(
            NOT_IN_ENGINE,
            "ypt-patch: the Enhanced edition is not in the engine yet; the helper writes it.",
        ));
    }

    let input = helper_file(request.input.as_deref(), ".ypt")?;
    let output = helper_path(request.output.as_deref())?;
    if !output.to_string_lossy().to_lowercase().ends_with(".ypt") {
        return Err(EngineError::invalid_data(
            "YPT output must use the .ypt extension.",
        ));
    }
    // Клон без своей текстуры, сброс прежних клонов и кадры штатных правил — правка сама по себе: пустой список
    // текстур не мешает. Слоту нужен лист из подмен, поэтому слоты в этот перечень не входят.
    if request.textures.is_empty()
        && request.clones.is_empty()
        && request.reset.is_empty()
        && request.stock.is_empty()
    {
        return Err(EngineError::invalid_data(
            "YPT texture patches are required.",
        ));
    }
    if request.textures.len() > PATCH_CAP {
        return Err(EngineError::invalid_data(
            "YPT texture patch count must not exceed 64.",
        ));
    }
    if named_twice(
        request
            .textures
            .iter()
            .map(|draft| draft.texture.clone().unwrap_or_default()),
    ) {
        return Err(EngineError::invalid_data(
            "YPT texture patch names must be unique and non-empty.",
        ));
    }

    // Ядро читается один раз: все шаги ниже правят этот образ.
    let bytes = read_core(&input)?;
    let mut image = Image::parse(&bytes).map_err(lift)?;

    // Опись и словари — до любой правки, только при правке структуры.
    let restructured = rebuilds || !request.stock.is_empty();
    let (hash_remarks, before, baseline) = if restructured {
        let remarks = vanilla::assert_dictionaries(&image).map_err(lift)?;
        let before = vanilla::inventory(&image).map_err(lift)?;
        let baseline = vanilla::graph_defects(&image).map_err(lift)?;
        (remarks, Some(before), Some(baseline))
    } else {
        (Vec::new(), None, None)
    };

    // Прежние клоны эффектов уходят до сборки новых: семейство пересобирается целиком.
    let mut restored = BTreeSet::new();
    let mut purged = if request.reset.is_empty() && request.clones.is_empty() {
        BTreeSet::new()
    } else {
        clones::purge(image.structure_mut(), &request.reset, &mut restored).map_err(lift)?
    };

    // Кадры автора у штатных правил — до постройки слотов: слот следа клонируется с донора уже с числами автора.
    let donor = match request
        .stock_from
        .as_deref()
        .filter(|path| !path.trim().is_empty())
    {
        None => None,
        Some(path) => {
            let file = helper_file(Some(path), ".ypt")?;
            Some(Image::parse(&read_core(&file)?).map_err(lift)?)
        }
    };
    let stock = if request.stock.is_empty() {
        None
    } else {
        Some(stock_keyframes::apply(&mut image, &request.stock, donor.as_ref()).map_err(lift)?)
    };

    // Слоты строятся до подмены текстур: их листы создаются из тех же DDS, а размер следа ложится на построенное правило.
    let mut reserved = Vec::new();
    if !request.reservations.is_empty() {
        let payloads = read_payloads(
            request
                .reservations
                .iter()
                .map(|item| item.texture.clone().unwrap_or_default()),
            &request.textures,
            |name| name.to_uppercase(),
        )?;
        reserved = slots::apply(image.structure_mut(), &request.reservations, &payloads).map_err(lift_dds)?;
    }

    // Клоны эффектов: чужие словари доноров читаются по разу, листы клонов берутся из тех же DDS.
    let donors = clone_io::read_donors(&request.clones)?;
    let swaps = clone_io::swap_textures(&request.clones);
    let cloned = if request.clones.is_empty() {
        Vec::new()
    } else {
        let payloads = read_payloads(swaps.iter().cloned(), &request.textures, |name| name.to_lowercase())?;
        clones::apply(image.structure_mut(), &request.clones, &payloads, &donors).map_err(lift)?
    };
    // Правило, которое клон занял под штатным именем, — не «штатное, не изменившееся», а заменённое.
    purged.extend(
        cloned
            .iter()
            .filter(|item| item.replaced.is_some())
            .map(|item| format!("effect:{}", item.effect)),
    );

    // Подмена текстур: лист ядра ищется уже с листами слотов и клонов.
    let slot_sheets: HashSet<String> = request
        .reservations
        .iter()
        .map(|item| item.texture.as_deref().unwrap_or_default().trim().to_uppercase())
        .collect();
    let core = ypt::read(&image.structure().to_resource()).map_err(lift)?;
    let textures = check_textures(&request.textures, &core.textures, &slot_sheets)?;
    pixels::put(image.structure_mut(), &textures.writer).map_err(lift)?;

    // Размер спрайта правится тем же проходом: ядро читается и пишется один раз.
    if request.rules.len() > PATCH_CAP {
        return Err(EngineError::invalid_data(
            "YPT rule patch count must not exceed 64.",
        ));
    }
    if named_twice(
        request
            .rules
            .iter()
            .map(|draft| draft.rule.clone().unwrap_or_default()),
    ) {
        return Err(EngineError::invalid_data(
            "YPT rule patch names must be unique and non-empty.",
        ));
    }
    let mut reports = Vec::new();
    for draft in &request.rules {
        reports.push(rule_patch::apply_tracer_shape(&mut image, &draft.patch).map_err(lift)?);
    }

    // Сборка: один образ со всеми правками, один файл.
    let finished = image.into_file().map_err(lift)?;
    if finished.len() < 16 {
        return Err(EngineError::invalid_data("Patched YPT is empty."));
    }

    // Перечитывание до записи: то, что заказано, обязано пережить сохранение.
    let reread = Image::parse(&finished).map_err(lift)?;
    if let Some(report) = &stock {
        stock_keyframes::verify_after_save(&reread, &request.stock, report).map_err(lift)?;
    }
    for report in &reports {
        rule_patch::verify_after_save(&reread, report).map_err(lift)?;
    }
    let mut graph_remarks = BTreeSet::new();
    let verification = match (&before, &baseline) {
        (Some(before), Some(baseline)) => {
            vanilla::verify_graph(&reread, Some(baseline), &mut graph_remarks).map_err(lift)?;
            if !request.reservations.is_empty() {
                let names: Vec<String> = reserved.iter().map(|slot| slot.effect.clone()).collect();
                slots::verify_counts(&reread, &names).map_err(lift)?;
            }
            let after = vanilla::inventory(&reread).map_err(lift)?;
            let patched_rules: HashSet<String> = request
                .rules
                .iter()
                .map(|draft| draft.patch.rule.trim().to_uppercase())
                .chain(
                    stock
                        .iter()
                        .flat_map(|report| report.objects.iter().map(|name| name.to_uppercase())),
                )
                .collect();
            let purged_set: HashSet<String> = purged.iter().cloned().collect();
            let mut expected: HashSet<String> = clones::expected_keys(&cloned, &restored).into_iter().collect();
            expected.extend(slots::expected_keys(&request.reservations));
            let found = vanilla::compare(
                before,
                &after,
                &textures.names,
                &patched_rules,
                &purged_set,
                &expected,
            )
            .map_err(lift)?;
            for item in &request.reservations {
                slots::verify_slot(&reread, item).map_err(lift)?;
            }
            clone_io::verify_clones(reread.structure(), &cloned)?;
            Some(found)
        }
        _ => None,
    };

    if let Some(folder) = output.parent() {
        fs::create_dir_all(folder)?;
    }
    write_atomic(&output, &finished)?;

    let slot_reservations = match &verification {
        None => Value::Null,
        Some(found) => object([
            ("reserved", slot_io::reserved_answer(&reserved)),
            ("verification", verification_answer(found)),
        ]),
    };
    let effect_clones = if request.clones.is_empty() && request.reset.is_empty() {
        Value::Null
    } else {
        object([
            (
                "cloned",
                Value::Array(cloned.iter().map(clone_io::cloned_json).collect()),
            ),
            (
                "purged",
                Value::Array(purged.iter().map(|key| Value::from(key.as_str())).collect()),
            ),
        ])
    };
    // Отпечаток входа снимается после записи: если выход лёг на вход, он называет уже новый файл.
    let input_sha = sha256_hex(&fs::read(&input)?);
    Ok(object([
        ("status", Value::from("ready")),
        ("mode", Value::from("ypt-texture-patch")),
        ("input", Value::from(input.display().to_string())),
        ("output", Value::from(output.display().to_string())),
        ("inputSha256", Value::from(input_sha)),
        ("outputSha256", Value::from(sha256_hex(&finished))),
        ("outputBytes", Value::from(finished.len())),
        ("patches", Value::Array(textures.answer)),
        ("rules", rules_answer(&reports)),
        ("slotReservations", slot_reservations),
        ("stockKeyframes", stock_answer(&stock)),
        ("effectClones", effect_clones),
        ("nameHashRemarks", remarks_answer(&hash_remarks)),
        ("graphRemarks", graph_answer(&graph_remarks)),
        (
            "validation",
            object([
                ("reopened", Value::from(true)),
                ("structurePreserved", Value::from(true)),
                ("atomicOutput", Value::from(true)),
                (
                    "vanillaDigestsCompared",
                    Value::from(verification.is_some()),
                ),
            ]),
        ),
    ]))
}

const YPT_PATCH: Command = Command::new(COMMAND_NAME, run);

pub const COMMANDS: &[Command] = &[YPT_PATCH];

// Файл называется `tests.rs`: сторож прямой записи (`shop::tests`) не считает такие файлы рабочим кодом.
#[cfg(test)]
#[path = "ypt_patch/slots/tests.rs"]
mod slots_tests;
#[cfg(test)]
mod tests;
