/*
 * Редактор интерьеров.
 *
 * Рамка редактора общая (`components/ui/EditorShell.jsx`): полоса сверху с
 * названием и действиями, сцена посередине, колонка органов управления справа.
 * Своя шапка здесь была — со своей высотой, своей кнопкой «назад» и своим
 * мнением о том, где стоит «Сохранить», — и была она в мастерской не первой
 * такой. Заодно ушёл свой набор значков: в лаунчере один набор, phosphor.
 *
 * Кадр рисует общее окно предпросмотра (см. `InteriorPreview3D.jsx`), а с ним
 * приходят настоящие сутки из таймцикла игры. Зал при этом настоящий, из
 * установленной GTA V, и варианты отделки в нём авторские — это работа, которая
 * пришла сюда раньше рамки, и рамка её не трогает.
 *
 *
 * ГДЕ СТАВЯТ ОБЪЕКТ
 *
 * Раньше — нигде: каталог сам подбирал место из семи заранее записанных точек,
 * брал первую, на которой объект не нарушал геометрию, и на этом выбор человека
 * заканчивался. В кадре объекта при этом не было вовсе. Теперь кнопка каталога
 * берёт объект В РУКУ, под указателем в зале ходит приманка, а щелчок по полу
 * ставит объект туда, куда показали. Дальше его двигают протяжкой, поворачивают
 * ручкой, колесом при зажатой кнопке или клавишей R и удаляют Delete.
 *
 * Проверка макета при этом отвечает на месте: `validateInteriorDesign` зовётся
 * на каждом шаге протяжки и красит объект под рукой, а не ждёт, пока человек
 * отпустит кнопку и прочитает строку в списке.
 *
 * Выбор один на обе половины: щелчок в зале подсвечивает строку в списке,
 * щелчок в списке — объект в зале. Он живёт здесь, в `selectedId`, и уезжает в
 * сцену раскладкой.
 *
 * Про установку: она по-прежнему закрыта — у всех локаций `installable: false`,
 * и открыть это может только живой смоук-тест в Story Mode.
 */

import { useEffect, useMemo, useState } from "react";
import { counted } from "../../../utils/format.js";
import { createFloorPlan, holdInRoom } from "./interior-layout.js";
import {
  DownloadSimple,
  Eye,
  FloppyDisk,
  MapPin,
  Package,
  Check,
  ShieldCheck,
  SquaresFour,
  Trash,
  Warning,
} from "../../../components/ui/icons.jsx";
import {
  INTERIOR_LOCATIONS,
  INTERIOR_PRESETS,
  INTERIOR_PROPS,
  addInteriorEntity,
  clearInteriorFinish,
  createInteriorCompileRequest,
  createInteriorDesign,
  duplicateInteriorEntity,
  getInteriorProp,
  getInteriorTemplate,
  migrateInteriorModuleConfiguration,
  quaternionToYaw,
  removeInteriorEntity,
  updateInteriorEntity,
  updateInteriorFinish,
  validateInteriorDesign,
  yawToQuaternion,
} from "@modovik/interior-contract";
import Button from "../../../components/ui/Button.jsx";
import Dialog from "../../../components/ui/Dialog.jsx";
import EditorActions from "../../../components/ui/EditorActions.jsx";
import EditorShell from "../../../components/ui/EditorShell.jsx";
import InteriorFinishPanel from "./InteriorFinishPanel.jsx";
import InteriorPreview3D from "./InteriorPreview3D.jsx";
import { importFinishTexture, loadFinishTexture } from "./interior-textures.js";
import {
  applyArenaInstall,
  applyInteriorCustomization,
  arenaInstallSupported,
  chooseArenaSource,
  chooseGameInstallation,
  detectInstallations,
  inspectArenaSource,
  planArenaInstall,
  planInteriorCustomization,
  prepareGameInstallation,
  removeArenaInstall,
  removeInteriorCustomization,
} from "../../../api.js";
import { hotkey } from "../../../utils/hotkeys.js";
import { tr, useTr } from "../../../locales/ui.js";

const snap = (value, step) => Math.round(value / step) * step;

/* Опознавательный знак пробного объекта: он живёт ровно один вызов проверки и
   в макет не попадает. Имя выбрано так, чтобы не совпасть с настоящим: `id`
   объектов проект выдаёт из случайных шестнадцатеричных. */
const PROBE_ID = "astral-probe";

/*
 * Размер предмета в каталоге — до сантиметра и без хвоста.
 *
 * Печаталось сырое число из коробки архетипа: «1.0048270000000001 ×
 * 0.9340980000000001 м». Столько знаков не значат ничего, кроме двоичной
 * дроби, а рядом на том же экране размер комнаты набран по-человечески.
 */
const size = (value) => (Math.round(value * 100) / 100).toLocaleString("ru-RU");

