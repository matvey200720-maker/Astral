/*
 * Поверхности арены Majestic со своими листами (задача 11 ТЗ 17.10.2026,
 * владелец: «наложение текстур выходит за пределы… арена — та же проблема»).
 *
 * У зала сервера листы общие: оболочка `mj_ma_int3_shell` — стены, потолок и
 * пол одной геометрией с одним шейдером, а штукатурка стен
 * (`wall_plaster_white_output`) — ещё и на потолке (2 660 м²), стойках и
 * боксах; пластик потолка — на декоре залов, мрамор пола — на стенах.
 * Правка листа красила всех его пользователей: узор стен ложился на потолок
 * и стойки, в кадре же (у каждой поверхности свой материал) — только на
 * стены. Здесь у каждой поверхности с обликом — своя копия общего листа
 * (`recolor-sheet-split.js`), а сам лист остаётся остальным как был.
 *
 * Поверхность треугольника — как у подготовки сцены
 * (`scripts/lib/arena-majestic.mjs`): оболочка — по стороне грани (вверх —
 * пол, вниз — потолок, остальное — стены), модели потолков — потолок,
 * прочие модели (детали, экраны, кресла, свет) — не поверхности.
 */

import { readDrawable } from "@modovik/rage-drawable";
import { openResourceWith } from "@modovik/ypt/resource-core";
import { inflateResource } from "@modovik/native-rs";
import { resourceRefs } from "./recolor-sheets.js";
import { splitSheetSurfaces, surfaceSheetName } from "./recolor-sheet-split.js";

const inflateRaw = inflateResource;
/* Порог стороны грани — как у подготовки сцены (|n| по высоте > 0,7). */
const FACING = 0.7;

/**
 * Поверхность треугольника модели Majestic: `"floor"`, `"walls"`,
 * `"ceiling"` или `null` (не поверхность). `normalY` — доля нормали вверх в
 * осях модели (`readDrawable`: Y вверх).
 */
export function majesticSurfaceOf(model, normalY) {
  const name = String(model || "").toLowerCase();
  if (/_shell$/.test(name)) return normalY > FACING ? "floor" : normalY < -FACING ? "ceiling" : "walls";
  if (/celling|ceiling/.test(name)) return "ceiling";
  return null;
}

/* Поверхности треугольников геометрии: `Map(поверхность | "other" → [номера])`. */
function trianglesBySurface(model, mesh) {
  const out = new Map();
  const P = mesh.positions;
  for (let triangle = 0; triangle * 3 + 2 < mesh.indices.length; triangle += 1) {
    const [a, b, c] = [mesh.indices[triangle * 3], mesh.indices[triangle * 3 + 1], mesh.indices[triangle * 3 + 2]];
    const ab = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]];
    const ac = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]];
    const n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    const length = Math.hypot(n[0], n[1], n[2]) || 1;
    const surface = majesticSurfaceOf(model, n[1] / length) || "other";
    if (!out.has(surface)) out.set(surface, []);
    out.get(surface).push(triangle);
  }
  return out;
}

const sameOp = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Общие листы поверхностей с разным обликом — своими копиями. `byFile` —
 * правки по файлам (`opsByFile`: имя → `{ at, ops: Map(лист → правка) }`),
 * правится на месте: у общего листа в его доме остаётся правка остальных его
 * мест (`restOf(sheet, поверхности с копиями)`: экраны, логотипы, фасад… или
 * `null` — как в основе), у моделей — правки своих копий. `opOf(surface,
 * sheet)` — облик листа у поверхности (`null` — как в основе); `resources` —
 * файлы сервера (`<сервер>/<имя>`).
 * Ответ — `{ bases: Map(модель → байты с копиями), report }`.
 */
