/*
 * «Свои облака»: состояние конструктора в редакторе неба.
 *
 * Конструктор правит черновик — обычный объект шаблона (`own-cloud-templates`: `{ id, name, lighting, motion, layers, style }`),
 * а не проект. Кадр показывает черновик живьём: вид для кадра — это вид проекта с черновиком в списке своих и выбранным
 * (`previewLook`), тем же путём, каким его потом запишет установка. В проект и личный список черновик попадает только по
 * «Сохранить». Пределы — пакет (`normalizeOwnCloudTemplate`), здесь их не повторяем: что пакет не принял, того в
 * сохранённом нет, и кнопка говорит почему.
 */

import { useCallback, useMemo, useState } from "react";
import {
  LOOK_SLOT_GROUPS,
  OWN_CLOUD_LIMITS,
  cloudTemplateReport,
  createLook,
  lookCloudTemplateSlot,
  normalizeLook,
  normalizeOwnCloudTemplate,
  ownCloudFromTemplate,
  ownCloudId,
  patchSlots,
  removeOwnCloudTemplate,
  saveOwnCloudTemplate,
  setCloudTemplate,
} from "@modovik/timecycle";
import { tr } from "../../../../locales/ui.js";
import {
  cloudModelFamilies,
  cloudModelsOf,
  cloudMotionChoices,
  forgetPersonalCloud,
  mergeOwnClouds,
  ownCloudSignature,
  readPersonalClouds,
  rememberPersonalCloud,
} from "./own-clouds.js";
import { useCloudModelThumbnails, useOwnCloudThumbnails } from "./sky-thumbnails.js";

/* Пустой черновик: стиль — единицы (свет игры без множителей), слоёв нет. */
const BLANK_STYLE = Object.freeze({ diffuse: 1, fill: 1, ambient: 1, edges: 1, lining: 1, relief: 1 });

/* Части суток, у которых свой цвет облаков: «День», «Закат» (вечер), «Ночь» — срезы вида (`LOOK_SLOT_GROUPS`). */
export const CLOUD_TIME_COLOURS = Object.freeze([
  { id: "day", label: "День" },
  { id: "evening", label: "Закат" },
  { id: "night", label: "Ночь" },
]);

const slotsOf = (id) => LOOK_SLOT_GROUPS.find((group) => group.id === id)?.slots || [];

/* Шаблон из одного слоя — плитка модели в сетке выбора слоя. */
const modelTemplate = (model, motion) => ({
  id: "own-modelthumb",
  name: model.file,
  lighting: "MEDIUMclouds",
  motion,
  layers: [[model.hat, model.file]],
  style: BLANK_STYLE,
});

/**
 * @param {object} args
 * @param {object} args.look вид проекта
 * @param {(update: (look: object) => object, label?: string) => void} args.commit запись в проект (история, «Отменить»)
 * @param {object|null} args.cloudBases разобранные файлы облаков игрока (`parseCloudBases`) или `null`
 * @param {object|null} args.cloudScene сцена миниатюр (`{ key, hats, gameRoot, parsed }`) или `null`
 * @param {object} args.document основа неба для миниатюр
 * @param {string} args.baseKey ключ основы
 */
