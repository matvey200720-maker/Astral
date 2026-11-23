/*
 * «Применить» мастерской: покраска — в игру, и обратно.
 *
 * Что именно едет и куда, решает профиль (`profile.skin`): ствол
 * запекается в свои текстуры в Astral Weapons DLC, вещь одежды — в текстуру
 * вещи и ложится на вещь сервера, которую человек выбирает в инструменте
 * «Замена» (`skin.chooseTarget`, ТЗ 04.10, задача 8). Здесь — общий ход:
 * снимок проекта в момент нажатия, очередь «Применить», память о том, что
 * стоит в игре, и снятие.
 */

import { useEffect, useMemo, useState } from "react";
import {
  colourTextureName,
  findTemplate,
  gameGlowRequest,
  modelTintOf,
  normalizeModelGlow,
  normalizeModelMaterial,
  normalizeModelOpacity,
  normalizeDecorations,
  normalizeModelScale,
  normalizeProjectAttachments,
  projectTouchesAttachments,
  projectTouchesDecorations,
  projectTouchesModel,
  projectTouchesScale,
  projectTouchesTextures,
  serializeGunProject,
  customModelHash,
  ownMagazineMode,
  projectOwnFit,
} from "@modovik/gun-studio";
import { weaponByModel } from "@modovik/rpf-inspector/weapon-identity";
import { decorationImagesFor } from "./decoration-images.js";
import { activeLooks, attachmentLooksIndex, lookRequests } from "./attachment-looks.js";
import { ownModelDataUrl } from "./own-model-data.js";
import {
  REPLACING_INSTALL_STEPS,
  applyWorkshopWork,
  useWorkshopApplyButton,
  workSignature,
} from "../../../../features/workshop/install-queue/index.js";
import { linkedEditorWork } from "../../../../features/workshop/works/workshop-works.js";
import { tattooWorkId } from "../../../../features/clothing/tattoo-parts.js";
import { skippedWords } from "../../../../features/clothing/tattoo-words.js";
import { doneTextOfQueue } from "../../../../features/clothing/install-words.js";
import { tr } from "../../../../locales/ui.js";
import { count, fill, tl, trKey } from "./gun-copy.js";

const noun = (profile, form) => profile?.noun?.[form] || "";

/* Итог установки словами: что не легло (слова Desktop — на языке окна) и какие тату других работ сменились. */
function installedWords(skin, { record, displaced } = {}) {
  const placed = record?.skipped?.length
    ? fill(tr("{placed}. Не легло: {list}"), { placed: skin.words.placed, list: record.skipped.map(skippedWords).join("; ") })
    : skin.words.done;
  return displaced?.length ? `${placed}. ${fill(tr("Сменились тату других работ: {list}"), { list: displaced.join(", ") })}` : placed;
}

/**
 * С тела сняли всё, что ставила работа: новых пакетов нет, прежние — снять той же очередью. `identity` — `{ workId, name }`. Возвращает, встала ли работа в очередь.
 */
export function retireTattooWorkFromGame({ key, identity, title, editor, skin, notify = null }) {
  return applyWorkshopWork({
    key: `astral.gun-studio.install:${key}`,
    signature: workSignature({ retire: identity.workId, key }),
    title: `${tr("Как в игре")} — ${title}`,
    editor,
    waitForGame: true,
    notify: (text, tone) => notify?.(text, tone),
    savedText: fill(tr("Снимаем {skin} из игры"), { skin: tr("тату") }),
    run: () => skin.retireWork(key, identity),
    doneText: () => skin.words.removed,
  });
}

