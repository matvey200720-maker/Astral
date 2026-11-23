/*
 * Дорожка клипа для окна (ТЗ 29.10.2026-d): повороты костей по кадрам — окно проигрывает их на скелете персонажа на видеокарте.
 *
 * Клип игры хранит анимацию как сжатые блоки с шестьюдесятью кадрами в секунду; разбор одного кадра — команда движка
 * `sample-anim-pose` (проверена паритетом по корпусу 441 файл). Дорожка — это та же команда на сетке времён `1 / TRACK_FPS`,
 * пулом по несколько сразу: клип в двенадцать секунд снимается секунды. Готовая дорожка лежит в кэше приложения и едет в окно
 * двумя `Float32Array` — повороты (по четыре числа на кость на кадр, RAGE) и «мувер» (поворот и сдвиг корня клипа).
 *
 * Тег 0 в клипе — не кость скелета, а мувер: куда сам идёт персонаж. Его окно использует только для поворота тела целиком
 * (лёжа, на корточках), сдвиг по земле оставляет на месте — иначе танец «уходил» бы из кадра.
 *
 * Слои. У эмоций из дополнений игры тело — клип-список из двух анимаций: первая ведёт корень, мелкие дорожки и часть костей, вторая —
 * остальные повороты (у «Wasnt Me» это в основном пальцы кистей; общих костей у слоёв нет). Движок снимает позу только первой записи, поэтому каждый
 * следующий слой читается из словаря, где он стоит первым (`layerDictionary`), и поза собирается из всех слоёв: у кого слой
 * несёт кость, у того она и берётся. Без этого предпросмотр показывал эмоцию без рук.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { atomicWrite } from "../clothing-models.js";
import { animationsFolder, pool } from "./animation-index.js";
import {
  findClip,
  layerDictionary,
  parseDictionary,
  readClip,
} from "./ycd-graft.js";
import { sensibleRate } from "./clip-rate.js";
import { checkProjectEntry, projectDictionaryFile } from "./project-source.js";
import { aliasMovers, clipHasMover, MOVER_ALIAS } from "./ycd-mover.js";
import {
  callTrack,
  noteNoTravel,
  noteTrackFailure,
  trackEngineNoTravel,
  trackEngineWanted,
  trackSample,
} from "./animation-track-engine.js";

/* Сетка дорожки: тридцать кадров в секунду (30.10.2026; было пятнадцать). Резидентный движок делает кадр за 1–4 мс, и шестнадцатисекундный клип с двумя
   слоями собирается меньше чем за секунду; быстрые движения (удары, взмахи) между кадрами пятнадцати в секунду терялись, а кривая между кадрами окна их не возвращала. */
export const TRACK_FPS = 30;
/* Потолок длины клипа — по самому длинному в дампах проектов (253,9 с у Nova RP; до 14.11.2026 было 16 с, и 37 клипов GTA 5 RP и 199 Nova RP играли начальным отрезком). Клип дольше потолка
   или тяжелее `TRACK_MAX_BYTES` берётся начальным отрезком, дорожка говорит об этом (`truncated`). */
export const TRACK_MAX_SECONDS = 300;
/* Память одной дорожки в окне: повороты и мувер, `frames × (tags × 16 + 28 [+ 28 с корневым движением])` байт. Самый длинный клип дампов (254 с, ~100 костей) — ≈ 12 МБ. */
export const TRACK_MAX_BYTES = 24 * 1024 * 1024;
/* `t5` (3.11.2026): дорожка по кадрам самой анимации (`clipFrames`) — прежние `t4` с повторами и пропусками кадров снимаются заново.
   `t6` (14.11.2026): клип целиком (до `TRACK_MAX_SECONDS`), скорость клипа (`rate`), корневое движение (`travel`) — всё снимается заново. */
export const TRACK_BUILD = "t6";
/* Поза плитки — один момент клипа, новая сетка её не меняет: её кэш остаётся прежним, 1457 поз заново не читаются. */
export const POSE_BUILD = "t4";
const WORKERS = 8;
export const MOVER_TAG = 0;

const unwrap = (answer) => answer?.result ?? answer ?? {};
const sha = (text) =>
  createHash("sha1").update(text).digest("hex").slice(0, 20);

const GAME_ARCHIVE =
  /^(x64c\.rpf|update\/update\.rpf|update\/x64\/dlcpacks\/[A-Za-z0-9_]{1,64}\/dlc\.rpf)$/;
const INNER = /^[A-Za-z0-9_@.\-/ ]{1,260}\.ycd$/;