export function useOwnClouds({ look, commit, cloudBases, cloudScene, document, baseKey }) {
  const [personal, setPersonal] = useState(readPersonalClouds);
  const [draft, setDraft] = useState(null);
  const own = look.clouds.own;
  const list = useMemo(() => mergeOwnClouds(own, personal), [own, personal]);
  const hats = cloudBases?.hats || null;
  const families = useMemo(() => cloudModelFamilies(hats), [hats]);
  const motions = useMemo(() => cloudMotionChoices(hats), [hats]);
  const models = useMemo(() => cloudModelsOf(families), [families]);
  const defaultMotion = motions[0]?.hat || "Cloudy 01";

  /* Недоступно ли: без файлов облаков игрока собирать не из чего, а слот занят модом — собранное не встанет. */
  const unavailable = !cloudBases
    ? tr("Файлы облаков вашей игры не прочитаны: конструктору не из чего собирать")
    : !lookCloudTemplateSlot(cloudBases.hats, cloudBases.keyframes)
      ? tr("В вашей игре этим облакам нет места: облака заменил мод")
      : "";

  /* Черновик для кадра: имя пустое — подставляется временное, чтобы пакет принял шаблон. */
  const draftTemplate = useMemo(() => {
    if (!draft) return null;
    return normalizeOwnCloudTemplate({ ...draft.raw, name: draft.raw.name?.trim() || "…" }).template;
  }, [draft]);
  const previewLook = useMemo(
    () => (draftTemplate ? normalizeLook(saveOwnCloudTemplate(look, draftTemplate)) : look),
    [look, draftTemplate],
  );

  const report = useMemo(
    () => (draft ? cloudTemplateReport(hats, { layers: draft.raw.layers }) : null),
    [draft, hats],
  );

  /* Миниатюры: свои облака — всегда (ряд «Мои»), модели — пока конструктор открыт. */
  const ownItems = useMemo(
    () => list.map((template) => ({ id: template.id, key: `${template.id}:${ownCloudSignature(template)}`, template })),
    [list],
  );
  const ownThumbs = useOwnCloudThumbnails(ownItems, cloudScene, document, baseKey);
  const modelItems = useMemo(
    () =>
      draft
        ? models.map((model) => ({
            id: model.file,
            key: `${model.hat}:${model.file}:${defaultMotion}`,
            template: normalizeOwnCloudTemplate(modelTemplate(model, defaultMotion)).template,
          })).filter((item) => item.template)
        : [],
    [draft, models, defaultMotion],
  );
  const modelThumbs = useCloudModelThumbnails(modelItems, cloudScene, document, baseKey);

  /* --- Ряд «Мои» --- */

  const onPick = useCallback(
    (id) => {
      if (own.some((item) => item.id === id)) {
        commit((current) => setCloudTemplate(current, id), `clouds:own:${id}`);
        return;
      }
      /* Из личного списка: шаблон входит в проект и выбирается, дальше едет с работой. */
      const found = personal.find((item) => item.id === id);
      if (found) commit((current) => saveOwnCloudTemplate(current, found), `clouds:own:${id}`);
    },
    [commit, own, personal],
  );

  /* --- Конструктор --- */

  const onNew = useCallback(
    () =>
      setDraft({
        raw: { id: ownCloudId(), name: "", lighting: "MEDIUMclouds", motion: defaultMotion, layers: [], style: { ...BLANK_STYLE } },
        base: null,
        isNew: true,
        saved: false,
      }),
    [defaultMotion],
  );
  const onCopy = useCallback((readyId) => {
    const copy = ownCloudFromTemplate(readyId, { id: ownCloudId() });
    if (!copy) return;
    setDraft({ raw: { ...copy, layers: copy.layers.map((pair) => [...pair]), style: { ...copy.style } }, base: readyId, isNew: true, saved: false });
  }, []);
  const onEdit = useCallback(
    (id) => {
      const found = list.find((item) => item.id === id);
      if (!found) return;
      setDraft({ raw: { ...found, layers: found.layers.map((pair) => [...pair]), style: { ...found.style } }, base: id, isNew: false, saved: true });
    },
    [list],
  );
  /* Правка черновика: часть шаблона или функция от текущего (подряд идущие щелчки по плиткам не теряют друг друга). */
  const onChange = useCallback(
    (patch) =>
      setDraft((current) =>
        current
          ? { ...current, raw: { ...current.raw, ...(typeof patch === "function" ? patch(current.raw) : patch) }, saved: false }
          : current,
      ),
    [],
  );
  const onClose = useCallback(() => setDraft(null), []);

  /* Мера «можно ли сохранить» — те же пределы, что у пакета: причина словами, а не молчащая кнопка. */
  const problem = (() => {
    if (!draft) return "";
    if (!draft.raw.name?.trim()) return tr("Дайте облаку название");
    if (!normalizeOwnCloudTemplate(draft.raw, hats).template) return tr("Добавьте хотя бы один слой");
    const known = list.some((item) => item.id === draft.raw.id);
    if (!known && own.length >= OWN_CLOUD_LIMITS.templates)
      return tr("В проекте уже {n} своих облаков: удалите одно").replace("{n}", String(OWN_CLOUD_LIMITS.templates));
    return "";
  })();

  const save = useCallback(
    ({ asNew = false } = {}) => {
      if (!draft || problem) return;
      const raw = asNew ? { ...draft.raw, id: ownCloudId() } : draft.raw;
      const { template } = normalizeOwnCloudTemplate(raw, hats);
      if (!template) return;
      commit((current) => saveOwnCloudTemplate(current, template), `clouds:own:save:${template.id}`);
      rememberPersonalCloud(template);
      setPersonal(readPersonalClouds());
      setDraft({ raw: { ...template, layers: template.layers.map((pair) => [...pair]), style: { ...template.style } }, base: template.id, isNew: false, saved: true });
    },
    [draft, problem, hats, commit],
  );

  const onDelete = useCallback(
    (id) => {
      commit((current) => removeOwnCloudTemplate(current, id), `clouds:own:remove:${id}`);
      forgetPersonalCloud(id);
      setPersonal(readPersonalClouds());
      setDraft((current) => (current?.raw.id === id ? null : current));
    },
    [commit],
  );

  /* «Сбросить к шаблону»: слои, свет и стиль — как у того, с чего начали (готовый или сохранённая версия); имя остаётся. */
  const onReset = useCallback(() => {
    setDraft((current) => {
      if (!current?.base) return current;
      const source = list.find((item) => item.id === current.base) || null;
      const back = source ? { ...source } : ownCloudFromTemplate(current.base);
      if (!back) return current;
      return {
        ...current,
        raw: {
          ...current.raw,
          lighting: back.lighting,
          motion: back.motion,
          layers: back.layers.map((pair) => [...pair]),
          style: { ...back.style },
        },
        saved: false,
      };
    });
  }, [list]);

  /* --- Цвет облаков по времени суток: срезы вида (`slot.clouds.colour`), а не шаблон --- */
  const colourOf = (id) => look.slots[slotsOf(id)[0]]?.clouds.colour ?? null;
  const onTimeColour = useCallback(
    (id, colour) => commit((current) => patchSlots(current, slotsOf(id), { clouds: { colour } }), `clouds:colour:${id}`),
    [commit],
  );

  return {
    previewLook,
    inspector: {
      unavailable,
      list,
      activeId: look.clouds.template,
      thumbs: ownThumbs,
      onPick,
      onNew,
      onCopy,
      onEdit,
      onDelete,
      draft,
      families,
      motions,
      models,
      modelThumbs,
      report,
      problem,
      onChange,
      onClose,
      onSave: save,
      onReset,
      colourOf,
      onTimeColour,
      limits: OWN_CLOUD_LIMITS,
    },
  };
}

/** Чистый вид без своих облаков: нужен тестам, чтобы сверять миниатюры и кадр с одним и тем же объектом. */
export const blankLook = () => normalizeLook(createLook());
