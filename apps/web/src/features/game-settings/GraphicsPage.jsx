// Страница «Графика»: полка готовых шаблонов и комната редактора на каркасе EditorShell
// (ТЗ 05.10.2026, задача 15; кнопки в шапке — решение владельца 06.10.2026).
// Листовая разметка (строки параметров, плитки, карточки) собрана вызовами h = createElement,
// каркас и органы страницы — JSX.
import { createElement, useCallback, useEffect, useState } from "react";
import {
  ArrowCounterClockwise as UndoIcon,
  FloppyDisk as DiskIcon,
  Plus as PlusIcon,
  SlidersHorizontal as TuneIcon,
  Trash as TrashIcon,
} from "../../components/ui/icons.jsx";
import {
  GRAPHICS_EXTRA_KEYS,
  GRAPHICS_GROUPS,
  GRAPHICS_PARAMETERS,
  estimateGraphicsVram,
  graphicsBelowMinimum,
  graphicsDetail,
  graphicsTemplate,
  graphicsValuesFrom,
  samplingModeFor,
  samplingScale,
} from "@modovik/optimizer/graphics.js";
import Slider from "../../components/ui/Slider.jsx";
import Switch from "../../components/ui/Switch.jsx";
import Button from "../../components/ui/Button.jsx";
import Dialog from "../../components/ui/Dialog.jsx";
import TextField from "../../components/ui/TextField.jsx";
import ChoiceTile from "../../components/ui/ChoiceTile.jsx";
import EditorShell from "../../components/ui/EditorShell.jsx";
import PageHeading from "../../components/ui/PageHeading.jsx";
import EditorActions from "../../components/ui/EditorActions.jsx";
import SegmentedControl from "../../components/ui/SegmentedControl.jsx";
import ChoiceRadioGroup from "../../components/ui/ChoiceRadioGroup.jsx";
import {
  applyGameSettings,
  hasGameSettingsBridge,
  readGameSettings,
  restoreGameSettings,
  sanitizeDesktopErrorMessage,
} from "../../api.js";
import { useRememberedScroll, useRememberedState } from "../../section-memory.js";
import MouseSection from "./MouseSection.jsx";
import { tr } from "../../locales/ui.js";
import { useRecommendation } from "./use-hardware.js";
import {
  graphicsCopyFor,
  graphicsLocale,
  graphicsTemplateText,
} from "./graphics-copy.js";
import { refreshServerTemplates, useServerTemplates } from "./graphics-remote.js";
import {
  deleteOwnTemplate,
  graphicsShelf,
  saveOwnTemplate,
  templateBars,
  templateMatches,
  useOwnTemplates,
} from "./graphics-store.js";

const BASE_ID = "astral-medium";
const pct = (x) => Math.round(x * 100);
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const diffCount = (a, b, keys) => keys.filter((k) => a[k] !== b[k]).length;

// Масштаб кадра — номер строки меню игры, доля 50–100 % считается через samplingScale.
// У ползунков (scale, share) есть to/from; класс строки по умолчанию is-share.
const KINDS = {
  scale: {
    step: 1,
    to: samplingScale,
    from: (n) => samplingModeFor(n / 100),
    odd: (v, ed) => samplingScale(v) > 1 && ed.supersampling(`${pct(samplingScale(v))} %`),
  },
  share: {
    step: 5,
    to: (v) => v,
    from: (n) => n / 100,
    odd: (v, ed, p) => (v < p.min || v > p.max) && ed.specialValue(v),
  },
  toggle: {
    cls: "is-toggle",
    ctl: (p, v, i, set) => createElement(Switch, { key: "c", checked: !!v, label: p.label[i], onChange: set }),
    // «Вкл./Выкл.» в заметке «в игре» — пара [ru, en] по номеру подписи, как и подписи пакета.
    say: (g, i) => (g ? ["Вкл.", "On"] : ["Выкл.", "Off"])[i],
  },
  level: {
    cls: "is-level",
    ctl: (p, v, i, set) =>
      createElement(SegmentedControl, {
        key: "c",
        size: "sm",
        value: v,
        label: p.label[i],
        onChange: set,
        options: p.options.map(({ value, label }) => ({ value, label: label[i] })),
      }),
    say: (g, i, p) => p.options.find((o) => o.value === g)?.label[i] ?? String(g),
  },
};

