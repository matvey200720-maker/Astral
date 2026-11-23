/*
 * Вещи проектов: место вещей GTA Online под именами GTA5RP и картинки CDN.
 *
 * До 11.10.2026 (задача 2 ТЗ 06.10.2026) Desktop брал «Серверные файлы»
 * nightz и вики GTA5RP с сайтов в рантайме: 4–6 МБ на сервер и пол, до
 * минуты ожидания, без сети — пусто. С задачи 9 ТЗ 10.10.2026 (вечер) это
 * база Astral (`@modovik/clothing/server-base`, снимает
 * `scripts/import-server-clothing.mjs`), и вещи серверов окно берёт из неё
 * само — с сайтов в рантайме не грузится ничего.
 *
 * Здесь остаётся одно, чего окну не сделать: вещи вики GTA5RP без файла на
 * сервере — это вещи GTA Online под именами проекта, и место в игре им даёт
 * порядок вещей игры игрока (`game-clothing-order.js`, `vanillaAssortment`).
 *
 * Картинки (`readProjectPicture`) — по-прежнему только с CDN проектов, с
 * потолком и кэшем на диске: ими рисуются штатные жилеты GTA Online в
 * «Замене» брони. У вещей серверов из базы картинок нет.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { COMPONENTS } from "@modovik/clothing/taxonomy";
import { clothingOrder } from "./game-clothing-order.js";
import {
  PROJECT_SERVERS,
  pictureAllowed,
  vanillaAssortment,
} from "@modovik/clothing/project-items";
import { BASE_SOURCE, loadBaseVanilla } from "@modovik/clothing/server-base";

const PICTURE_LIMIT_BYTES = 4 * 1024 * 1024;
const PICTURE_TIMEOUT_MS = 20_000;
const PICTURE_TYPES = Object.freeze({
  /* WebP первым: фото нашего набора лежат в нём (28.10.2026) — поиск в кэше на диске находит их первой же попыткой. */
  "image/webp": "webp",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/avif": "avif",
});

const failure = (code, message, status = 0) => Object.assign(new Error(message), { code, ...(status ? { status } : {}) });

/**
 * Тип картинки по первым байтам: PNG, JPEG, WebP, AVIF — или пустая строка. Нужен, когда хост не называет тип (`application/octet-stream`): наш CDN отдаёт
 * набор фото вещей как пакет (`/sha256/<версия>/<сервер>/<файл>.webp`, 28.10.2026), а у пакетов тип по умолчанию «просто байты».
 */
export function sniffPictureType(bytes) {
  const at = (index) => bytes[index];
  if (bytes.length >= 4 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return "image/png";
  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  const ascii = (from, to) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (bytes.length >= 12 && ascii(4, 12) === "ftypavif") return "image/avif";
  return "";
}

/*
 * GET с потолком: только https и разрешённые хосты, переадресация — не
 * дальше двух шагов и тоже на разрешённый хост (картинки nightz уходят на
 * свой CDN).
 */
export async function fetchLimited(
  url,
  { limit, timeout, accept, allowed, fetchImpl = fetch },
) {
  let target = new URL(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    for (let hop = 0; hop < 3; hop += 1) {
      if (!allowed(target.href))
        throw failure("PROJECT_HOST", `Адрес ${target.hostname} не из списка.`);
      const response = await fetchImpl(target.href, {
        redirect: "manual",
        signal: controller.signal,
        headers: { accept },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw failure("PROJECT_HTTP", "Пустая переадресация.");
        target = new URL(location, target);
        continue;
      }
      if (!response.ok)
        throw failure("PROJECT_HTTP", `Сайт ответил ${response.status}.`, response.status);
      if (Number(response.headers.get("content-length") || 0) > limit)
        throw failure("PROJECT_SIZE", "Ответ слишком велик.");
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > limit) {
          await reader.cancel().catch(() => {});
          throw failure("PROJECT_SIZE", "Ответ слишком велик.");
        }
        chunks.push(value);
      }
      return {
        bytes: Buffer.concat(chunks),
        type: String(response.headers.get("content-type") || "")
          .split(";")[0]
          .trim()
          .toLowerCase(),
      };
    }
    throw failure("PROJECT_HTTP", "Слишком много переадресаций.");
  } finally {
    clearTimeout(timer);
  }
}

const memo = new Map();

/* Прежний кэш ответов сайтов (до задачи 9) — 4–6 МБ на сервер и пол, больше
   не нужен; картинки (`pictures/`) остаются. Убирается раз за запуск. */
const STALE_CACHE = /^(?:(?:gta5rp|majestic|rmrp)-(?:male|female)|gta5rp-wiki)\.json$/;
let staleSwept = false;
async function sweepStaleCache(stateDir) {
  if (staleSwept || !stateDir) return;
  staleSwept = true;
  const directory = path.join(stateDir, "project-clothing");
  const names = await fs.readdir(directory).catch(() => []);
  for (const name of names)
    if (STALE_CACHE.test(name))
      await fs.rm(path.join(directory, name), { force: true }).catch(() => {});
}

