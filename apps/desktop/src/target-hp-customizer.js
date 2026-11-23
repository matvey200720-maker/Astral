/*
 * «Полоска HP» — полоска здоровья и брони над игроком, свой редактор
 * мастерской (задача 2 ТЗ 11.10.2026: утром она была инструментом прицела,
 * днём владелец вынес её отдельно).
 *
 * Редактор присылает работу (`@modovik/reticle-contract`,
 * `normalizeTargetHpProject`), а здесь из `update.rpf` игрока берётся
 * штатная метка игрока `mp_gamer_info.gfx` и в неё встаёт своя полоска
 * (`target-health-gfx-compiler.js`). Пакет — один файл, свой нативный патч
 * со своей точкой отката (семейство `target-hp-patches`), рядом —
 * `recompose.json`: библиотека, снимая работу под этой, собирает её заново
 * поверх нового архива.
 *
 * База — всегда метка без полоски Astral: живой файл, а если в нём уже
 * стоит своя полоска (прежняя установка этого редактора или утреннего
 * прицела) — резервная копия Astral или память проверенной базы
 * (`game-scaleform-base.js`). Поэтому «Применить» поверх прежней полоски
 * не наслаивает вторую, а снятие точкой отката возвращает игре её файл.
 *
 * Прицел mp_gamer_info.gfx больше не читает и не пишет: его «Применить» не
 * стирает полоску этого редактора.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { describeTargetHealth, normalizeTargetHpProject } from "@modovik/reticle-contract";
import { UPDATE_ARCHIVE, requireGameRoot, resolveGameScaleformBase } from "./game-scaleform-base.js";
import {
  GAMER_INFO_GFX_ENTRY,
  GAMER_INFO_GFX_TARGET,
  compileTargetHealthGfx,
  verifyTargetHealthBase,
} from "./target-health-gfx-compiler.js";
import { provisionArchiveSupport } from "./loader-provisioner.js";
import { callNativeEngine } from "./native-engine.js";
import { registerPatchRecomposer, writeRecomposeSidecar } from "./patch-recompose.js";

const defaultTools = () => ({
  native: callNativeEngine,
  archiveSupport: provisionArchiveSupport,
});

/* Семейство патча: по папке библиотека называет работу (`installed-manager.js`). */
export const TARGET_HP_PATCH_FAMILY = "target-hp-patches";
const MAX_PROJECT_BYTES = 16 * 1024;

/*
 * Метка игрока той же игры тем же порядком доверия, что прицел и мини-карта.
 * Каталогу она не «принадлежит»: чужая метка из каталога — тоже основа,
 * полоска ложится поверх неё. Своя полоска основой не бывает — проверка её
 * отвергает. Память — та же папка, что у утренней полоски прицела.
 */
const GAMER_INFO_BASE = Object.freeze({
  memory: "gamer-info-bases",
  files: Object.freeze([{ key: "gfx", entry: GAMER_INFO_GFX_ENTRY, extension: "gfx" }]),
  catalogOwns: () => false,
  verify: ({ gfx }) => verifyTargetHealthBase(gfx),
  memoryLabel: "проверенная ранее метка игрока этой игры",
  missing: "в архиве нет mp_gamer_info.gfx",
  notFound:
    "Не удалось найти штатную метку игрока игры (mp_gamer_info.gfx), поверх которой собирается полоска HP.",
});

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function boundedProject(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Работа полоски HP обязательна.");
  const serialized = JSON.stringify(input);
  if (Buffer.byteLength(serialized, "utf8") > MAX_PROJECT_BYTES) throw new RangeError("Работа полоски HP больше 16 КБ.");
  return normalizeTargetHpProject(JSON.parse(serialized));
}

/** Штатная метка игрока этой игры — путь к проверенной копии. */
export async function resolveGamerInfoBase({ gameRoot, stateDir }, tools = {}) {
  return resolveGameScaleformBase({ gameRoot, stateDir }, GAMER_INFO_BASE, tools);
}

