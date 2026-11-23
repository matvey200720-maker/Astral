/*
 * Слова «Расписания»: подписи частей, проценты, места табло на карте и
 * строка «в игре» под кадром.
 */

import {
  SCHEDULE_BOARD,
  SCHEDULE_COLUMN_LABELS,
  SCHEDULE_ICONS,
  SCHEDULE_ICON_IMAGE,
  SCHEDULE_ICON_NONE,
  SCHEDULE_INFO_BOARDS,
  SCHEDULE_MAX_LINES,
  SCHEDULE_MAX_ROWS,
  SCHEDULE_PLACES,
  SCHEDULE_ROW_COUNT,
  SCHEDULE_SIZES,
  findScheduleAstralIcon,
  normalizeScheduleProject,
  scheduleIsStock,
  scheduleReadability,
} from "@modovik/climb-contract/recolor/schedule";
import { currentUiLanguage, tr } from "../../../locales/ui.js";
import { trFill } from "../../../locales/tr-fill.js";

const decimal = (value, digits = 1) => String(Math.round(value * 10 ** digits) / 10 ** digits).replace(".", ",");
/* Объекты `Intl` — при первом обращении, а не при загрузке модуля (30.10.2026, главный модуль): первый из них поднимает данные ICU (~12 мс при ×4 в задаче главного модуля), и платит за это тот, кто загружается первым. */
const rulesByLanguage = {};
/**
 * Слово при числе по правилам множественного числа языка окна: `plural(5, ["строка", "строки", "строк"])` → «строк».
 * Три формы — одна, «две-четыре» и «пять и больше»; у языков с двумя формами (en, de, fr) вторая и третья одинаковы, а категория
 * `other` берёт третью. Правила русского для всех языков давали «21 row», «21 Zeile», «21 wiersz» там, где строк больше двадцати.
 */
export const plural = (count, [one, few, many]) => {
  const language = currentUiLanguage();
  const rules = (rulesByLanguage[language] ||= new Intl.PluralRules(language));
  return { one, few, many }[rules.select(count)] || many;
};
export const rowsText = (count) => `${count} ${plural(count, [tr("строка"), tr("строки"), tr("строк")])}`;
export const percentText = (value) => `${Math.round(value)} %`;
export const metresText = (value) => `${decimal(value)} ${tr("м")}`;
export const glowText = (value) => (value > 0 ? `×${decimal(value)}` : tr("нет"));

/* Образцы цвета полей: белый и тёмный сервера, яркие для времени и акцентов. */
export const SCHEDULE_SWATCHES = Object.freeze(["#ffffff", "#211c21", "#000000", "#f2c200", "#e5b647", "#d9621f", "#c4302b", "#3ff2ff", "#1f5fae", "#2e8b57"]);

export const COLOUR_FIELDS = Object.freeze([
  { key: "title", label: "Заголовок" },
  { key: "text", label: "Названия" },
  { key: "time", label: "Время" },
  { key: "plate", label: "Плашки строк" },
  { key: "accent", label: "Выделенные строки", hint: "Цвет плашки у строк с отметкой «Выделить»" },
  { key: "box", label: "Квадраты значков" },
  { key: "icon", label: "Значки сервера", hint: "Свои картинки остаются своего цвета" },
  { key: "background", label: "Фон щита", hint: "У сервера фона нет: между строк видно мир" },
  { key: "outline", label: "Рамка" },
]);

export const OPACITY_FIELDS = Object.freeze([
  { key: "board", label: "Всё табло", hint: "Множитель на всё сразу: буквы, плашки, значки, фон и рамку" },
  { key: "background", label: "Фон щита", hint: "У сервера 0 % — фона нет" },
  { key: "plates", label: "Плашки строк" },
  { key: "boxes", label: "Квадраты значков" },
  { key: "outline", label: "Рамка" },
]);

/* Значок строки — подпись. */
export function iconLabel(row) {
  if (row.icon === SCHEDULE_ICON_NONE) return tr("Без значка");
  if (row.icon === SCHEDULE_ICON_IMAGE) return row.image?.name || tr("Своя картинка");
  const astral = findScheduleAstralIcon(row.icon);
  if (astral) return `${astral.label} (Astral)`;
  return SCHEDULE_ICONS.find((icon) => icon.id === row.icon)?.label || tr("Значок");
}

/** Строка списка: «AIRDROP · 00:00» (пустая — «Пустая строка»). */
export function rowTitle(row) {
  const parts = [String(row.text || "").trim(), String(row.time || "").trim()].filter(Boolean);
  return parts.length ? parts.join(" · ") : tr("Пустая строка");
}

/** Подпись колонки: у двух — «Левая» и «Правая», у трёх — по номеру, у одной — нет. */
export function columnLabel(column, columns) {
  if (columns === 1) return "";
  if (columns === 2) return SCHEDULE_COLUMN_LABELS[column];
  return trFill("Колонка {0}", column + 1);
}

