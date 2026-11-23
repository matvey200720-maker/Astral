/*
 * Обложка интерьера редукса — из его же файлов (13.11.2026, редукс sad redux (5rp): 11 интерьеров `v_int_<N>`).
 *
 * У интерьеров редукса карты размещения (`.ymap`) нет: автор перекрашивает и подменяет модели штатного интерьера игры, а расстановка лежит в MLO-архетипе его
 * `.ytyp`. Прежний вид «интерьеры» искал `.ymap`, не находил и оставлял части кадр обзора с YouTube. Здесь комната собирается заново: расстановка — MLO автора (нет
 * MLO в его `.ytyp` — штатный `v_int_<N>.ytyp` из игры), модель — автора, где он её дал, остальные — штатные из игры игрока (`project-interiors/scene.js: planProjectScene`
 * — тот же сборщик, что у «Интерьеров проектов»: модель и лист ищутся в файлах автора, затем в игре). Камера — ИЗНУТРИ: глаз на полу под потолком, ракурсы выбирает
 * планировщик по самим сеткам комнаты (`planInteriorViews`: мелкий кадр программным z-буфером, как у зала арены), окно снимает их тем же съёмщиком зала арены.
 *
 * Это постановочная сцена из моделей, а не кадр игры: света игры, тумана и погоды в ней нет (`INTERIOR_COVER_CAPTION` говорит это прямо). Не собралась комната
 * (ни MLO, ни игры, ни моделей, ни годного кадра) — отказ с причиной словами (`refusal`), часть остаётся с прежним кадром; ничего не рисуется «как в игре».
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { keysFromDirectory } from "@modovik/rpf7/node";
import {
  decodeTextureRef,
  readDrawable,
  readTextureDictionary,
} from "@modovik/rage-drawable";
import { openResourceWith } from "@modovik/ypt/resource-core";
import { inflateResource } from "@modovik/native-rs";
import { inspectCover } from "./cover-gate.js";
import { createGameReader } from "./game-archive-reader.js";
import { openGameNames } from "./project-interiors/game-names.js";
import { joaat, mloEntities, readMapTypes } from "./project-interiors/meta.js";
import {
  PROJECT_FILE,
  WINDOW_SCENE_MAX_BYTES,
  planProjectScene,
} from "./project-interiors/scene.js";
import {
  buildShopSceneMeshes,
  encodeShopScene,
} from "./recolor-shops-scene.js";
import { planInteriorViews } from "./redux-interior-views.js";

/** Пометка «этап» для печи (`onStaged`): кадр — постановочная сцена из моделей, а не кадр игры. */
export const INTERIOR_STAGE = "interior-scene";

/** Подпись обложки и кадров галереи (ключ словаря окна, `ui-text/zone-redux-interior-cover-1311.js`). */
export const INTERIOR_COVER_CAPTION =
  "Интерьер собран из моделей автора и игры; света игры на кадре нет";

/* Файлы части, что нужны сборке: модели, словари, типы (карты `.ymap` — другой вид обложки). */
export const INTERIOR_FILES = /\.(ydr|yft|ydd|ytd|ytyp)$/i;
const MODEL_FILE = /\.(ydr|yft|ydd)$/i;
const TYPES_FILE = /\.ytyp$/i;

/* Сторона листа в окне: у комнаты сотня листов, а кадр — тысяча двести точек в ширину. */
const SHEET_SIDE = 1024;
const MAX_RESOURCE_BYTES = 96 * 1024 * 1024;
/* Больше такой доли сущностей без модели нигде (ни у автора, ни в игре) — комната не собирается: показывать нечего. */
const MAX_LOST_SHARE = 0.5;
/* Больше такой доли непрозрачной поверхности комнаты без листа нигде — комната из болванок, кадр не выпускается. */
const MAX_BARE_SHARE = 0.2;

const sayError = (error) => String(error?.message || error);

