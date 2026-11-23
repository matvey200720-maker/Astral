/*
 * Поставщик секций карты целиком для хозяев без окна приложения (ТЗ 27.10.2026): печь обложек `catalog:render-covers` и песочница
 * `?qa=isolated`. Тот же `createMegaMallSectionProvider`, что у приложения (`mega-mall-desktop-ipc.js`), на нативном движке и ключах
 * ArchiveFix; ответы — как у каналов приложения (`mega-mall-editor-ipc.js`, `section` и `sectionBundle`), только байты бандла — base64.
 * Только чтение игры.
 */

import { createMegaMallSectionProvider } from "./mega-mall-section-model.js";
import { extractRpfEntries } from "./rpf-composer.js";
import { callNativeEngine } from "./native-engine.js";

export const toBase64 = (bytes) => Buffer.from(bytes).toString("base64");

/** Поставщик секций: `section` — манифест (или прогрев), `bundle` — бандл GLB, `sections` — какие есть. */
export function createMegaMallSectionHost({ gameRoot, keys, cacheRoot, context, native = callNativeEngine, extract = extractRpfEntries }) {
  const sections = createMegaMallSectionProvider({
    cacheRoot,
    findGame: async () => ({ path: gameRoot }),
    extractEntries: extract,
    listEntries: (input) => native("list-archive-entries", { ...input, keys }, context),
    inspectMapFiles: (input) => native("inspect-map-files", input, context),
    convertScene: (input) => native("convert-scene", input, context),
  });
  const sectionId = (input) => (input?.sectionId ? String(input.sectionId) : undefined);
  return Object.freeze({
    sections: () => sections.sections(),
    async section(input) {
      if (Array.isArray(input?.warm)) return sections.warm({ sectionId: sectionId(input), bundleIds: input.warm.map(String).slice(0, 8) });
      return sections.manifest({ sectionId: sectionId(input), rebuild: input?.rebuild === true });
    },
    async bundle(input) {
      const head = input?.head === true;
      const result = await sections.bundle({
        sectionId: sectionId(input),
        bundleId: String(input?.bundleId),
        head,
        ifNoneMatch: /^[0-9a-f]{64}$/i.test(String(input?.ifNoneMatch || "")) ? String(input.ifNoneMatch).toLowerCase() : "",
      });
      if (result.status !== "ready") return result;
      const unchanged = result.unchanged === true;
      return {
        status: "ready",
        sectionId: result.sectionId,
        bundleId: result.bundleId,
        cached: result.cached,
        bytes: result.bytes,
        sha256: result.sha256,
        unchanged,
        glb: head || unchanged || !result.glb ? null : toBase64(result.glb),
        report: result.report,
      };
    },
  });
}

