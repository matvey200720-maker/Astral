/*
 * Звук попадания — переопределением в звуковом пакете Astral.
 *
 * ЗАЧЕМ. До 26.09.2026 (вечер) звук человека вставал в дерево удара пули
 * правкой ссылок в update.rpf: у головы — слоем хруста среди четырёх
 * одновременных слоёв (один из них — «шлепок» на +9 дБ), у тела — слоем
 * плоти на −6 дБ. Правка ссылок не умеет ни громкость, ни дальность: свой
 * звук тонул в штатном ударе и гас с расстоянием, и владелец, стреляя в
 * людей, не услышал ни головы, ни тела.
 *
 * ЧТО В ПАКЕТЕ. Объекты dat54 с теми же именами, что у игры: пакет Astral
 * грузится последним, и его копия заменяет объект игры.
 *   • Удар по голове (`headImpact`) и по телу (`bodyImpact`) играют только
 *     звук человека; в пределах 100 м он не затухает, дальше — мягкий спад
 *     (так у игры звучат взрывы и сирены: `volumeCurvePlateau` 100).
 *   • Слой головы и слой тела — новые мультитреки с флагами поведения, как
 *     у мультитреков игры (`sound-header.js`); под ними — листы-носители
 *     банка collision. Слой звучит на `HIT_SOUND_LEVELS` — громче штатного
 *     удара, как отметка попадания, — в категории «мокрого» слоя штатного
 *     удара, того, что слышно при попадании (`hitWetCategory`): у головы
 *     это шлепок в `melee`, у тела — слой плоти. Категория — часть
 *     громкости звука в игре, и своя громкость слоя считается с ней; а ещё
 *     категорию ударов пули (`weapons_guns_bullet_impacts` и `…_body`)
 *     сцены микса игры глушат на 6 дБ в бою и в машине и вовсе в двух
 *     сценах — категорию плоти и `melee` не трогает ни одна (28.09.2026:
 *     в них голова слышалась, тело в `…_body` — нет).
 *   • Слой тела звучит на `HIT_SOUND_BODY_DELAY_MS` позже, чем его запускает
 *     игра, и на 6 дБ громче слоя головы (`HIT_SOUND_LEVELS`). Запись звука
 *     игры (28.09.2026, выстрелы игрока из пистолета, автомата, дробовика и
 *     снайперки): удар по телу игра играет примерно через 0,1 с после
 *     выстрела — в его эхо, которое его накрывает, а у живых ещё и в крик
 *     боли; удар по голове — через 0,2–0,4 с, когда эхо стихло. Поэтому
 *     голову было слышно, а тело — нет.
 *   • Всё, что вело на занятый лист (носитель или освобождённый), ведёт на
 *     первый штатный лист того же выбора: занятые дорожки не звучат нигде,
 *     кроме своего удара, — ни в хвосте тела, ни в звуках байкеров.
 *   • Все предки изменённых объектов — нетронутыми копиями. Игра доходит до
 *     удара двумя путями: по имени из материала кости (`AM_BASE_*`) и через
 *     набор `BulletImpacts` одежды — ссылкой из другого объекта. Если игра
 *     связывает такие ссылки при загрузке, путь через набор привёл бы к
 *     объекту базы, а не пакета. Копии предков в пакете делают путь целиком
 *     своим — так Rockstar и выпускает патчи звука: в пакетах Legacy 6026
 *     нетронутых копий, и изменённый объект почти всегда лежит вместе с
 *     родителями (сверено 26.09.2026).
 *
 * Модуль только для главного процесса (подпуть
 * `@modovik/sound-studio/hit-voice-plan`).
 */