const SECTIONS = GRAPHICS_GROUPS.map((g) => [g, GRAPHICS_PARAMETERS.filter(({ group }) => group === g.id)]);
const BLURBS = {
  astral: (t) => t.note,
  community: (t, copy) => `${t.note} · ${copy.author(t.author)}`,
  own: (t, copy) => copy.basedOn(t.note),
};

// Вторая полка: сначала свои шаблоны, потом шаблоны игроков.
function tilesOf(all, id) {
  const mine = id === "community" ? all.filter((t) => t.own) : [];
  return mine.concat(all.filter((t) => !t.own && t.group === id));
}

// Подписи готовых шаблонов на uk/de/pl/fr берутся из словаря страницы; серверные приходят уже на языке окна.
function relabel(t, language) {
  const text = t.remote ? null : graphicsTemplateText(language, t.own ? t.base : t.id);
  if (!text) return t;
  return Object.assign({}, t, t.own ? { note: text.label } : { label: text.label, note: text.level });
}

function screenOf(game) {
  const { width, height } = game?.screen ?? {};
  return { ScreenWidth: width || 1920, ScreenHeight: height || 1080 };
}
const vramText = (copy, game, values) => copy.vram(estimateGraphicsVram({ ...screenOf(game), ...values }));

const editionsOf = (game) => {
  if (game?.editions?.length > 1) return game.editions;
  return game?.edition === "Enhanced" ? ["Enhanced"] : null;
};

function gameLine(copy, game, bridge, tile) {
  const gl = copy.gameLine;
  if (game === undefined) return gl.loading;
  const vram = game?.found && vramText(copy, game, game.values);
  const text =
    !game || !bridge
      ? gl.browser
      : !game.found
        ? gl.missing
        : tile
          ? gl.template(tile.label, vram)
          : gl.custom(vram);
  const eds = editionsOf(game);
  return eds ? `${text} · ${copy.editions(eds)}` : text;
}

function tileOption(t, copy, liveId, recId) {
  const live = t.id === liveId;
  const rec = t.id === recId;
  const tags = [];
  if (t.own) tags.push(copy.mine);
  if (live) tags.push(copy.inGame);
  else if (rec && !t.own) tags.push(copy.recommend.badge);
  const bars = templateBars(t.values).map(({ key, level }) => createElement("i", { key, style: { "--graphics-level": level } }));
  return {
    className: ["graphics-template", live && "is-in-game", rec && "is-recommended"].filter(Boolean).join(" "),
    media: createElement("span", { className: "graphics-bars" }, bars),
    meta: tags.join(" · ") || undefined,
    description: BLURBS[t.group](t, copy),
    title: t.label,
    value: t.id,
  };
}

// Строка параметра: орган по виду; заметки идут под слайдером или перед переключателем и уровнями.
function paramRow(p, v, g, i, ed, put) {
  const kind = KINDS[p.kind];
  const info = graphicsDetail(p.key) || {};
  const slider = !!kind.to;
  const moved = g !== undefined && g !== v;
  const set = (x) => put(p.key, x);
  const notes = Object.entries({
    special: kind.odd?.(v, ed, p),
    what: info.what && [info.what[i], " · ", createElement("span", { key: "f" }, ed.fps(info.fps[i]))],
    below: graphicsBelowMinimum(p.key, v) && ed.belowMin,
    note: info.note?.[i],
    game: moved && ed.inGame(kind.say ? kind.say(g, i, p) : `${pct(kind.to(g))} %`),
  })
    .filter(([, body]) => body)
    .map(([tag, body]) => createElement("small", { key: tag, className: `graphics-param-${tag}` }, body));
  const copyEl = createElement(
    "span",
    { key: "n", className: slider ? "graphics-param-copy is-under" : "graphics-param-copy" },
    slider ? null : p.label[i],
    notes,
  );
  const control = slider
    ? createElement(Slider, {
        key: "c",
        unit: " %",
        step: kind.step,
        label: p.label[i],
        min: pct(p.min),
        max: pct(p.max),
        value: pct(clamp(kind.to(v), p.min, p.max)),
        onChange: (n) => set(kind.from(n)),
      })
    : kind.ctl(p, v, i, set);
  const cls = `graphics-param ${kind.cls || "is-share"}${moved ? " is-changed" : ""}`;
  return createElement("div", { key: p.key, className: cls }, slider ? [control, copyEl] : [copyEl, control]);
}

