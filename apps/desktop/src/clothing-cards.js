import * as fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import * as recipes from "@modovik/clothing/card-recipes";
import * as clothing from "@modovik/clothing/model";
import * as shots from "@modovik/clothing/shot-request";
import { inflateRawNode } from "@modovik/rpf7/node";
import { clothingArchiveTools, clothingGameRoot } from "./clothing-models.js";

const failure = (code, message) => Object.assign(new Error(message), { code });

// Часть, названная внутри чужой модели, карточки не даёт.
const borrowsForeignModel = (part) => Boolean(part.drawable || part.textureName);

export function clothingCardRecipe(slot) {
  const id = String(slot || "");
  for (const recipe of recipes.CARD_RECIPES) {
    if (recipe.id !== id) continue;
    return recipe.parts.some(borrowsForeignModel) ? null : recipe;
  }
  return null;
}

// Средства по умолчанию: имя -> как собрать. Модуль модели читается в момент вызова.
const inflating = () => ({ inflateRaw: inflateRawNode });
const DEFAULT_TOOLS = [
  ["drawable", (bytes) => clothing.clothingDrawable(bytes, inflating())],
  ["picture", (bytes) => clothing.colourPicture(bytes, inflating())],
  ["showcase", (...args) => clothing.showcaseDrawable(...args)],
  ["combine", (...args) => clothing.combinedDrawable(...args)],
  ["shot", (...args) => shots.shotRequestOf(...args)],
];

function defaultTools() {
  const made = {};
  for (const [name, tool] of DEFAULT_TOOLS) made[name] = tool;
  return made;
}

const bareArchive = (archive) => archive.replace(/\.rpf$/i, "");

async function cleanUp(dir) {
  await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
}

// Запрос снимка: одна часть идёт со своей расцветкой, несколько — сборкой без общей.
function snapshotOf({ resolved, recipe, slot }, parts) {
  if (parts.length === 1) {
    return resolved.shot(parts[0].drawable, { texture: parts[0].picture, category: slot, view: recipe.view });
  }
  const combined = resolved.combine(parts);
  return resolved.shot(combined, { texture: null, category: slot, view: recipe.view });
}

class Card {
  constructor(input, context) {
    this.slot = String(input?.slot || "");
    this.recipe = clothingCardRecipe(this.slot);
    if (!this.recipe) throw failure("CLOTHING_CARD", "Для этой категории карточки из игры нет.");
    this.context = context;
    this.gameRoot = null;
    this.resolved = null;
    this.work = null;
  }

  // Достаёт файл части из архива игры в рабочую папку и отдаёт путь файла.
  async fetch(part, file, extension) {
    const { resolved, context, gameRoot } = this;
    const output = path.join(this.work, part.name + extension);
    const entry = `${bareArchive(part.archive)}:/${part.folder}/${file}`;
    await resolved.read({ gameRoot, entry, output }, context);
    return output;
  }

  async assemble(part) {
    const { resolved } = this;
    const modelFile = await this.fetch(part, part.model, ".ydd");
    const found = resolved.drawable(await fsp.readFile(modelFile));
    if (!found?.meshes?.length) throw failure("CLOTHING_CARD_EMPTY", `В модели ${part.model} нет вещи.`);
    const textureFile = await this.fetch(part, part.texture, ".ytd");
    const shown = resolved.showcase(found, part.component, { slot: this.slot });
    const textureBytes = await fsp.readFile(textureFile);
    return { name: part.name, drawable: shown, picture: resolved.picture(textureBytes) };
  }

  async run() {
    const parts = [];
    for (const part of this.recipe.parts) parts.push(await this.assemble(part));
    return { slot: this.slot, version: recipes.CARD_VERSION, shot: snapshotOf(this, parts) };
  }
}

export async function readClothingCard(input, context, stateDir, tools = {}) {
  const card = new Card(input, context);
  card.gameRoot = clothingGameRoot(input);
  card.resolved = { ...clothingArchiveTools(stateDir), ...defaultTools(), ...tools };
  card.work = path.join(stateDir, "clothing-cards", "work", randomUUID());
  try {
    await fsp.mkdir(card.work, { recursive: true });
    return await card.run();
  } finally {
    await cleanUp(card.work);
  }
}
