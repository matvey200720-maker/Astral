/*
 * Снимок вещи самой GTA — плитка в «Сделать заменёнку» (ТЗ 27.10.2026, п. 1; владелец: «чтобы отображались стандартные GTA-шные модельки,
 * чтобы человек понимал, на что он заменяет»).
 *
 * У вещей игры картинки на CDN нет (у вещей GTA5RP и Majestic она есть — её приносит `readProjectPicture`), поэтому плитка просит снимок самой
 * модели: Desktop находит вещь в оглавлении одежды игры игрока (`game-clothing-index.js`), читает её `.ydd` и первую расцветку `.ytd` из архива
 * дополнения и отдаёт окну запрос снимка `shotRequestOf` — меши, расцветку и ракурс категории. Снимает окно тем же съёмщиком, что карточки
 * категорий мастерской (`clothing-shot.js`): один контекст WebGL, очередь, готовый снимок — в хранилище мастерской (`item-shots.js`).
 *
 * Читается в потоке читателя игры (`game-read-host.js`): разбор модели — не в главном процессе Electron. Только чтение: в игру ничего не пишется,
 * файлов Rockstar в git и в поставке нет. Не нашлась вещь, нет файла модели или она пустышка (один четырёхугольник) — отказ словами: окно
 * оставляет значок, а не рисует образец.
 *
 * Скорость (15.11.2026, замер `scripts/perf/baseline/game-shot-steps.mjs` и стенда окна): оглавление в памяти потока, модель и первая расцветка читаются разом (две
 * независимые записи архива), временные файлы лежат в одной общей папке (`item-shots`) под уникальными именами и убираются по одному — папка на каждую вещь
 * (mkdir, rm -r) стоила 30–40 мс из 80. Вызов с `warm: true` ничего не снимает: он поднимает поток чтения игры и читает оглавление, пока человек ещё не дошёл до
 * вкладки «GTA» (первое чтение в Electron — ≈ 1,4 с, из них почти всё — запуск потока).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { itemFolder } from "@modovik/clothing/game-assortment";
import { garmentShape } from "@modovik/clothing/garment-shape";
import { colourFilesInOrder, isStubFileSize } from "@modovik/clothing/colour-files";
import { clothingDrawable, colourPicture, isStubPicture, showcaseDrawable } from "@modovik/clothing/model";
import { ITEM_SHOT_VERSION, shotRequestOf } from "@modovik/clothing/shot-request";
import { categoryOfComponent } from "@modovik/clothing/taxonomy";
import { inflateRawNode } from "@modovik/rpf7/node";
import { appLog } from "./app-log.js";
import { clothingArchiveTools, clothingGameRoot } from "./clothing-models.js";

export { ITEM_SHOT_VERSION };

/* `extra` — поля отказа для журнала и тестов (`reason`, `cause`); через IPC в окно доезжает только текст, поэтому окну их не читать. */
const refusal = (code, message, extra = {}) => Object.assign(new Error(message), { code }, extra);

/*
 * Что именно прочиталось (22.11.2026, журнал свежей установки 1.0.0): «нет модели» и «не нашлось расцветки» приходили у десятков вещей
 * подряд без единой строки о чтении, а отказ чтения `.ytd` глотался (`.catch(() => null)`). Теперь причина каждого файла запоминается,
 * а при отказе вещи уходит ОДНА запись в журнал: папка и редакция игры, архив и запись модели, сколько расцветок пробовали, сколько
 * не прочлось, сколько отсекла заглушка, у каждого файла — размер, заголовок, код и первая строка ошибки. Поведение показа не меняется.
 */
const REASON_CAP = 240;
const reasonOf = (error) =>
  `${error?.code ? `${error.code}: ` : ""}${String(error?.message || error)}`.replace(/\s+/g, " ").slice(0, REASON_CAP);
const magicOf = (bytes) =>
  [...bytes.subarray(0, 4)].map((code) => (code >= 32 && code < 127 ? String.fromCharCode(code) : "?")).join("");
