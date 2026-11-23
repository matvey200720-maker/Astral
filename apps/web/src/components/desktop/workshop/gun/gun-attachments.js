// Режим обвесов выводится из источника модели и цели покраски; по режиму
// выбираются ствол таблицы игры, кости панели и годная часть выбора человека.
import * as attach from "@modovik/rpf-inspector/weapon-attachments";
import * as identity from "@modovik/rpf-inspector/weapon-identity";

function attachmentMode(model, target) {
  const rule = model && target ? MODE_RULES.get(model.source) : undefined;
  return rule !== undefined && rule.accepts(target) ? rule.mode : "none";
}

function attachmentWeapon(model, slotId, mode) {
  const choose = WEAPON_CHOOSERS.get(mode) ?? chooseByShelf;
  const weapon = choose(model, slotId);
  return (weapon && weapon.id) || "";
}

function attachmentPoints(weaponId, mode) {
  if (!weaponId) return [];
  const narrow = POINT_VIEWS.get(mode);
  const all = attach.weaponAttachPoints(weaponId);
  return narrow === undefined ? all : narrow(all);
}

function attachmentSelection(weaponId, mode, attachments) {
  if (!weaponId) return {};
  const picked = attach.normalizeAttachments(weaponId, attachments);
  if (!POINT_VIEWS.has(mode)) return picked;

  const embeddable = new Set();
  for (const point of attachmentPoints(weaponId, mode)) embeddable.add(point.bone);
  const kept = {};
  for (const [bone, name] of Object.entries(picked)) {
    if (embeddable.has(bone)) kept[bone] = name;
  }
  return kept;
}

function onlyEmbedded(points) {
  const embedded = [];
  for (const point of points) {
    if (point.mode === "embed") embedded.push(point);
  }
  return embedded;
}

const chooseByShelf = (_model, slotId) => identity.weaponByShelf(slotId);
const chooseByModel = (model) => identity.weaponByModel(model?.weaponId);

const anyTarget = () => true;

// Источник модели -> режим и условие на цель покраски (поля цели читаются по истинности).
const MODE_RULES = new Map([
  ["builtin", { mode: "game", accepts: anyTarget }],
  ["game", { mode: "game", accepts: anyTarget }],
  ["custom", { mode: "own", accepts: (target) => target.own }],
  ["gunpack", { mode: "pack", accepts: (target) => target.pack }],
  ["catalog", { mode: "take", accepts: (target) => target.take }],
]);

// Режим -> как искать ствол. Все остальные режимы (в том числе «own») — по полке.
const WEAPON_CHOOSERS = new Map([
  ["none", () => null],
  ["pack", chooseByModel],
  ["take", (model, slotId) => chooseByModel(model) ?? chooseByShelf(model, slotId)],
  ["game", (model, slotId) => (model?.source === "game" ? chooseByModel(model) : chooseByShelf(model, slotId))],
]);

// Режимы, где панель и выбор оставляют только вшиваемые кости.
const POINT_VIEWS = new Map([
  ["pack", onlyEmbedded],
  ["take", onlyEmbedded],
]);

export { attachmentWeapon, attachmentSelection, attachmentPoints, attachmentMode };
