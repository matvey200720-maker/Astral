/*
 * «Замена» — на какую вещь сервера ляжет покраска (ТЗ 04.10.2026, задача 8).
 *
 * Прежде «Применить» открывало окно «На что поставить?», и оно само брало
 * первую рекомендацию: вещь ставилась неизвестно на что. Теперь выбор — свой
 * инструмент мастерской, как оружие у трейсеров: проект, поиск, сверху то,
 * что есть и продаётся на проекте (магазин из «Заменяет» модов каталога),
 * ниже — все вещи сервера по магазинам и своя вещь по номеру; у строки —
 * отметка. Выбор живёт в мастерской и переживает смену инструмента, а
 * «Применить» без выбора приводит сюда и подсвечивает, что осталось выбрать.
 *
 * У бронежилетов сверху — бронежилеты самого проекта: модели сервера с его
 * картинками (GTA5RP — skins2 и skins6, Majestic — pack0, RMRP — свои; задача
 * 2 ТЗ 06.10.2026), тем же общим выбором с «Выбранные / Все». Ниже — штатные
 * жилеты GTA Online по цвету (задача 9 ТЗ 04.10.2026, `ClothingArmorTargets`):
 * на Majestic ими ходят банды и магазин.
 *
 * Орган выбора — тот же, что у установки замененки из каталога
 * (`ClothingItemGrid`: вещи сервера картинками, 25.10.2026 «то же в
 * мастерской»); сервер помнится общий с ним. Разделов («любая вещь на
 * любую») здесь нет: покраска запекается в развёртку красимой вещи, и на
 * вещь другого вида она легла бы криво — другой вид ставит мод каталога,
 * у которого своя модель.
 *
 * Крой (задача 4 ТЗ 05.10.2026) — по названиям вещи в кадре (`names`),
 * человек может поправить: в списке остаются вещи того же кроя. Занятая
 * вещь — вопрос «заменить её или другую»; без ответа «Применить» ведёт
 * сюда же. Свои прежние пакеты этой работы (`own`) занятостью не
 * считаются: повторное «Применить» меняет их само.
 *
 * Крой по модели (фикс 5 ТЗ 07.10.2026): у вещи в кадре он снят с её
 * геометрии (`shape`: рукав, капюшон) — худи не предлагается тому, кто
 * красил футболку, даже если у вещи нет понятного названия. Советы — сразу
 * для GTA5RP и Majestic; совет другого проекта переключает на него.
 */

import { useEffect, useMemo } from "react";
import { garmentKindOf } from "@modovik/clothing/garment-kinds";
import { tabServer } from "@modovik/clothing/target-tabs";
import {
  armorGroups,
  armorInstallTarget,
  armorItem,
  armorRefusal,
  ARMOR_PROJECTS,
} from "@modovik/clothing/armor";
import { useCatalogMods } from "../../../features/clothing/useCatalogMods.js";
import { useServerSources } from "../../../features/clothing/useServerSources.js";
import { replacesTargets } from "../../../features/clothing/clothing-targets.js";
import { colourOccupantOf, foreignOccupant, useOccupiedClothing } from "../../../features/clothing/clothing-occupied.js";
import {
  installTarget,
  useClothingTargets,
  useTargetServer,
} from "../../../features/clothing/useClothingTargets.js";
import ClothingItemGrid, { ChosenItemCard } from "./ClothingItemGrid.jsx";
import {
  ClothingTakenNotice,
  ClothingTargetBar,
  GarmentKindField,
  TATTOO_NOTE,
  chosenSummary,
  serverLabel,
} from "./ClothingTargetPicker.jsx";
import ClothingArmorTargets from "./ClothingArmorTargets.jsx";
import { tr, useTr } from "../../../locales/ui.js";

const NO_BASE = Object.freeze([]);
const NO_NAMES = Object.freeze([]);
const BLANK = Object.freeze({
  choice: null,
  picked: [],
  all: false,
  armor: [],
});