export function useSkinInstall({
  profile,
  slotId,
  slotName,
  model,
  project,
  surfaces,
  onNotice,
  catalogItems,
  /* Установленные моды каталога (id): виды обвесов — только у скачанных ганпаков (ТЗ 24.10.2026, п. 4). */
  installedIds = null,
  serverTattoos = null,
  /* Скин каталога: «Применить» берёт его в «Мои паки» и ставит в игру уже
     с пака (`target.take`) — одной кнопкой, без отдельного шага. */
  onTakeAndApply = null,
  /* Одежда (задача 8): что выбрано в «Замене» для вещи с ключом `key` —
     целями установки, — и куда вести «Применить», если ничего. */
  chosenTargetsFor = null,
  /* Занятые вещи (задача 4 ТЗ 05.10.2026): какие заменёнки человек
     согласился заменить и осталась ли вещь без ответа. */
  chosenReplaceFor = null,
  onNeedTarget = null,
  /* Картинка вещи для строки «Загрузок» (иконка ствола из игры). */
  coverImage = "",
  /* Кадр покраски для пары «вещь → заменёнка» в библиотеке. */
  paintShot = null,
  /* Детали обвесов в кадре своей модели (слой обвесов сцены): их покраска
     едет в игру вместе с обвесами, а покраска самой модели — нет. */
  attachmentMaterials = null,
  /* Расцветка вещи игры по номеру (30.10.2026): красили её — в её текстуру и печётся; нет номера — лицо вещи. */
  texture = null,
}) {
  const skin = profile.skin;
  const target = skin.target(model, slotId, { catalogItems, serverTattoos, texture });
  /* Предмет, место которого известно (тату сервера), ставится сразу. */
  const chooses = Boolean(skin.chooseTarget && !target?.direct);
  const key = target?.key || "";
  const chosenTargets = chooses ? chosenTargetsFor?.(key) || null : null;
  const installable = Boolean(target?.installable);
  /* Размер и прозрачность модели (задача 2 ТЗ 05.10.2026) едут только у
     ствола из игры: модель пака — авторская, её Astral не перешивает. */
  const shapes = Boolean(
    target &&
      !target.pack &&
      (typeof skin.shapeInGame === "function"
        ? skin.shapeInGame(target)
        : skin.shapeInGame),
  );
  /* Размер ствола пака и скина каталога (29.10.2026): модель пака растёт в пакете скина; скин каталога «Применить» сперва берёт в
     «Мои паки». Материал и прозрачность у такой модели не едут — только размер. */
  const packShapes = Boolean(target && (target.pack || target.take) && skin.packShapeInGame);
  /* Своя модель ствола из .glb (задача 6 ТЗ 17.10.2026): сама по себе —
     уже то, что ставится, — её модель встаёт вместо модели ствола. */
  const own = Boolean(target?.own);
  /* Украшения (задача 13 ТЗ 10.10.2026) — геометрией в модели: у ствола
     из игры, у своей модели и (ТЗ 17.10.2026) у ствола пака и скина
     каталога — каталог «Применить» сперва берёт в «Мои паки». */
  const decorates = Boolean(target && (installable || target.take) && skin.decorationsInGame);
  /* Обвесы на стволе (задача 6 ТЗ 17.10.2026) — у ствола из игры: встают
     в его модель и в модели штатных обвесов. У ствола пака (19.10.2026) —
     вшиваемые, в модель пака; скин каталога «Применить» сперва берёт в «Мои
     паки». Что едет с этой целью — `skin.attachmentsOf`. */
  const attaches = Boolean(target && (installable || target.take) && skin.attachmentsInGame);
  const attachmentsOf = (value) =>
    skin.attachmentsOf ? skin.attachmentsOf(target, value) : normalizeProjectAttachments(value);
  const touchesAttachments = (value) =>
    attaches && projectTouchesAttachments(value) && Object.keys(attachmentsOf(value.attachments)).length > 0;
  const touched =
    own ||
    projectTouchesTextures(project) ||
    (shapes && projectTouchesModel(project)) ||
    (packShapes && projectTouchesScale(project)) ||
    (decorates && projectTouchesDecorations(project)) ||
    touchesAttachments(project);
  const installKey = `astral.gun-studio.install:${key || slotId}`;
  const signature = useMemo(
    () => workSignature({ slot: slotId, model: model?.id, project }),
    [slotId, model?.id, project],
  );
  const applyButton = useWorkshopApplyButton(installKey, signature);
  /* Снятие идёт очередью под ключом установки: пока там работа этого
     предмета, второго снятия нет. */
  const removing = applyButton.pending;
  /* Память об установке — по предмету игры: из одной мастерской револьвера
     можно поставить скин и на флотский, и на MK2, из «Масок» — на любую. */
  const [installed, setInstalled] = useState(() =>
    key ? skin.installOf(key) : null,
  );
  useEffect(() => {
    setInstalled(key ? skin.installOf(key) : null);
    if (!key) return undefined;
    return skin.subscribe(() => setInstalled(skin.installOf(key)));
  }, [skin, key]);
  /* Возвращает, встала ли работа в очередь: скрытая установка из сборки
     (Т-155в) по этому судит об итоге. `options.name` — имя работы из кода. */
  async function applyToGame(destinations = null, options = {}) {
    /* Картинки слоёв и наклейки холсты собирают после загрузки модели: скрытая студия приходит сюда по таймеру, и без ожидания уехало бы только то, что успело напечататься (разбор 01.11.2026). */
    await surfaces.settled?.();
    /* Работа с тела по частям (01.11.2026): каждая часть — своей картинкой (только её слои), на своём тату; снимок и очередь те же, что у покраски. */
    if (options.parts?.length) return applyTattooParts(options.parts, options);
    const reshaped = shapes && projectTouchesModel(project);
    const rescaled = packShapes && projectTouchesScale(project);
    const decorated = decorates && projectTouchesDecorations(project);
    const attached = touchesAttachments(project);
    /* Вещь «как есть» (31.10.2026): комплект ставит всё надетое, и вещь без правок тоже встаёт на выбранную вещь сервера своей текстурой — красить нечего. Только когда место выбрано (`destinations`): без него «Применить» без правок по-прежнему ничего не ставит. */
    const asIs = options.asIs === true && Boolean(destinations?.length) && target?.source?.kind !== "tattoo-body";
    if (!installable || !(asIs || own || projectTouchesTextures(project) || reshaped || rescaled || decorated || attached)) return false;
    /* Своя модель — с подгонкой из «Оружия»; без неё модель встала бы
       где попало. */
    const ownFit = own ? projectOwnFit(project.ownFit) : null;
    if (own && !ownFit) {
      onNotice?.(tr("Своя модель ещё не подогнана к стволу — открой «Модели» → «Своя модель»"), "error");
      return false;
    }
    /* В игру уедет покраска момента нажатия, а не та, что будет в
       редакторе, когда дойдёт очередь. */
    const snapshot = project;
    /* Перенос на женскую пару (ТЗ 29.10.2026): та же покраска, но источник — женская пара мужской вещи, цели женские, а установка — своя (`+f`), чтобы
       мужская заменёнка этой работы стояла рядом. */
    const chosen = options.transfer
      ? { ...target, key: `${target.key}+f`, wear: { ...target.wear, gender: "female" }, source: { ...target.source, transfer: options.transfer } }
      : target;
    /* Тело для тату — только чернила (`skin.bare`): кожа остаётся игры.
       Без покраски (только размер или прозрачность) печь нечего. */
    /* У своей модели в игру едут картинки её .glb: покраска студии на ней
       пока остаётся в кадре (сказано в «Оружии»). Едет только покраска
       выбранных обвесов — они вшиваются в модель ствола полки с цветом из
       кадра. */
    const ownLayer = own && attached && attachmentMaterials?.length > 0;
    const textures = projectTouchesTextures(snapshot) && (!own || ownLayer)
      ? await surfaces.bakeTextures(colourTextureName, {
          ...(skin.bare?.(chosen) ? { bare: true } : {}),
          ...(own ? { only: new Set(attachmentMaterials) } : {}),
        })
      : [];
    /* Отделённые куски развёртки (`gun-detach.js`) — копиями поверх ствола. */
    const paintPieces = textures.length && decorates ? surfaces.takePaintPieces?.() || [] : [];
    const ownModel = own
      ? {
          glb: await ownModelDataUrl(model),
          hash: customModelHash(model),
          fit: ownFit,
          magazine: ownMagazineMode(snapshot.ownMagazine),
        }
      : null;
    if (!textures.length && !reshaped && !rescaled && !decorated && !ownModel && !attached && !asIs) {
      onNotice?.(tr("Красить в игре пока нечего"), "error");
      return false;
    }
    /* Украшения — видимые; логотипы и голограммы — PNG своих картинок
       (голограмма-надпись — нарисованная шрифтом). Картинки нет на этом
       компьютере (работа с чужого) — украшение не едет, и это сказано. */
    const decorations = decorated
      ? normalizeDecorations(snapshot.decorations).filter((item) => item.visible)
      : [];
    const logos = decorations.length
      ? await decorationImagesFor(decorations)
      : { images: {}, missing: [] };
    /* «Вид из каталога» у обвесов (ТЗ 23.10.2026): моды, чьи модели обвесов встанут в игру вместо игровых. */
    const looks = attached
      ? await lookRequests(
          activeLooks({
            weapon: weaponByModel(target?.request?.model || "")?.id || "",
            selection: attachmentsOf(snapshot.attachments),
            chosen: snapshot.attachmentLooks,
            index: attachmentLooksIndex(catalogItems, { installed: installedIds }),
          }),
          catalogItems,
        )
      : null;
    if (logos.missing.length)
      onNotice?.(
        logos.missing.length > 1
          ? fill(
              tr("Картинок {n} украшений (логотип, голограмма) нет на этом компьютере — в игру они не встанут"),
              { n: logos.missing.length },
            )
          : tr("Картинки украшения (логотип, голограмма) нет на этом компьютере — в игру оно не встанет"),
        "error",
      );
    /* Светящиеся детали (Т-59) — только у ствола из игры и только среди
       запечённых: шейдер перешивается у детали, чья покраска едет. */
    const baked = new Set(textures.map((item) => item.texture.toLowerCase()));
    const glow =
      skin.glowInGame && !chosen?.pack
        ? gameGlowRequest(snapshot, colourTextureName).filter((item) =>
            baked.has(item.texture.toLowerCase()),
          )
        : [];
    const name =
      options.name ||
      linkedEditorWork(profile.workKind, undefined, slotId)?.name ||
      tl(findTemplate(snapshot.template)?.label.ru || "") ||
      slotName ||
      tr("Скин");
    const item =
      model?.source === "game" ? model.name : slotName || profile.noun.one;
    return applyWorkshopWork({
      key: options.transfer ? `${installKey}:female` : installKey,
      signature,
      title: destinations?.length
        ? `${name} → ${
            destinations.length > 1
              ? chosen?.body
                ? `${destinations.length} ${tr("тату")}`
                : fill(tr("{items} сервера"), {
                    items: count(destinations.length, trKey("вещь|вещи|вещей")),
                  })
              : destinations[0].name
          }`
        : `${name} — ${item}`,
      editor: profile.workLabel,
      coverImage,
      steps: REPLACING_INSTALL_STEPS,
      /* GTA V открыта — работа ждёт её закрытия и встаёт сама. */
      waitForGame: true,
      notify: (text, tone) => onNotice?.(text, tone),
      savedText: skin.words.saving,
      run: ({ report }) =>
        skin.install({
          target: chosen,
          destinations,
          name,
          textures,
          glow,
          /* Окно «Сделать заменёнку» отдаёт согласие заменить занятые сразу (`options.replace`): состояние мастерской обновится только к следующему кадру. */
          ...(chooses ? { replace: options.replace || chosenReplaceFor?.(key) || [] } : {}),
          ...(chooses && options.server ? { server: options.server } : {}),
          ...(asIs && !textures.length ? { asIs: true } : {}),
          cover: (asIs && !textures.length ? "" : paintShot?.()) || "",
          ...(reshaped
            ? {
                scale: normalizeModelScale(snapshot.modelScale),
                opacity: normalizeModelOpacity(snapshot.modelOpacity),
                /* Материал ствола (задача 1 ТЗ 06.10.2026). */
                material: normalizeModelMaterial(snapshot.modelMaterial),
                tint: modelTintOf(snapshot),
                materialGlow: normalizeModelGlow(snapshot.modelGlow),
              }
            : {}),
          ...(rescaled ? { scale: normalizeModelScale(snapshot.modelScale) } : {}),
          ...(decorations.length
            ? { decorations, decorationImages: logos.images }
            : {}),
          ...(paintPieces.length ? { paintPieces } : {}),
          ...(ownModel ? { ownModel } : {}),
          ...(attached ? { attachments: attachmentsOf(snapshot.attachments) } : {}),
          ...(looks ? { looks } : {}),
          state: JSON.stringify({
            slot: slotId,
            project: JSON.parse(serializeGunProject(snapshot)),
          }),
          report,
        }),
      /* Оговорки после установки (14.11.2026): регистрация DLC, папка игры у клиентов, кто увидит заменёнку — вместо «установлена в GTA V» (`install-words.js`). */
      doneText: (result) => doneTextOfQueue(result, name, installedWords(skin, result)),
    });
  }

  async function applyTattooParts(picks, options) {
    if (!installable) return false;
    const snapshot = project;
    const parts = [];
    for (const pick of picks) {
      const textures = await surfaces.bakeTextures(colourTextureName, {
        bare: true,
        only: new Set([pick.part.material]),
        layers: new Set(pick.part.layers),
        stickers: Boolean(pick.part.stickers),
      });
      if (textures.length) parts.push({ id: pick.part.id, target: pick.target, stay: pick.stay === true, textures });
    }
    if (!parts.length) {
      onNotice?.(tr("Красить в игре пока нечего"), "error");
      return false;
    }
    const destinations = parts.map((part) => part.target);
    const linked = linkedEditorWork(profile.workKind, undefined, slotId);
    const name = options.name || linked?.name || slotName || tr("Скин");
    return applyWorkshopWork({
      key: installKey,
      signature,
      title: `${name} → ${destinations.length > 1 ? `${destinations.length} ${tr("тату")}` : destinations[0].name}`,
      editor: profile.workLabel,
      coverImage,
      steps: REPLACING_INSTALL_STEPS,
      /* GTA V открыта — работа ждёт её закрытия и встаёт сама. */
      waitForGame: true,
      notify: (text, tone) => onNotice?.(text, tone),
      savedText: skin.words.saving,
      run: ({ report }) =>
        skin.install({
          target,
          destinations,
          parts: parts.map((part) => ({ target: part.target.key, stay: part.stay, textures: part.textures })),
          /* Что на какое тату: следующее «Применить» откроется с этим выбором. */
          chosen: parts.map((part) => ({ part: part.id, target: part.target.key })),
          /* Та же работа сменяет свои прежние пакеты. */
          workId: tattooWorkId(linked),
          name,
          textures: [],
          state: JSON.stringify({ slot: slotId, project: JSON.parse(serializeGunProject(snapshot)) }),
          report,
        }),
      /* Режим RP (21.11.2026): картинка тату осталась в Astral Clothing DLC — слова вместо «установлено» (как у основного пути выше). */
      doneText: (result) => doneTextOfQueue(result, name, installedWords(skin, result)),
    });
  }

  /*
   * Снятие — той же очередью «Применить»: ход виден в «В процессе», а не
   * серой кнопкой. После нативного патча (эффекты ствола) снятие сначала
   * готовит игру, и на большой установке это минуты (04.10.2026). Открытая
   * GTA V — работа ждёт её закрытия, как установка.
   */
  function removeFromGame() {
    const item =
      model?.source === "game" ? model.name : slotName || profile.noun.one;
    void applyWorkshopWork({
      key: installKey,
      signature,
      title: `${tr("Как в игре")} — ${item}`,
      editor: profile.workLabel,
      waitForGame: true,
      notify: (text, tone) => onNotice?.(text, tone),
      savedText: fill(tr("Снимаем {skin} из игры"), {
        skin: noun(profile, "skin") || tr("скин"),
      }),
      run: () => skin.uninstall(key),
      doneText: () => skin.words.removed,
    });
  }

  /* Кнопка в полосе редактора — с объяснением, почему она серая. У одежды
     она есть всегда (co-founder, 26.09): без вещи в кадре — погашена и
     говорит, откуда её взять. */
  /* «Стандарт» (ТЗ 04.10): покраски нет, а скин этого ствола стоит в игре —
     «Применить» снимает его, и в игре снова заводской ствол. */
  /* Только у того, что само ставится в игру: у модели каталога ключ
     установки — заводской ствол, и «снять» сняло бы чужой скин. */
  const stockRemoves =
    Boolean(target) && installable && !chooses && !touched && Boolean(installed);
  const bodyInGame = Boolean(target?.body && installed);
  /* Скин каталога с покраской: взять в «Мои паки» и поставить оттуда. */
  const takesAndApplies = Boolean(
    target?.take && !installable && touched && onTakeAndApply,
  );
  const apply = takesAndApplies
    ? {
        label: tr("Применить"),
        onClick: () => onTakeAndApply(target.take),
        disabled: false,
        busy: applyButton.busy,
        meter: applyButton.meter,
        title:
          tr("Взять скин каталога в «Мои паки» и поставить в игру вместе с его текстурой и твоей покраской"),
      }
    : stockRemoves
    ? {
        label: tr("Применить"),
        onClick: removeFromGame,
        disabled: removing,
        busy: applyButton.busy,
        meter: applyButton.meter,
        title: fill(
          tr("Как в игре: снять {skin} из игры — в игре снова заводской {one}"),
          profile.noun,
        ),
      }
    : !target
    ? skin.chooseTarget
      ? {
          label: tr("Применить"),
          /* Вещь не выбрана — «Применить» ведёт в «Модели» (задача 3 ТЗ
             06.10, вечер), а не стоит серой: там и выбирают, что ставить. */
          onClick: () => onNeedTarget?.("model"),
          disabled: false,
          busy: false,
          title: skin.missingTitle?.(slotId) || skin.missing,
        }
      : null
    : {
        label: tr("Применить"),
        /* Вещь сервера выбирается в окне «Сделать заменёнку» — то же, что «Установить мод» в каталоге (владелец, 29.10.2026, `ref/32`); оно открывается каждым «Применить»,
           а покраска встаёт в очередь по его «Сделать заменёнку». */
        onClick: () => (!chooses ? void applyToGame() : onNeedTarget?.("target")),
        /* С тела всё сняли, а работа стоит в игре: окно скажет, что снимется. */
        disabled: !installable || (!touched && !bodyInGame),
        busy: applyButton.busy,
        meter: applyButton.meter,
        title:
          applyButton.hint ||
          (!installable
            ? target?.reason || tr("Эта модель в игру не ставится")
            : !touched && !bodyInGame
              ? fill(tr("Покрась {acc} — ставить пока нечего"), profile.noun)
              : target.direct
                ? tr("Запечь покраску в картинку тату и поставить в GTA V")
                : chooses && !chosenTargets?.length
                  ? target.body
                    ? tr("«Применить» откроет окно: какие тату игры заменить")
                    : tr("«Применить» откроет окно: на какую вещь сервера поставить")
                  : chooses
                    ? `${fill(tr("Запечь покраску и поставить на «{name}»"), { name: chosenTargets[0].name })}${chosenTargets.length > 1 ? ` ${fill(tr("и ещё {n}"), { n: chosenTargets.length - 1 })}` : ""}`
                    : own
                      ? fill(tr("Поставить свою модель вместо «{name}» в GTA V — с украшениями"), { name: slotName || profile.noun.one })
                      : skin.words.action),
      };

  return {
    target,
    installable,
    installed,
    removing,
    apply,
    applyToGame,
    removeFromGame,
    /* Вещь ставится на выбранную в «Замене» вещь сервера. */
    chooses,
    /* Украшения этой модели доезжают до игры (задача 13). */
    decorates,
    /* Своя модель ствола встаёт вместо модели ствола игры. */
    own,
  };
}
