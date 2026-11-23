import * as gameDonor from "./game-donor.js";
import { rustEmblemPlatesEnabled } from "./native-engine-rust.js";

const EMBLEM_COMMAND = "compile-emblem-plates";
const EMBLEM_PREFIX = "emblem-donor";

export const EMBLEM_DONOR = gameDonor.HW1_DONOR;
export const EMBLEM_DONOR_REFUSAL = gameDonor.donorRefusals(EMBLEM_PREFIX);

// Своё у модуля только выключатель, приставка кодов и папка кэша; донор можно подменить.
// Функции обычные: возвращают результат соседа как есть, синхронный сбой остаётся синхронным.
export function emblemDonor(options = {}) {
  const { donor: given, ...rest } = options;
  const own = { enabled: rustEmblemPlatesEnabled, prefix: EMBLEM_PREFIX, cacheDir: EMBLEM_PREFIX };
  own.donor = given === undefined ? EMBLEM_DONOR : given;
  return gameDonor.findGameDonor(Object.assign(rest, own));
}

export function compileWithEmblemDonor(command, input, deps = {}) {
  const routes = Object.fromEntries([[EMBLEM_COMMAND, gameDonor.GAME_DONOR_ROUTES[EMBLEM_COMMAND]]]);
  return gameDonor.compileWithGameDonor(command, input, Object.assign({}, deps, { routes }));
}