/** Запись, пришедшая из окна, — только допустимые архивы игры и свои источники; пути из окна как есть не читаются. */
export function checkEntry(entry, ownRoots = []) {
  if (!entry || typeof entry !== "object")
    throw Object.assign(new Error("Анимация не названа."), {
      code: "ANIMATION_ENTRY",
    });
  const clip = String(entry.clip || "");
  if (!clip || clip.length > 200)
    throw Object.assign(new Error("У анимации нет клипа."), {
      code: "ANIMATION_ENTRY",
    });
  if (String(entry.source) === "game") {
    if (
      !GAME_ARCHIVE.test(String(entry.archive || "")) ||
      !INNER.test(String(entry.entry || "")) ||
      String(entry.entry).includes("..")
    )
      throw Object.assign(new Error("Такого словаря в игре нет."), {
        code: "ANIMATION_ENTRY",
      });
    return { source: "game", clip, archive: entry.archive, entry: entry.entry };
  }
  /* Словарь проекта («GTA 5 RP», «Nova RP»): по хэшу из описи, а не по пути из окна. */
  if (String(entry.source).startsWith("project:"))
    return checkProjectEntry(entry);
  const file = path.resolve(String(entry.file || ""));
  if (
    !/\.ycd$/i.test(file) ||
    !ownRoots.some((root) => file === root || file.startsWith(root + path.sep))
  )
    throw Object.assign(new Error("Этот файл не из ваших источников."), {
      code: "ANIMATION_ENTRY",
    });
  return { source: String(entry.source), clip, file };
}

/*
 * Вынимаемые сейчас словари: второй клип того же словаря ждёт первое чтение, а не читает файл, который ещё пишется.
 *
 * Прежде движок писал словарь прямо под его именем в кэше, а проверка «файл есть и не пуст» пропускала второй клип к недописанному файлу:
 * плитки поз идут пулом по четыре, клипы одного словаря (`idle_a`, `idle_b`) стоят рядом — и на холодном кэше 40 из 1461 плиток игры
 * этого ПК отвечали «Ресурс короче заголовка RSC7.» (02.11.2026), а с прогретым кэшем те же клипы читались. Теперь словарь пишется во
 * временный файл и встаёт на место переименованием: под своим именем он только целый — и для второго потока чтения игры тоже.
 */
const extracting = new Map();

/** Словарь как файл на диске: игры — вынутый в кэш, свой — на месте. */
export async function dictionaryFile(
  entry,
  { gameRoot, stateDir },
  context,
  tools,
) {
  if (String(entry.source).startsWith("project:"))
    return projectDictionaryFile(entry, { stateDir });
  if (entry.source !== "game") return entry.file;
  const output = path.join(
    animationsFolder(stateDir, gameRoot),
    "ycd",
    `${sha(`${entry.archive}|${entry.entry}`)}.ycd`,
  );
  if (
    await fs.stat(output).then(
      (stat) => stat.size > 0,
      () => false,
    )
  )
    return output;
  if (!extracting.has(output)) {
    const work = (async () => {
      await fs.mkdir(path.dirname(output), { recursive: true });
      /* Имя временного файла кончается на `.ycd`, как у самого словаря: движку расширение говорит, что он пишет. */
      const part = output.replace(
        /\.ycd$/,
        `.${process.pid}-${randomUUID()}.part.ycd`,
      );
      try {
        await tools.read(
          {
            gameRoot,
            entry: `${entry.archive.replace(/\.rpf$/i, "")}:/${entry.entry}`,
            output: part,
          },
          context,
        );
        await fs.rename(part, output).catch(async (error) => {
          /* Второй поток успел положить тот же словарь (на Windows замена открытого файла отказывает): целый уже на месте. */
          if (
            !(await fs.stat(output).then(
              (stat) => stat.size > 0,
              () => false,
            ))
          )
            throw error;
        });
      } finally {
        await fs.rm(part, { force: true }).catch(() => {});
      }
      return output;
    })();
    extracting.set(output, work);
    work.then(
      () => extracting.delete(output),
      () => extracting.delete(output),
    );
  }
  return extracting.get(output);
}

/* Временные копии словарей с корневым движением (`aliasMovers`), сделанные `openLayers`: только в них тег MOVER_ALIAS — не кость, а дорожки 5 и 6. В остальных словарях (позы плиток, покой, чужие
   файлы) кость с таким тегом, если она там есть, — обычная кость (ревью 14.11, п. 9). */
const aliasedFiles = new Set();

/** Кадр клипа: `{ duration, tags, rotations, mover }` — повороты костей без мувера и сам мувер (`[x, y, z, w, tx, ty, tz]`). */
export async function sampleClip(file, clip, time, context, tools) {
  const answer = unwrap(
    await tools.native(
      "sample-anim-pose",
      { input: file, clip, time },
      context,
    ),
  );
  const bones = Array.isArray(answer.bones) ? answer.bones : [];
  const copy = aliasedFiles.has(file);
  const rotations = new Map();
  const mover = [0, 0, 0, 1, 0, 0, 0];
  let hasMover = false;
  /* Корневое движение (дорожки 5 и 6): движок отдаёт его под тегом MOVER_ALIAS, если словарь — копия `aliasMovers`. */
  const travel = [0, 0, 0, 1, 0, 0, 0];
  let hasTravel = false;
  for (const bone of bones) {
    const tag = Number(bone?.tag);
    if (!Number.isInteger(tag)) continue;
    if (copy && tag === MOVER_ALIAS) {
      if (bone.track === "rotation" && bone.value?.length === 4) {
        for (let at = 0; at < 4; at += 1) travel[at] = Number(bone.value[at]);
        hasTravel = true;
      } else if (bone.track === "translation" && bone.value?.length === 3) {
        for (let at = 0; at < 3; at += 1)
          travel[4 + at] = Number(bone.value[at]);
        hasTravel = true;
      }
      continue;
    }
    if (bone.track === "rotation" && bone.value?.length === 4) {
      if (tag === MOVER_TAG) {
        for (let at = 0; at < 4; at += 1) mover[at] = Number(bone.value[at]);
        hasMover = true;
      } else rotations.set(tag, bone.value.map(Number));
    } else if (
      bone.track === "translation" &&
      bone.value?.length === 3 &&
      tag === MOVER_TAG
    ) {
      for (let at = 0; at < 3; at += 1) mover[4 + at] = Number(bone.value[at]);
      hasMover = true;
    }
  }
  return {
    duration: Number(answer.duration) || 0,
    frames: Number(answer.frames) || 0,
    time: Number(answer.time) || 0,
    rotations,
    mover,
    hasMover,
    travel,
    hasTravel,
  };
}

