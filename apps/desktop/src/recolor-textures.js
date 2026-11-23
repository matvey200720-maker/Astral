/*
 * Пиксели текстур на месте — в модели (.ydr), фрагменте (.yft) и словаре
 * (.ytd).
 *
 * `patchDrawable` из `@modovik/ypt` знает только модель: он ищет словарь у
 * группы шейдеров корня, а у фрагмента корень — не модель, у словаря — сам
 * словарь. Здесь текстуры находят читатели `@modovik/rage-drawable` (они
 * понимают все три вида), а правка та же: байты той же длины на том же
 * месте, ресурс сжимается заново с прежним заголовком. Размеры областей во
 * флагах заголовка не меняются — длина данных та же.
 *
 * Сторож перекрытия — как у `patchDrawable`: у двух текстур мод бывает
 * отдаёт общий хвост mip-уровней, и запись обрывается там, где начинается
 * соседняя; не ровный цвет в общий хвост не пишется вовсе.
 */

import { readDrawable, readTextureDictionary } from "@modovik/rage-drawable";
import { openResourcePlain, openResourceWith, RSC7_HEADER_BYTES } from "@modovik/ypt/resource-core";
import { deflateRaw, inflateResource } from "@modovik/native-rs";

const inflateRaw = inflateResource;

/*
 * Уровень сжатия ресурса по умолчанию — первый (04.11.2026, «установка не должна жечь процессор»). Профиль сборки «растительность как в моде» (`node --cpu-prof`,
 * потоки сборки): сжатие шестым уровнем — 54 из 162 с процессора, треть всей сборки; «Дорог» — 198 из 1136 с. Листы DXT жмутся плохо, и старшие уровни тратят
 * время почти впустую. Замер на 150 настоящих словарях текстур игры (x64e, x64g, x64q — только чтение; 163 МБ в игре), только сжатие:
 *
 *     уровень      1      2      3      4      6      9
 *     МБ         166,1  165,4  165,3  165,2  163,2  162,7
 *     секунд      1,61   3,76   4,62   4,08   5,02   8,05
 *
 * Первый — втрое быстрее шестого за +1,8 % размера (на пакет в 2 ГБ — около 36 МБ). Игра читает любой верный поток deflate, распакованное содержимое то же, так что
 * «один к одному» уровень не трогает.
 */
export const DEFAULT_RESOURCE_LEVEL = 1;

/*
 * Предел сжатого ресурса и запас до него. Размер записи в оглавлении RPF7 — 24 бита (< 16 МиБ, `ERR_GEN_ZLIB_2`, `docs/knowledge/gta5/01`), и несколько сборщиков сами отказываются
 * от файла, что вырос за 16 МиБ − 1 (щиты билбордов: `recolor-billboards.js` оставляет щит как в игре; зал со своими моделями: `recolor-place-models.js`). Первый уровень крупнее
 * девятого на 2–3 % у DXT и на десятки процентов у ровных листов, поэтому файл, что вышел за `LEVEL_FALLBACK_BYTES`, пережимается девятым и берётся меньший: в предел 16 МиБ
 * ничто не вошло бы при девятом и не выходило бы при первом (первый ≤ 12 МиБ — девятый тем более ≤ 16 МиБ). Остальным пакетам запас не нужен: они далеки от предела.
 */
export const LEVEL_FALLBACK_BYTES = 12 * 1024 * 1024;

const kindOf = (name) => String(name || "").toLowerCase().split(".").pop();

/** Текстуры ресурса с местом их байт в распакованных данных. */
function textureRefs(resource, kind) {
  const refs =
    kind === "ytd"
      ? readTextureDictionary(resource)
      : readDrawable(resource, { inflateRaw, kind }).drawables.flatMap((drawable) => drawable.embeddedTextures || []);
  const unique = new Map();
  for (const ref of refs) if (ref.complete && !unique.has(ref.dataAt)) unique.set(ref.dataAt, ref);
  const list = [...unique.values()].sort((a, b) => a.dataAt - b.dataAt);
  /* Сколько байт с начала текстуры принадлежат ей одной. */
  for (let index = 0; index < list.length; index += 1) {
    const next = list[index + 1];
    list[index].writable = next ? Math.min(list[index].bytes, next.dataAt - list[index].dataAt) : list[index].bytes;
  }
  return list;
}

/* Все mip-уровни одинаковы — картинка ровного цвета, общий хвост ей не вреден. */
const flatColour = (payload, spans) =>
  spans.every((span) =>
    payload
      .subarray(span.offset, span.offset + span.bytes)
      .every((byte, index) => byte === payload[index % spans[0].bytes]),
  );

/**
 * Текстуры файла: `{ name, format, width, height, levels, bytes, writable,
 * payload }`. `writable` меньше `bytes` — хвост mip общий с соседней
 * текстурой: на месте туда можно только ровный цвет.
 */
export function readResourceTextures(bytes, fileName) {
  const resource = openResourceWith(bytes, inflateRaw);
  return textureRefs(resource, kindOf(fileName)).map((ref) => ({
    name: ref.name,
    format: ref.format,
    width: ref.width,
    height: ref.height,
    levels: ref.levels,
    bytes: ref.bytes,
    writable: ref.writable,
    payload: Buffer.from(resource.data.subarray(ref.dataAt, ref.dataAt + ref.bytes)),
  }));
}

