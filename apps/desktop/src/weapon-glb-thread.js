/*
 * Сборка GLB ствола из игры — в потоке (`runOffThread`), с быстрым PNG (02.11.2026, ТЗ владельца: «Обновляю…» висит долго, пока ствол не появится).
 *
 * Замер на игре этого ПК (`scripts/perf/baseline/gun-pick.mjs`, разбор `readGameWeaponModel`): холодное чтение карабина — 3,2 с, из них сборка GLB 3,0 с, а в ней
 * 2,6–3,3 с — PNG текстур уровнем 9 (`sharp`, 8,6 Мпикс: два листа 2048² и мелочь). Здесь тот же PNG (без потерь, пиксели те же) уровнем 1 (`png-fast.js`,
 * deflate модуля Rust): ~150 мс. Картинка едет в окно по каналу между своими процессами, ей выигрыш в размере ни к чему. Разбор модели и расжатие DXT
 * (`gameWeaponModel`, 100–150 мс на ствол) шли в главном процессе и держали его очередь IPC; теперь и они, и PNG — в потоке-однодневке.
 *
 * Модуль лёгкий нарочно: поток грузит только разбор модели и сборку GLB, без всего `weapon-skin.js`.
 */

import zlib from "node:zlib";
import { drawableToGlb } from "@modovik/rage-drawable/glb";
import { gameWeaponModel } from "@modovik/gunpack/game-weapon";
import { encodePngFast } from "./png-fast.js";

const inflateRaw = (bytes) =>
  new Uint8Array(
    zlib.inflateRawSync(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), {
      finishFlush: zlib.constants.Z_SYNC_FLUSH,
    }),
  );

/**
 * Модель ствола «как в игре» в GLB: магазин на своей кости, оттенок палитры — в картинке цвета, деталь названа своей текстурой цвета.
 * `onlyParts` (19.10.2026) — одни обвесы на костях ствола, без самого ствола и магазина: слой кадра для своей модели .glb.
 * Ответ — `{ bytes, magazine, parts }`, как у прежней сборки в главном процессе.
 */
export async function buildGameWeaponGlbBytes(files, model, { parts = [], onlyParts = false } = {}) {
  const built = gameWeaponModel(files, { inflateRaw, maxTexture: 2048, parts });
  const drawable = onlyParts ? { ...built.drawable, meshes: built.drawable.meshes.filter((mesh) => mesh.part) } : built.drawable;
  const bytes = await drawableToGlb(drawable, {
    name: model,
    encodePng: async (rgba, width, height) => encodePngFast(rgba, width, height),
    textureFor: built.texture,
    materialName: (material) => material?.textures?.diffuse || "",
    /* Цвета вершин у оружия — служебные маски шейдера, а не оттенок: просмотрщик glTF умножил бы на них краску, и ствол пожелтел бы. */
    vertexColours: false,
  });
  return { bytes, magazine: built.magazine, parts: built.parts };
}
