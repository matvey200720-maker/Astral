import { cardKey, shotKey } from "@modovik/gunpack/ids";

export const COMPOSITION_SCHEMA = 1;

const MAX_PICKS = 160;
const MAX_NAME_LENGTH = 80;
const MAX_MODEL_TAIL = 60;
const COMPOSE_CODE = "GUNPACK_COMPOSE";
const SOURCE_GONE_CODE = "GUNPACK_SOURCE_GONE";

const HEX_DIGITS = "0123456789abcdef";
const LATIN_LOWER = "abcdefghijklmnopqrstuvwxyz";
const MODEL_TAIL_CHARS = `${LATIN_LOWER}0123456789_`;

const fail = (message, code = COMPOSE_CODE) => Object.assign(new Error(message), { code });

// Возвращает найденное или бросает отказ; текст строится только при отказе.
function required(found, describe, code) {
  if (found) return found;
  throw fail(describe(), code);
}

const consistsOf = (text, alphabet) => [...text].every((ch) => alphabet.includes(ch));

const isPackId = (text) => text.length === 24 && consistsOf(text, HEX_DIGITS);

// w_ + две латинские буквы + _ + хвост из 1..60 знаков.
function isModelName(text) {
  const tail = text.slice(5);
  return text.startsWith("w_")
    && text.length >= 6
    && consistsOf(text.slice(2, 4), LATIN_LOWER)
    && text[4] === "_"
    && tail.length <= MAX_MODEL_TAIL
    && consistsOf(tail, MODEL_TAIL_CHARS);
}

const tidyName = (raw) => String(raw || "").split(/\s+/).filter(Boolean).join(" ").slice(0, MAX_NAME_LENGTH);

// Одна запись выбора: годность, затем повтор модели среди уже принятых.
function parsePick(entry, taken) {
  const [packId, model] = [entry?.packId, entry?.model].map((raw) => String(raw || ""));
  if (!(isPackId(packId) && isModelName(model))) {
    throw fail("Непонятный выбор ствола.");
  }
  if (taken.has(model)) {
    throw fail(`Ствол ${model} выбран дважды — оставьте одну версию.`);
  }
  taken.add(model);
  return { packId, variantKey: String(entry.variantKey ?? ""), model };
}

function parsePicks(list) {
  const taken = new Set();
  return Array.from(list, (entry) => parsePick(entry, taken));
}

function parseDonor(source) {
  const claimed = source?.packId;
  if (!claimed) return null;
  const packId = String(claimed);
  if (!isPackId(packId)) {
    throw fail("Непонятный источник обвесов.");
  }
  return { packId, variantKey: String(source.variantKey ?? "") };
}

export function normalizeComposition(input) {
  const name = tidyName(input?.name);
  if (!name) {
    throw fail("Назовите свою сборку.");
  }
  const picks = parsePicks(Array.isArray(input.picks) ? input.picks : []);
  const withinLimits = picks.length >= 1 && picks.length <= MAX_PICKS;
  if (!withinLimits) {
    throw fail("Выберите хотя бы один ствол из паков.");
  }
  return { name, picks, attachments: parseDonor(input.attachments) };
}

export function splitComposedPath(value) {
  const text = String(value || "");
  const slash = text.indexOf("/");
  if (slash < 0) return null;
  const packId = text.slice(0, slash);
  return isPackId(packId) ? { packId, path: text.slice(slash + 1) } : null;
}

const firstWith = (list, field, wanted) => list.find((item) => item[field] === wanted);

function locateVariant(sources, packId, variantKey) {
  const pack = sources.get(packId);
  // Опись пака-источника читается с диска без проверки: ложное `variants` — то же, что пустой список.
  return { pack, variant: pack && firstWith(pack.variants || [], "key", variantKey) };
}

// Копия записи, у которой пути файлов идут через id пака-источника.
const pathVia = (packId) => (file) => ({ ...file, path: `${packId}/${file.path}` });

function relocated(record, packId) {
  const files = record.files.map(pathVia(packId));
  return { ...record, files };
}

const stamp = ({ packId, variantKey }, { name: packName }, { label: variantLabel }) =>
  ({ packId, packName, variantKey, variantLabel });

