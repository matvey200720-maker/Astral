// Отделка и тон материалов ствола: каждый объект-материал обрабатывается один раз за загрузку.
import { STUDIO_FINISHES, finishOf, finishShader, isNeutralMaterial } from "../../gun/lighting.js";

const KIND = "metal";

class MaterialDresser {
  #seen = new WeakSet();
  #finish = finishShader(STUDIO_FINISHES[KIND].iblDiffuse);
  #tone;

  constructor(tone) {
    this.#tone = tone;
  }

  // Материал как объект, список материалов детали или пустое место.
  *#materialsOf(node) {
    const held = node.material;
    yield* Array.isArray(held) ? held : [held];
  }

  #apply(material) {
    const finished = "roughness" in material && isNeutralMaterial(material);
    if (finished) Object.assign(material, finishOf(material, KIND));
    const programKey = [finished ? this.#finish.key : "own", this.#tone.key].join("|");
    const patches = finished ? [this.#finish, this.#tone] : [this.#tone];
    Object.assign(material, {
      onBeforeCompile: (shader) => patches.forEach((patcher) => patcher.patch(shader)),
      customProgramCacheKey: () => programKey,
    });
    material.needsUpdate = true;
  }

  visit(node) {
    if (!node.isMesh) return;
    for (const material of this.#materialsOf(node)) {
      if (!material || this.#seen.has(material)) continue;
      this.#seen.add(material);
      this.#apply(material);
    }
  }
}

export function dressModel(model, tone) {
  const dresser = new MaterialDresser(tone);
  model.traverse((node) => dresser.visit(node));
}
