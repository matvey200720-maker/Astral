/*
 * Зоны каптов в файлах (ТЗ 10.10.2026, вечер, задача 8) — свои модели
 * шайб над районами каптов и над ареной.
 *
 * Форма — шайба мода `heix.rpf` (64-угольник, радиус, верх и низ — опись
 * `@modovik/climb-contract/recolor/capt-zones`), облик — работа человека
 * (`captZonesBuildPlan`): у каждой видимой зоны своя модель
 * `astral_capt_<место>.ydr` с зашитым листом (полоса цветов эффекта, альфа
 * прозрачности; DXT5 со всеми мипами), шейдер `emissive` —
 * `emissive_alpha.sps`, как у мода, или `emissive.sps` у сплошной (корзина 0,
 * без сортировки прозрачного), свечение — множителем шейдера. Модели
 * собирает нативный хост (`compile-sign-models`), расстановку —
 * `compile-placements`: типы `astral_captzones.ytyp`, карта
 * `astral_captzones.ymap` и манифест контейнера; точки сущностей — точки
 * мода, флаги архетипа и сущности — как у мода, дальность — работы.
 *
 * Имена — свои: у игрока может стоять сам мод (`heix_*`, `cpt_heix`), и
 * чужие архетипы не перекрываются. Прозрачная до конца зона не едет вовсе;
 * «Стандарт» — ни одной (установка снимается).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { encodeDds, fullMipLevels } from "@modovik/dds";
import {
  CAPT_ZONES,
  CAPT_ZONES_MAP,
  CAPT_ZONES_TYPES,
  captZonesBuildPlan,
  normalizeCaptZonesProject,
} from "@modovik/climb-contract/recolor/capt-zones";

/* Модель — без своей дальности (как у мода, 9998): видимость решает сущность. */
const MODEL_LOD = 9998;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const round3 = (values) => values.map((value) => Math.round(value * 1000) / 1000);

/**
 * Модели и расстановка зон каптов под работу: `{ files: [{ name, bytes }],
 * patches, report }`. `compile` — вызов нативного хоста. «Стандарт» —
 * пустой ответ (ставить нечего).
 */
export async function buildCaptZonesFiles(input, { compile = null, stateDir = "" } = {}) {
  const project = normalizeCaptZonesProject(input);
  const plan = captZonesBuildPlan(project);
  if (!plan.length) return { files: [], patches: [], report: { zones: 0, stock: true } };
  if (typeof compile !== "function") throw new Error("Сборщик моделей не подключён — обновите Astral.");
  const staging = path.join(stateDir, "recolor", "captzones", "build", randomUUID());
  await fs.mkdir(staging, { recursive: true });
  try {
    const writeFile = async (name, bytes) => {
      const file = path.join(staging, name);
      await fs.writeFile(file, bytes, { flag: "wx" });
      return file;
    };
    const models = [];
    const archetypes = [];
    const entities = [];
    let vertices = 0;
    for (const item of plan) {
      const { mesh, texture } = item;
      const dds = encodeDds({ width: texture.width, height: texture.height, format: "DXT5", mipLevels: fullMipLevels(texture.width, texture.height), rgba: texture.rgba });
      const sheet = { name: item.model, dds: await writeFile(`${item.model}.dds`, dds), sha256: `sha256:${sha256(dds)}` };
      /* Вершина: точка, нормаль, развёртка (f32 × 8); затем индексы u32. */
      const count = mesh.positions.length / 3;
      const data = new Float32Array(count * 8);
      for (let at = 0; at < count; at += 1) {
        data.set(mesh.positions.subarray(at * 3, at * 3 + 3), at * 8);
        data.set(mesh.normals.subarray(at * 3, at * 3 + 3), at * 8 + 3);
        data.set(mesh.uvs.subarray(at * 2, at * 2 + 2), at * 8 + 6);
      }
      const bytes = Buffer.concat([Buffer.from(data.buffer), Buffer.from(mesh.indices.buffer, mesh.indices.byteOffset, mesh.indices.byteLength)]);
      const geometry = { shader: 0, data: await writeFile(`${item.model}.bin`, bytes), vertexCount: count, indexCount: mesh.indices.length };
      vertices += count;
      models.push({
        name: item.model,
        kind: "ydr",
        drawables: [
          {
            lodDist: MODEL_LOD,
            shaders: [{ name: "emissive", file: item.shaderFile, texture: sheet.name, emissive: item.glow }],
            textures: [sheet],
            geometries: [geometry],
          },
        ],
      });
      /* Рамка — с запасом в миллиметр (округление не режет сетку). */
      archetypes.push({
        name: item.model,
        lodDist: item.lodDist,
        bbMin: round3(mesh.bounds.min.map((value) => value - 0.001)),
        bbMax: round3(mesh.bounds.max.map((value) => value + 0.001)),
        flags: item.archetypeFlags,
      });
      entities.push({ archetype: item.model, position: round3(item.position), lodDist: item.lodDist, flags: item.entityFlags });
    }

    const files = [];
    const output = path.join(staging, "models");
    const request = await writeFile("models.json", JSON.stringify({ format: "astral.compile-sign-models", version: 1, models }));
    await compile("compile-sign-models", { input: request, output });
    for (const model of models) {
      const name = `${model.name}.ydr`;
      const bytes = await fs.readFile(path.join(output, name)).catch(() => null);
      if (!bytes?.length) throw new Error(`Сборка зон каптов не дала ${name}.`);
      files.push({ name, bytes });
    }
    const placements = path.join(staging, "placements");
    const placeRequest = await writeFile(
      "placements.json",
      JSON.stringify({ format: "astral.compile-placements", version: 1, types: CAPT_ZONES_TYPES, map: CAPT_ZONES_MAP, manifest: true, archetypes, entities }),
    );
    await compile("compile-placements", { input: placeRequest, output: placements });
    for (const name of [`${CAPT_ZONES_TYPES}.ytyp`, `${CAPT_ZONES_MAP}.ymap`, "_manifest.ymf"]) {
      const bytes = await fs.readFile(path.join(placements, name)).catch(() => null);
      if (!bytes?.length) throw new Error(`Расстановка зон каптов не дала ${name}.`);
      files.push({ name, bytes });
    }
    const lods = entities.map((entity) => entity.lodDist);
    return {
      files,
      patches: [{ file: "captzones", models: models.map((model) => `${model.name}.ydr`) }],
      report: {
        zones: plan.length,
        hidden: CAPT_ZONES.length - plan.length,
        vertices,
        shaders: [...new Set(plan.map((item) => item.shaderFile))],
        minLodDist: Math.min(...lods),
        maxLodDist: Math.max(...lods),
        files: files.length,
      },
    };
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}
