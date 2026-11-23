/*
 * «Расписание» в файлах (задача 11 ТЗ 10.10.2026, вечер) — свои табло на
 * местах табло сервера Majestic.
 *
 * У табло сервера листа с картинкой нет (буквы и плашки — сетки модели),
 * поэтому своё табло — своя модель: плашка во весь щит
 * (`scheduleBoardMesh`) с листом 2048 × 1024, который нарисовало окно по
 * работе (`images.sheet` — PNG; DXT5 со всеми мипами, цвет под прозрачным
 * — от соседних видимых, чтобы мипы не давали тёмной каймы у букв). Шейдер
 * — `scheduleShader`: без свечения `default` (`alpha.sps`, если на листе
 * есть прозрачное), со свечением `emissive` (`emissive_alpha.sps`). Модель
 * на каждый размер табло сервера (`astral_schedule_<n>.ydr`: у своей
 * сущности масштаба нет — он зашит в сетку), расстановка —
 * `compile-placements`: типы и карта `astral_schedule` и манифест
 * контейнера; точки, повороты, флаги и дальность — как у табло сервера,
 * лицо — чуть впереди его лица.
 *
 * Имена — свои: пак сервера (alt:V) главнее файлов игры с его именами, и
 * его табло стоит на месте всегда; своё встаёт перед ним. «Как на сервере» —
 * пустой ответ (ставить нечего).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { bleedTransparent, encodeDds, fullMipLevels } from "@modovik/dds";
import {
  SCHEDULE_MAP,
  SCHEDULE_MODEL_LOD,
  SCHEDULE_SHEET,
  SCHEDULE_TYPES,
  normalizeScheduleProject,
  scheduleBuildPlan,
  scheduleShader,
} from "@modovik/climb-contract/recolor/schedule";

/* Имя листа внутри моделей. */
const SHEET_NAME = "astral_schedule";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const round3 = (values) => values.map((value) => Math.round(value * 1000) / 1000);

/** Есть ли на листе прозрачное (тогда шейдер — с альфой). */
export function sheetHasTransparency(rgba) {
  for (let at = 3; at < rgba.length; at += 4) if (rgba[at] < 255) return true;
  return false;
}

/**
 * Модели и расстановка табло под работу: `{ files: [{ name, bytes }],
 * patches, report }`. `sheet` — лист окна `{ rgba, width, height }`,
 * `compile` — вызов нативного хоста. «Как на сервере» — пустой ответ.
 */
