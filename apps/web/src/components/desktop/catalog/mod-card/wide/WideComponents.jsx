import {
  cloneElement,
  createElement,
  useEffect,
  useRef,
  useState,
} from "react";
import { Check, WeaponModelGlyph } from "../../../../ui/icons.jsx";
import Checkbox from "../../../../ui/Checkbox.jsx";
import SelectionMark from "../../../../ui/SelectionMark.jsx";
import { tr } from "../../../../../locales/ui.js";
import { ROW_ART_PX } from "../../../../../utils/cover-thumb.js";
import { useTileThumb } from "../../../../../utils/tile-thumb.js";
import { partFace, partIcon } from "../part-face.jsx";
import ModComponents from "../ModComponents.jsx";
import { useComponentEntries } from "../ModContents.jsx";
import { RowPen, RowPlay, RowStudio } from "./WideRowButtons.jsx";
import { gunTitle, stageIndexOf } from "./wide-model.js";
import useWholeRows from "./use-whole-rows.js";

/*
 * Панель компонентов карточки «Пульт» (ганпак, редукс, пак звуков): заголовок с «10 · отмечено 10», строки — превью 62×35, название и семейство, карандаш (где он есть) и
 * тумблер. Нажатие на строку показывает её кадр на сцене (у части редукса без кадра, но с предпросмотром, открывает предпросмотр); строка кадра на сцене подсвечена. Панель
 * занимает остаток высоты правой колонки и листается внутри. Строки — те же записи, что в окне «Компоненты» (`useComponentEntries`): у редукса отметка — настоящий выбор
 * частей (`useComponentChoice`: выключенная часть при установке пропускается), у ганпака — галочки стволов (`gunSelection`), у пака звуков — галочки звуков (`soundSelection`).
 * Окно «Компоненты» с заменой частей, правкой и 3D остаётся: его значок стоит в заголовке панели.
 */

/* Картинка строки — прямоугольник с малым углом по токену, не овал и не плашка (владелец, 22.11.2026: «Не надо закруглять их»). Вырезанный ствол — кадр модели на прозрачном
   фоне, как он стоит: без плиты и без обложки пака. У части без картинки — тот же прямоугольник со значком вида внутри.
   Пустого места нет (слово владельца «пустое не оставлять»): пока картинка не пришла или не придёт вовсе, в ячейке стоит спокойный значок вида; картинка встаёт поверх, когда
   загрузилась, значок в тот же кадр уходит — мигания нет. Грузится сразу, не лениво: диагностика 22.11.2026 показала, что `loading="lazy"` внутри панели не стартует (все 10 картинок
   стояли «не загружены» 24 с, после `eager` пришли за секунды); картинки строк — мелкие превью, строк десятки, а не сотни. */
function RowArt({ face }) {
  const src = useTileThumb(face.cover || "", ROW_ART_PX);
  const image = useRef(null);
  const [shown, setShown] = useState(false);
  /* Значок уходит, только когда картинка ЗАГРУЖЕНА И РАСКОДИРОВАНА (`decode()`): иначе между «пришла» и «нарисована» ячейка на миг пуста. Без `decode` (тесты) — сразу. */
  const reveal = (node) => {
    if (!node) return;
    if (typeof node.decode !== "function") {
      setShown(node.complete !== false);
      return;
    }
    if (!(node.complete && node.naturalWidth > 0)) {
      setShown(false);
      return;
    }
    node.decode().then(
      () => setShown(true),
      () => setShown(false),
    );
  };
  useEffect(() => {
    // Картинка могла прийти из кэша раньше, чем React повесил `onLoad`.
    reveal(image.current);
  }, [src]);
  return (
    <span
      className={`xw-row-art${face.fit === "contain" ? " is-contain" : ""}${src && shown ? " is-shown" : ""}`}
      aria-hidden="true"
    >
      {!(src && shown) && face.media}
      {src && (
        <img
          ref={image}
          src={src}
          alt=""
          data-photo=""
          draggable="false"
          loading="eager"
          decoding="async"
          fetchPriority="low"
          onLoad={(event) => reveal(event.currentTarget)}
          onError={() => setShown(false)}
        />
      )}
    </span>
  );
}

