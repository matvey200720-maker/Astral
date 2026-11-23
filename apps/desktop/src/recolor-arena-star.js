/*
 * Звезда арены GTA5RP в файлах: своя картинка объёмной моделью.
 *
 * Сетку строит договор (`@modovik/climb-contract/recolor/arena-star`) —
 * та же, что рисует окно. Здесь — лист модели и запрос нативному хосту:
 *
 *   лист — картинка в квадрате степени двойки (до 512 px) и полоса цвета
 *     подставки внизу; развёртка фигуры сжимается в часть листа над
 *     полосой, подставка берёт полосу;
 *   модель — под именем штатной модели (`v_62_fos_props01`), фигура
 *     повёрнута лицом к центру зала (поворот интерьера вычитается: модель
 *     стоит в его осях);
 *   движение — кадры клипа (`arenaStarFrames`) и свой словарь клипов
 *     (`astral_arenas_star.ycd`); хост собирает скелет и клип по образцу
 *     штатной крутящейся модели игры (`StarModelCommands.cs`).
 *
 * Ответ хоста — ось фигуры в модели и рамка с движением: по ним установщик
 * ставит сущность звезды туда, где стояла статуя мода, и правит архетип
 * (рамка, флаги анимированной модели, словарь клипов).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { bleedTransparent, encodeDds, fullMipLevels, resample } from "@modovik/dds";
import {
  ARENA_STAR_STAND_COLOUR,
  arenaStarFrames,
  arenaStarModel,
  arenaStarMotion,
  turnArenaStarMesh,
} from "@modovik/climb-contract/recolor/arena-star";
import { hexBytes } from "@modovik/climb-contract/recolor";

export const ARENA_STAR_CLIPS = "astral_arenas_star";
const ATLAS = 512;
/* Полоса подставки внизу листа: 1/16 высоты — хватает и на мелкие мип-уровни. */
const STRIPE = ATLAS / 16;
/* Флаги архетипа анимированной модели — как у штатных крутящихся моделей. */
export const ANIMATED_ARCHETYPE_FLAGS = 0x80200;

/* Картинка в лист: вписана с сохранением пропорций над полосой подставки. */
function atlasOf(image) {
  const area = ATLAS - STRIPE;
  const scale = Math.min(ATLAS / image.width, area / image.height);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  /* Прозрачные края картинки — цветом соседей: бока и кромки фигуры берут край. */
  const resized = bleedTransparent(new Uint8ClampedArray(resample(new Uint8ClampedArray(image.rgba), image.width, image.height, width, height)), width, height);
  const rgba = new Uint8ClampedArray(ATLAS * ATLAS * 4);
  const left = Math.floor((ATLAS - width) / 2);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const from = (y * width + x) * 4;
      const to = (y * ATLAS + left + x) * 4;
      rgba[to] = resized[from];
      rgba[to + 1] = resized[from + 1];
      rgba[to + 2] = resized[from + 2];
      rgba[to + 3] = 255;
    }
  const [r, g, b] = hexBytes(ARENA_STAR_STAND_COLOUR);
  for (let y = ATLAS - STRIPE; y < ATLAS; y += 1)
    for (let x = 0; x < ATLAS; x += 1) {
      const at = (y * ATLAS + x) * 4;
      rgba[at] = r;
      rgba[at + 1] = g;
      rgba[at + 2] = b;
      rgba[at + 3] = 255;
    }
  return {
    rgba,
    /* Доли картинки → доли листа. */
    uv: (u, v) => [(left + u * width) / ATLAS, (v * height) / ATLAS],
    stand: [0.5, (ATLAS - STRIPE / 2) / ATLAS],
  };
}

/**
 * Модель звезды: `settings` — раздел `star` работы, `image` — картинка
 * `{ rgba, width, height }`, `star` — опись звезды (`yaw`), `rotation` —
 * поворот интерьера, `compile` — вызов хоста. Ответ — `{ files, pivot,
 * bounds, animated }`; файлы — `v_62_fos_props01.ydr` и (с движением)
 * `astral_arenas_star.ycd`.
 */
export async function buildArenaStar({ settings, image, star, rotation, name, compile, stateDir, lodDist = 75 }) {
  if (!image) throw new Error("Картинка звезды не пришла — выберите её ещё раз.");
  if (typeof compile !== "function") throw new Error("Сборщик модели звезды не подключён — обновите Astral.");
  const built = arenaStarModel(image.rgba, image.width, image.height, { size: settings.size, depth: settings.depth, stand: settings.stand });
  if (!built) throw new Error("В картинке звезды нет непрозрачных точек — нужна картинка с фигурой.");
  /* Лицо фигуры — на центр зала: поворот в мире минус поворот интерьера. */
  const [, , qz, qw] = rotation || [0, 0, 0, 1];
  const turn = (star?.yaw || 0) - 2 * Math.atan2(qz, qw);
  const mesh = turnArenaStarMesh(built.mesh, turn);
  const atlas = atlasOf(image);
  const uvs = new Float32Array(mesh.uvs.length);
  for (let index = 0; index < mesh.parts.length; index += 1) {
    const [u, v] = mesh.parts[index] ? atlas.uv(mesh.uvs[index * 2], mesh.uvs[index * 2 + 1]) : atlas.stand;
    uvs[index * 2] = Math.round(u * 1e5) / 1e5;
    uvs[index * 2 + 1] = Math.round(v * 1e5) / 1e5;
  }
  const motion = arenaStarMotion(settings);
  const frames = arenaStarFrames(motion);
  const dds = encodeDds({ width: ATLAS, height: ATLAS, format: "DXT5", mipLevels: fullMipLevels(ATLAS, ATLAS), rgba: atlas.rgba });
  const staging = path.join(stateDir, "recolor", "arenas", "star", randomUUID());
  const output = path.join(staging, "out");
  await fs.mkdir(staging, { recursive: true });
  try {
    const texture = path.join(staging, "star.dds");
    await fs.writeFile(texture, dds, { flag: "wx" });
    const request = path.join(staging, "request.json");
    const round = (value) => Math.round(value * 1e5) / 1e5;
    await fs.writeFile(
      request,
      JSON.stringify({
        format: "astral.compile-star-model",
        version: 1,
        name,
        clipDictionary: frames ? ARENA_STAR_CLIPS : null,
        texture,
        textureSha256: `sha256:${createHash("sha256").update(dds).digest("hex")}`,
        width: ATLAS,
        height: ATLAS,
        lodDist,
        mesh: {
          positions: Array.from(mesh.positions, round),
          normals: Array.from(mesh.normals, round),
          uvs: Array.from(uvs),
          parts: Array.from(mesh.parts),
          indices: Array.from(mesh.indices),
        },
        motion: frames,
      }),
    );
    const result = await compile("compile-star-model", { input: request, output });
    const files = [{ name: `${name}.ydr`, bytes: await fs.readFile(path.join(output, `${name}.ydr`)) }];
    if (frames) files.push({ name: `${ARENA_STAR_CLIPS}.ycd`, bytes: await fs.readFile(path.join(output, `${ARENA_STAR_CLIPS}.ycd`)) });
    if (files.some((file) => !file.bytes?.length)) throw new Error("Сборка модели звезды не дала файлов.");
    const pivot = Array.isArray(result?.pivot) ? result.pivot.map(Number) : [0, 0, 0];
    const bounds = result?.bounds?.min && result?.bounds?.max ? result.bounds : mesh.bounds;
    return { files, pivot, bounds, animated: Boolean(frames), vertices: mesh.positions.length / 3 };
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}
