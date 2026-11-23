/*
 * «Ухудшение текстур» — ступени из игры игрока на всю карту (задача 9,
 * 05.10.2026; на всю карту и вдали — задача 1 ТЗ 05.10.2026, вечер).
 *
 * Словари — вся карта игрока по переписи (`texture-census.js`): около
 * двадцати тысяч, город и загород, земля, дороги, здания, предметы,
 * интерьеры и дальние планы (LOD, SLOD1…3, `+hi`), из базовых архивов, из
 * пакетов Rockstar и из работ Astral (перекрашенный Мегамолл мылится в
 * своём цвете). Нативный хост читает каждый словарь прямо из архива игры и
 * пишет все ступени разом (`downscale-textures`): у текстуры срезаются
 * верхние ступени mip до предела стороны, остальное — как было. Словарь,
 * где под предел ничего не попало, в ступень не входит: игре он не нужен.
 *
 * Модели карты — так же, но только выбранной ступенью: у трети из девяноста
 * тысяч моделей текстуры зашиты внутрь (стены обсерватории, вывески,
 * предметы), и без них карта мылилась пятнами. Вес такой модели — её
 * геометрия, поэтому в пакет модели идут в пределах его веса, сначала те,
 * где ступень снимает больше всего текстур.
 *
 * Читать приходится около 21 ГБ, поэтому:
 *   • словари собираются четырьмя процессами хоста, поровну байт;
 *   • собранное помнится по каждому словарю (`index.json`): место, размер и
 *     отпечаток источника. Сменился один словарь (перекрасили Мегамолл,
 *     вышел патч) — пересобирается он один, а не карта целиком;
 *   • файлы ступеней лежат под своим SHA-256 (`objects/<sha256>`) и не
 *     переписываются на месте: пакет и хранилище движка держат на них
 *     жёсткие ссылки, и правка на месте переписала бы стоящую ступень.
 *
 * Машины и оружие (задача 35 (б)): перепись берёт и их (`texture-census.js`) —
 * словари машин и деталей и словари с моделями оружия; ступени, стили и ЧБ
 * ложатся на них так же, как на карту. Оружие — пока у игрока нет Astral
 * Weapons DLC: его файлы (скины, стволы) — штатные имена, но пакет ступени
 * выше, и копия штатного ствола перекрыла бы мастерскую.
 *
 * Игра не трогается: хост только читает, ступени пишутся в состояние Astral.
 *
 * Стадии после среза (стиль мира и ЧБ-мир, ТЗ 17.10.2026): `stages` — их
 * тот же проход хоста кладёт поверх ступени, а собранное помнится вариантом
 * `textureVariantKey(cap, stages)` (`128` — чистый срез, `128+grayscale` —
 * ЧБ, `128+style-comic+grayscale` — комикс серым) рядом с чистым:
 * переключение ЧБ или стиля туда и обратно не пересобирает карту. Порядок
 * стадий и что они красят — `@modovik/optimizer/texture-stages.js`.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { keysFromDirectory, openRpfFile } from "@modovik/rpf7/node";
import { FAR_PLANE_CAP, TEXTURE_CAPS, TEXTURE_MODEL_BUILD, isFarPlaneDictionary } from "@modovik/optimizer/texture-levels.js";
import { TEXTURE_STAGES_VERSION, WORLD_DETAILS, normalizeTextureStages, textureVariantKey } from "@modovik/optimizer/texture-stages.js";
import { TEXTURES_DLC_MAX_BYTES } from "@modovik/install-engine/textures-dlc.js";
import { renameWithRetry } from "@modovik/install-engine/engine-state.js";
import { mapLimit } from "@modovik/install-engine/map-limit.js";
import { governedPause } from "@modovik/install-engine/disk-governor.js";
import { smallFileLimit } from "@modovik/install-engine/disk-profile.js";
import { callNativeEngine, engineLocationDefaults, nativeContextDefaultsOf } from "./native-engine.js";
import { resolveRustExecutable, rustTextureLevelsEnabled } from "./native-engine-rust.js";
import { archiveListingEnabled, listGameArchives } from "./game-archive-listing.js";
import { censusMapTextures, gearGroupOf } from "./texture-census.js";
import { ROADS_DLC_PACKS } from "@modovik/install-engine/roads-dlc.js";
import { isCarriedByPlaces } from "@modovik/install-engine/recolor-manifest-trust.js";

/* Меняется — когда меняется то, как хост пишет ступени: старое уходит.
   3 — текстуры без ступеней mip пересжимаются (06.10.2026);
   4 — палитры тинта и таблицы не сжимаются: сжатые, они красили
       тонированные заборы и контейнеры всей карты в пурпурный (фикс 2). */
