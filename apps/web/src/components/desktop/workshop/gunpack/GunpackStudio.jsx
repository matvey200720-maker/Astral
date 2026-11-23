import Segmented from "../../../ui/SegmentedControl.jsx";
import { useRememberedState } from "../../../../section-memory.js";
import EditorActions from "../../../ui/EditorActions.jsx";
import { useTr, tr } from "../../../../locales/ui.js";
import { trFill } from "../../../../locales/tr-fill.js";
import EditorShell from "../../../ui/EditorShell.jsx";
import { useGunpackCatalog } from "./useGunpackCatalog.js";
import GunpackInstallPanel from "./GunpackInstallPanel.jsx";
import { useGunpackBuilder, composablePacks } from "./useGunpackBuilder.js";
import GunpackCatalogPanel from "./GunpackCatalogPanel.jsx";
import { useGunpackInstall } from "./useGunpackInstall.js";
import GunInspector from "../gun/GunInspector.jsx";
import {
  UploadSimple as UploadIcon,
  Storefront,
  SquaresFour as GridIcon,
  GameController,
  DownloadSimple as SaveIcon,
  Crosshair,
  Camera as CameraIcon,
} from "../../../ui/icons.jsx";
import Button from "../../../ui/Button.jsx";
import { useGunpackStudio, shotKey, coverKey } from "./useGunpackStudio.js";
import GunpackRail from "./GunpackRail.jsx";
import { BuilderRail, BuilderPanel } from "./GunpackBuilder.jsx";
import { WeaponPanel, ShotPanel, CoverPanel } from "./GunpackPanels.jsx";
import { loadWeaponModel } from "./gunpack-models.js";
import { trKey, fill, count } from "../gun/gun-copy.js";
import { createGunpackScene, SHOT_ANGLES } from "./gunpack-scene.js";
import { composeCollage, CATALOG_BACKGROUND } from "./collage.js";
import {
  useCallback,
  useEffect,
  useMemo,
  createElement,
  useState,
  useRef,
} from "react";

export default function GunpackStudio(props) {
  const {
    onExit,
    isAdmin = false,
    onNotice,
    initialPackId = "",
    onOpenEditor = null,
    onNavigate = null,
  } = props;

  const { studio, builder, install } = useStudioCore(initialPackId, onNotice);
  const choice = useSectionChoice(isAdmin);
  const look = useShotLook();
  const { canvasRef, sceneRef, sceneFailure } = useSceneHost(look);
  const ui = useStudioUi();
  const flow = useWeaponFlow(studio, builder, sceneRef, look.angle, ui);
  const { cover, composeCover } = useCoverFlow(studio, flow.models);
  const catalog = useGunpackCatalog({
    ...pickFrom(studio, ["pack", "variant", "shots", "saveShot"]),
    composeCover,
    onNavigate,
  });
  const drop = useDropHandlers(studio, ui.setDragging);

  /* Сцены нет: кадр не покажет ствол, поэтому «загрузка» и «готово» из потока показа не нужны — съёмка погашена, причина в кадре. */
  const view = sceneFailure ? viewOf("idle") : ui.view;
  const ctx = Object.assign(
    { view, sceneFailure, progress: ui.progress, dragging: ui.dragging },
    { studio, builder, install },
    { catalog, flow, look },
    { cover, composeCover },
    { choice, onExit, onOpenEditor },
  );

  const shellProps = {
    className: "gun-studio gunpack-studio",
    onBack: onExit,
    kicker: tr("Публикация"),
    title: tr("Ганпаки"),
    fit: "window",
    status: statusLine(ctx),
    actions: actionsFor(ctx),
    rail: railFor(ctx),
    inspector: inspectorFor(ctx),
  };
  return createElement(EditorShell, shellProps, createElement(Workspace, { ctx, canvasRef, drop }));
}

/* ---------- хуки верхнего уровня ---------- */

function useStudioCore(initialPackId, onNotice) {
  useTr();
  const studio = useGunpackStudio({ initialPackId });
  const { packs, adopt, pack, variant, setInstalled } = studio;
  const builder = useGunpackBuilder({ packs, onSaved: adopt });
  const install = useGunpackInstall({ pack, variant, onInstalled: setInstalled, onNotice });
  return { studio, builder, install };
}

