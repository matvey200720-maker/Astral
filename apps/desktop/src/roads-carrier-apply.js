/*
 * Повторное применение дорог в режиме носителя (`ASTRAL_ROADS_VIA_UPDATE=carrier`, `update2.rpf`) — ДВЕ транзакции подряд, а не одна замена:
 *   1) снятие прежней работы (`update.rpf` пишется первым, носитель последним — `carrier-order.js`);
 *   2) установка новой (носитель первым, `update.rpf` последним).
 * Замена одной транзакцией оставила бы на миг регистрацию без файла (новая работа сокращает набор контейнеров) либо отказала бы смешанным
 * случаем (`CARRIER_MIXED_REFUSAL`); такой отказ из окна всплывать не должен, поэтому до него дело не доходит: снимаемое уходит отдельно.
 *
 * Состояние при обрыве между записями: «дорог нет, игра рабочая» — первая запись уже закрыта (или откатана своим журналом), второй ещё нет;
 * дороги остаются снятыми, ошибка уходит окну как была, в журнале приложения — строка. Обрыв ВНУТРИ записи доводит `recoverTransactions`
 * при следующем запуске (оба файла байт в байт).
 */

const REMOVED = (label) => `${label} через update2.rpf: прежняя работа снята отдельной записью, ставлю новую.`;
const LEFT_BARE = (reason, label) =>
  `${label} через update2.rpf: прежняя работа снята, новая не встала (${reason}). В игре ${label === "Дороги" ? "дорог" : "растительности"} нет, игра рабочая: нажмите «Применить» ещё раз.`;

/**
 * `standing` — id прежних работ дорог, `uninstall(modId)` — снятие одной, `install(left)` — установка новой; `left` — что ещё надо заменить
 * установкой (id, не снятые отдельно). Возвращает то, что вернула установка.
 */
export async function applyRoadsViaCarrier({ standing = [], uninstall, install, note = (line) => console.warn(`[astral] ${line}`), label = "Дороги" }) {
  const removed = new Set();
  for (const modId of standing) {
    await uninstall(modId);
    removed.add(modId);
  }
  if (removed.size) note(REMOVED(label));
  try {
    return await install(removed);
  } catch (error) {
    if (removed.size) note(LEFT_BARE(String(error?.message || error).slice(0, 160), label));
    throw error;
  }
}