const MAX_LAYERS = 4;

export { sensibleRate };

/**
 * Слои клипа как словари для движка: `files[0]` — сам словарь, дальше — по файлу на каждую следующую запись клипа-списка. Одиночный
 * клип и всё, что не разобралось, — один слой (предпросмотр остаётся таким, каким был). `rates` — скорость каждого слоя; `options.travel === false` — без копии словаря
 * с корневым движением (позе плитки оно не нужно, а копия — это перепаковка всего словаря). `close` убирает временные файлы.
 */
export async function openLayers(file, clip, options = {}) {
  const files = [file];
  const rates = [1];
  let folder = null;
  let copied = false;
  try {
    let bytes = await fs.readFile(file);
    const dictionary = parseDictionary(bytes);
    const read = readClip(dictionary, findClip(dictionary, clip));
    /* Корневое движение движок отдаёт только из копии словаря с переименованными дорожками 5 и 6 (`ycd-mover.js`); слои делаются уже из неё. */
    if (options.travel !== false && clipHasMover(read)) {
      const aliased = aliasMovers(bytes);
      if (aliased !== bytes) {
        folder ??= await fs.mkdtemp(
          path.join(os.tmpdir(), "astral-anim-layers-"),
        );
        const main = path.join(folder, "mover.ycd");
        await fs.writeFile(main, aliased);
        files[0] = main;
        aliasedFiles.add(main);
        bytes = aliased;
        copied = true;
      }
    }
    rates.length = 0;
    read.entries
      .slice(0, MAX_LAYERS)
      .forEach((entry) => rates.push(sensibleRate(entry.rate)));
    const count = Math.min(
      read.kind === "list" ? read.entries.length : 1,
      MAX_LAYERS,
    );
    for (let index = 1; index < count; index += 1) {
      folder ??= await fs.mkdtemp(
        path.join(os.tmpdir(), "astral-anim-layers-"),
      );
      const layer = path.join(folder, `layer-${index}.ycd`);
      await fs.writeFile(layer, layerDictionary(bytes, clip, index));
      files.push(layer);
      if (copied) aliasedFiles.add(layer);
    }
  } catch {
    /* Словарь не из тех, что разбирает писатель клипов: один слой, как у движка. */
  }
  return {
    files,
    rates,
    close: () => {
      for (const item of files) aliasedFiles.delete(item);
      return folder
        ? fs.rm(folder, { recursive: true, force: true }).catch(() => {})
        : Promise.resolve();
    },
  };
}

/** Кадр клипа из всех слоёв: поворот кости берёт первый слой, у которого она есть; мувер — первый слой с мувером. Слой, что не снялся, пропускается. */
export async function sampleLayers(files, clip, time, context, tools) {
  const [first, ...rest] = files;
  const base = await sampleClip(first, clip, time, context, tools);
  for (const file of rest) {
    const layer = await sampleClip(file, clip, time, context, tools).catch(
      () => null,
    );
    if (!layer) continue;
    for (const [tag, value] of layer.rotations)
      if (!base.rotations.has(tag)) base.rotations.set(tag, value);
    if (!base.hasMover && layer.hasMover) {
      base.mover = layer.mover;
      base.hasMover = true;
    }
    if (!base.hasTravel && layer.hasTravel) {
      base.travel = layer.travel;
      base.hasTravel = true;
    }
  }
  return base;
}

const fixedTags = (rotations) => [...rotations.keys()].sort((a, b) => a - b);

/**
 * Дорожка клипа: `{ name, fps, duration, frames, tags, rotations, mover }`. `rotations` — `Float32Array`, `frames × tags × 4`.
 * Клип дольше `TRACK_MAX_SECONDS` (или тяжелее `TRACK_MAX_BYTES`) берётся начальным отрезком (`truncated: true`) — окно проигрывает его по кругу.
 */
export async function bakeTrack(file, clip, context, tools, options = {}) {
  const layers = await openLayers(file, clip, { travel: options.travel });
  try {
    return await bakeLayers(layers.files, clip, context, tools, {
      rates: layers.rates,
    });
  } finally {
    await layers.close();
  }
}

