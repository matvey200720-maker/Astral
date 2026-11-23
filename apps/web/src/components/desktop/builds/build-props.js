// Свойства дочерних окон и карточек страницы сборок. Порядок ключей тот же, что и у страницы:
// от него зависит порядок свойств у получателя. Значения приходят группами из текущей отрисовки.

// Окно открытой сборки.
export function openedPropsOf(open, marks, extra, acts, words, lists) {
  const { build, view, leavingMods, enabledCount } = open;
  const { enabledIds, setEnabledIds, visibleModCount, setVisibleModCount, pageSize } = marks;
  const { workItems, workKinds, copiedBuildId, installed, fromCode, shownCode, choice } = extra;
  const { onCopy, onInstall, onClose, onNavigate, onPasteCode, onRemoveWorks, onDelete, onEdit } = acts;
  const { language, copy, worksCopy } = words;
  const { blockOf, getModSize, availableMods, installedIds } = lists;
  return {
    build,
    mods: view.mods,
    works: view.works,
    items: view.items,
    hasContent: view.hasContent,
    leavingMods,
    enabledCount,
    enabledIds,
    setEnabledIds,
    visibleModCount,
    setVisibleModCount,
    pageSize,
    blockOf,
    getModSize,
    availableMods,
    installedIds,
    workItems,
    language,
    copy,
    worksCopy,
    workKinds,
    copiedBuildId,
    installed,
    fromCode,
    shownCode,
    choice,
    onCopy,
    onInstall,
    onClose,
    onNavigate,
    onPasteCode,
    onRemoveWorks,
    onDelete,
    onEdit,
  };
}

// Окно создания и карточка первой сборки: одно и то же, закрыть умеет только окно.
export function createPropsOf(onClose, draft, imports, acts, words, lists) {
  const { picks, installedWorkCards, name, importCode, nextName } = draft;
  const { pastedCode, importMods, importWorks, codePicks, workItems } = imports;
  const { onName, onImportCode, onCreate, onImport } = acts;
  const { copy, worksCopy, language } = words;
  const { blockOf, installedIds, availableMods, getModSize } = lists;
  return {
    copy,
    worksCopy,
    installedMods: picks.mods,
    installedWorks: installedWorkCards,
    installedCount: picks.enabledIds.size,
    installedWorksCount: installedWorkCards.length,
    name,
    onName,
    defaultName: nextName(),
    importCode,
    onImportCode,
    onCreate,
    onImport,
    ...(onClose ? { onClose } : null),
    blockOf,
    pastedCode,
    importMods,
    importWorks,
    workItems,
    installedIds,
    availableMods,
    getModSize,
    language,
    selection: picks.selection,
    codeSelection: codePicks.selection,
  };
}

// Карточка сборки: то, что известно о сборке, и общие для всех карточек данные и действия.
export function cardPropsOf(card, extra, acts, words, lists) {
  const { sizeOf, copiedBuildId, queue } = extra;
  const { onOpen, onCopy, onRemoveWorks, onDelete } = acts;
  const { copy, worksCopy, language } = words;
  const { installedIds, availableMods, getModSize } = lists;
  return {
    ...card,
    installedIds,
    availableMods,
    getModSize,
    sizeOf,
    copiedBuildId,
    copy,
    worksCopy,
    onOpen,
    onCopy,
    onRemoveWorks,
    onDelete,
    queue,
    language,
  };
}
