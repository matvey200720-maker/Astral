import {
  createRenderer,
  createSurface,
  displayList,
  encodePng,
  readGfx,
  readSprite,
  surfaceToRgba,
} from "@modovik/gfx";
import { decodeTextureRef, joaat, readTextureDictionary } from "@modovik/rage-drawable";

// Страница «Оружие» меню паузы: сначала update.rpf (там новые стволы), потом базовый x64b.rpf.
export const WEAPON_ICON_SOURCES = Object.freeze([
  Object.freeze({
    archive: "update/update.rpf",
    gfx: "x64/data/cdimages/scaleform_generic.rpf/pause_menu_pages_weapons.gfx",
    ytd: "x64/data/cdimages/scaleform_generic.rpf/pause_menu_pages_weapons.ytd",
  }),
  Object.freeze({
    archive: "x64b.rpf",
    gfx: "data/cdimages/scaleform_generic.rpf/pause_menu_pages_weapons.gfx",
    ytd: "data/cdimages/scaleform_generic.rpf/pause_menu_pages_weapons.ytd",
  }),
]);

export const ICON_SCALE = 2;

// Полотно, на котором рисуется один ствол: размер, центр, отступ вокруг рисунка,
// порог «заметной» прозрачности и потолок размера текстуры.
const CANVAS = Object.freeze({
  width: 1400,
  height: 700,
  centreX: 700,
  centreY: 350,
  margin: 4,
  visibleAbove: 8,
  maxTexture: 4096,
});
const SPRITE_TAG = 39;
const WEAPON_INSTANCE = "weaponMC";

export function weaponHash(id) {
  return joaat(String(id).toLowerCase()) | 0;
}

// Метка держателя «INT» + знаковое целое: число меток или null для любой другой.
function labelNumber(label) {
  if (!label.startsWith("INT")) return null;
  const signed = label.slice(3);
  const digits = signed.startsWith("-") ? signed.slice(1) : signed;
  const plain = digits.length > 0 && [...digits].every((char) => char >= "0" && char <= "9");
  return plain ? Number(signed) : null;
}

function* spriteIds(gfx) {
  for (const [id, tag] of gfx.definitions) {
    if (tag.code === SPRITE_TAG) yield id;
  }
}

// Держатель — спрайт с наибольшим числом меток; при равенстве первый в оглавлении.
function findHolder(gfx) {
  const best = [...spriteIds(gfx)]
    .map((id) => ({
      id,
      marks: [...readSprite(gfx, id).labels.keys()].filter((label) => labelNumber(label) !== null).length,
    }))
    .reduce((leader, candidate) => (candidate.marks > leader.marks ? candidate : leader), {
      id: null,
      marks: 0,
    });
  return best.id;
}

function* holderEntries(gfx, holder) {
  for (const [label, frame] of readSprite(gfx, holder).labels) {
    const number = labelNumber(label);
    if (number === null) continue;
    const weapon = displayList(gfx, holder, frame).find((item) => item.name === WEAPON_INSTANCE);
    if (weapon) {
      yield [number, { frame, character: weapon.characterId, matrix: weapon.matrix ?? null }];
    }
  }
}

export function weaponIconIndex(gfx) {
  const holder = findHolder(gfx);
  const index = new Map(holder === null ? [] : holderEntries(gfx, holder));
  return { holder, index };
}

// Где рисовать ствол: запись указателя по метке, иначе экспортный спрайт W<хэш>.
function locateWeapon(film, index, id) {
  const hash = weaponHash(id);
  const marked = index.get(hash);
  if (marked) return marked;
  const exported = film.exports.get("W" + hash);
  return exported === undefined ? null : { frame: 0, character: exported, matrix: null };
}

function pageTransform(matrix, scale) {
  const [a, b, c, d] = matrix ? [matrix.a, matrix.b, matrix.c, matrix.d] : [1, 0, 0, 1];
  return {
    a: scale * a,
    b: scale * b,
    c: scale * c,
    d: scale * d,
    tx: CANVAS.centreX,
    ty: CANVAS.centreY,
  };
}