/*
 * Кадры дорожки — кадры самой анимации, а между кадрами слоя — смешивание соседних, как в игре (3.11.2026, «персонаж дёргается»).
 *
 * Движок отдаёт кадр анимации без смешивания: номер кадра — целая часть `время / длительность × (кадров − 1)` (`frame_position` в `ycd_pose.rs`,
 * как `GetFramePosition` у CodeWalker без `interpolate`). Прежде дорожка снималась моментами `k / 30` от начала клипа, и это давало два рывка:
 *
 *  1. Шаг кадров у анимаций игры — 1/30 с, но длительность хранится во float, и `(кадров − 1) / длительность` выходит 29,99999…: момент `k / 30`
 *     попадал то в кадр `k`, то в `k − 1`. Кадр повторялся, а следующий шаг был двойным — у «Wasnt Me» (143 кадра, 4,7333 с) так в 12 % шагов
 *     каждой кости. Теперь кадр `k` снимается в середине своего промежутка, `(k + ½) × шаг`: целая часть там `k` при любой ошибке float.
 *  2. Слои эмоции идут с разной частотой: у «Wasnt Me» тело — 143 кадра за 4,733 с (30 в секунду), пальцы — 73 кадра за 4,8 с (15 в секунду). Кадр
 *     пальцев стоял два кадра дорожки подряд, а потом прыгал. Игра смешивает соседние кадры каждого слоя по доле времени между ними; здесь так же:
 *     поворот — по дуге, сдвиг — по прямой (`sampleBlended`).
 *
 * Частота дорожки — частота первого слоя, круг — от начала клипа до его конца в анимации (у клипа-отрезка длинной анимации — только его кадры, а
 * не вся анимация с застывшим концом). Кадр конца у зацикленных клипов равен первому и не повторяется: после последнего снова идёт первый.
 */
const HALF_FRAME = 0.5;
/* Момент позже любого клипа: движок зажимает его в конец клипа и называет время конца. */
const CLIP_END_PROBE = 1e6;
/* Доля между кадрами, которая считается целым кадром: ошибка float, а не смешивание (и не второй вызов движка). */
const WHOLE = 1e-3;

/** Сетка кадров слоя по его кадру в момент 0 и концу клипа: `{ frames, step, start, end }` (секунды анимации) или `null` без числа кадров. */
export function layerGrid(head, end) {
  const frames = head?.frames | 0;
  const duration = Number(head?.duration) || 0;
  if (frames < 2 || !(duration > 0)) return null;
  const start = Number(head.time) || 0;
  return {
    frames,
    step: duration / (frames - 1),
    start,
    end: Math.max(start, Number.isFinite(end) ? end : duration),
  };
}

/** Где момент клипа `offset` в кадрах анимации слоя: целый кадр и доля до следующего, не дальше конца клипа. */
export function framePosition(grid, offset) {
  const last = Math.min(grid.frames - 1, grid.end / grid.step);
  let position = Math.min(last, Math.max(0, (grid.start + offset) / grid.step));
  const near = Math.round(position);
  if (Math.abs(position - near) < WHOLE) position = near;
  const frame = Math.floor(position);
  return { frame, alpha: position - frame };
}

/** Момент клипа, в который движок отдаёт кадр `frame` слоя: середина промежутка кадра (у последнего движок сам зажимает момент в конец клипа). */
export function frameMoment(grid, frame) {
  return Math.max(0, (frame + HALF_FRAME) * grid.step - grid.start);
}

/** Кадры, которые проигрывает клип первого слоя: `{ fps, first, count }` — `count` кадров анимации от кадра `first`, не дольше `TRACK_MAX_SECONDS` и не больше `maxFrames` (память); `truncated` — клип обрезан. */
export function clipFrames(grid, maxFrames = Infinity) {
  const first = Math.max(0, Math.ceil(grid.start / grid.step - WHOLE));
  const last = Math.min(
    grid.frames - 1,
    Math.floor(grid.end / grid.step + WHOLE),
  );
  const limit = Math.max(
    2,
    Math.min(Math.floor(TRACK_MAX_SECONDS / grid.step), Math.floor(maxFrames)),
  );
  const whole = last - first;
  return {
    fps: 1 / grid.step,
    first,
    count: Math.max(2, Math.min(limit, whole)),
    ...(whole > limit ? { truncated: true } : {}),
  };
}

