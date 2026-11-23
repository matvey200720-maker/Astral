/*
 * Играющая петля у плитки каталога (ТЗ владельца 10.11.2026): у мини-карты с играющими полосами или картинками плитка при наведении
 * оживает, а на странице карточки петля идёт сама. Вне наведения плитка — стоп-кадр: решение 28.10.2026 «в сетке только постер»
 * (замер: +204 % ядра в простое, окно 874 МБ против 212) остаётся — `<video>` рождается на наведении и умирает на уходе, один на всё окно.
 */

/** Задержка перед стартом: пробежавшая над плитками мышь ничего не запускает. */
export const HOVER_DELAY_MS = 220;

const addressOf = (item) => (item && typeof item === "object" ? item.src || item.url || "" : "");

/**
 * Петля мода: ролик с признаком `loop` из `mod.video` или `mod.videos` (мини-карты с играющими полосами и ролики эффектов части).
 * Без признака ролик — не петля: его плитка не оживляет.
 * @returns {{ src: string, poster: string } | null}
 */
export function loopOf(mod) {
  const candidates = [mod?.video, ...(Array.isArray(mod?.videos) ? mod.videos : [])];
  const found = candidates.find((item) => item && typeof item === "object" && item.loop === true && addressOf(item));
  return found ? { src: addressOf(found), poster: typeof found.poster === "string" ? found.poster : "" } : null;
}
