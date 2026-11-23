// Поле для текста: есть setSelectionRange и числовой selectionStart
// (у number, email, range и флажков selectionStart равен null).
function isTextControl(element) {
  const canSelect = typeof element?.setSelectionRange === "function";
  return canSelect && typeof element.selectionStart === "number";
}

// Выделение внутри поля в фокусе схлопывается в курсор в конце; число и фокус остаются.
function collapseFocusedField(doc) {
  const field = doc.activeElement;
  if (!isTextControl(field) || field.selectionStart === field.selectionEnd)
    return false;
  try {
    field.setSelectionRange(field.selectionEnd, field.selectionEnd);
    return true;
  } catch {
    return false;
  }
}

function dropPageRange(selection) {
  if (selection?.type !== "Range") return false;
  selection.removeAllRanges();
  return true;
}

export function releaseRangeSelection(doc = globalThis.document) {
  if (typeof doc?.getSelection !== "function") return false;
  const collapsed = collapseFocusedField(doc);
  const dropped = dropPageRange(doc.getSelection());
  return collapsed || dropped;
}

export function installHiddenRangeRelease(doc = globalThis.document) {
  if (typeof doc?.addEventListener !== "function") return () => {};

  const sweepLater = () => {
    const sweep = () => {
      if (isTextControl(doc.activeElement)) return;
      const current = typeof doc.getSelection === "function" ? doc.getSelection() : null;
      dropPageRange(current);
    };
    const view = doc.defaultView;
    if (view) view.setTimeout(sweep, 0);
    else setTimeout(sweep, 0);
  };

  const onFocusLeave = (event) => {
    if (isTextControl(event.target)) sweepLater();
  };

  doc.addEventListener("focusout", onFocusLeave, true);
  return () => doc.removeEventListener("focusout", onFocusLeave, true);
}
