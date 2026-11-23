import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

const MAX_SETTINGS_BYTES = 1024 * 1024;
const STATE_VERSION = 1;

const exists = async (file) => {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
};

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function safeId(value, label) {
  const result = String(value || "").trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,119}$/i.test(result)) {
    throw new Error(`${label} содержит недопустимые символы.`);
  }
  return result;
}

function assertInside(root, candidate, label) {
  const base = path.resolve(root);
  const resolved = path.resolve(candidate);
  const relative = path.relative(base, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} выходит за пределы защищённого каталога.`);
  }
  return resolved;
}

function uniqueMatch(xml, pattern, label) {
  const matches = [...xml.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(`settings.xml должен содержать ровно один ${label}.`);
  }
  return matches[0];
}

export function inspectSettingsXml(input) {
  const xml = String(input || "").replace(/^\uFEFF/, "");
  if (!xml.trim()) throw new Error("settings.xml пуст.");
  if (Buffer.byteLength(xml, "utf8") > MAX_SETTINGS_BYTES) {
    throw new Error("settings.xml превышает безопасный лимит 1 МБ.");
  }
  if (/<!/i.test(xml) || /\0/.test(xml)) {
    throw new Error(
      "DTD, XML-сущности, комментарии и нулевые байты запрещены.",
    );
  }
  if (
    !/^\s*(?:<\?xml\s+[^?]*\?>\s*)?<Settings>\s*[\s\S]*\s*<\/Settings>\s*$/i.test(
      xml,
    )
  ) {
    throw new Error(
      "Ожидался корневой элемент Settings без внешнего содержимого.",
    );
  }
  const video = uniqueMatch(
    xml,
    /<video>\s*[\s\S]*?\s*<\/video>/gi,
    "блок video",
  );
  uniqueMatch(
    video[0],
    /<AdapterIndex\s+value="-?\d+"\s*\/>/gi,
    "video/AdapterIndex",
  );
  uniqueMatch(
    video[0],
    /<OutputIndex\s+value="-?\d+"\s*\/>/gi,
    "video/OutputIndex",
  );
  const gpu = uniqueMatch(
    xml,
    /<VideoCardDescription>([^<]{1,256})<\/VideoCardDescription>/gi,
    "VideoCardDescription",
  );
  const gpuName = gpu[1].trim();
  if (!gpuName || /[\r\n\t]/.test(gpu[1])) {
    throw new Error(
      "VideoCardDescription содержит некорректное имя видеокарты.",
    );
  }
  return {
    xml,
    videoBlock: video[0],
    videoCardDescription: gpuName,
    videoCardElement: gpu[0],
  };
}

export function mergeSettingsXml(templateXml, currentXml) {
  const template = inspectSettingsXml(templateXml);
  const current = inspectSettingsXml(currentXml);
  const merged = template.xml
    .replace(template.videoBlock, current.videoBlock)
    .replace(template.videoCardElement, current.videoCardElement);
  const verified = inspectSettingsXml(merged);
  if (
    verified.videoBlock !== current.videoBlock ||
    verified.videoCardElement !== current.videoCardElement
  ) {
    throw new Error("Аппаратная привязка settings.xml не была сохранена.");
  }
  return merged;
}

async function syncWrite(file, data) {
  const handle = await fs.open(file, "wx");
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function recoverSwap(livePath) {
  const recovery = `${livePath}.astral-recovery`;
  const liveExists = await exists(livePath);
  const recoveryExists = await exists(recovery);
  if (!liveExists && recoveryExists) {
    await fs.rename(recovery, livePath);
  } else if (liveExists && recoveryExists) {
    await fs.rm(recovery, { force: true });
  }
}

async function atomicReplace(livePath, data) {
  await fs.mkdir(path.dirname(livePath), { recursive: true });
  await recoverSwap(livePath);
  const stage = `${livePath}.astral-stage-${process.pid}-${randomUUID()}`;
  const recovery = `${livePath}.astral-recovery`;
  await syncWrite(stage, data);
  let movedLive = false;
  try {
    if (await exists(livePath)) {
      await fs.rename(livePath, recovery);
      movedLive = true;
    }
    await fs.rename(stage, livePath);
    if (movedLive) await fs.rm(recovery, { force: true });
  } catch (error) {
    await fs.rm(stage, { force: true }).catch(() => {});
    if (!(await exists(livePath)) && (await exists(recovery))) {
      await fs.rename(recovery, livePath).catch(() => {});
    }
    throw error;
  }
}

const stateFile = (stateDir) => path.join(path.resolve(stateDir), "state.json");

async function readState(stateDir) {
  const file = stateFile(stateDir);
  if (!(await exists(file)))
    return { schemaVersion: STATE_VERSION, targets: {} };
  const parsed = JSON.parse(await fs.readFile(file, "utf8"));
  if (parsed?.schemaVersion !== STATE_VERSION || !parsed.targets) {
    throw new Error(
      "Состояние установщика settings.xml несовместимо или повреждено.",
    );
  }
  return parsed;
}

async function writeState(stateDir, state) {
  const root = path.resolve(stateDir);
  await fs.mkdir(root, { recursive: true });
  await atomicReplace(
    stateFile(root),
    `${JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2)}\n`,
  );
}

function packageSource(packageRoot, source) {
  return assertInside(
    packageRoot,
    path.join(packageRoot, source),
    "Payload settings.xml",
  );
}

async function readVerifiedPayload({ manifest, packageRoot }) {
  const file = manifest.files[0];
  const sourcePath = packageSource(path.resolve(packageRoot), file.source);
  const stat = await fs.lstat(sourcePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Payload settings.xml должен быть обычным файлом.");
  }
  if (stat.size > MAX_SETTINGS_BYTES) {
    throw new Error("Payload settings.xml превышает безопасный лимит 1 МБ.");
  }
  const bytes = await fs.readFile(sourcePath);
  const actualHash = sha256(bytes);
  if (file.sha256 && file.sha256.toLowerCase() !== actualHash) {
    throw new Error("Контрольная сумма payload settings.xml не совпала.");
  }
  return { bytes, actualHash };
}

function targetFromState(state, targetId, settingsPath) {
  const target = state.targets[targetId];
  if (
    target &&
    path.resolve(target.settingsPath) !== path.resolve(settingsPath)
  ) {
    throw new Error(
      "Профиль settings.xml уже связан с другим каталогом Documents.",
    );
  }
  return target;
}

export async function planSettingsPackage({
  manifest,
  settingsPath,
  stateDir,
  targetId = "default",
  edition = null,
}) {
  const modId = safeId(manifest.id, "ID модификации");
  const targetKey = safeId(targetId, "Target ID");
  await recoverSwap(settingsPath);
  const stat = await fs.stat(settingsPath).catch(() => null);
  if (!stat?.isFile()) {
    throw new Error(
      "settings.xml не найден. Запустите GTA V Legacy один раз, чтобы игра определила видеокарту.",
    );
  }
  const current = inspectSettingsXml(await fs.readFile(settingsPath, "utf8"));
  const state = await readState(stateDir);
  const target = targetFromState(state, targetKey, settingsPath);
  const owner = target?.layers?.at(-1)?.modId || null;
  return {
    modId,
    version: String(manifest.version || "1.0.0"),
    adapter: "gta-settings",
    slots: Array.isArray(manifest.slots) ? manifest.slots : [],
    targetId: targetKey,
    edition,
    files: [
      {
        target: "settings.xml",
        operation: "replace",
        currentOwner: owner,
        currentSize: stat.size,
        size: manifest.files[0].size ?? null,
        action: "merge-hardware-safe",
        preserves: ["video", "VideoCardDescription"],
      },
    ],
    rpfCompatibility: [],
    conflicts: owner && owner !== modId ? [{ modId: owner, fileCount: 1 }] : [],
    safeRoot: "gta-settings",
    hardwareBinding: {
      videoCardDescription: current.videoCardDescription,
      source: "current-gta-settings",
    },
    summary: {
      fileCount: 1,
      writeBytes: manifest.files[0].size ?? 0,
      unknownWriteBytes: manifest.files[0].size == null ? 1 : 0,
      transactionBackupBytes: stat.size,
      newFiles: 0,
      replacedFiles: 1,
      conflictingFiles: owner && owner !== modId ? 1 : 0,
      rollbackReady: true,
      risk: owner && owner !== modId ? "replacement" : "isolated",
    },
  };
}

export async function installSettingsPackage({
  manifest,
  packageRoot,
  settingsPath,
  stateDir,
  targetId = "default",
  replaceModIds = [],
  signal = null,
  assertRuntimeSafety = null,
}) {
  if (signal?.aborted)
    throw signal.reason || new DOMException("Отменено", "AbortError");
  const modId = safeId(manifest.id, "ID модификации");
  const targetKey = safeId(targetId, "Target ID");
  await recoverSwap(settingsPath);
  const currentBytes = await fs.readFile(settingsPath).catch(() => null);
  if (!currentBytes) {
    throw new Error(
      "settings.xml не найден. Запустите GTA V Legacy один раз, чтобы игра определила видеокарту.",
    );
  }
  const currentXml = currentBytes.toString("utf8");
  inspectSettingsXml(currentXml);
  const payload = await readVerifiedPayload({ manifest, packageRoot });
  const mergedXml = mergeSettingsXml(
    payload.bytes.toString("utf8"),
    currentXml,
  );
  const mergedBytes = Buffer.from(mergedXml, "utf8");
  const root = path.resolve(stateDir);
  const state = await readState(root);
  let target = targetFromState(state, targetKey, settingsPath);
  if (!target) {
    const baselinePath = path.join(
      root,
      "bases",
      `${sha256(path.resolve(settingsPath).toLowerCase())}.xml`,
    );
    await fs.mkdir(path.dirname(baselinePath), { recursive: true });
    if (!(await exists(baselinePath)))
      await fs.writeFile(baselinePath, currentBytes);
    target = {
      settingsPath: path.resolve(settingsPath),
      baseline: { path: baselinePath, sha256: sha256(currentBytes) },
      layers: [],
    };
    state.targets[targetKey] = target;
  }
  const replacementIds = new Set(
    (Array.isArray(replaceModIds) ? replaceModIds : []).map((id) =>
      safeId(id, "Replace ID"),
    ),
  );
  const installedIds = new Set(
    (target.layers || []).map((layer) => layer.modId),
  );
  for (const id of replacementIds) {
    if (!installedIds.has(id)) {
      throw new Error(`Профиль settings.xml не объявляет конфликт с ${id}.`);
    }
  }
  const cachePath = path.join(
    root,
    "payloads",
    modId,
    `${sha256(mergedBytes)}.xml`,
  );
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  if (!(await exists(cachePath))) await fs.writeFile(cachePath, mergedBytes);
  target.layers = (target.layers || []).filter(
    (layer) => layer.modId !== modId && !replacementIds.has(layer.modId),
  );
  target.layers.push({
    modId,
    version: String(manifest.version || "1.0.0"),
    path: cachePath,
    sha256: sha256(mergedBytes),
    installedAt: new Date().toISOString(),
  });
  await assertRuntimeSafety?.({ phase: "before-settings-commit" });
  if (signal?.aborted)
    throw signal.reason || new DOMException("Отменено", "AbortError");
  const backupPath = path.join(root, "latest", targetKey, "settings.xml");
  await atomicReplace(backupPath, currentBytes);
  await atomicReplace(settingsPath, mergedBytes);
  try {
    await writeState(root, state);
  } catch (error) {
    await atomicReplace(settingsPath, currentBytes).catch(() => {});
    throw error;
  }
  return {
    modId,
    targetId: targetKey,
    adapter: "gta-settings",
    installed: true,
    backupPath,
    preserved: ["video", "VideoCardDescription"],
    videoCardDescription: inspectSettingsXml(mergedXml).videoCardDescription,
  };
}

export async function uninstallSettingsPackage({
  modId,
  targetId = "default",
  settingsPath,
  stateDir,
}) {
  const cleanModId = safeId(modId, "ID модификации");
  const targetKey = safeId(targetId, "Target ID");
  const root = path.resolve(stateDir);
  const state = await readState(root);
  const target = targetFromState(state, targetKey, settingsPath);
  if (
    !target ||
    !(target.layers || []).some((layer) => layer.modId === cleanModId)
  ) {
    return null;
  }
  await recoverSwap(settingsPath);
  const currentBytes = await fs.readFile(settingsPath);
  target.layers = target.layers.filter((layer) => layer.modId !== cleanModId);
  const top = target.layers.at(-1);
  const source = top || target.baseline;
  const sourcePath = assertInside(
    root,
    source.path,
    "Резервная копия settings.xml",
  );
  const desired = await fs.readFile(sourcePath);
  if (source.sha256 && sha256(desired) !== source.sha256) {
    throw new Error("Резервная копия settings.xml повреждена.");
  }
  inspectSettingsXml(desired.toString("utf8"));
  await atomicReplace(settingsPath, desired);
  try {
    if (!target.layers.length) delete state.targets[targetKey];
    await writeState(root, state);
  } catch (error) {
    await atomicReplace(settingsPath, currentBytes).catch(() => {});
    throw error;
  }
  return {
    modId: cleanModId,
    targetId: targetKey,
    adapter: "gta-settings",
    uninstalled: true,
    restored: top ? top.modId : "original",
  };
}

export async function getSettingsInstallProfile({ stateDir }) {
  const state = await readState(path.resolve(stateDir));
  return Object.entries(state.targets || {}).flatMap(([targetId, target]) =>
    (target.layers || []).map((layer) => ({
      modId: layer.modId,
      version: layer.version,
      adapter: "gta-settings",
      targetId,
      installedAt: layer.installedAt,
      resources: [],
      archiveEntries: [],
    })),
  );
}

export async function resetSettingsTarget({
  targetId = "default",
  settingsPath,
  stateDir,
  signal = null,
  assertRuntimeSafety = null,
}) {
  const targetKey = safeId(targetId, "Target ID");
  const root = path.resolve(stateDir);
  const state = await readState(root);
  const target = targetFromState(state, targetKey, settingsPath);
  if (!target?.layers?.length) return null;

  await recoverSwap(settingsPath);
  await assertRuntimeSafety?.({ phase: "before-settings-reset" });
  if (signal?.aborted) {
    const error = new Error("Operation cancelled");
    error.name = "AbortError";
    throw error;
  }

  const currentBytes = await fs.readFile(settingsPath);
  const baselinePath = assertInside(
    root,
    target.baseline.path,
    "settings.xml baseline",
  );
  const baselineBytes = await fs.readFile(baselinePath);
  if (
    target.baseline.sha256 &&
    sha256(baselineBytes) !== target.baseline.sha256
  ) {
    throw new Error("The protected settings.xml baseline is damaged.");
  }
  inspectSettingsXml(baselineBytes.toString("utf8"));
  await atomicReplace(settingsPath, baselineBytes);
  try {
    delete state.targets[targetKey];
    await writeState(root, state);
  } catch (error) {
    await atomicReplace(settingsPath, currentBytes).catch(() => {});
    throw error;
  }
  return {
    targetId: targetKey,
    adapter: "gta-settings",
    reset: true,
    removed: target.layers.map((layer) => layer.modId),
  };
}