const ALGORITHM = 4;
/*
 * Сколько процессов хоста разом (ТЗ 06.10.2026, вечер). Каждый процесс
 * однопоточный и упирается в процессор (замер на ПК владельца: четыре
 * процесса — ровно четыре ядра из шестнадцати потоков, ~150 МБ памяти
 * каждый). Поэтому — по ядрам: все, кроме двух (окну и диску), но не больше
 * двенадцати и не больше, чем помещается в свободную память с запасом.
 */
export function textureLevelWorkers({ cores = os.availableParallelism?.() || os.cpus().length, freeBytes = os.freemem() } = {}) {
  const byMemory = Math.floor(freeBytes / (400 * 1024 * 1024));
  return Math.max(2, Math.min(12, cores - 2, byMemory));
}
/* Имя словаря или модели, которое пакет текстур вправе везти (`textures-manifest-trust.js`). */
/* Чёткость ЧБ-мира и стилей без ступени — до неё один пакет-пара, выше — три пакета. */
const GRAY_WORLD_LIMIT = 128;
const SAFE_NAME = /^[a-z0-9][a-z0-9._+~-]{0,119}\.(?:ytd|ydr|ydd|yft)$/;
const CAPS = Object.freeze([...TEXTURE_CAPS].sort((a, b) => b - a));
/* Вес файлов пакета: предел строгой формы за вычетом выравнивания записей RPF. */
const TEXTURES_PACKAGE_BUDGET = TEXTURES_DLC_MAX_BYTES - 64 * 1024 * 1024;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const exists = (target) =>
  fs
    .access(target)
    .then(() => true)
    .catch(() => false);

/** Папка ступеней этой игры в состоянии Astral. */
export const textureLevelsRoot = (stateDir, gameRoot) =>
  path.join(stateDir, "optimization", "texture-levels-v2", sha256(path.resolve(gameRoot).toLowerCase()).slice(0, 16));

/* Части поровну по байтам, словари одного архива — подряд (архив открывается
   каждым процессом заново, лишние открытия стоят оглавления, не данных). */
export function splitByBytes(items, parts) {
  const label = (item) => String(item.at).slice(0, String(item.at).indexOf(":"));
  const sorted = [...items].sort((a, b) => (label(a) < label(b) ? -1 : label(a) > label(b) ? 1 : 0));
  const total = sorted.reduce((sum, item) => sum + Math.max(1, item.size), 0);
  const chunks = Array.from({ length: Math.max(1, parts) }, () => []);
  let done = 0;
  for (const item of sorted) {
    const index = Math.min(chunks.length - 1, Math.floor((done / total) * chunks.length));
    chunks[index].push(item);
    done += Math.max(1, item.size);
  }
  return chunks.filter((chunk) => chunk.length);
}

async function readIndex(root) {
  try {
    const index = JSON.parse(await fs.readFile(path.join(root, "index.json"), "utf8"));
    if (index?.algorithm === ALGORITHM && index.items && typeof index.items === "object") return index;
  } catch {
    /* Описи нет или она битая — всё собирается заново. */
  }
  return { algorithm: ALGORITHM, items: {} };
}

async function writeIndex(root, index) {
  const file = path.join(root, "index.json");
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(index));
  await fs.rename(temporary, file);
}

/** Собран ли словарь из того же источника тем же способом. */
const fresh = (known, item) => Boolean(known && known.at === item.at && known.size === item.size && known.identity === item.identity);

/* Файл ступени — в хранилище под своим отпечатком; такой уже есть — тот же. */
/* Одинаковые по содержимому файлы ступеней (у разных словарей бывает
   один и тот же результат) кладутся по очереди: два переименования в один
   объект разом Windows отклоняет (`EPERM`). Второй ждёт первого и просто
   убирает свою копию.

   В хранилище — жёсткой ссылкой, а не переименованием (06.10.2026, вечер):
   только что записанный хостом файл держит проверка Защитника Windows, и
   переименование ждёт её конца — 3000 свежих файлов переименовывались
   16 с, ссылкой — 0,3 с (замер на ПК владельца). Временная папка сборки
   уходит целиком в конце. */
const storing = new Map();

