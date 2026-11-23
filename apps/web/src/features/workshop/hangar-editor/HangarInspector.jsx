/*
 * Панель ангара — настройки взятого инструмента (мастерская «как в
 * Photoshop»): стены снаружи, стены внутри с фермами и пол (штатный лист
 * игры, свой цвет с яркостью, узор, своя картинка, градиент — по развёртке
 * листа), эмблема или надпись на стенах, переключатели нутра — фермы под
 * крышей, кран, лампы — или готовые виды со «Стандартом GTA».
 *
 * Ангар стандартный (ТЗ 12.10.2026, ночь): основа — штатный ангар игры;
 * «Как в моде» и техника вокруг ушли вместе с модом. ТЗ 13.10.2026:
 * «Конструкции и свет» — все железяки нутра переключателями; «Внутри»
 * ведёт туда кнопкой.
 *
 * Органы — из словаря (`components/ui`): цвет — `ColorField`, числа —
 * `Slider`, выбор — `Select`, да / нет — `Switch`. Раздел — `ui-panel
 * fx-section`, как у остальных редакторов.
 */

import { useEffect, useRef } from "react";
import {
  HANGAR_DECAL,
  HANGAR_EMBLEM_SIZE,
  HANGAR_INVENTORY,
  HANGAR_SHEETS,
  HANGAR_SIDES,
  applyHangarStandard,
  hangarProjectSignature,
} from "@modovik/climb-contract/recolor/hangar";
import ActionRows from "../../../components/ui/ActionRows.jsx";
import ColourRow from "../../../components/ui/ColourRow.jsx";
import ColorField from "../../../components/ui/ColorField.jsx";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import Switch from "../../../components/ui/Switch.jsx";
import FinishField from "../finish/FinishField.jsx";
import EmblemSection from "../emblem/EmblemSection.jsx";
import HangarPresets from "./HangarPresets.jsx";
import HangarLightHook from "./HangarLightHook.jsx";
import HangarPaintHook from "./HangarPaintHook.jsx";
import HangarRoomHook from "./HangarRoomHook.jsx";
import SectionHeading from "../section-help.jsx";
import {
  HANGAR_LAMP_PATCHES,
  HANGAR_RUST_SWATCHES,
  HANGAR_SWATCHES,
  hangarFloorOptions,
  hangarLampOptions,
  hangarLampState,
  hangarSideOptions,
} from "./hangar-text.js";
import { tr, useTr } from "../../../locales/ui.js";

/* «Студия» поверхности ангара: основа — первый лист этой поверхности из игры игрока (`surface`: `floor`, `outside`, `inside`). */
function hangarStudio(surface, title) {
  const texture = Object.keys(HANGAR_SHEETS).find((name) => HANGAR_SHEETS[name].surface === surface);
  /* `path` — поверхность в работе (стены `outside` и `inside`, пол `floor`): живой вид — кадр ангара с этой отделкой из студии. */
  return { id: `hangar:${surface}`, title: `${tr("Ангар")} · ${title}`, path: [surface], ...(texture ? { baseSheet: { scene: HANGAR_INVENTORY.scene.url, texture } } : {}) };
}

/* Подписи режимов отделки у стен ангара — в месте отрисовки. */
const wallHints = () => ({
  standard: tr("Штатный лист ангара из вашей GTA V — как в игре."),
  pattern: tr(
    "Узор ложится на лист стены и повторяется вместе с ним; масштаб — сколько раз на лист. Тени и швы листа остаются.",
  ),
  image: tr(
    "Картинка ложится на лист стены и повторяется вместе с ним — по всем стенам этого листа.",
  ),
  gradient: tr("Градиент ложится на лист стены и повторяется вместе с ним."),
});

/* Что красит каждая сторона: листы ангара общие у нескольких стен.
   Ангар стандартный (ТЗ 13.10.2026): у крашеной стороны пятна, ржавчина и
   накладки поверх стен уходят. ТЗ 17.10.2026: ворота и ржавые рольставни
   красятся со стенами снаружи. */
