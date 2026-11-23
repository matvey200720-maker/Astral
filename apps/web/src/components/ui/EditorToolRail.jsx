import { Fragment, memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { hotkey, isTextEntry } from "../../utils/hotkeys.js";
import { CaretDoubleLeft } from "./icons.jsx";
import Kbd from "./Kbd.jsx";
import { softHyphens } from "./soft-hyphens.js";
import { tr, useTr } from "../../locales/ui.js";

/*
 * Колонка инструментов редактора — слева, как в Photoshop.
 *
 * До неё каждый редактор раскладывал свои органы по-своему: большая карта —
 * лентой подписанных кнопок над кадром, завод и ангар — длинной колонкой
 * разделов справа, где цвет корпуса, эмблема и свет шли одним свитком. Человек
 * листал колонку в поисках нужного раздела и терял, где находится. Теперь у
 * любого редактора один и тот же ответ на «чем я сейчас правлю»: инструмент
 * выбран слева, справа — только его настройки (`EditorShell`).
 *
 * ЧТО ВО ЧТО КЛАДУТ
 *
 *  • `tools` — [{ id, label, icon, shortcut, group, disabled, flyout, menu }].
 *    `label` — то, что всплывает рядом со значком и стоит заголовком панели
 *    справа; `shortcut` — латинская буква или цифра (узнаётся на любой
 *    раскладке, `utils/hotkeys.js`); смена `group` между соседями рисует
 *    волосок-разделитель.
 *  • `flyout` — быстрый выбор прямо у значка, как у фигур в Photoshop:
 *    `({ close }) => node`. Открывается щелчком по инструменту, закрывается
 *    выбором, щелчком мимо, Escape, прокруткой страницы и сменой размера окна. Полные настройки всё равно живут справа —
 *    выпадашка лишь короче к ним путь.
 *  • `menu` — у инструмента есть меню: в правом нижнем углу значка рисуется уголок-треугольник
 *    (образец 14, «Кисть», «Фигура»). Сам он ничего не открывает — это признак для глаза. Без
 *    поля уголок стоит у тех, у кого есть `flyout`; `menu: true` ставят инструменту, чьё меню живёт
 *    не выпадашкой у значка, а справа; `menu: false` убирает уголок у инструмента с `flyout`.
 *  • `pinned: "end"` — инструмент прижат к низу колонки, как «Слои» у
 *    большой карты (11.10): между ним и остальными — свободное место.
 *  • `shortcuts` — ложь там, где буквы заняты другим делом: в режиме полёта
 *    WASD ведут камеру, а не выбирают инструменты.
 *  • `disabled` с `disabledReason` — инструмент на месте, но сейчас ему
 *    нечего править («Доступно только для стандартного дирижабля», ТЗ
 *    22.10.2026). Кнопка не выключается по-настоящему: выключенная кнопка
 *    не ловит мышь, и человек не узнал бы почему. Она гаснет, щелчок по ней
 *    ничего не меняет, а подсказка называет причину.
 *
 * НАЗВАНИЯ В КОЛОНКЕ (`names`, владелец 24.10 и 25.10.2026): «новый человек без
 * наведения должен понять, та ли это вкладка». Колонка — список: значок слева,
 * название справа в одну строку, как боковая панель, а не столбик одинаковых
 * значков. Подсказка рядом в этом виде не всплывает — название и так перед
 * глазами; остаётся только причина у выключенного. Горячая клавиша переезжает в
 * шапку панели справа (`EditorShell`). `onNamesHidden` рисует внизу «Скрыть
 * названия» — колонка сворачивается до значков, выбор общий для всех
 * редакторов (`editor-tool-names.js`).
 *
 * Разметка у двух видов одна. Меняется только ширина колонки (`--editor-tools-w`, оболочка), а значок
 * стоит на месте: левый отступ строки подобран так, что его центр лежит ровно посередине свёрнутой колонки.
 * Название не пересобирается при сужении (у него своя ширина) — его гасит прозрачность и обрезает край,
 * поэтому сворачивание плавное, без переноса слов и без рывка плашки выбора.
 *
 * Подпись — не `title` и не `aria-label`: оболочка показывает оба как
 * системную подсказку через секунду мелким серым текстом, обрезающим
 * горячую клавишу, и она ложится поверх своей («Надпись (3)» на плашке
 * «Надпись [3]»). Имя кнопки для чтения с экрана — скрытый текст внутри неё.
 * Своя подпись появляется рядом с колонкой и
 * живёт порталом в хосте наложений — колонка прокручивается в низком окне и
 * обрезала бы всё, что торчит за её край.
 */

/* Хост наложений — тот же, где живут меню и диалоги (см. `MenuButton.jsx`):
   в нём координаты окна — координаты окна, а не трансформированного предка. */
function overlayHost() {
  if (typeof document === "undefined") return null;
  return (
    document.querySelector("[data-desktop-overlay-host]") ||
    document.querySelector(".desktop-app") ||
    document.body
  );
}

/* Задержка подсказки под мышью: проведённая мимо колонки рука не должна
   поджигать пять подписей подряд. С клавиатуры — сразу. */
const TIP_DELAY = 380;

/* Плашка у кнопки «Показать названия» — не инструмент, свой ключ. */
const NAMES_TIP = "\u0000names";

function placeBeside(button) {
  const rect = button.getBoundingClientRect();
  return { left: rect.right + 10, top: rect.top + rect.height / 2 };
}

/* `memo`: каркас перерисовывается на входе много раз с теми же инструментами — колонке незачем. Язык — через `useTr`, иначе смена языка её бы не задела. */
function EditorToolRail({
  tools = [],
  value,
  onChange,
  label = "Инструменты",
  shortcuts = true,
  names = false,
  onNamesHidden = null,
}) {
  useTr();
  const railRef = useRef(null);
  const [pill, setPill] = useState(null);
  const [tip, setTip] = useState(null);
  const tipTimer = useRef(0);
  const [flyout, setFlyout] = useState(null);
  const flyoutRef = useRef(null);
  const visible = tools.filter((tool) => !tool.hidden);

  /*
   * Подсветка выбранного едет к нему, а не вспыхивает на месте. Положение
   * меряется от самой кнопки: группы с волосками между ними делают шаг ряда
   * неровным, и посчитать его из индекса нельзя.
   */
  useLayoutEffect(() => {
    const measure = () => {
      const button = railRef.current?.querySelector(
        `[data-tool="${CSS.escape(String(value ?? ""))}"]`,
      );
      if (!button) {
        setPill(null);
        return;
      }
      /* Только высота и место по вертикали: по ширине плашка — вся колонка за вычетом полей (CSS), поэтому
         при сворачивании названий она сужается вместе с колонкой, а не прыгает. */
      setPill((current) =>
        current?.y === button.offsetTop && current?.height === button.offsetHeight
          ? current
          : { y: button.offsetTop, height: button.offsetHeight },
      );
    };
    /*
     * Замер — в начале кадра, а не посреди фиксации: `offsetTop` в эффекте раскладки заставляет браузер досчитать стили и раскладку всей новой комнаты тут же — 74 мс при ×4 на
     * «Редактировать» мастерской одежды (31.10.2026), — а следом React правит разметку, и их считают второй раз. Так было и с первым местом плашки при входе в редактор: трасса
     * входа в «Анимации» (2.11.2026, ×4) — пересчёт стилей 89 элементов и раскладка 119 из 221 объекта из этой строки, а через 60 мс то же самое ещё раз для `ScrollRail`.
     * Пока плашки нет, выбранную кнопку подсвечивает сама кнопка (`.ui-editor-tools:not([data-pill])` в `editor-shell.css`) — колонка без подсветки не появляется.
     */
    let frame = 0;
    if (typeof requestAnimationFrame !== "function") measure();
    else frame = requestAnimationFrame(measure);
    /* Прижатый к низу инструмент едет вместе с высотой окна — подсветка за ним. */
    if (typeof ResizeObserver === "undefined" || !railRef.current)
      return () => {
        if (frame) cancelAnimationFrame(frame);
      };
    const observer = new ResizeObserver(measure);
    observer.observe(railRef.current);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [value, visible.length]);

  /* Инструмент сменился с клавиатуры или из панели — выпадашка прежнего
     больше ни к чему. */
  useEffect(() => {
    setFlyout((current) => (current && current.id !== value ? null : current));
  }, [value]);

  useEffect(() => {
    if (!flyout) return undefined;
    const onPointerDown = (event) => {
      if (flyoutRef.current?.contains(event.target)) return;
      if (railRef.current?.contains(event.target)) return;
      setFlyout(null);
    };
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      event.stopImmediatePropagation();
      setFlyout(null);
    };
    /* Всплывашка стоит у значка по месту на экране: страница уехала
       прокруткой или окно сменило размер — значок уже не там, и висеть
       поверх панели ей незачем. Прокрутка внутри самой всплывашки — своя. */
    const onMove = (event) => {
      const target = event.target;
      if (target instanceof Node && flyoutRef.current?.contains(target)) return;
      setFlyout(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [flyout, railRef]);

  /*
   * Горячие клавиши инструментов. Буква без модификаторов: Ctrl+B и Ctrl+Z
   * остаются браузеру и истории. В поле для текста буква — это буква, а при
   * открытом окне клавиатура принадлежит окну.
   */
  const latest = useRef({ visible, onChange });
  latest.current = { visible, onChange };
  useEffect(() => {
    if (!shortcuts) return undefined;
    const onKeyDown = (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat)
        return;
      if (isTextEntry(event.target)) return;
      if (event.target?.tagName === "SELECT") return;
      /* Инструкция редактора (`data-ui-tour`) не модальна: горячие клавиши инструментов при ней живы. */
      if (document.querySelector("[role='dialog']:not([data-ui-tour])")) return;
      const key = hotkey(event);
      const tool = latest.current.visible.find(
        (item) =>
          item.shortcut &&
          !item.disabled &&
          String(item.shortcut).toLowerCase() === key,
      );
      if (!tool) return;
      event.preventDefault();
      latest.current.onChange?.(tool.id);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shortcuts]);

  useEffect(() => () => window.clearTimeout(tipTimer.current), []);

  /*
   * Подпись живёт, пока мышь на значке или в нём фокус с клавиатуры. Окно,
   * открытое без движения мыши (Ctrl+Enter, очередь установки, выбор
   * из меню), событий ухода не рождает, и подпись зависала под ним — окно её
   * размывало, и на экране оставался серый брусок без текста. Любое нажатие,
   * клавиша (до того, как фокус перейдёт и покажет свою подпись), прокрутка,
   * уход окна из фокуса или мышь за пределами значка её гасят.
   */
  const tipId = tip?.id;
  useEffect(() => {
    if (!tipId) return undefined;
    const hide = () => {
      window.clearTimeout(tipTimer.current);
      setTip(null);
    };
    const onPointerMove = (event) => {
      const tool = event.target?.closest?.(".ui-editor-tool");
      if (tool && tool.dataset.tool === tipId) return;
      if (tipId === NAMES_TIP && event.target?.closest?.(".ui-editor-tools-names")) return;
      hide();
    };
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("keydown", hide, true);
    document.addEventListener("scroll", hide, true);
    document.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("blur", hide);
    return () => {
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("keydown", hide, true);
      document.removeEventListener("scroll", hide, true);
      document.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("blur", hide);
    };
  }, [tipId]);

  const showTip = (tool, button, delay) => {
    window.clearTimeout(tipTimer.current);
    /* С названиями в колонке плашка повторила бы строку — нужна только причина
       у выключенного. */
    if (names && !(tool.disabled && tool.disabledReason)) return;
    const open = () => setTip({ id: tool.id, ...placeBeside(button) });
    if (delay) tipTimer.current = window.setTimeout(open, delay);
    else open();
  };
  const hideTip = () => {
    window.clearTimeout(tipTimer.current);
    setTip(null);
  };

  /* Стрелки ходят по колонке, как по списку: Tab входит в неё один раз и
     выходит дальше, а не прошагивает двенадцать значков. */
  const onKeyDown = (event) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const buttons = [
      ...(railRef.current?.querySelectorAll(".ui-editor-tool:not(:disabled)") ||
        []),
    ];
    if (!buttons.length) return;
    event.preventDefault();
    const current = buttons.indexOf(document.activeElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
            buttons.length;
    buttons[next].focus();
  };

  const host = tip || flyout ? overlayHost() : null;
  const tipTool = tip && visible.find((tool) => tool.id === tip.id);
  const flyoutTool = flyout && visible.find((tool) => tool.id === flyout.id);

  return (
    <nav
      ref={railRef}
      className="ui-editor-tools"
      data-names={names ? "" : undefined}
      data-pill={pill ? "" : undefined}
      role="toolbar"
      aria-orientation="vertical"
      aria-label={tr(label)}
      onKeyDown={onKeyDown}
      onPointerLeave={hideTip}
    >
      {pill && (
        <span
          className="ui-editor-tools-pill"
          aria-hidden="true"
          style={{
            "--tool-pill-y": `${pill.y}px`,
            "--tool-pill-h": `${pill.height}px`,
          }}
        />
      )}
      {visible.map((tool, index) => {
        const active = tool.id === value;
        /* Выключен с причиной — кнопка остаётся живой для мыши и подсказки. */
        const explained = Boolean(tool.disabled && tool.disabledReason);
        const previous = visible[index - 1];
        const pinned = tool.pinned === "end" && previous?.pinned !== "end";
        const divided =
          !pinned && previous && (previous.group || "") !== (tool.group || "");
        /* Волосок — отдельной чертой, а не рамкой у кнопки: кнопка обязана
           мериться от самой колонки (`offsetTop` подсветки), а обёртка с
           позиционированием сделала бы её точкой отсчёта саму себя. */
        return (
          <Fragment key={tool.id}>
            {divided && (
              <span className="ui-editor-tools-divider" aria-hidden="true" />
            )}
            {pinned && (
              <span className="ui-editor-tools-spacer" aria-hidden="true">
                <span className="ui-editor-tools-divider" />
              </span>
            )}
            <button
              type="button"
              className={`ui-editor-tool${active ? " is-active" : ""}${explained ? " is-disabled" : ""}`}
              data-tool={tool.id}
              data-menu={(tool.menu ?? Boolean(tool.flyout)) ? "" : undefined}
              aria-pressed={active}
              aria-haspopup={tool.flyout ? "dialog" : undefined}
              aria-expanded={tool.flyout ? flyout?.id === tool.id : undefined}
              aria-disabled={explained || undefined}
              tabIndex={active || (!value && index === 0) ? 0 : -1}
              disabled={tool.disabled && !explained}
              onPointerEnter={(event) =>
                showTip(tool, event.currentTarget, TIP_DELAY)
              }
              onFocus={(event) => {
                if (event.currentTarget.matches(":focus-visible"))
                  showTip(tool, event.currentTarget, 0);
              }}
              onBlur={hideTip}
              onClick={(event) => {
                if (explained) {
                  showTip(tool, event.currentTarget, 0);
                  return;
                }
                hideTip();
                onChange?.(tool.id);
                if (!tool.flyout) return;
                const rect = event.currentTarget.getBoundingClientRect();
                setFlyout((current) =>
                  current?.id === tool.id
                    ? null
                    : { id: tool.id, left: rect.right + 10, top: rect.top },
                );
              }}
            >
              {tool.icon}
              {/* Видимое название — для глаз; имя кнопки для читалки — скрытое ниже, с горячей клавишей. Название
                  стоит в разметке и при свёрнутой колонке: её сужение прячет его краем и растворяет, а не пересобирает. */}
              <span className="ui-editor-tool-label" aria-hidden="true">
                {softHyphens(tr(tool.label))}
              </span>
              <span className="ui-editor-tool-name">
                {tool.shortcut
                  ? `${tr(tool.label)} (${String(tool.shortcut).toUpperCase()})`
                  : tr(tool.label)}
              </span>
            </button>
          </Fragment>
        );
      })}
      {onNamesHidden && (
        /* Выключатель вида, а не инструмент: `role="switch"`, чтобы обход кнопок колонки (читалка, тесты)
           считал только инструменты. Видимая подпись — действие, имя для читалки — постоянное. */
        <button
          type="button"
          role="switch"
          aria-checked={names}
          className="ui-editor-tools-names"
          onPointerEnter={(event) => {
            if (names) return;
            const where = placeBeside(event.currentTarget);
            window.clearTimeout(tipTimer.current);
            tipTimer.current = window.setTimeout(
              () => setTip({ id: NAMES_TIP, ...where }),
              TIP_DELAY,
            );
          }}
          onClick={() => {
            hideTip();
            onNamesHidden(names);
          }}
        >
          {/* Одна стрелка на оба вида: свёрнутая колонка разворачивает её поворотом (CSS), а не подменой значка. */}
          <CaretDoubleLeft />
          <span className="ui-editor-tool-label" aria-hidden="true">
            {tr("Скрыть названия")}
          </span>
          <span className="ui-editor-tool-name">{tr("Названия инструментов")}</span>
        </button>
      )}
      {host &&
        tip?.id === NAMES_TIP &&
        createPortal(
          <div
            className="ui-editor-tool-tip"
            role="tooltip"
            style={{ left: tip.left, top: tip.top }}
          >
            <span>{tr("Показать названия")}</span>
          </div>,
          host,
        )}
      {host &&
        tipTool &&
        !flyoutTool &&
        createPortal(
          <div
            className={`ui-editor-tool-tip${tipTool.disabled && tipTool.disabledReason ? " has-reason" : ""}`}
            role="tooltip"
            style={{ left: tip.left, top: tip.top }}
          >
            <span>{tr(tipTool.label)}</span>
            {tipTool.shortcut && !tipTool.disabled && (
              <Kbd>{String(tipTool.shortcut).toUpperCase()}</Kbd>
            )}
            {tipTool.disabled && tipTool.disabledReason && (
              <small className="ui-editor-tool-tip-reason">{tr(tipTool.disabledReason)}</small>
            )}
          </div>,
          host,
        )}
      {host &&
        flyoutTool &&
        createPortal(
          <div
            ref={flyoutRef}
            className="ui-editor-tool-flyout"
            role="dialog"
            aria-label={tr(flyoutTool.label)}
            style={{ left: flyout.left, top: flyout.top }}
          >
            {flyoutTool.flyout({ close: () => setFlyout(null) })}
          </div>,
          host,
        )}
    </nav>
  );
}
export default memo(EditorToolRail);
