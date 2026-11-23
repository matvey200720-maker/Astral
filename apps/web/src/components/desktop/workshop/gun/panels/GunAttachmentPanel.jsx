import SectionHeading from "../../../../../features/workshop/section-help.jsx";
import { weaponById } from "@modovik/rpf-inspector/weapon-identity";
import AttachmentIcon from "../attachment-icon.jsx";
import { tr, useTr } from "../../../../../locales/ui.js";
import useTabListKeys from "../../../../ui/useTabListKeys.js";
import { ArrowCounterClockwise, Warning } from "../../../../ui/icons.jsx";
import AttachmentScheme from "../AttachmentScheme.jsx";
import "../attachment-picker.css";
import Button from "../../../../ui/Button.jsx";
import { useWeaponOutline } from "../gun-outline.js";
import AttachmentLooks from "./AttachmentLooks.jsx";
import { componentLabel, pointLabel } from "../attachment-names.js";
import { fill } from "../gun-copy.js";
import { Fragment, createElement as h, useState } from "react";

// ---------------------------------------------------------------- места

// Одна строка на место: всё, что про него известно из выбора и отчёта сборки.
function rowOf(point, attachments, reasons) {
  const bone = point.bone;
  const picked = attachments.selection[bone];
  const code = picked && typeof attachments.skipped === "function" ? attachments.skipped(bone) : undefined;
  const reason = reasons[code];
  const state = !picked ? "" : reason ? "warned" : "filled";
  return { point, bone, picked, reason, state, label: tr(pointLabel(point)) };
}

function labelsWithNumbers(components) {
  const labels = components.map((component) => tr(componentLabel(component)));
  const totals = new Map();
  for (const label of labels) totals.set(label, (totals.get(label) ?? 0) + 1);
  const used = new Map();
  return labels.map((label) => {
    if (totals.get(label) === 1) return label;
    used.set(label, (used.get(label) ?? 0) + 1);
    return `${label} ${used.get(label)}`;
  });
}

function tilesOf(point) {
  const labels = labelsWithNumbers(point.components);
  const parts = point.components.map((component, at) => ({
    value: component.id,
    component,
    label: labels[at],
    badge: Boolean(component.default) && !labels[at].toLowerCase().includes("штатный"),
    none: false,
  }));
  if (point.mode !== "embed") return parts;
  return [{ value: "", component: null, label: tr("Без обвеса"), badge: false, none: true }, ...parts];
}

function helpOf(attachments, open, hasPlaces) {
  const { mode } = attachments;
  const lines = [];
  if (mode === "own") {
    lines.push(
      tr("Своя модель: обвес встаёт на кости штатного ствола этой полки — в кадре и в игре он там же, куда его поставит игра. Подгонка модели его не двигает."),
    );
  } else if (mode === "take") {
    lines.push(
      tr("Скин каталога: выбранный обвес встаёт на кости его модели — Astral возьмёт скин в «Мои паки» и скачает файлы ствола. Нарисованное остаётся."),
    );
  }
  if (open && open.point.mode === "replace" && open.picked) {
    const shared = attachments.shared(open.bone);
    if (shared.length) {
      const names = shared.map((gun) => tr(gun.name)).join(", ");
      lines.push(
        fill(tr("«{part}» — один файл игры и у других стволов ({names}): там он тоже станет выбранным."), {
          part: open.label,
          names,
        }),
      );
    }
  }
  if (hasPlaces) {
    lines.push(
      mode === "pack" || mode === "take"
        ? tr("Обвесы вшиваются в модель пака: в оружейной такие не покупайте — будет двойной.")
        : tr("Магазин и ствол встают вместо штатных, остальное вшивается в модель: в оружейной такое не покупайте — будет двойной."),
    );
  }
  return lines;
}

// ---------------------------------------------------------------- панель места

function OptionTile({ tile, chosen, ctx }) {
  const { attachments, bone, store } = ctx;
  const classes = ["gun-attach-option", chosen && "is-selected", tile.none && "is-none"];
  return h(
    "button",
    {
      type: "button",
      role: "radio",
      className: classes.filter(Boolean).join(" "),
      "aria-checked": chosen,
      tabIndex: chosen ? 0 : -1,
      disabled: !attachments.available,
      onClick: () => attachments.onChange(bone, store(tile.value)),
    },
    h(AttachmentIcon, {
      weaponId: attachments.weapon,
      bone,
      component: tile.component,
      resolveGameRoot: attachments.resolveGameRoot,
      className: "gun-attach-option-art",
    }),
    h("span", { className: "gun-attach-option-name" }, tile.label),
    tile.badge && h("span", { className: "gun-attach-option-badge" }, tr("Штатный")),
  );
}