// Чтение settings.xml и запись/возврат: одна занятость на страницу, после любой записи файл читается заново.
function useGameLink(copy, notify, onApplied) {
  const [game, setGame] = useState(undefined);
  const [busy, setBusy] = useState(null);

  const reload = useCallback(async () => {
    try {
      setGame((await readGameSettings()) || null);
    } catch {
      setGame(null);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const occupy = async (kind, launch, afterwards) => {
    setBusy(kind);
    try {
      await launch();
      afterwards();
      await reload();
    } catch (failure) {
      notify(sanitizeDesktopErrorMessage(failure), "error");
    } finally {
      setBusy(null);
    }
  };

  const write = (tile, values) =>
    occupy(
      "apply",
      () =>
        applyGameSettings({
          values,
          id: tile.own || tile.id === "new" ? "" : tile.id,
        }),
      () => {
        notify(copy.applied(tile.label));
        if (onApplied) onApplied();
      },
    );
  const restore = () =>
    occupy(
      "restore",
      () => restoreGameSettings(),
      () => notify(copy.restored),
    );

  return { busy, game, restore, write };
}

export default function GraphicsPage({ language = "ru", onNotice, onApplied }) {
  const locale = graphicsLocale(language);
  const copy = graphicsCopyFor(language);
  const ed = copy.editor;
  const i = locale === "ru" ? 0 : 1;
  // Второй аргумент (тон) передаётся только при ошибке.
  const notify = useCallback(
    (text, tone) => onNotice && (tone ? onNotice(text, tone) : onNotice(text)),
    [onNotice],
  );

  useRememberedScroll("graphics:scroll");
  const [editing, setEditing] = useRememberedState("graphics:editing", null);
  const [selectedId, setSelectedId] = useRememberedState("graphics:selected", BASE_ID);
  const own = useOwnTemplates();
  const remote = useServerTemplates();
  const [dlg, setDlg] = useState({});
  // Порядок обращений наружу при показе: шаблоны сервера, файл игры, железо.
  useEffect(() => {
    refreshServerTemplates();
  }, []);
  const { game, busy, write, restore } = useGameLink(copy, notify, onApplied);
  const rec = useRecommendation();

  const shelf = graphicsShelf(own, locale, remote).map((t) => relabel(t, language));
  const selected = shelf.find((t) => t.id === selectedId) ?? shelf[0];
  const bridge = hasGameSettingsBridge();
  // Без моста записи файл игры считается непрочитанным: карточки, «Стандарт» и пометки «в игре» молчат.
  const found = bridge && !!game?.found;
  const live = found && shelf.find((t) => templateMatches(t.values, game.values));
  const opened =
    editing &&
    (editing.id === "new"
      ? { label: copy.newTemplate, id: "new", own: false, note: "", base: "", values: editing.values }
      : shelf.find((t) => t.id === editing.id));
  const draft = opened && (editing.draft || opened.values);
  const editorOn = !!(opened && draft);
  const gvals = found ? game.values || {} : null;
  const changed = editorOn
    ? diffCount(draft, opened.values, [...new Set([...Object.keys(draft), ...Object.keys(opened.values)])])
    : 0;

  const close = () => setDlg({});
  const reopen = (id) => setEditing({ id, draft: null });
  const put = (key, value) => setEditing({ ...editing, draft: { ...draft, [key]: value } });
  const keep = (fields, after) => {
    try {
      const saved = saveOwnTemplate(fields);
      after(saved);
      notify(ed.saved(saved.name));
    } catch (error) {
      notify(tr(error?.message || String(error)), "error");
    }
  };
  const startNew = () => {
    const values = found ? graphicsValuesFrom(game.values) : graphicsTemplate(BASE_ID).values;
    setEditing({ id: "new", values, draft: { ...values } });
  };
  const applyOf = (t, values, title) => ({
    onClick: () => write(t, values),
    disabled: !found || !!busy,
    busy: busy === "apply" ? copy.applying : "",
    label: copy.apply,
    title,
  });
  const actBtn = (label, icon, onClick, disabled, variant, title) =>
    createElement(Button, { icon, size: "sm", title, variant, disabled, onClick }, label);

  const editorView = () => {
    const delta = gvals ? diffCount(draft, gvals, Object.keys(draft)) : null;
    const [baseHead, baseNote] = opened.own
      ? [opened.note || opened.label, copy.basedOn(opened.note)]
      : [opened.label, opened.note];
    const cards = [
      [ed.summary.vram, vramText(copy, game, draft), ed.summary.vramNote],
      [ed.summary.game, delta ?? "—", ed.summary.gameNote(delta)],
      [ed.summary.base, baseHead, baseNote],
    ];
    const summary = createElement(
      "div",
      { className: "graphics-summary" },
      cards.map(([head, main, sub]) =>
        createElement(
          "article",
          { key: head, className: "ui-panel graphics-summary-card" },
          createElement("small", null, head),
          createElement("b", null, main),
          createElement("span", null, sub),
        ),
      ),
    );
    const sections = SECTIONS.map(([g, params]) =>
      createElement(
        "section",
        { key: g.id, className: "ui-panel graphics-param-group" },
        createElement("h2", null, g.label[i]),
        params.filter((p) => p.key in draft).map((p) => paramRow(p, draft[p.key], gvals?.[p.key], i, ed, put)),
      ),
    );
    // Особые ключи ищем оператором in, как раньше: имена вроде constructor тоже попадают в список.
    const extras = Object.entries(draft).filter(([k]) => k in GRAPHICS_EXTRA_KEYS);
    const special =
      extras.length > 0 &&
      createElement(
        "section",
        { className: "ui-panel graphics-param-group graphics-special" },
        createElement("h2", null, ed.special),
        createElement("p", null, ed.specialNote),
        createElement("dl", null, extras.map(([k, v]) => createElement("div", { key: k }, createElement("dt", null, k), createElement("dd", null, String(v))))),
      );
    const locked = !!busy;
    const more = opened.own ? [{ value: "delete", label: ed.delete, icon: createElement(TrashIcon) }] : null;
    const resetBtn = actBtn(
      copy.standard,
      createElement(UndoIcon),
      () => {
        const known = graphicsValuesFrom(game.original || game.values);
        const inDraft = Object.fromEntries(Object.entries(known).filter(([key]) => key in draft));
        setEditing({ ...editing, draft: { ...draft, ...inDraft } });
      },
      !found || locked,
      "ghost",
      ed.standardTitle,
    );
    const saveBtn = opened.own
      ? actBtn(
          ed.save,
          createElement(DiskIcon),
          () => {
            const { base, id } = opened;
            keep({ base, id, name: opened.label, values: draft }, () => reopen(id));
          },
          !changed || locked,
        )
      : null;
    const saveAsBtn = actBtn(
      copy.editor.saveAs,
      createElement(PlusIcon),
      () => {
        const blank = opened.own || opened.id === "new";
        setDlg({ kind: "save", name: blank ? "" : `${opened.label} — ${copy.groups.own.toLowerCase()}` });
      },
      locked,
    );
    const removeCurrent = () => {
      deleteOwnTemplate(opened.id);
      notify(ed.deleted(opened.label));
      setSelectedId(BASE_ID);
      setEditing(null);
    };
    const leave = () => (changed > 0 ? setDlg({ kind: "leave", name: "" }) : setEditing(null));
    const deck = createElement(
      "div",
      { className: "graphics-editor-board" },
      summary,
      sections,
      createElement(MouseSection, { onNotice: notify }),
      special,
    );
    return (
      <EditorShell
        board
        actions={
          <EditorActions
            apply={applyOf(opened, draft)}
            more={more}
            onMore={removeCurrent}
          >
            {resetBtn}
            {saveBtn}
            {saveAsBtn}
          </EditorActions>
        }
        backLabel={ed.back}
        className="graphics-editor"
        kicker={ed.kicker}
        onBack={leave}
        status={ed.status(opened.label, changed)}
        title={ed.title}
      >
        {deck}
      </EditorShell>
    );
  };

  const groupOf = (id) => {
    const tiles = tilesOf(shelf, id);
    const fresh =
      id === "community" &&
      createElement(ChoiceTile, {
        media: createElement(PlusIcon),
        title: copy.newTemplate,
        description: copy.newTemplateNote,
        className: "graphics-template graphics-template-new",
        onClick: startNew,
      });
    const picker = tiles.length > 0 && (
      <ChoiceRadioGroup
        label={copy.groups[id]}
        onChange={setSelectedId}
        className="graphics-template-grid"
        value={tiles.some((t) => t.id === selected.id) ? selected.id : ""}
        options={tiles.map((t) => tileOption(t, copy, live?.id, rec?.id))}
      />
    );
    return createElement(
      "section",
      { key: id, className: "graphics-group" },
      createElement("h2", null, copy.groups[id]),
      createElement("div", { className: "graphics-group-grid" }, fresh, picker),
    );
  };

  const shelfView = () =>
    createElement(
      "div",
      { className: "graphics-shelf" },
      <PageHeading
        title={copy.title}
        description={copy.description}
        className="graphics-heading"
        actions={
          <EditorActions apply={applyOf(selected, selected.values, copy.applyTitle(selected.label))}>
            {actBtn(
              busy === "restore" ? copy.restoring : copy.standard,
              createElement(UndoIcon),
              restore,
              !game?.canRestore || !!busy,
              "ghost",
              copy.standardTitle,
            )}
            {actBtn(copy.open, createElement(TuneIcon), () => reopen(selected.id), !selected, "ghost")}
          </EditorActions>
        }
      />,
      createElement("p", { className: "graphics-game-line", role: "status" }, gameLine(copy, game, bridge, live)),
      createElement("div", { className: "graphics-groups" }, ["astral", "community"].map(groupOf)),
    );

  // Два окна поверх страницы: имя своего шаблона и вопрос при выходе; открыто не больше одного.
  const sd = ed.saveDialog;
  const ld = ed.leaveDialog;
  const dialogs = [
    [
      "save",
      sd,
      [
        ["ghost", sd.cancel, close],
        [
          "primary",
          sd.confirm,
          () => {
            close();
            keep({ name: dlg.name, base: opened.base ?? opened.id, values: draft }, (saved) => {
              setSelectedId(saved.id);
              reopen(saved.id);
            });
          },
          !dlg.name?.trim(),
        ],
      ],
      createElement(TextField, {
        autoFocus: true,
        maxLength: 40,
        label: sd.name,
        value: dlg.name,
        placeholder: sd.placeholder,
        onChange: (name) => setDlg({ ...dlg, name }),
      }),
    ],
    [
      "leave",
      ld,
      [
        ["ghost", ld.stay, close],
        [
          undefined,
          ld.discard,
          () => {
            close();
            setEditing(null);
          },
        ],
        ["primary", ld.save, () => setDlg({ kind: "save", name: opened.own ? opened.label : "" })],
      ],
    ],
  ];

  return createElement(
    "section",
    { className: "graphics-page", "aria-label": copy.title },
    editorOn ? editorView() : shelfView(),
    dialogs.map(([kind, words, buttons, body]) =>
      createElement(
        Dialog,
        {
          key: kind,
          size: "sm",
          onClose: close,
          title: words.title,
          description: words.description,
          open: dlg.kind === kind,
          actions: buttons.map(([variant, label, onClick, disabled]) =>
            createElement(Button, { key: label, variant, onClick, disabled }, label),
          ),
        },
        body,
      ),
    ),
  );
}
