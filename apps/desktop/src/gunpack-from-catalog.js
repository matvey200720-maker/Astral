import { createHash } from "node:crypto";
import { downloadSignedPackage } from "@modovik/install-engine";
import path from "node:path";
import * as fsp from "node:fs/promises";

const CATALOG_DIR = "gunpacks-catalog";
const PARTIAL_SUFFIX = ".partial";
const KEY_LENGTH = 24;
const TITLE_LIMIT = 80;
const ID_LENGTH = [1, 96];
const MODEL_EXTENSIONS = ".ydr .ytd .yft .rpf".split(" ");
const WIPE = { recursive: true, force: true };

// Символы, которые остаются в имени папки; всё остальное — разрыв (один пробел).
const TITLE_CHAR = new RegExp("[\\p{L}\\p{N}_+.,()'&-]", "u");
const ID_HEAD = new RegExp("[A-Za-z0-9]");
const ID_BODY = new RegExp("^[A-Za-z0-9._-]*$");
const LEADING_DOTS = new RegExp("^\\.+");

const refusal = (code, message) => Object.assign(new Error(message), { code });

// Уборка, которая не обязательна: любой сбой молча проглатывается.
const quietly = async (work) => {
  try {
    await work();
  } catch {
    // хвост можно оставить
  }
};

const textField = (source, key) => String(source?.[key] || "");

function readIdentity(input) {
  const manifest = input?.manifest;
  const [id, version] = ["id", "version"].map((key) => textField(manifest, key));
  const idRules = [
    () => id.length >= ID_LENGTH[0],
    () => id.length <= ID_LENGTH[1],
    () => ID_HEAD.test(id[0]),
    () => ID_BODY.test(id),
  ];
  if (version === "" || !idRules.every((rule) => rule())) {
    throw refusal("GUNPACK_CATALOG", "У этого ствола каталога нет пакета.");
  }
  return { id, version };
}

// Название из имени ствола: отрезки допустимых знаков через один пробел, без точек в начале.
function folderTitle(raw, fallback) {
  const marked = [...String(raw || "")].map((ch) => (TITLE_CHAR.test(ch) ? ch : "\n"));
  const title = marked.join("").split("\n").filter(Boolean).join(" ").replace(LEADING_DOTS, "");
  return title.slice(0, TITLE_LIMIT) || fallback;
}

const isPresent = (target) =>
  Promise.resolve()
    .then(() => fsp.stat(target))
    .then(
      () => true,
      () => false,
    );

const isModelName = (name) => {
  const folded = name.toLowerCase();
  return MODEL_EXTENSIONS.some((ext) => folded.endsWith(ext));
};

// Имя занимается первым файлом; повтор без учёта регистра пропускается.
const claimName = (taken, name) => {
  const before = taken.size;
  taken.add(name.toLowerCase());
  return taken.size > before;
};

const isInstallable = (item) => item?.source && item.action !== "delete";

async function downloadModels(input, deps) {
  const { manifest } = input;
  const download = deps.download || downloadSignedPackage;
  const request = {
    manifest,
    baseUrl: String(input.baseUrl || ""),
    publicKey: deps.publicKey,
    stateDir: deps.stateDir,
    downloadsDir: deps.downloadsDir || null,
    allowInsecureLocalhost: Boolean(deps.allowInsecureLocalhost),
    allowedHosts: deps.allowedHosts ?? null,
    onProgress: deps.onProgress || null,
  };
  const downloaded = await download(request);
  const root = path.resolve(downloaded.packageRoot);
  const taken = new Set();
  // Выбранный список — как есть: у не-массива `.filter` даёт TypeError платформы.
  const candidates = (downloaded.manifest?.files || manifest.files || []).filter(isInstallable);
  const models = candidates.flatMap((item) => {
    const from = path.resolve(root, item.source);
    const name = path.basename(String(item.entry || item.source));
    const wanted = from.startsWith(root + path.sep) && isModelName(name) && claimName(taken, name);
    return wanted ? [{ from, name }] : [];
  });
  if (!models.length) throw refusal("GUNPACK_CATALOG_EMPTY", "В пакете этого мода нет моделей оружия.");
  return models;
}

async function copyInto(partial, models) {
  for (const model of models) {
    await fsp.copyFile(model.from, path.join(partial, model.name));
  }
}

async function placeModels(folder, models) {
  const partial = folder + PARTIAL_SUFFIX;
  await fsp.rm(partial, WIPE);
  await fsp.mkdir(partial, { recursive: true });
  try {
    await copyInto(partial, models);
    await fsp.rename(partial, folder);
  } catch (error) {
    await quietly(() => fsp.rm(partial, WIPE));
    throw error;
  }
}

async function openInStudio(deps, folder) {
  try {
    return await deps.studio.open({ paths: [folder], onProgress: deps.onProgress });
  } catch (error) {
    if (error?.code === "GUNPACK_NO_WEAPONS") await fsp.rm(path.dirname(folder), WIPE);
    throw error;
  }
}

const catalogKey = (id, version) =>
  createHash("sha256").update(`${id}@${version}`).digest("hex").slice(0, KEY_LENGTH);

export async function takeCatalogWeapon(input, deps) {
  const { id, version } = readIdentity(input);
  const folder = path.join(deps.stateDir, CATALOG_DIR, catalogKey(id, version), folderTitle(input.name, id));

  if (!(await isPresent(folder))) await placeModels(folder, await downloadModels(input, deps));
  return { ...(await openInStudio(deps, folder)), catalogId: id };
}
