import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as nodeCrypto from "node:crypto";
import * as engine from "@modovik/install-engine";
import * as psoFormat from "@modovik/optimizer/pso.js";

export const PAUSE_BLUR_EFFECTS = Object.freeze("PauseMenuIn PauseMenuOut".split(" "));
export const PAUSE_BLUR_MODIFIER = "hud_def_blur";
export const OWN_WORLD_MAP_PACKAGE = /^local-legacy-world-map-[a-f0-9]{12}$/;

const GAME_ARCHIVE = "update/update.rpf";
const LIVE_COPY = "animpostfx-live.ymt";
const CHKS_LABEL = 0x43484b53;
const CHKS_LENGTH = 20;

// Какие поля должна иметь структура, чтобы сыграть свою роль в схеме эффектов.
const ROLE_FIELDS = {
  layer: ["ModifierName", "Disabled"],
  stack: ["Layers", "LayerBlend"],
  effect: ["Name", "FXStack"],
};

function pickSchema(structures) {
  const roles = Object.entries(ROLE_FIELDS);
  const picked = {};
  for (const [key, shape] of structures) {
    for (const [role, names] of roles) {
      if (role in picked) continue;
      if (names.every((name) => shape.fields.has(psoFormat.literalHash(name)))) picked[role] = { key, shape };
    }
  }
  if (roles.some(([role]) => !(role in picked))) throw new Error("в animpostfx.ymt не та схема эффектов");
  return picked;
}

const fieldAt = (shape, name) => shape.fields.get(psoFormat.literalHash(name)).offset;

// Слои лежат встроенным массивом от поля Layers до следующего поля стека (или конца стека).
function measure({ layer, stack, effect }) {
  const layersAt = fieldAt(stack.shape, "Layers");
  let end = stack.shape.length;
  for (const { offset } of stack.shape.fields.values()) {
    if (offset > layersAt && offset < end) end = offset;
  }
  return {
    capacity: Math.floor((end - layersAt) / layer.shape.length),
    layerSize: layer.shape.length,
    name: fieldAt(effect.shape, "Name"),
    stack: fieldAt(effect.shape, "FXStack") + layersAt,
    modifier: fieldAt(layer.shape, "ModifierName"),
    flag: fieldAt(layer.shape, "Disabled"),
    blur: psoFormat.joaat(PAUSE_BLUR_MODIFIER),
  };
}

// Абсолютные смещения всех эффектов, целиком помещающихся в блоки данных.
function* effectStarts(pso, effect) {
  const size = effect.shape.length;
  for (const block of pso.blocks) {
    if (block.name !== effect.key) continue;
    for (let at = 0; at + size <= block.length; at += size) yield pso.dataAt + block.offset + at;
  }
}

// Слои эффекта, чей модификатор — размытие: номер и смещение слоя.
function* blurLayers(view, layout, effectAt) {
  for (let index = 0; index < layout.capacity; index += 1) {
    const at = effectAt + layout.stack + index * layout.layerSize;
    if (view.getUint32(at + layout.modifier) === layout.blur) yield { index, at };
  }
}

function restampChecksum(pso, bytes, view) {
  const section = pso.found.get(CHKS_LABEL);
  if (!section || section.length !== CHKS_LENGTH) return;
  const lengthAt = section.at + 8;
  const sumAt = section.at + 12;
  view.setUint32(lengthAt, 0);
  view.setUint32(sumAt, 0);
  const sum = psoFormat.psoChecksum(bytes);
  view.setUint32(lengthAt, bytes.length);
  view.setUint32(sumAt, sum);
}

