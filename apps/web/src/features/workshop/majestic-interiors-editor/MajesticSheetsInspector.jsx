/*
 * Колонка правок «Листы» редактора «Интерьеры Majestic RP» (ТЗ 29.10.2026-e, п. 3): любой интерьер сервера правится по самим листам.
 *
 * Лист — то, что игра называет текстурой: щелчок по стене, полу или вещи в кадре берёт её лист, он обведён во всех местах кадра. У взятого листа —
 * его картинка, режим «Как в игре / Перекрасить / Залить» и цвет, а ещё «Открыть в студии текстур» (ТЗ 29.10.2026-e): кисть, слои и текст рисуются на самом листе, итог ложится
 * на лист режимом «Своя картинка»; ниже — поиск и список листов помещения с образцом цвета. Правка — `sheets[интерьер][лист]`
 * работы (`majestic-sheets.js`): кадр и установка читают её одним расчётом, а лежит она на всех местах листа во всех помещениях интерьера.
 * Список берётся из самого кадра: что есть в помещении, то и можно выбрать; листы штатных вещей игры общие с игрой и не красятся.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ActionRows from "../../../components/ui/ActionRows.jsx";
import Button from "../../../components/ui/Button.jsx";
import ListGroup from "../../../components/ui/ListGroup.jsx";
import SectionHeading from "../section-help.jsx";
import { FolderOpen, ImageSquare } from "../../../components/ui/icons.jsx";
import ColorField from "../../../components/ui/ColorField.jsx";
import NavRow from "../../../components/ui/NavRow.jsx";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import TextField from "../../../components/ui/TextField.jsx";
import { SHEET_MODES } from "@modovik/climb-contract/recolor/majestic-sheets";
import { useHangarEmblemUrl } from "../hangar-editor/hangar-emblem.js";
import StudioPictureButton from "../texture-studio/StudioPictureButton.jsx";
import { CASINO_SWATCHES } from "./majestic-interiors-data.js";
import { sheetStudioSurface } from "./majestic-sheet-pictures.js";
import { sheetLabel } from "./majestic-sheets-data.js";
import { tr, useTr } from "../../../locales/ui.js";

/* Цвет, с которого начинается правка листа, если своего ещё не было. */
const START_COLOUR = "#8a1c2b";
const fill = (text, ...values) => values.reduce((out, value, index) => out.replace(`{${index}}`, String(value)), text);

function Chip({ colour = "", large = false }) {
  const className = `majestic-chip${large ? " is-large" : ""}${colour ? "" : " is-stock"}`;
  return <span className={className} style={colour ? { background: colour } : undefined} aria-hidden="true" />;
}

const modeLabel = (mode) => (mode === "tint" ? tr("Перекрасить") : mode === "fill" ? tr("Залить") : mode === "picture" ? tr("Своя картинка") : tr("Как в игре"));
/* Подпись — только у правленого листа: «Как в игре» у сотни строк подряд — шум (п. 17 `design-qa.md`). */
const sheetCaption = (look) => {
  if (!look) return null;
  if (look.mode === "picture") return look.picture.name ? `${tr("Своя картинка")} · ${look.picture.name}` : tr("Своя картинка");
  return `${look.mode === "fill" ? tr("Залито") : tr("Перекрашено")} · ${look.colour}`;
};
/* У листа казино — русская подпись описи, у остальных — игровое имя листа. */
const sheetTitle = (sheet) => (sheetLabel(sheet.name) ? tr(sheetLabel(sheet.name)) : sheet.name);

/*
 * Строка списка. У интерьера сотни листов (313 у Mission Row, 636 у Marabunta): список перерисовывался целиком на каждый щелчок по кадру и стоил ~200 мс на
 * процессоре ×4. Строка — `memo` со стабильными свойствами: при выборе листа перерисовываются две строки, а не все.
 */
const SheetRow = memo(function SheetRow({ sheet, look, selected, onToggle }) {
  return (
    <li>
      <NavRow
        className={selected ? "is-selected" : ""}
        aria-pressed={selected}
        icon={look?.mode === "picture" ? <span className="majestic-chip is-picture" aria-hidden="true"><ImageSquare /></span> : look ? <Chip colour={look.colour} /> : null}
        title={sheetTitle(sheet)}
        caption={sheetCaption(look)}
        onOpen={() => onToggle(sheet.name)}
      />
    </li>
  );
});