export default function ClothingTargetTool({
  wear,
  base = null,
  tattoo = false,
  /* Место красимой вещи в игре: по нему узнаётся крой бронежилета. */
  source = null,
  /* Названия красимой вещи — по ним узнаётся её крой (задача 4). */
  names = NO_NAMES,
  /* Крой красимой вещи по её модели (`garment-shape.js`) или `null`. */
  shape = null,
  /* Пакеты прежней установки этой работы — их замена своя. */
  own = NO_NAMES,
  /* Выбор этой вещи: `{ server, choice, picked, all, armor }` или `null`. */
  selection = null,
  onSelection,
  /* Что выбрано — целями установки, на каком сервере. */
  onChosen,
  /* «Применить» без выбора привело сюда: подсветить, что осталось. */
  attention = false,
}) {
  useTr();
  const mods = useCatalogMods();
  const armorOn = wear?.component === "task";
  /* У бронежилета из игры «совет» — он сам целиком: его место уже в
     списке цветов, а вещью целиком он только путал бы. */
  const author = useMemo(() => {
    const list = base ? replacesTargets(base.replaces, base.component) : NO_BASE;
    return armorOn ? list.filter((target) => target.server) : list;
  }, [base, armorOn]);
  const [server, setServer] = useTargetServer(author);
  /* Вещи сервера из файлов его клиента на ПК и из вики Majestic. */
  const sources = useServerSources({ mods, wear, server, author });
  /* Выбор на другом сервере к этому не относится — с чистого листа. */
  const kept = selection?.server === server ? selection : BLANK;
  /* Крой вещи: узнан по названиям или выбран человеком (`kind` в выборе;
     `null` — «не знаю»). Он не зависит от сервера. */
  const component = wear?.component;
  const nameKey = names.join("|");
  const detected = useMemo(
    () => garmentKindOf({ component, names }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [component, nameKey],
  );
  const kind = selection?.kind === undefined ? detected : selection.kind;
  const occupied = useOccupiedClothing();
  /* У брони вещи самой игры — это цвета жилетов выше; ниже остаются вещи
     серверов. Иначе жилет целиком и его же цвет писали бы один файл, и
     второй сменил бы первый. */
  const extra = useMemo(
    () =>
      armorOn
        ? sources.extra.map((list) => list.filter((item) => item.server))
        : sources.extra,
    [armorOn, sources.extra],
  );
  const state = useClothingTargets({
    mods,
    wear,
    server,
    author,
    extra,
    kind,
    shape,
    occupied,
    own,
    selection: kept,
    onSelection: (next) =>
      onSelection({ ...kept, ...next, kind: selection?.kind, server }),
  });

  /* Бронежилеты проекта — у брони; выбранные цвета, что можно поставить. */
  const groups = useMemo(
    () => (armorOn ? armorGroups(server) : []),
    [armorOn, server],
  );
  const armorKeys = kept.armor || [];
  const armorChosen = armorKeys
    .map((key) => armorItem(key, server))
    .filter((item) => item && !armorRefusal(item, source));
  const setArmor = (keys) => onSelection({ ...kept, armor: keys, server });
  const toggleArmor = (key) =>
    setArmor(
      armorKeys.includes(key)
        ? armorKeys.filter((entry) => entry !== key)
        : [...armorKeys, key],
    );
  const setArmorGroup = (keys, on) =>
    setArmor(
      on
        ? [...new Set([...armorKeys, ...keys])]
        : armorKeys.filter((entry) => !keys.includes(entry)),
    );

  /* Занятость цвета жилета (находка 2 перепроверки): цвет и замена вещи целиком в одном паке пишут одни записи — окно спрашивает «Заменить её» и для цвета, и согласие едет в установку. */
  const colourTaken = useMemo(
    () =>
      armorChosen
        .map((entry) => ({
          item: { key: entry.key, component: "task", name: tr(entry.title) },
          occupant: foreignOccupant(colourOccupantOf(occupied, armorInstallTarget(entry), server), own),
        }))
        .filter((entry) => entry.occupant),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [armorKeys.join(","), occupied, server, own],
  );
  const colourKeep = kept.colourKeep || NO_NAMES;
  const colourReplace = useMemo(
    () => [
      ...new Set(
        colourTaken
          .flatMap((entry) => [entry.occupant.modId, ...(entry.occupant.also || [])])
          .filter((modId) => !colourKeep.includes(modId)),
      ),
    ],
    [colourTaken, colourKeep],
  );
  const colourBlocked = colourTaken.some((entry) => colourKeep.includes(entry.occupant.modId));
  const colourState = {
    taken: colourTaken,
    blocked: colourBlocked,
    replace: colourReplace,
    agree: (modIds, on = true) =>
      onSelection({
        ...kept,
        colourKeep: on
          ? colourKeep.filter((modId) => !modIds.includes(modId))
          : [...new Set([...colourKeep, ...modIds])],
        server,
      }),
  };

  const count = armorChosen.length + state.chosen.length;
  const chosenKey = [
    ...armorChosen.map((item) => item.key),
    ...state.chosen.map((item) => item.key),
  ].join(",");
  const replaceKey = state.replace.join(",");
  useEffect(() => {
    onChosen(
      [
        ...armorChosen.map(armorInstallTarget),
        ...state.chosen.map(installTarget),
      ],
      /* Проект выбранной вкладки (у «GTA» его нет — пусто): маршрут установки берёт сама вещь-цель (`target.server`), это — для старых Desktop. */
      tabServer(server) ?? "",
      /* Занятые вещи: что человек согласился заменить и есть ли вещь,
         о которой он ещё не ответил. */
      {
        replace: [...new Set([...state.replace, ...colourReplace])],
        blocked: state.blocked || colourBlocked,
      },
    );
    // Сообщается состав выбора, а не новый массив на каждый рендер.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosenKey, server, replaceKey, state.blocked, colourReplace.join(","), colourBlocked]);

  const calling = attention && !count;
  const first = armorChosen[0];
  const summary = !count
    ? armorOn
      ? tr("Выбери бронежилет проекта — на него и встанет покраска")
      : tr("Выбери вещь сервера — на неё и встанет покраска")
    : first
      ? `${tr(first.title)}${first.hint ? ` — ${tr(first.hint)}` : ""}${
          count > 1 ? ` ${tr("и ещё {count}").replace("{count}", count - 1)}` : ""
        }`
      : chosenSummary(state, { tattoo });

  return (
    <section
      className={`ui-panel gun-panel clothing-target-tool${calling ? " is-attention" : ""}`}
      aria-label={tr("Замена")}
    >
      <p className="gun-hint">
        {tattoo
          ? tr(TATTOO_NOTE)
          : armorOn
            ? tr("Бронежилеты проекта — модели самого сервера с его картинками: покраска встанет на выбранные. Ниже — штатные жилеты GTA Online по цвету: там покраска ляжет на цвет у всех моделей жилета.")
            : tr("Покраска ляжет на вещь, которая у тебя есть на сервере: купи её в магазине — увидишь свою. Если на вещи уже стоит заменёнка, Astral спросит, заменить ли её.")}
      </p>
      <ClothingTargetBar
        server={server}
        onServerChange={setServer}
        state={state}
      />
      {!armorOn && (
        <GarmentKindField
          component={component}
          value={kind}
          detected={detected}
          shape={shape}
          onChange={(next) => onSelection({ ...kept, kind: next, server })}
        />
      )}
      <p
        className={`clothing-target-summary${count ? " is-chosen" : ""}`}
        role="status"
      >
        {summary}
      </p>
      {!armorOn ? (
        <>
          <ChosenItemCard state={state} majesticImages={sources.majesticImages} />
          <ClothingItemGrid
            state={state}
            server={server}
            majesticImages={sources.majesticImages}
            attention={attention}
          />
        </>
      ) : (
        <>
          {state.items.length > 0 && (
            <section
              className="clothing-target-section clothing-armor-project"
              aria-label={tr("Бронежилеты {server}").replace("{server}", serverLabel(server))}
            >
              <h4>{tr("Бронежилеты {server} — модели сервера").replace("{server}", serverLabel(server))}</h4>
              <ClothingItemGrid
                state={state}
                server={server}
                majesticImages={sources.majesticImages}
                attention={calling}
              />
            </section>
          )}
          <ClothingTakenNotice state={colourState} attention={calling} />
          <ClothingArmorTargets
            groups={groups}
            server={server}
            note={ARMOR_PROJECTS[server]?.note || ""}
            chosen={armorKeys}
            source={source}
            attention={calling && !state.items.length}
            onToggle={toggleArmor}
            onGroup={setArmorGroup}
          />
        </>
      )}
    </section>
  );
}