/* ------------------------------------------------------------------ *
 * Какая комната
 * ------------------------------------------------------------------ */

/**
 * Имена файлов части → `Map<имя, байты>`: берутся только нужные сборке, имя — последнее звено пути, повтор имени не заменяет первый.
 * @param {{ name?: string, bytes?: Uint8Array }[]} files
 */
export function interiorFiles(files) {
  const own = new Map();
  for (const file of files || []) {
    const name = path.basename(String(file?.name || "")).toLowerCase();
    if (!INTERIOR_FILES.test(name) || !file.bytes?.length || own.has(name))
      continue;
    own.set(name, file.bytes);
  }
  return own;
}

/** Номер штатного интерьера `v_int_<N>`: из имён файлов части (`v_int_7.ytyp`, `v_7_gc_shell.ydr`); `null`, если не назван. */
export function interiorNumber(names) {
  for (const pattern of [/^v_int_(\d+)\./, /^v_(\d+)_/]) {
    for (const name of names) {
      const found = pattern.exec(String(name).toLowerCase());
      if (found) return Number(found[1]);
    }
  }
  return null;
}

/**
 * Какая комната у части. Ytyp-ов может быть несколько комнат (`v_int_10`: бакалея и банк, `v_int_49`: мотель и второй тату-салон) — берётся та, где больше вещей АВТОРА
 * (у кого его файл занимает место сущности), при равенстве — где вещей больше: превью — про то, что автор положил в часть, а не про соседнее помещение того же контейнера.
 * @param {object[]} archetypes архетипы `.ytyp` (`readMapTypes`)
 * @param {Set<number>} ownHashes хеши имён моделей, что лежат в файлах автора
 * @returns {{ mlo: object, entities: number, own: number }|null}
 */
export function chooseMlo(archetypes, ownHashes) {
  const byName = new Map();
  for (const archetype of archetypes)
    if (!byName.has(archetype.name) || archetype.mlo)
      byName.set(archetype.name, archetype);
  const rows = [];
  for (const mlo of archetypes.filter((archetype) => archetype.mlo)) {
    const entities = mloEntities(mlo);
    const own = entities.filter((entity) => {
      const def = byName.get(entity.archetype);
      return (
        ownHashes.has(def?.assetName ?? entity.archetype) ||
        ownHashes.has(entity.archetype)
      );
    }).length;
    if (entities.length) rows.push({ mlo, entities: entities.length, own });
  }
  rows.sort(
    (one, other) => other.own - one.own || other.entities - one.entities,
  );
  return rows[0] || null;
}