const sideNotes = () => ({
  outside: tr(
    "Красятся гофра стен, белый цоколь из блоков, светлые панели у ворот, ворота и рольставни, крыша с кромками; гофра и цоколь одевают и часть стен изнутри. Ржавые потёки, ржавчина ворот, светлые заплаты на гофре, грязь со стен и пятна с крыши уходят. Двери для людей и окна остаются как в игре.",
  ),
  inside: tr(
    "Синие стены и потолок изнутри, колонны и фермы под крышей; ржавчина и грязь с них уходят. Пол — своей настройкой ниже.",
  ),
});

/*
 * Раздел: заголовок, пояснения — за «?» у заголовка, а не абзацами (слово владельца 29.10.2026, `design-qa.md`). `title` пустой — имя
 * раздела совпало бы с именем панели («Стены снаружи», «Конструкции и свет»): остаётся «?», раздел зовётся по `label`.
 */
function Section({ title, label, toggle, help = null, element = undefined, children }) {
  return (
    <section
      className="ui-panel fx-section recolor-section"
      aria-label={label || title}
      data-hangar-element={element}
    >
      <SectionHeading title={title} help={help} actions={toggle} />
      {children}
    </section>
  );
}

/* Строка «да / нет»: подпись и переключатель; что значит строка — подсказкой (`hint`), а не строкой под подписью (п. 1 `design-qa.md`). */
function SwitchRow({ title, hint, checked, disabled = false, element = undefined, onChange }) {
  return (
    <label className="fx-switch" data-hangar-element={element} title={hint || undefined}>
      <span>
        <b>{title}</b>
      </span>
      <Switch
        checked={checked}
        label={title}
        disabled={disabled}
        onChange={onChange}
      />
    </label>
  );
}

/*
 * Пол ангара — внутри, но у него свой облик: штатный, как нутро, свой цвет
 * или отделка. Под ним — штатная разметка пола (ТЗ 17.10.2026; владелец:
 * «чтобы разметку можно было тоже включать и выключать»): линии и знаки
 * лежат поверх пола любого облика.
 */
function FloorControls({ floor, markings, onFloor, onStructure, onNotice }) {
  useTr();
  return (
    <>
      <div data-hangar-element="floor">
        <FinishField
          label={tr("Пол")}
          settings={floor}
          modes={hangarFloorOptions()}
          swatches={HANGAR_SWATCHES}
          surface="sheet"
          rows
          title=""
          inherit={{ mode: "inside", label: "Как у стен внутри" }}
          studio={hangarStudio("floor", tr("Пол"))}
          shadeLabel={tr("Светотень листа")}
          hints={{
            standard: tr("Штатный бетон пола ангара из вашей GTA V."),
            inside: tr("Пол той же отделки, что стены внутри."),
          }}
          onNotice={onNotice}
          onChange={onFloor}
        >
          {floor.mode === "colour" && (
            <ColorField
              label={tr("Цвет пола")}
              value={floor.colour}
              swatches={HANGAR_SWATCHES}
              editable
              onChange={(colour) => onFloor({ colour }, "Пол: цвет")}
            />
          )}
        </FinishField>
      </div>
      <SwitchRow
        element="markings"
        title={tr("Разметка пола")}
        hint={markings ? tr("Линии и знаки стоянки поверх пола, как в игре.") : tr("Разметки нет: пол чистый.")}
        checked={markings}
        onChange={(next) =>
          onStructure(
            { markings: next },
            next ? "Разметка: включить" : "Разметка: убрать",
          )
        }
      />
    </>
  );
}

