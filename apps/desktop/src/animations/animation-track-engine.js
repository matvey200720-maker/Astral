/*
 * Дорожка клипа одной командой движка (этап 3 «Astral быстрее», `docs/perf/speed-3d-rust/sample-anim-track-engine.md`): вместо сетки из сотен вызовов `sample-anim-pose`
 * (`animation-track.js`, 1204 вызова на клип в 16 с с двумя слоями) оболочка зовёт `sample-anim-track` дважды — пробы слоёв и кадры всех моментов — и собирает дорожку
 * из ответа тем же кодом, что и прежняя сетка: сетка кадров, смешивание, слияние слоёв и упаковка остаются в `animation-track.js` без изменений, поэтому дорожка и файл
 * её кэша совпадают с прежними до байта. Здесь — только выключатель, вызов команды и разбор ответа.
 *
 * Как зовётся движок. Тем же путём, что `sample-anim-pose`: `tools.native(команда, вход, context)` — в приложении это мост потока чтения игры к резидентному движку главного
 * процесса (`game-read-host.js`), в песочнице (`apps/web/qa-animations.js`) — тот же `callNativeEngine` в процессе dev-сервера. Свой второй процесс движка ради дорожек
 * не поднимается (у приложения он уже есть). Запрос идёт файлом: параметры моста (`cleanString`) ограничены 4096 знаками, а список моментов в них не помещается;
 * контейнер с кадрами (`ATK1`, а с корневым движением `ATK2`) движок кладёт файлом в папку вызова (`store: "file"`, `--assets-dir`).
 *
 * Выключатель. По умолчанию выключен: `ASTRAL_RUST_TRACK=1` (`on`, `true`, `yes`) в окружении процесса, где идёт чтение (поток чтения игры наследует окружение приложения,
 * песочница — окружение dev-сервера); `tools.trackEngine` (`true`/`false`) важнее окружения — для проверок. Команды в движке нет (готовый `prebuilt` её не знает) или он
 * не собран — первая же ошибка «Unsupported native command» (или «not built») выключает путь до конца сеанса чтения без шума; любая другая ошибка команды — эта дорожка
 * строится прежней сеткой вызовов.
 *
 * Корневое движение. Копия словаря `aliasMovers` (`ycd-mover.js`) отдаёт дорожки 5 и 6 костью `MOVER_ALIAS` (0xFFFD): её поворот команда отдаёт среди `tags` и `rotations`,
 * а сдвиг — полем `travel` (запрос `travel: true`; ответ с контейнером `ATK2` или записями JSON с ключом `travel`). Оболочка собирает кадр как `sampleClip` для копии: поворот
 * кости — в `travel`, не в кости, сдвиг из поля. Движок старше этой правки поле игнорирует и отвечает `ATK1` (или записью без ключа `travel`) — по этому знаку оболочка видит,
 * что сдвига не дали, и дорожка строится сеткой (`TRACK_DECLINED`); путь на сеанс это не выключает, а запомненное «сдвига нет» (`trackEngineNoTravel`) избавляет следующие дорожки
 * с корневым движением от лишней пробы.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MOVER_ALIAS } from "./ycd-mover.js";

export const TRACK_ENGINE_COMMAND = "sample-anim-track";
const WORDS_ON = new Set(["1", "on", "true", "yes"]);
/* Движок не знает команды (прежний `prebuilt`) или его нет, либо мост его выключил: дальше сеанс идёт сеткой. */
const NO_ENGINE = /Unsupported native command|is not built|is switched off/i;
const HEX64 = /^[0-9a-f]{64}$/;
const ZERO_TRAVEL = Object.freeze([0, 0, 0, 1, 0, 0, 0]);

const unwrap = (answer) => answer?.result ?? answer ?? {};

/** Включён ли путь одной командой: по умолчанию нет. */
export function trackEngineEnabled(env = process.env) {
  return WORDS_ON.has(
    String(env?.ASTRAL_RUST_TRACK ?? "")
      .trim()
      .toLowerCase(),
  );
}

/* Состояние сеанса чтения (поток чтения игры живёт, пока им пользуются; новый поток — новая проба). */
let off = null;
let noTravel = false;

/** Почему путь выключен на сеанс (`"no-command"` и т. п.) или `null`. */
export const trackEngineOff = () => off;

/** Движок ответил на просьбу о сдвиге корневого движения без него (старее правки `travel`): такие дорожки идут сеткой, остальные — командой. */
export const trackEngineNoTravel = () => noTravel;

/** Запомнить: движок сдвига не отдаёт. */
export function noteNoTravel() {
  noTravel = true;
}

