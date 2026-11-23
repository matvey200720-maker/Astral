/*
 * Подписанный манифест мода («вид из каталога» у обвесов, ТЗ 23.10.2026) в память окна не кладётся: она живёт в
 * хранилище с пределом, а манифест нужен только на время установки. Помнится мод и версия.
 */
export const lookMemo = (looks) =>
  Object.fromEntries(
    Object.entries(looks || {}).map(([bone, look]) => [
      bone,
      { id: look?.manifest?.id || "", version: look?.manifest?.version || "" },
    ]),
  );
