/*
 * Клоны эффектов попаданий — то, что играют сцены попаданий окна мастерской.
 *
 * Не правило донора, а клон, который соберёт установка: рецепт слоя
 * (`impactCloneRecipe` — одна функция для окна и установщика) → клон
 * (`buildEffectClone`, перенос `YptEffectClones.cs`, сверенный с ним
 * `scripts/probe-effect-clones.mjs`) → модель движка RMPTFX
 * (`@modovik/ptfx-runtime`). Здесь — сборка и поиск листов по имени текстуры;
 * где и когда клон играет, решает сцена: плоская сцена обложек
 * (`impact-scene.js`) или 3D-сцена боя (`features/workshop/combat-stage`).
 */

import { buildEffectClone, loadModel } from "@modovik/ptfx-runtime";
import {
  ASTRAL_BLOOD_SPRAY_TEXTURE,
  BLOOD_SHEET_GRID,
  BLOOD_SPRAY_TEXTURE,
  impactCloneRecipe,
  placementLayers,
} from "@modovik/ptfx-studio";

/* Сторона раны: клон входа и клон выхода — у каждой зоны свои. */
export const PLACEMENTS = Object.freeze(["front", "back"]);

export const cloneName = (zoneId, placement) => `astral_preview_${zoneId}_${placement}`;
const pictureName = (zoneId, index) => `astral_preview_pic_${zoneId}_${index}`;
const sheetName = (zoneId, index) => `astral_preview_sheet_${zoneId}_${index}`;

/** Сколько камера отстоит от эффекта → ступень LOD правила (0…1), как в игре. */
export function lodValue(rule, distance) {
  const { min, max } = rule.lod;
  if (!(max > min)) return 0;
  return Math.min(Math.max((distance - min) / (max - min), 0), 1);
}

/**
 * Клоны зон. `bank` — банк листов (`createTextureBank`), `sprites(zoneId,
 * settings)` — картинки слоёв зоны для текстур клона: `{ [index]: canvas }` и
 * `{ ["sheet:" + index]: { canvas, columns, rows } }` для своих листов брызг.
 */
export function createImpactClones({ bank, sprites = () => ({}) }) {
  let base = null;
  let model = null;
  let textureNames = new Map();
  let failures = [];
  let playlist = [];
  let zones = {};

  /** Сетки моделей частиц из всех выгрузок базы (ядро и чужие словари). */
  function meshes() {
    const merged = {};
    for (const exported of Object.values(base?.impact?.model || {})) Object.assign(merged, exported?.meshes || {});
    return merged;
  }

  /*
   * Клоны всех играющих зон — как их соберёт установщик. Ошибка сборки
   * (донора нет в ядре игрока, слой заказал невозможное) не роняет сцену:
   * зона молчит, а причина уходит в подпись.
   */
  function rebuild() {
    failures = [];
    textureNames = new Map();
    const exported = base?.impact?.model;
    if (!exported?.core) {
      model = null;
      return;
    }
    const clones = [];
    const coreTextures = base?.core?.textures || [];
    for (const zoneId of playlist) {
      const settings = zones[zoneId];
      if (!settings?.enabled) continue;
      const art = sprites(zoneId, settings) || {};
      for (const placement of PLACEMENTS) {
        const own = placementLayers(settings, placement);
        if (!own.length) continue;
        const textures = {};
        for (const { layer, index } of own) {
          if (layer.kind === "custom" && art[index]) {
            textures[index] = pictureName(zoneId, index);
            textureNames.set(textures[index], { canvas: art[index], grid: { columns: 1, rows: 1 } });
          }
          if (layer.kind === "blood" && art[`sheet:${index}`]) {
            const sheet = art[`sheet:${index}`];
            textures[index] = sheetName(zoneId, index);
            textureNames.set(textures[index], {
              canvas: sheet.canvas,
              grid: { columns: sheet.columns || BLOOD_SHEET_GRID.columns, rows: sheet.rows || BLOOD_SHEET_GRID.rows },
            });
          }
        }
        try {
          const recipe = impactCloneRecipe(zoneId, settings, {
            rule: cloneName(zoneId, placement),
            textures,
            placement,
            rules: base?.impact?.rules || null,
          });
          if (!recipe) continue;
          const clone = buildEffectClone(exported, recipe, { coreTextures });
          for (const item of clone.importedTextures) textureNames.set(item.texture, { source: item.source });
          clones.push(clone);
        } catch (error) {
          failures.push(String(error?.message || error));
        }
      }
    }
    /* Идущий выстрел доигрывает прежним клоном: ползунок тянут непрерывно,
       и перезапуск на каждый его шаг читался бы как мигание. Следующий
       выстрел — уже новым. */
    model = loadModel(...Object.values(exported), ...clones);
  }

  /** База эффектов из игры игрока (`readPtfxBase`) или `null`. */
  function setBase(next) {
    base = next || null;
    bank.provideSheets(base?.impact?.sheets || null);
    rebuild();
  }

  /** Зоны редактора и какие из них играют сейчас; `true`, если очередь другая. */
  function setZones(nextZones, nextPlaylist) {
    zones = nextZones || {};
    const key = (nextPlaylist || []).join(",");
    const changed = key !== playlist.join(",");
    if (changed) playlist = [...(nextPlaylist || [])];
    rebuild();
    return changed;
  }

  /** Лист по имени текстуры клона. */
  function lookup(name) {
    if (!name) return null;
    const lower = String(name).toLowerCase();
    if (lower === ASTRAL_BLOOD_SPRAY_TEXTURE) return bank.game(BLOOD_SPRAY_TEXTURE, { neutral: true });
    const own = textureNames.get(lower) || textureNames.get(name);
    if (own?.canvas) return bank.canvas(lower, own.canvas, own.grid);
    if (own?.source) return bank.game(own.source);
    return bank.game(lower);
  }

  return {
    setBase,
    setZones,
    lookup,
    meshes,
    get base() {
      return base;
    },
    get model() {
      return model;
    },
    get failures() {
      return failures;
    },
    get playlist() {
      return playlist;
    },
  };
}
