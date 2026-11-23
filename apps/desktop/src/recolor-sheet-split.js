/*
 * Свой лист у поверхности, что делит лист с соседями — общее у построек
 * (задача 11 ТЗ 17.10.2026, владелец: «пофиксить наложение текстур, они
 * выходят за пределы… на всех постройках, арена — та же проблема»).
 *
 * Отделка (узор, картинка, градиент) и свой цвет пишутся в лист, а лист у
 * Rockstar и у серверов лежит сразу на нескольких поверхностях: у оболочки
 * зала Majestic стены, потолок и пол — одна геометрия с одним шейдером и
 * общими листами, а штукатурка стен — ещё и на стойках и боксах. Правка
 * листа одной поверхности ложилась на все: узор стен — на потолок и стойки.
 * Кадр редактора красит каждую поверхность своим материалом — в кадре этого
 * не было видно, в игре было.
 *
 * Здесь у поверхности — своя копия листа под своим именем
 * (`<лист>_a<поверхность>`): нативный хост (`split-sheet-surfaces`) уводит её
 * треугольники в свою геометрию с копией шейдера и зашивает копию листа
 * (байт в байт, формат и мипы те же; `split.dds` — своя картинка листа, любого
 * размера: так банкоматы поднимают экран до 1024) в модель. Красится уже копия — штатный
 * лист остаётся соседям как был. Буферы вершин, развёртка и рамки не
 * меняются.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { writeDdsHeader } from "@modovik/dds";

/** Имя своей копии листа `sheet` у поверхности `surface` (до 160 знаков). */
export function surfaceSheetName(sheet, surface) {
  const suffix = `_a${String(surface || "x").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8)}`;
  return `${String(sheet).toLowerCase().slice(0, 160 - suffix.length)}${suffix}`;
}

/* Лист как DDS той же раскладки: заголовок и данные из файла. */
function ddsOf(ref) {
  const data = ref.resource.data.subarray(ref.dataAt, ref.dataAt + ref.bytes);
  return Buffer.concat([
    Buffer.from(writeDdsHeader({ width: ref.width, height: ref.height, mipLevels: ref.levels, format: ref.format })),
    Buffer.from(data.buffer, data.byteOffset, data.byteLength),
  ]);
}

/**
 * Модель (`.ydr`) со своими листами у частей: `splits` — `[{ model, slot,
 * triangles | null, from, to }]` (`model`, `slot` — место геометрии у
 * `readDrawable`, `triangles` — номера треугольников в её буфере индексов,
 * `null` — геометрия целиком); `sheetOf(from)` — `{ ref, dictionary }`:
 * штатный лист (`ref` из `resourceRefs`) и байты словаря, где он лежит
 * (`null` — лист встроен в саму модель). Ответ — байты новой модели.
 */
export async function splitSheetSurfaces({ base, fileName, splits, sheetOf, compile, stateDir = "", set = "places" }) {
  if (!splits.length) return Buffer.from(base);
  if (typeof compile !== "function") throw new Error("Сборщик своих листов поверхностей не подключён — обновите Astral.");
  const staging = path.join(stateDir || ".", "recolor", set, "split", randomUUID());
  await fs.mkdir(staging, { recursive: true });
  try {
    const sheets = new Map();
    const dictionaries = new Map();
    const request = [];
    for (const split of splits) {
      const from = String(split.from).toLowerCase();
      if (!sheets.has(split.to)) {
        /* Свой DDS (увеличенный лист банкомата): флаги и имя берёт хост у встроенного листа `from`, картинка — своя. */
        const found = split.dds ? null : sheetOf(from);
        if (!split.dds && !found?.ref?.complete) throw new Error(`Лист ${from} для ${fileName} не найден или повреждён.`);
        const dds = path.join(staging, `t${sheets.size}.dds`);
        await fs.writeFile(dds, split.dds || ddsOf(found.ref), { flag: "wx" });
        let source = null;
        if (found?.dictionary) {
          source = dictionaries.get(found.dictionary);
          if (!source) {
            source = path.join(staging, `s${dictionaries.size}.ytd`);
            await fs.writeFile(source, found.dictionary, { flag: "wx" });
            dictionaries.set(found.dictionary, source);
          }
        }
        sheets.set(split.to, { dds, source });
      }
      const sheet = sheets.get(split.to);
      request.push({
        model: split.model,
        geometry: split.slot,
        ...(split.triangles ? { triangles: [...split.triangles] } : {}),
        from,
        to: split.to,
        dds: sheet.dds,
        ...(sheet.source ? { source: sheet.source } : {}),
      });
    }
    const input = path.join(staging, "in.ydr");
    const output = path.join(staging, "out.ydr");
    const file = path.join(staging, "request.json");
    await fs.writeFile(input, base, { flag: "wx" });
    await fs.writeFile(file, JSON.stringify({ format: "astral.split-sheet-surfaces", version: 1, target: input, splits: request }));
    await compile("split-sheet-surfaces", { input: file, output });
    const bytes = await fs.readFile(output).catch(() => null);
    if (!bytes?.length) throw new Error(`Свои листы поверхностей ${fileName} не собрались.`);
    return bytes;
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}
