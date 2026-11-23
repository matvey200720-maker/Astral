/*
 * Правка квадов `water.xml` поверх файла игрока.
 *
 * Файл приходит из чужого архива и уходит обратно в игру, поэтому здесь не
 * «разобрать и собрать заново», а точечная замена значений: разбор знает не
 * всякую конструкцию, и пересборка молча выкинула бы то, чего не поняла, — у
 * таймцикла это правило записано ровно теми же словами. Меняются только числа
 * внутри `value="…"` у полей, которые правит проект; каждый прочий байт файла
 * обязан пережить правку нетронутым, и это проверяется после неё, а не
 * предполагается.
 *
 * Почему правка сплошная по секции, а не по границам квадов: мод «волны выше»
 * правит амплитуду СУЩЕСТВУЮЩИХ квадов и не перекраивает карту воды — это
 * контракт редактора (`water-model.js`), и здесь он тот же. Исключение одно —
 * уровень: `z` меняется только у квадов ванильного океана (z = 0). Реки, озёра
 * и бассейны стоят на своих высотах, и «поднять воду» про них не говорит
 * ничего; квад, уже поднятый чужим модом, тоже не наш — трогать его значило бы
 * молча переписать чужую работу.
 */

const MAX_WATER_XML_BYTES = 24 * 1024 * 1024;

/* Секции верхнего уровня `water.xml` — ровно те, что читает игра
   (`native/CodeWalker.Core/World/Water.cs`). */
const SECTIONS = Object.freeze([
  Object.freeze({ key: "water", tag: "WaterQuads", fields: ["z"] }),
  Object.freeze({
    key: "calming",
    tag: "CalmingQuads",
    fields: ["fDampening"],
  }),
  Object.freeze({
    key: "wave",
    tag: "WaveQuads",
    fields: ["Amplitude", "XDirection", "YDirection"],
  }),
]);

const textBytes = (value) => Buffer.byteLength(String(value), "utf8");

/*
 * Число в записи файла: без хвоста нулей, но и без экспоненты.
 *
 * Ванильный файл пишет коротко («0.1», «-0.603208»), и патч, раздувший каждое
 * значение до шести знаков, читался бы в диффе как правка всей карты воды.
 */
export function formatQuadValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0";
  return String(Number(numeric.toFixed(6)));
}

function assertWaterXml(xml) {
  const text = String(xml || "");
  if (!text.trim()) throw new Error("Файл water.xml пуст.");
  if (textBytes(text) > MAX_WATER_XML_BYTES)
    throw new Error("Файл water.xml превышает безопасный размер.");
  if (/<!DOCTYPE\b|<!ENTITY\b/i.test(text))
    throw new Error("Файл water.xml не может содержать DTD или сущности.");
  if (!/<WaterData\b/.test(text))
    throw new Error("Файл не похож на water.xml: нет корня WaterData.");
  return text;
}

/** Границы одной секции. Их либо нет вовсе, либо ровно одна — иначе отказ. */
function sectionSlice(xml, tag) {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const start = xml.indexOf(open);
  if (start < 0) return null;
  if (xml.indexOf(open, start + open.length) >= 0)
    throw new Error(`Секция ${tag} встречается в water.xml дважды.`);
  const end = xml.indexOf(close, start);
  if (end < 0) throw new Error(`Секция ${tag} в water.xml оборвана.`);
  return { start: start + open.length, end };
}

const ITEM_PATTERN = /<Item>[\s\S]*?<\/Item>/g;

const fieldPattern = (field) =>
  new RegExp(`(<${field}\\s+value=")([^"]*)("\\s*/>)`);

/**
 * Структура файла для проверки: по каждой секции — список квадов с их полями.
 *
 * Это не полный разбор (игре он и не нужен здесь), а слепок ровно тех полей,
 * которые правка может задеть: по нему сверяется «до» и «после».
 */
export function parseWaterQuads(xml) {
  const text = assertWaterXml(xml);
  const result = {};
  for (const section of SECTIONS) {
    const slice = sectionSlice(text, section.tag);
    if (!slice) {
      result[section.key] = null;
      continue;
    }
    const body = text.slice(slice.start, slice.end);
    const items = body.match(ITEM_PATTERN) || [];
    /* Каждый открытый <Item> обязан попасть в разбор: непарный тег означал бы,
       что часть квадов молча выпала из проверки. */
    const opened = (body.match(/<Item>/g) || []).length;
    if (opened !== items.length)
      throw new Error(`Секция ${section.tag} в water.xml повреждена.`);
    result[section.key] = items.map((item) => {
      const fields = {};
      for (const field of section.fields) {
        const match = item.match(fieldPattern(field));
        fields[field] = match ? match[2] : null;
      }
      return fields;
    });
  }
  return result;
}

const isVanillaSea = (raw) => {
  const numeric = Number(raw);
  return Number.isFinite(numeric) && Math.abs(numeric) < 1e-6;
};

/**
 * Накладывает разреженные правки на текст `water.xml`.
 *
 * `edits` — что двинул человек: `amplitude`, `direction {x, y}`, `dampening`,
 * `level`. Отсутствующее поле не трогается вовсе — правки ложатся на любую
 * базу, ванильную или уже пропатченную чужим водным модом.
 *
 * Возвращает `{ xml, counts }`, где counts — сколько квадов каждого рода
 * правка в самом деле задела. Ноль — не ошибка, а честный ответ (у уровня он
 * означает «океана с z = 0 в этом файле не нашлось»), и решать, что с ним
 * делать, — дело установщика, которому виден весь план.
 */
