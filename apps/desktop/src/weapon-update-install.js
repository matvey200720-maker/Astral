import fs from "node:fs/promises";
import path from "node:path";
import { catalogAppendEnabled } from "@modovik/install-engine/append-item.js";
import { WEAPON_HOST_PREFIX, WEAPON_HOST_TARGET, isContainerLeaf, weaponUpdateMode } from "@modovik/install-engine/weapon-update-route.js";
import { createWeaponRouteCensus } from "./weapon-route-census.js";

/*
 * Оружие через `update.rpf` со стороны приложения (GTA 5 RP, 20.11.2026, `docs/RP-WEAPONS-UPDATE.md`): выключатель, перепись победителей имён и ответ
 * «нужен ли хост оружия» до скачивания пакета.
 *
 * Выключатель — `ASTRAL_WEAPONS_VIA_UPDATE`: `1`, `true`, `update`, `patch` — запись в `dlc_patch/<победитель>`; `container` — контейнер слоя Astral
 * `x64/astral/astral_rp_weapons.rpf` в `update.rpf` (ганпак каталога и скин мастерской). Пусто и любое другое значение — `appWeaponUpdateRoute` отдаёт `null`,
 * и в настройки установки не попадает ничего: путь прежний. Режим `patch` берёт пакеты только вместе с дозаписью (`ASTRAL_ENGINE_CATALOG_APPEND=catalog`):
 * без неё каждый ствол пересобирал бы `update.rpf`; `container` дозаписи не требует (новый контейнер всё равно собирается целиком).
 * Видимых человеку строк нет: строки уходят в журнал приложения.
 */

const WEAPON_CAPABILITY = "direct-weapon-dlc-v1";
let sharedCensus = null;

/** Что перепись помнит об игре: `update.rpf` (в нём `dlclist.xml` и все `dlc_patch`) и папка пакетов дополнений (новый пакет). */
async function gameIdentity(gameRoot) {
  const { fingerprintSha256 } = await import("@modovik/install-engine/file-fingerprint.js");
  const updatePath = path.join(gameRoot, "update", "update.rpf");
  const packs = await fs.stat(path.join(gameRoot, "update", "x64", "dlcpacks")).catch(() => null);
  return `${await fingerprintSha256(updatePath)}|${packs ? Math.trunc(packs.mtimeMs) : ""}`;
}

async function defaultKeys(stateDir) {
  const [{ archiveKeysDirectory }, { keysFromDirectory }] = await Promise.all([import("./loader-provisioner.js"), import("@modovik/rpf7/node")]);
  return keysFromDirectory((await archiveKeysDirectory({ stateDir })) || "");
}

const defaultCensus = async (request) => (await import("./texture-census.js")).censusMapTextures(request);

const hostNamesOf = (manifest) =>
  (Array.isArray(manifest?.files) ? manifest.files : [])
    .filter((file) => file?.target === WEAPON_HOST_TARGET && String(file.entry || "").startsWith(WEAPON_HOST_PREFIX))
    .map((file) => String(file.entry).slice(WEAPON_HOST_PREFIX.length));

/**
 * Маршрут режима для `installPackageBatch({ weaponUpdateRoute })`: `{ routesFor({ names }), note(строка), needsHost(манифесты) }` или `null` (режим выключен).
 * `census`, `identityOf`, `keysOf` — подмены для тестов; без них — перепись игры (`texture-census.js`), отпечаток `update.rpf` и ключи из приложения.
 */
export function appWeaponUpdateRoute({ gameRoot, stateDir, note = () => {}, env = process.env, census = null, identityOf = null, keysOf = null } = {}) {
  const mode = weaponUpdateMode(env);
  if (mode === null) return null;
  /* `container`: по имени, без переписи и победителей; хост нужен только файлам, которые в контейнер не кладутся (`isContainerLeaf`). */
  if (mode === "container") {
    return {
      mode,
      note,
      async needsHost(manifests) {
        const names = (manifests || []).filter((manifest) => manifest?.capabilities?.includes(WEAPON_CAPABILITY)).flatMap(hostNamesOf);
        return names.some((name) => !isContainerLeaf(name));
      },
    };
  }
  const injected = Boolean(census || identityOf);
  const engine = injected
    ? createWeaponRouteCensus({ census: census || defaultCensus, identityOf: identityOf || gameIdentity })
    : (sharedCensus ||= createWeaponRouteCensus({ census: defaultCensus, identityOf: gameIdentity }));
  const keys = () => (keysOf ? keysOf() : defaultKeys(stateDir));
  const routesFor = async ({ names }) => engine.routesFor({ gameRoot, keys: await keys(), names });
  return {
    mode,
    routesFor,
    note,
    /** Нужен ли хост `astral_weapons` для этих пакетов: да, если дозапись выключена, хоть один файл не готов или маршрут не получен. */
    async needsHost(manifests) {
      const names = (manifests || []).filter((manifest) => manifest?.capabilities?.includes(WEAPON_CAPABILITY)).flatMap(hostNamesOf);
      if (!names.length) return false;
      if (!catalogAppendEnabled(env)) return true;
      try {
        const { routes } = await routesFor({ names });
        return routes.some((route) => !route.ready);
      } catch {
        return true;
      }
    },
  };
}
