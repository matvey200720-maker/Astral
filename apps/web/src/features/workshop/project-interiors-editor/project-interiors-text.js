/*
 * Слова и облик кадра редактора «Интерьеры проектов» — отдельно от
 * компонентов: их берут кадр, колонка правок и обложка.
 *
 * Облик листа в кадре повторяет установщик (как у «Интерьеров» магазинов):
 *   «Как в игре» — лист как в файлах интерьера;
 *   свой цвет — тоном по светотени листа;
 *   блеск — чистота листа той же арифметикой, что у установщика
 *     (`shops-shine.js` → шейдер кадра `uRcClean`), глянец и зеркало —
 *     гладкостью материала (блик кадра — студийный).
 * Поверхность листа кадр узнаёт по записи материала сцены (`surface`): сцену
 * собирает главный процесс из файлов игрока (`project-interiors/scene.js`) и
 * помечает только листы самого интерьера — их и правит установщик.
 */

import { PROJECT_SURFACES, projectLabel, shopShine } from "@modovik/climb-contract/recolor/project-interiors";
import { sanitizeDesktopErrorMessage } from "../../../api.js";
import { formatSize } from "../../../catalog-utils.js";
import { surfaceLook } from "../building-editor/building-text.js";
import { currentUiLanguage, tr } from "../../../locales/ui.js";

/* Быстрые цвета: светлые и тёмные отделки и яркие для своих. */
export const PROJECT_SWATCHES = Object.freeze(["#f4f2ec", "#d8d2c4", "#9a958c", "#4a4744", "#1b1b1e", "#c9a27a", "#8a5a36", "#2f80ed", "#27ae60", "#f2c94c", "#e30613", "#9b51e0"]);

export const surfaceLabel = (id) => PROJECT_SURFACES.find((item) => item.id === id)?.label || id;

/** Шаблон словаря со вставками: `fill(tr("Облик «{0}» — {1}"), a, b)`. */
export const fill = (template, ...values) => String(template).replace(/\{(\d+)\}/g, (_, index) => String(values[Number(index)] ?? ""));

/* ------------------------------------------------------------------ *
 * Слова с числом: склонение — по языку окна
 * ------------------------------------------------------------------ */

function form(count, forms) {
  if (forms.fr) return count === 0 || count === 1 ? forms[0] : forms[1];
  if (forms.length === 2) return count === 1 ? forms[0] : forms[1];
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (forms.pl && count === 1) return forms[0];
  if (mod10 === 1 && mod100 !== 11 && !forms.pl) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}
const polish = (forms) => Object.assign([...forms], { pl: true });
const french = (forms) => Object.assign([...forms], { fr: true });
const language = (words) => (words[currentUiLanguage()] ? currentUiLanguage() : "ru");

const INTERIOR_WORDS = Object.freeze({
  ru: ["интерьер", "интерьера", "интерьеров"],
  uk: ["інтер’єр", "інтер’єри", "інтер’єрів"],
  en: ["interior", "interiors"],
  de: ["Innenraum", "Innenräume"],
  pl: polish(["wnętrze", "wnętrza", "wnętrz"]),
  fr: french(["intérieur", "intérieurs"]),
});
const SHEET_WORDS = Object.freeze({
  ru: ["лист", "листа", "листов"],
  uk: ["аркуш", "аркуші", "аркушів"],
  en: ["sheet", "sheets"],
  de: ["Blatt", "Blätter"],
  pl: polish(["arkusz", "arkusze", "arkuszy"]),
  fr: french(["feuille", "feuilles"]),
});
const MODEL_WORDS = Object.freeze({
  ru: ["модель", "модели", "моделей"],
  uk: ["модель", "моделі", "моделей"],
  en: ["model", "models"],
  de: ["Modell", "Modelle"],
  pl: polish(["model", "modele", "modeli"]),
  fr: french(["modèle", "modèles"]),
});

/** «58 интерьеров» на языке окна. */
export const interiorsCountText = (count) => `${count} ${form(count, INTERIOR_WORDS[language(INTERIOR_WORDS)])}`;
/** «12 листов» на языке окна. */
export const sheetsCountText = (count) => `${count} ${form(count, SHEET_WORDS[language(SHEET_WORDS)])}`;
/** «3 модели» на языке окна. */
export const modelsCountText = (count) => `${count} ${form(count, MODEL_WORDS[language(MODEL_WORDS)])}`;