/** Для проверок: забыть выключение и «сдвига нет». */
export function resetTrackEngine() {
  off = null;
  noTravel = false;
}

/** Идти ли этой дорожке движком: выключатель, мост (`tools.native`), не выключен ли путь на сеанс. */
export function trackEngineWanted(tools, env = process.env) {
  if (off || typeof tools?.native !== "function") return false;
  return tools.trackEngine === undefined
    ? trackEngineEnabled(env)
    : tools.trackEngine === true;
}

/** Ошибка команды: «команды нет» выключает путь на сеанс (`true`), остальное — только эту дорожку (`false`). */
export function noteTrackFailure(error) {
  if (!NO_ENGINE.test(String(error?.message ?? error ?? ""))) return false;
  off = /not built|switched off/i.test(String(error?.message))
    ? "no-engine"
    : "no-command";
  return true;
}

function failure(code, message) {
  return Object.assign(new Error(message), { code });
}

/**
 * Контейнер `ATK1` или `ATK2` → `{ head, version, at(sample) }` без копий (повороты и теги — виды над байтами). `ATK2` — с корневым движением: в записи головы `hasTravel`, в теле три
 * числа сдвига сразу за мувером, перед поворотами.
 */
export function parseTrackContainer(bytes) {
  const aligned = bytes.byteOffset % 8 === 0 ? bytes : new Uint8Array(bytes);
  const buffer = aligned.buffer;
  const base = aligned.byteOffset;
  const known =
    aligned.length >= 8 &&
    aligned[0] === 0x41 &&
    aligned[1] === 0x54 &&
    aligned[2] === 0x4b;
  const version = known ? aligned[3] - 0x30 : 0;
  if (version !== 1 && version !== 2)
    throw failure("TRACK_BAD_CONTAINER", "Это не контейнер ATK1 или ATK2.");
  const view = new DataView(buffer, base, aligned.length);
  const headLength = view.getUint32(4, true);
  if (headLength % 8 !== 0 || 8 + headLength > aligned.length)
    throw failure(
      "TRACK_BAD_CONTAINER",
      `Голова контейнера ATK${version} не помещается.`,
    );
  const head = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buffer, base + 8, headLength)),
  );
  const body = base + 8 + headLength;
  const pad8 = (count) => (count + 7) & ~7;
  const end = aligned.length - 8 - headLength;
  const shift = version === 2 ? 3 : 0;
  return {
    head,
    version,
    /** Запись кадра из головы (`{ frame, count, hasMover, [hasTravel,] at }`): теги `u16`, мувер, у `ATK2` сдвиг корня и повороты `f64`. */
    at(sample) {
      const tagBytes = 2 * sample.count;
      const numbers = 7 + shift + 4 * sample.count;
      if (
        sample.at < 0 ||
        sample.at % 8 !== 0 ||
        sample.at + pad8(tagBytes) + 8 * numbers > end
      )
        throw failure(
          "TRACK_BAD_CONTAINER",
          `Запись кадра выходит за контейнер ATK${version}.`,
        );
      const tags = new Uint16Array(buffer, body + sample.at, sample.count);
      const values = new Float64Array(
        buffer,
        body + sample.at + pad8(tagBytes),
        numbers,
      );
      return {
        tags,
        mover: sample.hasMover ? values.subarray(0, 7) : null,
        travel:
          version === 2 && sample.hasTravel ? values.subarray(7, 10) : null,
        rotations: values.subarray(7 + shift),
      };
    },
  };
}

/**
 * Дал ли движок корневое движение (его просили): у контейнера — знак `ATK2`, у JSON — ключ `travel` в записи кадра. `null` — понять нельзя (в ответе нет ни одного кадра без отказа):
 * это не «движок старый», а слой, что не открылся, и решает тот отказ слоя.
 */
function givesTravel(layers, view) {
  if (view) return view.version === 2;
  let seen = false;
  for (const layer of layers)
    for (const record of layer?.samples ?? []) {
      if (record.error) continue;
      if (Object.hasOwn(record, "travel")) return true;
      seen = true;
    }
  return seen ? false : null;
}

/**
 * Одна команда движка. `body` — `{ clip, layers: [{ input, times: [строки] }] }`; `binary` — кадры контейнером (`ATK1` или `ATK2`, разбирается тут же), иначе JSON; `travel` — попросить
 * у движка сдвиг корневого движения (поле `travel` запроса). Возвращает `{ layers, view, timings, travel }`: у слоя — `{ frames, duration, times, slots, samples }` или `{ error }`; `view` —
 * разобранный контейнер (у JSON — `null`); `travel` — отдал ли движок сдвиг: `true`, `false` (движок старее правки: `ATK1` или запись без ключа) или `null` (не понять: кадров без отказа нет); `false`, если его не просили.
 */
