/*
 * Замененка из каталога — на вещь, которую выбрал человек («На что поставить»).
 *
 *  1. Подписанный пакет вещи скачивается тем же доверенным путём, что и любая
 *     установка (`downloadSignedPackage`: подпись, sha256, разрешённые хосты).
 *  2. Модель ложится под имя выбранной вещи — папка персонажа, компонент,
 *     номер, суффикс `_u/_r` цели; расцветки — под её буквы. Сколько букв у
 *     серверной вещи, знает цель (`textures`): каждая получает свою расцветку
 *     мода — по буквам автора (`@modovik/clothing/colour-pairs`), а цвет без
 *     пары — ту, что выбрал человек, иначе на нём осталась бы серверная
 *     текстура. Байты не меняются — только имена. Исключение — модель без
 *     привязки к костям (разбор 02.11.2026): она получает веса тела игры
 *     (`clothing-body-skin.js`), иначе в игре стоит в позе манекена.
 *  3. Собранное ставится строгим локальным пакетом в Astral Clothing DLC
 *     (`clothing-replace-manifest-trust.js`). Прежняя замена на эту же вещь,
 *     покраска её и вещь каталога на её номере сменяются: у них один слот.
 *
 * Пол совпадает всегда. Вид вещи может быть другим (25.10.2026, «одежда сядет
 * на любую одежду»): кобура с модели бронежилета (`task`) ложится на место
 * футболки (`jbib`). Тогда имена файлов и компонент в манифесте — цели, а не
 * мода: игра ищет `jbib_018_u.ydd`, и слот тот же, что у любой замены на эту
 * футболку. Что пускать, решает `crossFit` (`@modovik/clothing/targets`): части
 * тела (`head`, `hair`, `uppr`) в обе стороны — нет, аксессуар с одеждой не
 * мешается, аксессуар на аксессуар — только на одной кости.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  CLOTHING_PACK_REPLACE_CAPABILITIES,
  CLOTHING_REPLACE_CAPABILITIES,
  CLOTHING_REPLACE_DLC_TARGET,
  canonicalManifest,
  clothingColourSlot,
  clothingPackColourSlot,
  clothingPackReplaceSlot,
  clothingPackTarget,
  clothingReplaceFolder,
  clothingReplaceSlot,
  clothingReplaceSourceDigest,
  downloadSignedPackage,
  engineInstallEnabled,
  installLocalClothingReplacePackage,
  inspectProfile,
  installLocalClothingReplacePackages,
  MAX_REPLACE_FILES,
  maxReplaceFiles,
  planPackage,
  uninstallPackage,
} from "@modovik/install-engine";
import { incompatibility } from "@modovik/clothing/targets";
import { cleanGameNames } from "@modovik/clothing/game-names";
import { MAJESTIC_OVERLAY_INNER, MAJESTIC_OVERLAY_PACK, majesticOverlayFolder } from "@modovik/clothing/majestic-dlc";
import { clothingWriteNotes } from "./clothing-write-note.js";
import { missingPackPlace, readGamePlace, routeOfTarget, serverOfTarget } from "./clothing-route.js";
import { clothingVisibilityFacts, clothingVisibilityNotes } from "./clothing-registration-check.js";
import { installVisibility, routeClients } from "./clothing-install-visibility.js";
import { modelFileName, textureFileName } from "@modovik/clothing/names";
import { alternatePlan, parseAlternate } from "@modovik/clothing/model-variants";
import { projectAlternatesOf } from "@modovik/clothing/project-alternates";
import { colourPairs, mappedPairs, normalizeColourMapping, normalizeModColours } from "@modovik/clothing/colour-pairs";
import {
  composeRpfArchive,
  installRpfPrebuilt,
  probeRpfArchive,
  provideLegacyDlcList,
  provideUpdateContentXml,
} from "./rpf-composer.js";
import { provisionClothingInfrastructure } from "./clothing-dlc-provisioner.js";
import { clothingContainerOptions } from "./clothing-container-options.js";
import { translateClothingFiles } from "@modovik/install-engine/clothing-update-route.js";
import { nativeRestorePointsRoot } from "./native-restore-chain.js";
import { clothingReplaceReplayRecord } from "./clothing-replace-replay.js";
import { atomicWrite } from "./ytd-bake.js";
import { needsBodySkin, withGameBodySkin } from "./clothing-body-skin.js";

const LETTERS = "abcdefghijklmnopqrstuvwxyz";
const ENTRY =
  /^astral_stream_0[01]\.rpf\/(mp_[mf]_freemode_01(?:_p)?(?:_[a-z0-9_]{1,64})?)\/([^/]+)$/;
const MODEL = /^((?:p_)?[a-z]{3,6})_(\d{3})(?:_([ur]))?\.ydd$/;
const TEXTURE =
  /^((?:p_)?[a-z]{3,6})_diff_(\d{3})_([a-z])(?:_([a-z]{3}))?\.ytd$/;
const MOD_ID = /^[a-z0-9][a-z0-9._-]{0,95}$/;
const CATALOG_MOD_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const refusal = (code, message) => Object.assign(new Error(message), { code });

/**
 * Что лежит в подписанном пакете вещи: модель и расцветки по буквам. У набора перчаток (одна перчатка — 11 моделей под 11 кроёв торса, `glove-forms.js`) моделей несколько:
 * `form` — номер модели, что описывается (модель и расцветки с этим номером); без него несколько моделей — отказ, как и прежде.
 */
export function describeClothingPackage(manifest, { form = null } = {}) {
  const files = (manifest?.files || []).filter(
    (file) =>
      file?.action === "import" &&
      String(file.target || "").toLowerCase() === CLOTHING_REPLACE_DLC_TARGET,
  );
  let model = null;
  const textures = new Map();
  /* Доп. модели источника (`hair_003_u_1.ydd`…): номер варианта → файл; берутся те, что принадлежат основной модели (тот же вид и номер). */
  const variants = [];
  let folder = null;
  for (const file of files) {
    const entry = ENTRY.exec(String(file.entry || ""));
    if (!entry) continue;
    const name = entry[2];
    const modelMatch = MODEL.exec(name);
    const textureMatch = TEXTURE.exec(name);
    const variant = modelMatch || textureMatch ? null : parseAlternate(name);
    if (variant && (form === null || variant.drawable === form)) {
      variants.push({ file, ...variant });
      continue;
    }
    if (modelMatch && form !== null && Number(modelMatch[2]) !== form) continue;
    if (textureMatch && form !== null && Number(textureMatch[2]) !== form) continue;
    if (modelMatch) {
      if (model)
        throw refusal(
          "CLOTHING_REPLACE_PACKAGE",
          "В пакете несколько моделей — это набор, а не одна вещь.",
        );
      folder = entry[1];
      model = {
        file,
        component: modelMatch[1],
        drawable: Number(modelMatch[2]),
        modelSuffix: modelMatch[3] || null,
      };
    } else if (textureMatch)
      textures.set(textureMatch[3], { file, race: textureMatch[4] || null });
  }
  if (!model)
    throw refusal("CLOTHING_REPLACE_PACKAGE", form === null ? "В пакете этой вещи нет модели." : `В пакете этой вещи нет модели №${form}.`);
  if (!textures.size)
    throw refusal(
      "CLOTHING_REPLACE_PACKAGE",
      form === null ? "В пакете этой вещи нет ни одной расцветки." : `В пакете этой вещи нет расцветок модели №${form}.`,
    );
  const info = clothingReplaceFolder(folder);
  const alternates = new Map();
  for (const variant of variants)
    if (variant.component === model.component && variant.drawable === model.drawable && (!model.modelSuffix || variant.suffix === model.modelSuffix) && !alternates.has(variant.number))
      alternates.set(variant.number, variant.file);
  return {
    folder,
    gender: info?.gender || "male",
    prop: model.component.startsWith("p_"),
    component: model.component,
    drawable: model.drawable,
    modelSuffix: model.modelSuffix,
    model: model.file,
    alternates,
    textures,
  };
}

/** Номера моделей пакета — формы набора перчаток: `[7, 8, …]` по возрастанию. */
export function clothingPackageForms(manifest) {
  const forms = new Set();
  for (const file of manifest?.files || []) {
    if (file?.action !== "import" || String(file.target || "").toLowerCase() !== CLOTHING_REPLACE_DLC_TARGET) continue;
    const name = ENTRY.exec(String(file.entry || ""))?.[2];
    const match = name && MODEL.exec(name);
    if (match) forms.add(Number(match[2]));
  }
  return [...forms].sort((left, right) => left - right);
}