import { hexHash, joaat } from "./rel-edit.js";
import { categoryVolume } from "./sound-categories.js";
import {
  MULTITRACK_FLAGS2,
  readSoundHeader,
  soundHeaderProblem,
  writeSoundHeader,
} from "./sound-header.js";
import {
  HIT_SOUND_FREED_LEAVES,
  HIT_SOUND_LEAF_GROUPS,
  HIT_SOUND_LEVEL,
  HIT_SOUND_LEVELS,
  HIT_SOUND_OBJECTS,
  HIT_SOUND_PARTS,
  HIT_SOUND_PART_IDS,
} from "./hit-sounds.js";
import { leafOf, rebuildSoundObject } from "./weapon-voice-plan.js";

const WRAPPER_TYPE = 6;
const MULTITRACK_TYPE = 13;
const RANDOMIZED_TYPE = 14;

/* Громкость слоя каждой части в игре (`HIT_SOUND_LEVELS`) — в
   `hit-sounds.js`: по ней и окно меряет, слышно ли звук в бою. */
export { HIT_SOUND_LEVEL, HIT_SOUND_LEVELS };

/* Дальность звука попадания: метры без затухания (как у взрывов и сирен
   игры) и растяжение спада за ними. */
export const HIT_SOUND_PLATEAU_METRES = 100;
export const HIT_SOUND_CURVE_SCALE = 300;

/*
 * Через сколько миллисекунд после попадания звучит слой тела. Мерки по
 * записи звука игры (28.09.2026, выстрелы игрока с 6 м): удар по телу игра
 * играет примерно через 0,1 с после выстрела — ровно в низкое эхо выстрела
 * автомата, и низкий звук тела тонул в нём; удар по голове — через 0,2–0,4 с,
 * после эха, поэтому голову было слышно, а тело нет. Хлопок выстрела —
 * первые 40 мс, эхо автомата — до 110 мс, очередь — выстрел каждые
 * 100–160 мс. 80 мс сверху ставят тело за эхо автомата (в записи его стало
 * слышно на каждом попадании) и до следующего выстрела очереди. Голове своя
 * задержка не нужна.
 */
export const HIT_SOUND_BODY_DELAY_MS = 80;

const hashOf = (value) => Number.parseInt(String(value).slice(2), 16) >>> 0;

/* `wet` — «мокрый» слой штатного удара: его категория достаётся слою
   человека (`hitWetCategory`); `preDelay` — задержка слоя после попадания. */
const PARTS = Object.freeze({
  head: Object.freeze({
    root: hashOf(HIT_SOUND_OBJECTS.headImpact),
    rootType: MULTITRACK_TYPE,
    wet: hashOf(HIT_SOUND_OBJECTS.headSplat),
    layer: joaat("astral_hit_head"),
    preDelay: 0,
  }),
  body: Object.freeze({
    root: hashOf(HIT_SOUND_OBJECTS.bodyImpact),
    rootType: RANDOMIZED_TYPE,
    wet: hashOf(HIT_SOUND_OBJECTS.fleshLayer),
    layer: joaat("astral_hit_body"),
    preDelay: HIT_SOUND_BODY_DELAY_MS,
  }),
});

/* Слой части: мультитрек из одного листа-носителя с флагами поведения
   мультитрека игры, в категории мокрого слоя удара (`hitWetCategory`), с
   громкостью, дающей в ней уровень части (`HIT_SOUND_LEVELS`), и с
   задержкой части. */
function layerNode(hash, leaf, { volume, category, preDelay = 0 }) {
  const bytes = Buffer.alloc(10);
  bytes[0] = MULTITRACK_TYPE;
  bytes[5] = 1;
  bytes.writeUInt32LE(leaf >>> 0, 6);
  const written = writeSoundHeader(bytes, {
    flags2: MULTITRACK_FLAGS2,
    ...(volume ? { volume } : {}),
    ...(preDelay ? { preDelay } : {}),
    ...(category !== null ? { category } : {}),
  });
  return { hash, bytes: written.bytes, links: [6 + written.shift], packs: [] };
}

const childrenOf = (object) =>
  object.links.map((at) => object.bytes.readUInt32LE(at) >>> 0);

