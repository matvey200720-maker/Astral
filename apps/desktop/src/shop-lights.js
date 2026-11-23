/*
 * Свет ламп помещений (задача 5 ТЗ 17.10.2026, вечер): правка
 * `LightAttributes` моделей помещения помощником RPF — теми же командами, что
 * фонари мастерской (`lamp-studio-inspect` и `lamp-studio-patch`,
 * `rpf-composer.js`). Помощник работает над файлами, вынутыми из игры:
 * архивов игры он здесь не открывает, но папка GTA V нужна ему, чтобы
 * запуститься.
 *
 * Сборщик помещений (`recolor-shops.js`) получает готовый «правщик света»:
 * `patch(модели, свет)` отдаёт те же модели с новыми цветом и силой ламп.
 * Расчёт правок — чистый (`shops-light.js` договора), здесь только файлы и
 * помощник.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { shopLightMutations } from "@modovik/climb-contract/recolor/shops";
import { inspectLampModels, patchLampModels } from "./rpf-composer.js";

const defaultHelper = () => ({ inspect: inspectLampModels, patch: patchLampModels });

/**
 * Правщик света: `patch([{ name, bytes }], light)` → `[{ name, bytes, lights,
 * changed }]` в том же порядке. `helper` — подмена помощника в тестах.
 */
export function createShopLightPatcher({ gameRoot, stateDir = "", helper = null } = {}) {
  const tools = { ...defaultHelper(), ...(helper || {}) };
  return {
    async patch(models, light) {
      if (!models.length) return [];
      if (!gameRoot) throw new Error("Свет ламп правит помощник RPF, а папка GTA V не подтверждена.");
      const work = path.join(stateDir || os.tmpdir(), "shop-lights", randomUUID());
      await fs.mkdir(work, { recursive: true });
      try {
        const inputs = [];
        for (const [index, model] of models.entries()) {
          const file = path.join(work, `${index}-${path.basename(model.name)}`);
          await fs.writeFile(file, model.bytes);
          inputs.push({ file, model: path.basename(model.name).replace(/\.\w+$/, ""), entry: model.name });
        }
        const inspected = await tools.inspect({ gameRoot, models: inputs });
        const found = new Map((inspected?.models || []).map((item) => [item.entry, item.lights || []]));
        const patches = [];
        const outputs = new Map();
        for (const [index, input] of inputs.entries()) {
          const mutations = shopLightMutations(found.get(input.entry), light);
          if (!mutations.length) continue;
          const output = path.join(work, `out-${index}-${path.basename(input.file)}`);
          outputs.set(index, output);
          patches.push({ input: input.file, output, model: input.model, mutations });
        }
        if (patches.length) await tools.patch({ gameRoot, patches });
        const result = [];
        for (const [index, model] of models.entries()) {
          const output = outputs.get(index);
          const lights = (found.get(model.name) || []).length;
          result.push(output ? { name: model.name, bytes: new Uint8Array(await fs.readFile(output)), lights, changed: true } : { name: model.name, bytes: model.bytes, lights, changed: false });
        }
        return result;
      } finally {
        await fs.rm(work, { recursive: true, force: true }).catch(() => {});
      }
    },
  };
}