function slerp(a, b, alpha) {
  let [bx, by, bz, bw] = b;
  let cosine = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (cosine < 0) {
    cosine = -cosine;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let scaleA = 1 - alpha;
  let scaleB = alpha;
  if (cosine < 0.9995) {
    const angle = Math.acos(Math.min(1, cosine));
    const sine = Math.sin(angle);
    scaleA = Math.sin((1 - alpha) * angle) / sine;
    scaleB = Math.sin(alpha * angle) / sine;
  }
  const out = [
    a[0] * scaleA + bx * scaleB,
    a[1] * scaleA + by * scaleB,
    a[2] * scaleA + bz * scaleB,
    a[3] * scaleA + bw * scaleB,
  ];
  const length = Math.hypot(...out) || 1;
  return out.map((value) => value / length);
}

/** Кадр между двумя кадрами слоя на доле `alpha`: повороты — по дуге, сдвиг мувера — по прямой. */
export function blendSamples(from, to, alpha) {
  const rotations = new Map();
  for (const [tag, value] of from.rotations) {
    const next = to.rotations.get(tag);
    rotations.set(tag, next ? slerp(value, next, alpha) : value);
  }
  const mover = [
    ...slerp(from.mover.slice(0, 4), to.mover.slice(0, 4), alpha),
    ...[4, 5, 6].map(
      (at) => from.mover[at] + (to.mover[at] - from.mover[at]) * alpha,
    ),
  ];
  const travel = [
    ...slerp(from.travel.slice(0, 4), to.travel.slice(0, 4), alpha),
    ...[4, 5, 6].map(
      (at) => from.travel[at] + (to.travel[at] - from.travel[at]) * alpha,
    ),
  ];
  return {
    ...from,
    rotations,
    mover,
    hasMover: from.hasMover || to.hasMover,
    travel,
    hasTravel: from.hasTravel || to.hasTravel,
  };
}

/** Поза слоя в момент клипа `offset`, как в игре: два соседних кадра его анимации и доля между ними. Без сетки — кадр движка как есть. */
export async function sampleBlended(file, clip, offset, grid, context, tools) {
  if (!grid) return sampleClip(file, clip, offset, context, tools);
  const { frame, alpha } = framePosition(grid, offset);
  const from = await sampleClip(
    file,
    clip,
    frameMoment(grid, frame),
    context,
    tools,
  );
  if (alpha <= 0) return from;
  const to = await sampleClip(
    file,
    clip,
    frameMoment(grid, frame + 1),
    context,
    tools,
  );
  return blendSamples(from, to, alpha);
}

/** Слои с их сетками: слой, что не снялся, пропускается (первый — обязателен). */
async function openGrids(files, clip, context, tools, rates = []) {
  const layers = [];
  for (const [index, file] of files.entries()) {
    try {
      const head = await sampleClip(file, clip, 0, context, tools);
      const tail = await sampleClip(
        file,
        clip,
        CLIP_END_PROBE,
        context,
        tools,
      ).catch(() => null);
      layers.push({
        file,
        head,
        grid: layerGrid(head, tail?.time),
        rate: sensibleRate(rates[index]),
      });
    } catch (error) {
      if (index === 0) throw error;
    }
  }
  return layers;
}

/** Кадр клипа из всех слоёв в момент `offset`: поворот кости — у первого слоя, где она есть; мувер — у первого слоя с мувером. */
async function sampleGrids(layers, clip, offset, context, tools) {
  const [first, ...rest] = layers;
  const base = await sampleBlended(
    first.file,
    clip,
    offset,
    first.grid,
    context,
    tools,
  );
  for (const layer of rest) {
    /* `offset` — секунды анимации первого слоя; у каждого слоя время анимации идёт со своей скоростью. */
    const sample = await sampleBlended(
      layer.file,
      clip,
      (offset * layer.rate) / first.rate,
      layer.grid,
      context,
      tools,
    ).catch(() => null);
    if (!sample) continue;
    for (const [tag, value] of sample.rotations)
      if (!base.rotations.has(tag)) base.rotations.set(tag, value);
    if (!base.hasMover && sample.hasMover) {
      base.mover = sample.mover;
      base.hasMover = true;
    }
    if (!base.hasTravel && sample.hasTravel) {
      base.travel = sample.travel;
      base.hasTravel = true;
    }
  }
  return base;
}

/** Форма дорожки по открытым слоям: теги, сетка, число кадров, скорость, корневое движение; момент кадра. Нет движения костей — отказ. */
function trackShape(layers, options = {}) {
  const tags = fixedTags(
    new Map(layers.flatMap((layer) => [...layer.head.rotations])),
  );
  if (!tags.length)
    throw Object.assign(new Error("В клипе нет движения костей."), {
      code: "ANIMATION_EMPTY",
    });
  const grid = layers[0].grid;
  /* Нет числа кадров (старый ответ движка) — прежняя сетка по 1/30 с от начала клипа. */
  /* Корневое движение: ещё `7 × 4` байт на кадр, если оно у клипа есть. */
  const hasTravel = layers.some((layer) => layer.head.hasTravel);
  const frameBytes = tags.length * 16 + 28 + (hasTravel ? 28 : 0);
  const span = grid
    ? clipFrames(
        grid,
        Math.floor((options.maxBytes ?? TRACK_MAX_BYTES) / frameBytes),
      )
    : null;
  /* Скорость клипа: кадр анимации идёт `1 / (частота анимации × скорость)` секунд; длительность круга — кадры ÷ частоту. */
  const rate = layers[0].rate;
  const fps = (span ? span.fps : TRACK_FPS) * rate;
  const head = layers[0].head;
  const frames = span
    ? span.count
    : Math.max(
        2,
        Math.ceil(
          Math.max(0.2, Math.min(head.duration || 1, TRACK_MAX_SECONDS)) *
            TRACK_FPS,
        ),
      );
  /* Момент кадра дорожки от начала клипа: у первого слоя — ровно его кадр (`framePosition` округлит ошибку float), у остальных — смешивание. */
  const timeOf = (index) =>
    span
      ? Math.max(0, (span.first + index) * grid.step - grid.start)
      : index / TRACK_FPS;
  return { tags, grid, span, hasTravel, rate, fps, head, frames, timeOf };
}

/** Дорожка из кадров (по одному на кадр дорожки, в виде `sampleGrids`): повороты, мувер и корневое движение в `Float32Array`, пропуски — прежним кадром или кадром первой пробы. */
function packTrack(shape, layers, samples) {
  const { tags, hasTravel, rate, fps, head, frames, span } = shape;
  const slot = new Map(tags.map((tag, index) => [tag, index]));
  const rotations = new Float32Array(frames * tags.length * 4);
  const mover = new Float32Array(frames * 7);
  const travel = hasTravel ? new Float32Array(frames * 7) : null;
  const fallback = new Map(
    layers.flatMap((layer) => [...layer.head.rotations]).reverse(),
  );
  let previous = null;
  samples.forEach((sample, frame) => {
    for (const [tag, at] of slot) {
      const value =
        sample.rotations.get(tag) ||
        previous?.rotations.get(tag) ||
        fallback.get(tag);
      rotations.set(value, (frame * tags.length + at) * 4);
    }
    mover.set(sample.mover, frame * 7);
    travel?.set(sample.travel, frame * 7);
    previous = sample;
  });
  return {
    fps,
    duration: frames / fps,
    clipDuration: head.duration,
    frames,
    tags,
    rotations,
    mover,
    ...(travel ? { travel } : {}),
    ...(rate !== 1 ? { rate } : {}),
    ...(span?.truncated ? { truncated: true } : {}),
  };
}

/**
 * Дорожка из уже открытых слоёв (`openLayers`): `files[0]` — словарь клипа, дальше — его следующие записи. Путь одной командой движка (`animation-track-engine.js`, за выключателем
 * `ASTRAL_RUST_TRACK`) и сетка вызовов `sample-anim-pose` дают одну и ту же дорожку до байта; путь движка берётся, только когда команда отдаёт всё, что сетка читает из
 * ответов: корневое движение (копия словаря `aliasMovers`) просится у команды полем `travel`, а движок старше этого поля (`ATK1` в ответ) такую дорожку отдаёт сетке без
 * выключения пути (`TRACK_DECLINED`, `stats.declined = "no-travel"`). `tools.trackStats` — если задан, счётчики пути (`via`, вызовы, мс).
 */
export async function bakeLayers(files, clip, context, tools, options = {}) {
  const stats = tools?.trackStats ?? null;
  if (stats) stats.via = "grid";
  if (trackEngineWanted(tools)) {
    try {
      const track = await bakeLayersViaEngine(
        files,
        clip,
        context,
        tools,
        options,
        stats,
      );
      if (stats) stats.via = "engine";
      return track;
    } catch (error) {
      if (error?.code === "TRACK_DECLINED") {
        /* Движок не звали: команда не отдаёт то, что нужно этой дорожке. */
        if (stats) stats.declined = error.reason;
      } else {
        /* Любая беда движка (команды нет, отказ, не тот ответ, слой, что не снялся) — прежний путь: он повторит и отказ слоя тем же исключением, что и раньше. */
        const switchedOff = noteTrackFailure(error);
        if (stats)
          Object.assign(stats, {
            fallbacks: 1,
            error: String(error?.code || error?.name || "error"),
            switchedOff,
          });
      }
    }
  }
  const counted = stats
    ? {
        ...tools,
        native: (...call) => (
          (stats.calls = (stats.calls || 0) + 1),
          tools.native(...call)
        ),
      }
    : tools;
  const began = performance.now();
  try {
    return await bakeLayersByGrid(files, clip, context, counted, options);
  } finally {
    if (stats) stats.gridMs = performance.now() - began;
  }
}

/** Прежний путь: сетка вызовов `sample-anim-pose`, пулом по `WORKERS`. */
async function bakeLayersByGrid(files, clip, context, tools, options) {
  const layers = await openGrids(files, clip, context, tools, options.rates);
  const shape = trackShape(layers, options);
  const samples = await pool(
    Array.from({ length: shape.frames }, (_, index) => index),
    WORKERS,
    (index) => sampleGrids(layers, clip, shape.timeOf(index), context, tools),
  );
  return packTrack(shape, layers, samples);
}

/** Отказ пути движка для этой дорожки: сдвиг корневого движения команда не отдаёт (движок старее правки `travel`). Движок не виноват: ни выключения пути, ни записи об ошибке. */
const noTravelDecline = () =>
  Object.assign(
    new Error("Движок не отдаёт сдвиг корневого движения: сетка."),
    {
      code: "TRACK_DECLINED",
      reason: "no-travel",
    },
  );

/** Пробы слоёв одной командой: слой, что не открылся или не снял кадр момента 0, у первого — отказ (сетка повторит его своим исключением), у остальных — пропуск. */
async function openGridsViaEngine(
  files,
  clip,
  context,
  tools,
  rates,
  stats,
  wantTravel,
) {
  const began = performance.now();
  const probe = await callTrack(
    tools,
    context,
    {
      clip,
      layers: files.map((input) => ({
        input,
        times: ["0", String(CLIP_END_PROBE)],
      })),
    },
    { timings: Boolean(stats?.wantTimings), travel: wantTravel },
  );
  if (stats)
    Object.assign(stats, {
      calls: (stats.calls || 0) + 1,
      probeMs: performance.now() - began,
      engineProbe: probe.timings,
    });
  /* Просили сдвиг, а движок дал кадры без него (старее правки `travel`): эта дорожка — сеткой, путь остаётся; запоминается, чтобы следующие такие дорожки не зондировали зря. */
  if (wantTravel && probe.travel === false) {
    noteNoTravel();
    throw noTravelDecline();
  }
  const layers = [];
  for (const [index, file] of files.entries()) {
    const layer = probe.layers[index];
    try {
      if (!layer || layer.error)
        throw Object.assign(
          new Error(layer?.error?.message || "Слой не открылся."),
          { code: layer?.error?.code },
        );
      /* Слой из копии словаря `aliasMovers`: кость `MOVER_ALIAS` — корневое движение (как в `sampleClip`). */
      const copy = aliasedFiles.has(file);
      const head = trackSample(layer, 0, null, { copy });
      const tail = (() => {
        try {
          return trackSample(layer, 1, null, { copy });
        } catch {
          return null;
        }
      })();
      layers.push({
        file,
        copy,
        head,
        grid: layerGrid(head, tail?.time),
        rate: sensibleRate(rates[index]),
      });
    } catch (error) {
      if (index === 0) throw error;
    }
  }
  return layers;
}

/**
 * Дорожка по ответу `sample-anim-track`: моменты кадров считает тот же код, что у сетки вызовов (`framePosition`, `frameMoment`, скорость слоёв), кадры слоёв собираются в тех же объектах,
 * дальше — прежние смешивание, слияние и упаковка. Корневое движение (копия словаря `aliasMovers`: его тег `MOVER_ALIAS` — не кость, а дорожки 5 и 6, с поворотом и сдвигом) просится
 * у команды полем `travel` (поворот приходит среди `tags`, сдвиг — полем, контейнер `ATK2`) и собирается кадром, как `sampleClip` для копии. Движок без поля такую дорожку отдаёт сетке
 * (`TRACK_DECLINED`, `no-travel`).
 */
async function bakeLayersViaEngine(
  files,
  clip,
  context,
  tools,
  options,
  stats,
) {
  /* Есть слои из копии словаря с корневым движением — у команды просится сдвиг. Движок старше поля уже отвечал без него: эти дорожки сразу сеткой, без пробы. */
  const wantTravel = files.some((file) => aliasedFiles.has(file));
  if (wantTravel && trackEngineNoTravel()) throw noTravelDecline();
  const rates = options.rates ?? [];
  const layers = await openGridsViaEngine(
    files,
    clip,
    context,
    tools,
    rates,
    stats,
    wantTravel,
  );
  const shape = trackShape(layers, options);
  const first = layers[0];
  /* Моменты кадров дорожки по слоям (строки, как их получает `--time`) и номера нужных записей для каждого кадра; у остальных слоёв время анимации идёт со своей скоростью, как в `sampleGrids`. */
  const moments = layers.map(() => []);
  const plan = [];
  for (let index = 0; index < shape.frames; index += 1) {
    const offset = shape.timeOf(index);
    plan.push(
      layers.map((layer, at) => {
        const list = moments[at];
        const time = at === 0 ? offset : (offset * layer.rate) / first.rate;
        if (!layer.grid) {
          list.push(String(Number(time) || 0));
          return { from: list.length - 1, to: -1, alpha: 0 };
        }
        const { frame, alpha } = framePosition(layer.grid, time);
        list.push(String(Number(frameMoment(layer.grid, frame)) || 0));
        const from = list.length - 1;
        if (alpha <= 0) return { from, to: -1, alpha: 0 };
        list.push(String(Number(frameMoment(layer.grid, frame + 1)) || 0));
        return { from, to: list.length - 1, alpha };
      }),
    );
  }
  const began = performance.now();
  const answer = await callTrack(
    tools,
    context,
    {
      clip,
      layers: layers.map((layer, at) => ({
        input: layer.file,
        times: moments[at],
      })),
    },
    { binary: true, timings: Boolean(stats?.wantTimings), travel: wantTravel },
  );
  if (wantTravel && answer.travel !== true) {
    noteNoTravel();
    throw noTravelDecline();
  }
  if (stats)
    Object.assign(stats, {
      calls: (stats.calls || 0) + 1,
      framesMs: performance.now() - began,
      engineFrames: answer.timings,
      moments: moments.reduce((sum, list) => sum + list.length, 0),
    });
  const assembleAt = performance.now();
  /* Кадр слоя в момент клипа, как `sampleBlended`: целый кадр анимации или смешивание двух соседних. */
  const blended = (data, step, copy) => {
    const from = trackSample(data, step.from, answer.view, { copy });
    if (step.alpha <= 0) return from;
    return blendSamples(
      from,
      trackSample(data, step.to, answer.view, { copy }),
      step.alpha,
    );
  };
  const samples = plan.map((steps) => {
    /* Первый слой — обязателен: любой его отказ повторит сетка тем же исключением. Остальные при отказе в этом кадре пропускаются, как `catch` в `sampleGrids`. */
    if (answer.layers[0]?.error)
      throw Object.assign(new Error(answer.layers[0].error.message), {
        code: answer.layers[0].error.code,
      });
    const base = blended(answer.layers[0], steps[0], layers[0].copy);
    for (let at = 1; at < layers.length; at += 1) {
      let sample = null;
      try {
        if (!answer.layers[at]?.error)
          sample = blended(answer.layers[at], steps[at], layers[at].copy);
      } catch {
        sample = null;
      }
      if (!sample) continue;
      for (const [tag, value] of sample.rotations)
        if (!base.rotations.has(tag)) base.rotations.set(tag, value);
      if (!base.hasMover && sample.hasMover) {
        base.mover = sample.mover;
        base.hasMover = true;
      }
      if (!base.hasTravel && sample.hasTravel) {
        base.travel = sample.travel;
        base.hasTravel = true;
      }
    }
    return base;
  });
  const track = packTrack(shape, layers, samples);
  if (stats) stats.assembleMs = performance.now() - assembleAt;
  return track;
}

/** Одна поза клипа в «ключевой» момент — для плитки сетки. */
export async function bakePose(file, clip, context, tools) {
  const layers = await openLayers(file, clip, { travel: false });
  try {
    return await poseOfLayers(layers.files, clip, context, tools);
  } finally {
    await layers.close();
  }
}

async function poseOfLayers(files, clip, context, tools) {
  const first = await sampleLayers(files, clip, 0, context, tools);
  if (!first.rotations.size)
    throw Object.assign(new Error("В клипе нет движения костей."), {
      code: "ANIMATION_EMPTY",
    });
  /* Ключевой кадр — не начало (там обычно стойка «смирно»), а чуть меньше середины, но не позже трёх секунд. */
  const at = Math.min((first.duration || 0) * 0.42, 3);
  const sample =
    at > 0.05 ? await sampleLayers(files, clip, at, context, tools) : first;
  const tags = fixedTags(first.rotations);
  const rotations = new Float32Array(tags.length * 4);
  tags.forEach((tag, index) =>
    rotations.set(
      sample.rotations.get(tag) || first.rotations.get(tag),
      index * 4,
    ),
  );
  return {
    duration: first.duration,
    tags,
    rotations,
    mover: Float32Array.from(sample.mover),
  };
}

/** Строка счётчиков дорожки в `<кэш анимаций>/timings.jsonl` (`ASTRAL_TRACK_TIMINGS=1`): путь (`engine` или `grid`), вызовы движка, время по этапам, ответ движка. */
export async function writeTrackTimings(
  stateDir,
  gameRoot,
  { clip, track, stats, totalMs },
) {
  const round = (value) =>
    Number.isFinite(value) ? Math.round(value) : undefined;
  const { wantTimings: _wanted, engineProbe, engineFrames, ...own } = stats;
  const line = {
    at: Date.now(),
    pid: process.pid,
    clip,
    frames: track.frames,
    tags: track.tags.length,
    totalMs: round(totalMs),
    ...Object.fromEntries(
      Object.entries(own).map(([key, value]) => [
        key,
        typeof value === "number" && /Ms$/.test(key) ? round(value) : value,
      ]),
    ),
    ...(engineProbe ? { engineProbe } : {}),
    ...(engineFrames ? { engineFrames } : {}),
  };
  const file = path.join(animationsFolder(stateDir, gameRoot), "timings.jsonl");
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, `${JSON.stringify(line)}\n`);
}

