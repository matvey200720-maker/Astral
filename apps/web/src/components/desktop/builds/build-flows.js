import { humanFailure } from "../../../utils/installFailure.js";
import { partsReplacedByWorks } from "../../../features/catalog/bundles/map-works.js";
import {
  installBuildWorks,
  removeBuildWorks,
} from "../../../features/workshop/work-install/install-build-works.js";
import {
  copyBuildCode,
  encodePortableBuild,
  isBuildCodeTooLarge,
} from "../../../features/builds/portable-code.js";
import { shortenCode } from "../../../features/workshop/works/work-code-share.js";
import { modPhoto } from "../../../features/builds/mod-faces.js";
import { importBuildWorks } from "../../../features/builds/build-works.js";
import {
  forgetBuildWorks,
  rememberBuildWorks,
} from "../../../features/builds/build-works-store.js";
import { forgetBuildChoices } from "../../../features/builds/build-choices-store.js";
import { visibleBuild } from "../../../features/builds/works-switch.js";
import { forgetFromCode, rememberFromCode } from "../../../features/builds/code-history.js";
import { appendEntry, installableIds, putFirst, withWorks, without } from "./build-lists.js";
import { composeDraft, importNotice, readPortable, savedNotice } from "./build-draft.js";

// Действия страницы сборок: шаги с ожиданием. Состояние и обратные вызовы страницы
// приходят параметрами (значения текущей отрисовки), своего состояния здесь нет.

// Создание: черновик, ответ хозяина, запись в список, итог.
export async function createFlow(input, words, calls) {
  const { copy, worksCopy, language, onNotice } = words;
  const { onCreateProfile, setProfiles, finishCreation, nextName } = calls;
  try {
    const defaultName = nextName();
    const draft = await composeDraft({ ...input, defaultName });
    const answer = await onCreateProfile?.(draft);
    const given = answer || draft;
    let entry = given;
    if (draft.works && !given.works?.length) entry = withWorks(given, draft.works);
    let stored = true;
    if (entry.works?.length) stored = rememberBuildWorks(entry.id, entry.works);
    setProfiles(appendEntry(entry));
    finishCreation();
    onNotice(savedNotice(copy, worksCopy, stored));
  } catch (error) {
    const failure = humanFailure(error, language);
    onNotice(failure, "error");
  }
}

// Почему код нельзя читать: пусто или слишком велик; null — можно.
function importRefusal(code, copy, worksCopy) {
  if (!code.trim()) return { text: copy.enterCode };
  if (isBuildCodeTooLarge(code)) return { text: worksCopy.codeTooLarge };
  return null;
}

// Импорт по коду: проверка, чтение, ответ хозяина, работы кода, запись и открытие сборки.
export async function importFlow(source, words, after) {
  const { importCode, pastedCode, codePicks, cloudMode, onImportProfile } = source;
  const { copy, worksCopy, language, onNotice } = words;
  const { setProfiles, setImportCode, setCreating, openBuild } = after;
  const refusal = importRefusal(importCode, copy, worksCopy);
  if (refusal) {
    onNotice(refusal.text);
    return;
  }
  try {
    const fullCode = await pastedCode.whenReady(onNotice);
    if (!fullCode) return;
    const read = readPortable(fullCode, codePicks);
    let answer;
    if (cloudMode) answer = await onImportProfile?.(fullCode, read);
    else if (read) answer = read;
    else answer = await onImportProfile?.(fullCode, null);
    if (!answer) return;

    const codeWorks = (read?.works?.length ? read.works : answer.works) || [];
    let report = null;
    if (codeWorks.length) report = await importBuildWorks(codeWorks);
    let entry = answer;
    if (codeWorks.length && !answer.works?.length) entry = withWorks(answer, codeWorks);
    let stored = true;
    if (codeWorks.length) stored = rememberBuildWorks(entry.id, codeWorks);

    setProfiles(putFirst(entry));
    rememberFromCode(entry.id);
    setImportCode("");
    setCreating(false);
    const dropped = Number(read?.droppedWorks) || 0;
    onNotice(importNotice({ copy, worksCopy, report, dropped, stored }));
    openBuild(visibleBuild(entry));
  } catch (error) {
    const failure = humanFailure(error, language);
    onNotice(failure);
  }
}

// Установка открытой сборки: анимация, моды, затем работы мастерской.
export async function installFlow(event, shown, calls) {
  const { build, view, enabledIds } = shown;
  const { animateInstall, setOpened, onInstallBuild, onNotice, announce, worksCopy } = calls;
  const button = event?.currentTarget;
  const dialogBox = button?.closest?.(".ui-dialog, .builds-open");
  const photo = dialogBox?.querySelector(".ui-pick-tile.is-selected img");
  const animation = animateInstall({
    source: photo || button,
    cover: modPhoto(view.mods[0] || null),
    label: build.name,
  });
  setOpened(null);
  const works = build.works || [];
  const replaced = await partsReplacedByWorks(works);
  const target = { ...build };
  target.modIds = installableIds(build, enabledIds, replaced);
  await animation;
  // Сборку из одних работ модами не трогаем: пустой набор снял бы всё установленное.
  const hasMods = target.modIds.length > 0;
  if (hasMods || works.length === 0) onInstallBuild(target);
  if (works.length === 0) return;
  const notify = (text) => onNotice(text);
  const summary = await installBuildWorks(works, { notify });
  announce(worksCopy.installSummary(summary));
}

// Копирование кода сборки: сжатая запись, буфер обмена, тост или заметка. Отдаёт `{ code, short }` — что легло в буфер.
export async function copyFlow(profile, toast, speech) {
  const { copy, onNotice } = speech;
  const encoded = encodePortableBuild(profile);
  const shortened = await shortenCode(encoded);
  const { code, note } = shortened;
  const copied = await copyBuildCode(code);
  if (copied) toast.showCopiedBuild(profile.id);
  else onNotice(copy.copyFailed);
  if (note) onNotice(note);
  return shortened;
}

// Снятие работ сборки из мастерской.
export async function removeFlow(profile, announce, worksCopy) {
  const summary = await removeBuildWorks(profile.works || []);
  announce(worksCopy.removeSummary(summary));
}

// Удаление: окно сразу закрывается; при отказе хозяина возвращается с заметкой.
export async function deleteFlow(given, words, calls) {
  const { target, profiles, opened } = given;
  const { copy, language, onNotice } = words;
  const { onDeleteProfile, setProfiles, setOpened, setDeleting } = calls;
  setDeleting(null);
  try {
    await onDeleteProfile?.(target);
  } catch (error) {
    setDeleting(target);
    const failure = humanFailure(error, language);
    onNotice(failure);
    return;
  }
  forgetBuildWorks(target.id);
  forgetBuildChoices(target.id);
  forgetFromCode(target.id);
  setProfiles(without(profiles, target.id));
  const wasOpened = opened?.id === target.id;
  if (wasOpened) setOpened(null);
  onNotice(copy.deleted);
}