/*
 * Цвет вещи (задача 9): одна буква у моделей одного кроя — бронежилет
 * фракции. Модель и прочие цвета не трогаются.
 */
function normalizeColourTarget(target, folder, info) {
  if (info.props)
    throw refusal(
      "CLOTHING_REPLACE_TARGET",
      "У аксессуаров нет цвета на несколько моделей.",
    );
  const letter = String(target.letter || "");
  if (!/^[a-z]$/.test(letter))
    throw refusal("CLOTHING_REPLACE_TARGET", "Не выбран цвет вещи.");
  const drawables = [
    ...new Set((target.drawables || []).map((value) => Number(value))),
  ].sort((left, right) => left - right);
  if (
    !drawables.length ||
    drawables.length > 64 ||
    drawables.some(
      (value) => !Number.isInteger(value) || value < 0 || value > 999,
    )
  )
    throw refusal("CLOTHING_REPLACE_TARGET", "Номера моделей вещи неверные.");
  return {
    name: String(target.name || "").slice(0, 80),
    gender: info.gender,
    folder,
    component: String(target.component || ""),
    prop: false,
    colour: true,
    drawables,
    letter,
    modelSuffix: null,
    race: /^[a-z]{3}$/.test(target.race || "") ? target.race : "uni",
    textures: 1,
  };
}

