/*
 * Слышно ли звук попадания в бою — мерка по записи звука самой игры.
 *
 * ЗАЧЕМ. Игра играет звук попадания на каждом попадании (запись 28.09.2026:
 * пистолет, автомат одиночными и очередью, дробовик, снайперка), но слышно
 * его не всегда: удар по телу звучит в эхо выстрела, у живых — ещё и в крик
 * боли, и шумный или короткий звук в нём тонет. Одиночный звук в студии
 * этого не показывает — там он звучит в тишине. Студия меряет звук так, как
 * он встанет в игру (дорожка и уровень части, `HIT_SOUND_LEVELS`), против
 * того, что игра играет вокруг него (`hit-masking-profile.js`), и честно
 * говорит «слышно» или «тонет» ещё до «Применить».
 *
 * КАК. Энергия звука и маскера — в полосах 1/3 октавы по кадрам 10 мс.
 * Звук слышен, если хоть в одной полосе он громче маскера на 6 дБ два кадра
 * подряд (20 мс) — порог, при котором короткий звук различим в шуме. На
 * записи игры мерка совпала с узнаванием звука: звук тела владельца (шумный
 * глухой удар) — «тонет» у пистолета во всех выстрелах и «слышно» у автомата
 * с заглушённым эхом (его звук ствола из студии), звонкие долгие — слышны.
 *
 * Модуль и для окна: без зависимостей, кроме FFT студии.
 */

import { fft } from "./analysis.js";
import { HIT_SOUND_LEVELS } from "./hit-sounds.js";
import { HIT_MASKING_PROFILE } from "./hit-masking-profile.js";

/* На сколько звук должен быть громче маскера в полосе и сколько кадров. */
export const HIT_AUDIBLE_MARGIN_DB = 6;
const AUDIBLE_FRAMES = 2;

/* Что проверяется для каждой части и как это назвать человеку. */
export const HIT_MASKING_CONTEXTS = Object.freeze({
  head: Object.freeze([
    Object.freeze({ id: "head:pistol", title: "эхо выстрела пистолета" }),
  ]),
  body: Object.freeze([
    Object.freeze({ id: "body:pistol", title: "эхо выстрела пистолета" }),
    Object.freeze({ id: "body:pain", title: "крик раненого" }),
  ]),
});

/* Линейный пересчёт частоты: для полосной энергии точнее не нужно. */
function toRate(samples, from, to) {
  if (!from || Math.abs(from - to) / to < 0.001) return samples;
  const length = Math.floor((samples.length * to) / from);
  const out = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const at = (index * from) / to;
    const left = Math.floor(at);
    const part = at - left;
    out[index] = (samples[left] || 0) * (1 - part) + (samples[left + 1] || 0) * part;
  }
  return out;
}

/* Энергия в полосах профиля по кадрам: то же окно, шаг и полосы, что у мерки. */
function bandFrames(samples, frames) {
  const { fft: size, hop, rate, bands } = HIT_MASKING_PROFILE;
  const window = new Float64Array(size);
  for (let index = 0; index < size; index += 1)
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (size - 1));
  const out = [];
  for (let frame = 0; frame < frames; frame += 1) {
    const re = new Float64Array(size);
    const im = new Float64Array(size);
    const start = frame * hop;
    for (let index = 0; index < size; index += 1)
      re[index] = (samples[start + index] || 0) * window[index];
    fft(re, im);
    out.push(
      bands.map(([low, high]) => {
        let energy = 0;
        const from = Math.floor((low * size) / rate);
        const to = Math.min(Math.ceil((high * size) / rate), size / 2 - 1);
        for (let bin = from; bin <= to; bin += 1)
          energy += re[bin] * re[bin] + im[bin] * im[bin];
        return 10 * Math.log10(energy + 1e-18);
      }),
    );
  }
  return out;
}

/**
 * Слышно ли звук части в бою.
 *
 * `samples` — звук ровно таким, каким он уйдёт в дорожку игры (моно, −1…1),
 * `sampleRate` — его частота. Звук меряется на уровне своей части: голова
 * на 6 дБ тише тела (`HIT_SOUND_LEVELS`).
 *
 * @returns {{heard: boolean, contexts: Array<{id: string, title: string,
 *   heard: boolean, margin: number}>}} `margin` — насколько лучшая полоса
 *   громче маскера, дБ (отрицательное — тише)
 */
export function hitCombatAudibility(samples, sampleRate, part) {
  const contexts = HIT_MASKING_CONTEXTS[part];
  if (!contexts) throw new Error(`Нет части попадания «${part}».`);
  const profile = HIT_MASKING_PROFILE;
  const sound = toRate(samples, sampleRate, profile.rate);
  const offset = (HIT_SOUND_LEVELS[part] - profile.calibratedLevel) / 100;
  const result = contexts.map(({ id, title }) => {
    const masker = profile.contexts[id].db;
    const frames = Math.min(masker.length, Math.max(1, Math.ceil(sound.length / profile.hop)));
    const levels = bandFrames(sound, frames);
    let margin = -Infinity;
    let run = 0;
    let heard = false;
    for (let frame = 0; frame < frames; frame += 1) {
      let best = -Infinity;
      for (let band = 0; band < masker[frame].length; band += 1)
        best = Math.max(best, levels[frame][band] + offset - masker[frame][band]);
      margin = Math.max(margin, best);
      run = best >= HIT_AUDIBLE_MARGIN_DB ? run + 1 : 0;
      if (run >= AUDIBLE_FRAMES) heard = true;
    }
    return { id, title, heard, margin: Math.round(margin) };
  });
  return { heard: result.every((item) => item.heard), contexts: result };
}