export function disablePauseMenuBlur(input) {
  const source = input instanceof Uint8Array ? input : new Uint8Array(input);
  const pso = psoFormat.readPso(source);

  const schema = pickSchema(pso.structures);
  const layout = measure(schema);
  if (layout.capacity < 1) throw new Error("в animpostfx.ymt у эффектов нет слоёв");

  const bytes = new Uint8Array(source);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pauseHashes = PAUSE_BLUR_EFFECTS.map((name) => psoFormat.joaat(name));

  // эффект паузы -> слои размытия, которые в нём нашлись (seq хранит порядок обхода)
  const tally = new Map();
  let seq = 0;
  for (const start of effectStarts(pso, schema.effect)) {
    const slot = pauseHashes.indexOf(view.getUint32(start + layout.name));
    if (slot < 0) continue;
    const name = PAUSE_BLUR_EFFECTS[slot];
    if (!tally.has(name)) tally.set(name, []);
    for (const { index, at } of blurLayers(view, layout, start)) {
      const already = bytes[at + layout.flag] !== 0;
      if (!already) bytes[at + layout.flag] = 1;
      tally.get(name).push({ index, already, seq: seq++ });
    }
  }

  for (const name of PAUSE_BLUR_EFFECTS) {
    const rows = tally.get(name);
    if (!rows) throw new Error(`в animpostfx.ymt нет эффекта ${name}`);
    if (rows.length === 0) throw new Error(`у эффекта ${name} нет слоя размытия`);
  }

  const layers = [...tally]
    .flatMap(([effect, rows]) => rows.map((row) => ({ effect, ...row })))
    .sort((left, right) => left.seq - right.seq)
    .map(({ effect, index, already }) => ({ effect, index, already }));

  restampChecksum(pso, bytes, view);
  return { bytes, layers };
}

const reach = (root, steps) => steps.reduce((node, step) => node?.[step], root);

export async function entryOwner(gameRoot, stateDir, tools, entryName = engine.WORLD_MAP_PAUSE_BLUR_ENTRY) {
  try {
    const state = await tools.readState(stateDir);
    const target = Object.values(state?.targets || {}).find(
      (item) => path.resolve(String(item?.gameRoot || "")).toLowerCase() === path.resolve(gameRoot).toLowerCase(),
    );
    const entry = reach(target, ["archives", GAME_ARCHIVE, "entries", entryName]);
    return entry?.layers?.at(-1)?.modId || null;
  } catch {
    return null;
  }
}

const takenByOther = (owner) => Boolean(owner) && !OWN_WORLD_MAP_PACKAGE.test(owner);
const refused = (summary) => ({ file: null, summary: Object.assign({ removed: false }, summary) });

const readPatched = async (tools, request) => disablePauseMenuBlur(await tools.readGameBytes(request));

// Запись манифеста пакета карты для правленого файла.
function describeFile(content) {
  return {
    source: engine.WORLD_MAP_PAUSE_BLUR_SOURCE,
    target: GAME_ARCHIVE,
    action: "replace",
    entry: engine.WORLD_MAP_PAUSE_BLUR_ENTRY,
    size: content.length,
    sha256: nodeCrypto.createHash("sha256").update(content).digest("hex"),
  };
}

export async function buildPauseBlurFile({ gameRoot, packageRoot, stateDir }, tools) {
  const owner = await entryOwner(gameRoot, stateDir, tools);
  if (takenByOther(owner)) return refused({ reason: "owned", owner });

  const liveCopy = path.join(packageRoot, LIVE_COPY);
  const attempt = await readPatched(tools, {
    gameRoot,
    archive: GAME_ARCHIVE,
    entry: engine.WORLD_MAP_PAUSE_BLUR_ENTRY,
    output: liveCopy,
  })
    .then((patched) => ({ patched }), (error) => ({ error }))
    .finally(() => fsp.rm(liveCopy, { force: true }).catch(() => {}));
  if ("error" in attempt) {
    return refused({ reason: "unreadable", detail: attempt.error?.message || String(attempt.error) });
  }

  const payload = path.join(packageRoot, engine.WORLD_MAP_PAUSE_BLUR_SOURCE);
  await fsp.mkdir(path.dirname(payload), { recursive: true });
  const content = Buffer.from(attempt.patched.bytes);
  await fsp.writeFile(payload, content);

  const touched = attempt.patched.layers.map(({ effect, index }) => [effect, index].join("#"));
  return {
    file: describeFile(content),
    summary: Object.assign({ removed: true, reason: "" }, { layers: touched }),
  };
}
