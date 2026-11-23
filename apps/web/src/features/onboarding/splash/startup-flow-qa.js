/*
 * Заставка «Контур» в песочнице: флаги адреса (15.11.2026). Только разработка — в продуктовую сборку этот файл не попадает
 * (`startup-flow.js` зовёт его под `import.meta.env.DEV`).
 *
 * Песочница без входа загружается за доли секунды, а у заставки свой минимум (около четырёх секунд): мешала бы каждому экрану.
 * Поэтому там её нет, пока в адресе не стоит `?qa-splash=<мс>` (четыре этапа ровно за столько миллисекунд) или
 * `?qa-splash=a,b,c,d` (когда закрывается каждый). Дальше: `?qa-splash-fail=<мс>` — запуск «не удался» в этот миг,
 * `?qa-splash-wake=1` — экран пробуждения после сна, `?qa-splash-at=<мс>` — один кадр на этот миг заставки (как `?T=` у макета),
 * `?qa-splash-next=home|login` — куда она уходит, `?qa-splash-calm=1` — спокойная версия.
 */

const COUNT = 4;
/** `?qa-splash-wake`: окно «открывается» не раньше этого мига (конец страницы сна в макете). */
export const WAKE_QA_MS = 1900;

/** Расписание из `?qa-splash`: одно число — четыре этапа поровну, список из четырёх — по этапам; иначе `null`. */
export function qaSchedule(value) {
  if (!value) return null;
  const list = String(value)
    .split(",")
    .map(Number)
    .filter((n) => Number.isFinite(n) && n >= 0);
  if (list.length === 1)
    return Array.from({ length: COUNT }, (_, i) => (list[0] * (i + 1)) / COUNT);
  return list.length === COUNT ? list : null;
}

export function qaPlan(params, clock) {
  const schedule = qaSchedule(params.get("qa-splash"));
  const wake = params.has("qa-splash-wake");
  const failAt = Number(params.get("qa-splash-fail"));
  const frozen = params.has("qa-splash-at")
    ? Number(params.get("qa-splash-at"))
    : NaN;
  const t0 = clock();
  const since = () => clock() - t0;
  const lastAt = schedule ? Math.max(...schedule) : 0;
  return {
    enabled: params.has("qa-splash") || wake,
    wake,
    frozenAt: Number.isFinite(frozen) ? frozen : null,
    /** Этап `index` по расписанию уже можно закрывать. */
    open: (index) => !schedule || since() >= schedule[index],
    /** Окно по расписанию уже можно открывать. */
    ready: () =>
      schedule ? since() >= lastAt : !wake || since() >= WAKE_QA_MS,
    failed: () => failAt > 0 && since() >= failAt,
    // кадр на заданный миг: то же самое без часов
    closedAt(ms) {
      let count = 0;
      while (schedule && count < COUNT && schedule[count] <= ms) count += 1;
      return count;
    },
    readyAt: (ms) => Boolean(schedule) && ms >= lastAt,
    failedAt: (ms) => failAt > 0 && ms >= failAt,
  };
}