/**
 * Вещи GTA Online под именами проекта одного пола и вида:
 * `{ status, takenAt, items, vanilla }`. `status` — `bundled` (база Astral),
 * `unavailable` или `unsupported`. `items` — вещи с местом в игре игрока
 * (`order()` — порядок вещей игры, `game-clothing-order.js`; без игры их
 * нет), `vanilla` — строки вики без места. Такие вещи есть только у GTA5RP:
 * у Majestic и RMRP — пусто (их вещи в базе — файлами паков).
 */
export async function readProjectClothing(
  input,
  { stateDir = null, order = async () => null } = {},
) {
  await sweepStaleCache(stateDir);
  const server = String(input?.server || "");
  const gender = input?.gender;
  const component = String(input?.component || "");
  if (
    !PROJECT_SERVERS.includes(server) ||
    !["male", "female"].includes(gender) ||
    !COMPONENTS[component]
  )
    return { status: "unsupported", takenAt: null, items: [], vanilla: [] };
  const takenAt = BASE_SOURCE.takenAt;
  if (server !== "gta5rp") return { status: "bundled", takenAt, items: [], vanilla: [] };
  try {
    let entry = memo.get(gender);
    if (!entry) {
      const vanilla = await loadBaseVanilla(gender);
      const places = vanilla.length ? await order().catch(() => null) : null;
      entry = {
        items: places
          ? vanillaAssortment(server, vanilla, (kind) => clothingOrder(places, gender, kind))
          : [],
        vanilla,
      };
      /* Без игры место не запоминается: игру могут подключить позже. */
      if (places) memo.set(gender, entry);
    }
    return {
      status: "bundled",
      takenAt,
      items: entry.items.filter((item) => item.component === component),
      vanilla: entry.vanilla.filter((item) => item.component === component),
    };
  } catch (error) {
    return {
      status: "unavailable",
      reason: String(error?.message || error).slice(0, 200),
      takenAt: null,
      items: [],
      vanilla: [],
    };
  }
}

/** Забыть разобранное в памяти (тесты, смена stateDir). */
export const forgetProjectClothing = () => {
  memo.clear();
  staleSwept = false;
  restingPictureHosts.clear();
  pictureFailures.clear();
  missingPictures.clear();
};

/*
 * Сайт проекта не отвечает (бета 02.11.2026: сто отказов «fetch failed» за десять секунд на одной полке). Плитка и так остаётся без картинки, поэтому сайт отдыхает, а в
 * журнале это ожидаемый отказ, а не ошибка.
 *
 * 14.11.2026 (владелец: «нету фотографий»; замер `scripts/perf/baseline/clothing-photos.mjs`): отдых начинался с ПЕРВОЙ же ошибки сети и длился минуту. Обрыв одного соединения у живого сайта
 * (CDN при десятке одновременных обменов обрывает и таймаутит редкие) оставлял без картинок всю сетку на минуту: следующие 5–12 просьб отвечали «не отвечает» за миллисекунды. Теперь:
 * обрыв соединения повторяется один раз сразу (`PICTURE_RETRY_MS`), сайт отдыхает только после `PICTURE_FAILS_TO_REST` неудач подряд (успех счёт обнуляет) и недолго
 * (`PICTURE_HOST_REST_MS`). Ответ «404» (у источника фото нет) помнится `MISSING_PICTURE_MS`: плитка, на которую вернулись, не ходит за ним в сеть заново, а получает отказ сразу.
 */
const PICTURE_HOST_REST_MS = 20_000;
const PICTURE_FAILS_TO_REST = 3;
const PICTURE_RETRY_MS = 250;
const MISSING_PICTURE_MS = 10 * 60_000;
const MISSING_PICTURES_MAX = 5000;
const restingPictureHosts = new Map();
const pictureFailures = new Map();
const missingPictures = new Map();

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const gone = (error) => error?.code === "PROJECT_HTTP" && (error.status === 404 || error.status === 410);