/**
 * Правка текстур файла за одно разжатие и одно сжатие (05.10.2026). Проходы
 * правок читают текстуры (`textures()` — уже с правками прежних проходов),
 * кладут новые пиксели (`patch`), а `finish` сжимает файл один раз. Итог —
 * байт в байт цепочка `patchResourceTextures` проход за проходом: каждый
 * проход видит то, что оставил предыдущий. Прежде словарь, где ложились
 * листва, карточки и земля «Сэнди», разжимался четыре раза и сжимался три —
 * сжатие было треть всей сборки растительности.
 */
export function openResourceTextures(bytes, fileName, { plain = false, resource: opened = null } = {}) {
  const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  /* `plain` — за заголовком уже данные (склад ресурсов), `resource` — файл уже открыт (разжатие одно на файл). */
  const resource = opened || (plain ? openResourcePlain(raw) : openResourceWith(raw, inflateRaw));
  const refs = textureRefs(resource, kindOf(fileName));
  let changed = false;
  return {
    get changed() {
      return changed;
    },
    /** Текстуры в нынешнем виде — как у `readResourceTextures`. */
    textures() {
      return refs.map((ref) => ({
        name: ref.name,
        format: ref.format,
        width: ref.width,
        height: ref.height,
        levels: ref.levels,
        bytes: ref.bytes,
        writable: ref.writable,
        payload: Buffer.from(resource.data.subarray(ref.dataAt, ref.dataAt + ref.bytes)),
      }));
    },
    /**
     * Новые пиксели названных текстур: `{ имя: байты }` → имена легших.
     * Имени нет в файле — отказ: правка, которой некуда лечь, — ошибка описи.
     */
    patch(replacements) {
      const wanted = new Map(Object.entries(replacements || {}).map(([name, payload]) => [name.toLowerCase(), payload]));
      const patched = [];
      for (const ref of refs) {
        const payload = wanted.get(ref.name.toLowerCase());
        if (!payload) continue;
        if (payload.length !== ref.bytes)
          throw new Error(`${fileName}: текстура ${ref.name} — ${payload.length} байт вместо ${ref.bytes}.`);
        if (ref.writable < ref.spans[0].bytes)
          throw new Error(`${fileName}: текстура ${ref.name} перекрыта соседней уже на первом уровне.`);
        /* Общий хвост можно оставить как есть: правка легла до него
           (карточки деревьев 8 × 8 ступени «Ухудшения текстур»). */
        const tailKept = Buffer.compare(
          Buffer.from(payload.subarray(ref.writable)),
          Buffer.from(resource.data.subarray(ref.dataAt + ref.writable, ref.dataAt + ref.bytes)),
        ) === 0;
        if (ref.writable < payload.length && !tailKept && !flatColour(payload, ref.spans))
          throw new Error(`${fileName}: текстура ${ref.name} делит байты с соседней — на месте можно только ровный цвет.`);
        resource.data.set(payload.subarray(0, ref.writable), ref.dataAt);
        patched.push(ref.name);
      }
      for (const name of wanted.keys())
        if (!patched.some((item) => item.toLowerCase() === name)) throw new Error(`${fileName}: нет текстуры ${name}.`);
      if (patched.length) changed = true;
      return patched;
    },
    /**
     * Файл заново: прежний заголовок RSC7 и данные, сжатые один раз.
     * `level` — уровень сжатия (по умолчанию первый, `DEFAULT_RESOURCE_LEVEL`).
     */
    finish({ level: chosen = null, fallbackBytes = LEVEL_FALLBACK_BYTES } = {}) {
      const level = chosen ?? DEFAULT_RESOURCE_LEVEL;
      let compressed = deflateRaw(resource.data, { level });
      /* Близко к 24 битам размера записи — лучшее сжатие, как было до первого уровня (`LEVEL_FALLBACK_BYTES`). */
      if (level < 9 && compressed.length > fallbackBytes) {
        const tighter = deflateRaw(resource.data, { level: 9 });
        if (tighter.length < compressed.length) compressed = tighter;
      }
      const out = Buffer.alloc(RSC7_HEADER_BYTES + compressed.length);
      Buffer.from(raw.buffer, raw.byteOffset, RSC7_HEADER_BYTES).copy(out, 0);
      compressed.copy(out, RSC7_HEADER_BYTES);
      return out;
    },
  };
}

/**
 * Новые пиксели названных текстур: `{ имя: байты }` → `{ bytes, patched }`.
 * Имени нет в файле — отказ: правка, которой некуда лечь, — ошибка описи.
 * `fallbackBytes` — свой порог пережатия девятым уровнем (`Infinity` — не пережимать: «Дороги», `roads-build.js`).
 * `level` — уровень сжатия (по умолчанию первый, `DEFAULT_RESOURCE_LEVEL`; у файла крупнее `LEVEL_FALLBACK_BYTES` после сжатия — девятый, если он меньше).
 */
export function patchResourceTextures(bytes, fileName, replacements, { level = null, fallbackBytes = undefined } = {}) {
  const editor = openResourceTextures(bytes, fileName);
  const patched = editor.patch(replacements);
  return { bytes: editor.finish({ level, fallbackBytes }), patched };
}
