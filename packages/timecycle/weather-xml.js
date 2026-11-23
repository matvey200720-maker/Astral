/*
 * weather.xml — типы погоды самой игры.
 *
 * Дождя, луж, снега на земле, тумана-погоды и молнии в файлах таймцикла нет
 * ни одним параметром: их игра включает по типу погоды, и все они живут
 * здесь, в `common/data/levels/gta5/weather.xml` (копия в `update.rpf`
 * перекрывает базовую). У каждого типа:
 *
 *   <Rain value="1.0"/>              сила дождя: капли, мокрый асфальт, лужи
 *   <Snow value="0.5"/>              снег: хлопья и снег на земле
 *   <SnowMist value="0.1"/>          снежная дымка
 *   <Fog value="0.8"/>               туман погоды
 *   <Lightning value="true"/>        молния и гром
 *   <Sun value="0.2"/>               сколько солнца пробивается
 *   <DropSettingName>…</…>           частицы: капли / хлопья
 *   <MistSettingName>…</…>           частицы: водяная пыль
 *   <GroundSettingName>…</…>         частицы: брызги и позёмка у земли
 *   <TimeCycleFilename>…</…>         файл таймцикла типа
 *   <CloudSettingsName>…</…>         набор облачных шапок (`cloudkeyframes.xml`)
 *
 * ПРАВКА ТОЧЕЧНАЯ, А НЕ ПЕРЕСБОРКА
 *
 * Файл Rockstar держит строки через CRLF, отступы то табом, то пробелами, и
 * закомментированные варианты путей для других платформ. Пересобрать его из
 * разобранного значило бы переписать все пятьдесят восемь килобайт ради
 * десятка полей — и выкинуть то, чего разбор не понял. Поэтому правка меняет
 * ровно те значения, которые просили, а всё остальное остаётся байт в байт.
 * Комментарии при поиске полей пропускаются: в них лежат пути `W_*_PC.XML`,
 * и правка, попавшая в комментарий, не сделала бы ничего.
 */

import { SaxesParser } from "saxes";

import { xmlForParsing } from "./xml-declaration.js";

const MAX_WEATHER_XML_BYTES = 4 * 1024 * 1024;

/** Числовые поля типа погоды, которые правит вид. */
export const WEATHER_VALUE_FIELDS = Object.freeze([
  "Sun",
  "Cloud",
  "WindMin",
  "WindMax",
  "Rain",
  "Snow",
  "SnowMist",
  "Fog",
  "Lightning",
]);

/** Текстовые поля типа погоды. */
export const WEATHER_TEXT_FIELDS = Object.freeze([
  "DropSettingName",
  "MistSettingName",
  "GroundSettingName",
  "TimeCycleFilename",
  "CloudSettingsName",
]);

/** Места комментариев: всё внутри них поиск полей обходит. */
function commentRanges(xml) {
  const ranges = [];
  let from = 0;
  for (;;) {
    const start = xml.indexOf("<!--", from);
    if (start < 0) break;
    const end = xml.indexOf("-->", start + 4);
    if (end < 0) {
      ranges.push([start, xml.length]);
      break;
    }
    ranges.push([start, end + 3]);
    from = end + 3;
  }
  return ranges;
}

const insideComment = (ranges, index) =>
  ranges.some(([start, end]) => index >= start && index < end);

/** Первое совпадение вне комментариев. */
function findOutside(xml, pattern, from, to, ranges) {
  const regex = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  regex.lastIndex = from;
  for (;;) {
    const match = regex.exec(xml);
    if (!match || match.index >= to) return null;
    if (!insideComment(ranges, match.index)) return match;
    regex.lastIndex = match.index + 1;
  }
}

function assertWellFormed(xml) {
  const parser = new SaxesParser();
  let failure = null;
  parser.on("error", (error) => {
    failure ||= error;
  });
  parser.on("doctype", () => {
    failure ||= new Error("DTD в weather.xml не допускается.");
  });
  parser.write(xmlForParsing(xml)).close();
  if (failure)
    throw new Error(`weather.xml повреждён: ${failure.message || failure}`);
}

/**
 * Типы погоды файла: имя, где лежит блок и значения полей.
 *
 * Разбор строгий к тому, что правится, и снисходительный ко всему прочему:
 * неизвестные поля и разметка вокруг не мешают. Файл без раздела типов —
 * не weather.xml, и молча вернуть пустой список значило бы «применить» вид,
 * который не выключит ни одной погоды.
 */