function SideSection({
  side,
  settings,
  onSide,
  onNotice,
  children,
}) {
  useTr();
  const title = tr(side.label);
  return (
    <Section
      title=""
      label={title}
      help={[
        sideNotes()[side.id],
        tr("Тени и швы листа остаются: цвет ложится на светотень, 100 % — ровно выбранный цвет в светлой плоскости листа."),
      ]}
    >
      <FinishField
        label={title}
        settings={settings}
        modes={hangarSideOptions()}
        swatches={HANGAR_SWATCHES}
        surface="sheet"
        rows
        /* Имени группы нет: панель уже зовётся «Отделка» (п. 17, критик 31.10.2026). */
        title=""
        studio={hangarStudio(side.id, title)}
        shadeLabel={tr("Светотень листа")}
        hints={wallHints()}
        onNotice={onNotice}
        onChange={(patch, label) => onSide(side.id, patch, label)}
      >
        {/* Цвет — сразу под строками и только у «Свой цвет» (п. 16 `design-qa.md`): у отделки как в игре поля нет. Ползунка яркости
            нет (п. 11): значение живёт в проекте, вернуть его — строкой внизу страницы (`SideActions`). */}
        {settings.mode === "colour" && (
          <ColorField
            label={tr("Цвет")}
            value={settings.colour}
            swatches={HANGAR_SWATCHES}
            editable
            onChange={(colour) => onSide(side.id, { colour }, `${side.label}: цвет`)}
          />
        )}
      </FinishField>
      {children}
      {/* Железяки — не здесь, а в «Конструкциях» того же переключателя над панелью: строки-перехода к ним больше нет (30.10.2026, повтор пункта). */}
    </Section>
  );
}

/*
 * Конструкции и свет — железяки нутра переключателями (владелец, 12.10.2026:
 * «железные палки сверху… отключать… и лампу включить и выключить»;
 * 13.10.2026: «чтобы человек мог отключать те как бы железяки»). Кран и
 * вентиляция висят на фермах: без ферм их нет, и их переключатели стоят
 * серыми. Колонны остаются всегда: на них фермы, галерея и трубы.
 */
function StructureSection({ project, onStructure }) {
  useTr();
  const toggle = (key, on, label) =>
    onStructure({ [key]: on }, `${label}: ${on ? "включить" : "убрать"}`);
  return (
    <Section title="" label={tr("Конструкции и свет")}>
      <SwitchRow
        title={tr("Фермы под крышей")}
        hint={tr("Балки под крышей. На них висят кран и вентиляция: без ферм их нет.")}
        checked={project.trusses}
        element="trusses"
        onChange={(trusses) => toggle("trusses", trusses, "Фермы")}
      />
      {/* Кран и вентиляция висят на фермах: без ферм их строк нет (п. 2 `design-qa.md`), почему — в подсказке ферм. */}
      {project.trusses && (
        <>
          <SwitchRow
            title={tr("Кран")}
            hint={tr("Мостовой кран под фермами")}
            checked={project.crane}
            element="crane"
            onChange={(crane) => toggle("crane", crane, "Кран")}
          />
          <SwitchRow
            title={tr("Вентиляция")}
            hint={tr("Короба вентиляции под крышей")}
            checked={project.vents}
            element="vents"
            onChange={(vents) => toggle("vents", vents, "Вентиляция")}
          />
        </>
      )}
      <SwitchRow
        title={tr("Галерея и лестницы")}
        hint={tr("Галерея и две лестницы")}
        checked={project.gallery}
        element="gallery"
        onChange={(gallery) => toggle("gallery", gallery, "Галерея")}
      />
      <SwitchRow
        title={tr("Связи на стенах")}
        hint={tr("Косые связи между колоннами")}
        checked={project.bracing}
        element="bracing"
        onChange={(bracing) => toggle("bracing", bracing, "Связи")}
      />
      <SwitchRow
        title={tr("Трубы на стенах")}
        hint={tr("Синие трубы вдоль стен")}
        checked={project.pipes}
        element="pipes"
        onChange={(pipes) => toggle("pipes", pipes, "Трубы")}
      />
    </Section>
  );
}

/*
 * Ржавчина (владелец, 17.10.2026: «добавь возможность красить ржавчину»):
 * пятна на потолке, потёки на кромках крыши, рольставни и ржавые подтёки
 * на стенах меняют только цвет — светотень и всё остальное остаются как в
 * игре. Ржавчина одна на ангар: раздел стоит и у «Снаружи», и у «Внутри».
 * У покрашенной стороны ржавчины нет — её убирает чистка листа.
 */
