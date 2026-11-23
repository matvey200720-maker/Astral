const WHITE = 0xffffff;

// Карты, которые у светящейся своим цветом детали бывают общими: сама текстура
// (source) или её картинка (image). Общее «ничего» совпадением не считается.
const SHARED_KEYS = ["source", "image"];

const whiten = (colour) => {
  if (colour) colour.set(WHITE);
};

export function glowsWithColour(material) {
  const colour = material?.map;
  const glow = material?.emissiveMap;
  if (!colour || !glow) return false;
  if (colour === glow) return true;
  return SHARED_KEYS.some((key) => Boolean(colour[key]) && colour[key] === glow[key]);
}

export function restingEmissiveMap(material, paint) {
  return material?.userData?.astralColourGlow && paint ? paint : null;
}

// Запись идёт по шагам и без отката: порядок виден через подставной материал.
export function paintMaterial(material, texture) {
  material.map = texture;
  whiten(material.color);

  const userData = material.userData;
  if (userData?.astralColourGlow) material.emissiveMap = texture;

  const shapeBase = userData?.astralShapeBase;
  if (shapeBase) {
    shapeBase.map = texture;
    whiten(shapeBase.color);
  }

  material.needsUpdate = true;
}