/* Строка панели «Состав» (макет владельца 21.11.2026): флажок слева, картинка, название и вид под ним, справа кнопка («Изменить», ▶). Выключенная часть — пунктиром и словами «Выключено, останется как в игре». */
function Row({ row, selected, canShow, onShow, preview }) {
  const previewable = Boolean(preview?.can(row.key));
  const { check } = row;
  const off = Boolean(check) && !check.checked;
  const act = canShow
    ? onShow
    : previewable
      ? () => preview.open(row.key)
      : undefined;
  const copy = (
    <>
      <b>{row.title}</b>
      {(off || row.sub) && (
        <small>{off ? tr("Выключено, останется как в игре") : row.sub}</small>
      )}
    </>
  );
  return (
    <li
      className={`xw-row xw-comp${off ? " is-off" : ""}${row.installed ? " is-installed" : ""}${selected ? " is-selected" : ""}`}
      data-row={row.key}
    >
      {check ? (
        <span className="xw-comp-check" title={check.hint || undefined}>
          <Checkbox
            ariaLabel={check.label}
            checked={check.checked}
            disabled={check.disabled}
            onChange={check.onChange}
          />
        </span>
      ) : (
        <span className="xw-comp-check is-fixed" aria-hidden="true">
          <SelectionMark on />
        </span>
      )}
      {row.face && <RowArt face={row.face} />}
      {act ? (
        <button
          type="button"
          className="xw-row-name is-pick"
          aria-pressed={selected}
          title={previewable && !canShow ? tr("Предпросмотр") : undefined}
          onClick={act}
        >
          {copy}
        </button>
      ) : (
        <span className="xw-row-name">{copy}</span>
      )}
      {row.installed && (
        <Check
          className="xw-row-mark"
          weight="bold"
          aria-label={tr("Установлено")}
        />
      )}
      {row.play}
      {row.pen}
      {row.menu}
    </li>
  );
}

/* Картинки стволов — все или ни одной (владелец, 22.11.2026): у каждого ствола пака есть снятая модель — стоят у всех, на прозрачном фоне; нет хотя бы у одного — строки без
   картинок вовсе, а не вперемешку с пустыми местами и обложкой пака. */
const gunFaceOf = (row) => {
  const face = partFace(row.mod);
  return row.weapon?.render && face.cover
    ? {
        ...face,
        fit: "contain",
        media: createElement(WeaponModelGlyph, { weight: "regular" }),
      }
    : null;
};

// Строки ганпака: ствол — его имя и вид; тумблер есть, пока в паке достаточно стволов, которые ставятся отдельно.
export function gunRows(view, selection, onToggleGun, pen) {
  const faces = selection.rows.map(gunFaceOf);
  const withArt = faces.every(Boolean);
  return selection.rows.map((row, index) => {
    const title = gunTitle(row, view.mod.name);
    return {
      key: row.id,
      face: withArt ? faces[index] : null,
      title,
      sub: row.weapon.look || "",
      installed: view.parts.installed.includes(row.id),
      pen: pen ? pen(row, title) : null,
      check: selection.toggles
        ? {
            checked: row.on,
            disabled: row.locked,
            hint: row.locked ? tr("Ставится только с паком") : "",
            label: `${tr("Ставить")}: ${title}`,
            onChange: (on) => onToggleGun(row.id, on),
          }
        : null,
    };
  });
}

// Строки редукса: записи окна «Компоненты», без отдельных модов того же поста (сборка их не ставит) и без развёрнутых групп.
function reduxRows(built, separate) {
  return built.entries
    .filter((entry) => !separate.has(entry.key))
    .map((entry) => ({
      key: entry.key,
      face: entry.face,
      title: entry.title,
      // Замена и отключение видны в строке: «Заменён частью другой сборки · …», «Отключён: …».
      sub: entry.note || entry.sub,
      installed: Boolean(entry.installed),
      menu: entry.menu ? cloneElement(entry.menu, { menu: "tray" }) : null,
      check: entry.check
        ? {
            checked: entry.check.checked,
            disabled: false,
            hint: "",
            label: entry.check.label,
            onChange: entry.check.onChange,
          }
        : null,
    }));
}

function Rows({ rows, items, current, onShow, preview }) {
  /* Список листается внутри панели: в покое нижняя строка видна целиком, до подвала — зазор. */
  const list = useRef(null);
  useWholeRows(list, ":scope > li", [rows.length]);
  return (
    <ul className="xw-rows" role="list" ref={list}>
      {rows.map((row) => (
        <Row
          key={row.key}
          row={row}
          selected={
            current === `part:${row.key}` || current === `weapon:${row.key}`
          }
          canShow={stageIndexOf(items, row.key) >= 0}
          onShow={() => onShow(row.key)}
          preview={preview}
        />
      ))}
    </ul>
  );
}

