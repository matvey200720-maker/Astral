import { SaxesParser } from "saxes";

const MAX_XML_BYTES = 4 * 1024 * 1024;
const MAX_MODIFIERS = 5000;
const MAX_FIELDS_PER_MODIFIER = 512;
const MAX_TEXT_BYTES = 16 * 1024;

function escapeText(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttribute(value) {
  return escapeText(value).replaceAll('"', "&quot;");
}

function normalizedAttributes(attributes) {
  return Object.fromEntries(
    Object.entries(attributes || {})
      .map(([name, value]) => [name, String(value)])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

/*
 * Комментарии на разбор не влияют и в собранный XML не попадают (`serializeTimecycleModifierXml` пишет файл заново из
 * модификаторов). А в настоящих редуксах они «кривые»: `<!-- CREATOR: автор <!--` без закрытия, `--` внутри — игра такой файл
 * читает, строгий разбор отказывал `malformed comment`, и два таймцикла в одной пачке или в одном файле не склеивались
 * (21.11.2026, стенд сценариев установки: карточка `vendetta-v1-redux-timecycle`, `006-timecycle_mods_4.xml`). Убираем до разбора.
 */
const stripXmlComments = (xml) => xml.replace(/<!--[\s\S]*?-->/g, "");

export function parseTimecycleModifierXml(input) {
  const raw = String(input || "");
  if (!raw.trim()) throw new Error("Timecycle XML is empty.");
  if (Buffer.byteLength(raw, "utf8") > MAX_XML_BYTES)
    throw new Error("Timecycle XML exceeds the safe size limit.");
  if (/<!DOCTYPE\b|<!ENTITY\b/i.test(raw))
    throw new Error("Timecycle XML cannot contain DTD or entities.");
  const xml = stripXmlComments(raw);
  if (!xml.trim()) throw new Error("Timecycle XML is empty.");

  const document = { rootAttributes: null, modifiers: [] };
  const stack = [];
  let activeModifier = null;
  let activeField = null;
  let parseError = null;
  const parser = new SaxesParser({ xmlns: false });

  parser.on("error", (error) => {
    parseError ||= error;
  });
  parser.on("doctype", () => {
    parseError ||= new Error("Timecycle XML cannot contain a doctype.");
  });
  parser.on("opentag", (node) => {
    if (parseError) return;
    const depth = stack.length;
    if (depth === 0) {
      if (node.name !== "timecycle_modifier_data") {
        parseError = new Error("Unexpected timecycle XML root element.");
        return;
      }
      document.rootAttributes = normalizedAttributes(node.attributes);
    } else if (depth === 1) {
      if (node.name !== "modifier") {
        parseError = new Error(
          "Timecycle root accepts only modifier elements.",
        );
        return;
      }
      const attributes = normalizedAttributes(node.attributes);
      const name = String(attributes.name || "").trim();
      if (
        !name ||
        name.length > 160 ||
        [...name].some((character) => character.charCodeAt(0) <= 0x1f)
      ) {
        parseError = new Error("Timecycle modifier name is invalid.");
        return;
      }
      if (document.modifiers.length >= MAX_MODIFIERS) {
        parseError = new Error(
          "Timecycle modifier count exceeds the safe limit.",
        );
        return;
      }
      activeModifier = { name, attributes, fields: [] };
      document.modifiers.push(activeModifier);
    } else if (depth === 2 && activeModifier) {
      if (activeModifier.fields.length >= MAX_FIELDS_PER_MODIFIER) {
        parseError = new Error(
          "Timecycle modifier field count exceeds the safe limit.",
        );
        return;
      }
      activeField = {
        name: node.name,
        attributes: normalizedAttributes(node.attributes),
        text: "",
      };
      activeModifier.fields.push(activeField);
    } else {
      parseError = new Error("Nested timecycle XML fields are not supported.");
      return;
    }
    stack.push(node.name);
  });
  parser.on("text", (text) => {
    if (parseError || !text) return;
    if (activeField) {
      activeField.text += text;
      if (Buffer.byteLength(activeField.text, "utf8") > MAX_TEXT_BYTES)
        parseError = new Error("Timecycle field value exceeds the safe limit.");
    } else if (text.trim()) {
      parseError = new Error("Unexpected text in timecycle XML.");
    }
  });
  parser.on("cdata", (text) => {
    if (activeField) activeField.text += text;
    else if (text.trim())
      parseError ||= new Error("Unexpected CDATA in timecycle XML.");
  });
  parser.on("closetag", () => {
    if (stack.length === 3) activeField = null;
    if (stack.length === 2) activeModifier = null;
    stack.pop();
  });
  parser.write(xml).close();
  if (parseError) throw parseError;
  if (stack.length || !document.rootAttributes)
    throw new Error("Timecycle XML document is incomplete.");
  return document;
}

function serializeAttributes(attributes) {
  return Object.entries(attributes || {})
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
    .join("");
}

export function serializeTimecycleModifierXml(document) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<timecycle_modifier_data${serializeAttributes(document.rootAttributes)}>`,
  ];
  for (const modifier of document.modifiers) {
    const attributes = { ...modifier.attributes, name: modifier.name };
    if (!modifier.fields.length) {
      lines.push(`  <modifier${serializeAttributes(attributes)} />`);
      continue;
    }
    lines.push(`  <modifier${serializeAttributes(attributes)}>`);
    for (const field of modifier.fields) {
      lines.push(
        `    <${field.name}${serializeAttributes(field.attributes)}>${escapeText(field.text.trim())}</${field.name}>`,
      );
    }
    lines.push("  </modifier>");
  }
  lines.push("</timecycle_modifier_data>", "");
  return lines.join("\n");
}

function selectedModifiers(document, includeNames, excludeNames) {
  const including = Array.isArray(includeNames) && includeNames.length > 0;
  if (!including && Array.isArray(excludeNames) && excludeNames.length > 0) {
    /* Исключённых в файле может и не быть: убирать нечего, это не ошибка. */
    const skipped = new Set(excludeNames.map((name) => String(name).toLowerCase()));
    return document.modifiers.filter((modifier) => !skipped.has(modifier.name.toLowerCase()));
  }
  if (!including) {
    return document.modifiers;
  }
  const allowed = new Set(includeNames.map((name) => name.toLowerCase()));
  const selected = [];
  const indexes = new Map();
  for (const modifier of document.modifiers) {
    const identity = modifier.name.toLowerCase();
    if (!allowed.has(identity)) continue;
    const existing = indexes.get(identity);
    if (existing == null) {
      indexes.set(identity, selected.length);
      selected.push(modifier);
    } else {
      selected[existing] = modifier;
    }
  }
  const missing = [...allowed].filter((name) => !indexes.has(name));
  if (missing.length) {
    throw new Error(
      `Timecycle XML does not contain required modifiers: ${missing.join(", ")}.`,
    );
  }
  return selected;
}

export function selectTimecycleModifierXml(xml, includeNames) {
  const parsed = parseTimecycleModifierXml(xml);
  return serializeTimecycleModifierXml({
    rootAttributes: parsed.rootAttributes,
    modifiers: selectedModifiers(parsed, includeNames),
  });
}

export function mergeTimecycleModifierXml(documents) {
  const ordered = (documents || [])
    .map((item, index) => ({
      xml: String(item?.xml || ""),
      priority: Number(item?.priority || 0),
      includeNames: Array.isArray(item?.includeNames)
        ? item.includeNames.map(String)
        : null,
      excludeNames: Array.isArray(item?.excludeNames)
        ? item.excludeNames.map(String)
        : null,
      index,
    }))
    .sort(
      (left, right) =>
        left.priority - right.priority || left.index - right.index,
    );
  if (!ordered.length)
    throw new Error("No timecycle XML layers were provided.");

  let rootAttributes = null;
  const modifiers = [];
  const modifierIndexes = new Map();
  for (const item of ordered) {
    const parsed = parseTimecycleModifierXml(item.xml);
    rootAttributes ||= parsed.rootAttributes;
    for (const modifier of selectedModifiers(parsed, item.includeNames, item.excludeNames)) {
      const identity = modifier.name.toLowerCase();
      const existingIndex = modifierIndexes.get(identity);
      if (existingIndex == null) {
        modifierIndexes.set(identity, modifiers.length);
        modifiers.push(modifier);
      } else {
        modifiers[existingIndex] = modifier;
      }
    }
  }
  return serializeTimecycleModifierXml({ rootAttributes, modifiers });
}