/* ------------------------------------------------------------------ *
 * Каталог: полнота и что мешает установке
 * ------------------------------------------------------------------ */

/** Полнота интерьера одной фразой. */
export function completenessText(unit) {
  const { state, missingModels, missingSheets, missingNewer = 0 } = unit.completeness;
  if (state === "unknown") return tr("Полноту не определить: подключите GTA V — штатные вещи интерьера берутся из неё.");
  if (state === "whole") return tr("Целиком: все модели и листы интерьера найдены.");
  const gaps = [missingModels ? fill(tr("моделей: {0}"), missingModels) : "", missingSheets ? fill(tr("словарей листов: {0}"), missingSheets) : ""].filter(Boolean).join(", ");
  const lacking = fill(tr("Не хватает — {0}. На их месте в игре будет пусто."), gaps);
  /* Часть недостающих моделей — вещи, которых нет ни в одном паке: так выглядит штатная вещь более нового обновления GTA V, которого в игре игрока нет. */
  return missingNewer ? `${lacking} ${fill(tr("Нет ни в паке, ни в вашей игре — моделей: {0}. Это вещи более нового обновления GTA V или ресурсов сервера; Astral на их месте ничего не рисует."), missingNewer)}` : lacking;
}

/** Короткая метка полноты — в строку списка. */
export const completenessLabel = (unit) => ({ whole: tr("целиком"), few: tr("почти"), many: tr("неполный"), unknown: tr("без проверки") })[unit.completeness.state] || "";

const BLOCKERS = Object.freeze({
  "no-game": "Подключите GTA V: без неё нельзя проверить, чего не хватает интерьеру.",
  incomplete: "Интерьер неполный: ему чего-то не хватает.",
  "overrides-game": "Пак правит файлы самой игры (здания снаружи, штатные ресурсы) — это правка города, а не интерьера.",
  "hei-files": "В паке есть файлы сетевых районов (hei_): они ставятся отдельно.",
  "no-placement": "В паке нет карты размещения: где стоять интерьеру, неизвестно.",
  "too-big": "Интерьер слишком велик для одной установки.",
  "no-models": "В паке нет своих моделей.",
  "no-manifest": "В паке нет одного файла _manifest.ymf (или их несколько): без него игра не свяжет карту с типами.",
  "bad-names": "В паке есть файлы с именами, которые Astral не примет: пробелы, скобки или другие лишние символы.",
});
/** Причины, по которым интерьер не предлагается к установке, — словами. */
export const blockerTexts = (unit) => (unit.install?.blockers || []).map((code) => tr(BLOCKERS[code] || code));

/** Подпись интерьера в меню: «Гаражи · Гараж 100». */
export const unitTitle = (unit) => (unit?.category?.length ? `${unit.category[unit.category.length - 1]} · ${unit.label}` : unit?.label || "");

/**
 * Пункты меню выбора интерьера над кадром: разделы — заголовками групп,
 * интерьеры — пунктами с полнотой. `installed` — номера, что уходят в игру.
 */
export function unitMenuOptions(units, installed = new Set(), changed = new Set()) {
  const groups = new Map();
  for (const unit of units) {
    const key = unit.category.join(" / ");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(unit);
  }
  const options = [];
  for (const [category, list] of groups) {
    if (options.length) options.push({ separator: true });
    if (category) options.push({ heading: category });
    for (const unit of list) {
      const marks = [completenessLabel(unit), installed.has(unit.id) ? tr("ставится в игру") : "", changed.has(unit.id) ? tr("есть изменения") : ""].filter(Boolean);
      options.push({ value: unit.id, label: unit.label, description: marks.join(" · ") });
    }
  }
  return options;
}

/** Строка состояния кадра: что ставится. */
export function projectInteriorsPlanText(installedCount) {
  return installedCount ? fill(tr("В игру уедут: {0}."), interiorsCountText(installedCount)) : tr("Ничего не отмечено «Поставить в игру» — в игре ничего не изменится.");
}

/* ------------------------------------------------------------------ *
 * Облик листа в кадре
 * ------------------------------------------------------------------ */