// три независимых useState: запись равного значения перерисовку не вызывает
function useStudioUi() {
  const [view, progress, dragging] = [
    useState({ status: "idle", message: "" }),
    useState(null),
    useState(false),
  ];
  return {
    view: view[0],
    setView: view[1],
    progress: progress[0],
    setProgress: progress[1],
    dragging: dragging[0],
    setDragging: dragging[1],
  };
}

function useSectionChoice(isAdmin) {
  const slot = useRememberedState("gunpack:section", "weapon");
  const sections = !isAdmin ? SECTIONS : CURATOR_SECTIONS;
  const known = sections.find((item) => item.id === slot[0]);
  return { sections, section: known ? known.id : "weapon", setSection: slot[1] };
}

function useShotLook() {
  const [angle, background, light] = [
    useRememberedState("gunpack:angle", "profile"),
    useRememberedState("gunpack:background", "grey"),
    useRememberedState("gunpack:light", "studio"),
  ];
  return {
    angle: angle[0],
    setAngle: angle[1],
    background: background[0],
    setBackground: background[1],
    light: light[0],
    setLight: light[1],
  };
}

/* ---------- сцена ---------- */

function useSceneHost({ angle, background, light }) {
  const canvasRef = useRef(null);
  const sceneRef = useRef(null);
  const [sceneFailure, setSceneFailure] = useState(false);

  useEffect(() => bindScene(canvasRef, sceneRef, setSceneFailure), []);

  useSceneSetting(sceneRef, "setAngle", angle);
  useSceneSetting(sceneRef, "setBackground", background);
  useSceneSetting(sceneRef, "setLighting", light);

  return { canvasRef, sceneRef, sceneFailure };
}

/* Контекст WebGL не создался (видеокарта отказала, окон со сценой слишком много): студия остаётся рабочей без кадра, причина — в кадре. */
function bindScene(canvasRef, sceneRef, onFailure) {
  let scene;
  try {
    scene = createGunpackScene(canvasRef.current);
  } catch {
    sceneRef.current = null;
    onFailure(true);
    return undefined;
  }
  sceneRef.current = scene;
  onFailure(false);
  const release = () => {
    sceneRef.current = null;
    scene.dispose();
  };
  return release;
}

function useSceneSetting(sceneRef, method, value) {
  useEffect(() => {
    sceneRef.current?.[method](value);
  }, [sceneRef, method, value]);
}

/* ---------- показ и съёмка стволов ---------- */

