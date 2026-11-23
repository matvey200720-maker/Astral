/*
 * Зоны с эффектом (градиент, радуга, перелив, линия двумя цветами): зашитую
 * клетку 4×4 заменяет полоса цветов эффекта, развёртка оболочки ложится
 * вдоль оси зоны. Пересобирает модель нативный хост (`restyle-drawable`,
 * `RestyleDrawableCommands.cs`): размер текстуры меняется, правка на месте
 * тут невозможна. Ровный цвет зоны пишется на месте и сюда не доходит.
 *
 * Все модели — одним запуском хоста (версия 2 запроса, ТЗ 17.10.2026,
 * задача 12): у зелёных зон полторы сотни моделей. У модели обвода (бизвар,
 * ВЗХ, порт) — две линии со своими листами: шаг на каждую, развёртка — только
 * у своих сеток (`textureOnly`); ровный цвет второй линии пишется на месте
 * до пересборки.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { encodeDds, fullMipLevels } from "@modovik/dds";
import { patchResourceTextures } from "./recolor-textures.js";

/* Полоса — четыре одинаковые строки: GTA и CodeWalker не любят текстуры в
   одну строку, а развёртка берёт середину (v = 0,5). */
const ROWS = 4;

/**
 * Файлы зон с эффектом: `patches` — правки `zonesFilePatches` с
 * `restyle` (шаги), `resources` — байты файлов набора, `compile(команда,
 * вход)` — вызов хоста. `Map(имя файла → байты)`.
 */
export async function restyleZoneFiles(patches, resources, { compile, stateDir }) {
  const out = new Map();
  const jobs = patches.filter((patch) => patch.restyle?.length);
  if (!jobs.length) return out;
  if (typeof compile !== "function") throw new Error("Сборщик зон с эффектом не подключён — обновите Astral.");
  const staging = path.join(stateDir, "recolor", "zones", "restyle", randomUUID());
  await fs.mkdir(staging, { recursive: true });
  try {
    const items = [];
    for (const [index, patch] of jobs.entries()) {
      let source = resources.get(patch.file);
      if (!source) throw new Error(`В наборе нет файла ${patch.file}.`);
      /* Ровный цвет второй линии той же модели — на месте, до пересборки. */
      if (Object.keys(patch.textures || {}).length) source = patchResourceTextures(source, patch.file, patch.textures).bytes;
      const target = path.join(staging, `${index}-in.ydr`);
      await fs.writeFile(target, source, { flag: "wx" });
      const steps = [];
      for (const [step, restyle] of patch.restyle.entries()) {
        const width = restyle.width;
        const rgba = new Uint8ClampedArray(width * ROWS * 4);
        for (let row = 0; row < ROWS; row += 1) rgba.set(restyle.rgba, row * width * 4);
        const dds = encodeDds({ width, height: ROWS, format: "A8R8G8B8", mipLevels: fullMipLevels(width, ROWS), rgba });
        const texture = path.join(staging, `${index}-${step}-strip.dds`);
        await fs.writeFile(texture, dds, { flag: "wx" });
        steps.push({
          texture: { name: restyle.texture, dds: texture },
          uv: restyle.uv,
          emissive: restyle.emissive,
          ...(restyle.textureOnly ? { textureOnly: true } : {}),
        });
      }
      items.push({ target, output: `${index}-out.ydr`, steps, file: patch.file });
    }
    const request = path.join(staging, "restyle.json");
    await fs.writeFile(
      request,
      JSON.stringify({
        format: "astral.restyle-drawable",
        version: 2,
        items: items.map(({ target, output, steps }) => ({ target, output, steps })),
      }),
    );
    const output = path.join(staging, "out");
    await compile("restyle-drawable", { input: request, output });
    for (const item of items) {
      const bytes = await fs.readFile(path.join(output, item.output)).catch(() => null);
      if (!bytes?.length) throw new Error(`Сборка зоны ${item.file} не дала модели.`);
      out.set(item.file, bytes);
    }
    return out;
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}