function RustSection({ project, onStructure }) {
  useTr();
  const rust = project.rust;
  const set = (patch, label) =>
    onStructure({ rust: { ...rust, ...patch } }, label);
  return (
    <Section
      title={tr("Ржавчина")}
      element="rust"
      help={[
        tr("Пятна, потёки и рольставни как в игре. Выберите цвет — перекрасится только ржавчина."),
        tr("На покрашенной стороне ржавчины нет — она уходит вместе с покраской."),
      ]}
    >
      {/* «Свой цвет» — один орган (п. 16 `design-qa.md`): строка «Цвет», справа кружок, палитра раскрывается на месте, «×» — как в игре. */}
      <ColourRow
        group
        title={tr("Цвет")}
        label={tr("Цвет ржавчины")}
        value={rust.mode === "colour" ? rust.colour : null}
        colours={HANGAR_RUST_SWATCHES}
        onChange={(colour) => set({ colour, mode: "colour" }, "Ржавчина: цвет")}
        onClear={() => set({ mode: "standard" }, "Ржавчина: как в игре")}
      />
    </Section>
  );
}

/* Подписи шагов истории правок по выбору ламп. */
const LAMP_STEPS = Object.freeze({
  on: "Лампы: включить",
  off: "Лампы: выключить",
  removed: "Лампы: убрать",
});

/*
 * Лампы — горят, тёмные или убраны совсем (владелец, 17.10.2026: «чтобы
 * лампы из ангара тоже можно было убирать»): без ламп нет ни плафонов с
 * подвесами под крышей, ни фонарей на стенах, ни их света.
 */
function LampsSection({ project, onStructure }) {
  useTr();
  const state = hangarLampState(project);
  const hints = {
    on: tr("16 ламп под крышей и 8 на стенах светят, как в игре."),
    off: tr("Лампы висят тёмными — свет только из ворот."),
    removed: tr("Ламп нет совсем — свет только из ворот."),
  };
  return (
    <Section title={tr("Лампы")} element="lamps" help={[hints.on, hints.off, hints.removed]}>
      <SegmentedControl
        label={tr("Лампы")}
        size="sm"
        options={hangarLampOptions()}
        value={state}
        onChange={(next) =>
          onStructure({ ...HANGAR_LAMP_PATCHES[next] }, tr(LAMP_STEPS[next]))
        }
      />
    </Section>
  );
}

/*
 * Яркость своего цвета стен: ползунка нет (п. 11 `design-qa.md`, владелец: «везде»), значение из шаблона или прежней работы
 * остаётся в проекте. Не 100 % — строкой внизу страницы «Вернуть яркость как в игре».
 */
function SideActions({ side, settings, onSide }) {
  useTr();
  if (settings.mode !== "colour" || settings.brightness === 100) return null;
  return (
    <ActionRows
      label={tr("Действия со стенами")}
      actions={[
        {
          id: "brightness",
          label: tr("Вернуть яркость как в игре"),
          onClick: () => onSide(side.id, { brightness: 100 }, `${side.label}: яркость как в игре`),
        },
      ]}
    />
  );
}

/*
 * «Как в игре» — стены, нутро, пол, железяки и лампы как в игре одним шагом: строкой внизу (`ActionRows`) и только когда есть что
 * возвращать — погашенной «Уже как в игре» и заголовка над ней нет (пп. 2, 4 и 15 `design-qa.md`).
 */
function StandardRows({ project, onStandard }) {
  useTr();
  const standard =
    hangarProjectSignature(applyHangarStandard(project)) ===
    hangarProjectSignature(project);
  if (standard) return null;
  return (
    <ActionRows
      label={tr("Действия с ангаром")}
      actions={[
        {
          id: "standard",
          label: tr("Вернуть как в игре"),
          title: tr("Стены, нутро и пол с разметкой — штатными листами ангара из вашей GTA V, ржавчина как в игре, все железяки нутра и лампы — на месте. Эмблемы, надписи и свои модели остаются."),
          onClick: onStandard,
        },
      ]}
    />
  );
}

