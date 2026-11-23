import * as icons from "../../../ui/icons.jsx";
import Button from "../../../ui/Button.jsx";
import { tr, useTr } from "../../../../locales/ui.js";
import SegmentedControl from "../../../ui/SegmentedControl.jsx";
import { count, fill, ctx, tl, trKey } from "../gun/gun-copy.js";
import { createElement as h, useEffect, useState } from "react";
import TextField from "../../../ui/TextField.jsx";
import * as scene from "./gunpack-scene.js";
import * as checkCopy from "./gunpack-check-copy.js";
import * as roles from "@modovik/gunpack/roles";


// Три панели правой колонки студии. Что показывать и делать — приходит свойствами.

export function WeaponPanel(props) {
  useTr();
  return props.weapon ? fullPanel(props) : tag("section", "gun-panel", note(tr("Выберите ствол слева.")));
}

export function ShotPanel(props) {
  useTr();
  const running = Boolean(props.progress);
  const shoot = button("primary", { icon: h(icons.Camera), disabled: !props.canShoot || running, onClick: props.onShoot }, tr("Снять кадр"));
  const other = running
    ? button("secondary", { icon: h(icons.StopCircle), onClick: props.onStop }, tr("Остановить"))
    : button("secondary", { disabled: !props.canShoot, onClick: props.onShootAll }, tr("Снять все стволы"));
  return tag(
    "section",
    "gun-panel",
    titled(icons.Camera, tr("Кадр ствола")),
    note(tr("Кадр — рендер модели из пака, а не снимок из игры: так он и подписан в каталоге. Ракурс — под кадром; ствол вписывается в кадр сам.")),
    ...chooser(tr("Фон"), props.background, props.onBackground, scene.SHOT_BACKGROUNDS.filter(isPlain)),
    ...chooser(tr("Свет"), props.light, props.onLight, scene.SHOT_LIGHTS),
    tag("div", "gun-row", shoot, other),
    h("p", { className: "gun-hint", "aria-live": "polite" }, shotStatus(props)),
  );
}

export function CoverPanel(props) {
  useTr();
  const { cover, missing } = props;
  const lacking = missing > 0 ? lackingNote(missing) : null;
  const compose = button("primary", { disabled: !props.ready, onClick: props.onCompose }, cover ? tr("Собрать заново") : tr("Собрать обложку"));
  const save = button("secondary", { icon: h(icons.DownloadSimple), disabled: !cover, onClick: props.onDownload }, tr("Сохранить файлом"));
  return tag(
    "section",
    "gun-panel",
    titled(icons.SquaresFour, tr("Обложка пака")),
    note(tr("Все стволы пака одним листом — как в постах ганпаков. Собирается из кадров стволов без подложки: в каталоге лист ложится прямо на плитку.")),
    coverPicture(cover),
    lacking,
    tag("div", "gun-row", compose, save),
  );
}

/* ---------- общие узлы ---------- */

function tag(name, className, ...kids) {
  return h(name, className ? { className } : null, ...kids);
}

const note = (...kids) => tag("p", "gun-hint", ...kids);

const titled = (Glyph, text) => h("h2", null, h(Glyph), " ", text);

const button = (variant, extra, label) => h(Button, { variant, size: "sm", ...extra }, label);

// Заголовок и сегменты выбора; без обработчика щелчок молчит.
function chooser(name, current, notify, source) {
  const options = source.map(toSegment);
  const onChange = (id) => notify?.(id);
  return [tag("h3", "", name), h(SegmentedControl, { label: name, size: "sm", value: current, options, onChange })];
}

function toSegment(item) {
  return { label: tr(item.label), value: item.id };
}

const isPlain = (item) => !item.matte;

function shotStatus(props) {
  const { progress } = props;
  const template = progress ? tr("Снимаю {n} из {total}: {name}") : tr("Кадры есть у {n} из {total} стволов.");
  const values = progress
    ? { n: progress.done + 1, total: progress.total, name: progress.name }
    : { n: props.shotCount, total: props.weaponCount };
  return fill(template, values);
}

function coverPicture(cover) {
  if (!cover) return tag("div", "gunpack-cover is-empty", tr("Обложки ещё нет"));
  return h("img", { className: "gunpack-cover", alt: tr("Обложка пака"), src: cover.url });
}

function lackingNote(missing) {
  const what = count(missing, trKey("ствол|стволов|стволов"));
  const text = tr("Без кадра {what} — в обложку войдут только снятые. «Снять все стволы» в «Кадре» доснимет их.");
  return note(fill(text, { what }));
}

/* ---------- панель ствола ---------- */

function fullPanel({ weapon, variant, look, onLook }) {
  const ownLook = look === undefined ? "" : look;
  const editable = onLook && weapon.kind !== "parts";
  return tag(
    "section",
    "gun-panel gunpack-weapon-panel",
    headerOf(weapon),
    editable ? h(LookField, { look: ownLook, model: weapon.model, onLook }) : null,
    tag("h3", "", tr("Проверка")),
    checksOf(weapon),
    ...statsOf(weapon.stats),
    tag("h3", "", tr("Файлы ствола")),
    filesOf(weapon),
    dlcNote(variant),
  );
}

function shelfLine({ subcategory }) {
  if (!subcategory) return tr("Своей полки в каталоге у этого ствола нет — он будет только в паке.");
  return fill(tr("В каталоге: Скины → {name}"), { name: subcategory });
}

