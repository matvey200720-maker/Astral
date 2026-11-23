/*
 * «На что поставить» — цель замены и перенос файлов вещи на неё.
 *
 * Вещь на сервере — это папка коллекции и имя файла: Majestic хранит свою
 * «Белую футболку с собакой» как `mp_m_freemode_01_mp_m_clothes_pack3/
 * jbib_033_u.ydd` с расцветками `jbib_diff_033_a…_uni.ytd`. Чтобы игрок
 * увидел мод вместо неё, файлы мода должны лечь под эти имена. Сколько
 * расцветок у серверной вещи, решает сервер (его YMT): лишние буквы мода
 * не нужны, а недостающие заполняются первой расцветкой мода — иначе на
 * этих цветах останется серверная текстура.
 *
 * Правило совместимости. Пол совпадает всегда. Вид вещи (компонент) —
 * либо тот же, либо «вещь на любую вещь» (`crossFit`, 25.10.2026): кобура
 * с модели бронежилета (`task`) ложится на место футболки (`jbib`) под её
 * номером и именами. Все компоненты свободного персонажа сидят на одном
 * скелете `mp_m_freemode_01`, поэтому модель другого компонента стоит на
 * теле так же, как своя; но части тела (голова, причёска, руки/торс —
 * `head`, `hair`, `uppr`) чужой вещью не заменяются и сами никого не
 * заменяют, а аксессуар (`p_*`) живёт на своей кости и с одеждой не мешается.
 * Какие слои тела (руки, нижний слой) покажет игра у футболки с этим
 * номером, решает сервер по номеру цели, а не модель мода.
 *
 * Обычная замена (`incompatibility` без `cross`) прежняя: тот же компонент.
 * Другой вид пускает только тот, кто сам об этом просит — замена каталога.
 */

import { modelFileName, pedFolderName, textureFileName } from "./names.js";
import { COMPONENTS, PEDS } from "./taxonomy.js";

export class TargetError extends Error {
  constructor(message, code = "CLOTHING_TARGET") {
    super(message);
    this.name = "TargetError";
    this.code = code;
  }
}

const LETTERS = "abcdefghijklmnopqrstuvwxyz";

/** Цель по умолчанию — то, под что автор сам назвал файлы. */
export function targetFromItem(
  item,
  { server = null, name = null, shop = null } = {},
) {
  const set = item.sets?.[0];
  return {
    server,
    name: name || null,
    shop: shop || null,
    gender: item.gender || "male",
    component: item.component,
    prop: Boolean(item.prop),
    drawable: item.drawable,
    folder:
      item.folder ||
      pedFolderName({
        gender: item.gender || "male",
        prop: item.prop,
        collection: item.collection,
      }),
    modelSuffix: item.modelSuffix || (item.prop ? null : "u"),
    race: set?.textures?.[0]?.race || (item.prop ? null : "uni"),
    textures: set?.textures?.length || 1,
    source: "author",
  };
}

/*
 * Части тела: голова — лицо, причёска — волосы, `uppr` — руки и торс под
 * одеждой (в DLC — и перчатки). Чужая вещь на их месте — потерянная часть
 * тела (нет лица, нет рук), а они сами на месте футболки — руки поверх
 * рукавов. Только «такая же на такую же» (перчатки на перчатки).
 */
export const BODY_COMPONENTS = Object.freeze(["head", "hair", "uppr"]);

/*
 * Кость, на которой висит аксессуар. Модель пропа лежит в пространстве своей
 * кости (козырёк кепки — в осях кости головы, `onBone` в `model.js`), так что
 * переставить её можно только туда, где кость та же. Голова, глаза, уши и рот
 * — одна кость головы. Остальные места — каждое своё: левое и правое — разные
 * кости и зеркальная геометрия (наручники делают парой), а совпадают ли кисть
 * и запястье, по игре не сверено — пока врозь.
 */
export const PROP_ANCHORS = Object.freeze({
  p_head: "head",
  p_eyes: "head",
  p_ears: "head",
  p_mouth: "head",
  p_lhand: "lhand",
  p_rhand: "rhand",
  p_lwrist: "lwrist",
  p_rwrist: "rwrist",
  p_hip: "hip",
  p_lfoot: "lfoot",
  p_rfoot: "rfoot",
});

const labelOf = (component) => COMPONENTS[component]?.label || component;
const refuse = (reason) => ({ ok: false, reason, cross: false });
const PROP_AND_CLOTHES = "Аксессуар и одежда не взаимозаменяемы.";

/**
 * Можно ли поставить вещь вида `sourceComponent` на место вида
 * `targetComponent`. Чистая функция — для установщика и для окна («На что
 * поставить»: какие вещи показать и подписать «другой вид»).
 *
 * `{ ok, reason, cross }`: `ok` — можно; `reason` — почему нельзя (по-русски,
 * для человека; при `ok` пустая); `cross` — вид другой (при `ok` это замена
 * «вещь на любую вещь», окно подписывает её; при отказе всегда `false`).
 *
 * - тот же вид — всегда можно (перчатки на перчатки, причёска на причёску);
 * - одежда на одежду — можно, кроме частей тела (`BODY_COMPONENTS`) в обе
 *   стороны;
 * - аксессуар на аксессуар — только при одной кости (`PROP_ANCHORS`);
 * - аксессуар на одежду и обратно — нет: у них разные папки и разное
 *   пространство координат;
 * - пустой или неизвестный вид цели не пропускается молча.
 *
 * `sourceProp` / `targetProp` — флаги «это аксессуар» (папка `_p`), если они
 * известны; не заданы — вид аксессуара узнаётся по `p_` в имени. Флаг,
 * который спорит с именем, — отказ.
 */