/* Мировая точка интерьера — целыми метрами. Дробные доли координат GTA V в
   подписи не значат ничего: это адрес, а не позиция предмета. */
const worldSpot = (location) => {
  const point = location?.worldTransform?.position;
  if (!point) return tr("не указана");
  return `X ${Math.round(point.x)} · Y ${Math.round(point.y)} · Z ${Math.round(point.z)}`;
};

/* Размеры правимой комнаты: те же числа, по которым её обводят на полу. */
const roomSpan = (template) => ({
  width: Math.abs((template?.room?.maxX ?? 0) - (template?.room?.minX ?? 0)),
  depth: Math.abs((template?.room?.maxY ?? 0) - (template?.room?.minY ?? 0)),
});
const shortHash = (value) => value.replace("sha256:", "").slice(0, 12);

function downloadDesign(design) {
  const blob = new Blob([JSON.stringify(design, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${design.id}.interior.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function createReplacementDesign(design, { locationId, presetId }) {
  const next = createInteriorDesign({
    id: design.id,
    name: design.name,
    locationId: locationId || design.locationBinding.locationId,
    presetId: presetId || "blank",
  });
  return {
    ...next,
    createdAt: design.createdAt,
    revision: design.revision + 1,
  };
}

export default function InteriorEditor({
  config,
  project,
  dirty,
  canUndo,
  canRedo,
  onChange,
  onUndo,
  onRedo,
  onSave,
  onCancel,
  onNotice,
  onInstallationChange,
}) {
  useTr();
  const design = useMemo(
    () =>
      migrateInteriorModuleConfiguration(config, {
        projectId: project.id,
        projectName: project.name,
      }).design,
    [config, project.id, project.name],
  );
  const [selectedId, setSelectedId] = useState(
    () => design.entities[0]?.id || null,
  );
  /* Объект каталога, взятый в руку: под указателем в зале ходит его приманка, а
     щелчок по полу превращает её в объект макета. */
  const [armedPropId, setArmedPropId] = useState("");
  /*
   * Отделка.
   *
   * Список поверхностей приходит из кадра и живёт только в нём: помещение
   * лежит в файлах игры, и до того, как модель приедет, ни редактор, ни
   * контракт не знают, что в этом магазине можно покрасить. В проект уезжают
   * одни следы краски — цвет и ссылка на текстуру.
   */
  const [surfaces, setSurfaces] = useState([]);
  const [surfaceId, setSurfaceId] = useState("");
  const [finishError, setFinishError] = useState("");
  /* Готовый набор из папки: выбранная папка, её опись и подготовленный план. */
  const [set, setSet] = useState(null);
  const [setPlan, setSetPlan] = useState(null);
  const [setBusy, setSetBusy] = useState("");
  const [setError, setSetError] = useState("");
  const [planOpen, setPlanOpen] = useState(false);
  const [installPlan, setInstallPlan] = useState(null);
  const [installBusy, setInstallBusy] = useState("");
  const [installError, setInstallError] = useState("");

  const location = INTERIOR_LOCATIONS.find(
    (item) => item.id === design.locationBinding.locationId,
  );
  const selected =
    design.entities.find((item) => item.id === selectedId) || null;
  const selectedProp = selected ? getInteriorProp(selected.propId) : null;
  const report = useMemo(() => validateInteriorDesign(design), [design]);
  const compilePlan = useMemo(
    () => createInteriorCompileRequest(design),
    [design],
  );
  const activeInstall =
    [...(project.installations || [])]
      .reverse()
      .find(
        (item) =>
          item.kind === "native-legacy-interior" &&
          item.status === "active" &&
          item.locationId === location.id,
      ) || null;
  const commit = (next, label) => {
    onChange(next, label);
    setPlanOpen(false);
  };

  const installationPayload = async () => {
    let installations = await detectInstallations();
    let game = installations.find(
      (item) =>
        item.path &&
        String(item.edition || "Legacy").toLowerCase() === "legacy",
    );
    if (!game) game = await chooseGameInstallation();
    if (!game?.path || String(game.edition || "").toLowerCase() !== "legacy")
      throw new Error("Выберите GTA V Legacy для установки интерьера.");
    if (game.installReadiness !== "ready") {
      await prepareGameInstallation({
        targetId: game.id,
        releaseStockHold: true,
      });
      installations = await detectInstallations();
      game = installations.find((item) => item.id === game.id) || game;
    }
    return {
      projectId: project.id,
      design,
      /* Хэш читается здесь, а не в теле компонента: у плана он ленивый, и на
         этом пути его считают ровно один раз — перед самой установкой. */
      expectedDesignHash: compilePlan.designHash,
      gameRoot: game.path,
      targetId: game.id,
    };
  };

  const planInstall = async () => {
    setInstallBusy("plan");
    setInstallError("");
    try {
      const payload = await installationPayload();
      const plan = await planInteriorCustomization(payload);
      setInstallPlan({ plan, payload });
    } catch (error) {
      setInstallError(error.message || tr("Не удалось подготовить установку."));
    } finally {
      setInstallBusy("");
    }
  };

  const applyInstall = async () => {
    if (!installPlan) return;
    setInstallBusy("apply");
    setInstallError("");
    try {
      const installed = await applyInteriorCustomization({
        ...installPlan.payload,
        planId: installPlan.plan.planId,
      });
      onInstallationChange?.(installed);
      setInstallPlan(null);
      setPlanOpen(false);
      onNotice?.(tr("Интерьер установлен в изолированный Astral Maps."));
    } catch (error) {
      setInstallError(error.message || tr("Не удалось установить интерьер."));
    } finally {
      setInstallBusy("");
    }
  };

  const removeInstall = async () => {
    if (!activeInstall) return;
    setInstallBusy("remove");
    setInstallError("");
    try {
      const removed = await removeInteriorCustomization({
        modId: activeInstall.modId,
        gameRoot: activeInstall.gameRoot,
        targetId: activeInstall.targetId,
      });
      onInstallationChange?.(removed);
      setPlanOpen(false);
      onNotice?.(tr("Интерьер удалён, предыдущая композиция восстановлена."));
    } catch (error) {
      setInstallError(error.message || tr("Не удалось удалить интерьер."));
    } finally {
      setInstallBusy("");
    }
  };

  /*
   * Подготовленный план перестаёт быть готовым, как только макет изменился.
   *
   * Сравнивается ССЫЛКА на макет, а не его хэш. Ссылка меняется ровно на каждую
   * правку и стоит ноль, а хэш — полмиллисекунды SHA-256 по всему макету,
   * посчитанные только чтобы узнать то же самое. Разница в поведении одна:
   * возврат отменой к тому же содержимому тоже сбросит план — и это честнее,
   * чем держать план от другого объекта.
   */
  useEffect(() => {
    setInstallPlan(null);
  }, [design]);

  /* ---------- макет в зале ---------- */

  const template = getInteriorTemplate(
    design.templateRef.id,
    design.templateRef.version,
  );
  const armedProp = armedPropId ? getInteriorProp(armedPropId) : null;

  /*
   * Раскладка для сцены: комната шаблона, защищённые зоны, справочник типов и
   * сами объекты — числами. Контракта проекта сцена не знает и знать не должна:
   * зал обязан подниматься и на стенде окна, где проекта нет вовсе.
   *
   * Справочник уезжает целиком, а не только по расставленным типам: приманка
   * под указателем показывает объект, которого в макете ещё нет.
   */
  const layout = useMemo(() => {
    const level = new Map();
    for (const issue of report.errors) {
      if (issue.entityId) level.set(issue.entityId, "error");
    }
    for (const issue of report.warnings) {
      if (issue.entityId && !level.has(issue.entityId)) {
        level.set(issue.entityId, "warn");
      }
    }
    return {
      room: template?.room || null,
      /* Имя шаблона едет вместе с его числами: по нему сцена спрашивает игру
         про настоящее помещение, а числа одни на этот вопрос не отвечают. */
      roomId: template?.id || "",
      zones: template?.protectedVolumes || [],
      props: INTERIOR_PROPS.map((item) => ({
        id: item.id,
        label: item.label,
        colour: item.color,
        width: item.bounds.width,
        depth: item.bounds.depth,
        height: item.bounds.height,
        archetype: item.archetype,
        floorOffset: item.floorOffset,
      })),
      entities: design.entities.map((entity) => ({
        id: entity.id,
        propId: entity.propId,
        x: entity.position.x,
        y: entity.position.y,
        z: entity.position.z,
        yaw: quaternionToYaw(entity.rotation),
        hidden: entity.editor.hidden,
        locked: entity.editor.locked,
        level: level.get(entity.id) || "ok",
      })),
      selectedId,
      snap: design.settings.snap,
      rotationSnap: design.settings.rotationSnap,
    };
  }, [design, report, template, selectedId]);

  /*
   * План пола правимой комнаты. Тот же, что у сцены: по нему предмет
   * удерживается внутри стен — и когда его ведут мышью, и когда двигают
   * числами в полях рядом.
   */
  const plan = useMemo(
    () => createFloorPlan(template?.room || null),
    [template],
  );

  /**
   * Точка, в которой предмет помещается в комнату целиком.
   *
   * Мышь приходит сюда уже удержанной сценой, а поля ввода и клавиши — нет:
   * без этого «101» в поле X роняло редактор исключением из
   * `normalizeInteriorDesign` прямо в обработчике, а поворот у стены уводил
   * предмет углом в неё.
   */
  const held = (propId, next) => {
    const prop = getInteriorProp(propId);
    if (!prop) return next;
    const point = holdInRoom(plan, {
      x: next.x,
      y: next.y,
      yaw: next.yaw,
      width: prop.bounds.width,
      depth: prop.bounds.depth,
    });
    return { ...next, ...point };
  };

  /**
   * Что скажет проверка, если объект встанет сюда.
   *
   * Зовётся на каждом шаге протяжки, поэтому проект не клонируется: подменяется
   * одна запись в массиве, а `validateInteriorDesign` читает его и ничего не
   * пишет. Своей геометрии здесь нет намеренно — иначе подсказка под рукой и
   * строка в отчёте разошлись бы на первой же правке реестра.
   */
  /*
   * Обработчики ниже намеренно не завёрнуты в `useCallback`: сцена держит их в
   * ссылке (`InteriorPreview3D`, `bridge.current`), и от их постоянства ничего
   * не зависит, а память, собранная по неполному списку зависимостей, — верный
   * способ подвинуть объект в позапрошлой версии проекта.
   */
  const probe = ({ entityId, propId, x, y }) => {
    const id = entityId || PROBE_ID;
    const entities = entityId
      ? design.entities.map((entity) =>
          entity.id === entityId
            ? { ...entity, position: { ...entity.position, x, y } }
            : entity,
        )
      : [
          ...design.entities,
          {
            id,
            propId,
            position: { x, y, z: 0 },
            rotation: yawToQuaternion(0),
            surfaceId: "floor",
            editor: { locked: false, hidden: false, groupId: null },
          },
        ];
    const check = validateInteriorDesign({ ...design, entities });
    const failure = check.errors.find((issue) => issue.entityId === id);
    if (failure) return { level: "error", message: failure.message };
    const caution = check.warnings.find((issue) => issue.entityId === id);
    if (caution) return { level: "warn", message: caution.message };
    return { level: "ok", message: "" };
  };

  const placeArmed = ({ x, y }) => {
    if (!armedPropId) return;
    const spot = held(armedPropId, { x, y, yaw: 0 });
    const next = addInteriorEntity(design, armedPropId, {
      x: spot.x,
      y: spot.y,
    });
    const entity = next.entities.at(-1);
    setSelectedId(entity.id);
    setArmedPropId("");
    commit(next, `Добавлен объект «${getInteriorProp(armedPropId).label}»`);
  };

  /* ---------- отделка ---------- */

  /*
   * Своими картинками человек красит не одну поверхность: положив свой кафель
   * на пол, он тут же хочет тот же кафель на стены. Список собирается из самого
   * макета, поэтому переживает и закрытие редактора, и перезапуск приложения —
   * байты лежат в хранилище мастерской, а ссылка на них в проекте.
   */
  const brought = useMemo(() => {
    const seen = new Map();
    for (const item of design.finish) {
      if (!item.texture.startsWith("asset:") || seen.has(item.texture))
        continue;
      seen.set(item.texture, {
        reference: item.texture,
        /* Имени файла в макете нет и быть не должно: имя — это то, что человек
           видит, а не то, чем красят. Короткого хэша хватает, чтобы отличить
           две свои картинки друг от друга. */
        name: `картинка ${item.texture.slice(6, 12)}`,
      });
    }
    return [...seen.values()];
  }, [design.finish]);

  const paintSurface = (id, patch) => {
    const surface = surfaces.find((item) => item.id === id);
    const label = surface?.label || tr("поверхность");
    setFinishError("");
    commit(
      updateInteriorFinish(design, id, patch),
      patch.color !== undefined && patch.texture === undefined
        ? `Цвет: ${label}`
        : patch.color === "" && patch.texture === ""
          ? `Отделка снята: ${label}`
          : `Текстура: ${label}`,
    );
  };

  /*
   * Целая роль одним движением.
   *
   * Правка одна, поэтому и запись в истории одна: покраска пола из семи
   * деталей не должна требовать семи «отменить». Предел отделки при этом
   * общий (64 поверхности), и упереться в него на роли — обычное дело в
   * большом магазине: тогда честнее отказать, чем покрасить половину.
   */
  /*
   * Готовый набор интерьеров из папки.
   *
   * Половина работы приходит не из редактора, а папкой с вынутыми файлами:
   * витрины, стеллажи, прилавки. Раньше их ставили руками через OpenIV или
   * через вкладку арены — с чужим слотом, из-за которого арена и интерьеры
   * вытесняли друг друга. Здесь тот же движок и тот же контейнер, но свой
   * слот `interiors`.
   */
  const activeSet =
    [...(project.installations || [])]
      .reverse()
      .find(
        (item) =>
          item.kind === "local-legacy-interior-set" && item.status === "active",
      ) || null;

  const chooseSet = async () => {
    setSetError("");
    try {
      const chosen = await chooseArenaSource();
      if (!chosen?.source) return;
      const report = await inspectArenaSource({ sourceRoot: chosen.source });
      setSet({ sourceRoot: chosen.source, report });
      setSetPlan(null);
    } catch (error) {
      setSetError(error?.message || tr("Папку прочитать не удалось."));
    }
  };

  const prepareSet = async () => {
    if (!set) return;
    setSetBusy("plan");
    setSetError("");
    try {
      const payload = await installationPayload();
      const plan = await planArenaInstall({
        gameRoot: payload.gameRoot,
        sourceRoot: set.sourceRoot,
        targetId: payload.targetId,
        kind: "interiors",
      });
      setSetPlan({ plan, payload });
    } catch (error) {
      setSetError(error?.message || tr("Набор не удалось подготовить."));
    } finally {
      setSetBusy("");
    }
  };

  const applySet = async () => {
    if (!setPlan) return;
    setSetBusy("apply");
    setSetError("");
    try {
      const installed = await applyArenaInstall({
        gameRoot: setPlan.payload.gameRoot,
        sourceRoot: set.sourceRoot,
        targetId: setPlan.payload.targetId,
        kind: "interiors",
      });
      onInstallationChange?.(installed);
      setSetPlan(null);
    } catch (error) {
      setSetError(error?.message || tr("Набор не удалось поставить."));
    } finally {
      setSetBusy("");
    }
  };

  const removeSet = async () => {
    if (!activeSet) return;
    setSetBusy("remove");
    setSetError("");
    try {
      const removed = await removeArenaInstall({
        modId: activeSet.modId,
        targetId: activeSet.targetId,
      });
      onInstallationChange?.(removed);
    } catch (error) {
      setSetError(error?.message || tr("Набор не удалось снять."));
    } finally {
      setSetBusy("");
    }
  };

  const paintRole = (role, patch) => {
    const items = surfaces.filter((surface) => surface.role === role);
    if (!items.length) return;
    setFinishError("");
    try {
      let next = design;
      for (const surface of items)
        next = updateInteriorFinish(next, surface.id, patch);
      commit(
        next,
        patch.color
          ? `Цвет: ${items[0].label}`
          : `Отделка снята: ${items[0].label}`,
      );
    } catch (error) {
      setFinishError(
        error.message ||
          tr("Столько поверхностей отделка не удержит — покрасьте их по одной."),
      );
    }
  };

  const importTexture = async (id, file) => {
    setFinishError("");
    try {
      const texture = await importFinishTexture(file);
      commit(
        updateInteriorFinish(design, id, { texture: texture.reference }),
        `Своя текстура: ${texture.name}`,
      );
    } catch (error) {
      setFinishError(error.message || tr("Картинку не удалось прочитать."));
    }
  };

  /* Путь для тех, у кого кадра нет: без WebGL щёлкать по полу негде, а макет
     собирать всё равно надо — правки сохраняются и устанавливаются. */
  const placeAtCentre = () => {
    if (!template) return;
    placeArmed({
      x: snap(
        (template.room.minX + template.room.maxX) / 2,
        design.settings.snap,
      ),
      y: snap(
        (template.room.minY + template.room.maxY) / 2,
        design.settings.snap,
      ),
    });
  };

  const moveEntity = (entityId, { x, y, yaw }) => {
    const entity = design.entities.find((item) => item.id === entityId);
    if (!entity || entity.editor.locked) return;
    const turned = snap(yaw, design.settings.rotationSnap);
    const rotated =
      Number.isFinite(turned) &&
      Math.abs(turned - quaternionToYaw(entity.rotation)) > 0.5;
    /* Удержание повторяется и здесь, хотя сцена уже удержала точку: правку
       присылает не только мышь — тот же путь идёт из проверок и с клавиатуры. */
    const spot = held(entity.propId, {
      x,
      y,
      yaw: rotated ? turned : quaternionToYaw(entity.rotation),
    });
    const patch = { position: { x: spot.x, y: spot.y } };
    if (rotated) patch.yaw = turned;
    commit(updateInteriorEntity(design, entityId, patch), "Объект перемещён");
  };

  const rotateSelected = (by) => {
    if (!selected || selected.editor.locked) return;
    const yaw = quaternionToYaw(selected.rotation) + by;
    /* Поворот меняет след предмета: у стены он обязан отодвинуть предмет от
       неё, а не утопить его в ней углом. */
    const spot = held(selected.propId, {
      x: selected.position.x,
      y: selected.position.y,
      yaw,
    });
    commit(
      updateInteriorEntity(design, selected.id, {
        yaw,
        position: { x: spot.x, y: spot.y },
      }),
      "Объект повёрнут",
    );
  };

  const deleteSelected = () => {
    if (!selected || selected.editor.locked) return;
    const next = removeInteriorEntity(design, selected.id);
    setSelectedId(next.entities[0]?.id || null);
    commit(next, `Удалён объект «${selectedProp.label}»`);
  };

  useEffect(() => {
    const onKeyDown = (event) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement
      )
        return;
      if ((event.key === "Delete" || event.key === "Backspace") && selected) {
        event.preventDefault();
        deleteSelected();
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        hotkey(event) === "d" &&
        selected
      ) {
        event.preventDefault();
        const next = duplicateInteriorEntity(design, selected.id);
        setSelectedId(next.entities.at(-1).id);
        commit(next, `Создана копия «${selectedProp.label}»`);
      }
      /* Поворот с клавиатуры: то же, что ручка в инспекторе и колесо при
         зажатой кнопке, но не отрывая руки от расстановки. Shift — назад. */
      if (hotkey(event) === "r" && !event.ctrlKey && !event.metaKey) {
        if (!selected) return;
        event.preventDefault();
        rotateSelected(
          event.shiftKey
            ? -design.settings.rotationSnap
            : design.settings.rotationSnap,
        );
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  /*
   * Одна колонка, без вкладок.
   *
   * Раскладок здесь было две — свой левый столбец с локацией и списком и свой
   * правый с каталогом, — и обе стояли мимо общей рамки. Рамка держит один
   * инспектор, и это к лучшему: локация, пресеты, список, выбранный объект и
   * каталог — один и тот же разговор про макет, и разложенный по вкладкам он
   * заставляет щёлкать туда-сюда ради того, чтобы добавить стеллаж и тут же
   * увидеть, что он добавился.
   */
  const controls = (
    <>
      <section className="ui-panel">
        <h3>{tr("Локация")}</h3>
        <label className="interior-field">
          <span>{tr("Магазин")}</span>
          <select
            aria-label={tr("Локация интерьера")}
            value={location.id}
            onChange={(event) => {
              const next = createReplacementDesign(design, {
                locationId: event.target.value,
              });
              setSelectedId(null);
              commit(next, "Выбрана другая локация; макет очищен");
              onNotice?.(
                tr("Локация изменена. Предыдущий макет можно вернуть через «Отменить»."),
              );
            }}
          >
            {INTERIOR_LOCATIONS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label} · {item.region}
              </option>
            ))}
          </select>
        </label>
        <p className="interior-note">
          <ShieldCheck /> Build {location.supportedBuildIds[0]} · игровые
          координаты подтверждены
        </p>
        {/*
          Куда всё это денется — на виду, а не через два нажатия в диалоге.
          Человек, расставляющий автоматы, имеет право знать адрес: макет
          поедет в конкретный интерьер конкретного здания, и «24/7 · Strawberry»
          в списке — это выбор места в Лос-Сантосе, а не название набора.
        */}
        <p className="interior-note">
          <MapPin /> Объекты появятся внутри «{location.label}»
          {location.region ? `, ${location.region}` : ""} — в игре это точка{" "}
          {worldSpot(location)}. Файл мода:{" "}
          <code>{compilePlan.destination.entry}</code>.
        </p>
        {!location.installable && (
          <p className="interior-note is-blocked">
            <Warning /> Установка в игру для этой локации пока закрыта:
            помещение не прошло живой smoke-тест. Макет при этом сохраняется и
            выгружается файлом — он не пропадёт.
          </p>
        )}
      </section>

      <section className="ui-panel">
        <h3>{tr("Быстрый старт")}</h3>
        <div className="interior-presets">
          {INTERIOR_PRESETS.map((preset) => (
            <button
              type="button"
              key={preset.id}
              onClick={() => {
                const next = createReplacementDesign(design, {
                  presetId: preset.id,
                });
                setSelectedId(next.entities[0]?.id || null);
                commit(next, `Применён пресет «${preset.label}»`);
              }}
            >
              <SquaresFour />
              <span>
                <b>{preset.label}</b>
                <small>{preset.description}</small>
              </span>
            </button>
          ))}
        </div>
      </section>

      {/*
        Подпись говорит ровно то, что есть, и это стоило редактору половины
        доверия: первая обещала «макет добавляет только объекты», то есть что
        объекты в кадре и есть макет, — а объекты в кадр не попадали вовсе.
        Вторая честно предупреждала, что зал вокруг чужой — Auto Shop вместо
        магазина. Теперь вокруг настоящее помещение, и умолчать осталось об
        одном: обводка разрешённого места приходит из разметки комнат самой
        игры, а та со стенами сходится не везде.
      */}
      <p className="interior-note">
        <Eye /> Вокруг — само помещение «{template?.label}» из вашей GTA V: его
        стены, прилавок, полки и свет от Rockstar. Его можно перекрасить и
        перетекстурить прямо здесь, но в мод поедут только объекты: отделка
        живёт в предпросмотре и проекте, а освещения, дверей и игровых
        взаимодействий макет не трогает вовсе. Обводка по полу,{" "}
        {size(roomSpan(template).width)} × {size(roomSpan(template).depth)} м, —
        где объекты ставить можно: за неё они не выходят. Её границы взяты из
        разметки комнат самой игры, и со стенами они сходятся не везде.
      </p>

      {/*
        Отделка стоит прежде списка объектов: человек, открывший редактор,
        первым делом смотрит на само помещение — и первое, что он хочет с ним
        сделать, это перекрасить стены, а не поставить восьмой стеллаж.
      */}
      <InteriorFinishPanel
        surfaces={surfaces}
        finish={design.finish}
        selectedId={surfaceId}
        brought={brought}
        error={finishError}
        onSelect={setSurfaceId}
        onPaint={paintSurface}
        onPaintRole={paintRole}
        onImport={importTexture}
        onClear={() => {
          setFinishError("");
          commit(clearInteriorFinish(design), "Отделка снята");
        }}
      />

      {/*
        Готовый набор из папки — второй способ наполнить помещение: не
        расставить объекты руками, а поставить чужие файлы как есть. До сих пор
        такие наборы ставили через OpenIV или через вкладку арены, где они
        занимали чужой слот и вытесняли арену.
      */}
      {arenaInstallSupported() && (
        <section className="ui-panel interior-finish">
          <h3>{tr("Готовый набор из папки")}</h3>
          {activeSet ? (
            <>
              <p className="interior-note">
                Набор установлен: {activeSet.resourceCount || "—"} файлов в слое
                Astral. После снятия перезапустите игру.
              </p>
              <Button
                variant="ghost"
                size="sm"
                disabled={Boolean(setBusy)}
                onClick={removeSet}
              >
                {setBusy === "remove" ? tr("Снимаем…") : tr("Снять набор")}
              </Button>
            </>
          ) : (
            <>
              <p className="interior-note">
                {tr("Папка с вынутыми файлами интерьера: .ydr, .yft, .ytyp, .ytd. Ложатся в контейнер слоя Astral как есть, снимаются одной кнопкой. Свой слот: арену такой набор не вытесняет.")}
              </p>
              <div className="interior-finish-actions">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={Boolean(setBusy)}
                  onClick={chooseSet}
                >
                  {set ? tr("Другая папка") : tr("Выбрать папку")}
                </Button>
                {set && !setPlan && (
                  <Button
                    size="sm"
                    disabled={Boolean(setBusy)}
                    onClick={prepareSet}
                  >
                    {setBusy === "plan" ? tr("Проверяем…") : tr("Проверить набор")}
                  </Button>
                )}
                {setPlan && (
                  <Button
                    size="sm"
                    disabled={Boolean(setBusy)}
                    onClick={applySet}
                  >
                    {setBusy === "apply" ? tr("Ставим…") : tr("Поставить в игру")}
                  </Button>
                )}
              </div>
              {set && (
                <p className="interior-note">
                  {`${set.sourceRoot} — ${set.report?.files?.length || 0} файлов`}
                  {setPlan
                    ? `. Готово к записи: ${setPlan.plan.resourceCount} ресурсов`
                    : ""}
                </p>
              )}
            </>
          )}
          {setError && <p className="interior-note is-warning">{setError}</p>}
        </section>
      )}

      {/*
        Расстановки объектов здесь больше нет.

        Каталог пропов, список поставленных объектов и правка выбранного
        занимали три четверти панели, а нужны они были ради того, чего в
        помещении и так хватает: магазин из игры приезжает со своими
        стеллажами, витринами и холодильниками. Редактор оставлен под то,
        ради чего его открывают, — отделку: цвет и текстуру поверхностей,
        которые видно в кадре.
      */}
    </>
  );

  return (
    <EditorShell
      className="interior-editor"
      inspectorClassName="interior-controls"
      onBack={onCancel}
      kicker={tr("Мастерская")}
      title={tr("Интерьеры")}
      status={`${project.name} · ${
        dirty ? tr("Есть несохранённые изменения") : tr("Проект сохранён")
      }`}
      actions={
        <EditorActions
          onUndo={onUndo}
          canUndo={canUndo}
          onRedo={onRedo}
          canRedo={canRedo}
          more={[
            {
              value: "save",
              label: tr("Сохранить проект"),
              icon: <FloppyDisk />,
            },
            {
              value: "export",
              label: tr("Экспорт .interior.json"),
              icon: <DownloadSimple />,
            },
          ]}
          onMore={(action) => {
            if (action === "save") return onSave();
            downloadDesign(design);
            /* Браузер кладёт файл молча, и человек не знает ни имени, ни
               того, что что-то вообще произошло. */
            return onNotice?.(
              `Файл «${design.id}.interior.json» ушёл в загрузки.`,
            );
          }}
          onCancel={onCancel}
          apply={{
            /* Проверка макета — шаг внутри установки, а не отдельная цель:
               окно плана открывается той же кнопкой, что и везде. */
            label: tr("Применить"),
            title: tr("Проверить макет и поставить его в игру"),
            onClick: () => setPlanOpen(true),
          }}
        />
      }
      inspector={controls}
    >
      <InteriorPreview3D
        layout={layout}
        /* Как называется то, что стоит в кадре. Кадр показывает помещение
           проекта, и подпись под ним обязана называть его же, а не «зал». */
        roomLabel={template ? `${location.label} · ${template.label}` : ""}
        armedPropId={armedPropId}
        armedLabel={armedProp?.label || ""}
        onSelect={setSelectedId}
        onPlace={placeArmed}
        onMove={moveEntity}
        probe={probe}
        onCancelArmed={() => setArmedPropId("")}
        onPlaceAtCentre={placeAtCentre}
        finish={design.finish}
        selectedSurfaceId={surfaceId}
        onSurfaces={setSurfaces}
        onPickSurface={setSurfaceId}
        loadTexture={loadFinishTexture}
      />

      <footer
        className={`interior-validation-bar${report.valid ? "" : " has-errors"}`}
      >
        {report.valid ? <Check /> : <Warning />}
        <span>
          <b>
            {report.valid
              ? tr("Геометрия корректна")
              : `${counted(report.errors.length, [tr("ошибка"), tr("ошибки"), tr("ошибок")])} в макете`}
          </b>
          <small>
            {counted(report.warnings.length, [
              tr("предупреждение"),
              tr("предупреждения"),
              tr("предупреждений"),
            ])}{" "}
            · стоимость {report.estimatedCost} · {report.uniquePropCount}/32
            типов
          </small>
        </span>
        <Button variant="ghost" size="sm" onClick={() => setPlanOpen(true)}>
          {tr("Подробнее")}
        </Button>
      </footer>

      <Dialog
        open={planOpen}
        onClose={() => setPlanOpen(false)}
        className="interior-plan"
        kicker={tr("Проверка и план")}
        title={
          installPlan
            ? tr("План установки готов")
            : compilePlan.eligible
              ? tr("Макет готов к компиляции")
              : tr("Макет сохранится, установка закрыта")
        }
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPlanOpen(false)}
            >
              {tr("Вернуться к макету")}
            </Button>
            {activeInstall && (
              <Button
                variant="ghost"
                size="sm"
                icon={<Trash />}
                disabled={Boolean(installBusy)}
                onClick={removeInstall}
              >
                {tr("Удалить из GTA")}
              </Button>
            )}
            <Button
              variant="primary"
              size="sm"
              icon={<ShieldCheck />}
              disabled={!compilePlan.eligible || Boolean(installBusy)}
              title={compilePlan.blockers[0] || tr("Подготовить установку")}
              onClick={installPlan ? applyInstall : planInstall}
            >
              {installBusy
                ? tr("Выполняется…")
                : installPlan
                  ? tr("Применить в GTA")
                  : tr("Подготовить установку")}
            </Button>
          </>
        }
      >
        <dl className="interior-plan-facts">
          <div>
            <dt>{tr("Локация")}</dt>
            <dd>{location.label}</dd>
          </div>
          <div>
            <dt>{tr("Где в игре")}</dt>
            <dd>
              {location.region} · {worldSpot(location)}
            </dd>
          </div>
          <div>
            <dt>{tr("Объекты")}</dt>
            <dd>{compilePlan.entities.length}</dd>
          </div>
          <div>
            <dt>{tr("Хэш дизайна")}</dt>
            <dd>
              <code>{shortHash(compilePlan.designHash)}</code>
            </dd>
          </div>
          <div>
            <dt>{tr("Слот")}</dt>
            <dd>
              <code>{compilePlan.destination.atomicSlot}</code>
            </dd>
          </div>
          <div>
            <dt>{tr("Будущий YMAP")}</dt>
            <dd>
              <code>{compilePlan.destination.entry}</code>
            </dd>
          </div>
        </dl>
        {!!report.errors.length && (
          <div className="interior-plan-block is-danger">
            <b>{tr("Исправьте ошибки")}</b>
            {report.errors.map((issue) => (
              <p key={`${issue.code}-${issue.path}`}>{issue.message}</p>
            ))}
          </div>
        )}
        {!!compilePlan.blockers.length && (
          <div className="interior-plan-block is-warning">
            <b>{tr("Почему нельзя применить в игру")}</b>
            {compilePlan.blockers.map((message) => (
              <p key={message}>{message}</p>
            ))}
          </div>
        )}
        {installPlan && (
          <div className="interior-plan-block is-positive">
            <b>
              <Package /> SafeSwitch готов
            </b>
            <p>{installPlan.plan.entry}</p>
            <p>
              {installPlan.plan.entityCount} объектов ·{" "}
              {installPlan.plan.artifactBytes} байт · rollback готов
            </p>
          </div>
        )}
        {installError && (
          <div className="interior-plan-block is-danger">
            <b>{tr("Установка не выполнена")}</b>
            <p>{installError}</p>
          </div>
        )}
      </Dialog>
    </EditorShell>
  );
}