const countOf = (notes, kind) => [...notes.values()].filter((note) => note.kind === kind).length;

async function noteItemRefusal(log, facts) {
  try {
    const { key, why, reason, gameRoot, model, listed, candidates, notes, faces, matched, setAside } = facts;
    const enhanced = await fs.access(path.join(gameRoot, "GTA5_Enhanced.exe")).then(() => true, () => false);
    const lines = [
      `игра: папка ${path.basename(gameRoot)}, редакция ${enhanced ? "Enhanced" : "Legacy"}`,
      `модель: ${model.entry}, ${model.bytes ?? "не прочитана"} Б, сеток ${model.meshes ?? "?"}, пустышка ${model.placeholder ? "да" : "нет"}`,
      `расцветки из: ${faces}; паков с такой вещью ${matched}, паков Astral не учтено ${setAside}`,
      `расцветок в оглавлении ${listed}, пробовалось ${candidates.length}, не прочлось ${countOf(notes, "failed")}, ` +
        `без картинки в файле ${countOf(notes, "blank")}, заглушек ${countOf(notes, "stub")}`,
      ...(reason ? [`причина: ${reason.kind}; расцветка №${reason.colour + 1}, файлов ${reason.found} из ${reason.wanted}`] : []),
      ...candidates.filter((texture) => notes.has(texture.name)).map((texture) => `  ${texture.name}: ${notes.get(texture.name).text}`),
    ];
    log({ level: "warn", source: "clothing", message: `Вещь игры ${key}: отказ «${why}»`, detail: lines.join("\n") });
  } catch {
    // журнал не должен менять исход вещи
  }
}

/* Оглавление игры читается один раз и держится, пока поток не уснул: на каждую плитку заново читать и разбирать его незачем. */
const INDEX_TTL_MS = 120_000;
const indexes = new Map();

async function indexOf(gameRoot, stateDir, tools) {
  const key = gameRoot.toLowerCase();
  const cached = indexes.get(key);
  if (cached && Date.now() - cached.at < INDEX_TTL_MS) return cached.index;
  const index = await tools.index({ gameRoot, stateDir });
  indexes.set(key, { at: Date.now(), index });
  return index;
}

/** Забыть прочитанное оглавление (тесты). */
export const forgetItemShotIndex = () => indexes.clear();

/** Пак самого Astral в оглавлении (`update/x64/dlcpacks/astral_*`). */
const isOwnPack = (collection) => /^astral_/i.test(String(collection?.pack || ""));

/**
 * Вещь в оглавлении: пол, вид, папка и номер — те же, что в строках `listGameClothingItems`. Ответ — `{ collection, item, model }`: `item` —
 * исходная вещь (с расцветками), `model` — запись, откуда читать модель. У вещи, чью модель Rockstar поправила заплаткой (`patchdayNNng`,
 * `mppatches`), в оглавлении две записи: исходная — с расцветками, но с пустышкой вместо модели, и запись заплатки — с настоящей моделью,
 * но без расцветок. Игра собирает вещь так же: модель из заплатки, расцветки из исходного пакета (`mergePatchedItems` в `clothing-models.js`).
 */
