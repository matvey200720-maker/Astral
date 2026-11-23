/*
 * Один источник правды — состав пакета установки (слово владельца 11.11.2026: «в компоненты добавляешь одно, на превью другое, в предпросмотре другое»).
 *
 * Обложка, миниатюры, «3D», список расцветок, «Что изменится» строятся из одного списка — файлов пакета (mod.json) и выбранного варианта. Расхождение мест — брак: человек видит одно,
 * а ставится другое. Модуль чистый: карточка каталога и файлы манифеста приходят параметрами, диска и сети он не трогает; проверка файлов миниатюр — scripts/clothing-media-check.mjs.
 *
 * Места и правила:
 *   • variants — расцветки карточки (sets[].variants[].letter) = расцветки пакета (буквы файлов <компонент>_diff_<номер>_<буква>…ytd; пакет хранит каждую уникальную текстуру один раз
 *     под своей буквой по порядку — worker.js, «Пакет: одна модель и уникальные расцветки»);
 *   • thumbs — кадр у каждой расцветки (variant.preview) есть в галерее; кадров расцветок, которых нет в карточке, в галерее нет (штатные цвета игры, нарисованные «за мод»);
 *   • cover — обложка нарисована расцветкой вещи (coverLetter);
 *   Буквы: у расцветки карточки letter — буква её файла в пакете (a, b, c…), letters — буквы автора, слитые в неё; имена кадров (…-s0-e.png) и coverLetter — буквы автора.
 *   • model — у вещи есть «3D» (media.model), если есть модель в пакете;
 *   • change — «Что изменится»: номер вещи в карточке = номер модели в пакете.
 * Тату и вещи без расцветок _diff_ в пакете (рисунки наложений, голая модель) — своя схема файлов, места не сверяются.
 */

import { COLOUR_FRAME } from "./places-fix.js";
import { textureNameInfo } from "./stock-textures.js";

const MODEL_NAME = /^([a-z_]+)_(\d{3})(?:_[ur])?\.ydd$/i;
const FRAME_LETTER = /-s\d+-([a-z])(?:-[a-z]+)?\.png$/i;

/** Состав пакета по его файлам (mod.json, files[].source): модели, буквы расцветок, номера вещей. */
export function packageComposition(files = []) {
  const letters = new Set();
  const drawables = new Set();
  let models = 0;
  for (const file of files) {
    const name = String(file?.source || file?.name || file?.entry || "").split("/").pop();
    const texture = textureNameInfo(name);
    if (texture) {
      letters.add(texture.letter);
      drawables.add(texture.drawable);
      continue;
    }
    const model = MODEL_NAME.exec(name);
    if (model) {
      models += 1;
      drawables.add(Number(model[2]));
    }
  }
  return { letters: [...letters].sort(), drawables: [...drawables].sort((a, b) => a - b), models };
}

/**
 * Сверка мест карточки с составом пакета.
 * @param {{ card: object, files: Array<{ source?: string, name?: string }> }} input
 * @returns {{ checked: boolean, match: boolean, places: Record<string, boolean>, mismatches: Array<{ place: string, detail: string }> }}
 *   checked: false — у вещи своя схема файлов (тату, без расцветок): места не сверяются, match: true.
 */
export function compositionCheck({ card, files }) {
  const clothing = card?.domain?.clothing || card?.clothing || {};
  const pack = packageComposition(files);
  const places = { variants: true, thumbs: true, cover: true, model: true, change: true };
  if (card?.placement?.slot === "tattoos" || clothing.category === "tattoos" || !pack.letters.length) return { checked: false, match: true, places, mismatches: [] };
  const mismatches = [];
  const miss = (place, detail) => {
    places[place] = false;
    mismatches.push({ place, detail });
  };
  const variants = (clothing.sets || []).flatMap((set) => set.variants || []);
  const cardLetters = variants.map((variant) => String(variant.letter || ""));
  /* Буквы автора: кадры (…-s0-e.png) и coverLetter названы ими, а не буквами файлов пакета. */
  const authorLetters = new Set(variants.flatMap((variant) => [...String(variant.letters || variant.letter || ""), ...String(variant.letter || "")]));
  const inPackage = new Set(pack.letters);
  const noFile = cardLetters.filter((letter) => !inPackage.has(letter));
  const noCard = pack.letters.filter((letter) => !cardLetters.includes(letter));
  if (noFile.length) miss("variants", `в карточке расцветки без файла в пакете: ${noFile.join(", ")}`);
  if (noCard.length) miss("variants", `в пакете расцветки, которых нет в карточке: ${noCard.join(", ")}`);
  const gallery = new Map((card?.media?.gallery || []).filter((frame) => frame?.source).map((frame) => [frame.source, frame]));
  const hanging = variants.map((variant) => variant.preview).filter((source) => source && !gallery.has(source));
  if (hanging.length) miss("thumbs", `у расцветок есть ссылки на кадры, которых нет в галерее: ${hanging.length}`);
  const stale = [...gallery.keys()].filter((source) => {
    const letter = FRAME_LETTER.exec(source)?.[1]?.toLowerCase();
    return letter && !authorLetters.has(letter);
  });
  if (stale.length) miss("thumbs", `в галерее кадры расцветок, которых нет в карточке: ${stale.length}`);
  /* Кадр расцветки, на который не ссылается ни одна расцветка, — лишний: у человека в галерее вещь, которой в списке нет (карточка читала наборы с пределом в 12, `card.js`). */
  const referenced = new Set(variants.flatMap((variant) => [variant.preview, variant.previewAlt]).filter(Boolean));
  const orphans = [...gallery.keys()].filter((source) => COLOUR_FRAME.test(source) && !referenced.has(source));
  if (orphans.length) miss("thumbs", `в галерее кадры расцветок, на которые не ссылается ни одна расцветка: ${orphans.length}`);
  const cover = String(clothing.coverLetter || "");
  if (cover && !authorLetters.has(cover)) miss("cover", `обложка нарисована расцветкой ${cover}, которой нет у вещи`);
  if (pack.models && !card?.media?.model) miss("model", "в пакете есть модель, а «3D» у карточки нет");
  const drawable = Number(clothing.drawable);
  if (Number.isInteger(drawable) && pack.drawables.length && !pack.drawables.includes(drawable)) miss("change", `«Что изменится» говорит о вещи №${drawable}, а в пакете №${pack.drawables.join(", ")}`);
  return { checked: true, match: !mismatches.length, places, mismatches };
}
