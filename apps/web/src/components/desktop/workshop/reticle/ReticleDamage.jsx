import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  AMMO_FONTS,
  AMMO_TEXT_SIZE,
  DAMAGE_COLOR_MODES,
  DAMAGE_COUNTER_FPS,
  DAMAGE_COUNTER_IDLE,
  DAMAGE_COUNTER_LIMITS,
  DAMAGE_FIELD_SIZE,
  DAMAGE_RAINBOW,
  DAMAGE_SCOPE_WEAPONS,
  DAMAGE_SERVERS,
  FILES_DAMAGE_SERVER,
  RETICLE_STAGE,
  STOCK_WEAPON_DAMAGE,
  damageCounterHit,
  damageCounterLook,
  damageCounterText,
  damageCounterTick,
  damageFont,
  damageForWeapon,
  damageOutlineOffsets,
  damageServer,
  normalizeDamageCounter,
} from "@modovik/reticle-contract";
import { Target } from "../../../ui/icons.jsx";
import Button from "../../../ui/Button.jsx";
import Checkbox from "../../../ui/Checkbox.jsx";
import ChoiceRadioGroup from "../../../ui/ChoiceRadioGroup.jsx";
import ColorField from "../../../ui/ColorField.jsx";
import NavRow from "../../../ui/NavRow.jsx";
import PanelPage from "../../../ui/PanelPage.jsx";
import SegmentedControl from "../../../ui/SegmentedControl.jsx";
import Slider from "../../../ui/Slider.jsx";
import Switch from "../../../ui/Switch.jsx";
import GameFontsLink from "../../../../features/workshop/emblem/GameFontsLink.jsx";
import { RETICLE_SWATCHES } from "./ReticleInspector.jsx";
import { FALLBACK_FAMILY, glyphLine, useAmmoFonts } from "./ReticleAmmo.jsx";
import { RETICLE_SNIPERS, RETICLE_WEAPONS, RETICLE_WEAPON_GROUPS } from "./reticle-weapons.js";
import { grabFrame } from "./reticle-grab.js";
import { tr, useTr } from "../../../../locales/ui.js";

/*
 * Счётчик урона (владелец, 30.10.2026) — инструмент редактора прицела: панель
 * настроек и счётчик в кадре. Один на обе вкладки: он лежит на корне фильма и
 * не зависит ни от рисунка, ни от оптики.
 *
 * Игра не сообщает прицелу размер урона, поэтому число — база ствола из таблицы
 * сервера; панель говорит об этом сразу под выбором сервера. Своих чисел человек
 * не пишет (владелец, 30.10.2026). Как это устроено в файле —
 * `apps/desktop/src/reticle-damage-gfx.js`. Кадр и файл идут по одному автомату:
 * `damageCounterHit` и `damageCounterTick` контракта.
 */

/** Какой ствол считает кадр: взятый в углу кадра, у оптики — её ствол. */
export function previewWeapon(kind, weaponId, scope) {
  if (kind === "sniper")
    return scope === "sniper" ? "WEAPON_SNIPERRIFLE" : "WEAPON_HEAVYSNIPER";
  return weaponId || "WEAPON_PISTOL";
}

/** Сколько кадр прибавляет за попадание этим стволом; 0 — ствола нет в таблице. */
export const previewDamage = (counter, weapon) =>
  damageForWeapon(counter, weapon, STOCK_WEAPON_DAMAGE[weapon]);

/* ----------------------- счётчик в кадре ----------------------- */

const STAGE_HALF_WIDTH = RETICLE_STAGE.width / 2;
const STAGE_HALF_HEIGHT = RETICLE_STAGE.height / 2;
/* Единицы букв в кадре — кегль счётчика патронов (`glyphLine`). */
const ART_UNIT = AMMO_TEXT_SIZE / DAMAGE_FIELD_SIZE;

const rgbOfIdle = (counter) =>
  counter.colorMode === "rainbow"
    ? `#${DAMAGE_RAINBOW[0].toString(16).padStart(6, "0")}`
    : counter.color;

/**
 * Счётчик в кадре: те же копии обводки и то же поле, что в файле. Прозрачность
 * — на каждой копии, а не на группе: `_alpha` клипа в игре ложится так же.
 * Состояние живёт здесь, чтобы кадры анимации не перерисовывали весь редактор;
 * стрелять в него можно снаружи (`ref.current.hit`).
 */
