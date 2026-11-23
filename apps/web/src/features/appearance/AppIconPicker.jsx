import { useEffect, useMemo, useRef, useState } from "react";
import {
  APP_ICONS,
  CUSTOM_APP_ICON,
  DEFAULT_APP_ICON,
  appIconDataUri,
  appIconId,
  appIconLookOf,
  normalizeAppIconLook,
} from "@modovik/contracts/app-icon";
import ColorSwatches from "../../components/ui/ColorSwatches.jsx";
import SegmentedControl from "../../components/ui/SegmentedControl.jsx";
import Switch from "../../components/ui/Switch.jsx";
import { desktopHost } from "../../api.js";
import { tr, useTr } from "../../locales/ui.js";

/*
 * «Значок приложения» в «Внешнем виде» (ТЗ владельца 29.10.2026, п. 7 и 29.10-c): кастомизация знака — цвет звезды (наша палитра
 * и свой цвет), плашка (тёмная, один цвет, градиент из двух) и «Без фона» (прозрачный значок, звезда крупнее). Ряда «Готовые
 * раскраски» нет (владелец, 30.10.2026): те же семь цветов стоят в «Цвете звезды», а превью сверху показывает, что получится. Сверху — живое превью, то же изображение, что получат окно и ярлыки: один SVG
 * (`@modovik/contracts/app-icon`) рисует и превью, и файлы в приложении.
 *
 * Значок меняется только на этом ПК — окно, панель задач и ярлыки (`apps/desktop/src/app-icon.js`), права администратора
 * не нужны; «Сбросить» возвращает штатный. В браузере без приложения (песочница, сайт) блока нет: менять там нечего.
 *
 * Правки цвета идут потоком, а файлы значка рисуются в приложении, поэтому окно держит свой черновик (превью меняется
 * сразу), а в приложение шлёт выбор, когда правка улеглась (`COMMIT_DELAY`), и по очереди: быстрые щелчки не рисуют
 * картинки наперегонки. «Сбросить» и выбор фона уходят сразу, окно закрылось раньше срока — правка не теряется.
 */

const COMMIT_DELAY = 280;

const COLOUR_NAMES = {
  "#ffffff": () => tr("Белый"),
  "#dccaa5": () => tr("Песочный"),
  "#e8b48f": () => tr("Персиковый"),
  "#e6a9c2": () => tr("Розовый"),
  "#b9a9ec": () => tr("Лавандовый"),
  "#9fc0ea": () => tr("Небесный"),
  "#a9cba1": () => tr("Зелёный"),
  "#02030b": () => tr("Чёрный"),
  "#171b31": () => tr("Ночной"),
  "#26304f": () => tr("Сумеречный"),
};
const colourName = (hex) => COLOUR_NAMES[hex]?.() || hex.toUpperCase();

/* Цвета звезды — цвета акцентов интерфейса; цвета плашки — они же и три тёмных тона штатной плашки. */
const STAR_COLOURS = APP_ICONS.map((icon) => icon.hex);
const BACK_COLOURS = ["#02030b", "#171b31", "#26304f", ...STAR_COLOURS];

function useAppIcon() {
  const host = desktopHost();
  const available = typeof host?.setAppIcon === "function" && typeof host?.getAppIcon === "function";
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!available) return undefined;
    let live = true;
    host
      .getAppIcon()
      .then((next) => live && setState(next))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [available, host]);
  return {
    available,
    state,
    /* Готовая раскраска уходит id, своя — настройками; приложение отвечает тем, что стоит теперь. */
    send: async (look) => {
      const next = await host.setAppIcon(appIconId(look) === CUSTOM_APP_ICON ? look : appIconId(look));
      setState(next);
      return next;
    },
  };
}