export function findGameItem(index, { gender, component, folder, drawable }) {
  const matches = [];
  for (const collection of index?.collections || []) {
    const section = collection[gender];
    if (!section) continue;
    for (const item of section.items || [])
      if (
        item.component === component &&
        item.drawable === drawable &&
        itemFolder(section, item).toLowerCase() === folder
      )
        matches.push({ collection, item });
  }
  if (!matches.length) return null;
  /* Слои самого Astral (`astral_clothing`: заменёнки, покраска, «скрыть», 22.11.2026) — не вещь игры. Оглавление ставит их ПЕРЕД паками
     игры (`astral_…` идёт раньше `mp…` и `patchday…` по алфавиту), и после прежнего Astral, чьи моды остались в файлах игры без учёта,
     плитка «Вещи GTA» показывала его покраску на одну расцветку (у остальных «не нашлось расцветки») и его пустышку «скрыть» вместо модели. Вещь
     берётся из паков игры; пак Astral — только когда нигде больше такой вещи нет (вещь, лежащая лишь в нём, по-прежнему снимается). */
  const ofGame = matches.filter((entry) => !isOwnPack(entry.collection));
  const pool = ofGame.length ? ofGame : matches;
  const origin = pool.find((entry) => entry.item.textureFiles?.length) || pool[0];
  const patches = pool.filter(
    (entry) => entry !== origin && !entry.item.textureFiles?.length && entry.item.model && entry.item.dir,
  );
  return { ...origin, model: patches.at(-1) || origin, matched: matches.length, setAside: matches.length - pool.length };
}

/*
 * Расцветка вещи — ровно один файл: N-й по порядку (по имени файла) список расцветок вещи; N = 0 — первая. Решение владельца, 22.11.2026: «Прятать». Расцветка, у которой в самой игре лежит заглушка (шахматка ~800 Б:
 * Rockstar оставил слот пустым, у ~500 вещей базовой игры) в окне «Сделать заменёнку» не показывается вовсе: Desktop отвечает «такой расцветки нет» (`none`), окно убирает плитку, номера остальных расцветок остаются настоящими (1, 2, 3, 13…).
 * Заглушку называет размер файла из оглавления (`isStubFileSize` < 1024 Б, `packages/clothing/colour-files.js`: окно знает о заведомых заглушках заранее и не просит их) и, для файлов от 1024 Б, — `isStubPicture` (`resolved.stub`,
 * шахматка по пикселям) после чтения. Вещь прячется, только когда у неё НЕТ ни одной настоящей расцветки; если заглушка — первая, а настоящие есть, окно само просит снимок первой настоящей (`colour` = её номер): сюда приходит всегда
 * ровно одна расцветка, перебора здесь нет. Картинка вещи — именно запрошенная расцветка, а не чужая.
 */
const FULLEST_STAGES = Object.freeze([26, 6]);
/* Файл расцветки N: тот же порядок и тот же помощник, что у окна (`colourFilesInOrder`): по МЕСТУ по имени файла, а не по букве (сходство с `textureByIndex` держит `tests/clothing-colour-files.test.js`). */
const faceTextures = (files = [], colour = 0) => [colourFilesInOrder(files)[colour]].filter(Boolean);
/* Разовый сбой чтения расцветки (файл занят, помощник занят сборкой) — одна повторная проба через столько миллисекунд: «такой расцветки нет» из-за разового сбоя не бывает. */
const READ_RETRY_MS = 200;
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/* Как прочитанные байты становятся вещью — тот же JS, что у карточек и мастерской; подменяется в тестах. */
const BUILD = Object.freeze({
  drawable: (bytes) => clothingDrawable(bytes, { inflateRaw: inflateRawNode }),
  picture: (bytes) => colourPicture(bytes, { inflateRaw: inflateRawNode }),
  shape: garmentShape,
  stub: isStubPicture,
  showcase: showcaseDrawable,
  shot: shotRequestOf,
});

/**
 * Снимок вещи игры: `{ key, version, shot }`, где `shot` — запрос для `createClothingShooter().shoot`. `deps` — `{ stateDir, tools }`
 * (поток читателя кладёт в `tools` вызов нативного хоста).
 */