export const DamageCounterLayer = forwardRef(function DamageCounterLayer(
  { counter: input, editing = false, sample = 0, onMove = null, onActive = null },
  ref,
) {
  useTr();
  const counter = normalizeDamageCounter(input);
  const [state, setState] = useState(DAMAGE_COUNTER_IDLE);
  const live = useRef(counter);
  live.current = counter;

  useImperativeHandle(
    ref,
    () => ({
      hit: (damage, kill = false) =>
        setState((current) => damageCounterHit(current, live.current, { damage, kill })),
    }),
    [],
  );

  /* Кадры фильма — 30 в секунду и только пока число на экране. */
  const shown = state.visible;
  useEffect(() => {
    onActive?.(shown);
    if (!shown) return undefined;
    let raf = 0;
    let last = performance.now();
    let spare = 0;
    const step = (now) => {
      spare += now - last;
      last = now;
      const length = 1000 / DAMAGE_COUNTER_FPS;
      /* Вкладка спала — не догонять минутами. */
      let frames = Math.min(Math.floor(spare / length), DAMAGE_COUNTER_FPS);
      spare %= length;
      if (frames > 0)
        setState((current) => {
          let next = current;
          while (frames > 0 && next.visible) {
            next = damageCounterTick(next, live.current);
            frames -= 1;
          }
          return next;
        });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [shown, onActive]);

  const game = useAmmoFonts();
  const font = damageFont(counter.font);
  const record = game?.fonts?.get(font.face) || null;
  const box = useRef(null);
  const drag = useRef(null);

  if (!shown && !editing) return null;

  /* Ствол вне таблицы: место всё равно задают по числу в кадре. */
  const content = shown || sample ? damageCounterText(shown ? state.total : sample, counter) : "0";
  const look = shown
    ? damageCounterLook(state, counter)
    : { alpha: counter.opacity, bump: 1, colour: rgbOfIdle(counter) };
  const line = record ? glyphLine(record, [{ text: content, role: "damage" }]) : null;
  const width = line ? line.width : content.length * AMMO_TEXT_SIZE * 0.5;
  const unitScale = AMMO_TEXT_SIZE / font.metrics.nominal;
  /* Строка стоит серединой в точке, как поле в файле. */
  const baseline = (font.metrics.cap * unitScale) / 2;
  const opacity = look.alpha / 100;
  const offsets = damageOutlineOffsets(counter).map(([x, y]) => [x * ART_UNIT, y * ART_UNIT]);

  const pointAt = (event) => {
    const svg = box.current?.ownerSVGElement;
    const matrix = svg?.getScreenCTM?.();
    if (!svg || !matrix) return null;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const local = point.matrixTransform(matrix.inverse());
    return { x: local.x + STAGE_HALF_WIDTH, y: local.y + STAGE_HALF_HEIGHT };
  };
  const onPointerDown = (event) => {
    if (!editing || !onMove) return;
    const point = pointAt(event);
    if (!point) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { dx: counter.x - point.x, dy: counter.y - point.y };
  };
  const onPointerMove = (event) => {
    if (!drag.current) return;
    const point = pointAt(event);
    if (!point) return;
    onMove({
      x: Math.round(Math.min(RETICLE_STAGE.width, Math.max(0, point.x + drag.current.dx))),
      y: Math.round(Math.min(RETICLE_STAGE.height, Math.max(0, point.y + drag.current.dy))),
    });
  };
  const onPointerUp = (event) => {
    drag.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const glyphs = (fill, key, dx = 0, dy = 0) =>
    line ? (
      <g key={key} transform={`translate(${-width / 2 + dx} ${baseline + dy})`}>
        {line.runs.map((run, index) => (
          <path
            key={index}
            d={run.d}
            transform={`translate(${run.x} 0) scale(${line.scale})`}
            fill={fill}
            fillOpacity={opacity}
            fillRule="evenodd"
          />
        ))}
      </g>
    ) : (
      <text
        key={key}
        x={dx}
        y={baseline + dy}
        textAnchor="middle"
        fontFamily={FALLBACK_FAMILY[font.id]}
        fontSize={AMMO_TEXT_SIZE}
        fill={fill}
        fillOpacity={opacity}
      >
        {content}
      </text>
    );

  const sizeScale = (counter.size / AMMO_TEXT_SIZE) * look.bump;
  const frame = grabFrame({ x: -width / 2 - 4, y: -AMMO_TEXT_SIZE * 0.7, width: width + 8, height: AMMO_TEXT_SIZE * 1.4 }, sizeScale);
  return (
    <g
      ref={box}
      className={`reticle-damage-art${editing ? " is-editing" : ""}${counter.enabled ? "" : " is-off"}`}
      data-damage-total={shown ? state.total : undefined}
      transform={`translate(${counter.x - STAGE_HALF_WIDTH} ${counter.y - STAGE_HALF_HEIGHT}) scale(${sizeScale})`}
      aria-label={`${tr("Счётчик урона")}: ${content}`}
    >
      {editing && (
        <rect
          className="reticle-ammo-frame"
          x={frame.x}
          y={frame.y}
          width={frame.width}
          height={frame.height}
          rx={3}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      )}
      <g pointerEvents="none">
        {offsets.map(([x, y], index) => glyphs("#000", `o${index}`, x, y))}
        {glyphs(look.colour, "main")}
      </g>
    </g>
  );
});

/* --------------------------- панель --------------------------- */

function Section({ title, children }) {
  return (
    <section className="ui-panel fx-section reticle-ammo-section" aria-label={title}>
      {children}
    </section>
  );
}

const DAMAGE_PAGES = Object.freeze([
  { id: "colour", title: "Цвет" },
  { id: "look", title: "Вид" },
  { id: "place", title: "Где" },
  { id: "reset", title: "Сброс" },
  { id: "damage", title: "Урон стволов" },
]);

const labelOf = (list, id) => tr(list.find((item) => item.id === id)?.label || "");

/* Что стоит в разделе — подписью его строки на первой странице. */
function sectionCaptions(counter) {
  const missing = SCOPE_AND_WEAPONS.filter((weapon) => !previewDamage(counter, weapon.id)).length;
  return {
    colour:
      counter.colorMode === "rainbow"
        ? `${labelOf(DAMAGE_COLOR_MODES, "rainbow")} · ${counter.rainbowSpeed} ${tr("%")}`
        : counter.color,
    look: `${damageFont(counter.font).label} · ${counter.size}`,
    place: `${counter.x} · ${counter.y}`,
    reset: `${counter.resetSeconds} ${tr(DAMAGE_COUNTER_LIMITS.resetSeconds.unit)}${counter.resetOnKill ? ` · ${tr("после убийства")}` : ""}`,
    damage: `${tr(damageServer(counter.server).label)}${missing ? ` · ${tr("без числа")}: ${missing}` : ""}`,
  };
}

const SCOPE_WEAPONS = Object.freeze(
  RETICLE_SNIPERS.filter((weapon) => DAMAGE_SCOPE_WEAPONS.includes(weapon.id)),
);
const SCOPE_AND_WEAPONS = Object.freeze([...RETICLE_WEAPONS, ...SCOPE_WEAPONS]);

/* Числа выбранной таблицы: только показать, своих чисел здесь нет. */
function WeaponDamageList({ counter, weapons }) {
  return (
    <dl className="reticle-damage-weapons">
      {weapons.map((weapon) => {
        const value = previewDamage(counter, weapon.id);
        return (
          <div key={weapon.id} className="reticle-damage-weapon" data-damage-weapon={weapon.id}>
            <dt>{tr(weapon.label)}</dt>
            <dd>{value ? Math.round(value) : "—"}</dd>
          </div>
        );
      })}
    </dl>
  );
}

/* Откуда таблица: адрес и дата страницы. */
function sourceLine(server) {
  if (!server.source) return "";
  const line = server.updated
    ? tr("Источник: {source}. Страница обновлена {updated}, сверено {checked}.")
    : tr("Источник: {source}, страницы стволов. Сверено {checked}.");
  return line
    .replace("{source}", server.source)
    .replace("{updated}", server.updated || "")
    .replace("{checked}", server.checked);
}

/**
 * Панель инструмента «Счётчик урона». `onPatch(change, label, property)` —
 * правка счётчика (`change` — его поля), он один на все стволы.
 */
export function ReticleDamagePanel({ counter: input, onPatch, canShoot = true, onShot = null }) {
  useTr();
  const [page, setPage] = useState("");
  const counter = normalizeDamageCounter(input);
  const set = (field, label) => (value) => onPatch({ [field]: value }, label, field);
  const limit = (name) => DAMAGE_COUNTER_LIMITS[name];
  const slider = (name, field, history) => (
    <Slider
      editable
      label={tr(limit(name).label)}
      value={counter[field]}
      min={limit(name).min}
      max={limit(name).max}
      step={limit(name).step}
      unit={limit(name).unit ? tr(limit(name).unit) : undefined}
      onChange={set(field, tr(history))}
    />
  );
  const server = damageServer(counter.server);
  const files = server.id === FILES_DAMAGE_SERVER;

  function damagePage(id) {
    if (id === "colour")
      return (
        <Section title={tr("Цвет")}>
          <SegmentedControl
            label={tr("Цвет счётчика")}
            size="sm"
            value={counter.colorMode}
            onChange={set("colorMode", tr("Счётчик урона: цвет"))}
            options={DAMAGE_COLOR_MODES.map((item) => ({ value: item.id, label: tr(item.label), title: tr(item.note) }))}
          />
          {counter.colorMode === "rainbow" ? (
            slider("rainbowSpeed", "rainbowSpeed", "Счётчик урона: скорость перелива")
          ) : (
            <ColorField
              label={tr("Цвет числа")}
              value={counter.color}
              swatches={RETICLE_SWATCHES}
              editable
              onChange={set("color", tr("Счётчик урона: цвет"))}
            />
          )}
          {slider("opacity", "opacity", "Счётчик урона: прозрачность")}
        </Section>
      );
    if (id === "look")
      return (
        <Section title={tr("Вид")}>
          <ChoiceRadioGroup
            label={tr("Шрифт счётчика")}
            className="reticle-ammo-fonts"
            value={counter.font}
            onChange={set("font", tr("Счётчик урона: шрифт"))}
            options={AMMO_FONTS.map((item) => ({ value: item.id, title: item.label, description: item.note }))}
          />
          <GameFontsLink />
          {slider("size", "size", "Счётчик урона: размер")}
          {slider("outline", "outline", "Счётчик урона: обводка")}
          <Checkbox
            label={tr("Со знаком минус")}
            hint={tr("«-42» вместо «42»")}
            checked={counter.minus}
            onChange={set("minus", tr("Счётчик урона: знак минус"))}
          />
          <Checkbox
            label={tr("Толчок на попадание")}
            hint={tr("Число на миг становится крупнее")}
            checked={counter.bump}
            onChange={set("bump", tr("Счётчик урона: толчок"))}
          />
        </Section>
      );
    if (id === "place")
      return (
        <Section title={tr("Где")}>
          <p className="fx-hint">
            {tr("Перетащите число в кадре — или задайте точку в точках экрана 1280×720. Число стоит серединой в этой точке и не привязано к прицелу.")}
          </p>
          {slider("x", "x", "Счётчик урона: место")}
          {slider("y", "y", "Счётчик урона: место")}
        </Section>
      );
    if (id === "reset")
      return (
        <Section title={tr("Сброс")}>
          {slider("resetSeconds", "resetSeconds", "Счётчик урона: сброс")}
          <p className="fx-hint">{tr("Столько секунд без попаданий число держится и гаснет, потом сумма обнуляется.")}</p>
          <Checkbox
            label={tr("Сбросить после убийства")}
            hint={tr("Число дотлевает как обычно, а следующее попадание начинает новую сумму")}
            checked={counter.resetOnKill}
            onChange={set("resetOnKill", tr("Счётчик урона: сброс после убийства"))}
          />
        </Section>
      );
    if (id === "damage")
      return (
        <Section title={tr("Урон стволов")}>
          <p className="fx-hint is-open">
            {files
              ? tr("Кадр считает по чистой игре, а «Применить» берёт числа из файлов вашей игры.")
              : sourceLine(server)}
          </p>
          {files ? null : (
            <p className="fx-hint is-open">{tr("Прочерк — ствола нет в таблице, счётчик на нём молчит.")}</p>
          )}
          {RETICLE_WEAPON_GROUPS.map((group) => (
            <div key={group} className="reticle-damage-group" role="group" aria-label={tr(group)}>
              <h4 className="reticle-damage-group-title">{tr(group)}</h4>
              <WeaponDamageList counter={counter} weapons={RETICLE_WEAPONS.filter((weapon) => weapon.group === group)} />
            </div>
          ))}
          <div className="reticle-damage-group" role="group" aria-label={tr("Снайперские")}>
            <h4 className="reticle-damage-group-title">{tr("Снайперские")}</h4>
            <p className="fx-hint is-open">{tr("У снайперок значение по оптике: игра берёт прицел у насадки, одной на несколько стволов.")}</p>
            <WeaponDamageList counter={counter} weapons={SCOPE_WEAPONS} />
          </div>
          <p className="fx-hint is-open">
            {tr("Если файлы оружия не прочитаются, «Применить» всё равно поставит счётчик, но считать он будет по классу: одно число на все стволы класса, а нет числа — молчит.")}
          </p>
        </Section>
      );
    return null;
  }

  const open = DAMAGE_PAGES.find((item) => item.id === page);
  if (open)
    return (
      <PanelPage label={tr(open.title)} note={tr("Счётчик урона")} backLabel={tr("Счётчик урона")} onBack={() => setPage("")}>
        {damagePage(open.id)}
      </PanelPage>
    );
  const captions = sectionCaptions(counter);
  return (
    <>
      <section className="ui-panel fx-section reticle-ammo-head" aria-label={tr("Счётчик урона")}>
        <label className="ui-field reticle-toggle">
          <span>{tr("Счётчик в игре")}</span>
          <Switch
            checked={counter.enabled}
            label={counter.enabled ? tr("Убрать счётчик урона") : tr("Поставить счётчик урона")}
            onChange={(on) => onPatch({ enabled: on }, on ? tr("Счётчик урона включён") : tr("Счётчик урона выключен"), "enabled")}
          />
        </label>
        {counter.enabled ? null : (
          <p className="fx-hint reticle-ammo-off" role="status">
            {tr("Выключен: «Применить» поставит прицел без счётчика, а в кадре он бледный. Любая настройка ниже включит его.")}
          </p>
        )}
        {/* То же, что сообщает игра: попадание и убийство. */}
        <div className="reticle-ammo-actions">
          <Button
            variant="secondary"
            size="sm"
            icon={<Target />}
            title={tr("Показать, как число суммируется и сбрасывается")}
            disabled={!canShoot}
            onClick={() => onShot?.(false)}
          >
            {tr("Выстрел")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            title={tr("Попадание, которым игра сообщает об убийстве")}
            disabled={!canShoot}
            onClick={() => onShot?.(true)}
          >
            {tr("Убийство")}
          </Button>
        </div>
      </section>
      <section className="ui-panel fx-section reticle-ammo-section" aria-label={tr("Где работает")}>
        <h3 className="reticle-damage-group-title">{tr("Как считается")}</h3>
        <ChoiceRadioGroup
          label={tr("Сервер")}
          value={counter.server}
          onChange={set("server", tr("Счётчик урона: сервер"))}
          options={DAMAGE_SERVERS.map((item) => ({ value: item.id, title: tr(item.label), description: tr(item.note) }))}
        />
        {/* Честная подпись видна целиком: остальные пояснения панели свёрнуты в
            две строки, а эту нельзя не дочитать. */}
        <p className="fx-hint is-open">
          {files
            ? tr("Число — урон ствола из файлов оружия вашей игры. На GTA 5 RP и Majestic RP урон считает сервер, там эти числа неверны.")
            : tr("Игра сообщает прицелу только факт попадания, без размера урона. Поэтому число — база ствола по телу вблизи: по броне и по HP одной суммой.")}
        </p>
        <p className="fx-hint is-open">
          {tr("Голову, руки и ноги, дальность, резист и бронебойность игра прицелу не сообщает. Точное число каждого выстрела показывает только сервер.")}
        </p>
        {files ? null : (
          <>
            <p className="fx-hint is-open">{tr("Ствола нет в таблице — счётчик на нём молчит: чужое число он не подставляет.")}</p>
            <p className="fx-hint is-open">{sourceLine(server)}</p>
          </>
        )}
      </section>
      <section className="ui-panel fx-section reticle-ammo-pages" aria-label={tr("Настройки счётчика")}>
        <div className="fx-nav-rows">
          {DAMAGE_PAGES.map((item) => (
            <NavRow
              key={item.id}
              title={tr(item.title)}
              caption={captions[item.id]}
              data-damage-page={item.id}
              onOpen={() => setPage(item.id)}
            />
          ))}
        </div>
      </section>
    </>
  );
}
