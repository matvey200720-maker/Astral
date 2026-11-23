import { sceneItemElements, sceneMaterialElement } from "./item-elements.js";
import { tr } from "../../../locales/ui.js";
import { itemElementKey, itemElementNames, itemElementWord } from "@modovik/climb-contract/recolor/item-elements";

const BODY_WORD = "Корпус";
const SCREEN_WORD = "Экран";
const PLAIN_WORD = "Покрытие";
const SCREEN_GROUP = "screens";

const sameKey = (key) => key;

/* Слово и, если слово повторяется, порядковый номер через пробел. */
const numbered = (word, index) => (index > 0 ? `${tr(word)} ${index}` : tr(word));

function keyOfMaterial(scene, material) {
  const { texture, name } = material;
  switch (typeof texture) {
    case "string":
      return itemElementKey(texture);
    case "number":
      return Number.isInteger(texture) ? itemElementKey(name || scene?.textures?.[texture]?.texture) : null;
    default:
      return null;
  }
}

export function materialElementKey(scene, material) {
  return material ? keyOfMaterial(scene, material) : null;
}

/* Номер записи, которая станет «Корпусом», или −1. */
function bodyIndex(list, screens) {
  const lead = screens.indexOf(false);
  if (lead < 0 || list.length < 2) return -1;
  const nameless = itemElementWord(list[lead].texture, "") === PLAIN_WORD;
  return nameless || screens.includes(true) ? lead : -1;
}

/* Роль каждой записи списка: экран, «Корпус» или обычный лист. */
function rolesOf(list) {
  const screens = list.map((entry) => Boolean(entry.screen));
  const body = bodyIndex(list, screens);
  return screens.map((isScreen, at) => (isScreen ? "screen" : at === body ? "body" : "plain"));
}

export function namedElements(list) {
  const roles = rolesOf(list);
  const plain = itemElementNames(list.filter((_, at) => roles[at] === "plain"));
  const screenTotal = roles.reduce((count, role) => count + (role === "screen" ? 1 : 0), 0);
  const speakers = {
    body: () => tr(BODY_WORD),
    screen: (nth) => numbered(SCREEN_WORD, screenTotal > 1 ? nth + 1 : 0),
    plain: (nth) => numbered(plain[nth].word, plain[nth].index),
  };
  const used = { body: 0, screen: 0, plain: 0 };
  return list.map((entry, at) => {
    const role = roles[at];
    return { ...entry, label: speakers[role](used[role]++) };
  });
}

function screenKeysOf(scene) {
  const keys = new Set();
  for (const material of scene?.materials ?? []) {
    if (material?.group !== SCREEN_GROUP) continue;
    keys.add(materialElementKey(scene, material) || itemElementKey(material.name));
  }
  return keys;
}

function withoutLabel(entry) {
  const bare = { ...entry };
  delete bare.label;
  return bare;
}

/* Элементы вещей сцены: список листов считается один раз на номер. */
class ElementShelf {
  constructor(scene, { paintable, entityOf = sameKey }) {
    this.scene = scene;
    this.paintable = paintable;
    this.entityOf = entityOf;
    this.screenKeys = screenKeysOf(scene);
    this.lists = new Map();
    this.screenRules = [
      (entry) => this.screenKeys.has(entry.texture),
      (entry) => itemElementWord(entry.texture, entry.colour) === SCREEN_WORD,
    ];
  }

  flagged(entry) {
    return this.screenRules.some((rule) => rule(entry)) ? { ...entry, screen: true } : entry;
  }

  listOf(key) {
    if (!this.lists.has(key)) {
      const sheets = sceneItemElements(this.scene, this.entityOf(key));
      this.lists.set(key, sheets.map((entry) => this.flagged(withoutLabel(entry))));
    }
    return this.lists.get(key);
  }

  read(key) {
    const askable = Boolean(this.scene) && Number.isInteger(key);
    return askable && this.paintable(key) ? namedElements(this.listOf(key)) : [];
  }
}

export function createElementsOf(scene, options) {
  const shelf = new ElementShelf(scene, options);
  return (key) => shelf.read(key);
}

export function elementAtHit(scene, list, hit) {
  const unusable = !list || list.length < 2 || !Number.isInteger(hit?.material);
  if (unusable) return null;
  const sought = sceneMaterialElement(scene, hit.material);
  return list.some(({ texture }) => texture === sought) ? sought : null;
}

export function elementWhere(scene, texture) {
  return (material) => materialElementKey(scene, material) === texture;
}
