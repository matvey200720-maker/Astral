import PartCover from "../../../../features/catalog/part-covers/PartCover.jsx";
import { hasEditorCover } from "../../../../features/workshop/covers/editor-covers.js";
import { hasOwnCover } from "../../../../utils/catalogMedia.js";
import { modTileLook } from "../../../../features/builds/mod-faces.js";
import { contentGroupOf } from "../../../../features/catalog/pack-contents.js";
import { isReduxBase, leadOrder } from "../../../../features/catalog/bundles/component-groups.js";
import { optimizationCoverSlot, optimizationPart } from "../../../../features/catalog/optimization-part.js";
import { Bomb, Buildings, Cloud, CloudRain, CloudSun, Crosshair, Drop, Fire, Gauge, MapTrifold, Monitor, Package, Plant, SpeakerHigh, TShirt } from "../../../ui/icons.jsx";

// Значок по виду оптимизации и по группе содержимого; чего нет в таблице, берёт запасной.
const KIND_GLYPHS = new Map([
  ["decals", Drop],
  ["screen", Monitor],
  ["explosions", Bomb],
  ["weather", CloudRain],
  ["clouds", Cloud],
  ["grass", Plant],
]);
const GROUP_GLYPHS = new Map([
  ["sky", CloudSun],
  ["map", MapTrifold],
  ["world", Buildings],
  ["weapons", Crosshair],
  ["effects", Fire],
  ["interface", Crosshair],
  ["sounds", SpeakerHigh],
  ["clothing", TShirt],
  ["optimization", Gauge],
  ["other", Package],
]);

// Часть, которая правит frontend.xml и не двигает мини-карту: по сути кнопки меню.
function isMenuButtons(part) {
  const moved = part.domain?.frontend?.moved;
  return moved === false;
}

// Слот мастерской, по которому подбирается обложка части: слот оптимизации, слот каталога, таймцикл.
// У «Основы редукса» слота мастерской нет: её полка — маппинг (нарочно), а стандартная картинка маппинга сказала бы не о ней (значок группы «Прочее» её не обманывает).
const plainSlot = (part) => (isReduxBase(part) ? "" : part.catalogSlot || (part.category === "timecycle" ? "timecycle" : ""));
const slotOf = (part) => optimizationCoverSlot(part) || plainSlot(part);

export const partIcon = (part) => {
  if (isMenuButtons(part)) return Monitor;
  const found = optimizationPart(part);
  return found ? KIND_GLYPHS.get(found.kind) || Gauge : GROUP_GLYPHS.get(contentGroupOf(part)) || Package;
};

/*
 * Лицо строки компонента (владелец, 12.11.2026: «в компонентах должны отображаться превьюшки … именно с тех превьюшек, которые ты делаешь»): картинка строки — та, что стоит
 * на карточке самой части. Любого происхождения (`coverOrigin`): снятая из файлов редукса (`render`), кадр обзора (`video-frame`, `game-frame`), загруженная (`upload`) — как на её
 * карточке (`ModDetailPage`: `cover: ownCoverOf(mod)`). Раньше слово `render` пропускало обложку вперёд, а у остальных на месте обложки стояла стандартная картинка редактора слота
 * (мини-карта, таймцикл, трейсеры, залазы…), будто у части кадра нет вовсе.
 *
 * Правила идут по порядку, первое подошедшее побеждает:
 *   1. своя обложка части (`hasOwnCover`);
 *   2. обложки нет, у слота есть стандартная картинка редактора — она (кнопки меню её не получают: мини-карта читалась бы второй мини-картой);
 *   3. ничего — пусто, плитка нарисует значок вида (`partIcon`).
 */
const FACE_RULES = [
  [(part) => hasOwnCover(part), (part) => modTileLook(part)],
  [(part) => !isMenuButtons(part) && hasEditorCover(slotOf(part)), (part) => ({ cover: "", media: <PartCover slotId={slotOf(part)} /> })],
];

export function partFace(part) {
  const rule = FACE_RULES.find(([fits]) => fits(part));
  return rule ? rule[1](part) : { cover: "" };
}

/*
 * Часть, чья обложка стоит на строке компонента из нескольких пакетов (слот в несколько файлов; «Эффекты» — ядро, частицы, таблицы, попадания): первая по порядку «кто ведёт»
 * (`leadOrder`) с картинкой. `head` — пакет, что вёл строку до выбора версии (на его месте стоит `part`). Ни у кого картинки нет — сама `part`, и лицо вернёт значок.
 */
export function faceSource(part, packages = [], head = part) {
  if (packages.length < 2) return part;
  const members = packages.map((one) => (one === head ? part : one));
  return leadOrder(members).find((one) => hasOwnCover(one)) || part;
}

/** Кусок маппинга: его кадр — только своя обложка; стандартная картинка слота «Маппинг» сказала бы не о нём (у окклюзии района вышел бы мегамолл). */
export const renderedFace = (part) => (hasOwnCover(part) ? modTileLook(part) : { cover: "" });

const signSlot = (part) => (isMenuButtons(part) ? "" : slotOf(part));

export const PartSign = ({ part }) => {
  const slot = signSlot(part);
  const Glyph = partIcon(part);
  return hasEditorCover(slot) ? <PartCover slotId={slot} /> : <Glyph weight="regular" />;
};