/**
 * Картинка листа взятого места: превью до 512 px, как её читает главный процесс; нет картинки (плашка, нет игры) — цвет листа. У листа со своей картинкой (`picture` —
 * ключ хранилища) показана она: то, что ляжет на лист.
 */
function SheetPreview({ sheet, source, picture = "" }) {
  const canvas = useRef(null);
  const pictureUrl = useHangarEmblemUrl(picture);
  const [state, setState] = useState("loading");
  const key = sheet?.entry ? `${sheet.entry.game}|${sheet.entry.texture}` : "";
  useEffect(() => {
    let alive = true;
    setState(key ? "loading" : "plate");
    if (!key || !source) return undefined;
    Promise.resolve(source(sheet.entry)).then((bitmap) => {
      const target = canvas.current;
      if (!alive || !target) return;
      if (!bitmap) {
        setState("none");
        return;
      }
      target.width = bitmap.width;
      target.height = bitmap.height;
      target.getContext("2d")?.drawImage(bitmap, 0, 0);
      setState("ready");
    });
    return () => {
      alive = false;
    };
  }, [key, source, sheet?.entry]);
  if (picture) {
    return (
      <div className="majestic-sheet-preview is-picture" role="img" aria-label={tr("Картинка листа")}>
        {pictureUrl ? <img src={pictureUrl} alt="" /> : <span className="fx-hint">{tr("Читаю лист…")}</span>}
      </div>
    );
  }
  const plain = state === "plate" || state === "none";
  return (
    <div className={`majestic-sheet-preview is-${state}`} style={plain ? { background: sheet?.colour } : undefined} role="img" aria-label={tr("Картинка листа")}>
      <canvas ref={canvas} hidden={state !== "ready"} />
      {state === "loading" ? <span className="fx-hint">{tr("Читаю лист…")}</span> : null}
    </div>
  );
}

/**
 * `sheets` — листы помещения (`sheetsOfAsset`); `looks` — правки листов интерьера (`{ лист: { mode, colour } }`); `selected` — взятый лист;
 * `source(запись текстуры)` — картинка листа; `onSelect(лист)`, `onLook(лист, правка | null, подпись)`, `onReset()`. Для студии текстур: `project` и `unitId` — откуда лист,
 * `unitLabel` — слова заголовка окна студии, `onNotice(текст, тон)` — слова студии человеку.
 */