/**
 * Категория, в которой игра играет «мокрый» слой штатного удара, — с ней
 * микшируется и слой человека, вставший на его место.
 *
 * Категория узла действует на всё под ним, пока ниже не задана своя, поэтому
 * категория слоя — его собственная или ближайшая над ним по пути от корня
 * удара. У головы это шлепок `F663AC66` со своей категорией `melee`, у тела
 * — слой плоти `E4C51247`.
 *
 * @returns {number|null} категория или `null`, если её нет ни у слоя, ни выше
 */
export function hitWetCategory(merged, root, wet) {
  const find = (hash, category, path) => {
    const object = merged.sound(hash);
    if (!object || path.has(hash)) return undefined;
    const own = readSoundHeader(object.bytes).fields.get("category")?.value ?? category;
    if (hash === (wet >>> 0)) return own;
    path.add(hash);
    for (const child of childrenOf(object)) {
      const found = find(child, own, path);
      if (found !== undefined) return found;
    }
    path.delete(hash);
    return undefined;
  };
  const category = find(root >>> 0, null, new Set());
  if (category === undefined)
    throw new Error(
      `В ударе игры ${hexHash(root)} нет слоя ${hexHash(wet)} — эта сборка игры устроена иначе.`,
    );
  return category;
}

/**
 * Как громко звучит штатный удар части — для сравнения со слоем человека.
 *
 * Лист звучит с громкостью узлов от корня до себя и громкостью своей
 * категории со всеми родительскими (`sound-categories.js`); категория узла
 * действует на всё под ним, пока ниже не задана своя. Одновременные слои
 * мультитрека складываются по энергии (задержка слоя не учитывается: удар
 * считается не тише, чем он есть), из случайного выбора берётся самый
 * громкий вариант, обёртка играет своего первого ребёнка. Громкость корня
 * удар оставляет себе — слой её не повторяет, а категория корня действует и
 * на слой.
 *
 * @returns {number} громкость удара целиком, сотые дБ
 */
export function hitImpactLevel(merged, root, categories) {
  if (!categories)
    throw new Error("Без категорий звука игры громкость удара не посчитать.");
  const walk = (hash, volume, category, path) => {
    const object = merged.sound(hash);
    if (!object)
      throw new Error(`В ударе игры нет объекта ${hexHash(hash)} — эта сборка игры устроена иначе.`);
    if (path.has(hash)) throw new Error(`Удар игры замкнут в круг на ${hexHash(hash)}.`);
    const header = readSoundHeader(object.bytes);
    const gain = volume + (path.size ? (header.fields.get("volume")?.value ?? 0) : 0);
    const own = header.fields.get("category")?.value ?? category;
    if (leafOf(object)) return 10 ** ((gain + categoryVolume(categories, own)) / 1000);
    path.add(hash);
    const heard = (child) => (child ? walk(child, gain, own, path) : 0);
    const children = childrenOf(object);
    let energy;
    if (object.type === MULTITRACK_TYPE)
      energy = children.reduce((sum, child) => sum + heard(child), 0);
    else if (object.type === RANDOMIZED_TYPE)
      energy = Math.max(0, ...children.map(heard));
    else if (object.type === WRAPPER_TYPE) energy = heard(children[0]);
    else
      throw new Error(
        `В ударе игры узел вида ${object.type} (${hexHash(hash)}) — эта сборка игры устроена иначе.`,
      );
    path.delete(hash);
    return energy;
  };
  const energy = walk(root >>> 0, 0, null, new Set());
  if (!(energy > 0))
    throw new Error(`В ударе игры ${hexHash(root)} нет ни одного листа.`);
  return Math.round(1000 * Math.log10(energy));
}

