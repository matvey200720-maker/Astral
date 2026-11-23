/*
 * Залазы в игре.
 *
 * Мод залазов (набор владельца 10.10.2026) — десять моделей меток, их типы
 * `climbs.ytyp`, расстановка `climbs.ymap` на 1393 места и манифест. Облик
 * метки в моделях мода задан геометрией: белые текстуры дают им только
 * цвет, и картинку туда не положить. Поэтому модели меток собираются заново
 * нативным хостом (`compile-climb-markers`, запрос версии 3): двусторонняя
 * плашка на месте лица и спины метки (спина читается, а не зеркалится) и
 * текстура, в которой нарисована вся метка — вид, надписи, своя картинка,
 * цвета, обводка и ореол.
 *
 * Текстуры рисует окно редактора — у него есть холст и шрифты — и присылает
 * их PNG. Своему входу установщик не верит: каждая картинка разбирается
 * заново, сверяется с раскладкой из контракта (`climbMarkerLayout`), под
 * прозрачные края доливается цвет, и DDS собирается здесь же.
 *
 * Расстановка едет как есть, байт в байт, кроме мест, где метки мода стоят
 * друг на друге (`@modovik/climb-contract/overlaps`, 12.10.2026): спина к
 * спине — плашка только лицом (копия метки своим архетипом), пустой в моде
 * щит перед чужой надписью и повтор одной метки — уходят. В типах правятся
 * границы архетипов под новые плашки и добавляются копии; манифест — свой,
 * «карта climbs → типы climbs»
 * (у мода он от другого набора, см. `scripts/prepare-climbs.mjs`). Всё
 * кладётся в контейнер слоя Astral `x64/astral/astral_climbs.rpf` тем же
 * движком установки, что и раньше (свой контейнер со своим `_manifest.ymf` —
 * задача 3 ТЗ 10.10.2026). Прежний набор panika снимается движком сам: слот
 * у залазов один, и новая установка сменяет старую.
 */

import { CLIMBS_CONTAINER } from "@modovik/install-engine/manifest-containers.js";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { bleedTransparent, fullMipLevels } from "@modovik/dds";
import { encodeDdsPooled } from "./dds-pool.js";
import {
  CLIMB_SET,
  CLIMB_SLOTS,
  CLIMB_TEXTURE_FORMAT,
  climbMarkerEmission,
  climbMarkerLayout,
  normalizeClimbDesign,
} from "@modovik/climb-contract";
import {
  climbFrontOnlyModel,
  resolveClimbOverlaps,
} from "@modovik/climb-contract/overlaps";
import {
  CLIMB_PLACEMENTS,
  CLIMB_PLACEMENTS_SOURCE,
} from "@modovik/climb-contract/placements";
import {
  canonicalManifest,
  climbSourceDigest,
  engineInstallEnabled,
  installLocalClimbPackage,
  planPackage,
  sha256File,
  uninstallPackage,
} from "@modovik/install-engine";
import {
  composeRpfArchive,
  installRpfPrebuilt,
  probeRpfArchive,
  provideLegacyDlcList,
  provideUpdateContentXml,
} from "./rpf-composer.js";
import { nativeRestorePointsRoot } from "./native-restore-chain.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));

/** Модели меток: имена те же, что в архетипах `climbs.ytyp`. */
export const CLIMB_MODEL_FILES = Object.freeze(
  CLIMB_SLOTS.map((slot) => `${slot.model}.ydr`),
);
/** Типы — собираются заново вместе с моделями (границы архетипов, копии). */
export const CLIMB_TYPES_FILE = `${CLIMB_SET.types}.ytyp`;
/**
 * Расстановка — от хоста: без наложений байт в байт мода, с ними — с
 * правками мест (копии «только лицом», убранные места).
 */
export const CLIMB_MAP_FILE = `${CLIMB_SET.map}.ymap`;
/**
 * Файлы набора, которые едут как есть.
 *
 * `_manifest.ymf` связывает расстановку `climbs.ymap` с типами
 * `climbs.ytyp` — без него игра не грузит типы, и меток в мире нет. Имя
 * менять нельзя.
 */