export function crossFit(
  sourceComponent,
  targetComponent,
  { sourceProp, targetProp } = {},
) {
  const source = String(sourceComponent || "");
  const target = String(targetComponent || "");
  if (!source || !target)
    return refuse(
      "Не указан вид вещи: непонятно, на какое место ставить — выберите вещь заново.",
    );
  if (source === target) {
    if (
      sourceProp !== undefined &&
      targetProp !== undefined &&
      Boolean(sourceProp) !== Boolean(targetProp)
    )
      return refuse(PROP_AND_CLOTHES);
    return { ok: true, reason: "", cross: false };
  }
  const sourceIsProp = source.startsWith("p_");
  const targetIsProp = target.startsWith("p_");
  if (
    (sourceProp !== undefined && Boolean(sourceProp) !== sourceIsProp) ||
    (targetProp !== undefined && Boolean(targetProp) !== targetIsProp)
  )
    return refuse(PROP_AND_CLOTHES);
  if (sourceIsProp !== targetIsProp) return refuse(PROP_AND_CLOTHES);
  if (!Object.hasOwn(COMPONENTS, source) || !Object.hasOwn(COMPONENTS, target))
    return refuse("Такой вид вещи Astral не знает — на другое место её не поставить.");
  if (sourceIsProp) {
    if (PROP_ANCHORS[source] !== PROP_ANCHORS[target])
      return refuse(
        `«${labelOf(source)}» крепится к другой части тела, чем «${labelOf(target)}»: на этом месте аксессуар повис бы в воздухе.`,
      );
    return { ok: true, reason: "", cross: true };
  }
  if (BODY_COMPONENTS.includes(source))
    return refuse(
      `«${labelOf(source)}» — часть тела персонажа: её ставят только на такое же место.`,
    );
  if (BODY_COMPONENTS.includes(target))
    return refuse(
      `Место «${labelOf(target)}» — часть тела персонажа: на него ставят только такую же вещь, иначе пропадёт лицо, волосы или руки.`,
    );
  return { ok: true, reason: "", cross: true };
}

/**
 * Почему вещь нельзя поставить на цель — или `null`, если можно. Без `cross`
 * компонент обязан совпасть, как и прежде (покраска, план автора); с `cross`
 * решает `crossFit` — так зовёт замена каталога.
 */
export function incompatibility(item, target, { cross = false } = {}) {
  if (!target) return "Цель не выбрана.";
  if (item.gender && target.gender && item.gender !== target.gender)
    return item.gender === "male"
      ? "Это мужская вещь — на женского персонажа она не сядет: тело другое. Скин можно перенести на похожую женскую вещь («На кого» → «Женский»)."
      : "Это женская вещь — на мужского персонажа она не сядет.";
  if (!cross && item.component !== target.component)
    return "Вещь другого вида: встанет криво, будет видно тело.";
  if (
    item.component === target.component &&
    Boolean(item.prop) !== Boolean(target.prop)
  )
    return PROP_AND_CLOTHES;
  const fit = crossFit(item.component, target.component, {
    sourceProp: item.prop === undefined ? undefined : Boolean(item.prop),
    targetProp: target.prop === undefined ? undefined : Boolean(target.prop),
  });
  if (!fit.ok) return fit.reason;
  const folder = String(target.folder || "");
  const ped = PEDS[target.gender] || "";
  if (!folder.toLowerCase().startsWith(ped))
    return "Папка цели не от этого персонажа.";
  return null;
}

/**
 * План переноса набора расцветок вещи на цель:
 * `[{ source, target, role, letter? }]` — пути внутри Astral Clothing DLC
 * без имени архива потока (`<папка>/<файл>`). Имена — по компоненту цели, не
 * вещи; другой компонент пускает только `cross: true` (`incompatibility`).
 */
export function retargetPlan(item, set, target, { cross = false } = {}) {
  const reason = incompatibility(item, target, { cross });
  if (reason) throw new TargetError(reason, "CLOTHING_INCOMPATIBLE");
  if (!set?.model)
    throw new TargetError("У набора нет модели.", "CLOTHING_NO_MODEL");
  const textures = set.textures || [];
  if (!textures.length)
    throw new TargetError(
      "У набора нет ни одной расцветки.",
      "CLOTHING_NO_TEXTURES",
    );
  const count = Math.max(
    1,
    Math.min(26, Number(target.textures) || textures.length),
  );
  const plan = [
    {
      role: "model",
      source: set.model.path ?? set.model,
      target: `${target.folder}/${modelFileName({ component: target.component, drawable: target.drawable, modelSuffix: target.modelSuffix })}`,
    },
  ];
  for (let index = 0; index < count; index += 1) {
    const texture = textures[index] || textures[0];
    const letter = LETTERS[index];
    plan.push({
      role: "texture",
      letter,
      source: texture.path ?? texture.file?.path,
      filled: !textures[index],
      target: `${target.folder}/${textureFileName({ component: target.component, drawable: target.drawable, letter, race: target.race })}`,
    });
  }
  return plan;
}

/** Ключ цели для реестра: одна серверная вещь — одна запись. */
export const targetKey = (target) =>
  [target.server || "*", target.folder, target.component, target.drawable]
    .join("|")
    .toLowerCase();
