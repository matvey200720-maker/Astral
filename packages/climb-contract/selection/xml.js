/*
 * Разметка выделения: XML — исходник, который читает и правит человек (ТЗ владельца 26.10.2026, раздел D: «XML-разметка… разметить один раз и потом
 * использовать файл постоянно»). Лежит в `launcher_app/resources/selection-markup/<сцена>.xml`; в поставку едет не он, а `.selmap`
 * (`selmap.js`, компилятор — `scripts/lib/selection-markup.mjs`).
 *
 *   <selection-markup version="1" scene="majestic-inside" meshes="1760" triangles="270095" sha256="…">
 *     <rooms><room id="room1" label="Круглый зал"/></rooms>
 *     <surface id="wall.room1.1" kind="wall" room="room1" group="walls" sheet="mj_wall_wood" entities="100001,100003-100010"/>
 *     <content id="screen.100123" kind="screen" room="room1" entity="100123" group="screens"/>
 *     <prop id="chair.100456" kind="chair" room="room1" entity="100456"/>
 *     <prop id="rail.1" kind="rail"><mesh n="12" tris="0-340,500-640"/></prop>
 *   </selection-markup>
 *
 * Список сущностей — атрибутом `entities` или текстом дочернего `<entities>` (длинный список удобнее читать так); диапазоны треугольников — `<mesh n tris/>`.
 * Разбор — маленький собственный: без DTD, внешних сущностей и пространств имён (разметке они не нужны, а чужой XML мы не читаем).
 * Чистый модуль без DOM и Node.
 */

import { SelectionMarkupError, SELECTION_MARKUP_VERSION, formatRanges, mergeRuns, normalizeMarkup, parseRanges } from "./markup.js";

/* ------------------------------------------------------------------ *
 * Разбор XML
 * ------------------------------------------------------------------ */

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unescapeText = (text) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return Number.isInteger(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[name.toLowerCase()] ?? match;
  });