export async function readGameItemShot(input, context, deps = {}) {
  const gameRoot = clothingGameRoot(input);
  if (input?.warm) {
    const warming = { ...clothingArchiveTools(deps.stateDir), ...(deps.tools || {}) };
    await indexOf(gameRoot, deps.stateDir, warming);
    return { warm: true };
  }
  const gender = input?.gender === "female" ? "female" : input?.gender === "male" ? "male" : "";
  const component = String(input?.component || "");
  const folder = String(input?.folder || "").toLowerCase();
  const drawable = Number(input?.drawable);
  const colour = Number.isInteger(input?.colour) && input.colour > 0 && input.colour < 26 ? input.colour : 0;
  if (!gender || !/^[a-z_]{3,12}$/.test(component) || !/^mp_[mf]_freemode_01[a-z0-9_]*$/.test(folder) || !Number.isInteger(drawable) || drawable < 0 || drawable > 999)
    throw refusal("GAME_ITEM_SHOT", "Непонятно, какую вещь снимать.");
  const resolved = { ...clothingArchiveTools(deps.stateDir), ...BUILD, ...(deps.tools || {}) };
  const found = findGameItem(await indexOf(gameRoot, deps.stateDir, resolved), { gender, component, folder, drawable });
  if (!found) throw refusal("GAME_ITEM_SHOT", "Такой вещи в игре нет.");
  const { item, model: source } = found;
  if (!source.item.dir || !source.item.model || !source.collection.archive)
    throw refusal("GAME_ITEM_SHOT", "У этой вещи в игре нет файла модели.");
  /* Модель — из своего архива (у заплатки он другой), расцветки — из архива исходной вещи. */
  /* Вещь из штатного подпакета (`dlc1.rpf`) читается оттуда: `archive` у вещи, а не у пака (`game-clothing-index.js`, версия 8). */
  const entryIn = ({ collection, item: place }, file) => `${(place.archive || collection.archive).replace(/\.rpf$/i, "")}:/${place.dir}/${file}`;
  const modelEntry = entryIn(source, source.item.model);
  const filesCount = item.textureFiles?.length ?? 0;
  const wantedColours = Number(item.textures) || filesCount;
  /* Расцветки нет (окну сказано больше, чем файлов в оглавлении; у вещи вообще нет файлов расцветок) или это заглушка игры по размеру файла: не отказ чтения, а ответ «такой расцветки нет» — окно убирает плитку (расцветку или вещь,
     если это первая), а не рисует пустую карточку (владелец, 22.11.2026: «Прятать»). Ничего не читается. Причина — в ответе (`reason`), в журнал строки нет: такой ответ ожидаем. */
  const picked = faceTextures(item.textureFiles, colour)[0];
  if (!picked || isStubFileSize(picked.size))
    return { key: `${gender}|${component}|${folder}|${drawable}`, version: ITEM_SHOT_VERSION, none: true, reason: { kind: picked ? "stub" : "no-file", colour, found: filesCount, wanted: wantedColours, ...(picked ? { file: picked.name, by: "size" } : {}) } };
  /* Одна папка на все снимки, файлы — под уникальными именами и убираются по одному: несколько вещей читаются разом, а папка на вещь стоила 30–40 мс (mkdir, rm -r). */
  const work = path.join(deps.stateDir, "clothing-models", "work", "item-shots");
  const stem = randomUUID();
  const modelFile = path.join(work, `${stem}.ydd`);
  const textureFile = path.join(work, `${stem}.ytd`);
  const faceFile = path.join(work, `${stem}.face.ytd`);
  let firstFace = Promise.resolve(null);
  let modelReading = Promise.resolve();
  try {
    await fs.mkdir(work, { recursive: true });
    /* Первая расцветка читается вместе с моделью: файлы независимы, а ждать разбора модели, чтобы начать второе чтение, незачем. Отказ чтения — `null`, как и раньше. */
    const candidates = faceTextures(item.textureFiles, colour);
    const log = typeof deps.log === "function" ? deps.log : (entry) => appLog.record(entry);
    const faceNotes = new Map();
    const modelFacts = { entry: modelEntry, bytes: null, meshes: null, placeholder: false };
    const refused = async (why, reason = null) => noteItemRefusal(log, { key: `${gender}/${component}/${folder}/${drawable}`, why, reason, gameRoot, model: modelFacts, listed: item.textureFiles?.length ?? 0, candidates, notes: faceNotes, faces: entryIn(found, "x").slice(0, -2), matched: found.matched ?? 1, setAside: found.setAside ?? 0 });
    /* Чтение с одним повтором при сбое чтения (не при заглушке и не при неразобранном файле). */
    const readWithRetry = async (request) => {
      try {
        return await resolved.read(request, context);
      } catch (error) {
        if (context?.signal?.aborted) throw error;
        await sleep(READ_RETRY_MS);
        return resolved.read(request, context);
      }
    };
    const readFace = (texture, file) =>
      readWithRetry({ gameRoot, entry: entryIn(found, texture.name), output: file })
        .then(async () => {
          const bytes = await fs.readFile(file);
          let picture;
          try {
            picture = resolved.picture(bytes);
          } catch (error) {
            /* Файл прочитан, но не разобран: не сбой чтения (отличать в журнале и в отказе). */
            faceNotes.set(texture.name, { kind: "undecodable", text: `прочитано ${bytes.length} Б (${magicOf(bytes)}), разбор не вышел: ${reasonOf(error)}`, error });
            return null;
          }
          if (!picture) faceNotes.set(texture.name, { kind: "blank", text: `прочитано ${bytes.length} Б (${magicOf(bytes)}), расцветки в файле нет` });
          return picture;
        })
        .catch((error) => {
          /* `error` — сама ошибка чтения: она уходит в `cause` отказа, а не теряется. */
          faceNotes.set(texture.name, { kind: "failed", text: `чтение не вышло: ${reasonOf(error)}`, error });
          return null;
        });
    const modelRead = resolved.read({ gameRoot, entry: modelEntry, output: modelFile }, context);
    modelReading = modelRead;
    /* Отказ чтения модели обрабатывается ниже (`await modelRead`), но раньше его может обогнать ожидание расцветки: без этой ветки он был бы «необработанным отказом». */
    modelRead.catch(() => {});
    firstFace = candidates.length ? readFace(candidates[0], faceFile) : Promise.resolve(null);
    /* Расцветка — заглушка игры (шахматка по правилу `resolved.stub`) или файл без расцветки: «такой расцветки нет» (владелец, 22.11.2026: «Прятать»); модель разбирать незачем. Для первой расцветки это и есть «вещь с заглушкой первой». */
    if (candidates.length) {
      const early = await firstFace;
      const note = faceNotes.get(candidates[0].name);
      if ((early && resolved.stub(early)) || (!early && note?.kind === "blank")) {
        await modelRead.catch(() => {});
        return {
          key: `${gender}|${component}|${folder}|${drawable}`,
          version: ITEM_SHOT_VERSION,
          none: true,
          reason: { kind: early ? "stub" : "blank", colour, found: filesCount, wanted: wantedColours, file: candidates[0].name },
        };
      }
    }
    await modelRead;
    const modelBytes = await fs.readFile(modelFile);
    modelFacts.bytes = modelBytes.length;
    let model = resolved.drawable(modelBytes);
    modelFacts.meshes = model?.meshes?.length ?? 0;
    if (!model?.meshes?.length) throw refusal("GAME_ITEM_SHOT", "В модели вещи нет сетки.");
    /* Большие сумки: основной файл — квадрат 3×5 см, сама сумка — в ступенях наполнения `hand_000_u_1…26.ydd` (у части — до 6). Показ — по самой полной, как в мастерской. */
    if (resolved.shape(model, component)?.placeholder && component === "hand") {
      for (const stage of FULLEST_STAGES) {
        const full = await resolved
          .read({ gameRoot, entry: entryIn(source, source.item.model.replace(/\.ydd$/i, `_${stage}.ydd`)), output: modelFile }, context)
          .then(async () => resolved.drawable(await fs.readFile(modelFile)))
          .catch(() => null);
        if (full?.meshes?.length && !resolved.shape(full, component)?.placeholder) {
          model = full;
          break;
        }
      }
    }
    /* Большие сумки: у места нет модели, только расцветки. Картинка плитки — сама расцветка из файлов игры. */
    const place = resolved.shape(model, component)?.placeholder;
    if (place && component === "hand" && item.textureFiles?.length) {
      if (candidates[0]) {
        /* Раньше отказ чтения здесь был отказом вещи, а не «нет расцветки»: сохраняем — читаем ещё раз, если разом не вышло. */
        let read = await firstFace;
        if (!read) {
          await resolved.read({ gameRoot, entry: entryIn(found, candidates[0].name), output: textureFile }, context);
          read = resolved.picture(await fs.readFile(textureFile));
        }
        const rgba = read?.rgba || read?.data || read?.pixels;
        if (rgba && read.width && read.height)
          return { key: `${gender}|${component}|${folder}|${drawable}`, version: ITEM_SHOT_VERSION, flat: { width: read.width, height: read.height, rgba } };
      }
    }
    /* Пустышка игры — один четырёхугольник в стороне от тела: снимать нечего. */
    if (resolved.shape(model, component)?.placeholder) {
      modelFacts.placeholder = true;
      await refused("нет модели — только место под неё");
      throw refusal("GAME_ITEM_SHOT", "У этой вещи в игре нет модели — только место под неё.");
    }
    let picture = null;
    for (const [at, texture] of candidates.entries()) {
      const read = at === 0 ? await firstFace : await readFace(texture, textureFile);
      if (read && !resolved.stub(read)) {
        picture = read;
        break;
      }
      if (read) faceNotes.set(texture.name, { kind: "stub", text: "шахматка-заглушка" });
    }
    /* Без настоящей расцветки снимать нечего: белая форма — не вещь (владелец, 01.11.2026). Плитка уйдёт из окна. */
    if (!picture) {
      /* Причина — полем отказа, не текстом для человека: «нет файла этой расцветки (найдено K из N)», «файл не прочёлся» (сама ошибка — в `cause`), «все пробованные расцветки — заглушки» или «в файле нет расцветки». */
      const noted = [...faceNotes.values()];
      const failed = noted.find((note) => note.kind === "failed");
      const kind = failed ? "read-failed" : !candidates.length ? "no-file" : noted.some((note) => note.kind === "stub") ? "stub" : noted.some((note) => note.kind === "undecodable") ? "undecodable" : "blank";
      const reason = { kind, colour, found: filesCount, wanted: wantedColours, tried: candidates.length, failed: countOf(faceNotes, "failed") };
      await refused("не нашлось расцветки", reason);
      const undecodable = noted.find((note) => note.kind === "undecodable");
      /* Текст — единственное, что доезжает до окна через IPC: «не удалось прочитать» (сбой чтения, неразобранный файл) окно не запоминает на весь запуск (`item-shots.js`, `TRANSIENT_REFUSAL`), «не нашлось расцветки» — запоминает. */
      throw refusal("GAME_ITEM_SHOT", kind === "read-failed" || kind === "undecodable" ? "Расцветку этой вещи не удалось прочитать." : "У этой вещи в игре не нашлось расцветки.", { reason, ...(failed || undecodable ? { cause: (failed || undecodable).error } : {}) });
    }
    const slot = categoryOfComponent(component)?.id || null;
    return {
      key: `${gender}|${component}|${folder}|${drawable}`,
      version: ITEM_SHOT_VERSION,
      shot: resolved.shot(resolved.showcase(model, component, { slot, picture }), { texture: picture, category: slot }),
    };
  } finally {
    /* Чтение первой расцветки могло ещё идти (вещь отказана раньше): ждём его конца (оно отказом не кончается), прежде чем убирать файл. */
    await firstFace;
    await modelReading.catch(() => {});
    await Promise.all([modelFile, textureFile, faceFile].map((file) => fs.rm(file, { force: true }).catch(() => {})));
  }
}