/** Типы всех `.ytyp` части: архетипы без повторов по имени (MLO главнее простого архетипа). */
export function archetypesOf(own) {
  const out = [];
  for (const [name, bytes] of own) {
    if (!TYPES_FILE.test(name)) continue;
    try {
      out.push(...readMapTypes(bytes).archetypes);
    } catch {
      /* битые типы — без них вещи этого файла не найдутся и попадут в «нет модели» */
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Игра
 * ------------------------------------------------------------------ */

const STOCK_ARCHIVES = "abcdefghijklmnopqrstuvw"
  .split("")
  .map((letter) => `x64${letter}.rpf`);

/** Штатный `v_int_<N>.ytyp` из игры: пак интерьера лежит в одном из базовых архивов; `null` — не нашёлся. */
export async function stockInteriorTypes(reader, number) {
  if (!Number.isInteger(number)) return null;
  for (const archive of STOCK_ARCHIVES) {
    const at = `${archive}:levels/gta5/interiors/v_int_${number}.rpf/v_int_${number}.ytyp`;
    try {
      if (await reader.has(at)) return await reader.read(at);
    } catch {
      /* архива нет или не открылся — следующий */
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Листы
 * ------------------------------------------------------------------ */

function texturesOf(bytes, fileName) {
  const resource = openResourceWith(bytes, inflateResource);
  if (/\.ytd$/i.test(fileName)) return readTextureDictionary(resource);
  return readDrawable(resource, {
    inflateRaw: inflateResource,
    kind: fileName.split(".").pop().toLowerCase(),
  }).drawables.flatMap((drawable) => drawable.embeddedTextures || []);
}

async function encodeSheet(rgba, width, height) {
  let opaque = true;
  for (let at = 3; at < rgba.length; at += 4)
    if (rgba[at] < 250) {
      opaque = false;
      break;
    }
  const image = sharp(
    Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength),
    { raw: { width, height, channels: 4 } },
  );
  return new Uint8Array(
    await (opaque ? image.removeAlpha() : image)
      .webp({ quality: 84, alphaQuality: 90, effort: 3 })
      .toBuffer(),
  );
}

/** Ключ листа в окне-съёмщике (`scene-textures.js: sheetSourceKey`): запись сцены `{ game, texture }`. */
export const sheetKey = (entry) =>
  `game:${entry.game}/${entry.texture}`.toLowerCase();

/*
 * Словарь высокого качества рядом со словарём или моделью: игра подкладывает его вблизи (`prop_atm_02+hidr.ytd` к `prop_atm_02.ydr`, `v_7_txd+hi.ytd` к `v_7_txd.ytd`) —
 * листы в нём те же по имени, но чётче. Кадр изнутри — это «вблизи», поэтому лист берётся оттуда, если он там есть.
 */
const QUALITY_SUFFIXES = ["+hidr", "+hifr", "+hi"];
export const qualityAddresses = (address) =>
  QUALITY_SUFFIXES.map((suffix) =>
    String(address).replace(/(\.[a-z0-9]+)$/i, `${suffix}.ytd`),
  );

/**
 * Листы сцены для окна: `{ sheets: [{ key, bytes }], lost: [ключ] }` — WebP по записям таблицы листов сцены; адрес `p:файл` — файл автора, иной — файл игры. Лист, которого нет
 * ни в файле, ни в его словаре высокого качества, или который не читается, пропускается и называется в `lost`: материал без листа в кадре — серая болванка, и
 * сборка комнаты такой кадр не выпускает (`buildInteriorHall`).
 * `hasOwn(файл)` / `hasGame(адрес)` — есть ли такой файл (словарь высокого качества); `textureList`, `decode`, `encode` — подмена чтения в тестах.
 */
export async function sceneSheets(
  textures,
  {
    readOwn,
    readGame,
    hasOwn = async () => false,
    hasGame = async () => false,
    textureList = texturesOf,
    decode = (ref) => decodeTextureRef(ref, { maxSize: SHEET_SIDE }),
    encode = encodeSheet,
  },
) {
  const refs = new Map();
  const listOf = (address) => {
    if (!refs.has(address)) {
      refs.set(
        address,
        (async () => {
          const bytes = address.startsWith(PROJECT_FILE)
            ? await readOwn(address.slice(PROJECT_FILE.length))
            : await readGame(address);
          if (!bytes || bytes.length > MAX_RESOURCE_BYTES) return [];
          try {
            return textureList(new Uint8Array(bytes), address);
          } catch {
            return [];
          }
        })(),
      );
    }
    return refs.get(address);
  };
  const exists = (address) =>
    address.startsWith(PROJECT_FILE)
      ? hasOwn(address.slice(PROJECT_FILE.length))
      : hasGame(address);
  const sameName = (name) => (item) => String(item.name).toLowerCase() === name;
  const sheets = [];
  const seen = new Set();
  const lost = [];
  for (const entry of textures) {
    const key = sheetKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    const name = String(entry.texture).toLowerCase();
    let ref = null;
    for (const quality of qualityAddresses(entry.game)) {
      if (ref || !(await exists(quality).catch(() => false))) continue;
      ref = (await listOf(quality)).find(sameName(name)) || null;
    }
    ref ||= (await listOf(entry.game)).find(sameName(name)) || null;
    if (!ref) {
      lost.push(key);
      continue;
    }
    try {
      const level = decode(ref);
      sheets.push({
        key,
        bytes: await encode(level.rgba, level.width, level.height),
      });
    } catch {
      lost.push(key);
    }
  }
  return { sheets, lost };
}

/**
 * Какие материалы сцены остались без листа: лист просили по имени (`texture` пуст, а `name` — имя листа шейдера) или лист не прочитался (`lost`). Зеркало листа не просит.
 * Возвращает `Set` номеров материалов и имена листов (для причины отказа).
 */
export function bareMaterials(built, lostKeys = new Set()) {
  const bare = new Set();
  const names = new Set();
  built.materials.forEach((material, index) => {
    if (material.mirror) return;
    const missing =
      material.texture === null || material.texture === undefined
        ? Boolean(material.name)
        : lostKeys.has(sheetKey(built.textures[material.texture]));
    if (!missing) return;
    bare.add(index);
    names.add(String(material.name));
  });
  return { bare, names: [...names].sort() };
}

/* Накладки (наклейки, грязь, стёкла) без листа в кадре — серые пятна: их сетки в сцену не идут. Корпус без листа (стена, стол) выбросить нельзя — его кадр не покажет (`solidsOf`: `bare`). */
const isOverlay = (material) =>
  Boolean(material.decal || material.dirt || material.alpha === "blend");

/* ------------------------------------------------------------------ *
 * Сцена комнаты
 * ------------------------------------------------------------------ */

/** Отказ с причиной словами: `{ refusal }` — в журнал печи, часть остаётся с прежним кадром. */
const refuse = (refusal) => ({ refusal });

/**
 * Сцена комнаты: `{ bytes, sheets, solids, ownStems, report }` или `{ refusal }`.
 * @param {{ files: { name: string, bytes: Uint8Array }[], source: { root: string, keys: string }, deps?: object }} input
 *   `source` — `{ root, keys }` игры (папка игры и папка ключей ArchiveFix); `deps.cacheDir` — где держать оглавление игры
 */
export async function buildInteriorHall({ files, source, deps = {} }) {
  const own = interiorFiles(files);
  if (![...own.keys()].some((name) => MODEL_FILE.test(name)))
    return refuse("в файлах части нет моделей");
  if (!source?.root || !source?.keys)
    return refuse("нужна игра: --game и --keys");

  let keys = null;
  try {
    keys = await keysFromDirectory(source.keys);
  } catch (error) {
    return refuse(`ключи архивов не прочитались: ${sayError(error)}`);
  }
  const reader = createGameReader(source.root, keys);
  try {
    const cacheDir =
      deps.cacheDir || path.join(os.tmpdir(), "astral-redux-interior-cache");
    await fs.mkdir(cacheDir, { recursive: true });
    const game = await openGameNames(source.root, {
      keys,
      cacheFile: path.join(cacheDir, "game-names.json"),
    }).catch(() => null);
    if (!game)
      return refuse(
        "оглавление игры не прочиталось: нет архивов GTA V или ключей",
      );

    const ownHashes = new Set(
      [...own.keys()]
        .filter((name) => MODEL_FILE.test(name))
        .map((name) => joaat(name.replace(/\.[^.]+$/, ""))),
    );
    let archetypes = archetypesOf(own);
    let picked = chooseMlo(archetypes, ownHashes);
    let stockTypes = false;
    if (!picked) {
      /* В типах автора комнаты нет — расстановка штатная: `v_int_<N>.ytyp` из игры. */
      const number = interiorNumber([...own.keys()]);
      const bytes = await stockInteriorTypes(reader, number);
      if (!bytes)
        return refuse(
          `в типах автора нет комнаты (MLO), а штатных типов v_int_${number ?? "?"} в игре не нашлось`,
        );
      own.set(`v_int_${number}.ytyp`, new Uint8Array(bytes));
      archetypes = archetypesOf(own);
      picked = chooseMlo(archetypes, ownHashes);
      stockTypes = true;
      if (!picked)
        return refuse(`в штатных типах v_int_${number} нет комнаты с вещами`);
    }

    const memo = new Map();
    const planned = await planProjectScene({
      unit: { internal: { files: [...own.keys()], shared: [] } },
      mloHash: picked.mlo.name,
      readOwn: async (file) => own.get(String(file).toLowerCase()) || null,
      game,
      gameRead: (address) => reader.read(address),
      gameList: (folder) => reader.list(folder),
      folderCache: (folder, build) => {
        if (!memo.has(folder)) memo.set(folder, build());
        return memo.get(folder);
      },
    });
    const { report } = planned;
    if (!report.entities)
      return refuse(
        `ни у одной вещи комнаты нет модели (ни у автора, ни в игре): без модели ${report.noModel}`,
      );
    if (report.noModel > (report.entities + report.noModel) * MAX_LOST_SHARE)
      return refuse(
        `у большинства вещей комнаты нет модели нигде: без модели ${report.noModel} из ${report.entities + report.noModel}`,
      );

    const built = await buildShopSceneMeshes(
      planned.scene,
      planned.files,
      planned.interior,
      planned.read,
      { names: true },
    );
    if (!built.meshes.length)
      return refuse("из моделей комнаты не вышло ни одной сетки");
    built.rooms = planned.scene.rooms;

    /* Листы — до записи сцены: материал без листа (ни у автора, ни в игре) в кадре серая болванка, и кадр с ней не выпускается. */
    const { sheets, lost } = await sceneSheets(built.textures, {
      readOwn: async (file) => own.get(String(file).toLowerCase()) || null,
      readGame: (address) => reader.read(address),
      hasOwn: async (file) => own.has(String(file).toLowerCase()),
      hasGame: (address) => reader.has(address),
    });
    const { bare, names: bareNames } = bareMaterials(built, new Set(lost));
    const bareSurface = { opaque: 0, all: 0 };
    built.meshes = built.meshes.filter((mesh) => {
      const material = built.materials[mesh.material];
      const triangles = mesh.indices.length / 3;
      if (!isOverlay(material)) {
        bareSurface.all += triangles;
        if (bare.has(mesh.material)) bareSurface.opaque += triangles;
        return true;
      }
      return !bare.has(mesh.material);
    });
    if (!built.meshes.length)
      return refuse("из моделей комнаты не вышло ни одной сетки");
    if (
      bareSurface.all &&
      bareSurface.opaque > bareSurface.all * MAX_BARE_SHARE
    )
      return refuse(
        `у ${Math.round((bareSurface.opaque / bareSurface.all) * 100)}% поверхностей комнаты нет листа ни у автора, ни в игре: ${bareNames.slice(0, 8).join(", ")}`,
      );

    const bytes = encodeShopScene(built);
    if (bytes.byteLength > WINDOW_SCENE_MAX_BYTES)
      return refuse(
        `комната слишком тяжёлая для кадра: ${Math.round(bytes.byteLength / 1048576)} МБ`,
      );
    const solids = solidsOf(built, bare);
    const ownStems = built.parts
      .filter((part) => part.own && part.model)
      .map((part) => String(part.model).toLowerCase());
    return {
      bytes: new Uint8Array(bytes),
      sheets: sheets.map(({ key, bytes: sheet }) => ({ key, bytes: sheet })),
      solids,
      ownStems: [...new Set(ownStems)],
      bareNames,
      rooms: planned.scene.rooms,
      report: {
        mlo: `${(picked.mlo.name >>> 0).toString(16)}`,
        entities: report.entities,
        noModel: report.noModel,
        own: picked.own,
        meshes: built.report.meshes,
        missingModels: built.report.missingModels.length,
        sheets: sheets.length,
        lostSheets: lost.length,
        bareSheets: bareNames,
        stockTypes,
      },
    };
  } catch (error) {
    return refuse(`комната не собралась: ${sayError(error)}`);
  } finally {
    await reader.close?.().catch(() => {});
  }
}

/**
 * Сетки комнаты для планировщика ракурсов: непрозрачные, без наклеек, теней и стёкол; `bare` — у материала нет листа (поза, где такая сетка в кадре, не годится).
 * @param {object} built сцена (`buildShopSceneMeshes`)
 * @param {Set<number>} bare номера материалов без листа (`bareMaterials`)
 */
export function solidsOf(built, bare = new Set()) {
  const out = [];
  for (const mesh of built.meshes) {
    const material = built.materials[mesh.material];
    if (
      !material ||
      material.alpha === "blend" ||
      material.decal ||
      material.dirt ||
      material.mirror ||
      !mesh.indices?.length
    )
      continue;
    const part = built.parts[mesh.part];
    out.push({
      stem: String(part?.model || part?.id || "model").toLowerCase(),
      positions: mesh.positions,
      indices: mesh.indices,
      doubleSided: Boolean(material.doubleSided),
      blend: false,
      bare: bare.has(mesh.material),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Кадры
 * ------------------------------------------------------------------ */

const encoder = new TextEncoder();
const jsonFile = (name, value) => ({
  name,
  bytes: encoder.encode(JSON.stringify(value)),
});

/* Съёмщик зала арены (`shooter-service.js: arenaShot`) снимает любой зал-сцену `hall.bin` по позам из `arena.json`; сервер ему нужен лишь для запасных разворотов, которых здесь нет. */
const HALL_SHOOTER = Object.freeze({ partKind: "arenas", server: "gta5rp" });
/* Кадров галереи: готовых по плану и добора окном из пула по картинке. */
const GALLERY_EXTRA = 1;

/**
 * Позы плана → `arena.json`: `frames` снимаются всегда (галерея), `coverPool` — из него окно берёт обложку по картинке (где комната не чёрная), `candidates` — пул добора,
 * `take` — сколько кадров галереи всего. Без готовых поз окно снимало бы развороты от глаза штатной арены — в чужих осях; поэтому `frames` не бывает пустым: у плана без
 * соседей по комнате первым кадром идёт сама обложка (`skip` — сколько кадров с начала галереи отбросить как повтор обложки).
 */
export function interiorViews(plan, { extra = GALLERY_EXTRA } = {}) {
  if (!plan?.cover) return null;
  const alone = !plan.frames.length;
  const frames = alone ? [plan.cover] : plan.frames;
  return {
    views: {
      frames,
      coverPool: plan.coverPool,
      candidates: plan.pool,
      take: frames.length + Math.min(extra, plan.pool.length),
    },
    skip: alone ? 1 : 0,
  };
}

/** Запрос окну: настройки зала, сцена и листы (имя листа — его ключ в окне). Ни рамок, ни подложек: кадр — вся комната. */
export function interiorRequest({ name, hall, views }) {
  const arena = {
    server: HALL_SHOOTER.server,
    outside: false,
    hidden: [],
    hall: true,
    hallOutside: false,
    ...views,
  };
  return {
    kind: "redux-part",
    partKind: HALL_SHOOTER.partKind,
    name,
    files: [
      jsonFile("arena.json", arena),
      { name: "hall.bin", bytes: hall.bytes },
      ...hall.sheets.map(({ key, bytes }) => ({ name: key, bytes })),
    ],
  };
}

/* Кадр галереи, что прошёл ворота (не чёрный, не пустой): плохой отбрасывается — три кадра лучше четырёх, один из которых чёрный. */
async function passedGate(frames, gate) {
  const kept = [];
  for (const bytes of frames)
    if (bytes?.length && (await gate(bytes, { kind: "interiors" })).ok)
      kept.push(bytes);
  return kept;
}

/* Файлы комнаты больше этого (байт) печь не собирает: у больших интерьеров проектов сотни мегабайт, а окну и памяти печи нужна одна комната, не город. */
export const ROOM_BYTES_LIMIT = 512 * 1024 * 1024;

/**
 * Файлы комнаты с байтами: `{ name, bytes }` как есть, `{ name, read() }` читается по очереди, не набирая больше `limit` байт. Не читается — файл пропускается;
 * набралось больше предела — `{ refusal }`.
 */
export async function readRoomFiles(files, limit = ROOM_BYTES_LIMIT) {
  const taken = [];
  let spent = 0;
  for (const file of files || []) {
    let raw = file?.bytes ?? null;
    if (!raw && typeof file?.read === "function")
      raw = await file.read().catch(() => null);
    if (!raw?.length) continue;
    spent += raw.length;
    if (spent > limit)
      return {
        refusal: `файлов комнаты больше ${Math.round(limit / 1048576)} МБ — такую комнату печь не собирает`,
      };
    taken.push({
      name: file.name,
      bytes: raw instanceof Uint8Array ? raw : new Uint8Array(raw),
    });
  }
  return { files: taken };
}

/**
 * Обложка и галерея интерьера: `{ png, caption }` — кадр изнутри комнаты на весь кадр (ни рамки, ни поля), листы те же, что в игре, у изменённых — авторские; `{ png: null, why }` —
 * отказ с причиной словами (в журнал печи): комната не собралась, у вещи нет листа нигде, нет годного ракурса, окно не вернуло кадр.
 * `files` — файлы части `[{ name, bytes }]` или с ленивым чтением `[{ name, read() }]`, `render` — окно-съёмщик, `source` — `{ root, keys }` игры, `onGallery(кадры)` получает кадры галереи с подписью.
 * `deps`: `hall` — сборка комнаты, `plan` — планировщик ракурсов, `gate` — ворота кадра (подмена в тестах), `debug(...)` — строки в журнал.
 */
export async function interiorCover({
  files,
  name = "",
  render,
  source,
  onGallery = null,
  onStaged = null,
  deps = {},
}) {
  const say = deps.debug || (() => {});
  if (typeof render !== "function") return { png: null, why: "нужно окно" };
  const room = await readRoomFiles(files, deps.bytesLimit);
  if (room.refusal) return { png: null, why: room.refusal };
  const hall = await (deps.hall || buildInteriorHall)({
    files: room.files,
    source,
    deps,
  });
  if (hall.refusal) return { png: null, why: hall.refusal };
  say(name, "комната:", JSON.stringify(hall.report));
  const plan = (deps.plan || planInteriorViews)({
    solids: hall.solids,
    ownStems: hall.ownStems,
  });
  const shaped = interiorViews(plan);
  if (!shaped) {
    const stats = plan?.report?.[0];
    const blocked = stats?.bareBlocked
      ? `; из-за вещей без листа (${hall.bareNames.slice(0, 6).join(", ")}) отброшено поз: ${stats.bareBlocked}`
      : "";
    return {
      png: null,
      why: `в комнате не нашлось годного ракурса изнутри${stats ? ` (поз ${stats.poses}, годных ${stats.usable})` : ""}${blocked}`,
    };
  }
  say(name, "ракурсы:", JSON.stringify(plan.report));
  const shot = await render(
    interiorRequest({ name, hall, views: shaped.views }),
  );
  const png = shot?.png?.length ? shot.png : null;
  if (!png) return { png: null, why: "окно не вернуло кадр комнаты" };
  onStaged?.(INTERIOR_STAGE);
  const gate = deps.gate || inspectCover;
  const gallery = await passedGate(
    (shot.gallery || []).slice(shaped.skip),
    gate,
  );
  if (gallery.length && typeof onGallery === "function")
    await onGallery(
      gallery.map((bytes) => ({ bytes, caption: INTERIOR_COVER_CAPTION })),
    );
  return { png, caption: INTERIOR_COVER_CAPTION, gallery };
}
