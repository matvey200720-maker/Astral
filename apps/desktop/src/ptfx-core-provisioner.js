import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getProfile, installPackage } from "@modovik/install-engine";
import { ASTRAL_PTFX_CORE_VERSION } from "@modovik/tracer-contract";
import {
  composeRpfArchive,
  probeRpfArchive,
  provideLegacyDlcList,
  provideUpdateContentXml,
} from "./rpf-composer.js";
import { materializePtfxTextureEntry } from "./ptfx-texture-composer.js";
import { materializeTracerEntry } from "./tracer-composer.js";
import { materializeBloodRoutingEntry } from "./bloodfx-composer.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ID = "astral-ptfx-core-base";
const PACKAGE_VERSION = "1.1.0";

export function ptfxCorePackageRoot({
  packaged = false,
  resourcesPath = process.resourcesPath,
} = {}) {
  return packaged
    ? path.join(resourcesPath, "packages", PACKAGE_ID, PACKAGE_VERSION)
    : path.resolve(
        dirname,
        "../../../runtime/packages",
        PACKAGE_ID,
        PACKAGE_VERSION,
      );
}

/*
 * Почему ядро не поставилось — словами, а не ENOENT.
 *
 * Пакет подписывается ключом каталога и в обычную сборку не входит, поэтому
 * «пакета нет» — ожидаемое состояние (`not-bundled`), а не сбой. От пакета не
 * зависят ни мастерская «Попадания и трейсеры» (слоты она строит из ядра игры,
 * ptfx-core-slots.js), ни с 29.10.2026 трассеры и текстуры эффектов из каталога
 * (путь «ядро игрока», ptfx-player-core.js). Пакет нужен только слоям прежнего
 * канала `astral-ptfx-legacy`, которые больше не публикуются.
 */
export class PtfxCoreUnavailableError extends Error {
  constructor(message, { code, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "PtfxCoreUnavailableError";
    this.code = code;
  }
}

async function readManifest(packageRoot) {
  const manifestFile = path.join(packageRoot, "manifest.json");
  let info;
  try {
    info = await fs.lstat(manifestFile);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    throw new PtfxCoreUnavailableError(
      `Системный пакет Astral PTFX Core ${PACKAGE_VERSION} не входит в эту сборку Astral. ` +
        "Мастерская «Попадания и трейсеры» и трассеры и текстуры эффектов из каталога от него " +
        "не зависят — слоты Astral строятся в ядре вашей игры при установке.",
      { code: "not-bundled", cause: error },
    );
  }
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new PtfxCoreUnavailableError(
      "Манифест Astral PTFX Core не является обычным файлом — переустановите Astral.",
      { code: "invalid" },
    );
  }
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
  } catch (error) {
    throw new PtfxCoreUnavailableError(
      "Манифест Astral PTFX Core не читается — переустановите Astral.",
      { code: "invalid", cause: error },
    );
  }
  if (
    manifest.id !== PACKAGE_ID ||
    manifest.version !== PACKAGE_VERSION ||
    !manifest.files?.every(
      (file) => file.merge?.coreVersion === ASTRAL_PTFX_CORE_VERSION,
    )
  ) {
    throw new PtfxCoreUnavailableError(
      `Пакет Astral PTFX Core не того выпуска: ждали ${PACKAGE_ID} ${PACKAGE_VERSION} ` +
        `на ядре ${ASTRAL_PTFX_CORE_VERSION}. Переустановите Astral.`,
      { code: "invalid" },
    );
  }
  return manifest;
}

function matchingTarget(profile, gameRoot) {
  const expected = path.resolve(gameRoot);
  return Object.values(profile.targets || {}).find(
    (target) => path.resolve(target.gameRoot || "") === expected,
  );
}

export async function provisionPtfxCoreInfrastructure({
  gameRoot,
  targetId,
  edition,
  stateDir,
  publicKey,
  assertRuntimeSafety,
  packaged = false,
  resourcesPath = process.resourcesPath,
  packageRoot = ptfxCorePackageRoot({ packaged, resourcesPath }),
}) {
  const manifest = await readManifest(packageRoot);
  const profile = await getProfile({ stateDir });
  const target = matchingTarget(profile, gameRoot);
  const current = (target?.installed || []).find(
    (item) => item.modId === PACKAGE_ID && item.version === PACKAGE_VERSION,
  );
  if (current) {
    return {
      status: "ready",
      changed: false,
      id: PACKAGE_ID,
      version: PACKAGE_VERSION,
    };
  }
  if (typeof assertRuntimeSafety === "function") await assertRuntimeSafety();
  let result;
  try {
    result = await installPackage({
      manifest,
      packageRoot,
      gameRoot,
      targetId,
      edition,
      stateDir,
      publicKey,
      requireSignature: true,
      allowGameRootWrites: true,
      assertRuntimeSafety,
      rpfComposer: composeRpfArchive,
      rpfProbe: probeRpfArchive,
      dlcListProvider: provideLegacyDlcList,
      contentXmlProvider: provideUpdateContentXml,
      /* Ядро ложится в тот же update.rpf, что трассеры и кровь: архив
         пересобирается целиком, и каждому слою нужен свой сборщик. */
      ptfxTextureMaterializer: materializePtfxTextureEntry,
      tracerMaterializer: materializeTracerEntry,
      bloodRoutingMaterializer: materializeBloodRoutingEntry,
    });
  } catch (error) {
    /* Запущенная игра или небезопасная цель — не «ядро недоступно»:
       подготовка обязана остановиться, как и прежде. */
    if (error?.name === "InstallBlockedError") throw error;
    throw new PtfxCoreUnavailableError(
      `Astral PTFX Core ${PACKAGE_VERSION} не установлен: ${error?.message || error}. ` +
        "Мастерская «Попадания и трейсеры» и эффекты из каталога работают и без пакета: " +
        "слоты Astral строятся в ядре вашей игры.",
      { code: "install-failed", cause: error },
    );
  }
  return {
    status: "ready",
    changed: true,
    id: PACKAGE_ID,
    version: PACKAGE_VERSION,
    result,
  };
}
