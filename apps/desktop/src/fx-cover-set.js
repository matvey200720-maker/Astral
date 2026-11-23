/*
 * Набор FX-сцен с локальной папки — для печи обложек (25.10.2026, `docs/fx-scenes.md` §5, §6).
 *
 * Печь снимает обложки эффектов, трассеров и попаданий поверх настоящих кадров GTA V с картой глубины (набор снят стендом
 * `tools/ingame-qa`, Хелпер 3). Приложение берёт набор с CDN через локальный API (`apps/api/src/fx-scenes.js`); печи сеть не нужна: набор
 * лежит папкой на диске (`<папка>/manifest.json`, `<папка>/<mode>/<class>/<id>/…`), а окно-съёмщик ходит за ним по тем же адресам
 * `/api/fx-scenes/…`, что и окно приложения, — код загрузки сцен (`fx-frame/frame-loader.js`) один.
 *
 * Правила те же, что у API: манифест принимается, только если sha256 его байт равен `set` (константа сборки `FX_SCENES_SET`), а каждый
 * файл сцены сверяется с манифестом по размеру и sha256 до того, как уйдёт в окно. Набор неизменяем: не сошлось — отказ, в окно не попадает ничего.
 * Читает только внутри своей папки.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { MODES, SCENE_ID, WEAPON_CLASSES, isSceneFileName, parseManifest } from "@modovik/fx-scenes/format.js";

const HEX = /^[0-9a-f]{64}$/;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const FILE_ROUTE = /^\/api\/fx-scenes\/file\/([a-z-]+)\/([a-z]+)\/([A-Za-z0-9_-]+)\/([^/]+)$/;

const typeOf = (name) => (name.endsWith(".json") ? "application/json" : "image/png");

/**
 * Открыть набор в папке `dir`.
 * @param {object} options
 * @param {string} options.dir — папка набора (`…/fx-scenes/v1`)
 * @param {string} options.set — sha256 манифеста, который принимает сборка
 * @returns {Promise<{ manifest: object, scenes: number, respond: (url: URL) => Promise<{ status: number, type?: string, body?: Buffer|string }> }>}
 */
export async function openFxCoverSet({ dir, set }) {
  if (!HEX.test(String(set || ""))) throw new Error("Для набора сцен нужен SET — sha256 манифеста (apps/api/src/fx-scenes-set.js).");
  const root = path.resolve(dir);
  let manifestBytes;
  try {
    manifestBytes = await readFile(path.join(root, "manifest.json"));
  } catch {
    throw new Error(`В папке набора сцен нет manifest.json: ${root}`);
  }
  if (sha256(manifestBytes) !== set) throw new Error(`Манифест набора сцен не тот, что в сборке: sha256 ${sha256(manifestBytes)}, в сборке ${set}. Набор неизменяем — нужна сборка с его SET.`);
  const manifest = parseManifest(manifestBytes.toString("utf8"));
  const manifestJson = JSON.stringify(manifest);
  /* Файл, прошедший сверку, второй раз не читается: окно просит одни и те же кадры у каждой части. */
  const checked = new Map();

  async function fileBytes(entry, name) {
    const file = entry.files[name];
    if (!file) return null;
    const cached = checked.get(file.sha256);
    if (cached) return cached;
    const target = path.resolve(root, ...entry.path.split("/"), ...name.split("/"));
    if (!target.startsWith(root + path.sep)) return null;
    const bytes = await readFile(target).catch(() => null);
    if (!bytes) return null;
    if (bytes.byteLength !== file.bytes) throw new Error(`${entry.id}/${name}: размер ${bytes.byteLength}, в манифесте ${file.bytes}`);
    if (sha256(bytes) !== file.sha256) throw new Error(`${entry.id}/${name}: sha256 не сошёлся с манифестом`);
    checked.set(file.sha256, bytes);
    return bytes;
  }

  return {
    manifest,
    scenes: manifest.scenes.length,
    /** Ответ на запрос окна: `/api/fx-scenes/manifest` и `/api/fx-scenes/file/<режим>/<класс>/<id>/<имя>?sha=<hex>`. */
    async respond(url) {
      if (url.pathname === "/api/fx-scenes/manifest") return { status: 200, type: "application/json; charset=utf-8", body: manifestJson };
      const match = FILE_ROUTE.exec(url.pathname);
      if (!match) return { status: 404 };
      const [, mode, weaponClass, id, encoded] = match;
      let name;
      try {
        name = decodeURIComponent(encoded);
      } catch {
        return { status: 404 };
      }
      const sha = String(url.searchParams.get("sha") || "");
      if (!MODES.includes(mode) || !WEAPON_CLASSES.includes(weaponClass) || !SCENE_ID.test(id) || !isSceneFileName(name) || !HEX.test(sha)) return { status: 404 };
      const entry = manifest.scenes.find((item) => item.mode === mode && item.weaponClass === weaponClass && item.id === id);
      if (!entry?.files[name] || entry.files[name].sha256 !== sha) return { status: 404 };
      try {
        const body = await fileBytes(entry, name);
        return body ? { status: 200, type: typeOf(name), body } : { status: 404 };
      } catch {
        /* Файл не прошёл сверку: окну — отказ, а не картинка, которой набор не называл. */
        return { status: 502 };
      }
    },
  };
}