export function applyWaterQuadEdits(xml, edits = {}) {
  const base = assertWaterXml(xml);
  const wanted = edits && typeof edits === "object" ? edits : {};
  const hasWave =
    Number.isFinite(wanted.amplitude) ||
    (wanted.direction &&
      Number.isFinite(wanted.direction.x) &&
      Number.isFinite(wanted.direction.y));
  const hasCalming = Number.isFinite(wanted.dampening);
  const hasLevel = Number.isFinite(wanted.level);
  if (!hasWave && !hasCalming && !hasLevel)
    return { xml: base, counts: { water: 0, calming: 0, wave: 0 } };

  const counts = { water: 0, calming: 0, wave: 0 };
  let text = base;

  const patchSection = (tag, patchItem) => {
    const slice = sectionSlice(text, tag);
    if (!slice) return false;
    const body = text.slice(slice.start, slice.end);
    const patched = body.replace(ITEM_PATTERN, patchItem);
    text = text.slice(0, slice.start) + patched + text.slice(slice.end);
    return true;
  };

  const setField = (item, field, value) =>
    item.replace(
      fieldPattern(field),
      (_, before, __, after) => `${before}${formatQuadValue(value)}${after}`,
    );

  if (hasWave) {
    const found = patchSection("WaveQuads", (item) => {
      let next = item;
      if (Number.isFinite(wanted.amplitude))
        next = setField(next, "Amplitude", wanted.amplitude);
      if (wanted.direction) {
        next = setField(next, "XDirection", wanted.direction.x);
        next = setField(next, "YDirection", wanted.direction.y);
      }
      if (next !== item) counts.wave += 1;
      return next;
    });
    if (!found)
      throw new Error("В water.xml нет секции WaveQuads — волну не поправить.");
  }

  if (hasCalming) {
    const found = patchSection("CalmingQuads", (item) => {
      const next = setField(item, "fDampening", wanted.dampening);
      if (next !== item) counts.calming += 1;
      return next;
    });
    if (!found)
      throw new Error(
        "В water.xml нет секции CalmingQuads — гашение не поправить.",
      );
  }

  if (hasLevel) {
    const found = patchSection("WaterQuads", (item) => {
      const match = item.match(fieldPattern("z"));
      if (!match || !isVanillaSea(match[2])) return item;
      counts.water += 1;
      return setField(item, "z", wanted.level);
    });
    if (!found)
      throw new Error(
        "В water.xml нет секции WaterQuads — уровень не поправить.",
      );
  }

  verifyWaterQuadEdits(base, text, wanted, counts);
  return { xml: text, counts };
}

/*
 * Проверка правки — та самая часть «валидатора», без которой доставка воды
 * числилась заблокированной в `mod-targets`.
 *
 * Сверяется не «файл похож на правду», а точная арифметика: квадов столько же,
 * правленые поля равны ровно ожидаемым числам, неправленые — байт в байт как
 * были. Ошибка здесь роняет установку ДО записи в архив, а не после запуска
 * игры.
 */
function verifyWaterQuadEdits(baseXml, patchedXml, edits, counts) {
  const before = parseWaterQuads(baseXml);
  const after = parseWaterQuads(patchedXml);
  const expectAmplitude = Number.isFinite(edits.amplitude)
    ? formatQuadValue(edits.amplitude)
    : null;
  const expectDirection = edits.direction
    ? {
        x: formatQuadValue(edits.direction.x),
        y: formatQuadValue(edits.direction.y),
      }
    : null;
  const expectDampening = Number.isFinite(edits.dampening)
    ? formatQuadValue(edits.dampening)
    : null;
  const expectLevel = Number.isFinite(edits.level)
    ? formatQuadValue(edits.level)
    : null;

  for (const section of SECTIONS) {
    const first = before[section.key];
    const second = after[section.key];
    if ((first === null) !== (second === null))
      throw new Error(`Правка потеряла секцию ${section.tag} в water.xml.`);
    if (first === null) continue;
    if (first.length !== second.length)
      throw new Error(
        `Правка изменила число квадов ${section.tag}: было ${first.length}, стало ${second.length}.`,
      );
    for (let index = 0; index < first.length; index += 1) {
      for (const field of section.fields) {
        const was = first[index][field];
        const now = second[index][field];
        const expected =
          field === "Amplitude"
            ? expectAmplitude
            : field === "XDirection"
              ? (expectDirection?.x ?? null)
              : field === "YDirection"
                ? (expectDirection?.y ?? null)
                : field === "fDampening"
                  ? expectDampening
                  : field === "z" && expectLevel !== null && isVanillaSea(was)
                    ? expectLevel
                    : null;
        const want = expected === null ? was : expected;
        if ((now ?? null) !== (want ?? null))
          throw new Error(
            `Проверка правки water.xml не сошлась: ${section.tag}[${index}].${field} = «${now}», ожидалось «${want}».`,
          );
      }
    }
  }

  /* Счётчики обязаны сходиться с тем, что видно в файле: по ним установщик
     рассказывает человеку, что именно уедет в игру. */
  const waveItems = before.wave ? before.wave.length : 0;
  if ((expectAmplitude || expectDirection) && counts.wave !== waveItems)
    throw new Error("Счёт правленых волновых квадов не сошёлся с файлом.");
  const calmingItems = before.calming ? before.calming.length : 0;
  if (expectDampening && counts.calming !== calmingItems)
    throw new Error("Счёт правленых квадов гашения не сошёлся с файлом.");
  if (expectLevel !== null) {
    const seaItems = (before.water || []).filter((item) =>
      isVanillaSea(item.z),
    ).length;
    if (counts.water !== seaItems)
      throw new Error("Счёт правленых квадов океана не сошёлся с файлом.");
  }
}
