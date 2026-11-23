import { CheckCircle, Trash } from "../../ui/icons.jsx";
import Button from "../../ui/Button.jsx";
import Dialog from "../../ui/Dialog.jsx";
import DesktopOverlayPortal from "../overlays/DesktopOverlayPortal.jsx";

// Мелкие части страницы сборок без состояния: сетка карточек, тост и окно удаления.

export function BuildsGrid({ label, children }) {
  return (
    <section className="builds-grid" aria-label={label} data-assembly-grid="true">
      {children}
    </section>
  );
}

// Тост читается с экрана как статус: вежливо и целиком.
const TOAST_ATTRS = { role: "status", "aria-live": "polite", "aria-atomic": "true" };

export function CopiedToast({ leaving, label }) {
  const phase = leaving ? "is-leaving" : "is-visible";
  const icon = <CheckCircle />;
  const text = <span>{label}</span>;
  return (
    <DesktopOverlayPortal>
      <div className={`builds-copy-toast ${phase}`} {...TOAST_ATTRS}>
        {icon}
        {text}
      </div>
    </DesktopOverlayPortal>
  );
}

export function DeleteBuildDialog({ copy, build, onCancel, onConfirm }) {
  const cancelProps = { onClick: onCancel, children: copy.cancel };
  const dangerProps = { variant: "danger", icon: <Trash />, onClick: onConfirm, children: copy.delete };
  const buttons = (
    <>
      <Button {...cancelProps} />
      <Button {...dangerProps} />
    </>
  );
  const dialogProps = {
    className: "builds-dialog is-delete",
    size: "sm",
    title: copy.deleteTitle,
    titleId: "builds-delete-title",
    description: copy.deleteText(build.name),
    onClose: onCancel,
    actions: buttons,
  };
  return <Dialog {...dialogProps} />;
}