function PlacePanel({ attachments, row }) {
  const { point, bone } = row;
  const tiles = tilesOf(point);
  const current = row.picked || point.default || "";
  const shown = tiles.find((tile) => tile.value === current) ?? tiles[0];
  // Штатный обвес места хранится как «ничего не выбрано».
  const store = (value) => (value === point.default ? "" : value);

  const { listRef, onKeyDown } = useTabListKeys({
    options: tiles,
    value: current,
    onChange: (value) => attachments.onChange(bone, store(value)),
    enabled: Boolean(attachments.available),
    orientation: "both",
    itemSelector: ".gun-attach-option",
  });

  const { looks } = attachments;
  const picked = row.picked ? point.components.find((component) => component.id === row.picked) : undefined;
  const options = looks && picked ? attachments.looks.optionsFor(picked) : [];
  const hasOptions = options.length > 0;
  const chosenLook = looks?.chosen?.[bone] || "";
  const stale = Boolean(picked && chosenLook) && !options.some((option) => option.id === chosenLook);
  const locked = Boolean(looks && picked) && typeof looks.locked === "function" && looks.locked(picked);

  const ctx = { attachments, bone, store };
  return h(
    "div",
    {
      id: "gun-attach-options",
      className: "gun-attach-place",
      role: "tabpanel",
      "aria-labelledby": `gun-attach-spot-${bone}`,
    },
    h(
      "div",
      { className: "gun-attach-place-head" },
      h(AttachmentIcon, {
        weaponId: attachments.weapon,
        bone,
        component: shown ? shown.component : null,
        resolveGameRoot: attachments.resolveGameRoot,
        className: "gun-attach-place-glyph",
      }),
      h("strong", null, row.label),
      h("span", { className: "gun-attach-place-value" }, shown ? shown.label : ""),
    ),
    h(
      "div",
      { className: "gun-attach-options", role: "radiogroup", "aria-label": row.label, ref: listRef, onKeyDown },
      tiles.map((tile, at) => h(OptionTile, { key: `${at}:${tile.value}`, tile, chosen: tile.value === current, ctx })),
    ),
    looks && picked && (hasOptions || stale)
      ? h(AttachmentLooks, {
          options,
          value: chosenLook,
          stale,
          disabled: !attachments.available,
          onChange: (id) => attachments.looks.onChoose(bone, id),
        })
      : null,
    locked
      ? h("p", { className: "gun-hint gun-attach-locked" }, tr("Обвесы ганпаков появятся здесь, когда вы скачаете ганпак."))
      : null,
    row.reason
      ? h("p", { className: "gun-attach-warn", role: "status" }, h(Warning, { weight: "fill" }), h("span", null, tr(row.reason)))
      : null,
  );
}

// ---------------------------------------------------------------- секция

function Section({ attachments, openBone, onOpen, outline, pending }) {
  const anySelection = Object.keys(attachments.selection).length > 0;
  const places = attachments.points ?? [];
  const reasons = attachments.mode === "own" ? OWN_REASONS : BASE_REASONS;
  const rows = places.map((point) => rowOf(point, attachments, reasons));
  const open = rows.find((row) => row.bone === openBone) ?? rows[0];
  const stateOf = new Map(rows.map((row) => [row.bone, row.state]));
  const family = weaponById(attachments.weapon)?.family || "rifle";
  const help = helpOf(attachments, open, places.length > 0);

  return h(
    "section",
    { className: "gun-model-panel gun-attach", "aria-label": tr("Обвесы") },
    h(
      "div",
      { className: "gun-section-head" },
      h("h3", null, tr("Обвесы на стволе")),
      h(
        Button,
        {
          variant: "secondary",
          size: "sm",
          icon: h(ArrowCounterClockwise),
          disabled: !anySelection,
          onClick: attachments.onReset,
        },
        tr("Как в игре"),
      ),
    ),
    h(SectionHeading, { help }),
    places.length === 0
      ? h("p", { className: "gun-hint" }, tr("У этого ствола обвесов в игре нет."))
      : h(
          Fragment,
          null,
          h(AttachmentScheme, {
            family,
            outline,
            pending,
            points: rows.map((row) => ({ ...row.point, label: row.label })),
            active: open.bone,
            state: (bone) => stateOf.get(bone) ?? "",
            panelId: "gun-attach-options",
            label: tr("Места обвесов"),
            onPick: onOpen,
          }),
          h(PlacePanel, { attachments, row: open }),
        ),
    attachments.available
      ? null
      : h("p", { className: "gun-hint" }, tr("Обвесы берутся из вашей игры: открой мастерскую в Astral Desktop с подключённой GTA V.")),
  );
}

export default function GunAttachmentPanel({ attachments, children = null }) {
  useTr();
  const [openBone, setOpenBone] = useState(null);
  const { outline, pending } = useWeaponOutline(attachments?.weapon ?? "", attachments?.resolveGameRoot);

  if (attachments == null) {
    const noModel = tr("Обвесы встают на кости модели ствола — у ствола из игры и из «Моих паков». У этой модели их нет: выберите в «Моделях» ствол из игры или из пака.");
    return h(
      Fragment,
      null,
      h("section", { className: "gun-model-panel", "aria-label": tr("Обвесы") }, h("p", { className: "gun-hint" }, noModel)),
      children,
    );
  }
  return h(Fragment, null, h(Section, { attachments, openBone, onOpen: setOpenBone, outline, pending }), children);
}

// ---------------------------------------------------------------- причины по кодам отчёта сборки

const BASE_REASONS = {
  bone: "У модели пака нет кости под этот обвес — он не встанет ни в кадре, ни в игре.",
  read: "Модель этого обвеса не читается — он не встал.",
  game: "Этого обвеса нет в паке: его модель берётся из GTA V, а игра не найдена.",
  absent: "Модели этого обвеса нет ни в паке, ни в игре.",
};

const OWN_REASONS = {
  bone: "У штатного ствола этой полки нет кости под этот обвес — он не встанет ни в кадре, ни в игре.",
  read: "Модель этого обвеса из вашей игры не читается — в кадре его нет.",
  game: "Модель обвеса не прочиталась из вашей игры (GTA V Legacy не найдена или ствол в ней неполный) — в кадре его нет.",
  absent: "Модели этого обвеса нет в вашей игре — в кадре его нет.",
};