export default function HangarInspector({
  tool = "outside",
  project,
  onSide,
  emblems = null,
  onStructure,
  onFloor,
  onStandard,
  onPreset = null,
  onNotice,
  onPlacing,
  /* Раздел тронут (`"pipes"`, `"room"`): камера летит к трубам или в комнату, один раз на вход в раздел (`hangar-views.js`, `HangarStudio.jsx`). */
  onView = null,
  /* Щелчок по детали в кадре (`{ key, count }`): колонка подводит к её полю. */
  aim = null,
}) {
  useTr();
  const holder = useRef(null);
  const aimKey = aim?.key || "";
  const aimCount = aim?.count || 0;
  useEffect(() => {
    if (!aimCount || !aimKey) return undefined;
    const frame = requestAnimationFrame(() =>
      holder.current?.querySelector(`[data-hangar-element="${aimKey}"]`)?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [aimCount, aimKey]);
  const side = HANGAR_SIDES.find((item) => item.id === tool);
  let body;
  if (side)
    body = (
      <>
        <SideSection
          side={side}
          settings={project[side.id]}
          onSide={onSide}
          onNotice={onNotice}
        />
        {/* Пол — своим разделом с именем: раньше вторая «Отделка» стояла под стенами без подписи. */}
        {side.id === "inside" && (
          <Section title={tr("Пол")}>
            <FloorControls
              floor={project.floor}
              markings={project.markings}
              onFloor={onFloor}
              onStructure={onStructure}
              onNotice={onNotice}
            />
          </Section>
        )}
        {/* Мастерская ангара — цвета: место раздела части В (комната внутри) под «Стенами внутри»; пока часть не готова, крючок ничего не рисует. */}
        {side.id === "inside" && <HangarRoomHook project={project} onStructure={onStructure} onView={onView} />}
        <RustSection project={project} onStructure={onStructure} />
        <SideActions side={side} settings={project[side.id]} onSide={onSide} />
      </>
    );
  else if ((tool === "emblem" || tool === "text") && emblems)
    body = (
      <EmblemSection
        edit={{ ...emblems, setPlacing: onPlacing }}
        kind={tool === "text" ? "text" : "image"}
        sizeRange={HANGAR_EMBLEM_SIZE}
        resetLabel={tr("Над воротами")}
        onReset={() =>
          emblems.patch(
            {
              point: [...HANGAR_DECAL.point],
              normal: [...HANGAR_DECAL.normal],
              angle: 0,
            },
            "Эмблема: над воротами",
          )
        }
        intro={
          tool === "text"
            ? tr(
                "Надписи — сколько нужно, каждая со своими словами, шрифтом (можно свой файл шрифта), высотой букв, цветом и прозрачностью. Новая встаёт внутри, на перемычку над воротами, — её можно передвинуть на любую стену.",
              )
            : tr(
                "Картинки (PNG, JPEG, WebP, BMP, GIF, AVIF) — сколько нужно, каждая со своим местом. Прозрачный фон PNG сохраняется: на стене будет только сам рисунок. Новая встаёт внутри, на перемычку над воротами, — её можно передвинуть на любую стену.",
              )
        }
        note={
          tool === "text"
            ? tr(
                "Надпись стоит прямо, как её видят перед стеной, с вашим поворотом; ширина — по словам. В игре она встанет плашкой перед стеной. Надписи едут в код для друга словами.",
              )
            : tr(
                "Эмблема стоит прямо, как её видят перед стеной, с вашим поворотом; ширина — по пропорциям. Перемычка над воротами — около 7 м. В игре эмблема встанет плашкой перед стеной. Картинки остаются на этом компьютере: в код для друга они не едут.",
              )
        }
        onNotice={onNotice}
      />
    );
  else if (tool === "structure")
    body = (
      <>
        <StructureSection project={project} onStructure={onStructure} />
        {/* Мастерская ангара — цвета: места разделов частей Б (конструкции и трубы) и А (свет ламп); пока часть не готова, крючок ничего не рисует. */}
        <HangarPaintHook project={project} onStructure={onStructure} onView={onView} />
        <LampsSection project={project} onStructure={onStructure} />
        <HangarLightHook project={project} onStructure={onStructure} />
      </>
    );
  else
    body = (
      <>
        {onPreset && <HangarPresets project={project} onApply={onPreset} />}
        <StandardRows project={project} onStandard={onStandard} />
      </>
    );
  return (
    <div className="fx-inspector recolor-inspector" ref={holder}>
      {body}
    </div>
  );
}
