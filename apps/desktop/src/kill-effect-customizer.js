/*
 * Килл-эффект: чтение того, что стоит у игрока, и сборка мода.
 *
 * Редактор в окне не знает про архивы. Он присылает проект — вспышку и знак
 * на килле — и кадры своей картинки, а этот модуль достаёт из `update.rpf`
 * настоящие файлы игрока и меняет в них только своё:
 *
 *   timecycle_mods_4.xml  — модификатор `hud_def_desat_cold_kill`;
 *   visualsettings.dat    — ключ `misc.PedKillOverlay.duration`;
 *   hud_reticle.gfx       — клип крестика над прицелом (знак на килле);
 *   hud_reticle.ytd       — кадры картинки знака (`astral_kill_NN`).
 *
 * Патч уходит тому же нативному установщику, что ставит небо, прицел и
 * мини-карту.
 *
 * Файлы читаются всегда заново, перед каждой сборкой и одним заходом в
 * архив: между планом и установкой игрок мог поставить редукс, и класть
 * правку на устаревшую копию значило бы затереть его свежий таймцикл.
 *
 * С соседями по файлам работа уживается тремя способами:
 *   • правит только своё и поверх живого файла — чужой прицел, редукс,
 *     небо из мастерской остаются как есть;
 *   • рядом с патчем лежит `recompose.json`: удаляя из библиотеки то, что
 *     стояло под килл-эффектом, приложение пересобирает его поверх нового
 *     архива, а не ставит прежний патч со снимком чужих файлов;
 *   • поставленный модификатор записан для движка каталога
 *     (`workshop-overlays.js`): пересборка архива ради мода из каталога не
 *     сотрёт его килл-модификатором редукса.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { encodeDds } from "@modovik/dds";
import {
  KILL_MARKER_EDGE,
  KILL_MARKER_MAX_FRAMES,
  KILL_MODIFIER_ARCHIVE_PATH,
  KILL_MODIFIER_ENTRY,
  KILL_MODIFIER_FILE,
  KILL_MODIFIER_NAME,
  VISUAL_SETTINGS_ARCHIVE_PATH,
  VISUAL_SETTINGS_ENTRY,
  VISUAL_SETTINGS_FILE,
  describeKillEffect,
  killMarkerSignature,
  normalizeFrameDelays,
  parseKillEffectProject,
  resolveKillEffectFields,
  serializeKillModifierNode,
} from "@modovik/kill-effects";
import {
  compileKillEffectProject,
  importKillEffectFromGame,
  killEffectPatchManifest,
} from "@modovik/kill-effects/compile.js";
import {
  KILL_MARKER_TEXTURE_PREFIX,
  compileKillMarkerGfx,
  inspectKillMarkerGfx,
  killMarkerTextureName,
} from "./kill-marker-gfx.js";
import { provisionArchiveSupport } from "./loader-provisioner.js";
import { callNativeEngine } from "./native-engine.js";
import {
  registerPatchRecomposer,
  writeRecomposeSidecar,
} from "./patch-recompose.js";
import { extractRpfEntries, setYtdTextureFamily } from "./rpf-composer.js";
import { rememberTimecycleOverlay } from "./workshop-overlays.js";

export const RETICLE_GFX_ENTRY =
  "x64/data/cdimages/scaleform_generic.rpf/hud_reticle.gfx";
export const RETICLE_YTD_ENTRY =
  "x64/data/cdimages/scaleform_generic.rpf/hud_reticle.ytd";
const RETICLE_GFX_TARGET = `update:/${RETICLE_GFX_ENTRY}`;
const RETICLE_YTD_TARGET = `update:/${RETICLE_YTD_ENTRY}`;

/* Приоритет килл-модификатора мастерской для движка каталога — тот же, что
   у слота `kill-effects` в `@modovik/mod-targets`: выше таймцикла (100). */
const KILL_OVERLAY_PRIORITY = 200;

