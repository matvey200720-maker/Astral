/*
 * Буфер обмена — одним местом.
 *
 * Код работы, код сборки, модификатор килл-эффекта: всё, что человек несёт
 * другу, уходит через буфер. Браузер может в нём отказать — окно без фокуса,
 * отклонённый запрос, `file://` оболочка, — и отказ не должен превращаться в
 * мёртвую кнопку: копирование пробует запасной путь через невидимое поле, а
 * чтение молча отдаёт пустую строку, и тогда человек вставляет сам.
 */

/*
 * Главный процесс Astral Desktop кладёт текст в буфер сам (`window.modovik.copyText` → `clipboard.writeText`): ему не нужны ни фокус окна, ни разрешение
 * страницы, ни жест. Страница, у которой Chromium отказал (`NotAllowedError`: «Document is not focused» — окно без фокуса, запрос без жеста), этим путём всё равно
 * копирует. Нет моста (браузер, песочница, тесты) — путь страницы, как прежде.
 */
async function copyViaDesktop(text) {
  try {
    const copy = typeof window === "undefined" ? null : window.modovik?.copyText;
    return typeof copy === "function" && (await copy(text)) === true;
  } catch {
    return false;
  }
}

/** Положить текст в буфер. `true`, если получилось хоть одним способом. */
export async function copyText(value) {
  const text = String(value ?? "");
  if (await copyViaDesktop(text)) return true;
  try {
    if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (typeof document === "undefined") return false;
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    field.style.pointerEvents = "none";
    document.body.appendChild(field);
    const focused = document.activeElement;
    field.select();
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }
    field.remove();
    if (focused instanceof HTMLElement) focused.focus();
    return copied;
  }
}

/** Текст из буфера или пустая строка, если браузер его не отдал. */
export async function readClipboardText() {
  try {
    return (await navigator.clipboard?.readText?.()) || "";
  } catch {
    return "";
  }
}