// Порядок стволов: семейство по правилам среды, затем имя по-русски.
const WEAPON_ORDER = [
  [(weapon) => String(weapon.family), (left, right) => left.localeCompare(right)],
  [(weapon) => String(weapon.name), (left, right) => left.localeCompare(right, "ru")],
];

function compareWeapons(first, second) {
  for (const [pluck, compare] of WEAPON_ORDER) {
    const diff = compare(pluck(first), pluck(second));
    if (diff) return diff;
  }
  return 0;
}

// Ствол выбора: запись для описи и два кадра (вырезка, карточка).
function stagePick(pick, sources, target) {
  const { pack, variant } = locateVariant(sources, pick.packId, pick.variantKey);
  const weapon = required(
    variant && firstWith(variant.weapons, "model", pick.model),
    () => `Ствола ${pick.model} в паке «${pack?.name || pick.packId}» больше нет.`,
  );
  const shots = [shotKey, cardKey].map((keyOf) => {
    const [from, to] = [variant, target].map((side) => keyOf(side, weapon.model));
    return { packId: pick.packId, from, to };
  });
  return { weapon: { ...relocated(weapon, pick.packId), origin: stamp(pick, pack, variant) }, shots };
}

function selectWeapons(composition, sources) {
  const target = { key: "", label: composition.name };
  const staged = composition.picks.map((pick) => stagePick(pick, sources, target));
  const weapons = staged.map((entry) => entry.weapon).sort(compareWeapons);
  return { weapons, shots: staged.flatMap((entry) => entry.shots) };
}

function collectAttachments(donor, sources) {
  if (!donor) return [];
  const { variant } = locateVariant(sources, donor.packId, donor.variantKey);
  const source = required(variant, () => "Пака, из которого берутся обвесы, больше нет в «Моих паках».");
  return source.attachments.map((item) => relocated(item, donor.packId));
}

// Имена источников: паки стволов по первому появлению, затем пак обвесов.
function sourceNames(composition, sources) {
  const ids = new Set(composition.picks.map((pick) => pick.packId));
  if (composition.attachments) ids.add(composition.attachments.packId);
  return Array.from(ids, (id) => sources.get(id)?.name || id);
}

const emptyLists = () => ({ containers: [], warnings: [] });

const stamped = (composition) => ({ schemaVersion: COMPOSITION_SCHEMA, ...composition });

function assemble({ id, now, composition, names, weapons, attachments }) {
  const { files, bytes } = [...weapons, ...attachments].reduce((tally, record) => ({
    files: tally.files + record.files.length,
    bytes: tally.bytes + (record.bytes || 0),
  }), { files: 0, bytes: 0 });
  return {
    id,
    name: composition.name,
    composed: true,
    composition: stamped(composition),
    sources: names,
    openedAt: now,
    ...emptyLists(),
    weaponFiles: files,
    total: weapons.length,
    variants: [{ key: "", label: composition.name, dlcpacks: [], files, bytes, weapons, attachments }],
  };
}

export function composeSummary({ id, composition, sources, now }) {
  const { weapons, shots } = selectWeapons(composition, sources);
  const attachments = collectAttachments(composition.attachments, sources);
  const names = sourceNames(composition, sources);
  return { summary: assemble({ id, now, composition, names, weapons, attachments }), shots };
}

const sourceMissing = (path) => () => `В паке-источнике нет «${path}» — пак изменился.`;

// Чтение каждый раз идёт к источнику заново: дерево пака держит студия.
function sourceFile(treeOf, file, { packId, path }) {
  const read = async () => {
    const tree = await treeOf(packId);
    const original = firstWith(tree.files, "path", path);
    return required(original, sourceMissing(path), SOURCE_GONE_CODE).read();
  };
  return { path: file.path, size: file.size, read };
}

const emptyTree = (name, files) => ({ name, digest: null, files, ...emptyLists(), close: async () => {} });

export function composedTree(summary, treeOf) {
  const variant = summary.variants[0];
  const files = [...variant.weapons, ...variant.attachments].flatMap((record) =>
    [...record.files].flatMap((file) => {
      const place = splitComposedPath(file.path);
      return place ? [sourceFile(treeOf, file, place)] : [];
    }));
  return emptyTree(summary.name, files);
}
