/*
 * Постановка «следов урона на экране» в 3D-сцене (задача 4А, 18.10.2026):
 * откуда стреляют, когда и какими метками это ложится на экран. Чистые
 * функции — проверяются тестами.
 *
 * Игра ставит след у края экрана со стороны выстрела по игроку, и три
 * попадания старого кадра — это три стрелка вокруг игрока: слева, справа
 * позади и впереди чуть правее. Углы и сдвиги во времени те же
 * (`SCREEN_HITS_SHOTS`), только теперь у каждого угла стоит человек с
 * оружием, и метка встаёт в тот миг, когда его пуля долетела.
 */

import { SCREEN_HITS_SHOTS } from "../screen-hits-editor/screen-hits-painter.js";
import { bearingPosition } from "./combat-layout.js";

/* Куда смотрит камера игры: вдоль −Y, как стоит игрок в раскладке боя. */
export const HIT_HEADING = Object.freeze([0, -1, 0]);
/* Расстояние от игрока до стрелков, м. */
export const HIT_RADIUS = 12;
/* Пуля долетает за несколько миллисекунд: метка встаёт чуть позже вспышки. */
export const HIT_FLIGHT = 0.012;

/** Стрелки по кругу: угол следа, сдвиг выстрела в доле круга и место в мире. */
export function hitShooters(centre = [0, 0, 0]) {
  return SCREEN_HITS_SHOTS.map((shot, index) => ({
    index,
    angle: shot.angle,
    delay: shot.delay,
    position: bearingPosition(shot.angle, HIT_RADIUS, centre, HIT_HEADING),
  }));
}

/**
 * Выстрелы, что наступили за шаг от `previous` до `now` (секунды сцены): стрелок
 * `i` стреляет раз в круг, через `delays[i] × loop` после его начала. Шаг назад
 * (перемотка, смена круга) ничего не отдаёт.
 *
 * @param {number} previous
 * @param {number} now
 * @param {number} loop — длина круга, секунды
 * @param {number[]} delays — сдвиги стрелков в долях круга
 * @returns {Array<{ index: number, at: number }>} выстрелы по возрастанию времени
 */
export function loopEvents(previous, now, loop, delays) {
  const events = [];
  if (!(loop > 0) || !(now > previous)) return events;
  const first = Math.floor(previous / loop);
  const last = Math.floor(now / loop);
  for (let round = first; round <= last; round += 1)
    delays.forEach((delay, index) => {
      const at = round * loop + delay * loop;
      if (at > previous && at <= now) events.push({ index, at });
    });
  return events.sort((left, right) => left.at - right.at);
}

/**
 * Метки на экране в момент `now`: каждое попадание живёт `spanMs` — нарастание,
 * удержание и спад следа, — после чего уходит из списка.
 *
 * @param {Array<{ angle: number, at: number }>} hits — попадания, `at` в секундах сцены
 * @param {number} now
 * @param {number} spanMs
 * @returns {{ marks: Array<{ angle: number, elapsedMs: number }>, hits: Array }} живые метки и список без остывших
 */
export function liveMarks(hits, now, spanMs) {
  const alive = hits.filter((hit) => (now - hit.at) * 1000 < spanMs + 40);
  const marks = alive
    .map((hit) => ({ angle: hit.angle, elapsedMs: (now - hit.at) * 1000 }))
    .filter((mark) => mark.elapsedMs >= 0);
  return { marks, hits: alive };
}