async function fetchPicture(url, options, now = Date.now()) {
  const { hostname } = new URL(url);
  if (restingPictureHosts.get(hostname) > now)
    throw failure("PROJECT_OFFLINE", "Сайт проекта не отвечает.");
  if (missingPictures.get(url) > now)
    throw failure("PROJECT_HTTP", "Сайт ответил 404.", 404);
  for (let attempt = 0; ; attempt += 1) {
    try {
      const answer = await fetchLimited(url, options);
      pictureFailures.delete(hostname);
      return answer;
    } catch (error) {
      /* Сайт ответил (пусть и «нет такого файла») — он жив. */
      if (gone(error)) {
        pictureFailures.delete(hostname);
        if (missingPictures.size >= MISSING_PICTURES_MAX) missingPictures.clear();
        missingPictures.set(url, Date.now() + MISSING_PICTURE_MS);
        throw error;
      }
      if (!(error instanceof TypeError) && error?.name !== "AbortError") throw error;
      /* Обрыв соединения бывает и у живого сайта: один быстрый повтор вместо отдыха. */
      if (attempt === 0 && error instanceof TypeError) {
        await pause(PICTURE_RETRY_MS);
        continue;
      }
      const failures = (pictureFailures.get(hostname) || 0) + 1;
      pictureFailures.set(hostname, failures);
      if (failures >= PICTURE_FAILS_TO_REST) {
        pictureFailures.delete(hostname);
        restingPictureHosts.set(hostname, Date.now() + PICTURE_HOST_REST_MS);
      }
      throw failure("PROJECT_OFFLINE", "Сайт проекта не отвечает.");
    }
  }
}

/*
 * Кэш на диске по адресу: все четыре расширения читаются разом (раньше — по очереди, и промах стоил четырёх обменов с диском подряд), побеждает первое по порядку
 * `PICTURE_TYPES`.
 */
async function cachedPicture(directory, hash) {
  const found = await Promise.all(
    Object.entries(PICTURE_TYPES).map(async ([type, extension]) => {
      const bytes = await fs.readFile(path.join(directory, `${hash}.${extension}`)).catch(() => null);
      return bytes ? { bytes: new Uint8Array(bytes), type } : null;
    }),
  );
  return found.find(Boolean) || null;
}

async function storePicture(directory, hash, extension, bytes) {
  try {
    await fs.mkdir(directory, { recursive: true });
    const file = path.join(directory, `${hash}.${extension}`);
    const temporary = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await fs.writeFile(temporary, bytes);
    await fs.rename(temporary, file).catch(() => fs.rm(temporary, { force: true }));
  } catch {
    /* Кэш не получился — картинка уже у окна, в следующий раз её возьмут с сайта. */
  }
}

/*
 * Обмен по адресу общий (14.11.2026, «фото быстро прогружаются»): плитка, расцветка вещи, пара внизу и заготовка просят один и тот же адрес из разных мест; второй
 * вопрос по тому же адресу присоединяется к идущему, а не ходит в сеть ещё раз. Ответ уходит окну, как только байты на руках: запись в кэш на диске идёт позади
 * ответа (на медленном диске это десятки миллисекунд на каждой картинке), а запись в таблице живёт, пока она не закончится, — вопрос в этот промежуток берёт
 * байты из неё, а не промахивается мимо ещё не записанного файла.
 */
const pictureFlights = new Map();

function startPictureFlight(url, directory, hash, fetchImpl) {
  let finished;
  const done = new Promise((resolve) => {
    finished = resolve;
  });
  const result = (async () => {
    let storing = false;
    try {
      const cached = await cachedPicture(directory, hash);
      if (cached) return cached;
      const { bytes, type } = await fetchPicture(url, {
        limit: PICTURE_LIMIT_BYTES,
        timeout: PICTURE_TIMEOUT_MS,
        accept: "image/avif,image/webp,image/png,image/jpeg",
        allowed: pictureAllowed,
        fetchImpl,
      });
      /* Хост не назвал тип (пустой или «просто байты») — тип по самим байтам; названный не-картинкой (text/html) не принимается. */
      const kind = PICTURE_TYPES[type] ? type : !type || type === "application/octet-stream" ? sniffPictureType(bytes) : "";
      const extension = PICTURE_TYPES[kind];
      if (!extension) throw failure("PROJECT_PICTURE", "Это не картинка.");
      storing = true;
      void storePicture(directory, hash, extension, bytes).finally(finished);
      return { bytes: new Uint8Array(bytes), type: kind };
    } finally {
      if (!storing) finished();
    }
  })();
  return { result, done };
}

/**
 * Картинка вещи проекта: `{ bytes, type }`. Только CDN проектов и nightz
 * (`pictureAllowed`), с кэшем на диске по адресу.
 */
export async function readProjectPicture(input, { stateDir, fetchImpl = fetch } = {}) {
  const url = String(input?.url || "");
  if (!pictureAllowed(url))
    throw failure("PROJECT_HOST", "Картинку вещи можно взять только с сайтов проектов.");
  const hash = createHash("sha1").update(url).digest("hex");
  const directory = path.join(stateDir, "project-clothing", "pictures");
  const key = `${directory}|${url}`;
  let flight = pictureFlights.get(key);
  if (!flight) {
    flight = startPictureFlight(url, directory, hash, fetchImpl);
    pictureFlights.set(key, flight);
    void flight.done.then(() => pictureFlights.delete(key));
  }
  return flight.result;
}