export async function separateSurfaceSheets({ server, byFile, opOf, restOf = () => null, resources, compile, stateDir }) {
  const prefix = `${server}/`;
  const report = { sheets: [], models: [] };
  const files = [...resources.keys()].filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length));
  /* Где лежит лист: встроен в модель или в словарь сервера (первый по цепочке словарей). */
  const dictionaries = files.filter((name) => name.endsWith(".ytd"));
  const refsOf = new Map();
  const refs = (name) => {
    if (!refsOf.has(name)) {
      let list = [];
      try {
        list = resourceRefs(new Uint8Array(resources.get(prefix + name)), name).refs;
      } catch {
        list = [];
      }
      refsOf.set(name, new Map(list.map((ref) => [ref.name.toLowerCase(), ref])));
    }
    return refsOf.get(name);
  };
  const homeOf = (model, sheet) => {
    if (refs(model).has(sheet)) return { file: model, ref: refs(model).get(sheet), embedded: true };
    for (const name of dictionaries) if (refs(name).has(sheet)) return { file: name, ref: refs(name).get(sheet), embedded: false };
    return null;
  };

  /* Кто берёт каждый лист: модель, геометрия, треугольники по поверхностям. */
  const users = new Map();
  for (const model of files.filter((name) => name.endsWith(".ydr"))) {
    let drawables = [];
    try {
      drawables = readDrawable(openResourceWith(new Uint8Array(resources.get(prefix + model)), inflateRaw), { inflateRaw, kind: "ydr" }).drawables;
    } catch {
      continue;
    }
    const drawable = drawables[0];
    if (!drawable || drawable.lod !== "high") continue;
    const base = model.replace(/\.ydr$/, "");
    for (const mesh of drawable.meshes) {
      const sheet = String(mesh.material?.textures?.diffuse || "").toLowerCase();
      if (!sheet || !Number.isInteger(mesh.model) || !Number.isInteger(mesh.slot)) continue;
      const surfaces = trianglesBySurface(base, mesh);
      if (!users.has(sheet)) users.set(sheet, []);
      users.get(sheet).push({ model, mesh, surfaces, count: mesh.indices.length / 3 });
    }
  }

  const splitsByModel = new Map();
  for (const [sheet, list] of users) {
    const surfaces = new Set(list.flatMap((user) => [...user.surfaces.keys()]));
    const ops = new Map([...surfaces].map((surface) => [surface, surface === "other" ? null : opOf(surface, sheet)]));
    const looks = [...ops.values()];
    /* Все пользователи листа одного облика — лист правится на месте, как прежде. */
    if (looks.every((op) => sameOp(op, looks[0]))) continue;
    const painted = [...ops.entries()].filter(([, op]) => op);
    if (!painted.length) continue;
    /* Поверхности одного облика — одной копией листа. */
    const names = new Map();
    const nameOf = (surface, op) => {
      const key = JSON.stringify(op);
      if (!names.has(key)) names.set(key, surfaceSheetName(sheet, surface));
      return names.get(key);
    };
    const homes = new Set();
    let separated = false;
    for (const user of list) {
      const home = homeOf(user.model, sheet);
      if (!home) continue;
      homes.add(home.file);
      for (const [surface, op] of painted) {
        const triangles = user.surfaces.get(surface);
        if (!triangles?.length) continue;
        const to = nameOf(surface, op);
        const known = (splitsByModel.get(user.model) || []).find((item) => item.slot === user.mesh.slot && item.model === user.mesh.model && item.to === to);
        if (known) {
          known.triangles = known.triangles && triangles.length < user.count ? [...known.triangles, ...triangles] : null;
          continue;
        }
        const split = { model: user.mesh.model, slot: user.mesh.slot, triangles: triangles.length === user.count ? null : triangles, from: sheet, to, home };
        if (!splitsByModel.has(user.model)) splitsByModel.set(user.model, []);
        splitsByModel.get(user.model).push(split);
        const entry = byFile.get(user.model) || { at: null, ops: new Map() };
        entry.ops.set(to, op);
        byFile.set(user.model, entry);
        separated = true;
      }
    }
    if (!separated) continue;
    /* Сам общий лист — остальным его местам: их правка или как в основе. */
    const rest = restOf(sheet, painted.map(([surface]) => surface));
    for (const file of homes) {
      const entry = byFile.get(file);
      if (rest) (entry || byFile.set(file, { at: null, ops: new Map() }).get(file)).ops.set(sheet, rest);
      else entry?.ops.delete(sheet);
    }
    report.sheets.push({ sheet, surfaces: painted.map(([surface]) => surface) });
  }

  const bases = new Map();
  for (const [model, splits] of splitsByModel) {
    const bytes = await splitSheetSurfaces({
      base: resources.get(prefix + model),
      fileName: model,
      splits,
      sheetOf: (from) => {
        const home = splits.find((split) => split.from === from)?.home;
        return home ? { ref: home.ref, dictionary: home.embedded ? null : resources.get(prefix + home.file) } : null;
      },
      compile,
      stateDir,
      set: "arenas",
    });
    bases.set(model, bytes);
    report.models.push({ model, splits: splits.length });
  }
  return { bases, report };
}