export function parseWeatherTypes(xml) {
  const text = String(xml ?? "");
  if (!text.trim()) throw new Error("weather.xml пуст.");
  if (text.length > MAX_WEATHER_XML_BYTES)
    throw new Error("weather.xml превышает безопасный размер.");
  assertWellFormed(text);
  const ranges = commentRanges(text);
  const open = findOutside(text, /<WeatherTypes>/, 0, text.length, ranges);
  const close = open
    ? findOutside(text, /<\/WeatherTypes>/, open.index, text.length, ranges)
    : null;
  if (!open || !close)
    throw new Error("В weather.xml нет раздела WeatherTypes.");

  const types = [];
  let cursor = open.index + open[0].length;
  for (;;) {
    const item = findOutside(text, /<Item>/, cursor, close.index, ranges);
    if (!item) break;
    const end = findOutside(text, /<\/Item>/, item.index, close.index, ranges);
    if (!end) throw new Error("В weather.xml не закрыт тип погоды.");
    const bodyStart = item.index + item[0].length;
    const bodyEnd = end.index;
    const name = readText(text, "Name", bodyStart, bodyEnd, ranges);
    if (!name) throw new Error("В weather.xml тип погоды без имени.");
    const values = {};
    for (const field of WEATHER_VALUE_FIELDS) {
      const value = readValue(text, field, bodyStart, bodyEnd, ranges);
      if (value !== null) values[field] = value;
    }
    const texts = {};
    for (const field of WEATHER_TEXT_FIELDS) {
      const value = readText(text, field, bodyStart, bodyEnd, ranges);
      if (value !== null) texts[field] = value;
    }
    types.push({
      name,
      start: item.index,
      end: end.index + end[0].length,
      bodyStart,
      bodyEnd,
      values,
      texts,
    });
    cursor = end.index + end[0].length;
  }
  if (!types.length) throw new Error("В weather.xml нет ни одного типа погоды.");
  return types;
}

function valuePattern(field) {
  return new RegExp(`<${field}\\s+value="([^"]*)"\\s*\\/>`);
}

function textPattern(field) {
  return new RegExp(`<${field}>([^<]*)<\\/${field}>`);
}

function readValue(text, field, from, to, ranges) {
  const match = findOutside(text, valuePattern(field), from, to, ranges);
  if (!match) return null;
  const raw = match[1].trim();
  if (raw === "true" || raw === "false") return raw === "true";
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : raw;
}

function readText(text, field, from, to, ranges) {
  const match = findOutside(text, textPattern(field), from, to, ranges);
  return match ? match[1].trim() : null;
}

const formatValue = (value) => {
  if (typeof value === "boolean") return value ? "true" : "false";
  const numeric = Number(value);
  if (!Number.isFinite(numeric))
    throw new Error(`Значение поля погоды не число: ${value}`);
  return numeric.toFixed(6);
};

const SETTING_NAME = /^[A-Za-z0-9_\-/:.]{1,96}$/;

/**
 * Правит типы погоды и возвращает новый текст файла.
 *
 * `plan` — карта «имя типа → правка»:
 *   { cloneFrom: "EXTRASUNNY" }  — тип становится копией другого: все его
 *                                  поля, кроме имени и своего файла
 *                                  таймцикла (так выключенный дождь ведёт
 *                                  себя как ясный день — с его ветром,
 *                                  солнцем, морем и облаками);
 *   { values: { Rain: 0 } }      — числовые поля и `Lightning`;
 *   { texts: { DropSettingName: "-" } } — имена наборов частиц и облаков.
 *
 * Сначала копия, потом значения: правка поверх копии — «как ясный день, но с
 * этим набором облаков».
 *
 * Тип, которого в файле нет, пропускается и попадает в отчёт: у Legacy и у
 * старых сборок набор типов разный, и падать из-за хеллоуина, которого в игре
 * человека нет, установке незачем.
 */
export function patchWeatherTypes(xml, plan = {}) {
  let text = String(xml ?? "");
  const skipped = [];
  const applied = [];
  const names = Object.keys(plan || {});
  for (const name of names) {
    const edit = plan[name] || {};
    let types = parseWeatherTypes(text);
    const target = types.find((item) => item.name === name);
    if (!target) {
      skipped.push(name);
      continue;
    }

    if (edit.cloneFrom && edit.cloneFrom !== name) {
      const source = types.find((item) => item.name === edit.cloneFrom);
      if (!source) {
        skipped.push(`${name}←${edit.cloneFrom}`);
      } else {
        text = cloneBody(text, source, target);
        types = parseWeatherTypes(text);
      }
    }

    for (const [field, value] of Object.entries(edit.values || {})) {
      if (!WEATHER_VALUE_FIELDS.includes(field))
        throw new Error(`Поле погоды «${field}» правкой не предусмотрено.`);
      const current = parseWeatherTypes(text).find((item) => item.name === name);
      text = replaceField(
        text,
        current,
        valuePattern(field),
        (match) => match.replace(/value="[^"]*"/, `value="${formatValue(value)}"`),
        `${name}/${field}`,
        skipped,
      );
    }

    for (const [field, value] of Object.entries(edit.texts || {})) {
      if (!WEATHER_TEXT_FIELDS.includes(field) || field === "TimeCycleFilename")
        throw new Error(`Поле погоды «${field}» правкой не предусмотрено.`);
      const setting = String(value ?? "").trim();
      if (!SETTING_NAME.test(setting))
        throw new Error(`Недопустимое имя набора «${setting}».`);
      const current = parseWeatherTypes(text).find((item) => item.name === name);
      text = replaceField(
        text,
        current,
        textPattern(field),
        () => `<${field}>${setting}</${field}>`,
        `${name}/${field}`,
        skipped,
      );
    }
    applied.push(name);
  }
  assertWellFormed(text);
  return { xml: text, applied, skipped };
}

