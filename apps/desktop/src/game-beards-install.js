/*
 * «Бороды игры», установка (Ц3в, Б3, 16.11.2026; поправка общей ведущей: путь Astral Clothing DLC, в архивы игры не пишем). Лист бороды — картинка `mp_fm_faov_beard_NNN.ytd`, как
 * картинка тату: печётся в оригинальный словарь штатного листа (диффуз DXT5 512×512 с теми же уровнями, `_n` и `_s` как в игре), ложится у корня потока Astral Clothing DLC
 * (`astral_stream_00.rpf/<имя>.ytd`) пакетом `local-tattoo-paint-*` со слотом `tattoo-<имя>`. Установка и снятие — те же, что у покраски тату (`tattoo-paint.js`): «Снять из игры» — штатное
 * снятие пакета по его `modId`, файлы игры не тронуты.
 *
 * В игре не проверено: берёт ли игра лист цирюльника из DLC и какой из двух листов (база или потоковая копия) играет — проба на стенде (`NOTE-game-beards-api-1611.md`, раздел 6).
 */

import path from "node:path";
import { tattooPaintTxd } from "@modovik/install-engine";
import sharp from "sharp";
import { readGameBeards } from "./game-beards.js";
import { readTattooYtd, tattooPicture } from "./game-tattoos.js";
import { defaultTools, installTattooPaintBuilt, writeTattooPaintPackage } from "./tattoo-paint.js";

const refusal = (code, message) => Object.assign(new Error(message), { code });

/* Сторона листа штатной бороды. */
const SHEET_SIDE = 512;

/* Запекание — тяжёлый модуль (читатель персонажа): в главном процессе он грузится только когда листа нет в запросе и его надо испечь заново. Обычно лист приходит из окна. */
const bakeOnDemand = async (...args) => (await import("./game-beards-bake.js")).bakeGameBeard(...args);

/* Лист из окна приходит PNG в base64 (как картинки покраски тату), из запекания Desktop — байтами. */
const bytesOf = (value) =>
  typeof value === "string" ? Buffer.from(value, "base64") : Buffer.isBuffer(value) ? value : Buffer.from(value instanceof ArrayBuffer ? new Uint8Array(value) : value);

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/* Лист штатного размера 512×512 весит десятки килобайт; больше четырёх мегабайт — не лист бороды. */
const MAX_SHEET_BYTES = 4 * 1024 * 1024;

/**
 * Собирает пакет бороды на диск, ничего не ставя. `input`: `{ gameRoot, key, targetId?, sheet? }` — `sheet` PNG листа (из `bakeGameBeard`); без него борода запекается из вещи `input` заново
 * (так ставит сборка: в `clothingChoice` листа нет). Ответ — как у покраски тату: `{ directory, manifest, manifestHash, gameRoot, targetId, target, baked, skipped }`.
 */
export async function buildGameBeardPackage(input, stateDir, deps = {}) {
  const gameRoot = path.resolve(String(input?.gameRoot || ""));
  const key = String(input?.key || "").toLowerCase();
  if (!input?.gameRoot || !key) throw refusal("GAME_BEARDS", "Не названа борода игры.");
  const tools = { ...defaultTools, index: readGameBeards, ytd: readTattooYtd, picture: tattooPicture, bake: bakeOnDemand, ...(deps.tools || {}) };
  const index = await tools.index({ gameRoot, stateDir, keysDirectory: deps.keysDirectory || null });
  const beard = (index.beards || []).find((entry) => entry.key === key);
  if (!beard) throw refusal("GAME_BEARDS", "Такой бороды в игре нет — список устарел, открой «Замену» заново.");
  if (!beard.target) throw refusal("GAME_BEARDS", "Эту бороду пока не ставим: сопоставление её листа с игрой не выяснено.");
  if (!beard.place) throw refusal("GAME_BEARDS", "Листа этой бороды в игре нет.");
  const txd = tattooPaintTxd(beard.name);
  if (!txd) throw refusal("GAME_BEARDS", `У бороды «${beard.title}» неподходящее имя листа.`);

  const sheet = input.sheet ? bytesOf(input.sheet) : bytesOf((await tools.bake(input, deps.context || {}, { ...deps, stateDir })).sheet);
  if (sheet.length > MAX_SHEET_BYTES || !sheet.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE))
    throw refusal("GAME_BEARDS", "Лист бороды — не PNG или слишком тяжёлый.");
  const original = await tools.ytd({ gameRoot, keysDirectory: deps.keysDirectory || null, tattoo: { place: beard.place } });
  const picture = tools.picture(original, beard.name);
  const width = Math.min(SHEET_SIDE, picture.full.width);
  const height = Math.min(SHEET_SIDE, picture.full.height);
  /* Лист — ровно штатного размера: слишком большой или малый приводится, прозрачность остаётся. */
  const png = await sharp(sheet).resize(width, height, { fit: "fill" }).ensureAlpha().png().toBuffer();
  /* Альфа бороды — рисунок: лист несёт свою, а не прежнюю. */
  const result = await tools.paint([{ name: `${txd}.ytd`, bytes: original }], [{ texture: picture.name, png, opaque: false }]);
  if (!result.baked?.length) throw refusal("GAME_BEARDS", result.skipped?.[0]?.reason || "Лист бороды не перезаписать.");
  const file = { txd, bytes: Buffer.from(result.files[0].bytes), title: beard.title };
  const pack = await writeTattooPaintPackage({ files: [file], places: [], name: "Борода игры", stateDir });
  return {
    ...pack,
    gameRoot,
    targetId: String(input?.targetId || "default"),
    target: { key: beard.key, title: beard.title },
    baked: [beard.title],
    skipped: [],
    kept: [],
    moved: [],
  };
}

/**
 * Ставит бороду: собирает пакет и ставит его так же, как покраску тату (проверка игры, DLC одежды, план, установка). Ответ — как у `installTattooPaintBuilt`: `modId`, `slots`, `restartRequired`;
 * `modId` окно запоминает и по нему же снимает («Снять из игры»).
 */
export async function installGameBeard(input, stateDir, deps = {}) {
  const built = await buildGameBeardPackage(input, stateDir, deps);
  const installed = await installTattooPaintBuilt(built, stateDir, deps);
  return { ...installed, key: built.target.key, title: built.target.title };
}
