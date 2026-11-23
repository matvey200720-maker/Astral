/*
 * Плашка эмблемы в мире — общая у наборов мест («Завод», «Маппинг»).
 *
 * Листы мест повторяются по развёртке (или у мода — 4×4), поэтому картинка
 * «в одно место» едет своей моделью: нативный хост собирает
 * (`compile-emblem-plates`, `EmblemPlateCommands.cs`) двустороннюю плашку с
 * картинкой, свой архетип, свою карту и манифест, который их связывает.
 * Имена у каждого набора свои (`FACTORY_PLATE`, `MAPPING_PLATE`): наборы
 * ставятся и снимаются порознь.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { bleedTransparent, encodeDds, fullMipLevels, resample } from "@modovik/dds";
import { clearPlates, withFarPlates } from "./recolor-lod.js";

/* Сторона степени двойки не больше `limit`, не меньше 16. */
const powerOfTwo = (value, limit) => Math.min(limit, Math.max(16, 2 ** Math.ceil(Math.log2(Math.max(1, value)))));

/* Большая сторона листа дальней копии: её видно только издалека. */
export const FAR_PLATE_SHEET = 256;

/*
 * Дальняя копия — всегда своей моделью `<имя>_far` (падение 30.10.2026):
 * когда карта `_lod` звала тот же архетип, что и HD-плашка, клиент Majestic
 * зависал или падал в меню с «Invalid asset <плашка>.ydr»; своей моделью — чисто
 * (журналы заходов владельца 21:42 и 21:55). Лист — та же картинка, меньше.
 */
function withFarModel(plate) {
  if (!plate.far || plate.far.image || !plate.image) return plate;
  const width = plate.texture?.[0] || powerOfTwo(plate.image.width, 1024);
  const height = plate.texture?.[1] || powerOfTwo(plate.image.height, 1024);
  const scale = Math.min(1, FAR_PLATE_SHEET / Math.max(width, height));
  const texture = [powerOfTwo(width * scale, FAR_PLATE_SHEET), powerOfTwo(height * scale, FAR_PLATE_SHEET)];
  return { ...plate, far: { ...plate.far, image: plate.image, texture } };
}

/**
 * Плашка эмблемы: `plate` — место в мире (`factoryEmblemPlate`,
 * `mappingEmblemPlate`), `image` — картинка `{ rgba, width, height }` →
 * DXT5 со всеми мип-уровнями (сторона — степень двойки до 1024;
 * непрозрачность работы — в альфе), запрос нативному хосту и его файлы.
 * `names` — `{ types, map }` набора, `files` — какие файлы ждать, `set` —
 * папка во временном. `compile(команда, вход)` — вызов хоста (в тестах —
 * подмена). `[{ name, bytes }]` или `[]` без эмблемы.
 */
export async function buildEmblemPlate({ plate, image, compile, stateDir, set, names, files }) {
  if (!plate) return [];
  if (!image) throw new Error("Картинка эмблемы не пришла — выберите её ещё раз.");
  return buildEmblemPlates({ plates: [{ ...plate, image }], compile, stateDir, set, names, files });
}

/**
 * Несколько плашек одним вызовом хоста (стороны, логотипы и надпись
 * здания): `plates` — `[{ name, image, position, rotation, size, lodDist,
 * opacity, texture? }]`; `texture` — `[ширина, высота]` листа плашки
 * (степени двойки, до 2048), без него — по картинке до 1024. `files` —
 * какие файлы ждать (без файлов плашек, которых нет в работе, — их отберут
 * по именам плашек), `[{ name, bytes }]`.
 *
 * `far` — `{ lod, game }`: у каждой плашки дальняя копия (`withFarPlates`,
 * фикс 1 ТЗ 06.10.2026) — плашка видна и там, где здание рисуют дальние
 * модели; карта дальних плашек `<map>_lod.ymap` и модели `<имя>_far.ydr`
 * едут вместе с остальными.
 *
 * `near` — грани моделей HD места у плашек (`nearPlateTriangles`): плашка
 * выносится перед деталями стены, что выступают в её прямоугольнике
 * (кирпич, наличник, пилястра), — картинку они больше не закрывают
 * (задача 11 ТЗ 10.10.2026). Дальняя копия считается уже от вынесенной.
 */