function replaceField(text, type, pattern, replacement, label, skipped) {
  const ranges = commentRanges(text);
  const match = findOutside(text, pattern, type.bodyStart, type.bodyEnd, ranges);
  if (!match) {
    skipped.push(label);
    return text;
  }
  return (
    text.slice(0, match.index) +
    replacement(match[0]) +
    text.slice(match.index + match[0].length)
  );
}

/*
 * Тело одного типа — в другой.
 *
 * Имя и файл таймцикла остаются свои: имя — это то, по чему сервер включает
 * погоду, а файл таймцикла у выключенной погоды правит вид (он станет ясным
 * небом отдельно). Комментарии из копии убираются: закомментированные пути
 * источника в чужом типе читались бы как ошибка, а игре они не нужны.
 */
function cloneBody(text, source, target) {
  const ranges = commentRanges(text);
  const targetName = readText(text, "Name", target.bodyStart, target.bodyEnd, ranges);
  const targetTimecycle = readText(
    text,
    "TimeCycleFilename",
    target.bodyStart,
    target.bodyEnd,
    ranges,
  );
  let body = text
    .slice(source.bodyStart, source.bodyEnd)
    .replace(/<!--[\s\S]*?-->[^\S\r\n]*(\r?\n)?/g, "");
  body = body.replace(textPattern("Name"), `<Name>${targetName}</Name>`);
  if (targetTimecycle !== null)
    body = body.replace(
      textPattern("TimeCycleFilename"),
      `<TimeCycleFilename>${targetTimecycle}</TimeCycleFilename>`,
    );
  return text.slice(0, target.bodyStart) + body + text.slice(target.bodyEnd);
}

/*
 * Расписание погоды.
 *
 * Раздел `<WeatherCycles>` — это список «погода и сколько она длится»
 * (`<CycleName>`, `<TimeMult>`): игра идёт по нему по кругу, пока скрипт не
 * поставит погоду сам. У Legacy в нём 173 пункта. «Вечная погода» оставляет
 * все пункты и их `TimeMult` на месте и меняет только имена: расписание из
 * одного типа игра читает так же, как любое другое, и числа пунктов не нужно
 * подгонять под неё.
 */
const CYCLE_NAME = /<CycleName>([^<]*)<\/CycleName>/;
const TYPE_NAME = /^[A-Za-z0-9_]{1,40}$/;

/** Пункты расписания: `[{ name, start, end }]` — место имени в тексте. */
export function parseWeatherCycles(xml) {
  const text = String(xml ?? "");
  if (text.length > MAX_WEATHER_XML_BYTES)
    throw new Error("weather.xml превышает безопасный размер.");
  const ranges = commentRanges(text);
  const open = findOutside(text, /<WeatherCycles>/, 0, text.length, ranges);
  const close = open
    ? findOutside(text, /<\/WeatherCycles>/, open.index, text.length, ranges)
    : null;
  if (!open || !close) return [];
  const items = [];
  let cursor = open.index + open[0].length;
  for (;;) {
    const match = findOutside(text, CYCLE_NAME, cursor, close.index, ranges);
    if (!match) break;
    const start = match.index + "<CycleName>".length;
    items.push({ name: match[1].trim(), start, end: start + match[1].length });
    cursor = match.index + match[0].length;
  }
  return items;
}

/**
 * Расписание из одного типа: каждый пункт получает это имя, остальное в
 * файле — байт в байт. Тип должен быть в самом файле: имя, которого игра не
 * знает, она не поставит. Возвращает `{ xml, count, changed }` — сколько
 * пунктов и в скольких имя сменилось; файл без расписания — `count: 0`.
 */
export function patchWeatherCycles(xml, typeName) {
  let text = String(xml ?? "");
  const name = String(typeName ?? "").trim();
  if (!TYPE_NAME.test(name)) throw new Error(`Недопустимое имя погоды «${name}».`);
  if (!parseWeatherTypes(text).some((item) => item.name === name))
    throw new Error(`Погоды «${name}» в weather.xml нет.`);
  const items = parseWeatherCycles(text);
  let changed = 0;
  for (const item of [...items].reverse()) {
    if (item.name === name) continue;
    text = text.slice(0, item.start) + name + text.slice(item.end);
    changed += 1;
  }
  if (changed) assertWellFormed(text);
  return { xml: text, count: items.length, changed };
}

/**
 * Файл таймцикла типа погоды — имя без пути, строчными.
 * `COMMON:/DATA/TIMECYCLE/W_snow.XML` → `w_snow.xml`: игра читает пути без
 * учёта регистра, а архив хранит имена строчными.
 */
export function timecycleFileOf(type) {
  const path = String(type?.texts?.TimeCycleFilename || "");
  const name = path.split(/[\\/]/).pop();
  return name ? name.toLowerCase() : null;
}
