/*
 * Слот трассера для объёмного кадра (задача 4А ТЗ 18.10.2026): выписка правил
 * игры → тот же след, что соберёт установка.
 *
 * Установка строит слот из штатного `bullet_tracer`: оставляет один эмиттер
 * (тот, чьи частицы рисуют текстуру слота — дым донора тоже рисует
 * `ptfx_bullet_tracer`, а у слота своя текстура), переводит кадры на сетку 1×1,
 * выставляет размер спрайта в метрах (`ApplyTracerShape`), красит кадры цвета
 * белым (`NeutraliseTracerColour`) и по заказу прячет след у камеры
 * (`HideTracerNearCamera`). Это же — здесь, над JSON выписки: окно играет то,
 * что поедет в игру, а не нарисованное похожее.
 *
 * Размер в пропорциональном режиме `ptxu_Size` — ширина = whd.x × (лево +
 * право), длина = whd.x × пропорция текстуры × (верх + низ): прямое значение
 * высоты («500») не используется (помощник сверил в живой игре). Поэтому
 * рантайму нужна пропорция текстуры (`aspectOf`): у слота 128×256 это 2.
 * Это числа помощника; в метрах игры они вдвое меньше (`TRACER_INSTALL_UNITS_PER_METRE`),
 * и здесь, как в проекте и в подписи «В игре ≈», размер — в метрах игры.
 *
 * Функции чистые: выписка не меняется, возвращается копия с правкой.
 */
import { TRACER_INSTALL_UNITS_PER_METRE } from "@modovik/tracer-contract";

/** Размер тела слота 128×256: высота / ширина. */
export const TRACER_SLOT_ASPECT = 2;

const clone = (value) => JSON.parse(JSON.stringify(value));

const sizeBehaviour = (particle) =>
  (particle?.AllBehaviours || []).find((behaviour) => behaviour?.Type === "Size") || null;

const maxOf = (frames, index) => Math.max(0, ...(frames || []).map((frame) => Number(frame?.[index]) || 0));

/**
 * Размер спрайта правила: `{ width, length }` в метрах игры — по выписке частицы
 * и пропорции текстуры (`ReadTracerShape` помощника: `whd · (край₁ + край₂)`),
 * поделённым на единицы установки (`TRACER_INSTALL_UNITS_PER_METRE`): игра
 * ставит края от половины размера, и спрайт у неё вдвое короче и уже, чем
 * считает помощник. `null` — у частицы нет размера.
 */
export function tracerParticleShape(particle, aspect = TRACER_SLOT_ASPECT) {
  const size = sizeBehaviour(particle);
  if (!size) return null;
  const whd = size.WhdMaxKFP?.Keyframes?.length ? size.WhdMaxKFP.Keyframes : size.WhdMinKFP?.Keyframes;
  const tblr = size.TblrScalarKFP?.Keyframes?.[0];
  if (!whd?.length || !tblr) return null;
  const widthBase = maxOf(whd, 1);
  const proportional = Number(size.IsProportional) !== 0;
  const lengthBase = proportional ? widthBase * aspect : maxOf(whd, 2);
  return {
    width: (widthBase * (tblr[3] + tblr[4])) / TRACER_INSTALL_UNITS_PER_METRE,
    length: (lengthBase * (tblr[1] + tblr[2])) / TRACER_INSTALL_UNITS_PER_METRE,
  };
}

/** Эмиттеры события `bullet_tracer`, чьи частицы рисуют след, а не дым. */
const isTracerEvent = (event, particleName) => String(event?.ParticleRule || "") === particleName;

/**
 * Слот из выписки.
 *
 * @param {object} exported — выписка (`exportRules`): `{ effects, emitters, particles, … }`
 * @param {object} options
 * @param {string} [options.effect] — правило-донор; `bullet_tracer`
 * @param {string} [options.particle] — частица, что рисует след
 * @param {number} [options.width] — ширина спрайта, м
 * @param {number} [options.length] — длина спрайта, м
 * @param {boolean} [options.neutralColour] — цвет целиком из текстуры
 * @param {{from:number,to:number}|null} [options.nearHide] — «свои без следа»
 * @param {number} [options.aspect] — пропорция текстуры слота
 * @returns {object} выписка со слотом под именем донора
 */
export function buildTracerSlot(
  exported,
  { effect = "bullet_tracer", particle = "bullet_tracer", width, length, neutralColour = true, nearHide = null, aspect = TRACER_SLOT_ASPECT } = {},
) {
  const donor = exported?.effects?.[effect];
  const rule = exported?.particles?.[particle];
  if (!donor || !rule) throw new Error(`В выписке нет донора слота трассера: ${effect}.`);
  const slotEffect = clone(donor);
  /* Один эмиттер на слот — тот, чьи частицы рисуют след. */
  slotEffect.EventEmitters = (slotEffect.EventEmitters || []).filter((event) => isTracerEvent(event, particle));
  if (!slotEffect.EventEmitters.length) throw new Error(`У донора ${effect} нет эмиттера следа ${particle}.`);
  const slotParticle = clone(rule);
  /* Кадр слота — нулевой его единственной текстуры. */
  slotParticle.TexFrameIDMin = 0;
  slotParticle.TexFrameIDMax = 0;
  slotParticle.LastFrameID = 0;

  const size = sizeBehaviour(slotParticle);
  const current = tracerParticleShape(slotParticle, aspect);
  if (size && current && current.width > 0 && current.length > 0) {
    const widthFactor = Number.isFinite(width) ? width / current.width : 1;
    const lengthFactor = Number.isFinite(length) ? length / current.length : 1;
    for (const frame of size.TblrScalarKFP?.Keyframes || []) {
      frame[1] *= lengthFactor;
      frame[2] *= lengthFactor;
      frame[3] *= widthFactor;
      frame[4] *= widthFactor;
    }
  }

  if (neutralColour)
    for (const behaviour of slotParticle.AllBehaviours || []) {
      if (behaviour?.Type !== "Colour") continue;
      for (const prop of [behaviour.RGBAMinKFP, behaviour.RGBAMaxKFP])
        for (const frame of prop?.Keyframes || []) {
          frame[1] = 1;
          frame[2] = 1;
          frame[3] = 1;
        }
    }

  const emitters = { ...exported.emitters };
  if (nearHide) {
    const from = Number(nearHide.from);
    const to = Number(nearHide.to);
    if (!(from >= 0.5 && from < to && to <= 100)) throw new Error("Дальность «вблизи следа нет»: от 0,5 до 100 м.");
    slotEffect.LodEvoDistanceMin = from;
    slotEffect.LodEvoDistanceMax = to;
    for (const event of slotEffect.EventEmitters) {
      /* Вблизи размер ноль, к `to` — полный: эволюция LOD держит сто процентов. */
      const name = event.EmitterRule;
      const emitter = clone(exported.emitters?.[name]);
      const prop = (emitter.KeyframeProps || []).find((item) => item?.Name === "ptxEmitterRule:m_sizeScalarKFP");
      if (prop) prop.Keyframes = [[0, 0, 0, 0, 100]];
      emitters[name] = emitter;
      for (const evolved of event.EvolutionList?.EvolvedKeyframeProps || [])
        if (evolved?.Name === "ptxEmitterRule:m_sizeScalarKFP")
          for (const item of evolved.Items || []) if (item?.IsLodEvolution) item.Keyframes = [[0, 100, 100, 100, 0]];
    }
  }

  return {
    ...exported,
    effects: { ...exported.effects, [effect]: slotEffect },
    emitters,
    particles: { ...exported.particles, [particle]: slotParticle },
  };
}