function useWeaponFlow(studio, builder, sceneRef, angle, ui) {
  const { view, setView, setProgress } = ui;
  const pack = studio.pack;
  const { variant, weapon, shots } = studio;
  // stop — просьба прервать серию, token — номер последней загрузки, length — длина ствола в кадре
  const flags = useRef({ stop: false, batching: false, token: 0, length: 0 });

  const showWeapon = useCallback(
    (target, packId = pack?.id) =>
      presentWeapon({ flags, sceneRef, setView, angle }, target, packId),
    [pack?.id, angle, sceneRef, setView],
  );

  useEffect(() => {
    if (flags.current.batching || builder.open || !pack || !weapon) return;
    if (weapon.kind !== "parts") {
      showWeapon(weapon);
      return;
    }
    sceneRef.current?.clear();
    setView(viewOf("failed", tr("У этого ствола в паке только детали — показать нечего.")));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- модель меняется от выбора ствола, а не от смены ракурса
  }, [builder.open, pack?.id, variant?.key, weapon?.model]);

  // в сборке в кадре выбранная версия ствола, пока выбора нет — первая
  const shown = (builder.open && builder.shown) || null;
  useEffect(() => {
    if (!shown) return;
    showWeapon(shown.weapon, shown.packId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- версия меняется выбором, а не сменой ракурса
  }, [shown?.packId, shown?.variantKey, shown?.weapon?.model]);

  const models = useMemo(() => weaponsOf(variant).filter(isShowable), [variant]);
  let shotCount = 0;
  for (const item of models) {
    if (frameFor(shots, variant, item)) shotCount += 1;
  }

  const shoot = useCallback(
    async function shoot() {
      if (view.status !== "ready" || !weapon || !sceneRef.current) return;
      const key = shotKey(variant, weapon.model);
      try {
        await storeSnapshot(sceneRef.current, studio, key, flags.current.length);
      } catch (error) {
        reportFailure(studio, error);
      }
    },
    [studio, variant, weapon, view.status, sceneRef],
  );

  const shootAll = useCallback(
    async function shootAll() {
      const origin = weapon?.model;
      if (!models.length || !sceneRef.current) return;
      flags.current.stop = false;
      flags.current.batching = true;
      try {
        await shootEach({ models, studio, variant, showWeapon, sceneRef, flags, setProgress });
      } catch (error) {
        reportFailure(studio, error);
      } finally {
        flags.current.batching = false;
        setProgress(null);
        const back = models.find(byModel(origin));
        if (back) restoreSelection(studio, showWeapon, back);
      }
    },
    [models, showWeapon, studio, variant, weapon?.model, sceneRef, setProgress],
  );

  const stop = () => {
    flags.current.stop = true;
  };

  return { models, shotCount, shoot, shootAll, stop };
}

async function presentWeapon({ flags, sceneRef, setView, angle }, target, packId) {
  /* Нет сцены (контекст WebGL не создался) — показывать некуда, модель зря не разбираем. */
  if (!sceneRef.current) return false;
  const ticket = (flags.current.token += 1);
  const outdated = () => ticket !== flags.current.token;
  const options = { maxTexture: 2048 };
  setView(viewOf("loading"));
  try {
    const parsed = await loadWeaponModel(packId, target, options);
    if (!outdated()) {
      placeModel(sceneRef.current, parsed, angle, flags);
      setView(viewOf("ready"));
      return true;
    }
  } catch (error) {
    if (!outdated()) {
      sceneRef.current?.clear();
      setView(viewOf("failed", errorText(error)));
    }
  }
  return false;
}

function placeModel(scene, parsed, angle, flags) {
  flags.current.length = scene?.setModel(parsed)?.length || 0;
  scene?.setAngle(angle);
}

async function shootEach({ models, studio, variant, showWeapon, sceneRef, flags, setProgress }) {
  const total = models.length;
  for (const [done, target] of models.entries()) {
    if (flags.current.stop) break;
    setProgress({ done, total, name: target.name });
    studio.setModel(target.model);
    const loaded = await showWeapon(target);
    if (!loaded) continue;
    const key = shotKey(variant, target.model);
    await storeSnapshot(sceneRef.current, studio, key, flags.current.length);
  }
}

function restoreSelection(studio, showWeapon, back) {
  studio.setModel(back.model);
  showWeapon(back);
}

async function storeSnapshot(scene, studio, key, length) {
  const bytes = scene.snapshot(transparent());
  await studio.saveShot(key, bytes, { length });
}

/* ---------- обложка ---------- */

function useCoverFlow(studio, models) {
  const { variant, shots } = studio;
  const cover = !variant ? null : shots[coverKey(variant)];

  const composeCover = useCallback(
    async function composeCover() {
      const cut = models.flatMap((item) => frameFor(shots, variant, item) || []);
      if (!cut.length) return;
      try {
        await renderCover(studio, variant, cut.sort(longestFirst));
      } catch (error) {
        reportFailure(studio, error);
      }
    },
    [models, shots, studio, variant],
  );

  return { cover, composeCover };
}

async function renderCover(studio, variant, frames) {
  const options = { backgroundId: CATALOG_BACKGROUND };
  const bytes = await composeCollage(frames, options);
  const key = coverKey(variant);
  await studio.saveShot(key, bytes);
}

/* ---------- перетаскивание файлов ---------- */

function useDropHandlers(studio, setDragging) {
  const onDrop = useCallback(
    (event) => {
      event.preventDefault();
      setDragging(false);
      const files = Array.from(event.dataTransfer?.files || []);
      if (!files.length) return;
      studio.accept({ files });
    },
    [studio, setDragging],
  );

  return {
    onDragOver: (event) => {
      event.preventDefault();
      setDragging(true);
    },
    onDragLeave: (event) => {
      if (event.currentTarget.contains(event.relatedTarget)) return;
      setDragging(false);
    },
    onDrop,
  };
}

/* ---------- разметка ---------- */

function Workspace({ ctx, canvasRef, drop }) {
  const lifted = ctx.dragging ? " is-dragging" : "";
  return createElement(
    "div",
    { className: `gun-workspace gunpack-workspace${lifted}`, ...drop },
    createElement("div", { className: "gun-stage" }, createElement(Viewport, { ctx, canvasRef })),
    createElement(Shelf, { ctx }),
  );
}

function Viewport({ ctx, canvasRef }) {
  const { studio, view, look } = ctx;
  const { pack, weapon } = studio;
  const tone = view.status === "ready" ? ` is-${look.background}` : "";
  const named = { name: weapon?.name };
  const caption = weapon ? fill(tr("Ствол: {name}"), named) : tr("Кадр ствола");

  return createElement(
    "div",
    { className: `gun-viewport gunpack-viewport${tone}` },
    createElement("canvas", { ref: canvasRef, "aria-label": caption }),
    when(!pack && !studio.busy, () => createElement(DropInvite, { studio })),
    when(studio.busy || view.status === "loading", () =>
      createElement("span", { className: "gun-loading" }, studio.busy || tr("Открываю модель…")),
    ),
    when(ctx.sceneFailure, () =>
      createElement(
        "p",
        { className: "gun-failure", role: "alert" },
        trFill("3D-кадр недоступен: {0}", tr("Видеокарта не дала WebGL2 — обновите драйвер видеокарты.")),
      ),
    ),
    when(studio.error || view.status === "failed", () => createElement(FailureNote, { studio, view })),
    when(ctx.dragging, () =>
      createElement(
        "div",
        { className: "gunpack-drop-veil", "aria-hidden": "true" },
        tr("Отпустите — Astral разберёт пак"),
      ),
    ),
  );
}

function DropInvite({ studio }) {
  const choose = studio.available
    ? createElement(
        Button,
        { variant: "primary", size: "sm", icon: createElement(UploadIcon), onClick: studio.choose },
        tr("Выбрать файлы"),
      )
    : null;
  return createElement(
    "div",
    { className: "gun-empty-stage gunpack-drop", role: "note" },
    createElement("b", null, tr("Бросьте сюда ганпак")),
    createElement(
      "span",
      null,
      tr(
        "Архив из Discord (.rar, .zip, .7z), dlc.rpf, .oiv или папку со стволами. Astral найдёт модели, назовёт стволы и покажет их в 3D — как в OpenIV, только сразу весь пак.",
      ),
    ),
    choose,
  );
}

function FailureNote({ studio, view }) {
  const headline = !studio.error ? tr("Модель не открылась") : tr("Не получилось");
  return createElement(
    "p",
    { className: "gun-failure", role: "alert" },
    createElement("b", null, headline),
    createElement("span", null, tr(studio.error || view.message)),
  );
}

function Shelf({ ctx }) {
  const { flow, look, builder, view, progress } = ctx;
  const angles = Array.from(SHOT_ANGLES, ({ id, label }) => ({ value: id, label: tr(label) }));
  const locked = view.status !== "ready" || Boolean(progress);
  const camera = builder.open
    ? null
    : createElement(
        Button,
        { variant: "primary", size: "sm", icon: createElement(CameraIcon), disabled: locked, onClick: flow.shoot },
        tr("Снять кадр"),
      );

  return createElement(
    "div",
    { className: "gunpack-shelf" },
    createElement(Segmented, {
      label: tr("Ракурс"),
      size: "sm",
      value: look.angle,
      options: angles,
      onChange: look.setAngle,
    }),
    camera,
  );
}

function actionsFor({ onExit, studio, install, builder }) {
  if (builder.open) {
    return createElement(EditorActions, {
      apply: readFields(BUILD_APPLY_FIELDS, builder),
      onCancel: builder.cancel,
      cancelLabel: tr("Отмена"),
    });
  }
  const { weapon, variant, shots } = studio;
  const shotFile = weapon && frameFor(shots, variant, weapon);
  return createElement(EditorActions, {
    apply: install.action,
    more: [
      {
        value: "shot-file",
        label: tr("Сохранить кадр ствола файлом"),
        icon: createElement(SaveIcon),
        disabled: !shotFile,
      },
    ],
    onMore: (action) => saveShotFile(action, studio),
    onCancel: onExit,
    cancelLabel: tr("Закрыть"),
  });
}

function saveShotFile(action, { weapon, variant, shots }) {
  const shot = action === "shot-file" && weapon ? frameFor(shots, variant, weapon) : null;
  if (shot) download(shot.bytes, `${weapon.model}.png`);
}

function railFor({ builder, studio }) {
  if (builder.open) return createElement(BuilderRail, { builder });
  const { pack } = studio;
  return createElement(GunpackRail, {
    ...pickFrom(studio, ["packs", "pack", "variant", "weapon", "shots"]),
    ...wire(studio, RAIL_WIRING),
    onCompose: composablePacks(studio.packs).length ? starter(builder) : null,
    onEditComposition: pack?.composed ? starter(builder, pack) : null,
  });
}

function inspectorFor(ctx) {
  const { builder, install, onOpenEditor, choice, flow } = ctx;
  if (builder.open) {
    const onTracer = onOpenEditor ? tracerOpener(onOpenEditor) : null;
    return createElement("div", { className: "gun-inspector" }, createElement(BuilderPanel, { builder, onTracer }));
  }
  const makePanel = PANEL_BUILDERS.get(choice.section) ?? weaponPanel;
  const installed = install.installed?.models?.length || 0;
  return createElement(
    GunInspector,
    {
      items: choice.sections,
      section: choice.section,
      onSection: choice.setSection,
      counts: { shot: flow.shotCount, install: installed },
    },
    makePanel(ctx),
  );
}

/* ---------- панели разделов ---------- */

function weaponPanel({ studio }) {
  const { pack, variant, weapon } = studio;
  const lookKey = weapon && shotKey(variant, weapon.model);
  return createElement(WeaponPanel, {
    weapon,
    variant,
    look: weapon ? pack?.looks?.[lookKey] || "" : "",
    onLook: weapon ? (value) => studio.setLook(lookKey, value) : null,
  });
}

function coverDownloader({ cover, studio }) {
  return () => {
    if (!cover) return;
    const title = studio.pack?.name || tr("ганпак");
    download(cover.bytes, fill(tr("{name} — обложка.png"), { name: title }));
  };
}

/* ---------- строка состояния ---------- */

function statusLine(ctx) {
  const [, compose] = STATUS_RULES.find(([applies]) => applies(ctx));
  return compose(ctx);
}

function builderSummary({ builder }) {
  const name = builder.name || tr("без имени");
  return fill(tr("Своя сборка «{name}» · взято стволов {n}"), { name, n: builder.picked });
}

function packSummary({ studio, flow }) {
  const { pack } = studio;
  const forms = trKey("ствол|ствола|стволов");
  const parts = [
    pack.name,
    count(flow.models.length, forms),
    !flow.shotCount ? tr("кадров нет") : fill(tr("кадров {n}"), { n: flow.shotCount }),
  ];
  const tail = pack.installed ? [tr("в игре")] : [];
  return [...parts, ...tail].join(" · ");
}

/* ---------- мелочи ---------- */

function when(condition, make) {
  return condition ? make() : null;
}

function download(bytes, name) {
  const blob = new Blob([bytes], { type: "image/png" });
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  const release = () => URL.revokeObjectURL(url);
  setTimeout(release, 1000);
}

function reportFailure(studio, error) {
  studio.setError(errorText(error));
}

const pickFrom = (source, keys) => Object.fromEntries(keys.map((key) => [key, source[key]]));
const wire = (source, table) =>
  Object.fromEntries(table.map(([prop, member]) => [prop, source[member]]));
const readFields = (table, source) =>
  Object.fromEntries(table.map(([prop, read]) => [prop, read(source)]));
const starter =
  (builder, ...args) =>
  () =>
    builder.start(...args);
const tracerOpener = (open) => (weapon) => {
  const request = { slotId: "tracers", variant: { weapon } };
  return open(request);
};
const frameFor = (shots, variant, item) => shots[shotKey(variant, item.model)];
const transparent = () => ({ backgroundId: "transparent" });
const viewOf = (status, message = "") => ({ status, message });
const errorText = (error) => String(error?.message || error);
const weaponsOf = (variant) => variant?.weapons || [];
const isShowable = (item) => item.kind !== "parts";
const byModel = (model) => (item) => item.model === model;
const lengthOf = (frame) => frame.length || 0;
const longestFirst = (left, right) => lengthOf(right) - lengthOf(left);
const makeSection = (id, label, icon) => ({ id, label, icon });

/* ---------- таблицы ---------- */

const SECTIONS = Object.freeze([
  makeSection("weapon", trKey("Ствол"), Crosshair),
  makeSection("shot", trKey("Кадр"), CameraIcon),
  makeSection("cover", trKey("Обложка"), GridIcon),
  makeSection("install", trKey("В игру"), GameController),
]);

const CURATOR_SECTIONS = Object.freeze([
  ...SECTIONS,
  makeSection("catalog", trKey("Каталог"), Storefront),
]);

const RAIL_WIRING = [
  ["onChoose", "choose"],
  ["onSelectPack", "select"],
  ["onForgetPack", "forget"],
  ["onVariant", "setVariantKey"],
  ["onWeapon", "setModel"],
];

const BUILD_APPLY_FIELDS = [
  ["label", () => tr("Сохранить сборку")],
  ["onClick", (builder) => () => void builder.save()],
  ["disabled", (builder) => (builder.picked ? !builder.name.trim() : true)],
  ["busy", (builder) => (builder.saving ? tr("Сохраняю…") : "")],
  [
    "title",
    (builder) =>
      builder.picked ? tr("Сборка ляжет в «Мои паки»") : tr("Возьмите хотя бы один ствол"),
  ],
];

const SHOT_PANEL_FIELDS = [
  ["background", (c) => c.look.background],
  ["onBackground", (c) => c.look.setBackground],
  ["light", (c) => c.look.light],
  ["onLight", (c) => c.look.setLight],
  ["onShoot", (c) => c.flow.shoot],
  ["onShootAll", (c) => c.flow.shootAll],
  ["onStop", (c) => c.flow.stop],
  ["progress", (c) => c.progress],
  ["canShoot", (c) => c.view.status === "ready"],
  ["shotCount", (c) => c.flow.shotCount],
  ["weaponCount", (c) => c.flow.models.length],
];

const COVER_PANEL_FIELDS = [
  ["cover", (c) => c.cover],
  ["ready", (c) => c.flow.shotCount > 0],
  ["missing", (c) => c.flow.models.length - c.flow.shotCount],
  ["onCompose", (c) => c.composeCover],
  ["onDownload", coverDownloader],
];

const STATUS_RULES = [
  [({ studio }) => studio.busy, ({ studio }) => studio.busy],
  [({ builder }) => builder.open, builderSummary],
  [({ studio }) => studio.pack, packSummary],
  [
    ({ studio }) => studio.available,
    () => tr("Бросьте сюда ганпак из Discord — архив, dlc.rpf или папку"),
  ],
  [() => true, () => tr("Разбор ганпаков работает в приложении Astral")],
];

const PANEL_BUILDERS = new Map([
  [
    "catalog",
    ({ catalog, flow }) => createElement(GunpackCatalogPanel, { catalog, onShootAll: flow.shootAll }),
  ],
  [
    "install",
    ({ studio, install }) =>
      createElement(GunpackInstallPanel, { ...pickFrom(studio, ["variant", "shots"]), install }),
  ],
  ["shot", (ctx) => createElement(ShotPanel, readFields(SHOT_PANEL_FIELDS, ctx))],
  ["cover", (ctx) => createElement(CoverPanel, readFields(COVER_PANEL_FIELDS, ctx))],
]);
