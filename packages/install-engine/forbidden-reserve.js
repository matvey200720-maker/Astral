/*
 * Запас под запретные файлы другой работы (21.11.2026, слово лида 1; сухой план srv и девять полос по 1,5 ГиБ): файл, у которого есть одноимённый в более позднем штатном паке, чем КАЖДАЯ включённая полоса-пак
 * (старшинство, `carrier-seniority.js`), обязан лечь в update2.rpf или update.rpf — больше ему некуда. Если работа, что ставится первой (дороги или растительность), заберёт эти два носителя целиком, вторая работа
 * упадёт со всеми запретными файлами при пустых паках (девять полос: 28 файлов дорог, 85 МиБ, асфальт и грунт отказаны). Поэтому первая работа оставляет там место под запретные файлы второй — по описи
 * старшинства: сумма штатных размеров (`forbidden-sizes.js`) с запасом 3 % и 2 КиБ на файл, как цена файла в носителе. Вторая работа уже стоит — запас 0.
 * Модуль чистый; запас снимается с update2.rpf, потом с update.rpf (`carrier-budget.js`, `vegetation-carrier-route.js`).
 */
import { carrierSubjectToSeniority, seniorityAllows } from "./carrier-seniority.js";
import { FORBIDDEN_SIZES } from "./forbidden-sizes.js";

const isExact = (overlap) => Boolean(overlap) && typeof overlap.latest === "object" && Array.isArray(overlap.order);

/**
 * @param overlap  точная опись старшинства `{ order, latest }` (иначе запаса нет: без порядка подключения «во всех паках» не считается)
 * @param laneIds  включённые полосы-паки и подпакеты (`carrier-targets.js`); update2 и update в список не входят
 * @param include  какие имена относятся к ДРУГОЙ работе (дороги или растительность)
 * @param standing вторая работа уже стоит — запаса нет
 * @returns байты запаса
 */
export function forbiddenReserveBytes({ overlap = null, laneIds = [], include = () => true, standing = false } = {}) {
  if (standing || !isExact(overlap)) return 0;
  const packs = [...laneIds].filter((id) => carrierSubjectToSeniority(id));
  if (!packs.length) return 0;
  const allows = seniorityAllows(overlap);
  const names = Object.keys(FORBIDDEN_SIZES).filter((name) => include(name) && packs.every((id) => !allows(id, name)));
  if (!names.length) return 0;
  const bytes = names.reduce((sum, name) => sum + FORBIDDEN_SIZES[name], 0);
  return Math.ceil((bytes + names.length * 2048) * 1.03);
}

/** Снять запас с полос без запретов: сначала update2.rpf (первая в очереди), остаток с update.rpf; возвращает новые бюджеты `{ update2, update }` по их прежним значениям. */
export function takeReserve({ update2 = 0, update = 0 }, reserve) {
  const fromFirst = Math.min(Math.max(0, update2), Math.max(0, reserve));
  const rest = Math.max(0, reserve) - fromFirst;
  return { update2: Math.max(0, update2) - fromFirst, update: Math.max(0, update - Math.min(Math.max(0, update), rest)) };
}
