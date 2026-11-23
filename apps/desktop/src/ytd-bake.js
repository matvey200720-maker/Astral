import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { BLOCK_FORMATS } from "@modovik/dds";
import { heavyWork } from "./heavy-work.js";

const MAX_TEXTURES = 16;
const MIN_PNG_BYTES = 8;
const MAX_PNG_BYTES = 24 * 1024 * 1024;
const PNG_SIGNATURE = 0x89504e47;
// Допустимые границы размеров слота (включительно); у числа уровней верхнего предела нет.
const LAYOUT_BOUNDS = { width: [4, 4096], height: [4, 4096], mipLevels: [1, Infinity] };
const DEFAULT_NAME_RULE = /^[A-Za-z0-9_+-]{1,96}$/;

// Обычный объект, а не Map: поиск по нему видит и ключи прототипа (особенность, которую сохраняем).
const HELPER_FORMATS = {
  D3DFMT_DXT1: "DXT1",
  D3DFMT_DXT3: "DXT3",
  D3DFMT_DXT5: "DXT5",
  D3DFMT_A8R8G8B8: "A8R8G8B8",
};

const refusal = (code, kind, message) => Object.assign(new Error(message), { code: `${code}_${kind}` });

// Правила проверки одного элемента: первое сработавшее даёт отказ своего вида.
const ITEM_RULES = [
  {
    kind: "TEXTURE",
    broken: ({ names, name }) => !names.test(name),
    say: ({ name }) => `Непонятное имя текстуры: «${name.slice(0, 96)}».`,
  },
  {
    kind: "TEXTURE",
    broken: ({ taken, name }) => taken.has(name.toLowerCase()),
    say: ({ name }) => `Текстура «${name}» пришла дважды.`,
  },
  {
    kind: "PNG",
    broken: ({ bytes }) => bytes().length < MIN_PNG_BYTES || bytes().length > MAX_PNG_BYTES,
    say: ({ name }) => `Текстура ${name} повреждена.`,
  },
  {
    kind: "PNG",
    broken: ({ bytes }) => bytes().readUInt32BE(0) !== PNG_SIGNATURE,
    say: ({ name }) => `Текстура ${name} — не PNG.`,
  },
];

function vetItem(item, code, names, taken) {
  const name = String(item?.texture || "").trim();
  let decoded;
  const view = {
    names,
    taken,
    name,
    bytes: () => (decoded ??= Buffer.from(String(item?.png || ""), "base64")),
  };
  const violated = ITEM_RULES.find((rule) => rule.broken(view));
  if (violated) throw refusal(code, violated.kind, violated.say(view));
  taken.add(name.toLowerCase());
  return { texture: name, png: view.bytes(), opaque: item.opaque !== false };
}

export function normalizePaintedTextures(input, code, { names = DEFAULT_NAME_RULE, allowEmpty = false } = {}) {
  const requested = Array.isArray(input) ? input : [];
  if (requested.length === 0) {
    if (allowEmpty) return [];
    throw refusal(code, "EMPTY", "Красить в игре пока нечего.");
  }
  if (requested.length > MAX_TEXTURES) throw refusal(code, "TOO_MANY", "Слишком много текстур.");
  const taken = new Set();
  return Array.from(requested, (item) => vetItem(item, code, names, taken));
}

export function textureLayout(texture) {
  const format = HELPER_FORMATS[String(texture?.format || "")];
  const measured = {
    width: Number(texture?.width),
    height: Number(texture?.height),
    mipLevels: Number(texture?.levels),
  };
  if (!format) return null;
  const inBounds = Object.entries(LAYOUT_BOUNDS).every(
    ([name, [low, high]]) => Number.isInteger(measured[name]) && measured[name] >= low && measured[name] <= high,
  );
  return inBounds ? { width: measured.width, height: measured.height, format, mipLevels: measured.mipLevels } : null;
}

const isBakeable = (format) => BLOCK_FORMATS.includes(format) || format === "A8R8G8B8";

function resizeToSlot(source, { width, height }, resampling) {
  return sharp(source).ensureAlpha().resize(width, height, resampling).raw().toBuffer();
}

// Стадия «пиксели»: покраска растягивается ядром lanczos3, заводская (если нужна) — без указания ядра.
function slotPixels({ png, opaque, original, layout }) {
  return Promise.resolve(resizeToSlot(png || original, layout, { fit: "fill", kernel: "lanczos3" })).then((painted) => {
    const stockPixels = opaque && original ? resizeToSlot(original, layout, { fit: "fill" }) : null;
    return Promise.resolve(stockPixels).then((stock) => ({ painted, stock }));
  });
}

export async function bakeTexture(
  { png, opaque, original, layout, alpha = null, material = null },
  { pool = heavyWork } = {},
) {
  const format = layout.format;
  if (!isBakeable(format)) throw new Error(`формат ${format} не поддерживается`);
  return slotPixels({ png, opaque, original, layout })
    .then(({ painted, stock }) => pool.run("bake-texture-pixels", { painted, stock, opaque, layout, alpha, material }))
    .then((dds) => Buffer.from(dds.buffer, dds.byteOffset, dds.byteLength));
}