/* Дорожка на диске: заголовок JSON и два массива — то, что вернётся в окно, без повторного снятия. */
const cacheFile = (stateDir, gameRoot, key) =>
  path.join(
    animationsFolder(stateDir, gameRoot),
    "tracks",
    `${TRACK_BUILD}-${sha(key)}.bin`,
  );

export async function readCachedTrack(stateDir, gameRoot, key) {
  const bytes = await fs
    .readFile(cacheFile(stateDir, gameRoot, key))
    .catch(() => null);
  if (!bytes || bytes.length < 8) return null;
  const headLength = bytes.readUInt32LE(0);
  const head = JSON.parse(bytes.subarray(4, 4 + headLength).toString("utf8"));
  const body = bytes.subarray(4 + headLength);
  const rotationBytes = head.frames * head.tags.length * 16;
  const moverBytes = head.frames * 28;
  const travelBytes = head.hasTravel ? head.frames * 28 : 0;
  if (body.length !== rotationBytes + moverBytes + travelBytes) return null;
  const copy = body.buffer.slice(
    body.byteOffset,
    body.byteOffset + body.length,
  );
  return {
    ...head,
    rotations: new Float32Array(copy, 0, rotationBytes / 4),
    mover: new Float32Array(copy, rotationBytes, head.frames * 7),
    ...(head.hasTravel
      ? {
          travel: new Float32Array(
            copy,
            rotationBytes + moverBytes,
            head.frames * 7,
          ),
        }
      : {}),
  };
}

export async function writeCachedTrack(stateDir, gameRoot, key, track) {
  const head = Buffer.from(
    JSON.stringify({
      fps: track.fps,
      duration: track.duration,
      clipDuration: track.clipDuration,
      frames: track.frames,
      tags: track.tags,
      ...(track.rate && track.rate !== 1 ? { rate: track.rate } : {}),
      ...(track.truncated ? { truncated: true } : {}),
      ...(track.travel ? { hasTravel: true } : {}),
    }),
  );
  const length = Buffer.alloc(4);
  length.writeUInt32LE(head.length);
  const file = cacheFile(stateDir, gameRoot, key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await atomicWrite(
    file,
    Buffer.concat([
      length,
      head,
      Buffer.from(
        track.rotations.buffer,
        track.rotations.byteOffset,
        track.rotations.byteLength,
      ),
      Buffer.from(
        track.mover.buffer,
        track.mover.byteOffset,
        track.mover.byteLength,
      ),
      ...(track.travel
        ? [
            Buffer.from(
              track.travel.buffer,
              track.travel.byteOffset,
              track.travel.byteLength,
            ),
          ]
        : []),
    ]),
  );
}
