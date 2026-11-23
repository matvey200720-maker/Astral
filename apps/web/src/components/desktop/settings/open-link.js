// Мост читается напрямую, мимо desktopHost(), и заново при каждом вызове.
export function openLink(url) {
  const bridge = window.modovik;
  const openExternal = bridge?.openExternal;

  if (openExternal) {
    // Не функция, но «истинное» — Reflect.apply бросит TypeError, как и вызов метода.
    // Ответ не ждём; отказ главного процесса (ссылка не http/https) — это его ответ, не сбой окна.
    Promise.resolve(Reflect.apply(openExternal, bridge, [url])).catch(() => {});
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
