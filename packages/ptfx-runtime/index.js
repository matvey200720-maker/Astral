/*
 * Движок частиц RMPTFX для окна мастерской: модель правил из выгрузки
 * помощника, проигрывание эффекта по данным игры и сборка спрайтов под
 * камеру. Отрисовка (WebGL) живёт в окне — здесь ни одного обращения к DOM,
 * и всё считается в тестах Node.
 */

export { compileTrack, sampleTrack, sampleProperty, EVOLUTION_BLEND } from "./keyframes.js";
export { joaat, unitHash, seedOf, sequence } from "./random.js";
export { loadModel, compileProperty, shortPropertyName, behaviourOf } from "./model.js";
export { sampleDomain, sampleDomainLocal, DOMAIN_EXTENT } from "./domains.js";
export { effectFrame, toWorld, directionToWorld, rotationMatrix } from "./math.js";
export { EffectInstance, SEMANTICS } from "./simulation.js";
export {
  spriteBatches,
  modelBatches,
  trailBatches,
  shaderValue,
  ATTRIBUTE_SIZES,
  SHADER_DEFAULTS,
} from "./draw.js";
export { buildEffectClone, evolutionProblems, importedTextureName } from "./clone.js";