function Panel({ title, rows, items, current, onShow, preview, children }) {
  return (
    <section className="xw-card xw-components" aria-label={title}>
      <Rows
        rows={rows}
        items={items}
        current={current}
        onShow={onShow}
        preview={preview}
      />
      {children}
    </section>
  );
}

/** Панель ганпака: строки и «обвесы и звуки — только целым паком» при неполном выборе. */
export function GunComponents({
  view,
  selection,
  items,
  current,
  onToggleGun,
  onShow,
  pen,
}) {
  const rows = gunRows(view, selection, onToggleGun, pen);
  return (
    <Panel
      title={tr("Компоненты ганпака")}
      rows={rows}
      items={items}
      current={current}
      onShow={onShow}
    >
      {selection.toggles && !selection.all && (
        <p className="xw-components-note">
          {tr("Обвесы и звуки пака ставятся только целым паком")}
        </p>
      )}
    </Panel>
  );
}

/** Панель редукса и тумблер «Оставить мой таймцикл» (выключает компонент «Таймцикл»: он при установке пропускается). */
export function ReduxComponents({
  view,
  items,
  current,
  onShow,
  onPreview,
  onEntries,
  onCounts,
}) {
  const built = useComponentEntries(view);
  // Записи панели уходят карточке, а с ними сколько частей включено из скольких: «Установить 7 из 8» в шапке и внизу панели «Состав».
  useEffect(() => {
    if (!built) return;
    onEntries?.(built.entries);
    const separate = new Set(
      built.shown.filter((tile) => tile.separate).map((tile) => tile.mod.id),
    );
    const rows = reduxRows(built, separate);
    onCounts?.({
      total: rows.length,
      marked: rows.filter((row) => !row.check || row.check.checked).length,
    });
  });
  if (!built) return null;
  const separate = new Set(
    built.shown.filter((tile) => tile.separate).map((tile) => tile.mod.id),
  );
  const rows = reduxRows(built, separate);
  /* Тумблера «Оставить мой таймцикл» в панели больше нет (владелец, 22.11.2026: без переключателей): то же делает флажок строки «Таймцикл». */
  return (
    <Panel
      title={tr("Части редукса")}
      rows={rows}
      items={items}
      current={current}
      onShow={onShow}
      preview={onPreview}
    />
  );
}

/** Строки пака звуков: оружие, длина выстрела, ▶, карандаш в студию звука на этом стволе, галочка. `facts(item)` — `soundRowFacts`, `selection` — `soundSelection`. */
function soundRows({ selection, onToggle, play, pen }) {
  /* Как у стволов: картинки стоят у всех звуков пака или нет ни у одного. */
  const withArt = selection.rows.every((row) => row.facts.picture);
  return selection.rows.map((row) => {
    const { item, facts } = row;
    const Icon = partIcon(item.part);
    return {
      key: row.id,
      face: withArt
        ? {
            cover: facts.picture,
            fit: "contain",
            media: createElement(Icon, { weight: "regular" }),
          }
        : null,
      title: <span data-no-translate="">{facts.name}</span>,
      sub: facts.length || "",
      installed: false,
      play: facts.url ? play(facts) : null,
      pen: pen(item, facts),
      check: selection.toggles
        ? {
            checked: row.on,
            disabled: false,
            hint: "",
            label: `${tr("Ставить")}: ${facts.name}`,
            onChange: (on) => onToggle(row.id, on),
          }
        : null,
    };
  });
}

/** Панель пака звуков. */
export function SoundComponents({
  selection,
  items,
  current,
  onToggle,
  onShow,
  play,
  pen,
}) {
  const rows = soundRows({ selection, onToggle, play, pen });
  return (
    <Panel
      title={tr("Звуки мода")}
      rows={rows}
      items={items}
      current={current}
      onShow={onShow}
    />
  );
}

/** Окно «Компоненты» (замена частей, правка, 3D) — `ModComponents`: кнопка стоит в шапке панели «Состав». */
export const ComponentsTools = ({ view }) => (
  <ModComponents view={view} size="md" reopen={false} />
);

export { RowPen, RowPlay, RowStudio };