/** Вещь сервера из запроса окна: папка персонажа, номер, буквы, суффиксы. */
export function normalizeReplaceTarget(target = {}) {
  const folder = String(target.folder || "").toLowerCase();
  const info = clothingReplaceFolder(folder);
  if (!info)
    throw refusal(
      "CLOTHING_REPLACE_TARGET",
      "Непонятно, на какую вещь ставить: у цели нет папки персонажа.",
    );
  if (Array.isArray(target.drawables))
    return normalizeColourTarget(target, folder, info);
  const drawable = Number(target.drawable);
  if (!Number.isInteger(drawable) || drawable < 0 || drawable > 999)
    throw refusal("CLOTHING_REPLACE_TARGET", "Номер вещи на сервере неверный.");
  const normalized = {
    name: String(target.name || "").slice(0, 80),
    gender: info.gender,
    folder,
    component: String(target.component || ""),
    prop: info.props,
    drawable,
    /* Картинка вещи сервера (https): в запись установки — «Библиотека» рисует пару «вещь → заменёнка». */
    picture: /^https:\/\/[^\s"'<>\\]{4,290}$/i.test(String(target.picture || "")) ? String(target.picture) : "",
    /* Названия вещи на языках игры (ru, en, de, fr, pl; 17.11.2026): в запись установки — «Библиотека» называет вещь на языке окна. Только известные языки и непустые строки. */
    ...(cleanGameNames(target.names) ? { names: { ...cleanGameNames(target.names) } } : {}),
    modelSuffix: ["u", "r"].includes(target.modelSuffix)
      ? target.modelSuffix
      : null,
    race: /^[a-z]{3}$/.test(target.race || "") ? target.race : null,
    textures: Math.max(1, Math.min(26, Number(target.textures) || 1)),
    /* Свои пары цветов у этой вещи: на нескольких бронежилетах заменёнка стоит на своих расцветках каждого (02.11.2026). */
    mapping: normalizeColourMapping(target.mapping),
    /* Проект вещи (14.11.2026): маршрут установки берётся из цели, а не из вкладки окна; пусто — штатная вещь игры (`clothing-route.js`). Нет поля — вещь от старого окна: берётся `request.server`. */
    ...(Object.hasOwn(target, "server") ? { server: serverOfTarget(target) } : {}),
  };
  /* Доп. модели вещи собственной коллекции проекта — по данным разбора (`project-alternates-data.js`): оглавление игры игрока их не знает, а без них под шапкой, маской, курткой игра берёт прежнюю доп. модель сервера
     (ветка hair-beard-alternates, 15.11.2026). Штатная вещь и вещь белого пака получают их из оглавления игры позже (`widenToGame`, `routeOfTarget`). */
  const given = validAlternates(target.alternates, normalized.component, drawable);
  const alternates = given.length ? given : projectAlternatesOf(normalized);
  return alternates.length ? { ...normalized, alternates } : normalized;
}

/** Названные цели доп. модели (`target.alternates`): только `<вид>_<номер>_<u|r>_<N>.ydd` этой вещи, один суффикс, номера варианта без повторов, не больше 40; прочее отбрасывается. По возрастанию номера варианта. */
function validAlternates(names, component, drawable) {
  if (!Array.isArray(names)) return [];
  const seen = new Set();
  let suffix = null;
  const kept = [];
  for (const name of names) {
    const parsed = parseAlternate(name);
    if (!parsed || parsed.component !== component || parsed.drawable !== drawable) continue;
    if ((suffix && parsed.suffix !== suffix) || seen.has(parsed.number)) continue;
    suffix = parsed.suffix;
    seen.add(parsed.number);
    kept.push({ name: String(name).toLowerCase(), number: parsed.number });
  }
  return kept
    .sort((left, right) => left.number - right.number)
    .slice(0, 40)
    .map((item) => item.name);
}

/*
 * Сколько вещей за раз: бронежилеты ставят на броню всех фракций сервера
 * сразу, но не на сотни — каждая вещь пересобирает DLC одежды.
 */
const MAX_TARGETS = 64;

/**
 * Набор перчаток: `forms` — `[{ target, source }]`, какая модель пакета (`source`, её номер) встаёт на какой номер выбранной перчатки (`target`): по крою торса, считает окно
 * (`matchGloveForms`). Результат — `Map(target → source)`, у цели с папкой — `Map("папка|target" → source)`; `null` — вещь одна, как обычно.
 */
export function normalizeForms(input) {
  if (!Array.isArray(input) || !input.length) return null;
  if (input.length > MAX_TARGETS)
    throw refusal("CLOTHING_REPLACE_TARGET", `За раз — не больше ${MAX_TARGETS} вещей.`);
  const forms = new Map();
  for (const entry of input) {
    const target = Number(entry?.target);
    const source = Number(entry?.source);
    if (![target, source].every((value) => Number.isInteger(value) && value >= 0 && value <= 999))
      throw refusal("CLOTHING_REPLACE_TARGET", "Номера форм перчатки неверные.");
    /* Перчатка, что лежит сразу в нескольких паках игры (одна плитка, `game-looks.js`), несёт папку цели: номер 3 у Байкеров и номер 3 у Ограблений — разные вещи. */
    const folder = typeof entry?.folder === "string" ? entry.folder.toLowerCase() : "";
    forms.set(folder ? `${folder}|${target}` : target, source);
  }
  return forms;
}

/**
 * Проверяет запрос окна: пакет, вещи сервера (`targets`; одна — `target`),
 * выбранная расцветка.
 */
export function normalizeClothingReplaceRequest(input) {
  const manifest = input?.manifest;
  if (!manifest || !MOD_ID.test(String(manifest.id || "")))
    throw refusal("CLOTHING_REPLACE_MOD", "У вещи каталога нет пакета.");
  const list =
    Array.isArray(input?.targets) && input.targets.length
      ? input.targets
      : [input?.target || {}];
  if (list.length > MAX_TARGETS)
    throw refusal(
      "CLOTHING_REPLACE_TARGET",
      `За раз — не больше ${MAX_TARGETS} вещей.`,
    );
  const targets = list.map(normalizeReplaceTarget);
  /* Цвет вещи без её модели — только у покраски: у мода каталога своя
     модель, и прочие цвета остались бы на чужой развёртке. */
  if (targets.some((target) => target.colour))
    throw refusal(
      "CLOTHING_REPLACE_TARGET",
      "Мод каталога ставится на вещь целиком — один её цвет меняет только покраска из мастерской.",
    );
  const variant = String(input?.variant || "a");
  if (!/^[a-z]$/.test(variant))
    throw refusal("CLOTHING_REPLACE_VARIANT", "Расцветка не выбрана.");
  return {
    manifest,
    baseUrl: String(input?.baseUrl || ""),
    name: String(input?.name || manifest.id).slice(0, 120),
    targetName: targets[0].name,
    target: targets[0],
    targets,
    variant,
    forms: normalizeForms(input?.forms),
    /* Расцветки мода и буквы автора, на которых они стояли: по ним каждый цвет вещи получает свою (`colour-pairs.js`). */
    colours: normalizeModColours(input?.colours),
    /* Явные пары окна «Какой цвет будет виден в игре»: цвет вещи → расцветка мода; без них — правило по буквам автора. */
    mapping: normalizeColourMapping(input?.mapping),
    /* Чьи заменёнки на выбранных вещах человек согласился сменить. */
    replace: normalizeReplaceIds(input?.replace),
    /* Проект, на который ставят: у Majestic замена идёт в пак игры (`clothing-pack-place.js`). */
    server: /^[a-z0-9_-]{1,32}$/.test(String(input?.server || ""))
      ? String(input.server)
      : "",
    /* Мод каталога за пакетом — в запись установки (`origin.catalogModId`):
       по нему «Библиотека» рисует его карточку на каждой вещи. У облачного
       каталога id мода — не id манифеста, его даёт окно. */
    catalogModId: CATALOG_MOD_ID.test(String(input?.catalogModId || ""))
      ? String(input.catalogModId)
      : manifest.id,
    /* sha256 обложки мода — в запись установки: карточка «Библиотеки» рисуется и до прихода каталога. */
    cover: /^[a-f0-9]{64}$/i.test(String(input?.cover || ""))
      ? String(input.cover).toLowerCase()
      : "",
    gameRoot: path.resolve(String(input?.gameRoot || "")),
    targetId: String(input?.targetId || "default"),
  };
}

const RACE_OF_SUFFIX = Object.freeze({ u: "uni", r: "whi" });

/**
 * Имена файлов вещи сервера для вещи-источника: модель под номером цели,
 * расцветки — под всеми её буквами. Компонент в именах — цели (`jbib_018_u`
 * для модели `task`, поставленной на футболку); у цели без компонента — мода,
 * как раньше. Суффикс `_u/_r` — цели, а если она его не знает, — источника;
 * раса — цели, затем по суффиксу (`_u` — `uni`, `_r` — `whi`), затем источника.
 * Проп (шапка, очки) их не носит.
 *
 * Другой компонент пускает только `cross: true` (замена каталога): покраска
 * зовёт без него и по-прежнему ставит вещь лишь на её же вид.
 */
export function replaceNames(source, target, { cross = false } = {}) {
  const component = target.component || source.component;
  const reason = incompatibility(
    { gender: source.gender, component: source.component, prop: source.prop },
    { ...target, component },
    { cross },
  );
  if (reason) throw refusal("CLOTHING_REPLACE_INCOMPATIBLE", reason);
  /* Цвет вещи: только текстуры этой буквы у каждой модели кроя. */
  if (target.colour)
    return {
      model: null,
      textures: target.drawables.map((drawable) =>
        textureFileName({
          component,
          drawable,
          letter: target.letter,
          race: target.race || source.race || "uni",
        }),
      ),
    };
  const prop = component.startsWith("p_");
  const suffix = prop ? null : target.modelSuffix || source.modelSuffix || "u";
  /* Раса — цели; не знает (у вещи патч-пака в оглавлении игры нет файлов текстур) — по суффиксу модели, как в игре: `_u` — `uni`, `_r` — `whi`. Расу источника берём лишь после этого:
     модель джинсов (`_r`) от куртки (`_u`, `uni`) иначе легла бы с листами `uni`, а игра для `_r` ищет `whi` — и заменёнка тихо не работала. */
  const race = prop ? null : target.race || RACE_OF_SUFFIX[suffix] || source.race || "uni";
  return {
    model: modelFileName({
      component,
      drawable: target.drawable,
      modelSuffix: suffix,
    }),
    textures: Array.from({ length: target.textures }, (_, index) =>
      textureFileName({
        component,
        drawable: target.drawable,
        letter: LETTERS[index],
        race,
      }),
    ),
  };
}

/** Доп. модели цели в план замены: `[{ role: "model", source, name, number, own }]`; у цели без вариантов (или не из игры) пусто. */
function modelAlternatesPlan(described, target, modelName = null) {
  /* Только доп. модели с тем же суффиксом (`_u`/`_r`), что у основной модели: иначе манифест не пройдёт доверие (`alternatesAgree`); данные разбора проекта и оглавление игры называют суффикс по-своему. */
  const suffix = /_([ur])\.ydd$/i.exec(String(modelName || ""))?.[1]?.toLowerCase() || null;
  const names = (Array.isArray(target?.alternates) ? target.alternates : []).filter((name) => !suffix || parseAlternate(name)?.suffix === suffix);
  if (!names.length || target.colour || target.prop) return [];
  const plan = alternatePlan(
    names.map((name) => ({ name, number: parseAlternate(name)?.number })).filter((item) => item.number),
    new Map([...(described.alternates || [])].map(([number, file]) => [number, file])),
    described.model,
  );
  return plan.map(({ name, source, number, own }) => ({ role: "model", source, name, number, own }));
}

/**
 * Пары «цвет вещи → расцветка мода» по именам текстур цели (`colour-pairs.js`).
 * Расцветки мода — из окна (`request.colours`, буквы автора); без них — буквы
 * самого пакета, каждая на свою: цвет вещи L получает расцветку L мода.
 */
export function colourPairsFor(described, request, textureNames, target = null) {
  const colours = request.colours?.length
    ? request.colours
    : normalizeModColours(
        [...described.textures.keys()].map((letter) => ({ letter })),
      );
  const targets = textureNames.map((name) => TEXTURE.exec(name)?.[3] || "a");
  const mapping = target?.mapping?.length ? target.mapping : request.mapping;
  if (mapping?.length)
    return mappedPairs({
      targets,
      mapping,
      fallback: request.variant,
      has: (letter) => described.textures.has(letter),
    });
  return colourPairs({
    targets,
    colours,
    fallback: request.variant,
    has: (letter) => described.textures.has(letter),
  });
}

/**
 * План переноса: какой файл пакета под каким именем ляжет. Каждый цвет вещи
 * получает свою расцветку мода (`colourPairs`): байты не меняются, только
 * имена; цвет без пары автора — выбранная расцветка.
 */
export function clothingReplacePlan(described, request) {
  const target = {
    ...request.target,
    component: request.target.component || described.component,
  };
  if (!described.textures.has(request.variant)) {
    /* Сначала — совместимость: чужой пол важнее пропущенной буквы. */
    replaceNames(described, target, { cross: true });
    throw refusal(
      "CLOTHING_REPLACE_VARIANT",
      `У вещи нет расцветки «${request.variant.toUpperCase()}».`,
    );
  }
  const chosen = described.textures.get(request.variant);
  const names = replaceNames({ ...described, race: chosen.race }, target, {
    cross: true,
  });
  const pairs = colourPairsFor(described, request, names.textures, target);
  const plan = [
    { role: "model", source: described.model, name: names.model },
    /* Доп. модели цели (`_1`, `_2`…, `target.alternates` — по оглавлению игры): у источника свой вариант с тем же номером или его основная модель. */
    ...modelAlternatesPlan(described, target, names.model),
    ...names.textures.map((name, index) => ({
      role: "texture",
      source: described.textures.get(pairs[index].source).file,
      name,
    })),
  ];
  return { plan, target, pairs, cross: target.component !== described.component };
}

/*
 * Манифест замены в паке игры (Majestic): записи `replace` по вложенному
 * архиву моделей пака. Форма — `isLocalClothingReplaceManifest`.
 */
/** Поле `copies` метаданных замены: паки с копиями файлов вещи, что грузятся позже пака вещи (`@modovik/clothing/later-copies`); нет копий — ничего. */
const copiesOf = (pack) => (pack.copies?.length ? { copies: pack.copies.map((copy) => ({ pack: copy.pack, inner: copy.inner })) } : {});

function buildPackManifest({ source, name, targetName, target, component, files, pack }) {
  const digest = clothingReplaceSourceDigest(files);
  const suffix = digest.slice(0, 12);
  /* Цвет вещи на месте в паке игры (бронежилет, находка 3 ревью): одна буква у каждой модели кроя, только текстуры — форма «цвет вещи в паке». */
  const replace = target.colour
    ? {
        schemaVersion: 1,
        sourceModId: source.modId,
        sourceVersion: String(source.version || "1.0.0"),
        gender: target.gender,
        folder: target.folder,
        component,
        drawables: target.drawables,
        letter: target.letter,
        sourceDigest: `sha256:${digest}`,
        pack: pack.pack,
        inner: pack.inner,
        ...copiesOf(pack),
      }
    : {
        schemaVersion: 1,
        sourceModId: source.modId,
        sourceVersion: String(source.version || "1.0.0"),
        gender: target.gender,
        folder: target.folder,
        component,
        drawable: target.drawable,
        sourceDigest: `sha256:${digest}`,
        pack: pack.pack,
        inner: pack.inner,
        ...copiesOf(pack),
      };
  return {
    id: `local-clothing-replace-${suffix}`,
    version: `1.0.0-${suffix}`,
    name: targetName ? `${name} → ${targetName}` : name,
    editions: ["Legacy"],
    scope: "game-root",
    adapter: "rpf-entry",
    requiresLoader: false,
    gameplayChanges: false,
    capabilities: [...CLOTHING_PACK_REPLACE_CAPABILITIES],
    slots: [target.colour ? clothingPackColourSlot(replace) : clothingPackReplaceSlot(replace)],
    clothingReplace: replace,
    files: files.map((file) => ({
      source: `payload/${file.name}`,
      /* Запись копии — в архив пака, чья копия файла грузится позже (`file.pack`), своя запись вещи — в пак вещи. */
      target: clothingPackTarget(file.pack || pack.pack),
      /* Вещь серверного пака в своём архиве добавляется (`majesticOverlayPlace`), вещь пака игры — заменяется. */
      action: pack.action || "replace",
      entry: file.entry,
      size: file.size,
      sha256: file.sha256,
    })),
  };
}

function buildManifest({ source, name, targetName, target, component, files }) {
  const digest = clothingReplaceSourceDigest(files);
  const suffix = digest.slice(0, 12);
  const replace = target.colour
    ? {
        schemaVersion: 1,
        sourceModId: source.modId,
        sourceVersion: String(source.version || "1.0.0"),
        gender: target.gender,
        folder: target.folder,
        component,
        drawables: target.drawables,
        letter: target.letter,
        sourceDigest: `sha256:${digest}`,
      }
    : {
        schemaVersion: 1,
        sourceModId: source.modId,
        sourceVersion: String(source.version || "1.0.0"),
        gender: target.gender,
        folder: target.folder,
        component,
        drawable: target.drawable,
        sourceDigest: `sha256:${digest}`,
      };
  return {
    id: `local-clothing-replace-${suffix}`,
    version: `1.0.0-${suffix}`,
    name: targetName ? `${name} → ${targetName}` : name,
    editions: ["Legacy"],
    scope: "game-root",
    adapter: "rpf-entry",
    requiresLoader: false,
    gameplayChanges: false,
    capabilities: [...CLOTHING_REPLACE_CAPABILITIES],
    slots: [
      target.colour ? clothingColourSlot(replace) : clothingReplaceSlot(replace),
    ],
    clothingReplace: replace,
    files: files.map((file) => ({
      source: `payload/${file.name}`,
      target: CLOTHING_REPLACE_DLC_TARGET,
      action: "import",
      entry: file.entry,
      size: file.size,
      sha256: file.sha256,
    })),
  };
}

/* Веса тела из архивов игры игрока: читатель архивов и хост — только когда модели они нужны. */
const gameBodySkin = (stateDir) => async (input) => {
  if (!needsBodySkin(input.name, input.bytes)) return input.bytes;
  const { clothingArchiveTools } = await import("./clothing-models.js");
  return withGameBodySkin({ ...input, tools: clothingArchiveTools(stateDir), work: path.join(stateDir, "clothing-replacements", "work") });
};

/**
 * Пакет замены на одну вещь из готовых байтов: `files` — `{ name, bytes }`
 * под именами вещи сервера. Общий у замененки каталога и покраски из
 * мастерской: у покраски байты текстуры запечены, у замененки — из пакета.
 */
export async function writeClothingReplacePackage({
  stateDir,
  source,
  name,
  targetName = "",
  target,
  component,
  files,
  gameRoot,
  targetId = "default",
  /* Замена в паке игры (Majestic): `{ pack, inner }` — иначе Astral Clothing DLC. */
  pack = null,
  /* Пары «цвет вещи → расцветка мода» (`colourPairsFor`): в отчёт установки, в файлы не пишутся. */
  pairs = null,
  /* Картинка вещи сервера — в запись установки (`origin.itemPicture`). */
  targetPicture = "",
  /* Названия вещи-цели на языках игры — в запись установки (`origin.itemNames`). */
  targetNames = null,
  /* Веса тела для модели без привязки (`clothing-body-skin.js`): `({ name, bytes, target, gameRoot }) → bytes`; `false` — не трогать. */
  skinModel = undefined,
  /* Маршрут вещи (`clothing-route.js`): в результат установки — окно говорит словами, кто увидит заменёнку. */
  route = null,
}) {
  /* Файлы и манифест говорят об одном компоненте — вещи, на которую ставят.
     Расхождение (имена мода при компоненте цели) замок установки всё равно
     отклонил бы, но после запекания и скачивания: здесь это видно сразу. */
  for (const file of files) {
    const match = MODEL.exec(file.name) || TEXTURE.exec(file.name) || (parseAlternate(file.name) ? [file.name, parseAlternate(file.name).component] : null);
    if (!match || match[1] !== component)
      throw refusal(
        "CLOTHING_REPLACE_COMPONENT",
        `Файл «${file.name}» не принадлежит месту «${component}»: имена должны следовать вещи, на которую ставят.`,
      );
  }
  /* Потолок файлов — тот же, что у доверия манифесту: 65-й файл раньше отказывал обезличенным «манифест не доверен» уже после запекания (ревью 14.11, №15). */
  if (files.length > MAX_REPLACE_FILES)
    throw refusal(
      "CLOTHING_REPLACE_TARGET",
      `У вещи слишком много файлов (${files.length}): Astral ставит заменёнку не больше чем на ${MAX_REPLACE_FILES} файлов — модель, её доп. модели и расцветки.`,
    );
  /* Модель без весов (разбор 02.11.2026): в игре она стоит в позе привязки, кадр окна это прятал. Веса тела — в сам файл, до записи.
     Одна и та же модель источника, лежащая во всех вариантах цели (сумки — до 26 ступеней), получает веса один раз, а не по разу на файл (ревью, №17). */
  const skin = skinModel === undefined ? gameBodySkin(stateDir) : skinModel;
  if (skin) {
    const fitted = [];
    const done = new Map();
    for (const file of files) {
      if (!(MODEL.test(file.name) || parseAlternate(file.name))) {
        fitted.push(file);
        continue;
      }
      const key = createHash("sha256").update(file.bytes).digest("hex");
      if (!done.has(key)) done.set(key, await skin({ name: file.name, bytes: file.bytes, target, gameRoot }));
      fitted.push({ ...file, bytes: done.get(key) });
    }
    files = fitted;
  }
  const entries = files.map((file) => ({
    name: file.name,
    entry: pack
      ? `${pack.inner}/${target.folder}/${file.name}`
      : `astral_stream_00.rpf/${target.folder}/${file.name}`,
    size: file.bytes.length,
    sha256: sha256(file.bytes),
  }));
  /*
   * Копии в паках, что грузятся позже: те же файлы вещи (имя и байты) в архив каждой копии — игра видит поздний пак, и без этого запись в пак вещи оставалась бы незамеченной. Копия пишется только по тем
   * файлам, которые пишет сама операция (покраска не пишет доп. модели, а они могут быть перекрыты патчем — ревью 15.11, №2): остальные имена копии отбрасываются, пустая копия исчезает.
   */
  const written = new Set(entries.map((entry) => entry.name));
  const copies = (pack?.copies || [])
    .map((copy) => ({ ...copy, names: copy.names.filter((name) => written.has(name)) }))
    .filter((copy) => copy.names.length);
  for (const copy of copies)
    for (const name of copy.names) {
      const own = entries.find((entry) => entry.name === name);
      entries.push({ ...own, entry: `${copy.inner}/${target.folder}/${name}`, pack: copy.pack });
    }
  if (pack) pack = { ...pack, copies };
  /* Потолок — на архив: не больше `MAX_REPLACE_FILES` записей в паке вещи и в каждой копии (ревью 15.11.2026, №11: сумка с 26 доп. моделями и 26 листами в паке с копиями — обычная вещь); считается по месту записи,
     а не только в сумме — доверие манифеста (`clothing-replace-manifest-trust.js`) проверяет то же. */
  const perPlace = new Map();
  for (const entry of entries) {
    const place = `${entry.pack || ""}|${entry.entry.slice(0, entry.entry.length - entry.name.length)}`;
    perPlace.set(place, (perPlace.get(place) || 0) + 1);
  }
  const crowded = Math.max(0, ...perPlace.values());
  if (crowded > MAX_REPLACE_FILES || entries.length > maxReplaceFiles(copies.length))
    throw refusal(
      "CLOTHING_REPLACE_TARGET",
      `У вещи вместе с копиями в патч-паках слишком много файлов (${crowded} в одном архиве, всего ${entries.length}): Astral ставит заменёнку не больше чем на ${MAX_REPLACE_FILES} файлов в каждом архиве.`,
    );
  const manifest = (pack ? buildPackManifest : buildManifest)({
    source,
    name,
    targetName,
    target,
    component,
    files: entries,
    pack,
  });
  const directory = path.join(
    stateDir,
    "clothing-replacements",
    "packages",
    manifest.id.slice(-12),
  );
  for (const file of files)
    await atomicWrite(path.join(directory, "payload", file.name), file.bytes);
  /* Чья это заменёнка: по нему следующая расцветка той же работы сменяет
     прежнюю без вопроса «Заменить её?» (`sameWorkIds`). */
  await atomicWrite(
    path.join(directory, SOURCE_FILE),
    Buffer.from(
      JSON.stringify({
        sourceModId: String(source.modId || ""),
        /* Перенос скина мужской вещи на женскую пару (ТЗ 29.10.2026): откуда, какая пара и мера — для «Библиотеки» и разбора. */
        ...(source.transfer
          ? { transfer: { percent: source.transfer.percent, pair: source.transfer.pair, from: source.transfer.from } }
          : {}),
      }),
    ),
  );
  return {
    directory,
    manifest,
    manifestHash: `sha256:${sha256(Buffer.from(canonicalManifest(manifest)))}`,
    textures: target.textures,
    targetName,
    targetPicture,
    targetNames,
    gameRoot,
    targetId,
    /* Куда писать: пак игры (Majestic) или Astral Clothing DLC. */
    pack: pack ? pack.pack : null,
    pairs,
    route,
  };
}

/** Скачивает пакет вещи каталога: что в нём и чем читать его файлы. */
export async function openClothingPackage(request, stateDir, deps) {
  const downloaded = await (deps.download || downloadSignedPackage)({
    manifest: request.manifest,
    baseUrl: request.baseUrl,
    publicKey: deps.publicKey,
    stateDir,
    downloadsDir: deps.downloadsDir || null,
    allowInsecureLocalhost: Boolean(deps.allowInsecureLocalhost),
    allowedHosts: deps.allowedHosts ?? null,
    onProgress: deps.onProgress || null,
  });
  const verified = downloaded?.manifest || request.manifest;
  const root = path.resolve(downloaded.packageRoot);
  const read = async (file) => {
    const absolute = path.resolve(root, file.source);
    if (!absolute.startsWith(root + path.sep))
      throw refusal("CLOTHING_REPLACE_PACKAGE", "Файл пакета вне пакета.");
    const bytes = await fs.readFile(absolute);
    /* Байты — ровно те, что подписаны: иначе замена несла бы чужое. */
    if (
      file.sha256 &&
      sha256(bytes) !== String(file.sha256).replace(/^sha256:/, "")
    )
      throw refusal(
        "CLOTHING_REPLACE_PACKAGE",
        "Файл пакета не совпал с подписью.",
      );
    return bytes;
  };
  /* Набор перчаток: моделей несколько, каждая цель берёт свою (`forms`); у одной вещи — единственная. */
  const forms = request.forms ? clothingPackageForms(verified) : null;
  return {
    manifest: verified,
    described: request.forms ? null : describeClothingPackage(verified),
    forms,
    describe: (form) => describeClothingPackage(verified, { form }),
    read,
  };
}

/**
 * Пакет, каким он виден цели: у набора перчаток — модель и расцветки той формы, что выпала ей по крою торса (`request.forms`); у одной вещи — как есть. Формы, которой нет в
 * пакете, или цель без формы — отказ словами: ставить «что-нибудь» на руки персонажа нельзя.
 */
export function openedForTarget(opened, request, target) {
  if (!request.forms) return opened;
  const source = request.forms.get(`${String(target.folder || "").toLowerCase()}|${target.drawable}`) ?? request.forms.get(target.drawable);
  if (source === undefined)
    throw refusal("CLOTHING_REPLACE_FORMS", `Для номера ${target.drawable} не выбрана модель перчатки.`);
  if (!opened.forms?.includes(source))
    throw refusal("CLOTHING_REPLACE_FORMS", `В пакете нет модели №${source}, которая вставала на номер ${target.drawable}.`);
  return { ...opened, described: opened.describe(source) };
}

/**
 * Вещь серверного пака Majestic (`…_clothes_pack0..3`): файлов в игре у неё нет,
 * замена ложится в свой overlay-RPF белого пака (`@modovik/clothing/majestic-dlc`:
 * гипотеза по файлу владельца, в игре не проверено). Иначе — `null`.
 */
export const majesticOverlayPlace = (target) =>
  majesticOverlayFolder(target?.folder)
    ? { pack: MAJESTIC_OVERLAY_PACK, inner: MAJESTIC_OVERLAY_INNER, action: "import" }
    : null;

/*
 * Majestic: имена файлов — те, что у вещи в паке игры (модель и каждая
 * расцветка), а не вычисленные из «сколько цветов у вещи»: запись идёт
 * `replace` по вложенному архиву пака, и чужое имя было бы отказом движка.
 * Вещь серверного пака имён в игре не имеет: они по её строке базы (`majesticOverlayPlace`).
 */
async function buildForPack(opened, request, stateDir, deps, routed) {
  const { plan: wanted, target, pairs: wantedPairs } = clothingReplacePlan(opened.described, request);
  const overlay = routed.place ? null : routed.pack;
  if (overlay) {
    const files = [];
    for (const step of wanted)
      files.push({ name: step.name, bytes: await opened.read(step.source) });
    return writeClothingReplacePackage({
      stateDir,
      source: { modId: request.manifest.id, version: request.manifest.version },
      name: request.name,
      targetName: request.target.name,
      targetPicture: request.target.picture,
      targetNames: request.target.names,
      target,
      component: target.component,
      files,
      gameRoot: request.gameRoot,
      skinModel: deps.skinModel,
      targetId: request.targetId,
      pack: overlay,
      pairs: wantedPairs,
      route: routed.summary,
    });
  }
  const place = routed.place;
  /* Каждая расцветка вещи в паке — своя расцветка мода (`colour-pairs.js`): буква файла игры → буква автора. */
  const pairs = colourPairsFor(opened.described, request, place.textures, target);
  const plan = [
    { source: wanted[0].source, name: place.model },
    /* Доп. модели вещи в паке игры: каждая получает модель источника (свой вариант с тем же номером или основную). */
    ...modelAlternatesPlan(opened.described, { alternates: place.alternates, prop: target.prop }).map(({ source, name }) => ({ source, name })),
    ...place.textures.map((name, index) => ({
      source: opened.described.textures.get(pairs[index].source).file,
      name,
    })),
  ];
  const files = [];
  for (const step of plan)
    files.push({ name: step.name, bytes: await opened.read(step.source) });
  return writeClothingReplacePackage({
    stateDir,
    source: { modId: request.manifest.id, version: request.manifest.version },
    name: request.name,
    targetName: request.target.name,
    targetPicture: request.target.picture,
      targetNames: request.target.names,
    target: { ...target, textures: place.textures.length },
    component: target.component,
    files,
    gameRoot: request.gameRoot,
    skinModel: deps.skinModel,
    targetId: request.targetId,
    /* Пак вещи и копии её файлов в паках, что грузятся позже (патч-паки): `routed.pack` — из маршрута (`packOf`). */
    pack: routed.pack,
    pairs,
    route: routed.summary,
  });
}

export { missingPackPlace };

/*
 * GTA5RP и прочие: число расцветок вещи — по игре игрока, если вещь лежит в её паках, а в посте автора их меньше («Спортивная
 * водолазка»: 11 в посте, 12 в игре — двенадцатый цвет оставался штатным). Вещи серверных паков в игре нет — число из поста.
 */
async function widenToGame(request, deps) {
  const target = request.target;
  if (!deps.gamePlace || target.colour || target.prop) return request;
  /* То же правило, что у маршрута (`readGamePlace`): сбой чтения — отказ, а не тихое «в игре её нет»; вещи собственной коллекции проекта оглавление не читает. */
  const place = await readGamePlace(deps, target, serverOfTarget(target, request.server));
  const count = Math.min(26, place?.textures?.length || 0);
  const alternates = place?.alternates || [];
  /* Вещь лежит в игре (но писать «на месте» нельзя: база, пак вне белого списка): доп. модели — те же, что в игре, иначе при маске или куртке игра берёт штатную. */
  const wider = count > target.textures ? { ...target, textures: count } : target;
  return wider === target && !alternates.length ? request : { ...request, target: { ...wider, ...(alternates.length ? { alternates } : {}) } };
}

async function buildForTarget(opened, request, stateDir, deps = {}) {
  /* Маршрут — по вещи-цели (`clothing-route.js`): штатная вещь — на месте в паке игры, Majestic — пак или overlay, GTA 5 RP — Astral Clothing DLC. */
  const server = serverOfTarget(request.target, request.server);
  const routed = await routeOfTarget({ target: request.target, server, deps });
  /* Цвет вещи ставит покраска (`clothing-paint.js`): замена вещью каталога несёт модель, а у цвета её нет. Раньше сюда цвет не доходил, а теперь маршрут может быть «в паке игры» — не путать с overlay. */
  if (routed.pack && request.target.colour)
    throw refusal(
      "CLOTHING_REPLACE_TARGET",
      "Цвет бронежилета ставится покраской бронежилета, а не заменой вещью каталога.",
    );
  if (routed.pack) return buildForPack(opened, request, stateDir, deps, routed);
  request = await widenToGame(request, deps);
  const { plan, target, pairs } = clothingReplacePlan(opened.described, request);
  const files = [];
  for (const step of plan)
    files.push({ name: step.name, bytes: await opened.read(step.source) });
  return writeClothingReplacePackage({
    stateDir,
    source: { modId: request.manifest.id, version: request.manifest.version },
    name: request.name,
    targetName: request.target.name,
    targetPicture: request.target.picture,
      targetNames: request.target.names,
    target,
    component: target.component,
    files,
    gameRoot: request.gameRoot,
    skinModel: deps.skinModel,
    targetId: request.targetId,
    pairs,
    route: routed.summary,
  });
}

/** Собирает локальный пакет замены на первую вещь запроса. */
export async function buildClothingReplacement(input, stateDir, deps = {}) {
  const request = normalizeClothingReplaceRequest(input);
  const opened = await openClothingPackage(request, stateDir, deps);
  return {
    request,
    ...(await buildForTarget(openedForTarget(opened, request, request.target), request, stateDir, deps)),
  };
}

function installOptions(built, stateDir, extra = {}) {
  return {
    manifest: built.manifest,
    packageRoot: built.directory,
    gameRoot: built.gameRoot,
    targetId: built.targetId,
    edition: "Legacy",
    stateDir,
    allowGameRootWrites: true,
    requireSignature: false,
    rpfProbe: probeRpfArchive,
    ...extra,
  };
}

const replacementIds = (plan) =>
  [...new Set((plan.conflicts || []).map((item) => item.modId))].sort();

const SOURCE_FILE = "source.json";

/*
 * Прежние пакеты той же работы среди занявших вещь: другая расцветка того же
 * мода каталога (или новая покраска той же работы мастерской) сменяет
 * прежнюю сама — это не «чужая заменёнка». Чья она, пакет помнит в
 * `source.json` рядом со своими файлами; у пакетов без него — чужая.
 */
async function sameWorkIds(modIds, sourceModId, stateDir) {
  const same = [];
  for (const modId of modIds) {
    const suffix = /^local-clothing-replace-([a-f0-9]{12})$/.exec(modId)?.[1];
    if (!suffix || !sourceModId) continue;
    try {
      const file = path.join(stateDir, "clothing-replacements", "packages", suffix, SOURCE_FILE);
      const source = JSON.parse(await fs.readFile(file, "utf8"));
      if (source?.sourceModId === sourceModId) same.push(modId);
    } catch {
      /* Пакет старше памяти о работе — значит, чужая заменёнка. */
    }
  }
  return same;
}

/** Что окно разрешило сменить: прежние пакеты той же работы и «Заменить её». */
export const normalizeReplaceIds = (input) =>
  [...new Set((Array.isArray(input) ? input : []).map(String).filter((modId) => /^[a-z0-9][a-z0-9._-]{0,127}$/i.test(modId)))].slice(0, 256);

/**
 * Ставит готовые пакеты замены. На вещи сервера — одна заменёнка (задача 4
 * ТЗ 05.10.2026): если на ней уже стоит чужая, вторая не ставится, пока
 * человек не согласился её сменить (`replace` — modId, которые окно
 * разрешило снять: прежние пакеты той же работы и «Заменить её»). Иначе —
 * отказ со словами, какая вещь занята. DLC одежды готовится один раз на
 * все вещи.
 *
 * Вещи — каждая своим пакетом и своим слотом: куртка на торс и штаны на
 * ноги стоят вместе, и снятие одной другую не трогает. `origin` — откуда
 * пакет (мод каталога — `catalogModId`); без него — работа мастерской.
 */
export async function installClothingReplacePackages(
  built,
  stateDir,
  deps = {},
  { replace = [], origin = null } = {},
) {
  const allowed = new Set(normalizeReplaceIds(replace));
  const [first] = built;
  const game = await deps.assertGameReady?.(first.gameRoot, { mutate: true });
  /* Режим контейнера (`ASTRAL_CLOTHING_VIA_UPDATE=container`, 21.11.2026): вещь, чьи записи все уходят в `update.rpf`, старого пакета одежды не касается — хост не готовится.
     Хост нужен, только если какая-то запись в контейнер не идёт (базовый реквизит, имя не по правилу): смешанный случай — как раньше. Без выключателя маршрута нет. */
  const container = await clothingContainerOptions(stateDir, deps);
  const toContainer = (item) => Boolean(!item.pack && container.clothingUpdateRoute && translateClothingFiles({ files: item.manifest.files }).all);
  const needsHost = (item) => !item.pack && !toContainer(item);
  /* Astral Clothing DLC нужен, только если есть что в него класть: замена на
     Majestic идёт в пак игры, а целиком в контейнер — в update.rpf; хост ей не нужен. */
  if (built.some(needsHost))
    await (deps.provision || provisionClothingInfrastructure)({
      gameRoot: first.gameRoot,
      targetId: first.targetId,
      edition: "Legacy",
      stateDir,
      assertRuntimeSafety: () => deps.assertRuntimeSafety?.(game),
      activate: false,
    });
  /* Сначала — все планы: занятая вещь называется до того, как что-то
     встало, а не на третьей вещи из пяти. */
  const plans = [];
  /* Вещь целиком в контейнер: пакета одежды нет, проба его архива нечего искать — план считает занятость по слотам состояния без пробы. */
  for (const item of built) plans.push(await (deps.plan || planPackage)(installOptions(item, stateDir, toContainer(item) ? { rpfProbe: null } : {})));
  /* Занятость считается по самой вещи (коллекция, компонент, номер; у цвета ещё лист), а не по слоту маршрута: прежняя заменёнка в Astral Clothing DLC и новая на месте в паке игры стоят в разных слотах,
     но на RAGE MP первая с order 101 перекрыла бы вторую молча. Стоит другая — отказ тем же `CLOTHING_SLOT_TAKEN`, пока человек не согласился её заменить. */
  const consented = new Set(allowed);
  const cross = await otherRouteOccupants({
    built,
    stateDir,
    deps,
    wanted: allowed.size > 0,
    serverOf: (item) => item.route?.server ?? item.server ?? origin?.server ?? "",
  });
  for (const [index, item] of built.entries())
    for (const modId of await sameWorkIds(
      [...replacementIds(plans[index]), ...cross.ids[index]],
      item.manifest.clothingReplace?.sourceModId,
      stateDir,
    ))
      allowed.add(modId);
  const taken = built
    .map((item, index) => ({ item, foreign: [...replacementIds(plans[index]), ...cross.ask[index]].filter((modId) => !allowed.has(modId)) }))
    .filter((entry) => entry.foreign.length);
  if (taken.length)
    throw refusal(
      "CLOTHING_SLOT_TAKEN",
      `На ${taken.map((entry) => `«${entry.item.targetName || entry.item.manifest.name}»`).join(", ")} уже стоит другая заменёнка. Выберите в «На что поставить» другую вещь или нажмите «Заменить её».`,
    );
  /* Флаг `ASTRAL_ENGINE_INSTALL=clothing-replace`: вещь сервера — одна точка на её текстуры, с записью переигрывания. */
  const engineInstallOf = (item) =>
    !item.pack && engineInstallEnabled("clothing-replace")
      ? {
          install: deps.installPrebuilt ?? installRpfPrebuilt,
          edition: "Legacy",
          gameRoot: item.gameRoot,
          pointsRoot: deps.pointsRoot ?? nativeRestorePointsRoot(),
          multi: true,
          replay: clothingReplaceReplayRecord(item),
        }
      : null;
  /* Название — в запись установки: окно по нему называет, чья
     заменёнка стоит на вещи («заменит «…» на этом слоте»), а мод
     каталога и вещь — по чему «Библиотека» рисует карточку. */
  const originOf = (item) =>
    origin
      ? {
          ...origin,
          ...(item.targetName ? { item: item.targetName } : {}),
          ...(item.targetPicture ? { itemPicture: item.targetPicture } : {}),
          ...(item.targetNames ? { itemNames: item.targetNames } : {}),
        }
      : { title: item.manifest.name, source: "workshop" };
  const common = {
    rpfComposer: composeRpfArchive,
    dlcListProvider: provideLegacyDlcList,
    contentXmlProvider: provideUpdateContentXml,
    assertRuntimeSafety: () => deps.assertRuntimeSafety?.(game),
    onProgress: deps.onProgress,
    /* Одежда freemode через контейнер в update.rpf (20.11.2026, `clothing-update-install.js`): только при `ASTRAL_CLOTHING_VIA_UPDATE`; пусто — ничего не добавляется. */
    ...container,
  };
  const installed = new Array(built.length);
  /*
   * Вещи без подмены движком — одной транзакцией (02.11.2026): набор перчаток Majestic на 14 вещей
   * в трёх паках игры пересобирал 3-гигабайтный mpheist/dlc.rpf десять раз и копировал его в игру
   * десять раз (513 с). Теперь каждый тронутый архив собирается и ложится в игру один раз; записи
   * установки — по-прежнему своя на каждую вещь. Подставная установка тестов (`deps.install`) — по одной.
   */
  const batched = built.map((item, index) => ({ item, index })).filter(({ item }) => !engineInstallOf(item));
  const batchInstall = deps.installBatch || (deps.install ? null : installLocalClothingReplacePackages);
  if (batched.length > 1 && batchInstall) {
    const [{ item: lead }] = batched;
    const state = await batchInstall({
      ...installOptions(lead, stateDir, common),
      manifest: undefined,
      packageRoot: undefined,
      packages: batched.map(({ item, index }) => ({
        manifest: item.manifest,
        packageRoot: item.directory,
        replaceModIds: replacementIds(plans[index]),
        origin: originOf(item),
      })),
    });
    for (const { index } of batched) installed[index] = state;
  }
  for (const [index, item] of built.entries()) {
    if (installed[index]) continue;
    const engineInstall = engineInstallOf(item);
    installed[index] = await (deps.install || installLocalClothingReplacePackage)(
      installOptions(item, stateDir, {
        ...common,
        origin: originOf(item),
        replaceModIds: replacementIds(plans[index]),
        ...(engineInstall ? { engineInstall } : {}),
      }),
    );
  }
  /* Проект вещи: по её маршруту (`clothing-route.js`), иначе — по запросу окна. */
  const serverOf = (item) => item.route?.server ?? item.server ?? origin?.server ?? "";
  /* Журнал (13.11.2026): куда легла каждая вещь — архив, путь записи, ped/компонент/номер; запись в Astral Clothing DLC при Majestic — предупреждение. */
  for (const item of built)
    for (const note of clothingWriteNotes(item.manifest, { server: serverOf(item), kind: origin ? "Замена" : "Покраска" })) deps.journal?.(note);
  /* Штатная вещь, что встала на месте в паке игры, вытесняет прежнюю заменёнку на ней в Astral Clothing DLC. */
  const superseded = await removeSupersededOtherRoute({ cross, allowed, consented, stateDir, deps, game, targetId: first.targetId });
  /* Увидит ли игра записанное (14.11.2026): DLC одежды зарегистрирован в update.rpf; RAGE MP и Majestic запускают игру из той же папки, куда пишет Astral. Клиент, которому запись
     ни к чему (Majestic при записи в Astral Clothing DLC, RAGE MP при overlay Majestic), не проверяется. Факты — в журнал и словами в окно (`visibility`). */
  const usesAstral = built.some(needsHost);
  /* Вещь целиком ушла в контейнер `x64/astral/astral_rp_clothing.rpf` (`toContainer`: режим включён и ВСЕ файлы переведены): такую вещь клиент RAGE MP видит, и слова «в Astral Clothing DLC,
     на GTA 5 RP не видно» к ней не относятся (метка `container`, `clothing-install-visibility.js`). Вещь пака игры и любая с файлом, оставшимся в хосте, метки не получают.
     Метка живёт только в этом вызове: в результат установки (`route`) уходит прежний маршрут. */
  const routes = built.map((item) => (item.route && toContainer(item) ? { ...item.route, container: true } : item.route)).filter(Boolean);
  const forRage = routes.length ? routes.some((route) => routeClients(route).includes("rage")) : built.some((item) => !item.pack && serverOf(item) !== "majestic");
  const forMajestic = routes.some((route) => routeClients(route).includes("majestic"));
  let facts = null;
  if (deps.journal || deps.checkRegistration || deps.readRage || deps.readMajestic) {
    const options = { registration: usesAstral };
    if (deps.checkRegistration) options.checkRegistration = deps.checkRegistration;
    if (!forRage) options.readRage = async () => null;
    else if (deps.readRage) options.readRage = deps.readRage;
    /* Папка игры Majestic читается только по явному читателю (его даёт приложение): тесты и сборки без него настоящий Majestic не трогают. */
    options.readMajestic = forMajestic && deps.readMajestic ? deps.readMajestic : async () => null;
    facts = await clothingVisibilityFacts(first.gameRoot, options);
    if (deps.journal) for (const note of await clothingVisibilityNotes(first.gameRoot, { facts, forGta5rp: forRage })) deps.journal(note);
  }
  /* Прежняя заменёнка в Astral Clothing DLC не снялась (или не удалось проверить, стоит ли она): на RAGE MP она с order 101 перекроет новую — об этом словами, а не «Установлено». */
  const visibility = installVisibility({
    routes,
    facts,
    gameRoot: first.gameRoot,
    extra: [
      ...supersededFailedProblems({ built, cross, superseded }),
      /* Прежний цвет снят без вопроса — сказать об этом (info: оговорки нет, но человек должен знать, что стояло раньше). */
      ...(superseded.unasked.length ? [{ level: "info", code: "superseded-removed" }] : []),
    ],
  });
  const results = built.map((item, index) => ({
    ...installed[index],
    modId: item.manifest.id,
    slot: item.manifest.slots[0],
    textures: item.textures,
    pairs: item.pairs,
    replaced: [...replacementIds(plans[index]), ...superseded.removed],
    route: item.route || null,
  }));
  return { ...results[0], results, restartRequired: true, visibility };
}

/*
 * Одна вещь — одна заменёнка, каким бы маршрутом она ни встала (15.11.2026). Слот у маршрутов разный: пак игры — с хвостом `-majestic`, Astral Clothing DLC — без; план движка (`plan.conflicts`)
 * видит только свой слот, и прежняя заменёнка в другом слоте оставалась: на RAGE MP запись из Astral Clothing DLC (order 101, грузится позже паков) молча перекрывала новую «на месте» —
 * в игре видно не то, что поставили (находка независимой сверки матрицы, пара 29). Теперь ищем на той же вещи пакеты из слота другого маршрута:
 *  • штатная вещь на месте в паке игры → прежняя в Astral Clothing DLC (слот без хвоста); вещь в Astral Clothing DLC → прежняя в паке игры (слот с хвостом);
 *  • проект Majestic (`server: majestic`) — только свой слот: Astral Clothing DLC клиент Majestic не берёт, окно на этой вкладке смотрит один слот (`occupantOf`);
 *  • занято и человек не согласился — отказ `CLOTHING_SLOT_TAKEN`; согласился («Заменить её», прежние пакеты той же работы) — прежняя снимается после установки новой;
 *  • цвет вещи на месте в паке (бронежилет, буква) — прежний цвет той же буквы в Astral Clothing DLC это его же прежняя установка на той же цели: согласия не требует, снимается сам (`unasked`, находка 1 перепроверки,
 *    14.11.2026: иначе запись с order 101 молча перекрыла бы новый цвет), окно говорит об этом словами `superseded-removed`.
 */
const crossSlotOf = (item, server) => {
  const own = String(item.manifest.slots?.[0] || "");
  if (!own || server === "majestic") return null;
  if (item.pack) return item.route?.route === "pack" && own.endsWith("-majestic") ? own.replace(/-majestic$/, "") : null;
  return own.endsWith("-majestic") ? null : `${own}-majestic`;
};

async function otherRouteOccupants({ built, stateDir, deps, wanted, serverOf }) {
  const slots = built.map((item) => crossSlotOf(item, serverOf(item)));
  const colour = built.map((item) => Boolean(item.pack && item.manifest.clothingReplace?.letter));
  const empty = built.map(() => []);
  const result = { ids: empty, ask: built.map(() => []), slots, unasked: new Set(), unchecked: false, targetId: built[0]?.targetId };
  if (!slots.some(Boolean)) return result;
  const profile = await (deps.inspectProfile || inspectProfile)({ stateDir }).catch((error) => {
    deps.journal?.({ level: "warn", message: `Замена: не удалось прочитать установленное, чтобы снять прежнюю заменёнку на этой вещи в другом слоте: ${String(error?.message || error).slice(0, 160)}` });
    return null;
  });
  /* Прочитать не удалось: проверка занятости по вещи не состоялась — об этом слова, только если снимать что-то собирались (согласие или прежний цвет); иначе поведение прежнее. */
  if (!profile) return { ...result, unchecked: wanted || colour.some(Boolean) };
  const installed = profile?.targets?.[result.targetId]?.installed || [];
  result.ids = built.map((_, index) => (slots[index] ? [...new Set(installed.filter((entry) => (entry.slots || []).includes(slots[index])).map((entry) => entry.modId))] : []));
  result.ask = result.ids.map((ids, index) => (colour[index] ? [] : ids));
  for (const [index, ids] of result.ids.entries()) if (colour[index]) for (const modId of ids) result.unasked.add(modId);
  return result;
}

/*
 * Слова о прежней заменёнке, что не снялась (ревью 15.11, №8б): направление зависит от того, куда легла новая. Новая на месте в паке игры — прежняя в Astral Clothing DLC (на RAGE MP он грузится позже и
 * перекроет новую): `superseded-failed`. Новая в Astral Clothing DLC — прежняя в паке игры: на RAGE MP новая как раз сильнее, а на Majestic виден пак — `superseded-failed-pack`. Профиль не прочитан —
 * направление по тем вещам, у которых вообще есть слот другого маршрута.
 */
function supersededFailedProblems({ built, cross, superseded }) {
  if (!superseded.failed.length && !superseded.unchecked) return [];
  const codes = new Set();
  for (const [index, item] of built.entries()) {
    const failed = (cross.ids[index] || []).some((modId) => superseded.failed.includes(modId)) || (superseded.unchecked && Boolean(cross.slots?.[index]));
    if (failed) codes.add(item.pack ? "superseded-failed" : "superseded-failed-pack");
  }
  if (!codes.size) codes.add("superseded-failed");
  return [...codes].map((code) => ({ level: "warn", code }));
}

async function removeSupersededOtherRoute({ cross, allowed, consented, stateDir, deps, game, targetId }) {
  const result = { removed: [], failed: [], unchecked: cross.unchecked, unasked: [] };
  const ids = [...new Set(cross.ids.flat())].filter((modId) => allowed.has(modId) || cross.unasked.has(modId));
  for (const modId of ids)
    try {
      await (deps.uninstall || uninstallPackage)({
        modId,
        targetId,
        stateDir,
        rpfComposer: composeRpfArchive,
        contentXmlProvider: provideUpdateContentXml,
        dlcListProvider: provideLegacyDlcList,
        assertRuntimeSafety: () => deps.assertRuntimeSafety?.(game),
      });
      result.removed.push(modId);
      if (!consented.has(modId) && cross.unasked.has(modId)) result.unasked.push(modId);
    } catch (error) {
      result.failed.push(modId);
      deps.journal?.({ level: "warn", message: `Замена: прежняя заменёнка ${modId} на этой вещи в другом слоте не снялась: ${String(error?.message || error).slice(0, 160)}` });
    }
  return result;
}

/*
 * Перенос картинки мужского мода на женскую пару (`clothing-paint.js`): та же сборка, что у покраски мастерской, но источник — пакет мода (его модель — мужская
 * поверхность, его расцветка — картинка), а пакет замены — женская пара из игры с перенесённой картинкой на женские вещи сервера. Мод — в записи установки.
 * Majestic (ТЗ 30.10.2026): тот же путь, что у мужских заменёнок, — женская пара пишется в пак игры, где лежит выбранная женская вещь (`packPlace`, белый список паков клиента), а вещь серверного пака — в свой overlay-RPF (`majesticOverlayPlace`).
 */
async function applyTransferReplacement(input, stateDir, deps) {
  const manifest = input?.manifest;
  if (!manifest || !MOD_ID.test(String(manifest.id || ""))) throw refusal("CLOTHING_REPLACE_MOD", "У вещи каталога нет пакета.");
  const targets = Array.isArray(input.targets) && input.targets.length ? input.targets : [input.target || {}];
  const name = String(input.name || manifest.id).slice(0, 120);
  const variant = String(input.variant || "a");
  if (!/^[a-z]$/.test(variant)) throw refusal("CLOTHING_REPLACE_VARIANT", "Расцветка не выбрана.");
  const { applyClothingPaint } = await import("./clothing-paint.js");
  return applyClothingPaint(
    {
      source: { kind: "catalog", manifest, baseUrl: String(input.baseUrl || ""), variant },
      transfer: input.transfer,
      targets,
      server: input.server,
      name,
      textures: [],
      replace: input.replace,
      gameRoot: input.gameRoot,
      targetId: input.targetId,
    },
    stateDir,
    deps,
    {
      origin: {
        source: "catalog",
        title: name,
        catalogModId: CATALOG_MOD_ID.test(String(input?.catalogModId || "")) ? String(input.catalogModId) : manifest.id,
        ...(/^[a-f0-9]{64}$/i.test(String(input?.cover || "")) ? { cover: String(input.cover).toLowerCase() } : {}),
        ...(/^[a-z0-9_-]{1,32}$/.test(String(input?.server || "")) ? { server: String(input.server) } : {}),
      },
    },
  );
}

/**
 * Ставит замененку каталога на выбранные вещи сервера. Пакет качается один
 * раз, на каждую вещь собирается свой пакет замены.
 */
export async function applyClothingReplacement(input, stateDir, deps = {}) {
  /* Мужской мод каталога на женскую вещь (ТЗ 29.10.2026, пп. 4–5): модель мода на женское тело не ставится, переносится только картинка — на женскую пару из игры. */
  if (input?.transfer) return applyTransferReplacement(input, stateDir, deps);
  const request = normalizeClothingReplaceRequest(input);
  const opened = await openClothingPackage(request, stateDir, deps);
  const built = [];
  for (const target of request.targets)
    built.push(await buildForTarget(openedForTarget(opened, request, target), { ...request, target }, stateDir, deps));
  return installClothingReplacePackages(built, stateDir, deps, {
    replace: request.replace,
    origin: {
      source: "catalog",
      title: request.name,
      catalogModId: request.catalogModId,
      ...(request.cover ? { cover: request.cover } : {}),
      ...(request.server ? { server: request.server } : {}),
    },
  });
}
