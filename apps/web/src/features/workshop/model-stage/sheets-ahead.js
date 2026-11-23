/*
 * Листы вперёд (15.11.2026, шаг 2 плана входа в сцену): сцена пришла из потока — состав листов уже известен (записи материалов и облик редактора, `sheet-wants.js`), и читатель получает их
 * сразу, пока кадр ещё строит геометрию и материалы, а не после `setScene` → `setLook`.
 *
 * Просьба идёт тем же `load(entry, size, форматы)`, что и у кадра (`orbit-stage.js: textureFor` → `loadSceneSheet`), поэтому ключ кэша окна тот же (картинка или блоки BCn — как решит
 * выключатель сжатых листов), и кадр потом берёт те же обещания: второй раз ничего не читается. Текстур и записей кадра просьба не заводит: закрыли редактор до прихода листов — в кэше окна
 * остаются лишь сами листы (тот же потолок, что у любого чтения), а освобождать на видеокарте нечего.
 *
 * Учёт: что просили заранее (`asked`), что из этого кадр потом попросил сам (`used`), что осталось лишним (`extra`), и сколько раз кадр просил лист другого размера того же источника
 * (`upgrade`: вторая волна ступеней у зон — сперва 512, потом ближе к камере). Счётчики идут в `count` (стенд читает их из `__astralCounts`).
 *
 * Чистый модуль без three и DOM: `load`, `keyOf` и `count` ему подают снаружи. `has` — лист уже заведён кадром; `answered` — лист кадра уже ответил (`hold` его не ждёт).
 */
import { sheetsAheadOf } from "./sheet-wants.js";

export function createSheetsAhead({ keyOf, load, has = () => false, answered = () => false, count = () => {}, enabled = () => true }) {
  /* ключ листа → попросил ли его кадр после того, как его просили заранее */
  const asked = new Map();
  /* источник листа (ключ без размера) → ключ, что кадр просил первым */
  const firstOf = new Map();
  return {
    /** Просит листы сцены у кэша окна; возвращает, сколько новых просьб ушло. `formats` — форматы видеокарты, как у кадра. */
    request(asset, look, formats = []) {
      /* Выключено (`enabled`, по умолчанию кадр просит только сам): ни просьб, ни счёта `stage.sheets.ahead`. */
      if (!enabled()) return 0;
      const wanted = sheetsAheadOf(asset, look, keyOf);
      let sent = 0;
      for (const { entry, size, key } of wanted) {
        if (asked.has(key) || has(key)) continue;
        asked.set(key, false);
        sent += 1;
        count("stage.sheets.ahead");
        let pending = null;
        try {
          pending = load(entry, size, formats);
        } catch {
          /* Загрузчик упал сразу: кадр спросит сам, как без раннего запроса. */
        }
        void Promise.resolve(pending).catch(() => {});
      }
      return sent;
    },
    /** Кадр просит лист `entry` под ключом `key` в первый раз. */
    note(entry, key) {
      if (asked.get(key) === false) {
        asked.set(key, true);
        count("stage.sheets.ahead.used");
      }
      const source = keyOf(entry, 0);
      const first = firstOf.get(source);
      if (first === undefined) firstOf.set(source, key);
      else if (first !== key) count("stage.sheets.upgrade");
    },
    /**
     * Держание прежнего кадра (`softLoad`, 16.11.2026): листы нового места просятся ДО подмены сцены и ждутся, пока читатель отвечает; пришедшие остаются «в руках» (`take`), и кадр
     * кладёт их на материалы сразу, при сборке новой сцены, — она встаёт целиком, а не в среднем цвете с листами на виду. От опыта `ahead` не зависит и его учёт (`asked`, `stage.sheets.ahead`) не трогает:
     * свои счётчики `stage.sheets.hold` (просьбы) и `stage.sheets.hold.cancel` (отменено, пока листы ещё ехали).
     * `pending()` — обещания листов, что ещё не ответили, и сигнал закрытия (пока они есть): ждёт их `sheets-ready.js: waitForSheetsQuiet`; пусто — все ответили или держание снято.
     * `take(key)` — `{ loaded }` (картинка, блоки или `null` — ответ «листа нет») один раз; не просили или уже взято — `undefined`. `release()` — отпустить всё: ответы не держатся, ожидание кончается.
     */
    hold(asset, look, formats = []) {
      const wanted = sheetsAheadOf(asset, look, keyOf);
      const answers = new Map();
      const open = new Set();
      let live = true;
      let close = () => {};
      const closed = new Promise((resolve) => {
        close = resolve;
      });
      for (const { entry, size, key } of wanted) {
        /* Лист уже у кадра и ответил (общий с прежним местом, или «листа нет» — кадр заново не просит): ждать нечего. */
        if (answered(key)) continue;
        let pending = null;
        try {
          pending = load(entry, size, formats);
        } catch {
          /* Загрузчик упал сразу: кадр спросит сам, как без держания. */
          continue;
        }
        count("stage.sheets.hold");
        const task = Promise.resolve(pending)
          .then(
            (loaded) => {
              if (live) answers.set(key, { loaded: loaded || null });
            },
            () => {},
          )
          .then(() => {
            open.delete(task);
          });
        open.add(task);
      }
      /* Сколько листов держание ждёт с самого начала (ответившие у кадра и уже стоящие в кэше окна — тоже ждут, но ответят в этом же такте). */
      const waiting = open.size;
      return {
        size: waiting,
        pending: () => (live && open.size ? [...open, closed] : []),
        take(key) {
          const answer = answers.get(key);
          if (!answer) return undefined;
          answers.delete(key);
          return answer;
        },
        get live() {
          return live;
        },
        release() {
          if (!live) return;
          live = false;
          if (open.size) count("stage.sheets.hold.cancel");
          answers.clear();
          open.clear();
          close();
        },
      };
    },
    stats() {
      let used = 0;
      for (const value of asked.values()) if (value) used += 1;
      return { asked: asked.size, used, extra: asked.size - used };
    },
    clear() {
      asked.clear();
      firstOf.clear();
    },
  };
}