const offsetOf = (x, y) => (y * CANVAS.width + x) * 4;

// Рамка заметных точек: первая и последняя непустые строки и столбцы, с отступом, не шире полотна.
function inkBox(rgba) {
  const { width, height, margin, visibleAbove } = CANVAS;
  const rowInked = (y) => {
    for (let x = 0; x < width; x += 1) if (rgba[offsetOf(x, y) + 3] > visibleAbove) return true;
    return false;
  };
  const columnInked = (x) => {
    for (let y = 0; y < height; y += 1) if (rgba[offsetOf(x, y) + 3] > visibleAbove) return true;
    return false;
  };
  const edge = (count, occupied, fromEnd) => {
    for (let step = 0; step < count; step += 1) {
      const at = fromEnd ? count - 1 - step : step;
      if (occupied(at)) return at;
    }
    return -1;
  };

  const top = edge(height, rowInked, false);
  if (top < 0) return null;
  return {
    left: Math.max(0, edge(width, columnInked, false) - margin),
    top: Math.max(0, top - margin),
    right: Math.min(width - 1, edge(width, columnInked, true) + margin),
    bottom: Math.min(height - 1, edge(height, rowInked, true) + margin),
  };
}

function cropRgba(rgba, box) {
  const rowBytes = (box.right - box.left + 1) * 4;
  const rows = [];
  for (let y = box.top; y <= box.bottom; y += 1) {
    rows.push(rgba.subarray(offsetOf(box.left, y), offsetOf(box.left, y) + rowBytes));
  }
  const pixels = rows.reduce((out, row, place) => {
    out.set(row, place * rowBytes);
    return out;
  }, new Uint8Array(rows.length * rowBytes));
  return { pixels, width: rowBytes / 4, height: rows.length };
}

// Сеанс отрисовки одной страницы: указатель, отрисовщик и общий кэш раскодированных текстур.
function openSession(film, textures, scale) {
  const { index } = weaponIconIndex(film);

  const texturesByName = new Map();
  for (const texture of textures) {
    const key = String(texture.name ?? "").toLowerCase();
    if (!texturesByName.has(key)) texturesByName.set(key, texture);
  }
  const decoded = new Map();
  const imageFor = (external) => {
    const key = String(external.exportName ?? "").toLowerCase();
    if (!decoded.has(key)) {
      const texture = texturesByName.get(key);
      const picture = texture && decodeTextureRef(texture, { maxSize: CANVAS.maxTexture });
      decoded.set(
        key,
        picture ? { width: picture.width, height: picture.height, rgba: picture.rgba } : null,
      );
    }
    return decoded.get(key);
  };
  const renderer = createRenderer(film, { images: imageFor });

  return {
    // Иконка ствола или null, если нарисовать нечего.
    paint(id) {
      const spot = locateWeapon(film, index, id);
      if (!spot) return null;
      const surface = createSurface(CANVAS.width, CANVAS.height);
      renderer.renderFrame({
        sprite: spot.character,
        frame: 0,
        width: CANVAS.width,
        height: CANVAS.height,
        transform: pageTransform(spot.matrix, scale),
        surface,
      });
      const rgba = surfaceToRgba(surface, null);
      const box = inkBox(rgba);
      if (!box) return null;
      const { pixels, width, height } = cropRgba(rgba, box);
      return { png: encodePng(pixels, width, height, 4), width, height };
    },
    notes: () => [...renderer.diagnostics],
  };
}

function* attempts(session, ids) {
  for (const id of ids) yield [id, session.paint(id)];
}

export function renderWeaponIcons({ gfx, ytd, ids, inflateRaw, scale = ICON_SCALE }) {
  const film = readGfx(gfx);
  const textures = readTextureDictionary(ytd, { inflateRaw });
  const session = openSession(film, textures, scale);

  const outcomes = [...attempts(session, ids)];
  return {
    icons: new Map(outcomes.filter(([, icon]) => icon !== null)),
    missing: outcomes.filter(([, icon]) => icon === null).map(([id]) => id),
    diagnostics: session.notes(),
  };
}
