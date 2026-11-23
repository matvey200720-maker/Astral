/*
 * «Флаги» в файлах (задача 7 ТЗ 10.10.2026, вечер).
 *
 * Основа — штатные флаги игры игрока (опись `flags`): модели вида
 * (`prop_flag_<вид>.yft`, `_s`, флаг яхты, флагштоки с полотнищем) и общий
 * словарь листов `prop_flags.ytd`. Правится только лист полотнища — на месте
 * (`patchResourceTextures`): тот же формат, размер и mip-уровни, остальные
 * байты ресурса — сетка, ткань (`EnvironmentCloth`), физика, шейдер — как в
 * игре. Поэтому флаг развевается на ветру, как штатный.
 *
 * Лист — `paintFlagSheet` договора (одна арифметика с кадром окна): флаг
 * страны или своя картинка с тенями складок, рукав у древка — пиксели игры.
 * Блоки DXT, где ничего не поменялось (рукав), остаются байт в байт
 * (`texturePayload` с оригиналом).
 *
 * Модели флагов берут только флаги (опись мира: у этих моделей нет других
 * архетипов), поэтому правка не расползается на другие вещи.
 */

import { decodeTextureRef } from "@modovik/rage-drawable";
import {
  changedFlagCount,
  changedFlagKinds,
  flagKind,
  flagLookOf,
  flagPaintKey,
  flagsProjectIsStock,
  normalizeFlagsProject,
  paintFlagSheet,
} from "@modovik/climb-contract/recolor/flags";
import { resourceRefs } from "./recolor-sheets.js";
import { patchResourceTextures } from "./recolor-textures.js";
import { texturePayload } from "./texture-payload.js";

/**
 * Что куда ложится: файл игры → `{ file, at, sheets: [{ kind, texture }] }`.
 * У общего словаря листов — все меняемые виды разом, у модели — её вид.
 */
export function flagFilePlan(input) {
  const project = normalizeFlagsProject(input);
  const files = new Map();
  const add = (file, at, kind, texture) => {
    if (!files.has(file)) files.set(file, { file, at, sheets: [] });
    files.get(file).sheets.push({ kind, texture });
  };
  for (const id of changedFlagKinds(project)) {
    const kind = flagKind(id);
    for (const item of kind.files) add(item.file, item.at, id, item.texture);
    if (kind.dictionary) add(kind.dictionary.file, kind.dictionary.at, id, kind.dictionary.texture);
  }
  return [...files.values()].sort((a, b) => (a.file < b.file ? -1 : 1));
}

/**
 * Файлы флагов под работу: `{ files: [{ name, bytes }], patches, report }`.
 * `game` — читатель игры игрока, `images` — свои картинки (`Map` ключ →
 * `{ rgba, width, height }`).
 */
export async function buildFlagFiles(input, { game = null, images = new Map() } = {}) {
  const project = normalizeFlagsProject(input);
  if (flagsProjectIsStock(project)) return { files: [], patches: [], report: { stock: true } };
  if (!game) throw new Error("Флаги собираются из файлов вашей игры — подключите GTA V.");
  for (const id of changedFlagKinds(project)) {
    const look = flagLookOf(project, id);
    if (look.mode === "image" && look.image.asset && !images.get(look.image.asset)) throw new Error("Своя картинка флага не пришла — выберите её ещё раз.");
  }
  const files = [];
  const patches = [];
  const report = { kinds: changedFlagKinds(project).length, flags: changedFlagCount(project), sheets: 0, files: 0, missing: [] };
  /* Тот же облик на листе того же размера — один расчёт на все модели вида. */
  const painted = new Map();
  for (const item of flagFilePlan(project)) {
    const base = await game.read(item.at).catch(() => null);
    if (!base) {
      report.missing.push(item.file);
      continue;
    }
    const raw = new Uint8Array(base);
    const { refs } = resourceRefs(raw, item.file);
    const byName = new Map(refs.map((ref) => [ref.name.toLowerCase(), ref]));
    const replacements = {};
    for (const { kind, texture } of item.sheets) {
      const ref = byName.get(texture);
      if (!ref?.complete) {
        report.missing.push(`${item.file}: ${texture}`);
        continue;
      }
      const look = flagLookOf(project, kind);
      const level = decodeTextureRef(ref, { level: 0 });
      const original = new Uint8ClampedArray(level.rgba);
      /* «Как в игре» с тоном — от листа этого файла: у модели и у словаря свои байты листа. */
      const key = `${flagPaintKey(look)}|${ref.width}x${ref.height}|${look.mode === "standard" ? `${item.file}:${texture}` : ""}`;
      if (!painted.has(key)) painted.set(key, paintFlagSheet({ original, width: ref.width, height: ref.height, look, image: look.mode === "image" ? images.get(look.image.asset) || null : null }));
      const sheet = painted.get(key);
      if (!sheet) {
        report.missing.push(`${item.file}: ${texture}`);
        continue;
      }
      /* Рукав у древка — пиксели этого листа (у каждой модели свои байты сжатия). */
      const rgba = new Uint8ClampedArray(sheet);
      const hoistBytes = Math.max(1, Math.round(ref.width / 64)) * 4;
      if (look.mode !== "standard")
        for (let y = 0; y < ref.height; y += 1) {
          const at = y * ref.width * 4;
          rgba.set(original.subarray(at, at + hoistBytes), at);
        }
      replacements[ref.name] = texturePayload({ name: ref.name, format: ref.format, width: ref.width, height: ref.height, levels: ref.levels, bytes: ref.bytes }, rgba, {
        original,
        originalData: ref.resource.data.subarray(ref.dataAt, ref.dataAt + ref.bytes),
      });
      report.sheets += 1;
    }
    if (!Object.keys(replacements).length) continue;
    const patched = patchResourceTextures(raw, item.file, replacements);
    files.push({ name: item.file, bytes: Buffer.from(patched.bytes) });
    patches.push({ file: item.file, textures: patched.patched, kinds: [...new Set(item.sheets.map((sheet) => sheet.kind))] });
  }
  report.files = files.length;
  return { files, patches, report };
}