// Выполнить действие; при отказе сначала откатить сделанное (отказ отката глотается), затем бросить исходную ошибку.
async function withRollback(action, rollback) {
  try {
    return await action();
  } catch (error) {
    await rollback().catch(() => {});
    throw error;
  }
}

export async function atomicWrite(file, bytes) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const staging = `${file}.${randomUUID()}.tmp`;
  await withRollback(
    () => fs.writeFile(staging, bytes).then(() => fs.rename(staging, file)),
    () => fs.rm(staging, { force: true }),
  );
}

// Вход bakeYtd: шаги идут по очереди, каждый кладёт своё значение под своим ключом.
const INTAKE_STEPS = [
  [
    "inspection",
    async (job, tools) =>
      job.inspected || (await tools.inspectYtd({ input: job.input, gameRoot: job.gameRoot, edition: "Legacy" })),
  ],
  [
    "stockDir",
    async (job, tools, context) => {
      const folder = job.decoded || path.join(job.work, "decoded", job.file);
      if (!job.decoded) await tools.readTextures(job.input, folder, context);
      return folder;
    },
  ],
];

async function runIntake(job, tools, context) {
  const gathered = {};
  for (const [key, step] of INTAKE_STEPS) gathered[key] = await step(job, tools, context);
  return gathered;
}

function indexSlots(inspection) {
  const pairs = (inspection?.resource?.textures || []).map((slot) => [String(slot?.name).toLowerCase(), slot]);
  return pairs.reduce((index, [name, slot]) => index.set(name, slot), new Map());
}

// «Единственная» текстура: в словаре ровно одна и покраска ровно одна.
function pickLone({ sole, dictionary, textures }) {
  const candidates = [...dictionary.values()];
  return sole && candidates.length === 1 && textures.length === 1 ? candidates[0] : null;
}

// Прозрачность покраски (ровная альфа или материал) не помещается в DXT1 без альфы.
const hasAlphaBelowOne = (painted) => painted.alpha != null && painted.alpha < 1;
const hasMaterial = (painted) => Boolean(painted.material);
const wantsAlphaChannel = (painted) => hasAlphaBelowOne(painted) || hasMaterial(painted);
const canPromote = (layout, painted) => layout.format === "DXT1" && wantsAlphaChannel(painted);

function bakeRequest(painted, original, layout) {
  const { png, opaque, alpha } = painted;
  return { png, opaque, original, layout, alpha, material: painted.material || null };
}

function pickSlot(painted, { dictionary, lone }) {
  return dictionary.get(painted.texture.toLowerCase()) || lone;
}

function planLayout(slot, painted) {
  const layout = textureLayout(slot);
  if (!layout) return { reason: `сжатие ${slot.format} Astral пока не собирает` };
  const promoted = canPromote(layout, painted);
  return { layout: promoted ? { ...layout, format: "DXT5" } : layout, promoted };
}

const skipOutcome = (painted, reason) => ({ skip: { texture: painted.texture, reason } });

async function storeBaked(dds, slot, plan, job) {
  const source = path.join(job.work, "dds", job.file, `${slot.name}.dds`);
  await atomicWrite(source, dds);
  const patch = { texture: slot.name, source, sha256: createHash("sha256").update(dds).digest("hex") };
  if (plan.promoted) patch.alphaFormat = true;
  const { width, height, format, mipLevels } = plan.layout;
  return { patch, report: { file: job.file, texture: slot.name, width, height, format, mipLevels } };
}

async function bakeOnePainting(painted, job) {
  const slot = pickSlot(painted, job);
  if (!slot) return job.missing ? skipOutcome(painted, job.missing) : {};
  const plan = planLayout(slot, painted);
  if (plan.reason) return skipOutcome(painted, plan.reason);

  const stock = await fs.readFile(path.join(job.stockDir, `${slot.name}.png`)).catch(() => null);
  if (!painted.png && !stock) return skipOutcome(painted, "заводская текстура не прочиталась");

  const dds = await bakeTexture(bakeRequest(painted, stock, plan.layout));
  return storeBaked(dds, slot, plan, job);
}

// Хвост bakeYtd: заплатки уходят помощнику, результат читается из выходного файла.
function applyPatches({ patches, input, file, work, gameRoot }, tools) {
  const output = path.join(work, "patched", file);
  return fs
    .mkdir(path.dirname(output), { recursive: true })
    .then(() => tools.patchYtd({ input, output, patches, gameRoot, edition: "Legacy" }))
    .then(() => fs.readFile(output));
}

export async function bakeYtd(
  { input, file, textures, work, gameRoot, missing = "", sole = false, inspected = null, decoded = "" },
  tools,
  context = null,
) {
  const { inspection, stockDir } = await runIntake({ input, file, work, gameRoot, inspected, decoded }, tools, context);
  const dictionary = indexSlots(inspection);
  const lone = pickLone({ sole, dictionary, textures });
  const job = { dictionary, lone, missing, stockDir, work, file };

  const outcomes = await Promise.all(textures.map((painted) => bakeOnePainting(painted, job)));
  const collect = (field) => outcomes.filter((outcome) => outcome[field]).map((outcome) => outcome[field]);
  const patches = collect("patch");
  const baked = collect("report");
  const skipped = collect("skip");
  const bytes = patches.length === 0 ? null : await applyPatches({ patches, input, file, work, gameRoot }, tools);
  return { bytes, baked, skipped };
}