/**
 * Облик материала сцены интерьера: `look` — облик интерьера в работе,
 * `info` — запись материала (`surface` — стены, пол, потолок, мебель или
 * ничего: листы штатных вещей игры не красятся).
 */
export function projectFrameLook(look, info) {
  const emission = info.emissive ? (info.emission ?? 0.6) : 0;
  if (info.mirror) return { colour: "#aeb6bc", map: false, roughness: 0.06, metalness: 0.92 };
  if (info.dirt) return { colour: info.colour, dirt: 1 };
  const surface = info.surface ? look?.surfaces?.[info.surface] : null;
  if (!surface) return { colour: info.colour, emission };
  const shine = shopShine(surface.shine);
  const shineLook = {
    ...(shine.clean ? { clean: { amount: shine.clean, lift: shine.lift } } : {}),
    ...(shine.roughness !== null ? { roughness: shine.roughness, metalness: shine.id === "mirror" ? 0.12 : 0.04, room: true, roomIntensity: shine.reflection } : {}),
  };
  if (surface.mode === "standard") return { colour: info.colour, emission, ...shineLook };
  return { ...surfaceLook(surface, info, null), emission, ...shineLook };
}

/** Название проекта на языке окна («GTA 5 РП» → «GTA 5 RP»). */
export const projectName = (id) => tr(projectLabel(id));

/* ------------------------------------------------------------------ *
 * Пакеты интерьеров из каталога Astral
 * ------------------------------------------------------------------ */

/** Вес пака на языке окна: «18 МБ». */
export const packSizeText = (bytes) => formatSize(bytes, currentUiLanguage());

/** Полнота интерьеров пака одной строкой: «целиком: 3 · почти: 1 · неполных: 2». */
export function packStatesText(pack) {
  const count = (state) => pack.units.filter((unit) => unit.state === state).length;
  return [
    count("whole") ? fill(tr("целиком: {0}"), count("whole")) : "",
    count("few") ? fill(tr("почти: {0}"), count("few")) : "",
    count("many") ? fill(tr("неполных: {0}"), count("many")) : "",
    count("unknown") ? fill(tr("без проверки: {0}"), count("unknown")) : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Ход скачивания: «42% · 8 МБ из 18 МБ»; после обрыва связи — что идёт докачка. */
export function packProgressText(active) {
  if (active.message === "retrying") return tr("Связь оборвалась — докачиваем с того места, где встало.");
  const total = active.totalBytes ? packSizeText(active.totalBytes) : "";
  const done = active.downloadedBytes ? packSizeText(active.downloadedBytes) : "";
  return [`${active.percent}%`, done && total ? fill(tr("{0} из {1}"), done, total) : ""].filter(Boolean).join(" · ");
}

/**
 * Почему пак не скачался — словами для человека (на языке окна): тексты
 * главного процесса и облака русские, их место займёт перевод.
 */
export function packErrorText(error) {
  const raw = sanitizeDesktopErrorMessage(error).replace(/^(?:Source)?Error:\s*/i, "");
  if (/CATALOG_CLOSED/.test(raw)) return tr("Каталог интерьеров пока открыт только команде Astral.");
  if (/Sign in to download|no longer valid|не выполнен вход/i.test(raw)) return tr("Войдите в аккаунт Astral, чтобы скачивать интерьеры.");
  if (/отменено/i.test(raw)) return "";
  if (/Недостаточно места/i.test(raw)) return tr("На диске не хватает места для этого пака. Освободите место и повторите.");
  if (/подпись/i.test(raw)) return tr("Подпись пака не сошлась — Astral его не принял. Повторите позже.");
  if (/Контрольная сумма|повреждён/i.test(raw)) return tr("Файл пака пришёл повреждённым. Повторите: Astral скачает его заново.");
  if (/уже скачивается|дождитесь/i.test(raw)) return tr("Другие паки ещё скачиваются — дождитесь их.");
  if (/fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|HTTP \d{3}|Не удалось скачать|оборвал/i.test(raw)) return tr("Связь с сервером оборвалась. Повторите: загрузка продолжится с того места, где встала.");
  return tr("Не получилось скачать пак. Повторите позже.");
}