const NAME = /[A-Za-z_][A-Za-z0-9_.:-]*/y;
const ATTRIBUTE = /\s+([A-Za-z_][A-Za-z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;

/** Дерево `{ name, attrs, children, text, line }` или бросает `SelectionMarkupError` со строкой. */
export function parseXml(source) {
  const text = String(source ?? "").replace(/^\uFEFF/, "");
  let at = 0;
  let line = 1;
  const stack = [];
  let root = null;
  const error = (message) => {
    throw new SelectionMarkupError(`XML, строка ${line}: ${message}`);
  };
  const advance = (to) => {
    for (let index = at; index < to; index += 1) if (text.charCodeAt(index) === 10) line += 1;
    at = to;
  };
  while (at < text.length) {
    const open = text.indexOf("<", at);
    const chunk = text.slice(at, open === -1 ? text.length : open);
    if (chunk.trim()) {
      if (!stack.length) error("текст вне корневого элемента");
      stack[stack.length - 1].text += unescapeText(chunk);
    }
    if (open === -1) {
      advance(text.length);
      break;
    }
    advance(open);
    if (text.startsWith("<!--", at)) {
      const end = text.indexOf("-->", at + 4);
      if (end === -1) error("комментарий не закрыт");
      advance(end + 3);
      continue;
    }
    if (text.startsWith("<?", at)) {
      const end = text.indexOf("?>", at + 2);
      if (end === -1) error("объявление не закрыто");
      advance(end + 2);
      continue;
    }
    if (text.startsWith("<!", at)) error("DTD и CDATA не поддерживаются");
    if (text.startsWith("</", at)) {
      const end = text.indexOf(">", at);
      if (end === -1) error("закрывающий тег не закрыт");
      const name = text.slice(at + 2, end).trim();
      const top = stack.pop();
      if (!top || top.name !== name) error(`закрывает «${name}», а открыт «${top?.name ?? "ничего"}»`);
      advance(end + 1);
      continue;
    }
    NAME.lastIndex = at + 1;
    const named = NAME.exec(text);
    if (!named) error("после «<» нет имени тега");
    const node = { name: named[0], attrs: {}, children: [], text: "", line };
    let position = NAME.lastIndex;
    for (;;) {
      ATTRIBUTE.lastIndex = position;
      const attribute = ATTRIBUTE.exec(text);
      if (!attribute) break;
      if (Object.hasOwn(node.attrs, attribute[1])) error(`атрибут «${attribute[1]}» повторяется`);
      node.attrs[attribute[1]] = unescapeText(attribute[2] ?? attribute[3] ?? "");
      position = ATTRIBUTE.lastIndex;
    }
    const rest = /^\s*(\/?)>/.exec(text.slice(position, position + 64));
    if (!rest) error(`у тега «${node.name}» ждали атрибут в кавычках или конец тега`);
    if (stack.length) stack[stack.length - 1].children.push(node);
    else if (root) error("корневых элементов больше одного");
    else root = node;
    advance(position + rest[0].length);
    if (!rest[1]) stack.push(node);
  }
  if (stack.length) error(`тег «${stack[stack.length - 1].name}» не закрыт`);
  if (!root) error("корневого элемента нет");
  return root;
}

/* ------------------------------------------------------------------ *
 * XML ↔ разметка
 * ------------------------------------------------------------------ */

const number = (value, where, field) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new SelectionMarkupError(`${where}: ${field} — целое число, а не «${value}»`);
  return parsed;
};

/** Диапазоны треугольников `"0-340,500-640"` без раскрытия в список: `[[от, до], …]`. */
export function parseTriangleRanges(text, where = "mesh") {
  const out = [];
  for (const part of String(text ?? "").split(",")) {
    const piece = part.trim();
    if (!piece) continue;
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(piece);
    if (!match) throw new SelectionMarkupError(`${where}: диапазон «${piece}» не по форме`);
    out.push([Number(match[1]), Number(match[2] ?? match[1])]);
  }
  return out;
}

const formatTriangleRanges = (runs) => runs.map((run) => (run.from === run.to ? String(run.from) : `${run.from}-${run.to}`)).join(",");

/** XML-текст → проверенная разметка (`normalizeMarkup`). */
export function parseMarkupXml(source) {
  const root = parseXml(source);
  if (root.name !== "selection-markup") throw new SelectionMarkupError(`Корень «${root.name}», ждали «selection-markup»`);
  const version = number(root.attrs.version ?? SELECTION_MARKUP_VERSION, "selection-markup", "version");
  const scene = { id: root.attrs.scene || "" };
  for (const key of ["meshes", "triangles"]) if (root.attrs[key] !== undefined) scene[key] = number(root.attrs[key], "selection-markup", key);
  if (root.attrs.sha256) scene.sha256 = root.attrs.sha256.toLowerCase();
  const rooms = [];
  const elements = [];
  for (const child of root.children) {
    if (child.name === "rooms") {
      for (const room of child.children) {
        if (room.name !== "room") throw new SelectionMarkupError(`XML, строка ${room.line}: в «rooms» ждали «room», а не «${room.name}»`);
        rooms.push({ id: room.attrs.id || "", ...(room.attrs.label ? { label: room.attrs.label } : {}) });
      }
      continue;
    }
    if (!["surface", "content", "prop"].includes(child.name)) throw new SelectionMarkupError(`XML, строка ${child.line}: неизвестный элемент «${child.name}»`);
    const where = `XML, строка ${child.line}`;
    const element = { id: child.attrs.id || "", type: child.name, kind: child.attrs.kind || "" };
    if (child.attrs.room) element.room = child.attrs.room;
    if (child.attrs.label) element.label = child.attrs.label;
    if (child.attrs.note) element.note = child.attrs.note;
    if (child.attrs.sheet) element.sheet = child.attrs.sheet;
    if (child.attrs.group) element.group = child.attrs.group;
    const entities = [];
    if (child.attrs.entity !== undefined) entities.push(number(child.attrs.entity, where, "entity"));
    if (child.attrs.entities !== undefined) entities.push(...parseRanges(child.attrs.entities));
    const runs = [];
    for (const inner of child.children) {
      if (inner.name === "entities") entities.push(...parseRanges(inner.text));
      else if (inner.name === "mesh") {
        const mesh = number(inner.attrs.n, `XML, строка ${inner.line}`, "n");
        for (const [from, to] of parseTriangleRanges(inner.attrs.tris, `XML, строка ${inner.line}`)) runs.push({ mesh, from, to });
      } else throw new SelectionMarkupError(`XML, строка ${inner.line}: внутри «${child.name}» неизвестный элемент «${inner.name}»`);
    }
    if (entities.length) element.entities = entities;
    if (runs.length) element.runs = runs;
    elements.push(element);
  }
  return normalizeMarkup({ version, scene, rooms, elements });
}

const escapeAttribute = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

/** Разметка → XML-текст, как её пишет человек: по элементу на строку, длинные списки сущностей — дочерним `<entities>`. */
export function formatMarkupXml(markup) {
  const value = normalizeMarkup(markup);
  const attributes = (pairs) => pairs.filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => ` ${k}="${escapeAttribute(v)}"`).join("");
  const out = ['<?xml version="1.0" encoding="utf-8"?>'];
  out.push(
    `<selection-markup${attributes([
      ["version", value.version],
      ["scene", value.scene.id],
      ["meshes", value.scene.meshes],
      ["triangles", value.scene.triangles],
      ["sha256", value.scene.sha256],
    ])}>`,
  );
  if (value.rooms.length) {
    out.push("  <rooms>");
    for (const room of value.rooms) out.push(`    <room${attributes([["id", room.id], ["label", room.label]])}/>`);
    out.push("  </rooms>");
  }
  for (const element of value.elements) {
    const head = attributes([
      ["id", element.id],
      ["kind", element.kind],
      ["room", element.room],
      ["group", element.group],
      ["sheet", element.sheet],
      ["label", element.label],
      ["note", element.note],
    ]);
    const single = element.entities?.length === 1 && element.type !== "surface" ? ` entity="${element.entities[0]}"` : "";
    const list = element.entities && !single ? formatRanges(element.entities) : "";
    const inline = list && list.length <= 120 ? ` entities="${list}"` : "";
    const children = [];
    if (list && !inline) children.push(`    <entities>${list}</entities>`);
    if (element.runs) {
      const byMesh = new Map();
      for (const run of element.runs) byMesh.set(run.mesh, [...(byMesh.get(run.mesh) || []), run]);
      for (const [mesh, runs] of byMesh) children.push(`    <mesh n="${mesh}" tris="${formatTriangleRanges(mergeRuns(runs))}"/>`);
    }
    if (children.length) out.push(`  <${element.type}${head}${single}${inline}>`, ...children, `  </${element.type}>`);
    else out.push(`  <${element.type}${head}${single}${inline}/>`);
  }
  out.push("</selection-markup>", "");
  return out.join("\n");
}