export async function callTrack(
  tools,
  context,
  body,
  { binary = false, timings = false, travel = false } = {},
) {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "astral-anim-track-"));
  try {
    const requestFile = path.join(work, "request.json");
    const assetsDir = path.join(work, "assets");
    await fs.writeFile(
      requestFile,
      JSON.stringify({
        ...body,
        format: binary ? "binary" : "json",
        ...(binary ? { store: "file" } : {}),
        ...(timings ? { timings: true } : {}),
        ...(travel ? { travel: true } : {}),
      }),
    );
    const answer = unwrap(
      await tools.native(
        TRACK_ENGINE_COMMAND,
        { request: requestFile, assetsDir },
        context,
      ),
    );
    if (!binary) {
      if (!Array.isArray(answer.layers))
        throw failure("TRACK_BAD_REPLY", "Движок не вернул слои дорожки.");
      return {
        layers: answer.layers,
        view: null,
        timings: answer.timings ?? null,
        travel: travel ? givesTravel(answer.layers, null) : false,
      };
    }
    const { sha256, bytes } = answer.container ?? {};
    if (
      typeof sha256 !== "string" ||
      !HEX64.test(sha256) ||
      !Number.isInteger(bytes) ||
      bytes < 8
    )
      throw failure("TRACK_BAD_REPLY", "Движок не назвал контейнер дорожки.");
    const file = await fs
      .readFile(path.join(assetsDir, sha256))
      .catch(() => null);
    if (!file || file.length !== bytes)
      throw failure(
        "TRACK_BAD_REPLY",
        "Контейнер дорожки не найден в папке вызова или не того размера.",
      );
    const view = parseTrackContainer(
      new Uint8Array(file.buffer, file.byteOffset, file.length),
    );
    if (!Array.isArray(view.head?.layers))
      throw failure("TRACK_BAD_REPLY", "В контейнере дорожки нет слоёв.");
    return {
      layers: view.head.layers,
      view,
      timings: answer.timings ?? null,
      travel: travel ? givesTravel(view.head.layers, view) : false,
    };
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Кадр слоя в виде, который возвращал `sampleClip` (`animation-track.js`): `{ duration, frames, time, rotations: Map, mover, hasMover, travel, hasTravel }`. Объект и `Map` — новые на каждый вызов:
 * `sampleGrids` дописывает в них кости других слоёв. `record` — запись из `samples` (JSON) или из головы контейнера (с `view`).
 *
 * `copy` — слой читается из копии словаря `aliasMovers`: тогда кость `MOVER_ALIAS` — корневое движение, как в `sampleClip`: её поворот уходит из `rotations` в `travel[0..3]`, сдвиг из поля
 * `travel` записи — в `travel[4..6]`, `hasTravel` — есть ли поворот или сдвиг. Без `copy` (и у движка, что сдвига не отдаёт) кость — обычная кость, `travel` пустой.
 */
export function trackSample(layer, index, view, { copy = false } = {}) {
  const record = layer.samples[layer.slots[index]];
  if (!record || record.error)
    throw Object.assign(
      new Error(record?.error?.message || "Кадр не снялся."),
      { code: record?.error?.code },
    );
  const parts = view
    ? view.at(record)
    : {
        tags: record.tags,
        mover: record.mover,
        travel: record.travel ?? null,
        rotations: record.rotations,
      };
  const rotations = new Map();
  const travel = [...ZERO_TRAVEL];
  let hasTravel = false;
  for (let at = 0; at < parts.tags.length; at += 1) {
    const value = [
      parts.rotations[at * 4],
      parts.rotations[at * 4 + 1],
      parts.rotations[at * 4 + 2],
      parts.rotations[at * 4 + 3],
    ].map(Number);
    if (copy && parts.tags[at] === MOVER_ALIAS) {
      for (let part = 0; part < 4; part += 1) travel[part] = value[part];
      hasTravel = true;
    } else rotations.set(parts.tags[at], value);
  }
  if (copy && parts.travel) {
    for (let part = 0; part < 3; part += 1)
      travel[4 + part] = Number(parts.travel[part]);
    hasTravel = true;
  }
  return {
    duration: Number(layer.duration) || 0,
    frames: Number(layer.frames) || 0,
    time: Number(layer.times[index]) || 0,
    rotations,
    mover: parts.mover
      ? Array.from(parts.mover, Number)
      : [0, 0, 0, 1, 0, 0, 0],
    hasMover: parts.mover != null,
    travel,
    hasTravel,
  };
}
