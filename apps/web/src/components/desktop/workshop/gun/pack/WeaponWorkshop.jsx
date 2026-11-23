/*
 * Мастерская оружия: экран «Ганпак» и редактор ствола (владелец, 02.11.2026).
 *
 * «Ганпак» — первый инструмент колонки: человек набирает стволы, они становятся в кадре как на обложке пака, щелчок по стволу открывает его редактор, тот же значок ведёт обратно.
 * Редактор ствола — прежняя студия, у каждого ствола свой черновик. Открытие со страницы мода («Редактировать», `initialModel`) ведёт сразу в редактор, и выход возвращает на страницу.
 * Сцена пака создаётся один раз за заход и переживает переход в редактор: возврат к паку ничего не читает заново.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRailGroups } from "../../../../ui/useRailGroups.jsx";
import { lastWeaponSlot } from "../../../../../features/workshop/last-weapon-slot.js";
import { remember } from "../../../../../section-memory.js";
import GunStudio, { GUN_GROUPS, PAINTING, gunTools, packTool } from "../GunStudio.jsx";
import { clearGunDraft, readGunDraft } from "../gun-drafts.js";
import { installGunSkinHeadless } from "../gun-skin-host.js";
import { studioProfile } from "../studio-profiles.js";
import { useGunpackLibrary } from "../useGunpackLibrary.js";
import GunPackBoard from "./GunPackBoard.jsx";
import { FOCUS_MS, createGunPackScene } from "./gun-pack-scene.js";
import { createPackModels } from "./pack-models.js";
import { removeResetSkins, resetsInGame } from "./pack-reset.js";
import { editedPackSlots, slotInfo } from "./pack-rows.jsx";
import { clearPackReset, forgetPackPaint, projectStamp, readPackResets, readPackSlots, restampPackPaint, savePackPaint, writePackSlots } from "./pack-store.js";
import { count, fill, trKey, uiLanguage } from "../gun-copy.js";
import { tr, useTr } from "../../../../../locales/ui.js";

const known = (slot) => Boolean(slotInfo(slot));

export default function WeaponWorkshop({ initialSlot = "", initialModel = "", onSwitchSlot = null, onExit, onNotice, catalogOf = null, ...studioProps }) {
  useTr();
  const language = uiLanguage();
  const profile = studioProfile("weapon");
  const [view, setView] = useState(() => (initialModel ? "gun" : "pack"));
  const [slots, setSlots] = useState(() => readPackSlots(known));
  const [statuses, setStatuses] = useState(() => new Map());
  const [hovered, setHovered] = useState("");
  const [progress, setProgress] = useState(null);
  /* Стволы с правками: черновики читаются при входе на экран и при смене списка, а не на каждое движение мыши. */
  const [touched, setTouched] = useState(() => []);
  /* Откатанные стволы, чей скин ещё стоит в игре: следующая установка снимет его (`pack-reset.js`). */
  const [resets, setResets] = useState(() => ({}));
  const [scene, setScene] = useState(null);
  const [sceneFailed, setSceneFailed] = useState(false);
  const library = useGunpackLibrary({ onNotice });
  const libraryRef = useRef(library);
  libraryRef.current = library;
  const catalogRef = useRef(catalogOf);
  catalogRef.current = catalogOf;
  const models = useMemo(
    () =>
      createPackModels({
        library: {
          get packs() {
            return libraryRef.current.packs;
          },
          resolveModelUrl: (entry) => libraryRef.current.resolveModelUrl(entry),
          resolveAttachedModel: (entry) => libraryRef.current.resolveAttachedModel(entry),
        },
        catalogOf: (slot) => catalogRef.current?.(slot) || [],
      }),
    [],
  );
  useEffect(() => () => models.dispose(), [models]);
  /* Что уже показано на месте ствола: та же подпись — кадр и так верный, читать нечего. */
  const shownStamps = useRef(new Map());
  const focusTimer = useRef(0);
  const callbacks = useRef({});

  /* Сцена — при первом показе экрана: заход сразу в редактор со страницы мода её не заводит. */
  const packOpen = view === "pack";
  useEffect(() => {
    if (!packOpen || scene || sceneFailed) return;
    try {
      setScene(
        createGunPackScene({
          onHover: (slot) => setHovered(slot),
          onPick: (slot) => callbacks.current.edit?.(slot),
          onStatus: (slot, status) => setStatuses((current) => new Map(current).set(slot, status)),
        }),
      );
    } catch {
      setSceneFailed(true);
    }
  }, [packOpen, scene, sceneFailed]);
  useEffect(() => () => scene?.dispose(), [scene]);
  useEffect(() => () => clearTimeout(focusTimer.current), []);

  /* Сцена следует за списком; модели и покраска — только у тех, чья подпись сменилась. */
  useEffect(() => {
    if (!scene || !packOpen) return;
    scene.setSlots(slots.map((slot) => ({ slot, family: slotInfo(slot)?.family || "" })));
    for (const slot of slots) {
      const job = models.jobOf(slot);
      if (!job) {
        setStatuses((current) => new Map(current).set(slot, { state: "failed", message: tr("Модели этого ствола в поставке нет") }));
        continue;
      }
      if (shownStamps.current.get(slot) === job.stamp) continue;
      shownStamps.current.set(slot, job.stamp);
      scene.showModel(slot, job);
    }
  }, [scene, packOpen, slots, models]);

  /* Снова в паке, а модель не открылась: следующий заход попробует её заново (игру могли подключить). */
  useEffect(() => {
    for (const [slot, status] of statuses) if (status.state === "failed") shownStamps.current.delete(slot);
  }, [statuses]);

  const changeSlots = useCallback((next) => {
    setSlots(next);
    writePackSlots(next);
  }, []);

  /* Ствол, что открыт в редакторе, — в паке: иначе из редактора он пропал бы со всего экрана. */
  useEffect(() => {
    if (view !== "gun" || !initialSlot || !known(initialSlot)) return;
    setSlots((current) => {
      if (current.includes(initialSlot)) return current;
      const next = [...current, initialSlot];
      writePackSlots(next);
      return next;
    });
  }, [view, initialSlot]);

  const openGun = useCallback(
    (slot) => {
      if (!slot) return;
      if (slot !== initialSlot) onSwitchSlot?.(slot);
      setView("gun");
    },
    [initialSlot, onSwitchSlot],
  );
  const edit = useCallback(
    (slot) => {
      /* Кадр сперва подъезжает к стволу: переход читается как «вошёл в него». */
      scene?.focus(slot);
      clearTimeout(focusTimer.current);
      focusTimer.current = setTimeout(() => openGun(slot), scene ? FOCUS_MS : 0);
    },
    [scene, openGun],
  );
  callbacks.current.edit = edit;

  /* Добавленный ствол — стандартный. Черновик без покраски только помнит, какой скин был открыт в прошлый раз: он уходит. Покраска человека остаётся, стирает её корзина. */
  const addSlot = useCallback(
    (slot) => {
      if (slots.includes(slot)) return;
      const draft = readGunDraft(slot);
      if (draft && !editedPackSlots([slot], () => draft).length) clearGunDraft(slot);
      changeSlots([...slots, slot]);
    },
    [slots, changeSlots],
  );
  /* Запись кадров покраски идёт по одной: две подряд для одного ствола перемешали бы файлы и опись. */
  const paintQueue = useRef(Promise.resolve());
  const queuePaint = useCallback((job) => {
    paintQueue.current = paintQueue.current.then(job).catch(() => {});
  }, []);
  /* Что уже записано: «ствол → подпись черновика» (пусто — кадров нет). Тот же кадр дважды не пишется. */
  const paintSaved = useRef(new Map());

  /* Корзина убирает ствол целиком: снова добавленный будет стандартным, а не с прежней покраской. */
  const removeSlot = useCallback(
    (slot) => {
      changeSlots(slots.filter((item) => item !== slot));
      clearGunDraft(slot);
      clearPackReset(slot);
      shownStamps.current.delete(slot);
      paintSaved.current.delete(slot);
      models.forget(slot);
      queuePaint(() => forgetPackPaint(slot));
    },
    [slots, changeSlots, models, queuePaint],
  );

  /* Кадр покраски — экрану, копия — в хранилище, чтобы и после перезапуска наклейки были на месте. Студия отдаёт его при уходе из ствола и сама, пока в нём правят (тихо, когда правки остановились): правка уходит в ганпак без «Применить» и «Сохранить». */
  const onLeaveGun = useCallback(
    (slot, paint, { same = false } = {}) => {
      const project = readGunDraft(slot);
      if (!project) return;
      const stamp = projectStamp(project);
      models.hand(slot, stamp, paint);
      /* Новый кадр — в сцену и при той же подписи: в прежнем, собранном из черновика, не было наклеек. */
      if (paint.size) {
        shownStamps.current.delete(slot);
        if (paintSaved.current.get(slot) === stamp) return;
        paintSaved.current.set(slot, stamp);
        /* Холсты те же (правка была невидимая): записанный кадр годен, меняется только подпись. */
        if (same) queuePaint(() => restampPackPaint(slot, stamp));
        else queuePaint(() => savePackPaint(slot, stamp, paint));
      } else if (paintSaved.current.get(slot) !== "") {
        paintSaved.current.set(slot, "");
        queuePaint(() => forgetPackPaint(slot));
      }
    },
    [models, queuePaint],
  );

  /* Стволы с правками и откатанные со скином в игре: читаются при входе на экран и при смене списка. */
  useEffect(() => {
    if (!packOpen) return;
    setTouched(editedPackSlots(slots));
    setResets(resetsInGame(readPackResets(), profile));
  }, [packOpen, slots, profile]);

  /* Откатанные стволы под снятие: правка гасит метку, и ствол с правками снова ставится, а не снимается. */
  const removals = useMemo(() => Object.keys(resets).filter((slot) => !touched.includes(slot)), [resets, touched]);

  /* Поставить весь пак: скрытая студия на каждый ствол по очереди, той же заявкой, что «Применить» в редакторе (`gun-skin-host.js`). Откатанные стволы — снятием их скина той же очередью. */
  const installPack = useCallback(async () => {
    const queued = [];
    const skipped = [];
    const total = touched.length + removals.length;
    for (const [index, slot] of touched.entries()) {
      const name = profile.slotName(slot);
      setProgress({ done: index + 1, total });
      const project = readGunDraft(slot);
      let outcome = { status: "failed", reason: "" };
      try {
        outcome = await installGunSkinHeadless({
          kind: "weapon",
          slot,
          project: JSON.parse(JSON.stringify(project)),
          name,
          catalogItems: catalogRef.current?.(slot) || [],
          notify: () => {},
        });
      } catch (error) {
        outcome = { status: "failed", reason: String(error?.message || error) };
      }
      if (outcome.status === "queued") queued.push(name);
      else skipped.push(fill(tr("{name}: {reason}"), { name, reason: outcome.reason || tr("не встала в очередь") }));
    }
    for (const [index, slot] of removals.entries()) {
      setProgress({ done: touched.length + index + 1, total });
      const result = await removeResetSkins({ resets: { [slot]: resets[slot] }, profile });
      queued.push(...result.queued);
      for (const item of result.skipped) skipped.push(fill(tr("{name}: {reason}"), item));
      /* Скин встал в очередь на снятие — метка своё отработала; не встал — остаётся до следующей установки. */
      if (!result.skipped.length) clearPackReset(slot);
    }
    setProgress(null);
    setResets(resetsInGame(readPackResets(), profile));
    if (queued.length) onNotice?.(fill(tr("В очередь встали: {list}"), { list: count(queued.length, trKey("ствол|ствола|стволов")) }), skipped.length ? "warning" : "success");
    if (skipped.length) onNotice?.(fill(tr("Не встали: {list}"), { list: skipped.join("; ") }), "error");
  }, [touched, removals, resets, profile, onNotice]);

  /* Колонка экрана — та же, что у редактора: значок инструмента открывает ствол с этим инструментом. */
  const railTools = useMemo(() => {
    const list = gunTools(profile);
    return [packTool(), ...list.map((tool) => (slots.length ? tool : { ...tool, disabled: true, disabledReason: tr("Сначала добавьте оружие") }))];
    // Язык читает `tr` из модуля: смена языка пересобирает подписи инструментов.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, slots.length, language]);
  const pickRailTool = useCallback(
    (next) => {
      if (next === "pack" || !slots.length) return;
      remember("gun:section", PAINTING.has(next) ? "paint" : next);
      if (PAINTING.has(next)) remember("gun:tool", next);
      const last = lastWeaponSlot(known);
      edit(slots.includes(last) ? last : slots[0]);
    },
    [slots, edit],
  );
  const rail = useRailGroups({ groups: GUN_GROUPS, tools: railTools, tool: "pack", onTool: pickRailTool });

  const backToPack = useCallback(() => setView("pack"), []);
  /* Стволы пака для столбика карточки «Ствол»: открытый со страницы мода уже в паке (эффект выше), но в первом кадре его ещё нет. */
  const packSlots = useMemo(
    () => (initialSlot && known(initialSlot) && !slots.includes(initialSlot) ? [...slots, initialSlot] : slots),
    [slots, initialSlot],
  );
  if (view === "gun")
    return (
      <GunStudio
        key={initialSlot}
        {...studioProps}
        initialSlot={initialSlot}
        initialModel={initialModel}
        onSwitchSlot={onSwitchSlot}
        onNotice={onNotice}
        /* Со страницы мода назад — на неё; с экрана пака — к паку. */
        onExit={initialModel ? onExit : backToPack}
        onOpenPack={backToPack}
        onLeaveGun={onLeaveGun}
        packSlots={packSlots}
      />
    );
  return (
    <GunPackBoard
      scene={scene}
      sceneFailed={sceneFailed}
      rail={rail}
      title={tr(profile.title)}
      slots={slots}
      touched={touched}
      resets={resets}
      statuses={statuses}
      hovered={hovered}
      install={{ ready: (touched.length > 0 || removals.length > 0) && !progress, canRemove: removals.length > 0, progress, start: installPack }}
      onAdd={addSlot}
      onEdit={edit}
      onRemove={removeSlot}
      onExit={onExit}
    />
  );
}