export default function AppIconPicker({ resetLabel = "", onSaved = null }) {
  useTr();
  const { available, state, send } = useAppIcon();
  const [draft, setDraft] = useState(() => appIconLookOf(DEFAULT_APP_ICON));
  const [note, setNote] = useState("");
  /* Что сейчас записано в приложении: к этому возвращает «Отменить» и отказ приложения. */
  const saved = useRef(draft);
  const timer = useRef(0);
  const waiting = useRef(null);
  const queue = useRef(Promise.resolve());
  const loaded = useRef(false);
  const edited = useRef(false);
  const latest = useRef({ send, onSaved });
  latest.current = { send, onSaved };
  const preview = useMemo(() => appIconDataUri(draft), [draft]);

  /* Приложение ответило, что стоит сейчас, — черновик становится им, если человек не успел ничего поправить: щелчок раньше ответа не затирается. */
  useEffect(() => {
    if (!state || loaded.current) return;
    loaded.current = true;
    if (edited.current) return;
    const stored = normalizeAppIconLook(state.look ?? state.id);
    saved.current = stored;
    setDraft(stored);
  }, [state]);

  const commit = (look) => {
    window.clearTimeout(timer.current);
    waiting.current = null;
    queue.current = queue.current.then(async () => {
      const before = saved.current;
      try {
        const result = await latest.current.send(look);
        saved.current = look;
        setNote(result?.failed?.length ? tr("Часть ярлыков не удалось обновить") : "");
        latest.current.onSaved?.(() => {
          saved.current = before;
          setDraft(before);
          void latest.current.send(before).catch(() => {});
        });
      } catch {
        setNote(tr("Не получилось сменить значок"));
        setDraft(saved.current);
      }
    });
  };

  /* Окно закрыли, пока правка ждала своей очереди, — она всё равно уходит в приложение. */
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      if (waiting.current) void latest.current.send(waiting.current).catch(() => {});
    },
    [],
  );

  if (!available) return null;

  const look = draft;
  const id = appIconId(look);
  const edit = (patch, { now = false } = {}) => {
    const next = normalizeAppIconLook({ ...look, ...patch });
    if (JSON.stringify(next) === JSON.stringify(look)) return;
    edited.current = true;
    setDraft(next);
    if (now) {
      commit(next);
      return;
    }
    waiting.current = next;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => commit(next), COMMIT_DELAY);
  };

  return (
    <section className="look-icon-settings" data-setting="app-icon">
      <span className="settings-group-title" data-audit-ignore="caps">
        {tr("Значок приложения")}
        {id !== DEFAULT_APP_ICON && resetLabel && (
          <button type="button" className="settings-item-reset" onClick={() => edit(appIconLookOf(DEFAULT_APP_ICON), { now: true })}>
            {resetLabel}
          </button>
        )}
      </span>
      <div className="settings-card look-card look-icon-card">
        <div className="look-icon-studio">
          <span className={`look-icon-stage${look.transparent ? " is-clear" : ""}`}>
            <img className="look-icon-preview" src={preview} alt={tr("Предпросмотр значка")} width="96" height="96" draggable="false" />
          </span>
        </div>
        <div className="look-icon-rows">
        <div className="settings-row">
          <span className="settings-row-copy">
            <b>{tr("Цвет звезды")}</b>
          </span>
          <span className="settings-row-control look-icon-colours">
            <ColorSwatches
              label={tr("Цвет звезды")}
              value={look.star}
              colours={STAR_COLOURS}
              names={colourName}
              onChange={(star) => star && edit({ star })}
            />
          </span>
        </div>
        <div className="settings-row">
          <span className="settings-row-copy">
            <b>{tr("Фон значка")}</b>
          </span>
          <span className="settings-row-control">
            <SegmentedControl
              label={tr("Фон значка")}
              value={look.back}
              disabled={look.transparent}
              onChange={(back) => edit({ back }, { now: true })}
              options={[
                { value: "plate", label: tr("Тёмный") },
                { value: "solid", label: tr("Цвет") },
                { value: "gradient", label: tr("Градиент") },
              ]}
            />
          </span>
        </div>
        {!look.transparent && look.back !== "plate" && (
          <div className="settings-row">
            <span className="settings-row-copy">
              <b>{look.back === "gradient" ? tr("Начало градиента") : tr("Цвет фона")}</b>
            </span>
            <span className="settings-row-control look-icon-colours">
              <ColorSwatches
                label={look.back === "gradient" ? tr("Начало градиента") : tr("Цвет фона")}
                value={look.from}
                colours={BACK_COLOURS}
                names={colourName}
                onChange={(from) => from && edit({ from })}
              />
            </span>
          </div>
        )}
        {!look.transparent && look.back === "gradient" && (
          <div className="settings-row">
            <span className="settings-row-copy">
              <b>{tr("Конец градиента")}</b>
            </span>
            <span className="settings-row-control look-icon-colours">
              <ColorSwatches
                label={tr("Конец градиента")}
                value={look.to}
                colours={BACK_COLOURS}
                names={colourName}
                onChange={(to) => to && edit({ to })}
              />
            </span>
          </div>
        )}
        <div className="settings-row">
          <span className="settings-row-copy">
            <b>{tr("Без фона")}</b>
            <small>{tr("Звезда крупнее, фон прозрачный")}</small>
          </span>
          <span className="settings-row-control">
            <Switch label={tr("Без фона")} checked={look.transparent} onChange={(transparent) => edit({ transparent }, { now: true })} />
          </span>
        </div>
        </div>
        {note && (
          <p className="look-icon-note" role="status">
            {note}
          </p>
        )}
      </div>
    </section>
  );
}
