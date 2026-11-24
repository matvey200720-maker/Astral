import { canonicalManifest } from "./manifest.js";

export const PINNED_LOADER_TRUST = Symbol("astral-pinned-loader");

const PINNED_LOADER_FILES = Object.freeze({
  Legacy: Object.freeze([
    Object.freeze({
      source: "dinput8.dll",
      target: "dinput8.dll",
      sha256:
        "22fda9c71eaae02460f311bf3441638340ab591586d78f1de213c4819dcb883c",
      size: 3_615_648,
    }),
    Object.freeze({
      source: "RageOpenV.asi",
      target: "RageOpenV.asi",
      sha256:
        "951d53952dedcfd9375a0cb37814cb8a783f39880b68de8b22f23535deda56f1",
      size: 134_144,
    }),
  ]),
  Enhanced: Object.freeze([
    Object.freeze({
      source: "xinput1_4.dll",
      target: "xinput1_4.dll",
      sha256:
        "22fda9c71eaae02460f311bf3441638340ab591586d78f1de213c4819dcb883c",
      size: 3_615_648,
    }),
    Object.freeze({
      source: "RageOpenV.asi",
      target: "RageOpenV.asi",
      sha256:
        "951d53952dedcfd9375a0cb37814cb8a783f39880b68de8b22f23535deda56f1",
      size: 134_144,
    }),
  ]),
});

/*
 * Чем игру заставляют читать папку `mods`. Единственный список на весь проект.
 *
 * Нужны ОБА набора сразу: перехватчик без плагина ничего не подменяет, плагин
 * без перехватчика не запускается. Разделение на два списка — не украшение, по
 * нему считается признак тени (`inspectModsShadow`).
 *
 * До 2026-09-09 таких списков было четыре: здесь, в `astral-layer.js`, в
 * `apps/desktop/src/game-archive-layer.js` и в нативном хосте. Сверялись
 * попарно только три из них, и четвёртый молча разошёлся: `version.dll` знал
 * один `astral-layer.js`. Разойтись им нельзя — имя, которое одна половина
 * считает подменой, а другая не знает, это либо ванильная картинка при
 * модифицированной игре, либо установка в архив, который игра не читает.
 */
export const ASI_LOADERS = Object.freeze([
  "dinput8.dll",
  "xinput1_4.dll",
  "dsound.dll",
  "version.dll",
]);

export const MODS_PLUGINS = Object.freeze([
  "OpenIV.asi",
  "OpenRPF.asi",
  "ClosedIV.asi",
  "RageOpenV.asi",
]);

export const VANILLA_GUARD_ITEMS = Object.freeze([
  "mods",
  "newmods",
  ...ASI_LOADERS,
  ...MODS_PLUGINS,
]);

/** id записи установки нашей пары в состоянии цели (`astral-loader-legacy` / `astral-loader-enhanced`). */
export const loaderManifestId = (edition) => `astral-loader-${String(edition || "").toLowerCase()}`;

/**
 * Наши файлы пары для редакции: `[{ target, sha256, size }]` — сверка «наш ли файл» при миграции (23.11.2026):
 * чужой или изменённый файл с тем же именем не наш и не трогается.
 */
export function ownLoaderFiles(edition) {
  const files = PINNED_LOADER_FILES[edition];
  if (!files) return [];
  return files.map(({ target, sha256, size }) => ({ target, sha256, size }));
}

export function pinnedLoaderManifest(edition) {
  const files = PINNED_LOADER_FILES[edition];
  if (!files) throw new Error(`Неподдерживаемая редакция GTA V: ${edition}.`);
  return {
    id: `astral-loader-${edition.toLowerCase()}`,
    version: "1.0.0-pinned.1",
    editions: [edition],
    scope: "game-root",
    adapter: "file-overlay",
    requiresLoader: false,
    capabilities: ["loader-install-v1"],
    slots: ["astral-archive-loader"],
    files: files.map((file) => ({ ...file, action: "replace" })),
  };
}

export function isPinnedLoaderManifest(manifest, edition) {
  try {
    return (
      canonicalManifest(manifest) ===
      canonicalManifest(pinnedLoaderManifest(edition))
    );
  } catch {
    return false;
  }
}
