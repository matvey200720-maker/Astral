/*
 * Список своих моделей места — правка из панели и из кадра (задача 1 ТЗ
 * 11.10.2026, вечер; облегчение — ТЗ 11.10.2026, ночь, задача 1).
 *
 * Модели — слои, как в Photoshop: у каждой своя строка; выбранная раскрыта
 * настройками, остальные свёрнуты. Новая сама встаёт на поверхность под
 * серединой кадра (под прицелом) и прилипает к ней: на полу — стоит лицом к
 * камере, на стене — спиной к стене, на потолке — висит; она сразу выбрана —
 * её можно тянуть мышью и крутить кольцом. Протяжка в кадре — один шаг
 * истории («Отменить» возвращает модель туда, откуда её взяли), ползунки и
 * кнопки — как везде.
 *
 * Редактор места говорит, где список лежит в работе (`read`/`write` — у арены
 * он у выбранного сервера) и какая сцена сейчас в кадре (`scene`).
 */

import { useCallback, useMemo, useRef, useState } from "react";
import {
  PLACE_MODEL_DEFAULTS,
  PLACE_MODEL_LIMIT,
  nextPlaceModelId,
  normalizePlaceModel,
  placeModelFacing,
  placeModelLift,
  placeModelNormal,
  placeModelSceneRules,
  placeModelSpin,
  placeModelSurfaceKind,
  placeModelSurfaceRotation,
  placeModelTitle,
  placeModelTurnAround,
  placeModelUnitMesh,
} from "@modovik/climb-contract/recolor/place-models";
import { convertedImageText } from "../hangar-editor/hangar-emblem.js";
import { loadPlaceMesh, savePlaceModelSource } from "./model-assets.js";

const round = (value) => Math.round(value * 100) / 100 + 0;
/* Зазор от стены и потолка — как у кадра (`place-models-layer.js`). */
const GAP = 0.02;

/* Единичная сетка модели для расчёта опоры (у «Объёма» без картинки — `null`: опора — полразмера). */
async function unitOf(item) {
  if (item.shape === "mesh")
    return placeModelUnitMesh(item, {
      mesh: await loadPlaceMesh(item.asset).catch(() => null),
    });
  if (item.shape === "solid") return null;
  return placeModelUnitMesh(item);
}

/**
 * Модель на поверхности: поворот по нормали и `spin` вокруг неё, середина —
 * над точкой на опорной стороне. `{ position, rotation, normal }`.
 */
export function placeOnSurface(item, unit, point, normalInput, spin) {
  const normal = placeModelNormal(normalInput);
  const rotation = placeModelSurfaceRotation(normal, spin);
  const lift =
    (unit
      ? placeModelLift({ ...item, rotation }, unit, normal)
      : item.size / 2) + (placeModelSurfaceKind(normal) === "floor" ? 0 : GAP);
  return {
    position: point.map((value, axis) => round(value + normal[axis] * lift)),
    rotation,
    normal,
  };
}

/**
 * `project`, `commit`, `amend` — работа редактора; `read(project)` и
 * `write(project, list)` — где список; `scene` — сцена кадра; `stage` —
 * ссылка на кадр (`modelSpot`, `floorBelow`); `active` — взят ли инструмент
 * «Модели»; `onActivate()` — щёлкнули по модели в кадре при другом
 * инструменте.
 */