export default function MajesticSheetsInspector({ sheets = [], looks = {}, selected = "", source = null, loading = false, project = "", unitId = "", unitLabel = "", onNotice = null, onSelect, onLook, onReset, absent = false, fix = null }) {
  useTr();
  const [query, setQuery] = useState("");
  const edited = Object.keys(looks).length;
  const item = selected ? sheets.find((sheet) => sheet.name === selected) || null : null;
  const look = item ? looks[item.name] || null : null;
  const mode = look?.mode || "standard";

  const text = query.trim().toLowerCase();
  const rows = useMemo(() => sheets.filter((sheet) => !text || sheet.name.includes(text) || tr(sheetLabel(sheet.name) || "").toLowerCase().includes(text)), [sheets, text]);

  /* Взять лист или снять выбор повторным нажатием. Обработчик стабилен (взятый лист — по ссылке): иначе при каждом выборе строки получали бы новое свойство и перерисовывались все. */
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const toggle = useCallback((name) => onSelect(name === selectedRef.current ? "" : name), [onSelect]);

  /* «Своя картинка» предлагается там, где она уже стоит: ставит её студия, а не переключатель. */
  const modes = SHEET_MODES.filter((value) => value !== "picture" || mode === "picture");
  const onPicture = (saved) => {
    if (!item) return;
    onLook(item.name, { mode: "picture", colour: look?.colour || START_COLOUR, picture: { asset: saved.asset, name: saved.name, width: saved.width, height: saved.height } }, `${sheetTitle(item)}: ${modeLabel("picture")}`);
  };

  const onMode = (value) => {
    if (!item) return;
    if (value === "standard") onLook(item.name, null, `${sheetTitle(item)}: ${modeLabel(value)}`);
    else onLook(item.name, { mode: value, colour: look?.colour || START_COLOUR }, `${sheetTitle(item)}: ${modeLabel(value)}`);
  };

  return (
    <div className="fx-inspector recolor-inspector majestic-inspector">
      {item && (
        <section className="ui-panel fx-section recolor-section majestic-selected" aria-label={tr("Взятый лист")} data-majestic-section="sheet">
          <header className="fx-section-head">
            <h3 className="majestic-name">
              <Chip colour={look?.colour} large />
              <span>{sheetTitle(item)}</span>
            </h3>
            <Button size="sm" variant="ghost" onClick={() => onSelect("")}>
              {tr("Снять выбор")}
            </Button>
          </header>
          <SheetPreview sheet={item} source={source} picture={look?.mode === "picture" ? look.picture.asset : ""} />
          <SegmentedControl label={tr("Вид листа")} className="majestic-modes" size="sm" options={modes.map((value) => ({ value, label: modeLabel(value) }))} value={mode} onChange={onMode} />
          {mode !== "standard" && mode !== "picture" && (
            <ColorField label={tr("Цвет листа")} value={look.colour} swatches={CASINO_SWATCHES} editable onChange={(colour) => onLook(item.name, { mode, colour }, `${sheetTitle(item)}: ${tr("цвет")}`)} />
          )}
          {/* Как ляжет вид и где лежит правка — по «?», а не абзацами под органами (п. 1 `design-qa.md`). */}
          <SectionHeading
            title=""
            help={[
              mode === "picture"
                ? tr("Лист заменён вашей картинкой из студии: она растянута на весь лист, прозрачное остаётся прозрачным.")
                : mode === "fill"
                  ? tr("Лист станет ровным цветом: узор и швы пропадут. Мелкие плашки красятся только так.")
                  : mode === "tint"
                    ? tr("Цвет ложится тоном по светотени листа: узор и швы остаются, меняется оттенок.")
                    : tr("Лист такой же, как в самой игре."),
              tr("Правка лежит на всех местах этого листа во всех помещениях интерьера."),
            ]}
          />
          {/* Студия текстур: холст по размеру листа, основа — лист из файлов игрока; итог — картинка хранилища окна, она едет в установку (`majestic-sheet-pictures.js`). */}
          {unitId && (
            <ListGroup label={tr("Студия")}>
              <StudioPictureButton
                getSurface={() => sheetStudioSurface({ project, unitId, unitLabel, sheet: item, sheetLabel: sheetTitle(item) })}
                image={look?.mode === "picture" ? { asset: look.picture.asset } : null}
                onImage={onPicture}
                onNotice={onNotice}
                slug={`majestic-${unitId}-${item.name}`}
                label={tr("Открыть в студии текстур")}
                caption={tr("Кисть, слои, текст")}
              />
            </ListGroup>
          )}
        </section>
      )}
      <section className="ui-panel fx-section recolor-section" aria-label={tr("Листы")} data-majestic-section="sheets">
        {/* Имени у заголовка нет: оно повторило бы имя панели «Листы» (п. 17); что такое лист и сколько их — по «?». */}
        <SectionHeading
          title=""
          help={[tr("Лист — картинка, которой покрыта стена, пол или вещь. Выберите лист в списке или нажмите по месту в кадре."), fill(tr("Листов в помещении: {0} · изменено: {1}"), sheets.length, edited)]}
        />
        {/* Поиск — полем во всю ширину без подписи над ним. */}
        {sheets.length > 0 && <TextField label="" aria-label={tr("Найти лист")} value={query} placeholder={tr("Найти лист")} onChange={setQuery} />}
        {rows.length ? (
          <ul className="majestic-rows">
            {rows.map((sheet) => (
              <SheetRow key={sheet.name} sheet={sheet} look={looks[sheet.name]} selected={sheet.name === selected} onToggle={toggle} />
            ))}
          </ul>
        ) : (
          /* Помещения нет в кадре (нет файлов интерьера) — не «листов нет», а то, что это исправит: та же строка, что у «Предметов» (п. 14). */
          absent && !sheets.length && fix ? (
            <ListGroup label={tr("Листы")}>
              <NavRow icon={<FolderOpen />} title={fix.title} caption={fix.caption} onOpen={fix.onOpen} />
            </ListGroup>
          ) : (
            <p className="fx-hint">{loading ? tr("Собираем список листов…") : absent && !sheets.length ? tr("Нет интерьера в кадре") : sheets.length ? tr("Листов с таким названием нет.") : tr("В этом помещении нет листов, которые можно править.")}</p>
          )
        )}
        {/* Сбросить — строкой внизу и только когда есть правки: погашенной кнопки в заголовке нет (п. 2, 4 `design-qa.md`). */}
        <ActionRows label={tr("Листы")} actions={[edited > 0 && { id: "reset", label: tr("Сбросить правки"), onClick: onReset }]} />
      </section>
    </div>
  );
}