export const CLIMB_DATA_FILES = Object.freeze(["_manifest.ymf"]);
/** Файлы, что есть в каждом наборе; копии меток «только лицом» — сверх них. */
export const CLIMB_RESOURCE_FILES = Object.freeze([
  ...CLIMB_MODEL_FILES,
  CLIMB_TYPES_FILE,
  CLIMB_MAP_FILE,
  ...CLIMB_DATA_FILES,
]);
const MOD_ID_PATTERN = /^local-legacy-climbs-[a-f0-9]{12}$/;
/* Запрос хосту: 3 — спина плашки читается, копии меток «только лицом» и
   правки расстановки (2 — набор climbs, плашка на любой оси). */
const CLIMB_REQUEST_VERSION = 3;
/*
 * Хост, собранный до набора climbs, команду знает, а запрос — нет: он
 * отвечает «unknown format» (или ждёт пять моделей panika). Это не порча
 * файлов и не ошибка человека, а старый движок — говорится так же, как у
 * команд, которых хост не знает вовсе (`ASTRAL_NATIVE_STALE`).
 */
const STALE_COMPILER =
  /request has an unknown format|exactly five markers|panika1z/i;

export function explainStaleCompiler(error) {
  const message = String(error?.message || error || "");
  if (!STALE_COMPILER.test(message)) return error;
  const stale = new Error(
    "Движок Astral собран раньше, чем появились новые залазы: перезапустите " +
      "Astral ярлыком (он пересоберёт движок) или обновите приложение. " +
      `(${message})`,
  );
  stale.code = "ASTRAL_NATIVE_STALE";
  stale.cause = error;
  return stale;
}
/* PNG метки 1024×1024 — сотни килобайт; предел с запасом против мусора. */
const MAX_TEXTURE_BASE64 = 16 * 1024 * 1024;
const MAX_TEXTURE_PIXELS = 2048 * 2048;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function atomicWrite(file, bytes) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, bytes, { flag: "wx" });
  try {
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

const exists = (target) =>
  fs
    .access(target)
    .then(() => true)
    .catch(() => false);

/**
 * Где лежат исходники мода.
 *
 * В собранном приложении — рядом с остальными ресурсами, в разработке — в
 * репозитории. Переменная окружения оставлена для тестов и для проверки
 * своей сборки набора, без неё порядок обычный.
 */
export async function climbResourceRoot() {
  const candidates = [
    process.env.ASTRAL_CLIMB_RESOURCES,
    process.resourcesPath && path.join(process.resourcesPath, "climbs"),
    path.resolve(dirname, "../../../resources/climbs"),
  ].filter(Boolean);
  for (const candidate of candidates)
    if (await exists(path.join(candidate, CLIMB_TYPES_FILE))) return candidate;
  throw new Error(
    "Файлы залазов не найдены рядом с приложением — переустановите Astral.",
  );
}

/* ------------------------------------------------------------------ *
 * Текстуры от окна
 * ------------------------------------------------------------------ */

/**
 * Картинка метки от окна → проверенные пиксели нужного размера.
 *
 * Размер обязан совпасть с раскладкой контракта: плашку в модели считает та
 * же раскладка, и текстура другой стороны легла бы на неё со сдвигом полей.
 */
export async function decodeClimbTexture(entry, layout, label) {
  const data = typeof entry?.data === "string" ? entry.data : "";
  if (
    !data ||
    data.length > MAX_TEXTURE_BASE64 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(data)
  )
    throw new RangeError(`Текстура метки «${label}» не читается.`);
  let decoded;
  try {
    decoded = await sharp(Buffer.from(data, "base64"), {
      failOn: "error",
      limitInputPixels: MAX_TEXTURE_PIXELS,
    })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new RangeError(`Текстура метки «${label}» — не картинка.`);
  }
  const { info } = decoded;
  if (
    info.width !== layout.width ||
    info.height !== layout.height ||
    info.channels !== 4
  )
    throw new RangeError(
      `Текстура метки «${label}» ${info.width}×${info.height}, а раскладка ждёт ${layout.width}×${layout.height}.`,
    );
  return new Uint8ClampedArray(
    decoded.data.buffer,
    decoded.data.byteOffset,
    decoded.data.byteLength,
  );
}

/*
 * Заказ хосту: по метке на модель. Скрытая метка едет без текстуры — хост
 * поставит на её место прозрачную плашку, и модель, которую ждёт
 * расстановка, останется на месте. Вместе с заказом — облик каждой метки
 * (`looks`: плашка и пиксели), по нему ищутся места, где метки мода стоят
 * друг на друге.
 */
async function writeMarkerTextures({ design, textures, directory }) {
  const emission = climbMarkerEmission(design);
  const markers = [];
  const looks = {};
  for (const slot of CLIMB_SLOTS) {
    const layout = climbMarkerLayout(design, slot.id);
    const visible = design.markers[slot.id].enabled;
    const base = {
      model: slot.model,
      visible,
      texture: null,
      textureSha256: null,
      width: layout.width,
      height: layout.height,
      quad: layout.quad,
      lit: emission.lit,
      emissive: emission.multiplier,
      back: "readable",
    };
    if (!visible) {
      markers.push(base);
      looks[slot.model] = null;
      continue;
    }
    const rgba = await decodeClimbTexture(
      textures?.[slot.id],
      layout,
      slot.label,
    );
    looks[slot.model] = {
      quad: layout.quad,
      width: layout.width,
      height: layout.height,
      rgba,
    };
    const dds = await encodeDdsPooled({
      width: layout.width,
      height: layout.height,
      format: CLIMB_TEXTURE_FORMAT,
      mipLevels: fullMipLevels(layout.width, layout.height),
      rgba: bleedTransparent(
        new Uint8ClampedArray(rgba),
        layout.width,
        layout.height,
      ),
    });
    const file = path.join(directory, `${slot.model}.dds`);
    await fs.writeFile(file, dds, { flag: "wx" });
    markers.push({
      ...base,
      texture: file,
      textureSha256: `sha256:${sha256(dds)}`,
    });
  }
  return { markers, looks };
}

/*
 * Места, где метки мода стоят друг на друге, и что с ними делать хосту.
 *
 * Номера мест имеют смысл только для той расстановки, по которой размечены
 * (`placements.js`): если в ресурсах лежит другая, правки ушли бы не тем
 * местам — сборка останавливается.
 */
async function overlapEdits({ root, markers, looks }) {
  const map = await fs.readFile(path.join(root, CLIMB_MAP_FILE));
  if (sha256(map) !== CLIMB_PLACEMENTS_SOURCE.sha256)
    throw new Error(
      "Расстановка залазов рядом с приложением не та, по которой размечены места, — переустановите Astral.",
    );
  const overlaps = resolveClimbOverlaps({
    placements: CLIMB_PLACEMENTS,
    looks,
  });
  const copied = [...new Set(overlaps.frontOnly.map((item) => item.model))];
  const copies = copied.map((model) => ({
    ...markers.find((marker) => marker.model === model),
    model: climbFrontOnlyModel(model),
    archetype: model,
    back: "none",
  }));
  return {
    overlaps,
    copies,
    placements: {
      rename: overlaps.frontOnly.map(({ index, model }) => ({
        index,
        archetype: climbFrontOnlyModel(model),
      })),
      remove: overlaps.removed.map(({ index }) => index),
    },
  };
}

/* Что сделано с наложениями — для окна и журнала. */
const overlapSummary = ({ overlaps, copies }) => ({
  pairs: overlaps.pairs.length,
  frontOnly: overlaps.frontOnly.length,
  copies: copies.map((copy) => copy.model),
  removed: overlaps.removed,
});

/* ------------------------------------------------------------------ *
 * Пакет
 * ------------------------------------------------------------------ */

export function buildClimbManifest({ name, files }) {
  const digest = climbSourceDigest(files);
  return {
    id: `local-legacy-climbs-${digest.slice(0, 12)}`,
    version: `1.0.0-${digest.slice(0, 12)}`,
    name: `Astral climbs: ${name}`.slice(0, 120),
    editions: ["Legacy"],
    // Прямая схема слоя Astral: настоящий update.rpf, контейнер
    // x64/astral/astral_climbs.rpf, регистрация в content.xml, без загрузчика.
    scope: "game-root",
    adapter: "rpf-entry",
    requiresLoader: false,
    gameplayChanges: true,
    capabilities: [
      "rpf-container-entry-v1",
      "astral-content-rpf-v1",
      "direct-update-rpf-v1",
      "direct-update-entries-v1",
    ],
    slots: ["climbs"],
    climbs: {
      schemaVersion: 1,
      sourceDigest: `sha256:${digest}`,
      resourceCount: files.length,
    },
    files: files.map((file) => ({
      source: `payload/${file.name}`,
      target: "update/update.rpf",
      action: "import",
      entry: `${CLIMBS_CONTAINER}/${file.name}`,
      merge: { strategy: "rpf-resource-layer-v1" },
      size: file.size,
      sha256: file.sha256,
    })),
  };
}

/** Макет → хеш: план и установка обязаны говорить об одном и том же. */
export const climbDesignHash = (design) =>
  `sha256:${sha256(Buffer.from(JSON.stringify(normalizeClimbDesign(design))))}`;

/**
 * Готовый к установке набор: десять собранных моделей (и копии «только
 * лицом» для мест спина к спине), собранные типы, расстановка от хоста и
 * манифест.
 *
 * Папка адресуется содержимым: одинаковые метки дают один и тот же digest,
 * поэтому повторная сборка не плодит копий, а повторная установка того же
 * набора движку не нужна. `compile` — вызов нативного хоста (в тестах —
 * подмена: проверять надо сборку пакета, а не Windows).
 */
export async function buildClimbPackage({
  design: input,
  textures,
  stateDir,
  compile,
  resourceRoot = null,
}) {
  if (typeof compile !== "function")
    throw new Error("Сборщик моделей залазов не подключён.");
  const design = normalizeClimbDesign(input);
  const root = resourceRoot || (await climbResourceRoot());
  const staging = path.join(stateDir, "climb-editor", "staging", randomUUID());
  const output = path.join(staging, "out");
  await fs.mkdir(staging, { recursive: true });
  try {
    const { markers, looks } = await writeMarkerTextures({
      design,
      textures,
      directory: staging,
    });
    const edits = await overlapEdits({ root, markers, looks });
    const request = path.join(staging, "request.json");
    await fs.writeFile(
      request,
      JSON.stringify({
        format: "astral.compile-climb-markers",
        version: CLIMB_REQUEST_VERSION,
        types: path.join(root, CLIMB_TYPES_FILE),
        typesName: CLIMB_SET.types,
        map: { input: path.join(root, CLIMB_MAP_FILE), name: CLIMB_SET.map },
        markers: [...markers, ...edits.copies],
        placements: edits.placements,
      }),
    );
    await compile("compile-climb-markers", { input: request, output }).catch(
      (error) => {
        throw explainStaleCompiler(error);
      },
    );

    const built = [];
    for (const name of [
      ...CLIMB_MODEL_FILES,
      ...edits.copies.map((copy) => `${copy.model}.ydr`),
      CLIMB_TYPES_FILE,
      CLIMB_MAP_FILE,
    ]) {
      const file = path.join(output, name);
      const stat = await fs.stat(file).catch(() => null);
      if (!stat?.isFile()) throw new Error(`Сборка залазов не дала ${name}.`);
      built.push({ name, bytes: await fs.readFile(file) });
    }
    for (const name of CLIMB_DATA_FILES)
      built.push({ name, bytes: await fs.readFile(path.join(root, name)) });

    const files = built.map((file) => ({
      name: file.name,
      size: file.bytes.length,
      sha256: sha256(file.bytes),
    }));
    const manifest = buildClimbManifest({ name: design.name, files });
    const digest = manifest.climbs.sourceDigest.replace(/^sha256:/, "");
    const directory = path.join(
      stateDir,
      "climb-editor",
      "packages",
      digest.slice(0, 12),
    );
    for (const file of built) {
      const target = path.join(directory, "payload", file.name);
      const current = await fs.readFile(target).catch(() => null);
      if (!current || !current.equals(file.bytes))
        await atomicWrite(target, file.bytes);
    }
    return Object.freeze({
      directory,
      design,
      designHash: climbDesignHash(design),
      digest: `sha256:${digest}`,
      manifest,
      manifestHash: `sha256:${sha256(Buffer.from(canonicalManifest(manifest)))}`,
      resources: files,
      markers: markers.map((marker, index) => ({
        slot: CLIMB_SLOTS[index].id,
        model: marker.model,
        visible: marker.visible,
        variant: design.markers[CLIMB_SLOTS[index].id].variant,
        width: marker.visible ? marker.width : 0,
        height: marker.visible ? marker.height : 0,
      })),
      emission: climbMarkerEmission(design),
      overlaps: overlapSummary(edits),
    });
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Набор, собранный планом, перед установкой.
 *
 * Между планом и установкой проходят секунды, но папка — на диске
 * человека: облачные папки и антивирусы умеют подменять файлы на лету.
 * Ставится ровно то, что посчитано в манифесте.
 */
async function assertPackageIntact(built) {
  for (const file of built.manifest.files) {
    const payload = path.join(built.directory, file.source);
    const actual = await sha256File(payload).catch(() => null);
    if (actual !== file.sha256)
      throw new Error(
        `Файл залазов ${path.basename(payload)} изменился после проверки — нажмите «Применить» ещё раз.`,
      );
  }
}

function installOptions(built, input, stateDir, extra = {}) {
  return {
    manifest: built.manifest,
    packageRoot: built.directory,
    gameRoot: path.resolve(String(input.gameRoot || "")),
    targetId: String(input.targetId || "default"),
    edition: "Legacy",
    stateDir,
    // Слой Astral пишет в настоящий update.rpf; право даёт строгая форма
    // манифеста залазов, а не этот флаг сам по себе.
    allowGameRootWrites: true,
    requireSignature: false,
    rpfProbe: probeRpfArchive,
    ...extra,
  };
}

/*
 * Запись переигрывания залазов (`engineReplay`, шаг 3 фазы 7, за флагом `ASTRAL_ENGINE_INSTALL=climb-customizer`):
 * имя набора, отпечаток и список файлов. Сами файлы лежат в постоянной папке пакета в `stateDir`.
 */
export function climbReplayRecord(built) {
  return {
    module: "climb-customizer",
    workId: built.manifest.id,
    version: built.manifest.version,
    sourceDigest: built.digest,
    order: {
      files: built.resources.map((file) => ({ name: file.name, sha256: file.sha256 })),
    },
  };
}

/*
 * Пакет залазов для переигрывания: файлы на месте, их SHA-256 — те, что в записи, и дайджест набора
 * пересчитывается и сходится. Иначе — отказ, который называет работу, до записи в игру.
 */
export async function climbReplayPackage(stateDir, replay) {
  const workName = String(replay?.workId || "залазы");
  const digest = String(replay?.sourceDigest || "");
  const listed = Array.isArray(replay?.order?.files) ? replay.order.files : [];
  if (!/^sha256:[0-9a-f]{64}$/.test(digest) || !listed.length)
    throw new Error(`Работа «${workName}»: запись переигрывания испорчена — поставьте работу заново из мастерской.`);
  const hex = digest.slice("sha256:".length);
  const packageRoot = path.join(path.resolve(String(stateDir || "")), "climb-editor", "packages", hex.slice(0, 12));
  const files = [];
  for (const item of listed) {
    const name = String(item?.name || "");
    const file = path.join(packageRoot, "payload", name);
    const stat = name ? await fs.stat(file).catch(() => null) : null;
    if (!stat?.isFile())
      throw new Error(`Работа «${workName}»: пакет для переигрывания удалён — переустановите работу из мастерской.`);
    const sha = await sha256File(file);
    if (sha !== String(item.sha256 || ""))
      throw new Error(`Работа «${workName}»: пакет для переигрывания изменён — переустановите работу из мастерской.`);
    files.push({ name, size: stat.size, sha256: sha });
  }
  if (`sha256:${climbSourceDigest(files)}` !== digest)
    throw new Error(`Работа «${workName}»: пакет для переигрывания изменён — переустановите работу из мастерской.`);
  return { packageRoot, files };
}

const replacementIds = (plan) =>
  [...new Set((plan.conflicts || []).map((item) => item.modId))].sort();

const summary = (built) => ({
  modId: built.manifest.id,
  digest: built.digest,
  manifestHash: built.manifestHash,
  resources: built.resources.map((file) => file.name),
  markers: built.markers,
  emission: built.emission,
  overlaps: built.overlaps,
  entry: CLIMBS_CONTAINER,
  archive: "update/update.rpf",
  edition: "Legacy",
  restartRequired: true,
});

/**
 * План: собрать набор и спросить движок, что он сделает. Собранный набор
 * возвращается вместе с планом (`built`) — установка ставит ровно его.
 */
export async function planClimbCustomization(
  input,
  stateDir,
  dependencies = {},
) {
  const gameRoot = path.resolve(String(input?.gameRoot || ""));
  await dependencies.assertGameReady?.(gameRoot, { mutate: false });
  const built = await buildClimbPackage({
    design: input.design,
    textures: input.textures,
    stateDir,
    compile: dependencies.compile,
    resourceRoot: dependencies.resourceRoot,
  });
  const plan = await planPackage(installOptions(built, input, stateDir));
  return {
    plan: {
      ...plan,
      ...summary(built),
      replaceModIds: replacementIds(plan),
      rollbackReady: true,
    },
    built,
  };
}

export async function applyClimbCustomization(
  input,
  stateDir,
  dependencies = {},
) {
  const gameRoot = path.resolve(String(input?.gameRoot || ""));
  const game = await dependencies.assertGameReady?.(gameRoot, { mutate: true });
  const built = input.built;
  if (!built?.manifest || built.manifestHash !== input.expectedManifestHash)
    throw new Error("План установки залазов устарел.");
  await assertPackageIntact(built);
  const currentPlan = await planPackage(installOptions(built, input, stateDir));
  /* Флаг `ASTRAL_ENGINE_INSTALL=climb-customizer`: подмену `update.rpf` ведёт движок, точка — с `replay.json`. */
  const engineInstall = engineInstallEnabled("climb-customizer")
    ? {
        install: dependencies.installPrebuilt ?? installRpfPrebuilt,
        edition: "Legacy",
        gameRoot,
        pointsRoot: dependencies.pointsRoot ?? nativeRestorePointsRoot(),
        replay: climbReplayRecord(built),
      }
    : null;
  const installed = await installLocalClimbPackage(
    installOptions(built, input, stateDir, {
      replaceModIds: replacementIds(currentPlan),
      rpfComposer: composeRpfArchive,
      dlcListProvider: provideLegacyDlcList,
      contentXmlProvider: provideUpdateContentXml,
      assertRuntimeSafety: () => dependencies.assertRuntimeSafety?.(game),
      /* Пересборка архива игры идёт десятки секунд. Без вестей окно
         выглядит зависшим, и человек закрывает его посреди работы. */
      onProgress: dependencies.onProgress,
      ...(engineInstall ? { engineInstall } : {}),
    }),
  );
  return {
    ...installed,
    ...summary(built),
    installId: built.manifest.id,
    kind: "local-legacy-climbs",
    status: "active",
    gameRoot,
    targetId: String(input.targetId || "default"),
    installedAt: new Date().toISOString(),
  };
}

export async function removeClimbCustomization(
  input,
  stateDir,
  dependencies = {},
) {
  const gameRoot = path.resolve(String(input?.gameRoot || ""));
  const game = await dependencies.assertGameReady?.(gameRoot, { mutate: true });
  const modId = String(input?.modId || "");
  if (!MOD_ID_PATTERN.test(modId))
    throw new Error("Некорректный modId залазов.");
  const result = await uninstallPackage({
    modId,
    targetId: String(input?.targetId || "default"),
    stateDir,
    rpfComposer: composeRpfArchive,
    contentXmlProvider: provideUpdateContentXml,
    dlcListProvider: provideLegacyDlcList,
    assertRuntimeSafety: () => dependencies.assertRuntimeSafety?.(game),
    onProgress: dependencies.onProgress,
  });
  return {
    ...result,
    installId: modId,
    modId,
    kind: "local-legacy-climbs",
    status: "rolled-back",
    restartRequired: true,
    gameRoot,
    targetId: String(input?.targetId || "default"),
  };
}
