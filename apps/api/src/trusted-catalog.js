// Каталог стартовых модов без обещаний, которые установка не выполнит: подмена записей из собранной базы,
// снятие пакета у мода с неподтверждённым манифестом, отсев модов без файлов пакета на диске.
import { loadGeneratedMods } from "./routes/system.js";
import { verifyManifest } from "@modovik/install-engine";
import { existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";

export const UNSIGNED_PACKAGE_REASON =
  "Пакет этого мода в этой сборке Astral не подписан ключом каталога — установка недоступна. Обновите Astral.";

const PACKAGES_PREFIX = "/api/packages/";
const STRIPPED_FIELDS = new Set(["manifest", "packageBaseUrl"]);

// Записи собранной базы по id; при повторе id побеждает последняя. Не массив — пустая карта.
const indexById = (records) =>
  Array.isArray(records) ? new Map(records.map((record) => [record.id, record])) : new Map();

// Подмена: поля старой, поверх них новой; internal всегда от старой записи.
const overlay = (old, fresh) => (fresh ? { ...old, ...fresh, internal: old.internal } : old);

// Служебные моды и моды без манифеста не проверяются; остальным нужен ключ, который подтверждает подпись.
const isVouched = (mod, key) => Boolean(mod.internal || !mod.manifest || (key && verifyManifest(mod.manifest, key)));

function stripPackage(mod) {
  const showcase = Object.fromEntries(Object.entries(mod).filter(([field]) => !STRIPPED_FIELDS.has(field)));
  return Object.assign(showcase, { packageStatus: "unsigned", unavailableReason: UNSIGNED_PACKAGE_REASON });
}

export function trustCatalogMods(mods, options = {}) {
  const { generated, publicKey } = options;
  const replacements = indexById(generated);
  return mods.map((original) => {
    const mod = overlay(original, replacements.get(original.id));
    return isVouched(mod, publicKey) ? mod : stripPackage(mod);
  });
}

// Часть адреса пакета после /api/packages/ (ещё не раскодированная) либо null, если диск не нужен.
function localPackagePath(mod) {
  if (!mod?.manifest || !mod.packageBaseUrl) return null;
  try {
    const { pathname } = new URL(mod.packageBaseUrl);
    return pathname.startsWith(PACKAGES_PREFIX) ? pathname.slice(PACKAGES_PREFIX.length) : null;
  } catch {
    return null;
  }
}

// Путь part внутри parent либо null, если он совпадает с parent или выходит за него.
function descend(parent, part) {
  const target = resolve(parent, part);
  return target.startsWith(parent + sep) ? target : null;
}

export function hasLocalPackage(mod, packagesRoot) {
  const encoded = localPackagePath(mod);
  if (encoded === null) return true;

  const root = resolve(packagesRoot);
  const packageDir = descend(root, decodeURIComponent(encoded));
  if (packageDir === null) return false;

  const declared = mod.manifest.files;
  const sources = (Array.isArray(declared) ? declared : []).map((file) => String(file?.source ?? ""));
  return sources.every((source) => {
    const target = descend(packageDir, source);
    return target !== null && existsSync(target);
  });
}

export function createStarterMods(config) {
  const { catalog, runtimeRoot, catalogPublicKey } = config;
  const generatedFile = join(runtimeRoot, "local-test-mods.json");
  const packagesRoot = join(runtimeRoot, "packages");
  const publicKey = catalogPublicKey || "";

  return {
    live: () =>
      Promise.resolve()
        .then(() => loadGeneratedMods(generatedFile))
        .catch(() => [])
        .then((generated) => trustCatalogMods(catalog.mods, { generated, publicKey }))
        .then((trusted) => trusted.filter((mod) => hasLocalPackage(mod, packagesRoot))),
    shown: () => trustCatalogMods(catalog.mods, { publicKey }),
  };
}