function headerOf(weapon) {
  const slang = weapon.slang?.length > 0 ? tag("span", "gunpack-slang", weapon.slang.map(slangWord)) : null;
  return tag(
    "header",
    "gunpack-weapon-head",
    h("h2", null, weapon.name),
    h("p", null, slang, tag("code", "", weapon.model)),
    note(shelfLine(weapon)),
  );
}

const slangWord = (word) => h("em", { key: `${word}` }, word);

function checksOf(weapon) {
  const ranked = weapon.checks ? [...weapon.checks].sort(byGravity) : [];
  return ranked.length ? tag("ul", "gunpack-checks", ranked.map(checkRow)) : note(tr("Замечаний нет: модель, текстуры и _hi на месте."));
}

const byGravity = (a, b) => GRAVITY.indexOf(a.severity) - GRAVITY.indexOf(b.severity);

function checkRow(check, index) {
  const look = LOOKS[check.severity] ?? LOOKS.info;
  const mark = h(look.glyph, { weight: "fill", "aria-label": tr(look.hint) });
  return h("li", { key: index, className: `is-${check.severity}` }, mark, tag("span", "", checkCopy.checkMessage(check.message)));
}

function statsOf(stats) {
  if (!stats) return [];
  const rows = [];
  const add = (name, value) => rows.push(h("div", { key: name }, h("dt", null, name), h("dd", null, value)));
  add(tr("Вершины"), thousands(stats.vertices));
  add(tr("Треугольники"), thousands(stats.triangles));
  add(tr("В памяти игры"), sizeLabel(stats.memory));
  add(tr("Текстуры"), textureCell(stats));
  return [tag("h3", "", tr("Модель")), tag("dl", "gunpack-stats", rows)];
}

function textureCell(stats) {
  if (!stats.textures.length) return tr("нет");
  return stats.textures.slice(0, UNITS.textures).map(textureSpan);
}

function textureSpan(texture, index) {
  const lead = index > 0 ? ", " : null;
  return h("span", { key: index }, lead, texture.width, "² ", tag("code", "", texture.format));
}

function filesOf(weapon) {
  return tag("ul", "gunpack-files", weapon.files.map(fileRow));
}

function fileRow(file) {
  const role = roleLabel(file.role);
  const name = h("code", { title: file.path }, file.name);
  return h("li", { key: file.path }, tag("span", "", role), name, tag("small", "", sizeLabel(file.size)));
}

function roleLabel(role) {
  switch (role) {
    case "magazine":
      return tl(ctx("magazine"));
    default:
      return tr(roles.ROLE_LABELS[role] ?? role);
  }
}

function dlcNote(variant) {
  const known = variant?.dlcpacks?.length > 0;
  if (!known) return null;
  const text = tr("Автор собирал пак под {list}. Astral ставит стволы отдельным DLC и этот патчдей не трогает.");
  return note(fill(text, { list: variant.dlcpacks.join(", ") }));
}

// Поле «Чем заменён»: своя копия строки, сброс на look — отдельным эффектом после отрисовки.
function LookField(props) {
  useTr();
  const { look, model, onLook } = props;
  const [text, setText] = useDraft(look, model);
  function commit() {
    const changed = text.trim() !== look;
    if (changed) onLook(text);
  }
  const onKey = (event) => {
    switch (event.key) {
      case "Enter":
        event.preventDefault();
        commit();
        break;
      default:
    }
  };
  return h(TextField, {
    label: tr("Чем заменён"),
    value: text,
    onChange: setText,
    placeholder: tr("Например, USP-S или AWM"),
    maxLength: UNITS.lookChars,
    hint: tr("Строка таблицы «ствол → модель» на странице пака в каталоге."),
    onBlur: commit,
    onKeyDown: onKey,
  });
}

function useDraft(look, model) {
  const [text, setText] = useState(look);
  useEffect(
    function resync() {
      setText(look);
    },
    [model, look],
  );
  return [text, setText];
}

/* ---------- числа в слова ---------- */

function thousands(value) {
  if (!(value >= UNITS.thousand)) return String(value);
  return `${Math.round(value / UNITS.thousand)} ${tr("тыс.")}`;
}

const kiloText = (bytes) => `${Math.max(1, Math.round(bytes / UNITS.kilo))} ${tr("КБ")}`;

function megaText(bytes) {
  const digits = bytes >= UNITS.wholeMega ? 0 : 1;
  return `${(bytes / UNITS.mega).toFixed(digits)} ${tr("МБ")}`;
}

const sizeLabel = (bytes) => (bytes < UNITS.mega ? kiloText(bytes) : megaText(bytes));

/* ---------- таблицы ---------- */

const UNITS = { kilo: 1024, mega: 1048576, wholeMega: 10485760, thousand: 1000, lookChars: 60, textures: 3 };

// Порядок строгости: неизвестная идёт первой.
const GRAVITY = ["block", "warn", "info"];

// Значок и подпись по строгости; для неизвестной берётся «info».
const LOOKS = Object.fromEntries(
  [
    ["block", icons.XCircle, "Ставить нельзя"],
    ["warn", icons.WarningCircle, "Стоит знать"],
    ["info", icons.Info, "Для сведения"],
  ].map(([severity, glyph, hint]) => [severity, { glyph, hint }]),
);