export function useModelsEditor({
  project,
  commit,
  amend,
  read,
  write,
  scene = "",
  stage = null,
  active = true,
  onActivate = null,
  onSceneChange = null,
  /* Модель выбрали строкой списка (не щелчком в кадре): редактор может подвести к ней камеру, как к выбранному из меню. */
  onListPick = null,
  blocked = "",
  onNotice = null,
}) {
  const items = useMemo(() => read(project) || [], [project, read]);
  const [selectedId, setSelectedId] = useState("");
  const [open, setOpen] = useState(true);
  const [mode, setMode] = useState("place");
  const [busy, setBusy] = useState(false);
  /* Режим «щелчком по стене»: следующий щелчок по поверхности в кадре ставит выбранную модель на неё. */
  const [placing, setPlacing] = useState(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const dragRef = useRef(0);
  const rules = useMemo(() => placeModelSceneRules(scene), [scene]);

  const selected = items.find((item) => item.id === selectedId) || null;

  const update = useCallback(
    (change, label) =>
      commit((current) => write(current, change(read(current) || [])), label),
    [commit, read, write],
  );

  const selectedRef = useRef("");
  selectedRef.current = selectedId;
  /* Щелчок по раскрытой строке сворачивает её, по другой — раскрывает ту. */
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const select = useCallback(
    (id) => {
      setPlacing(false);
      if (id && selectedRef.current === id) setOpen((value) => !value);
      else {
        setSelectedId(id || "");
        setOpen(true);
        /* Модель другой сцены (другое место маппинга, арена снаружи) — кадр идёт к ней. */
        const item = itemsRef.current.find((entry) => entry.id === id);
        if (item?.scene && item.scene !== sceneRef.current)
          onSceneChange?.(item.scene);
        if (item) onListPick?.(item);
      }
    },
    [onSceneChange, onListPick],
  );

  const patch = useCallback(
    (id, values, label) =>
      update(
        (list) =>
          list.map((item) =>
            item.id === id
              ? normalizePlaceModel({ ...item, ...values }) || item
              : item,
          ),
        label,
      ),
    [update],
  );

  /* Где встать новой: на поверхности под серединой кадра (под прицелом), прилипнув к ней. */
  const placeNew = useCallback(
    async (fields) => {
      const probe = normalizePlaceModel({
        ...PLACE_MODEL_DEFAULTS,
        ...fields,
        id: "m1",
      });
      const spot = stage?.current?.modelSpot?.() || null;
      const unit = await unitOf(probe);
      if (spot?.normal) {
        const normal = placeModelNormal(spot.normal);
        const spin = placeModelFacing(normal, spot.point, spot.eye);
        return {
          ...probe,
          ...placeOnSurface(probe, unit, spot.point, normal, spin),
          scene,
        };
      }
      /* Под прицелом пусто (небо): модель — в воздухе перед камерой, лицом к ней. */
      const point = spot?.point || [0, 0, probe.size / 2];
      const spin = spot?.eye ? placeModelFacing([0, 0, 1], point, spot.eye) : 0;
      return {
        ...probe,
        position: point.map(round),
        rotation: placeModelSurfaceRotation([0, 0, 1], spin),
        normal: [0, 0, 1],
        scene,
      };
    },
    [scene, stage],
  );

  const add = useCallback(
    async (files) => {
      const list = [...(files || [])].filter(Boolean);
      if (!list.length) return;
      if (blocked) {
        onNotice?.(blocked, "info");
        return;
      }
      setBusy(true);
      try {
        for (const file of list) {
          if (itemsRef.current.length >= PLACE_MODEL_LIMIT) {
            onNotice?.(
              `Больше ${PLACE_MODEL_LIMIT} моделей на одно место не поставить — уберите лишние.`,
              "info",
            );
            break;
          }
          const { converted, notice, ...saved } =
            await savePlaceModelSource(file);
          const fields = await placeNew({
            ...saved,
            shape: saved.shape || PLACE_MODEL_DEFAULTS.shape,
          });
          const id = nextPlaceModelId(itemsRef.current);
          update(
            (current) => [...current, { ...fields, id }],
            "Модель: добавлена",
          );
          itemsRef.current = [...itemsRef.current, { id }];
          setSelectedId(id);
          setOpen(true);
          setMode("place");
          /* «Щелчок по стене ставит модель» включён у новой модели по умолчанию: следующий щелчок по поверхности в кадре переносит её туда (Esc — отмена). */
          setPlacing(true);
          if (converted) onNotice?.(convertedImageText(converted), "info");
          if (notice) onNotice?.(notice, "info");
        }
      } catch (error) {
        onNotice?.(String(error?.message || error), "error");
      } finally {
        setBusy(false);
      }
    },
    [blocked, onNotice, placeNew, update],
  );

  const duplicate = useCallback(
    (id) => {
      const source = itemsRef.current.find((item) => item.id === id);
      if (!source) return;
      if (itemsRef.current.length >= PLACE_MODEL_LIMIT) {
        onNotice?.(
          `Больше ${PLACE_MODEL_LIMIT} моделей на одно место не поставить.`,
          "info",
        );
        return;
      }
      const copy = nextPlaceModelId(itemsRef.current);
      /* Копия — рядом, на размер правее: видно, что их две. */
      const position = [
        source.position[0] + Math.max(0.5, source.size),
        source.position[1],
        source.position[2],
      ].map(round);
      update(
        (list) => [
          ...list,
          {
            ...source,
            id: copy,
            label: source.label ? `${source.label} (копия)` : "",
            position,
          },
        ],
        "Модель: копия",
      );
      setSelectedId(copy);
      setOpen(true);
    },
    [onNotice, update],
  );

  const remove = useCallback(
    (id) => {
      update((list) => list.filter((item) => item.id !== id), "Модель: убрана");
      setSelectedId((current) => (current === id ? "" : current));
    },
    [update],
  );

  const rename = useCallback(
    (id, label) => patch(id, { label }, `Модель: имя ${id}`),
    [patch],
  );
  const toggleHidden = useCallback(
    (id) =>
      update(
        (list) =>
          list.map((item) =>
            item.id === id ? { ...item, hidden: !item.hidden } : item,
          ),
        "Модель: видимость",
      ),
    [update],
  );

  /** Размер — от опоры: низ модели (сторона к поверхности) остаётся на месте. */
  const resize = useCallback(
    async (id, size) => {
      const item = itemsRef.current.find((entry) => entry.id === id);
      if (!item || !(size > 0)) return;
      const normal = item.normal || [0, 0, 1];
      const unit = await unitOf(item);
      const lift = unit ? placeModelLift(item, unit, normal) : item.size / 2;
      const grow = size / item.size - 1;
      patch(
        id,
        {
          size,
          position: item.position.map((value, axis) =>
            round(value + normal[axis] * lift * grow),
          ),
        },
        "Модель: размер",
      );
    },
    [patch],
  );

  /** Повернуть вокруг нормали поверхности (кнопки «−90°», «+90°», «Развернуть»). */
  const turn = useCallback(
    (id, degrees) => {
      const item = itemsRef.current.find((entry) => entry.id === id);
      if (!item) return;
      patch(
        id,
        {
          rotation: placeModelTurnAround(
            item.rotation,
            item.normal || [0, 0, 1],
            degrees,
          ),
        },
        Math.abs(degrees) === 180
          ? "Модель: развернуть"
          : `Модель: поворот ${degrees > 0 ? "+" : "−"}${Math.abs(degrees)}°`,
      );
    },
    [patch],
  );

  /* Из кадра: протяжка ручек — шаг истории на всю протяжку. */
  const transform = useCallback(
    (id, values, phase) => {
      if (phase === "end" || !values) return;
      const apply = (current) =>
        write(
          current,
          (read(current) || []).map((item) =>
            item.id === id
              ? normalizePlaceModel({
                  ...item,
                  ...values,
                  scene: item.scene || scene,
                }) || item
              : item,
          ),
        );
      if (phase === "start") {
        dragRef.current += 1;
        commit(apply, `Модель: ручки ${dragRef.current}`);
      } else amend(apply);
    },
    [amend, commit, read, scene, write],
  );

  /** На пол: прилипнуть к поверхности под моделью. */
  const dropToFloor = useCallback(
    async (id) => {
      const item = itemsRef.current.find((entry) => entry.id === id);
      if (!item) return;
      const below = stage?.current?.floorBelow?.(item.position);
      if (below === null || below === undefined) {
        onNotice?.(
          "Под моделью нет поверхности — опустите её мышью или полем Z в «Точно».",
          "info",
        );
        return;
      }
      const normal = item.normal || [0, 0, 1];
      const spin =
        placeModelSurfaceKind(normal) === "floor"
          ? placeModelSpin(item.rotation, normal)
          : 0;
      const placed = placeOnSurface(
        item,
        await unitOf(item),
        [item.position[0], item.position[1], below],
        [0, 0, 1],
        spin,
      );
      patch(id, placed, "Модель: на пол");
    },
    [onNotice, patch, stage],
  );

  /** Перед камерой: туда, куда смотрит середина кадра. */
  const bringHere = useCallback(
    async (id) => {
      const item = itemsRef.current.find((entry) => entry.id === id);
      if (!item) return;
      const fields = await placeNew(item);
      patch(
        id,
        {
          position: fields.position,
          rotation: fields.rotation,
          normal: fields.normal,
          scene,
        },
        "Модель: перед камерой",
      );
    },
    [patch, placeNew, scene],
  );

  /**
   * Щелчок по поверхности в кадре (режим «щелчком по стене»): выбранная модель встаёт на неё плоскостью по нормали, отступ 2 см (`GAP`), верх — вверх мира, на полу и потолке —
   * лицом к камере (как новая под прицелом).
   */
  const placeAt = useCallback(
    async ({ point, normal, eye }) => {
      setPlacing(false);
      const item = itemsRef.current.find((entry) => entry.id === selectedRef.current);
      if (!item || !point || !normal) return;
      const facing = placeModelNormal(normal);
      const spin = placeModelFacing(facing, point, eye || point);
      const placed = placeOnSurface(item, await unitOf(item), point, facing, spin);
      patch(item.id, { ...placed, scene: item.scene || scene }, "Модель: на стену щелчком");
    },
    [patch, scene],
  );
  const startPlacing = useCallback(() => {
    if (selectedRef.current) setPlacing(true);
  }, []);
  const stopPlacing = useCallback(() => setPlacing(false), []);

  /* Кадр: выбор щелчком, ручки, род ручек и Delete. */
  const stageHandlers = useMemo(
    () => ({
      onSelect: (id) => {
        setSelectedId(id || "");
        setOpen(true);
        if (id && !active) onActivate?.();
      },
      onDeselect: () => setSelectedId(""),
      onTransform: transform,
      onMode: setMode,
      onDelete: (id) => remove(id),
      onPlace: placeAt,
      onPlaceCancel: stopPlacing,
    }),
    [active, onActivate, placeAt, remove, stopPlacing, transform],
  );

  /**
   * Нажатие колеса по кадру (общий кадр, `onAim`): своя модель под курсором —
   * взять «Модели» и выбрать её (`true`); не модель — `false`, решает редактор.
   */
  const aim = useCallback(
    (hit) => {
      const id = hit?.model;
      if (!id || !itemsRef.current.some((item) => item.id === id)) return false;
      setSelectedId(id);
      setOpen(true);
      if (!active) onActivate?.();
      return true;
    },
    [active, onActivate],
  );

  return {
    items,
    selected,
    open: Boolean(selected) && open,
    select,
    deselect: () => setSelectedId(""),
    add,
    duplicate,
    remove,
    rename,
    toggleHidden,
    patch,
    resize,
    turn,
    transform,
    dropToFloor,
    bringHere,
    placing: Boolean(placing && active && selected),
    startPlacing,
    stopPlacing,
    mode,
    setMode,
    busy,
    full: items.length >= PLACE_MODEL_LIMIT,
    scene,
    rules,
    blocked,
    aim,
    title: placeModelTitle,
    stageHandlers,
    /* Выбрана модель в кадре (обводка и ручки) — только у инструмента «Модели»; вернулись в него — выбор на месте. В другом инструменте обводка мешала бы его
       выбору, а щелчок по «уже выбранной» модели молчал: кадр считал её взятой. */
    selection: {
      id: active ? selected?.id || "" : "",
      canEdit: Boolean(active && selected),
      mode,
      placing: Boolean(placing && active && selected),
    },
  };
}