export async function buildEmblemPlates({ plates, compile, stateDir, set, names, files, far = null, near = null }) {
  const filtered = (plates || []).filter(Boolean);
  if (!filtered.length) return [];
  const cleared = near ? clearPlates(filtered, near) : filtered;
  const list = far ? (await withFarPlates(cleared, far)).map(withFarModel) : cleared;
  if (typeof compile !== "function") throw new Error("Сборщик плашки эмблемы не подключён — обновите Astral.");
  const staging = path.join(stateDir, "recolor", set, "plates", randomUUID());
  const output = path.join(staging, "out");
  /* Рабочая папка — запрос и листы плашек, пока хост их читает. */
  const attempt = async () => {
    await fs.mkdir(staging, { recursive: true });
    const request = [];
    /* Лист плашки: DXT5 со всеми мипами (сторона — степень двойки до 1024). */
    const sheet = async (name, image, size, opacity = 1) => {
      const width = size?.[0] || powerOfTwo(image.width, 1024);
      const height = size?.[1] || powerOfTwo(image.height, 1024);
      const rgba =
        image.width === width && image.height === height
          ? new Uint8ClampedArray(image.rgba)
          : new Uint8ClampedArray(resample(new Uint8ClampedArray(image.rgba), image.width, image.height, width, height));
      if (opacity < 1) for (let at = 3; at < rgba.length; at += 4) rgba[at] = Math.round(rgba[at] * opacity);
      const dds = encodeDds({ width, height, format: "DXT5", mipLevels: fullMipLevels(width, height), rgba: bleedTransparent(rgba, width, height) });
      const texture = path.join(staging, `${name}.dds`);
      await fs.writeFile(texture, dds, { flag: "wx" });
      return { texture, textureSha256: `sha256:${createHash("sha256").update(dds).digest("hex")}`, width, height };
    };
    for (const plate of list) {
      if (!plate.image) throw new Error("Картинка плашки не пришла — нажмите «Применить» ещё раз.");
      const own = await sheet(plate.name, plate.image, plate.texture, plate.opacity);
      /* Своя картинка дальней (задача 7 ТЗ 10.10.2026): своя модель `<имя>_far`. */
      const farSheet = plate.far?.image ? await sheet(`${plate.name}_far`, plate.far.image, plate.far.texture, plate.opacity) : null;
      request.push({
        name: plate.name,
        ...own,
        size: plate.size,
        position: plate.position,
        rotation: plate.rotation,
        lodDist: plate.lodDist,
        ...(plate.far ? { far: { position: plate.far.position, lodDist: plate.far.lodDist, ...(farSheet || {}) } } : {}),
      });
    }
    const requestFile = path.join(staging, "request.json");
    await fs.writeFile(
      requestFile,
      JSON.stringify({ format: "astral.compile-emblem-plates", version: 1, typesName: names.types, mapName: names.map, plates: request }),
    );
    await compile("compile-emblem-plates", { input: requestFile, output });
    const wanted = [...(files || [...list.map((plate) => `${plate.name}.ydr`), `${names.types}.ytyp`, `${names.map}.ymap`, "_manifest.ymf"])];
    if (list.some((plate) => plate.far) && !wanted.includes(`${names.map}_lod.ymap`)) wanted.push(`${names.map}_lod.ymap`);
    for (const plate of list) if (plate.far?.image && !wanted.includes(`${plate.name}_far.ydr`)) wanted.push(`${plate.name}_far.ydr`);
    const built = [];
    for (const name of wanted) {
      const bytes = await fs.readFile(path.join(output, name)).catch(() => null);
      if (!bytes?.length) throw new Error(`Сборка плашки эмблемы не дала ${name}.`);
      built.push({ name, bytes });
    }
    return built;
  };
  try {
    try {
      return await attempt();
    } catch (error) {
      if (!(await stagingVanished(error, staging))) throw await explainUnseen(error);
      /* Папку убрал кто-то снаружи, пока хост до неё добирался (антивирус,
         чистильщик диска): всё нужное — в памяти, собираем и зовём хост ещё раз. */
      await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
      try {
        return await attempt();
      } catch (again) {
        if (await stagingVanished(again, staging)) throw new Error(STAGING_VANISHED);
        throw await explainUnseen(again);
      }
    }
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

export const STAGING_VANISHED =
  "Рабочая папка сборки плашек пропала посреди сборки — похоже, её удалил антивирус или чистильщик диска. Добавьте папку Astral (%LOCALAPPDATA%\\Astral) в исключения антивируса и нажмите «Применить» ещё раз.";

/* Хост не нашёл папку или файл, а запроса на месте уже нет — папку убрали. */
const MISSING = /Could not find|DirectoryNotFound|was not found|does not exist/i;
async function stagingVanished(error, staging) {
  if (!MISSING.test(String(error?.message || error))) return false;
  return !(await fs.stat(path.join(staging, "request.json")).then(() => true, () => false));
}

/* Запрос на месте, а хост его не видит — путь у приложения и хоста разный: говорим это в отказе. */
async function explainUnseen(error) {
  const text = String(error?.message || error);
  if (!(MISSING.test(text) && /request\.json/.test(text))) return error;
  return new Error(`${text} (приложение записало запрос на место, а хост его не видит — рабочая папка недоступна хосту)`);
}

/**
 * Плашки эмблем работы: `plates` — места в мире (`factoryEmblemPlates`,
 * `mappingEmblemPlates`, `arenaEmblemPlates`), у каждой свой `asset`; `images`
 * — картинки по `asset` (`Map` → `{ rgba, width, height }`, у одной картинки
 * может быть несколько плашек); `files(число плашек)` — какие файлы ждать.
 * Остальное — как у `buildEmblemPlates`. `[{ name, bytes }]` или `[]`.
 */
export async function buildAssetPlates({ plates, images, files, ...rest }) {
  const list = (plates || []).filter(Boolean);
  if (!list.length) return [];
  const withImages = list.map((plate) => {
    const image = images?.get(plate.asset);
    if (!image) throw new Error("Картинка эмблемы не пришла — выберите её ещё раз.");
    return { ...plate, image };
  });
  return buildEmblemPlates({ ...rest, plates: withImages, files: files(withImages.length) });
}
