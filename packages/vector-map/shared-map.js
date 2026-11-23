/*
 * Чужая карта по коду.
 *
 * Код из «Поделиться картой» несёт ОПИСАНИЕ карты, а не её файлы: зоны,
 * подписи, цвета и шаблон едут внутри проекта, а картинки — нет. Картинки
 * живут в хранилище работ того человека, и на чужой машине их ссылки
 * указывают в пустоту: сцена нарисовала бы дырки на месте эмблем, а редактор
 * молча показал бы пустые рамки.
 *
 * Поэтому чужая карта приезжает через этот модуль. Он берёт из чужого проекта
 * только конфигурацию карты, приводит её к рабочему виду и СНИМАЕТ всё, что
 * без файлов не нарисуется: свою подложку-картинку, свою текстуру, эмблемы с
 * картинками, свои значки метки и раздела. Что снято — он говорит вслух,
 * числами, чтобы окно могло сказать это человеку, а не сделать вид, что
 * приехало всё.
 *
 * Модуль не решает, применять карту или нет: он только превращает чужой
 * проект в конфигурацию, годную к применению здесь.
 */

import { DEFAULT_MAP_FONT, isCustomLabelFont } from "./map-fonts.js";
import { normalizeWorldMap } from "./model.js";

/*
 * Свой шрифт подписи (`custom:<ключ файла>`, ТЗ 23.10.2026) — тоже файл автора: у друга его нет. Везде, где подпись, зона,
 * набор или табло называют такой шрифт, остаётся шрифт «как у всех» (у раздела и табло — шрифт по умолчанию); число
 * снятых — в отчёт, к «своим шрифтам надписей».
 */
function stripCustomLabelFonts(node) {
  let count = 0;
  const walk = (value) => {
    if (Array.isArray(value)) return value.map(walk);
    if (!value || typeof value !== "object") return value;
    const next = {};
    for (const [key, item] of Object.entries(value)) {
      if (key === "font" && isCustomLabelFont(item)) {
        count += 1;
        next[key] = "";
      } else next[key] = walk(item);
    }
    return next;
  };
  return { node: walk(node), count };
}

/** Что не доехало вместе с описанием карты. */
const emptyReport = () => ({
  baseImage: false,
  texture: false,
  emblems: 0,
  markerIcons: 0,
  categoryIcons: 0,
  fonts: 0,
});

/** Есть ли в отчёте хоть одна потеря. */
export function sharedMapLostAnything(report) {
  if (!report) return false;
  return Boolean(
    report.baseImage ||
      report.texture ||
      report.emblems ||
      report.markerIcons ||
      report.categoryIcons ||
      report.fonts ||
      report.blipPictures,
  );
}

/**
 * Человеческая строка о потерях — одна, для подписи под кнопкой.
 * Пустой отчёт даёт пустую строку: молчание здесь и значит «доехало всё».
 */
export function describeSharedMapLoss(report) {
  if (!sharedMapLostAnything(report)) return "";
  const parts = [];
  if (report.baseImage) parts.push("своя подложка-картинка");
  if (report.texture) parts.push("своя текстура");
  if (report.emblems)
    parts.push(`картинки на карте: ${report.emblems}`);
  if (report.markerIcons) parts.push(`свои значки метки: ${report.markerIcons}`);
  if (report.categoryIcons)
    parts.push(`свои значки разделов: ${report.categoryIcons}`);
  if (report.fonts) parts.push(`свои шрифты надписей: ${report.fonts}`);
  if (report.blipPictures) parts.push(`свои картинки значков игры: ${report.blipPictures}`);
  return `Файлы по коду не передаются, поэтому убрано: ${parts.join(", ")}.`;
}

/**
 * Конфигурация большой карты из чужого проекта.
 *
 * @param {object} shared проект, приехавший по коду
 * @returns {{config: object, report: object, name: string}}
 * @throws если в проекте нет большой карты
 */
export function sharedWorldMap(shared) {
  const module = shared?.modules?.["world-map"];
  if (!module || typeof module !== "object")
    throw new Error("По этому коду приехала не большая карта.");
  const config = normalizeWorldMap(module);
  const report = emptyReport();

  /*
   * Подложка. Своя картинка без файла — пустой холст вместо карты, поэтому
   * источник возвращается к карте из игры: у человека она своя, и это
   * единственная подложка, которая на его машине точно есть.
   */
  if (config.base.imageAssetId) {
    report.baseImage = true;
    config.base = { ...config.base, imageAssetId: "" };
    if (config.base.source === "image")
      config.base = { ...config.base, source: "game" };
  }
  /* Своя текстура без файла — просто выключенная текстура. */
  if (config.base.textureAssetId) {
    report.texture = true;
    config.base = { ...config.base, textureAssetId: "" };
    if (config.base.textureId === "image")
      config.base = { ...config.base, textureId: "none" };
  }

  /* Эмблема-картинка без файла — пустая рамка: её убираем целиком, а подписи
     (те же эмблемы, только текстом) остаются. Свой шрифт подписи — тоже
     файл: надпись едет, но плакатным шрифтом, и об этом говорится. */
  const emblemItems = config.emblems.items
    .filter((item) => {
      if (item.kind !== "image" || !item.assetId) return true;
      report.emblems += 1;
      return false;
    })
    .map((item) => {
      if (item.font !== "custom" || !item.fontAssetId) return item;
      report.fonts += 1;
      /* Без файла надпись едет первым шрифтом списка — он есть у всех. */
      return { ...item, font: DEFAULT_MAP_FONT, fontAssetId: "", fontName: "" };
    });
  if (report.emblems || report.fonts)
    config.emblems = { ...config.emblems, items: emblemItems };

  /* Значок без файла — метка рисуется штатным значком своей категории.
     Категории лежат словарём по идентификатору, а не списком. */
  const markers = config.markers.items.map((item) => {
    if (!item.iconAssetId) return item;
    report.markerIcons += 1;
    return { ...item, iconAssetId: "" };
  });
  const categories = Object.fromEntries(
    Object.entries(config.markers.categories).map(([id, item]) => {
      if (!item?.iconAssetId) return [id, item];
      report.categoryIcons += 1;
      return [id, { ...item, iconAssetId: "" }];
    }),
  );
  if (report.markerIcons || report.categoryIcons)
    config.markers = { ...config.markers, items: markers, categories };

  /* Своя картинка значка игры — файл автора: правка без неё не рисуется, и значок остаётся как в игре. Замена значком игры и
     «скрыть» едут как есть — им файлы не нужны. */
  const pictureEdits = Object.entries(config.blipIcons.icons).filter(([, edit]) => edit.mode === "picture");
  if (pictureEdits.length) {
    /* Ключ — только когда есть что снято: форма отчёта у карт без таких картинок прежняя. */
    report.blipPictures = pictureEdits.length;
    config.blipIcons = {
      ...config.blipIcons,
      icons: Object.fromEntries(Object.entries(config.blipIcons.icons).filter(([, edit]) => edit.mode !== "picture")),
    };
  }

  const stripped = stripCustomLabelFonts(config);
  report.fonts += stripped.count;

  return {
    /* Прогон через нормализацию ещё раз: после снятия картинок конфигурация
       обязана остаться той же формы, что и любая другая. */
    config: normalizeWorldMap(stripped.node),
    report,
    name: String(shared?.name || "").slice(0, 120),
  };
}