export async function buildScheduleFiles(input, { sheet = null, compile = null, stateDir = "" } = {}) {
  const project = normalizeScheduleProject(input);
  const plan = scheduleBuildPlan(project);
  if (!plan) return { files: [], patches: [], report: { boards: 0, stock: true } };
  if (!sheet?.rgba?.length) throw new Error("Лист расписания не пришёл — нажмите «Применить» ещё раз.");
  if (sheet.width !== SCHEDULE_SHEET.width || sheet.height !== SCHEDULE_SHEET.height)
    throw new Error(`Лист расписания — ${sheet.width} × ${sheet.height}, а нужен ${SCHEDULE_SHEET.width} × ${SCHEDULE_SHEET.height}: нажмите «Применить» ещё раз.`);
  if (typeof compile !== "function") throw new Error("Сборщик моделей не подключён — обновите Astral.");
  const transparent = sheetHasTransparency(sheet.rgba);
  const shader = scheduleShader(plan.glow, transparent);
  const staging = path.join(stateDir, "recolor", "schedule", "build", randomUUID());
  await fs.mkdir(staging, { recursive: true });
  try {
    const writeFile = async (name, bytes) => {
      const file = path.join(staging, name);
      await fs.writeFile(file, bytes, { flag: "wx" });
      return file;
    };
    const rgba = bleedTransparent(new Uint8ClampedArray(sheet.rgba), sheet.width, sheet.height);
    const dds = encodeDds({ width: sheet.width, height: sheet.height, format: "DXT5", mipLevels: fullMipLevels(sheet.width, sheet.height), rgba });
    const texture = { name: SHEET_NAME, dds: await writeFile(`${SHEET_NAME}.dds`, dds), sha256: `sha256:${sha256(dds)}` };

    const models = [];
    const archetypes = [];
    for (const item of plan.models) {
      const { mesh } = item;
      /* Вершина: точка, нормаль, развёртка (f32 × 8); затем индексы u32. */
      const count = mesh.positions.length / 3;
      const data = new Float32Array(count * 8);
      for (let at = 0; at < count; at += 1) {
        data.set(mesh.positions.subarray(at * 3, at * 3 + 3), at * 8);
        data.set(mesh.normals.subarray(at * 3, at * 3 + 3), at * 8 + 3);
        data.set(mesh.uvs.subarray(at * 2, at * 2 + 2), at * 8 + 6);
      }
      const bytes = Buffer.concat([Buffer.from(data.buffer), Buffer.from(mesh.indices.buffer, mesh.indices.byteOffset, mesh.indices.byteLength)]);
      const geometry = { shader: 0, data: await writeFile(`${item.name}.bin`, bytes), vertexCount: count, indexCount: mesh.indices.length };
      models.push({
        name: item.name,
        kind: "ydr",
        drawables: [
          {
            lodDist: SCHEDULE_MODEL_LOD,
            shaders: [{ name: shader.name, file: shader.file, texture: SHEET_NAME, ...(shader.emissive ? { emissive: shader.emissive } : {}) }],
            textures: [texture],
            geometries: [geometry],
          },
        ],
      });
      /* Рамка — с запасом в миллиметр; дальность архетипа — самая дальняя у его табло. */
      const lods = plan.entities.filter((entity) => entity.archetype === item.name).map((entity) => entity.lodDist);
      archetypes.push({
        name: item.name,
        lodDist: Math.max(...lods),
        bbMin: round3(mesh.bounds.min.map((value) => value - 0.001)),
        bbMax: round3(mesh.bounds.max.map((value) => value + 0.001)),
        flags: plan.archetypeFlags,
      });
    }

    const files = [];
    const output = path.join(staging, "models");
    const request = await writeFile("models.json", JSON.stringify({ format: "astral.compile-sign-models", version: 1, models }));
    await compile("compile-sign-models", { input: request, output });
    for (const model of models) {
      const name = `${model.name}.ydr`;
      const bytes = await fs.readFile(path.join(output, name)).catch(() => null);
      if (!bytes?.length) throw new Error(`Сборка расписания не дала ${name}.`);
      files.push({ name, bytes });
    }
    const entities = plan.entities.map((entity) => ({
      archetype: entity.archetype,
      position: round3(entity.position),
      rotation: entity.rotation,
      lodDist: entity.lodDist,
      flags: entity.flags,
    }));
    const placements = path.join(staging, "placements");
    const placeRequest = await writeFile(
      "placements.json",
      JSON.stringify({ format: "astral.compile-placements", version: 1, types: SCHEDULE_TYPES, map: SCHEDULE_MAP, manifest: true, archetypes, entities }),
    );
    await compile("compile-placements", { input: placeRequest, output: placements });
    for (const name of [`${SCHEDULE_TYPES}.ytyp`, `${SCHEDULE_MAP}.ymap`, "_manifest.ymf"]) {
      const bytes = await fs.readFile(path.join(placements, name)).catch(() => null);
      if (!bytes?.length) throw new Error(`Расстановка расписания не дала ${name}.`);
      files.push({ name, bytes });
    }
    return {
      files,
      patches: [{ file: "schedule", models: models.map((model) => `${model.name}.ydr`) }],
      report: {
        boards: entities.length,
        models: models.length,
        shader: shader.file,
        glow: plan.glow,
        transparent,
        sheet: `${sheet.width}×${sheet.height}`,
        files: files.length,
      },
    };
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}