/**
 * Пакет полоски: `payload/mp_gamer_info.gfx`, `manifest.json` и записка
 * пересборки. Ничего не пишет в игру.
 */
export async function materializeTargetHp(input, stateDir, tools = {}) {
  const gameRoot = requireGameRoot(input);
  const project = boundedProject(input.project);
  const base = await resolveGamerInfoBase({ gameRoot, stateDir }, tools);
  const stock = await fs.readFile(base.gfxFile);
  const compiled = compileTargetHealthGfx(stock, project);

  const patchDirectory = path.join(path.resolve(String(stateDir || "")), TARGET_HP_PATCH_FAMILY, randomUUID());
  const payloadDirectory = path.join(patchDirectory, "payload");
  await fs.mkdir(payloadDirectory, { recursive: true });
  await fs.writeFile(path.join(payloadDirectory, "mp_gamer_info.gfx"), compiled.buffer, { flag: "wx" });
  const summary = describeTargetHealth(project);
  const action = {
    Type: "Replace",
    TargetPath: GAMER_INFO_GFX_TARGET,
    SourcePath: "payload/mp_gamer_info.gfx",
    Size: compiled.buffer.length,
    Sha256: compiled.sha256,
    IsWholeReplaceNestedRpf: false,
  };
  const manifest = {
    ReduxName: `Astral target HP — ${project.name || summary}`,
    ParsedAt: new Date().toISOString(),
    TotalPatchSize: action.Size,
    Actions: [action],
  };
  await fs.writeFile(path.join(patchDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  /* Записка пересборки: работа, из которой патч собран. */
  await writeRecomposeSidecar(patchDirectory, { kind: "target-hp", project });
  return {
    patch: patchDirectory,
    gameRoot,
    project,
    target: GAMER_INFO_GFX_TARGET,
    size: compiled.buffer.length,
    sha256: compiled.sha256,
    files: [{ file: "mp_gamer_info.gfx", target: GAMER_INFO_GFX_TARGET, size: compiled.buffer.length, sha256: compiled.sha256 }],
    base: { source: base.source, label: base.label, gfxSha256: base.gfxSha256 || sha256(stock) },
    summary,
  };
}

export async function planTargetHp(input, context, stateDir, tools = {}) {
  const { native } = { ...defaultTools(), ...tools };
  const generated = await materializeTargetHp(input, stateDir, tools);
  try {
    const validation = await native("validate-rpf-patch", { patch: generated.patch }, context);
    return { ...generated, validation, edition: "Legacy", archive: UPDATE_ARCHIVE };
  } finally {
    /* План только проверяет: «Применить» собирает патч заново по живому
       архиву, а этот больше никому не нужен. */
    await fs.rm(generated.patch, { recursive: true, force: true }).catch(() => {});
  }
}

export async function applyTargetHp(input, context, stateDir, { assertRuntimeSafety, ...tools } = {}) {
  const { native, archiveSupport } = { ...defaultTools(), ...tools };
  const gameRoot = requireGameRoot(input);
  await assertRuntimeSafety?.(gameRoot);
  const generated = await materializeTargetHp(input, stateDir, tools);
  const support = await archiveSupport({ stateDir });
  const installed = await native(
    "install-rpf-patch",
    {
      patch: generated.patch,
      gameRoot,
      archiveFix: path.join(support.directory, "ArchiveFix.exe"),
      keys: support.directory,
    },
    context,
  );
  return { ...installed, ...generated, edition: "Legacy" };
}

/*
 * Пересборка перед возвратом в игру (`patch-recompose.js`): та же работа
 * поверх архива, каким он стал после перемотки.
 */
registerPatchRecomposer("target-hp", async ({ sidecar, gameRoot, stateDir, tools = {} }) => {
  const generated = await materializeTargetHp({ gameRoot, project: sidecar.project }, stateDir, tools);
  return { patch: generated.patch };
});
