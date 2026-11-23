/*
 * Карточка «Зоны» (Хелпер 16, 29.10.2026, круг 6б; владелец: «засунь внутрь зон зелёные зоны, ВЗХ-зоны, порт-зоны, к превьюшке
 * картинки, как они выглядят, чтобы люди понимали. Назови это просто «Зоны»»).
 *
 * Стандартная карточка зон — одна работа мастерской (редактор «Зоны»): её проект несёт сразу пять видов — запретные, зелёные, бизвар, ВЗХ и порт.
 * Ставится она целиком; в окне «Компоненты» — что именно внутри и как оно выглядит: вид — своим кадром и словами. Кадры — наши рендеры редактора зон
 * (`scripts/stock-covers-live`), они лежат в галерее карточки: первый кадр — общий вид (обложка), дальше по виду на кадр. Вид узнаётся по метке кадра:
 * файл `NN-zone-<вид>.png` (`source` в пакете витрины, `scripts/standard-zones-batch.mjs`) или `origin.note` = `zone:<вид>`; у кадра без метки — по месту
 * в галерее.
 *
 * «Зоны каптов» и «МСЛ-зоны» — свои карточки: у них свои редакторы и своя установка, внутрь «Зон» они не входят.
 */

import { tr } from "../../locales/ui.js";

export const STANDARD_ZONES_SLUG = "astral-zones-mod";
export const ZONE_NOTE_PREFIX = "zone:";
const ZONE_FILE = /-zone-([a-z]+).[a-z]+$/;

/**
 * Виды зон по порядку кадров галереи: имя — как у вида в мастерской и в словаре, `sub` — коротко, как выглядит, `note` — слова панели окна.
 */
export const ZONE_LOOKS = Object.freeze([
  Object.freeze({
    id: "forbidden",
    title: "Запретные зоны",
    sub: "красная заливка",
    note: "Участок закрашен красным, полупрозрачно: сквозь заливку видна земля. Облик и прозрачность правятся в мастерской.",
  }),
  Object.freeze({
    id: "green",
    title: "Зелёные зоны",
    sub: "зелёная стенка",
    note: "Зелёная стенка по границе участка. Облик и прозрачность правятся в мастерской.",
  }),
  Object.freeze({
    id: "bizwar",
    title: "Зона бизвара",
    sub: "синяя и красная линии",
    note: "Две линии вдоль границы бизвара: синяя и красная. Облик и прозрачность правятся в мастерской.",
  }),
  Object.freeze({
    id: "vzh",
    title: "Зона ВЗХ",
    sub: "синяя и красная линии",
    note: "Две линии вдоль границы зоны ВЗХ: синяя и красная. Облик и прозрачность правятся в мастерской.",
  }),
  Object.freeze({
    id: "port",
    title: "Зона порта",
    sub: "синяя и красная линии",
    note: "Две линии вдоль границы порта: синяя и красная. Облик и прозрачность правятся в мастерской.",
  }),
]);

/** Это стандартная карточка «Зоны» (а не зоны из редукса и не зоны каптов): у неё внутри пять видов. */
export const isStandardZonesCard = (mod) => String(mod?.slug || mod?.id || "") === STANDARD_ZONES_SLUG;

/* Вид, которому принадлежит кадр: `zone:<вид>` в заметке происхождения или `-zone-<вид>.png` в имени файла (`source`); иначе — пусто. */
const tagOf = (item) => {
  const note = String(item?.origin?.note || "");
  if (note.startsWith(ZONE_NOTE_PREFIX)) return note.slice(ZONE_NOTE_PREFIX.length);
  return ZONE_FILE.exec(String(item?.source || ""))?.[1] || "";
};

/**
 * Кадр вида: по метке `zone:<вид>`, иначе — по месту среди кадров после обложки (обложка стоит первой). Без кадра — `null`.
 */
export function zoneFrame(media, look, index) {
  const frames = (media || []).filter((item) => item && item.type !== "placeholder" && item.type !== "video" && item.src);
  if (frames.some((item) => tagOf(item)))
    return frames.find((item) => tagOf(item) === look.id) || null;
  return frames[index + 1] || null;
}

/**
 * Записи окна «Компоненты» (`ComponentsSplit`): вид зон — кадр, имя, как выглядит, слова. Действий у записей нет — ставится вся карточка.
 * Пусто, если это не стандартная карточка «Зоны».
 */
export function standardZoneEntries(view) {
  if (!isStandardZonesCard(view?.mod)) return [];
  return ZONE_LOOKS.map((look, index) => {
    const frame = zoneFrame(view.media, look, index);
    return {
      key: `zone-${look.id}`,
      title: tr(look.title),
      sub: tr(look.sub),
      face: { cover: frame?.src || "", fit: "cover" },
      /* Слова панели под именем (`meta`), а не «Заменит…» тоном предупреждения (`note`): это описание, а не оговорка. */
      meta: tr(look.note),
      actions: null,
    };
  });
}