/**
 * Несёт ли удар в этих метаданных прежнюю установку Astral, а не игру.
 *
 * Звук попадания до 26.09.2026 (вечер) правил ссылки update.rpf: выбор плоти
 * и её хвоста сводился к одному листу, хруст головы — к листу головы, тело
 * — к полному варианту. Перебазирование движка до 27.09.2026 уносило эту
 * правку в основу (коммит ae42e405), и план по такой основе вышел без
 * переопределений, нужных штатной игре: у владельца хвост тела остался
 * вести на дорожки, ставшие тишиной. У игры в каждом выборе — все его листья.
 *
 * @param {ReturnType<import("./weapon-voice-plan.js").mergeAudioChunks>} merged
 */
export function hitBaseCarriesAstral(merged) {
  const children = (value) => {
    const object = merged.sound(hashOf(value));
    return new Set(object ? childrenOf(object) : []);
  };
  const covers = (value, leaves) => {
    const present = children(value);
    return leaves.every((leaf) => present.has(hashOf(leaf)));
  };
  return (
    !covers(HIT_SOUND_OBJECTS.fleshLayer, HIT_SOUND_LEAF_GROUPS.flesh) ||
    !covers(HIT_SOUND_OBJECTS.fleshTail, HIT_SOUND_LEAF_GROUPS.tail) ||
    !covers(HIT_SOUND_OBJECTS.bodyImpact, [
      HIT_SOUND_OBJECTS.bodyFull,
      HIT_SOUND_OBJECTS.bodyLight,
    ]) ||
    children(HIT_SOUND_OBJECTS.headCrunch).size < 3
  );
}

/**
 * Переопределения дерева удара для выбранных частей.
 *
 * @param {ReturnType<import("./weapon-voice-plan.js").mergeAudioChunks>} merged
 *   звуки игры в порядке загрузки (файлы `HIT_SOUND_SOURCES`)
 * @param {string[]} parts `head`, `body` или обе
 * @param {{categories: ReturnType<import("./sound-categories.js").readSoundCategories>}} options
 *   категории звука игры (`SOUND_CATEGORIES_SOURCE`)
 * @returns {{objects: Array<{hash: number, bytes: Buffer, links: number[],
 *   packs: number[], origin?: number}>, names: string[],
 *   levels: Record<string, number>, game: Record<string, number>,
 *   redirected: number[], copies: number[]}}
 *   `levels` — громкость слоя части в игре вместе с категорией (сотые дБ),
 *   `game` — громкость штатного удара той же части; `redirected` — объекты
 *   игры, переведённые с занятых листьев; `copies` — предки, положенные
 *   нетронутыми
 */
