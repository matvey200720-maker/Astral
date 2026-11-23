import { Suspense, createElement, lazy, useMemo, useState } from "react";
import { clothingNeedsChoice } from "../../../features/clothing/needs-choice.js";
import {
  choiceFor,
  withChoices,
} from "../../../features/builds/build-choices.js";
import { rememberBuildChoices } from "../../../features/builds/build-choices-store.js";
import { tr } from "../../../locales/ui.js";

/* Окно грузится отдельным куском и только когда человек нажал «Выбрать цели»: страница сборок в свой кусок его не тянет (как у корзины, `CartClothingChoice`). */
const BuildChoiceDialog = lazy(() => import("./BuildChoiceDialog.jsx"));

/*
 * Выбор цели у вещей открытой сборки (16.11.2026, решение ведущей; запись — `features/builds/build-choices.js`).
 *
 * Вещь вида «одна вещь на замену» (причёска, борода, усы, ногти, перчатки, штатная вещь) без выбора, «на что поставить», сборка не ставит и называет в слове «не ставятся сами». Здесь выбор
 * задаётся у самой сборки: кнопка «Выбрать цели (N)» открывает то же окно «Сделать заменёнку», что у карточки, по очереди для каждой вещи без выбора; подтверждённое место сохраняется в ЭТУ
 * сборку, и «Установить сборку» ставит вещь без вопросов. Выбранное можно сменить: «Изменить цели» проходит по всем вещам.
 *
 * И у своих сборок, и у облачных: выбор лежит в локальном хранилище по id сборки (`build-choices-store.js`) и подмешивается к записи при чтении списка (`withStoredWorks`); в облако не уходит, на другом ПК его
 * нет. Вещь, которая уже стоит в игре, выбора не просит.
 */

const NONE = [];

/** Вещи сборки, которым нужен выбор цели: отмеченные, ещё не стоящие в игре. */
export function choosableMods(build, mods, { enabledIds, installedIds }) {
  if (!build) return NONE;
  return (mods || NONE).filter(
    (mod) =>
      mod &&
      !mod.pending &&
      !mod.missing &&
      enabledIds.has(mod.id) &&
      !installedIds.has(mod.id) &&
      clothingNeedsChoice(mod),
  );
}

/** Подпись на плитке вещи: что выбрано или что нужно выбрать; у остальных вещей пусто. */
export function choiceNote(build, choosable, mod) {
  if (!choosable.some((item) => item.id === mod.id)) return null;
  const choice = choiceFor(build, mod.id);
  if (!choice) return tr("Нужно выбрать цель");
  const name = choice.target?.name || choice.targets?.[0]?.name;
  return name ? tr("Цель: {name}").replace("{name}", name) : tr("Цель выбрана");
}

/**
 * `build` — открытая сборка, `mods` — её вещи (`view.mods`), `catalog` — весь каталог для окна. Отдаёт `{ count, total, start, dialog, noteOf }`: сколько вещей ждут выбора, сколько
 * всего с выбором, запуск очереди окон, само окно (или `null`) и подпись для плитки.
 */
export function useBuildChoices({
  build,
  mods,
  enabledIds,
  installedIds,
  catalog,
  setProfiles,
}) {
  const [run, setRun] = useState(null);
  const choosable = useMemo(
    () => choosableMods(build, mods, { enabledIds, installedIds }),
    [build, mods, enabledIds, installedIds],
  );
  const lacking = choosable.filter((mod) => !choiceFor(build, mod.id));

  const start = () => {
    const list = lacking.length ? lacking : choosable;
    if (list.length) setRun({ list, at: 0 });
  };
  const close = () => setRun(null);
  const advance = () =>
    setRun((now) =>
      now && now.at + 1 < now.list.length ? { ...now, at: now.at + 1 } : null,
    );

  /* Записи установки от окна → выбор для вещей этой сборки; остальные (парные вещи другого пола) `withChoices` не пишет. */
  const done = (requests) => {
    const picked = {};
    for (const request of requests) {
      if (request.clothingChoice) picked[request.id] = request.clothingChoice;
    }
    if (Object.keys(picked).length && build) {
      /* Выбор — в локальное хранилище по id сборки (так он держится и у облачной: список приходит с сервера без него) и в запись в памяти. */
      rememberBuildChoices(build.id, withChoices(build, picked).choices);
      setProfiles((list) =>
        list.map((item) =>
          item.id === build.id ? withChoices(item, picked) : item,
        ),
      );
    }
    advance();
  };

  const current = run ? run.list[run.at] : null;
  const dialog = current
    ? createElement(
        Suspense,
        { fallback: null },
        createElement(BuildChoiceDialog, {
          key: current.id,
          mod: current,
          catalog,
          onDone: done,
          onClose: close,
        }),
      )
    : null;

  return {
    count: lacking.length,
    total: choosable.length,
    start,
    dialog,
    noteOf: (mod) => choiceNote(build, choosable, mod),
  };
}