function storeObject(root, source, digest) {
  const target = path.join(root, "objects", digest);
  const key = target.toLowerCase();
  const job = (storing.get(key) || Promise.resolve())
    .catch(() => {})
    .then(async () => {
      if (await exists(target)) {
        await fs.rm(source, { force: true });
        return target;
      }
      await fs.mkdir(path.dirname(target), { recursive: true });
      try {
        await fs.link(source, target);
      } catch (error) {
        if (error?.code === "EEXIST") return target;
        /* Без ссылок (другой том, файловая система) — переименованием. */
        await renameWithRetry(source, target);
      }
      return target;
    });
  storing.set(key, job);
  job.then(
    () => storing.get(key) === job && storing.delete(key),
    () => storing.get(key) === job && storing.delete(key),
  );
  return job;
}

/*
 * Модели карты помнятся только той ступенью, что ставили последней: их
 * вес — геометрия (около 2,5–3 ГБ на ступень), и пять ступеней разом
 * заняли бы на диске больше десятка гигабайт. Модель без своих текстур
 * помнится навсегда (до смены источника) — второй раз её не читают.
 */
const isModel = (item) => item.kind === "model";
/*
 * Сборка моделей. 2 (19.10.2026) — хост меняет в файле модели только
 * описания и байты текстур, остальное байт в байт как в игре. Модели
 * сборки 1 пересохранял CodeWalker целиком, и игра падала на их
 * столкновениях (GTA5.exe+0x6186AF у дома Майкла, «Комикс») — такие
 * собираются заново.
 */
export const MODEL_BUILD = TEXTURE_MODEL_BUILD;
/* Вариант со стадиями собран той же версией стадий (`TEXTURE_STAGES_VERSION`). */
const stagedFresh = (known, variant) => typeof variant !== "string" || known.stagesVersion === TEXTURE_STAGES_VERSION;
/*
 * Дальние планы мира со стадиями (ТЗ 24.10.2026, п. 2) держат не меньше `FAR_PLANE_CAP` px, а не предел чёткости мира
 * (`@modovik/optimizer/texture-levels.js`). Вариант со стадиями, собранный прежним правилом, устарел: об этом говорит
 * поле описи `farCap` — его нет у собранного до правила.
 */
const farPlane = (item, steps) => steps.length > 0 && !isModel(item) && isFarPlaneDictionary(item.name);
const farFresh = (known, variant, name) => typeof variant !== "string" || !isFarPlaneDictionary(name) || known.farCap === FAR_PLANE_CAP;
const modelBuilt = (known, variant) =>
  !known.textures ||
  (known.modelBuild === MODEL_BUILD &&
    (known.kept || known.error || ((known.built || []).includes(variant) && stagedFresh(known, variant))));
/*
 * Словарь собирается только нужной ступенью (ТЗ 06.10.2026, вечер): прежде
 * каждый из двадцати тысяч словарей пересохранялся сразу всеми пятью
 * ступенями — впятеро больше работы хоста и записи на диск, хотя ставится
 * одна. Собранные ступени словаря помнятся (`built`); записи прежних
 * сборок без `built` собраны всеми ступенями сразу.
 */
const dictionaryBuilt = (known, variant, name) =>
  !known.textures || known.error || ((known.built || CAPS).includes(variant) && stagedFresh(known, variant) && farFresh(known, variant, name));

/**
 * Ступени для словарей и моделей переписи: собранные — из памяти,
 * сменившиеся и новые — хостом. Словари и модели — ступенью `cap` (нет
 * `cap` — словари всеми ступенями разом, модели не собираются) со стадиями
 * `stages` (ЧБ; только вместе с `cap`). Ход — `onProgress` шагом `prepare` в
 * байтах прочитанных записей. `{ root, index, built, reused }`.
 */