/*
 * Нативный движок, распаковка, словарь текстур и поставщик ArchiveFix
 * приходят параметрами, а не намертво из импорта: в бою это те же функции,
 * а в тестах это единственный способ проверить сборку патча без Windows и
 * установленной игры.
 */
const defaultTools = () => ({
  native: callNativeEngine,
  archiveSupport: provisionArchiveSupport,
  extract: extractRpfEntries,
  ytdFamily: setYtdTextureFamily,
});

const MAX_PROJECT_BYTES = 256 * 1024;
/* Кадр от окна — PNG или WebP 256×256: десятки килобайт. Потолок с запасом
   на пёструю картинку, но не на «снимок с телефона». */
const MAX_FRAME_BASE64 = 700_000;

function boundedProject(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new TypeError("Проект килл-эффекта обязателен.");
  const serialized = JSON.stringify(input);
  if (Buffer.byteLength(serialized, "utf8") > MAX_PROJECT_BYTES)
    throw new RangeError("Проект килл-эффекта превышает 256 КБ.");
  return parseKillEffectProject(JSON.parse(serialized));
}

function requireGameRoot(input) {
  const selected = String(input?.gameRoot || "").trim();
  if (!selected || !path.isAbsolute(selected))
    throw new Error("Выберите папку GTA V Legacy.");
  return path.resolve(selected);
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const workRoot = (stateDir) =>
  path.join(stateDir || os.tmpdir(), "kill-effect-bases");

const normalizeEntry = (value) =>
  String(value || "")
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .toLowerCase();

/**
 * Файлы игрока одним заходом в архив. Хост и помощник открывают update.rpf
 * без совместного доступа, и четыре отдельных чтения стоили бы четырёх
 * открытий двухгигабайтного архива — «Читаем файлы вашей GTA V…» висело
 * заметно дольше, чем работал сам разбор.
 *
 * Отсутствие файла — это состояние, а не сбой: у Enhanced-сборок и у чужих
 * модов состав `update.rpf` отличается, и об этом надо сказать, а не упасть.
 * Возвращается рабочая папка — её убирает вызывающий.
 */
async function readBases(input, stateDir, tools, { reticle = false } = {}) {
  const { extract } = { ...defaultTools(), ...tools };
  const gameRoot = requireGameRoot(input);
  const directory = path.join(workRoot(stateDir), randomUUID());
  await fs.mkdir(directory, { recursive: true });
  const entries = [
    KILL_MODIFIER_ENTRY,
    VISUAL_SETTINGS_ENTRY,
    ...(reticle ? [RETICLE_GFX_ENTRY, RETICLE_YTD_ENTRY] : []),
  ];
  try {
    const result = await extract({
      archivePath: path.join(gameRoot, "update", "update.rpf"),
      archiveTarget: "update/update.rpf",
      entries,
      outputDirectory: directory,
      gameRoot,
      edition: "Legacy",
    });
    const files = new Map(
      (result?.extracted || []).map((item) => [
        normalizeEntry(item.entry),
        item.output,
      ]),
    );
    const text = async (entry) => {
      const file = files.get(entry);
      return file ? fs.readFile(file, "utf8") : null;
    };
    const reticleGfxFile = files.get(RETICLE_GFX_ENTRY) || null;
    return {
      gameRoot,
      directory,
      timecycleXml: await text(KILL_MODIFIER_ENTRY),
      visualSettingsText: await text(VISUAL_SETTINGS_ENTRY),
      reticleGfx: reticleGfxFile ? await fs.readFile(reticleGfxFile) : null,
      reticleYtdFile: files.get(RETICLE_YTD_ENTRY) || null,
    };
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

const release = (bases) =>
  bases?.directory
    ? fs.rm(bases.directory, { recursive: true, force: true }).catch(() => {})
    : null;

/*
 * Файл таймцикла, испорченный чужим модом (бета 14.10, shelo4: «7:13:
 * unexpected close tag.» — в первом модификаторе не закрыто поле), —
 * словами с именем файла и строкой. Окно узнаёт этот текст
 * (`installFailure.js`, семейство «timecycle-broken») и говорит на своём
 * языке. Разбор остаётся строгим: прощать ли такие файлы, как игра, решает
 * владелец таймцикла.
 */
const XML_POSITION = /^(\d+):(\d+):\s*([\s\S]+)$/;

export function timecycleBreak(error) {
  const message = String(error?.message || error || "").trim();
  const position = XML_POSITION.exec(message);
  if (position)
    return Object.assign(
      new Error(
        `Файл ${KILL_MODIFIER_FILE} в игре испорчен другим модом: строка ${position[1]}, столбец ${position[2]} (${position[3].trim()})`,
      ),
      { file: KILL_MODIFIER_FILE, line: Number(position[1]), column: Number(position[2]) },
    );
  if (/\btimecycle\b/i.test(message))
    return Object.assign(
      new Error(`Файл ${KILL_MODIFIER_FILE} в игре испорчен другим модом (${message})`),
      { file: KILL_MODIFIER_FILE, line: null, column: null },
    );
  return null;
}

/* Знак в клипе прицела — словами, которые поймёт окно. */
function markerState(gfx) {
  if (!gfx) return { available: false };
  try {
    const inspected = inspectKillMarkerGfx(gfx);
    return {
      available: true,
      installed: inspected.installed,
      signature: inspected.signature,
      hidden: inspected.hidden,
    };
  } catch (error) {
    return { available: false, reason: String(error?.message || error) };
  }
}

/**
 * Что у игрока стоит на килле прямо сейчас.
 *
 * Возвращается разобранный проект, а не сырой XML: файл весит триста с лишним
 * килобайт, и гонять его в окно только ради тринадцати ползунков незачем.
 */
export async function readKillEffectState(
  input,
  context,
  stateDir,
  tools = {},
) {
  const bases = await readBases(input, stateDir, tools, { reticle: true });
  try {
    const { timecycleXml, visualSettingsText } = bases;
    const marker = markerState(bases.reticleGfx);
    if (!timecycleXml)
      return {
        available: false,
        reason: `В архиве игры нет ${KILL_MODIFIER_FILE}.`,
        visualSettings: Boolean(visualSettingsText),
        marker,
      };
    let imported;
    try {
      imported = importKillEffectFromGame({
        timecycleXml,
        visualSettingsText,
        name: input?.name,
      });
    } catch (error) {
      const broken = timecycleBreak(error);
      if (!broken) throw error;
      /* Состояние, а не сбой: редактор работает на шаблонах, а строка
         состояния называет файл и строку словами окна. */
      return {
        available: false,
        reason: broken.message,
        broken: { file: broken.file, line: broken.line, column: broken.column },
        visualSettings: Boolean(visualSettingsText),
        marker,
      };
    }
    return {
      available: true,
      visualSettings: Boolean(visualSettingsText),
      present: imported.base.present,
      /*
       * `cleared` — это ровно тот случай, ради которого модуль и написан:
       * модификатор в файле есть, но пустой. Так делает почти каждый редукс,
       * и именно поэтому у игрока пропала вспышка при убийстве.
       */
      cleared: imported.base.present && imported.base.empty,
      fields: imported.base.fields.length,
      /* Строки модификатора как есть: окно сверяет их с тем, что ставило
         само, и видит, что файл с тех пор переписал кто-то другой. */
      modifierFields: imported.base.fields,
      declaredMods: imported.base.declaredMods ?? null,
      modifiers: imported.base.modifiers,
      duration: imported.duration,
      project: imported.project,
      summary: describeKillEffect(imported.project),
      marker,
    };
  } finally {
    await release(bases);
  }
}

/* ------------------------------------------------ кадры знака на килле */

const MIME = /^(image\/png|image\/webp)$/;

/**
 * Кадры картинки от окна → проверенные PNG 256×256.
 *
 * Окно уже привело каждый кадр к квадрату, но установщик своему входу не
 * верит: кадр разбирается заново, приводится к тому же квадрату и только
 * такой кладётся в патч и в записку пересборки.
 */
async function normalizeMarkerFrames(input) {
  const list = Array.isArray(input) ? input : [];
  if (!list.length) throw new Error("У знака на килле нет картинки.");
  if (list.length > KILL_MARKER_MAX_FRAMES)
    throw new RangeError(`У знака на килле больше ${KILL_MARKER_MAX_FRAMES} кадров.`);
  const delays = normalizeFrameDelays(list.map((frame) => frame?.delay));
  const frames = [];
  for (const [index, frame] of list.entries()) {
    const data = String(frame?.data || "");
    if (!data || data.length > MAX_FRAME_BASE64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data))
      throw new RangeError(`Кадр ${index + 1} знака не читается.`);
    if (frame?.mime && !MIME.test(String(frame.mime)))
      throw new RangeError(`Кадр ${index + 1} знака — не PNG и не WebP.`);
    const png = await sharp(Buffer.from(data, "base64"), {
      failOn: "error",
      limitInputPixels: 2048 * 2048,
    })
      .ensureAlpha()
      .resize(KILL_MARKER_EDGE, KILL_MARKER_EDGE, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
    frames.push({ png, delay: delays[index], sha256: sha256(png) });
  }
  return frames;
}

/*
 * Сторона текстуры — по тому, насколько крупным знак встанет на экране.
 * Scaleform игры рисует картинки без mip-уровней (у всех текстур HUD один
 * уровень), и 256 точек, сжатые в тридцать, мерцали бы на повороте. Поэтому
 * текстура не больше, чем вдвое крупнее знака на 1080p с запасом на
 * перелёт «хлопка», и не меньше 64.
 */
export function killMarkerTextureEdge(marker) {
  const pixels = marker.size * 1.5 * 1.3;
  let edge = 64;
  while (edge < pixels && edge < KILL_MARKER_EDGE) edge *= 2;
  return edge;
}

async function frameTexture(png, edge) {
  const { data, info } = await sharp(png)
    .resize(edge, edge, { fit: "fill", kernel: "lanczos3" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return encodeDds({
    width: info.width,
    height: info.height,
    format: "DXT5",
    mipLevels: 1,
    rgba: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
  });
}

/**
 * `hud_reticle.gfx` и `hud_reticle.ytd` со знаком — или без него, если знак
 * выключен, а в игре стоит прежний. `null` — прицел трогать незачем.
 */
async function buildReticle({ bases, project, frames, workDirectory, tools }) {
  const { ytdFamily } = { ...defaultTools(), ...tools };
  const marker = project.marker;
  const live = bases.reticleGfx ? markerState(bases.reticleGfx) : null;
  if (!marker.enabled && !live?.installed) return null;
  if (!bases.reticleGfx || !bases.reticleYtdFile)
    throw new Error(
      "В update.rpf нет hud_reticle.gfx или hud_reticle.ytd — знак на килле ставить некуда.",
    );

  const edge = marker.enabled ? killMarkerTextureEdge(marker) : 0;
  const textures = [];
  for (const [index, frame] of (marker.enabled ? frames : []).entries()) {
    const dds = await frameTexture(frame.png, edge);
    const file = path.join(workDirectory, `${killMarkerTextureName(index)}.dds`);
    await fs.writeFile(file, dds, { flag: "wx" });
    textures.push({
      texture: killMarkerTextureName(index),
      source: file,
      sha256: sha256(dds),
    });
  }
  const signature = marker.enabled ? killMarkerSignature(marker, frames) : null;
  const compiled = compileKillMarkerGfx(bases.reticleGfx, {
    marker,
    frames: textures.map((texture) => ({
      name: texture.texture,
      width: edge,
      height: edge,
    })),
    delays: frames.map((frame) => frame.delay),
    signature,
  });
  const ytd = path.join(workDirectory, "hud_reticle.ytd");
  await ytdFamily({
    input: bases.reticleYtdFile,
    output: ytd,
    family: KILL_MARKER_TEXTURE_PREFIX,
    textures,
    gameRoot: bases.gameRoot,
    edition: "Legacy",
  });
  return {
    gfx: compiled.buffer,
    ytd: await fs.readFile(ytd),
    enabled: marker.enabled,
    frames: textures.length,
    edge,
    signature,
    hidden: Boolean(compiled.hidden ?? live?.hidden),
    timelineFrames: compiled.timelineFrames,
  };
}

/* ---------------------------------------------------------------- сборка */

const fileEntry = ({ file, target, bytes }) => ({
  file,
  target,
  bytes,
  size: bytes.length,
  sha256: sha256(bytes),
});

async function materialize(input, context, stateDir, tools) {
  const project = boundedProject(input.project);
  const frames = project.marker.enabled
    ? await normalizeMarkerFrames(input.markerFrames)
    : [];
  const bases = await readBases(input, stateDir, tools, { reticle: true });
  try {
    let compiled;
    try {
      compiled = compileKillEffectProject({
        project,
        timecycleXml: bases.timecycleXml,
        visualSettingsText: bases.visualSettingsText,
      });
    } catch (error) {
      throw timecycleBreak(error) || error;
    }
    const reticle = await buildReticle({
      bases,
      project,
      frames,
      workDirectory: bases.directory,
      tools,
    });

    const files = [
      ...compiled.files.map((file) =>
        fileEntry({
          file: file.file,
          target: file.target,
          bytes: Buffer.from(file.text, "utf8"),
        }),
      ),
      ...(reticle
        ? [
            fileEntry({
              file: "hud_reticle.gfx",
              target: RETICLE_GFX_TARGET,
              bytes: reticle.gfx,
            }),
            fileEntry({
              file: "hud_reticle.ytd",
              target: RETICLE_YTD_TARGET,
              bytes: reticle.ytd,
            }),
          ]
        : []),
    ];

    const patchDirectory = path.join(
      path.resolve(stateDir || os.tmpdir()),
      "kill-effect-patches",
      randomUUID(),
    );
    const payloadDirectory = path.join(patchDirectory, "payload");
    await fs.mkdir(payloadDirectory, { recursive: true });
    for (const file of files)
      await fs.writeFile(path.join(payloadDirectory, file.file), file.bytes, {
        flag: "wx",
      });
    const manifest = killEffectPatchManifest({
      name: `Astral kill effect — ${project.name}`,
      files,
    });
    await fs.writeFile(
      path.join(patchDirectory, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { flag: "wx" },
    );
    /* Записка пересборки: проект и кадры знака, из которых патч собран. */
    const recomposeFrames = [];
    if (frames.length) {
      const framesDirectory = path.join(patchDirectory, "recompose");
      await fs.mkdir(framesDirectory, { recursive: true });
      for (const [index, frame] of frames.entries()) {
        const name = `frame-${String(index).padStart(2, "0")}.png`;
        await fs.writeFile(path.join(framesDirectory, name), frame.png, {
          flag: "wx",
        });
        recomposeFrames.push({ file: `recompose/${name}`, delay: frame.delay });
      }
    }
    await writeRecomposeSidecar(patchDirectory, {
      kind: "kill-effect",
      project,
      frames: recomposeFrames,
    });

    return {
      patch: patchDirectory,
      gameRoot: bases.gameRoot,
      project,
      files: files.map((file) => ({
        file: file.file,
        target: file.target,
        size: file.size,
        sha256: file.sha256,
      })),
      fields: compiled.fields.length,
      parameters: compiled.fields.map(([parameter]) => parameter),
      modifier: compiled.modifier,
      duration: compiled.duration,
      missing: compiled.missing,
      marker: reticle
        ? {
            enabled: reticle.enabled,
            frames: reticle.frames,
            edge: reticle.edge,
            signature: reticle.signature,
            hidden: reticle.hidden,
            removed: !reticle.enabled,
          }
        : { enabled: false, frames: 0, removed: false },
      totalBytes: files.reduce((total, file) => total + file.size, 0),
      summary: describeKillEffect(project),
    };
  } finally {
    await release(bases);
  }
}

export async function planKillEffectCustomization(
  input,
  context,
  stateDir,
  tools = {},
) {
  const { native } = { ...defaultTools(), ...tools };
  const generated = await materialize(input, context, stateDir, tools);
  const validation = await native(
    "validate-rpf-patch",
    { patch: generated.patch },
    context,
  );
  return {
    ...generated,
    validation,
    platform: "Majestic / GTA5RP",
    edition: "Legacy",
    archive: "update/update.rpf",
  };
}

/*
 * Поставленный модификатор — движку каталога: его пересборка кладёт
 * килл-эффект поверх таймцикла редукса (`timecycle-composer.js`).
 */
async function rememberOverlay(stateDir, generated) {
  const fields = resolveKillEffectFields(generated.project);
  await rememberTimecycleOverlay(stateDir, {
    gameRoot: generated.gameRoot,
    entry: KILL_MODIFIER_ENTRY,
    owner: "workshop:kill-effect",
    priority: KILL_OVERLAY_PRIORITY,
    modifiers: {
      [KILL_MODIFIER_NAME]: serializeKillModifierNode(fields).trimEnd(),
    },
  });
}

export async function applyKillEffectCustomization(
  input,
  context,
  stateDir,
  { assertRuntimeSafety, ...tools } = {},
) {
  const { native, archiveSupport } = { ...defaultTools(), ...tools };
  const generated = await materialize(input, context, stateDir, tools);
  await assertRuntimeSafety?.(generated.gameRoot);
  const support = await archiveSupport({ stateDir });
  const installed = await native(
    "install-rpf-patch",
    {
      patch: generated.patch,
      gameRoot: generated.gameRoot,
      archiveFix: path.join(support.directory, "ArchiveFix.exe"),
      keys: support.directory,
    },
    context,
  );
  /* Запись для движка — не часть установки: её сбой не отменяет того, что
     уже встало в игру. */
  await rememberOverlay(stateDir, generated).catch(() => {});
  return {
    ...installed,
    ...generated,
    platform: "Majestic / GTA5RP",
    edition: "Legacy",
  };
}

/*
 * Пересборка перед возвратом в игру (`patch-recompose.js`): тот же проект и
 * те же кадры поверх архива, каким он стал после перемотки.
 */
registerPatchRecomposer(
  "kill-effect",
  async ({ sidecar, directory, gameRoot, stateDir, context, tools = {} }) => {
    const markerFrames = [];
    for (const frame of Array.isArray(sidecar.frames) ? sidecar.frames : []) {
      const file = path.resolve(directory, String(frame?.file || ""));
      if (!file.startsWith(path.resolve(directory) + path.sep))
        throw new Error("Кадр знака в записке пересборки лежит вне патча.");
      markerFrames.push({
        data: (await fs.readFile(file)).toString("base64"),
        mime: "image/png",
        delay: frame.delay,
      });
    }
    const generated = await materialize(
      { gameRoot, project: sidecar.project, markerFrames },
      context,
      stateDir,
      tools,
    );
    await rememberOverlay(stateDir, generated).catch(() => {});
    return { patch: generated.patch };
  },
);

/* Пути записей для отчёта установки и тестов. */
export const KILL_EFFECT_TARGETS = Object.freeze({
  timecycle: KILL_MODIFIER_ARCHIVE_PATH,
  visualSettings: VISUAL_SETTINGS_ARCHIVE_PATH,
  reticleGfx: RETICLE_GFX_TARGET,
  reticleYtd: RETICLE_YTD_TARGET,
});
export { VISUAL_SETTINGS_FILE };