/** Раскладка табло одной строкой: «16 строк · 2 колонки по 8 · буквы 6,1 см». */
export function layoutText(input) {
  const info = scheduleReadability(input);
  const columns = info.columns === 1 ? tr("одна колонка") : `${info.columns} ${plural(info.columns, [tr("колонка"), tr("колонки"), tr("колонок")])} по ${info.lines}`;
  /* Высота букв — шаблоном словаря: «буквы 6,1 см» на uk/pl оставалось русским (дизайн 12.10). */
  return `${rowsText(info.rows)} · ${columns} · ${tr("буквы {0} см").replace("{0}", decimal(info.letters))}`;
}

/*
 * Честная подсказка о том, как табло читается: буквы против сервера, предел
 * строк, что даёт третья колонка.
 */
export function readabilityHint(input) {
  const info = scheduleReadability(input);
  if (info.rows >= SCHEDULE_MAX_ROWS)
    return {
      warning: true,
      text: trFill("Больше {0} не помещается: табло на месте одно, и буквы стали бы меньше 3 см — в игре их не прочитать. Уберите строку или соберите время в одну строку («10:00, 14:00, 18:00»).", rowsText(SCHEDULE_MAX_ROWS)),
    };
  if (!info.smaller)
    return { warning: false, text: trFill("Буквы {0} см — как у сервера на табло 3,3 м. До {1} строк табло раскладывается ровно как у сервера.", decimal(info.letters), SCHEDULE_ROW_COUNT) };
  const text = trFill(
    "Буквы {0} см — у сервера {1} см ({2} %): строк больше, чем у сервера, поэтому они ниже. Чем мельче буквы, тем ближе к табло нужно подойти.",
    decimal(info.letters),
    decimal(info.server),
    Math.round(info.ratio * 100),
  );
  const third = info.columns < 3 ? tr(" Три колонки делают буквы выше, но длинные названия сжимаются по ширине.") : "";
  return { warning: info.ratio < 0.6, text: `${text}${third} ${trFill("В колонке — не больше {0} строк.", SCHEDULE_MAX_LINES)}` };
}

/* Размер табло на месте: ширина щита в метрах. */
export const placeWidth = (place) => SCHEDULE_BOARD.width * place.scale;

/** Места табло для выбора над кадром: район и ширина щита — на языке окна (собирается при отрисовке, не при загрузке модуля). */
export const placeOptions = () => SCHEDULE_PLACES.map((place) => [place.id, `${tr(place.district)} · ${metresText(placeWidth(place))}`]);
export const findPlace = (id) => SCHEDULE_PLACES.find((place) => place.id === id) || SCHEDULE_PLACES[0];

/** Сколько табло какого размера: «17 по 3,3 м, 1 — 4,2 м, 2 — 4,5 м». */
export function sizesText() {
  return SCHEDULE_SIZES.map((scale) => {
    const count = SCHEDULE_PLACES.filter((place) => place.scale === scale).length;
    return `${count} × ${metresText(SCHEDULE_BOARD.width * scale)}`;
  }).join(", ");
}

/** Инфотабло занятий того же файла сервера — честно, почему их здесь не правят. */
export function infoBoardsText() {
  const total = SCHEDULE_INFO_BOARDS.reduce((sum, item) => sum + item.count, 0);
  const count = (id) => SCHEDULE_INFO_BOARDS.find((item) => item.id === id)?.count || 0;
  return `Ещё у сервера ${SCHEDULE_INFO_BOARDS.length} видов инфотабло занятий — ${total} штук: маски у тайников (${count("treasure")}), рамки дилеров на земле (${count("diller")}), числа со значками у работ. Они не листы, а объёмные светящиеся фигуры, и пак сервера главнее файлов игры: своё на их месте не спрятало бы фигуру сервера — поэтому здесь их не правят.`;
}

/** Строка «в игре» под кадром. */
export function inGameText(input) {
  const project = normalizeScheduleProject(input);
  if (scheduleIsStock(project)) return tr("Сейчас как на сервере: своего табло нет — «Применить» снимет поставленное.");
  const hidden = project.rows.filter((row) => row.hidden).length;
  const parts = [tr("{0} табло").replace("{0}", String(SCHEDULE_PLACES.length)), layoutText(project)];
  if (hidden) parts.push(`скрыто: ${hidden}`);
  parts.push(project.glow > 0 ? `светится ${glowText(project.glow)}` : tr("освещается миром, как у сервера"));
  return `В игре: ${parts.join(", ")}.`;
}

/* Подсказка прозрачности: целиком прозрачное табло — пустое место. */
export function opacityHint(project) {
  if (project.opacity.board === 0) return { text: tr("Всё табло прозрачно до конца — в игре на его месте будет пусто, а на Majestic — табло сервера."), warning: true };
  if (project.opacity.background > 0 && project.opacity.background < 100)
    return { text: tr("Сквозь полупрозрачный фон видно мир за табло, а на Majestic — и табло сервера за своим."), warning: false };
  return { text: tr("Проценты — непрозрачность: 100 % — сплошной цвет, 0 % — насквозь прозрачно."), warning: false };
}