export async function prepareTextureLevels({
  gameRoot,
  stateDir,
  keysDirectory,
  items,
  cap = null,
  stages = [],
  nativeContext = {},
  onProgress = null,
  native = callNativeEngine,
  /* По ядрам и свободной памяти — в момент сборки, а не при запуске окна. */
  workers = textureLevelWorkers(),
  /* Путь на движок включён (`ASTRAL_RUST_TEXTURE_LEVELS`): фрагменты `.yft` он не берёт и идут отдельными запросами хосту, остальное — движку, а записи, которым движок отказал, досчитывает хост. Выключен — разбиение и запросы прежние. */
  engineRoute = rustTextureLevelsEnabled(),
}) {
  const steps = normalizeTextureStages(stages);
  if (steps.length && !cap) throw new Error("Стадии текстур собираются только вместе со ступенью.");
  /* Вариант ступени в памяти: число у чистого среза, строка со стадиями. */
  const variant = cap ? textureVariantKey(cap, steps) : null;
  const root = textureLevelsRoot(stateDir, gameRoot);
  await fs.mkdir(path.join(root, "objects"), { recursive: true });
  const index = await readIndex(root);
  const staleOf = (item) => {
    if (!(item.size > 0)) return false;
    const known = index.items[item.name];
    if (!fresh(known, item)) return isModel(item) ? Boolean(cap) : true;
    if (isModel(item)) return Boolean(cap) && !modelBuilt(known, variant);
    return Boolean(cap) && !dictionaryBuilt(known, variant, item.name);
  };
  const stale = items.filter(staleOf);
  if (stale.length) {
    const stage = path.join(root, `.stage-${randomUUID().slice(0, 8)}`);
    await fs.mkdir(stage, { recursive: true });
    try {
      /* Словари и модели — разными запросами: у них разные ступени. */
      const farItems = stale.filter((item) => farPlane(item, steps));
      const farNames = new Set(farItems.map((item) => item.name));
      const fragmentItems = new Set(engineRoute ? stale.filter((item) => isModel(item) && /\.yft$/i.test(item.name)) : []);
      const runs = [
        /* Без ступени (служба только помнит словари) — всеми, как прежде. */
        ...splitByBytes(stale.filter((item) => !isModel(item) && !farNames.has(item.name)), workers).map((chunk) => ({ chunk, caps: cap ? [cap] : CAPS })),
        /* Дальние планы мира со стадиями — предел не ниже `FAR_PLANE_CAP`; в описи вариант остаётся по чёткости мира (`asked`). */
        ...splitByBytes(farItems, workers).map((chunk) => ({ chunk, caps: [Math.max(cap, FAR_PLANE_CAP)], asked: [cap], far: true })),
        ...splitByBytes(stale.filter((item) => isModel(item) && !fragmentItems.has(item)), workers).map((chunk) => ({ chunk, caps: [cap] })),
        ...splitByBytes([...fragmentItems], workers).map((chunk) => ({ chunk, caps: [cap] })),
      ];
      const totals = runs.map(({ chunk }) => chunk.reduce((sum, item) => sum + Math.max(1, item.size), 0));
      const done = runs.map(() => 0);
      const total = totals.reduce((sum, value) => sum + value, 0);
      const report = () => onProgress?.({ phase: "prepare", copiedBytes: done.reduce((a, b) => a + b, 0), totalBytes: total });
      report();
      const byName = new Map(stale.map((item) => [item.name, item]));
      const run = async ({ chunk, caps, asked = caps, far = false }, part) => {
        const request = path.join(stage, `request-${part}.json`);
        const output = path.join(stage, `report-${part}.json`);
        const levels = path.join(stage, `levels-${part}`);
        await fs.writeFile(
          request,
          JSON.stringify({
            gameRoot,
            keys: keysDirectory || null,
            outputDirectory: levels,
            caps,
            ...(steps.length ? { stages: steps } : {}),
            items: chunk.map(({ at, name, size }) => ({ at, name, size })),
          }),
        );
        try {
          await native("downscale-textures", { input: request, output }, {
            ...nativeContext,
            onProgress: (progress) => {
              done[part] = Math.min(totals[part], Number(progress?.copiedBytes) || 0);
              report();
            },
          });
        } catch (error) {
          /* Хост прежней сборки стилей не знает и отказывает по-английски. */
          if (/Unknown texture stage/i.test(String(error?.message || error)))
            throw new Error("Нативный хост Astral не знает стадий текстур — перезапустите Astral, он соберётся заново.");
          throw error;
        }
        let { items: results = [] } = JSON.parse(await fs.readFile(output, "utf8"));
        /* Движок отказал записи (формат вне его таблицы, ресурс, который он не разобрал): такие записи досчитывает хост, как прежде
           (`ASTRAL_RUST_TEXTURE_LEVELS`; запись, которую не берёт и хост, остаётся с ошибкой). */
        if (engineRoute) {
          const refused = new Set(results.filter((result) => result.error && !result.missing).map((result) => result.at));
          if (refused.size) {
            const again = path.join(stage, `request-${part}-host.json`);
            const answer = path.join(stage, `report-${part}-host.json`);
            await fs.writeFile(again, JSON.stringify({ gameRoot, keys: keysDirectory || null, outputDirectory: levels, caps, ...(steps.length ? { stages: steps } : {}), items: chunk.filter((item) => refused.has(item.at)).map(({ at, name, size }) => ({ at, name, size })) }));
            try {
              await native("downscale-textures", { input: again, output: answer }, { ...nativeContext, hostOnly: true });
              const redone = new Map(JSON.parse(await fs.readFile(answer, "utf8")).items.map((result) => [result.at, result]));
              results = results.map((result) => (refused.has(result.at) && redone.has(result.at) ? redone.get(result.at) : result));
            } catch {
              /* Хост тоже не взял — остаётся ответ движка с ошибкой. */
            }
          }
        }
        /* Тысячи файлов ступеней — в хранилище разом, а не по одному
           (06.10.2026, вечер: по одному это была минута ожидания диска). */
        await mapLimit(results, smallFileLimit(root, { fast: 32 }), async (result) => {
          await governedPause(root);
          const item = byName.get(result.name);
          if (!item) return;
          const entry = {
            at: item.at,
            size: item.size,
            identity: item.identity,
            textures: result.textures || 0,
            unmipped: result.unmipped || 0,
            ...(isModel(item) ? { kind: "model", modelBuild: MODEL_BUILD, original: result.original || 0, built: asked.map((value) => textureVariantKey(value, steps)) } : {}),
            ...(result.missing ? { missing: true } : {}),
            ...(result.error ? { error: String(result.error).slice(0, 200) } : {}),
            ...(result.kept ? { kept: String(result.kept).slice(0, 60) } : {}),
            levels: {},
          };
          /* Тот же словарь, новая ступень или вариант: прежние остаются при
             нём (ЧБ включили — чистый срез на месте). Модель, как прежде,
             помнится одним последним вариантом: её вес — геометрия, и два
             варианта карты моделей заняли бы на диске ещё около 3 ГБ. */
          const known = index.items[result.name];
          const variants = asked.map((value) => textureVariantKey(value, steps));
          const farDictionary = !isModel(item) && isFarPlaneDictionary(item.name);
          if (!isModel(item) && fresh(known, item) && !result.error && !result.missing) {
            /* Варианты со стадиями прежней версии уходят: их краска устарела; у дальних планов — и собранные до правила предела. */
            const current = (key) =>
              !String(key).includes("+") || (known.stagesVersion === TEXTURE_STAGES_VERSION && (!farDictionary || known.farCap === FAR_PLANE_CAP));
            entry.levels = Object.fromEntries(Object.entries(known.levels || {}).filter(([key]) => current(key)));
            entry.built = [...new Set([...(known.built || CAPS).filter(current), ...variants])].sort(byVariant);
          } else if (!isModel(item)) entry.built = [...variants];
          /* Пометка нужна, пока в описи есть вариант со стадиями, собранный по правилу дальних планов. */
          if (far) entry.farCap = FAR_PLANE_CAP;
          else if (farDictionary && fresh(known, item) && known.farCap && !result.error && !result.missing) entry.farCap = known.farCap;
          if (steps.length || entry.built?.some((key) => typeof key === "string")) entry.stagesVersion = TEXTURE_STAGES_VERSION;
          for (const level of result.levels || []) {
            /* Вариант хоста: старый хост стадий не знает и вернул бы чистый
               срез под видом ЧБ — тогда отказ, а не цветной «ЧБ-мир». */
            const key = textureVariantKey(level.cap, steps);
            if (String(level.variant ?? level.cap) !== String(key))
              throw new Error("Нативный хост Astral не знает стадий текстур — перезапустите Astral, он соберётся заново.");
            const file = path.join(levels, String(key), result.name);
            const stat = await fs.stat(file).catch(() => null);
            if (stat?.size !== level.bytes) throw new Error(`Ступень ${level.cap} px: файл ${result.name} не записан целиком.`);
            await storeObject(root, file, level.sha256);
            /* Файл лежит под тем вариантом, о котором просили (дальний план собран с пределом выше, а назван по чёткости мира). */
            entry.levels[textureVariantKey(asked[caps.indexOf(level.cap)] ?? level.cap, steps)] = { size: level.bytes, sha256: level.sha256 };
          }
          index.items[result.name] = entry;
        });
      };
      /* Не больше `workers` процессов хоста разом: сначала словари, потом модели. */
      let next = 0;
      await Promise.all(
        Array.from({ length: Math.min(Math.max(1, workers), runs.length) }, async () => {
          while (next < runs.length) {
            const part = next++;
            await run(runs[part], part);
          }
        }),
      );
    } finally {
      /* Файлы папки ещё может держать проверка Защитника — с повторами. */
      await fs.rm(stage, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
    }
  }
  /* Словари, которых в переписи больше нет (игра обновилась), уходят из
     памяти, а их файлы — из хранилища: стоящую ступень держит движок. */
  const wanted = new Set(items.map((item) => item.name));
  for (const name of Object.keys(index.items)) if (!wanted.has(name) && !index.items[name]?.extra) delete index.items[name];
  index.updatedAt = new Date().toISOString();
  await writeIndex(root, index);
  await pruneObjects(root, index);
  return { root, index, built: stale.length, builtModels: stale.filter(isModel).length, reused: items.length - stale.length };
}

/* Порядок вариантов в описи: от большего предела к меньшему, чистый срез — перед стадиями. */
function byVariant(a, b) {
  const cap = (value) => Number.parseInt(String(value), 10);
  return cap(b) - cap(a) || String(a).length - String(b).length || (String(a) < String(b) ? -1 : 1);
}

/* Файлы хранилища, на которые опись больше не ссылается. */
async function pruneObjects(root, index) {
  const used = new Set();
  for (const entry of Object.values(index.items)) for (const level of Object.values(entry.levels || {})) used.add(level.sha256);
  for (const name of await fs.readdir(path.join(root, "objects")).catch(() => []))
    if (/^[a-f0-9]{64}$/.test(name) && !used.has(name)) await fs.rm(path.join(root, "objects", name), { force: true }).catch(() => {});
}

/*
 * «Как в моде» (8 px): карта — своими словарями, а люди и машины — файлами
 * самого мода `retexture.rpf`, как раньше. Файл мода встаёт, только если
 * его словарь у игрока есть в базовом архиве и игра берёт его оттуда:
 * обновлённый пакетом или update.rpf словарь старая копия мода откатила бы.
 */
async function modExtras({ root, index, gameRoot, keys, resourceRoot, census, open = openRpfFile }) {
  if (!resourceRoot) return [];
  let inventory;
  try {
    inventory = JSON.parse(await fs.readFile(path.join(resourceRoot, "inventory.json"), "utf8"));
  } catch {
    return [];
  }
  const layer = inventory.layers?.retexture;
  if (!layer?.files?.length || !layer.pack) return [];
  const map = new Set(census.items.map((item) => item.name));
  const candidates = layer.files.filter((file) => !map.has(file.name) && !census.overridden.has(file.name) && file.at);
  if (!candidates.length) return [];
  const pack = await fs.readFile(path.join(resourceRoot, layer.pack)).catch(() => null);
  if (!pack) return [];
  const archives = new Map();
  const extras = [];
  try {
    for (const file of candidates) {
      const colon = file.at.indexOf(":");
      const label = file.at.slice(0, colon);
      if (!/^x64[a-z]\.rpf$/.test(label)) continue;
      if (!archives.has(label)) archives.set(label, await open(path.join(gameRoot, label), { keys }).catch(() => null));
      const archive = archives.get(label);
      if (!archive) continue;
      archive.index ||= new Map(archive.entries.map((entry) => [entry.path.toLowerCase(), entry]));
      if (!archive.index.has(file.at.slice(colon + 1).toLowerCase())) continue;
      const bytes = pack.subarray(file.offset, file.offset + file.size);
      if (sha256(bytes) !== file.sha256) throw new Error("Файл лёгких текстур повреждён — переустановите Astral.");
      const target = path.join(root, "objects", file.sha256);
      if (!(await exists(target))) {
        const temporary = `${target}.${randomUUID()}.tmp`;
        await fs.writeFile(temporary, bytes);
        await fs.rename(temporary, target);
      }
      index.items[file.name] = { at: `mod:${file.name}`, size: file.size, identity: file.sha256, extra: true, levels: { 8: { size: file.size, sha256: file.sha256 } } };
      extras.push({ name: file.name, path: target, size: file.size, sha256: file.sha256 });
    }
  } finally {
    for (const archive of archives.values()) await archive?.close?.().catch(() => {});
  }
  await writeIndex(root, index);
  return extras;
}

/**
 * Файлы ступени `cap` для пакета текстур: `{ files: [{ name, path, size,
 * sha256, pack? }], note }` — словари и модели карты со своими текстурами
 * (в пределах веса пакета `budget`; у ЧБ-мира и стилей — ещё и второго
 * пакета, `pack: "b"`; на 256 px — и третьего, `pack: "c"`, и словари
 * делятся между пакетами). Перепись и сборка — здесь же; собранное помнится.
 */
/* Оглавления архивов игры из движка; `null` — движка нет или он не ответил. */
async function engineListing(gameRoot, keysDirectory) {
  try {
    const executable = resolveRustExecutable({ ...engineLocationDefaults(), ...(nativeContextDefaultsOf() || {}) });
    return executable ? await listGameArchives({ executable, gameRoot, keysDirectory: keysDirectory || "" }) : null;
  } catch {
    return null;
  }
}

export async function textureLevelFiles({
  cap,
  stages = [],
  gameRoot,
  stateDir,
  keysDirectory,
  resourceRoot = null,
  nativeContext,
  onProgress,
  native,
  census: takeCensus = censusMapTextures,
  budget = TEXTURES_PACKAGE_BUDGET,
  open = openRpfFile,
}) {
  const steps = normalizeTextureStages(stages);
  /* 256 px — не ступень «Ухудшения»: только чёткость ЧБ-мира и стилей. */
  if (!CAPS.includes(cap) && !(steps.length && WORLD_DETAILS.includes(cap))) throw new Error(`Ступени текстур ${cap} px нет.`);
  const variant = textureVariantKey(cap, steps);
  const keys = await keysFromDirectory(keysDirectory || "");
  /* Дороги — ниже ступени: ступень мылит их словари в цвете работы. */
  /* Машины и оружие — тоже (задача 35 (б)); оружие — пока нет Astral Weapons DLC (`texture-census.js`). */
  /* Оглавления архивов игры — из движка одним запуском (`game-archive-listing.js`, 14.11.2026): перепись не открывает сотню архивов
     читателем JS в главном процессе (6 с на оглавления и ещё 2,5 с на отпечатки `update.rpf`). Свой читатель или своя перепись (тесты),
     нет движка, он выключен или не ответил — игру читает прежний читатель. */
  const listing = open === openRpfFile && takeCensus === censusMapTextures && archiveListingEnabled() ? await engineListing(gameRoot, keysDirectory) : null;
  const census = await takeCensus({
    gameRoot,
    keys,
    open: listing?.open ?? open,
    ...(listing?.updateHashes ? { updateHashes: listing.updateHashes } : {}),
    sources: ROADS_DLC_PACKS.map((pack) => pack.name),
    vehicles: true,
    weapons: true,
  });
  if (!census.items.length) throw new Error("В архивах игры не нашлось словарей карты — сборка игры не та.");
  const prepared = await prepareTextureLevels({ gameRoot, stateDir, keysDirectory, items: census.items, cap, stages: steps, nativeContext, onProgress, native });
  const files = [];
  const dictionaryFiles = [];
  const models = [];
  const dictionaries = census.items.filter((item) => !isModel(item)).length;
  const stats = {
    dictionaries,
    built: prepared.built,
    builtModels: prepared.builtModels,
    reused: prepared.reused,
    missing: 0,
    failed: 0,
    skipped: 0,
    unmipped: 0,
    unsafe: 0,
    models: census.items.length - dictionaries,
    modelsWithTextures: 0,
    modelsKept: 0,
    modelsFailed: 0,
    modelsOverBudget: 0,
    dictionariesOverBudget: 0,
    /* Файлов с именами пакета мест — они лежат в первом или втором пакете (не в третьем). */
    placeNames: 0,
  };
  for (const item of census.items) {
    /* Имя, которое пакет не повезёт (у Rockstar есть словарь с обратной
       кавычкой в имени), остаётся как в игре: форма пакета — только простые
       имена. */
    if (!SAFE_NAME.test(item.name)) {
      stats.unsafe += 1;
      continue;
    }
    const entry = prepared.index.items[item.name];
    if (!entry || entry.missing) {
      stats.missing += 1;
      continue;
    }
    if (isModel(item)) {
      if (entry.textures) stats.modelsWithTextures += 1;
      if (entry.kept) stats.modelsKept += 1;
      if (entry.error) stats.modelsFailed += 1;
      stats.unmipped += entry.unmipped || 0;
      const level = entry.levels?.[variant];
      if (level)
        models.push({
          name: item.name,
          path: path.join(prepared.root, "objects", level.sha256),
          size: level.size,
          sha256: level.sha256,
          gain: Math.max(0, (entry.original || 0) - level.size) / level.size,
        });
      continue;
    }
    if (entry.error) stats.failed += 1;
    stats.unmipped += entry.unmipped || 0;
    const level = entry.levels?.[variant];
    if (!level) {
      stats.skipped += 1;
      continue;
    }
    dictionaryFiles.push({ name: item.name, path: path.join(prepared.root, "objects", level.sha256), size: level.size, sha256: level.sha256 });
  }
  const extras = cap === 8 ? await modExtras({ root: prepared.root, index: prepared.index, gameRoot, keys, resourceRoot, census, open }) : [];
  files.push(...extras);
  /*
   * Раскладка по пакетам. Пакетов у чистой ступени один; у ЧБ-мира и стилей
   * (ТЗ 17.10.2026) — два, на 256 px — три: мир целиком на 256 px — около
   * 9,3 ГиБ (замер на игре владельца), а пакет держит до `budget`.
   *
   * Сначала словари, в порядке переписи: пока есть место, они в первом пакете,
   * дальше — во втором, потом в третьем. Потом модели — после словарей и в
   * пределах веса: их вес — геометрия, и на 128 px вся карта в один пакет не
   * влезла бы. Первыми идут модели, где ступень снимает больше всего байт
   * текстур на байт пакета (стены зданий с крупными текстурами), каждая — в
   * первый пакет, где ещё есть место; за пределом остаются те, где зашита
   * мелочь. Модель за пределом осталась бы чужой стилю и цвета — поэтому
   * пакетов столько, чтобы влезло всё.
   *
   * Два правила, которые держит и граница доверия (`textures-manifest-trust.js`):
   *   • словари едут во второй и третий пакеты только на 256 px — на 128 px
   *     словарь, что не влез в первый, остаётся как в игре и считается в
   *     `dictionariesOverBudget` (манифест 128 px его во втором не принял бы);
   *   • третий пакет (`order` 108) главнее пакета мест (107), а правило
   *     проекта — места главнее ступеней текстур (`docs/RECOLOR.md`): файлы с
   *     именами, которые может везти пакет мест (`isCarriedByPlaces`), в
   *     третий не попадают никогда. Их кладут в первую очередь — в первый и
   *     второй (105, 106; место перекрывает их само): сперва среди словарей,
   *     потом среди моделей.
   */
  const packIds = steps.length ? (cap > GRAY_WORLD_LIMIT ? ["a", "b", "c"] : ["a", "b"]) : ["a"];
  const packs = packIds.map((id) => ({ id, bytes: id === "a" ? extras.reduce((sum, file) => sum + file.size, 0) : 0, files: 0 }));
  const place = (file, kind) => {
    const held = isCarriedByPlaces(file.name);
    const pack = packs.find(
      (candidate) =>
        (candidate.id === "a" || kind === "model" || cap > GRAY_WORLD_LIMIT) && (candidate.id !== "c" || !held) && candidate.bytes + file.size <= budget,
    );
    if (!pack) return false;
    pack.bytes += file.size;
    pack.files += 1;
    if (held) stats.placeNames += 1;
    files.push(pack.id === "a" ? file : { ...file, pack: pack.id });
    return true;
  };
  const placesFirst = (list) => [...list.filter((file) => isCarriedByPlaces(file.name)), ...list.filter((file) => !isCarriedByPlaces(file.name))];
  for (const file of placesFirst(dictionaryFiles)) if (!place(file, "dictionary")) stats.dictionariesOverBudget += 1;
  models.sort((a, b) => b.gain - a.gain || (a.name < b.name ? -1 : 1));
  for (const model of placesFirst(models)) {
    if (!place({ name: model.name, path: model.path, size: model.size, sha256: model.sha256 }, "model")) stats.modelsOverBudget += 1;
  }
  const present = await mapLimit(files, 64, (file) => exists(file.path));
  if (present.some((ok) => !ok)) throw new Error("Кэш ступеней текстур повреждён — нажмите «Установить» ещё раз.");
  if (!files.length) throw new Error("Ни один словарь этой игры не мельче предела — ступень пуста.");
  const lod = census.items.filter((item) => !isModel(item) && isFarPlaneDictionary(item.name)).length;
  /* Сколько машин и оружия легло в пакеты: окно по этому знает, что оружие стоит в пакете (`weapons`). */
  const gearAt = new Map(census.items.map((item) => [item.name, gearGroupOf(String(item.at).slice(String(item.at).indexOf(":") + 1))]));
  const gear = { vehicleFiles: 0, weaponFiles: 0 };
  for (const file of files) {
    const group = gearAt.get(file.name);
    if (group === "vehicle") gear.vehicleFiles += 1;
    else if (group === "weapon") gear.weaponFiles += 1;
  }
  return {
    files,
    note: {
      ...stats,
      lod,
      ...gear,
      sources: census.stats,
      extras: extras.length,
      files: files.length,
      modelFiles: models.length - stats.modelsOverBudget,
      bytes: packs.reduce((sum, pack) => sum + pack.bytes, 0),
      ...(packs[1]?.files ? { secondPack: { files: packs[1].files, bytes: packs[1].bytes } } : {}),
      ...(packs[2]?.files ? { thirdPack: { files: packs[2].files, bytes: packs[2].bytes } } : {}),
      ...(steps.length ? { stages: steps } : {}),
    },
  };
}
