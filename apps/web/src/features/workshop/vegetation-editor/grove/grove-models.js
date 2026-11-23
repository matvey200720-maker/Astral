/*
 * Модели растений рощи — оглавление готового файла (`models.bin`, `scripts/prepare-vegetation-groves.mjs`).
 *
 * Файл — обычная сцена мастерской (`scene-asset.js`), где каждая модель лежит тремя частями —
 * по уровню детализации (`<модель>@0…2`), а сетки — в координатах самой модели (сущность карты
 * ставит их по месту). Здесь — разбор по именам: у модели группа (дерево или куст), размер и, по
 * уровням, какие сетки с какими материалами в нём лежат.
 */

/**
 * `Map` имя модели → `{ name, kind, height, radius, lods: [{ part, tris, meshes: [{ index, material }] }] }`.
 * `height` — высота модели, `radius` — как далеко крона уходит от оси (метры).
 */
export function indexGroveModels(asset) {
  const models = new Map();
  (asset?.parts || []).forEach((part, partIndex) => {
    if (!part?.model) return;
    let model = models.get(part.model);
    if (!model) {
      model = { name: part.model, kind: part.kind === "bush" ? "bush" : "tree", height: 0, radius: 0, lods: [] };
      models.set(part.model, model);
    }
    model.lods[part.lod] = { part: partIndex, tris: part.tris || 0, meshes: [] };
    if (part.lod === 0 && part.bounds) {
      const { min, max } = part.bounds;
      model.height = Math.max(0.5, max[2] - Math.min(0, min[2]));
      model.radius = Math.max(0.3, Math.hypot(Math.max(Math.abs(min[0]), Math.abs(max[0])), Math.max(Math.abs(min[1]), Math.abs(max[1]))));
    }
  });
  (asset?.meshes || []).forEach((mesh, index) => {
    const part = asset.parts[mesh.part];
    const lod = part?.model ? models.get(part.model)?.lods[part.lod] : null;
    lod?.meshes.push({ index, material: mesh.material });
  });
  /* Уровень, которого в файле нет, — ближайший из тех, что есть (у модели всегда есть нулевой). */
  for (const model of models.values())
    for (let lod = 0; lod < 3; lod += 1) if (!model.lods[lod]) model.lods[lod] = model.lods[lod - 1] || model.lods[0];
  return models;
}