export function planHitOverride(merged, parts, { categories } = {}) {
  const chosen = HIT_SOUND_PART_IDS.filter((part) => (parts || []).includes(part));
  if (!chosen.length) throw new Error("Выберите голову или тело.");
  if (hitBaseCarriesAstral(merged))
    throw new Error(
      "В метаданных игры уже стоит прежний звук попадания Astral — удар по ним собрался бы неверно.",
    );
  const vanilla = (hash, type) => {
    const object = merged.sound(hash);
    if (!object || (type !== undefined && object.type !== type))
      throw new Error(
        `В звуках игры нет объекта удара ${hexHash(hash)} нужного вида — эта сборка игры устроена иначе.`,
      );
    return object;
  };

  /* Изменённые объекты: по имени — копия с новыми ссылками. */
  const changed = new Map();
  const levels = {};
  const game = {};
  for (const part of chosen) {
    const { root, rootType, wet, layer, preDelay } = PARTS[part];
    const leaf = hashOf(HIT_SOUND_PARTS[part].leaf);
    if (!leafOf(vanilla(leaf)))
      throw new Error(`Лист-носитель ${hexHash(leaf)} в игре не лист.`);
    const rootObject = vanilla(root, rootType);
    /* Слой человека — в категории мокрого слоя штатного удара, на уровне
       отметки попадания своей части. */
    const category = hitWetCategory(merged, root, wet);
    game[part] = hitImpactLevel(merged, root, categories);
    levels[part] = HIT_SOUND_LEVELS[part];
    changed.set(
      layer,
      layerNode(layer, leaf, {
        volume: HIT_SOUND_LEVELS[part] - categoryVolume(categories, category),
        category,
        preDelay,
      }),
    );
    const scale = readSoundHeader(rootObject.bytes).fields.get("volumeCurveScale");
    changed.set(root, {
      hash: root,
      origin: root,
      ...rebuildSoundObject(rootObject, {
        targets:
          rootType === MULTITRACK_TYPE
            ? rootObject.links.map((_, index) => (index === 0 ? layer : null))
            : rootObject.links.map(() => layer),
        header: {
          volumeCurveScale: Math.max(scale?.value ?? 0, HIT_SOUND_CURVE_SCALE),
          volumeCurvePlateau: HIT_SOUND_PLATEAU_METRES,
        },
      }),
    });
  }

  /* Занятые листья: носители выбранных частей и освобождённые. Кто на них
     ведёт (кроме слоя своей части), ведёт на первый штатный лист группы. */
  const taken = new Set([
    ...chosen.map((part) => hashOf(HIT_SOUND_PARTS[part].leaf)),
    ...HIT_SOUND_FREED_LEAVES.map(hashOf),
  ]);
  const substitute = new Map();
  for (const group of Object.values(HIT_SOUND_LEAF_GROUPS)) {
    const leaves = group.map(hashOf);
    const kept = leaves.find((leaf) => !taken.has(leaf));
    if (kept === undefined || !leafOf(vanilla(kept)))
      throw new Error("У выбора плоти не осталось штатного листа — эта сборка игры устроена иначе.");
    for (const leaf of leaves) if (taken.has(leaf)) substitute.set(leaf, kept);
  }
  const layers = new Set(chosen.map((part) => PARTS[part].layer));
  const redirected = [];
  for (const leaf of taken) {
    if (!leafOf(vanilla(leaf)))
      throw new Error(`Лист ${hexHash(leaf)} в игре не лист.`);
    for (const parent of merged.soundParents(leaf)) {
      if (layers.has(parent) || changed.has(parent)) continue;
      const object = vanilla(parent);
      const targets = childrenOf(object).map((child) => substitute.get(child) ?? child);
      changed.set(parent, {
        hash: parent,
        origin: parent,
        ...rebuildSoundObject(object, { targets }),
      });
      redirected.push(parent);
    }
  }
  for (const [hash, object] of changed)
    if (!layers.has(hash) && childrenOf(object).some((child) => taken.has(child)))
      throw new Error(`Занятый лист всё ещё звучит в ${hexHash(hash)}.`);

  /* Предки изменённого — нетронутыми копиями: путь игры к изменению целиком
     в пакете, как бы игра ни связывала ссылки. */
  const copies = new Set();
  const climb = (hash) => {
    for (const parent of merged.soundParents(hash)) {
      if (changed.has(parent) || copies.has(parent)) continue;
      copies.add(parent);
      climb(parent);
    }
  };
  for (const hash of [...changed.keys()]) climb(hash);
  const objects = [...changed.values()];
  for (const hash of copies) {
    const object = vanilla(hash);
    objects.push({
      hash,
      origin: hash,
      bytes: Buffer.from(object.bytes),
      links: [...object.links],
      packs: [...object.packs],
    });
  }
  for (const object of objects) {
    const problem = soundHeaderProblem(object.bytes);
    if (problem)
      throw new Error(`Удар не собрать: ${hexHash(object.hash)} — ${problem}.`);
  }
  const ascending = (left, right) => left - right;
  return {
    objects: objects.sort((left, right) => left.hash - right.hash),
    names: [],
    levels,
    game,
    redirected: redirected.sort(ascending),
    copies: [...copies].sort(ascending),
  };
}
