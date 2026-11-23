import { useState } from "react";
import { ClipboardText, FloppyDisk, ShareNetwork, ShoppingCart } from "../../../components/ui/icons.jsx";
import { copyText } from "../../../clipboard.js";
import { tr, useUiLanguage } from "../../../locales/ui.js";
import { addToCart, cartHas } from "../../cart/cart-store.js";
import { workshopCopyFor } from "../../../workshop-copy.js";
import {
  ManualCodeDialog,
  SaveToWorksDialog,
  WorkCodeDialog,
  workCodeLost,
  workErrorText,
  workSaveErrorText,
} from "./WorkDialogs.jsx";
import { addWorkTemplates, readWorkCode } from "./work-transfer.js";
import { shortenCode } from "./work-code-share.js";
import { attachSavedCover, beginWorkCover, dropPendingCover } from "./work-covers.js";
import { listWorkshopWorks } from "./workshop-works.js";
import { WORK_KINDS } from "./work-kinds.js";
import { editorCoverKind } from "../covers/editor-covers.js";

/*
 * Три пункта «⋯» каждого редактора мастерской: «Сохранить в мои работы»,
 * «Скопировать код», «Вставить код».

 * «Сохранить» ещё и снимает кадр редактора в обложку работы (`work-covers.js`): снимок — от пункта меню, до окна
 * «Сохранить» (окно легло бы на кадр), и ложится к работе, когда она записана.
 *
 * Пункты, их порядок, слова, окна и отклики — одни на все редакторы: человек,
 * сохранивший трассер, находит то же самое в небе и на мини-карте. Чем
 * редакторы различаются — что сохраняется, что уходит в код и как
 * открывается чужой код, — приносит сам редактор обработчиками.
 *
 * Меню «⋯» у каждого редактора своё, и его ветка по умолчанию делает что-то
 * своё (сброс, «снять всё»): `handle` зовётся первым и говорит, забрал ли он
 * пункт, — иначе новый пункт молча провалился бы в чужое действие.
 */

const fill = (template, values) =>
  Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    String(template || ""),
  );

export const WORK_ACTION_VALUES = Object.freeze({
  save: "works:save",
  cart: "works:cart",
  copy: "works:copy",
  paste: "works:paste",
});

/**
 * @param {{
 *   kind: string,
 *   onNotice?: (text: string, tone?: string) => void,
 *   linkedName?: () => string,
 *   defaultName?: () => string,
 *   onSave: (input: {name: string, asNew: boolean}) => Promise<{name: string, created: boolean}>,
 *   onCopy: () => Promise<{code: string, lost?: string}>,
 *   onOpen: (result: object) => Promise<unknown>|unknown,
 *   accept?: string[],
 *   openLabel?: string,
 *   pasteLabel?: string,
 *   locale?: string,
 * }} options
 *
 * `openLabel`, `pasteLabel` — слова для редактора, у которого вставленный
 * код не просто открывается: чужая большая карта сразу ставится в игру, и
 * пункт меню с кнопкой окна обязаны сказать это заранее.
 */
export function useWorkActions({
  kind,
  onNotice,
  linkedName = () => "",
  defaultName = () => "",
  onSave,
  onCopy,
  onOpen,
  accept = null,
  openLabel = "",
  pasteLabel = "",
  locale = "",
}) {
  /* Слова меню и окон — на языке окна: редакторы `locale` не передают, и
     прежнее «ru» по умолчанию оставляло «⋯» русским на всех языках. */
  const language = useUiLanguage();
  const copy = workshopCopyFor(locale || language).works;
  const [dialog, setDialog] = useState(null);
  const notice = (text, tone = "success") => onNotice?.(text, tone);

  const items = [
    {
      value: WORK_ACTION_VALUES.save,
      label: copy.menu.save,
      icon: <FloppyDisk />,
    },
    /* «В корзину» (владелец, 16.11.2026): работа сперва сохраняется тем же путём, что «Сохранить в мои работы», и только потом ложится в корзину; не сохранилась — в корзину не идёт. */
    {
      value: WORK_ACTION_VALUES.cart,
      label: tr("В корзину"),
      icon: <ShoppingCart />,
    },
    {
      value: WORK_ACTION_VALUES.copy,
      label: copy.menu.copy,
      icon: <ShareNetwork />,
    },
    {
      value: WORK_ACTION_VALUES.paste,
      label: pasteLabel || copy.menu.paste,
      icon: <ClipboardText />,
    },
  ];

  const copyCode = async () => {
    let result;
    try {
      result = await onCopy();
    } catch (error) {
      notice(
        error?.reason === "empty"
          ? copy.code.emptyCopy
          : workErrorText(copy, error),
        "error",
      );
      return;
    }
    /* Длинный код — на сервер, в буфер адрес; не вышло — полный код и строка почему. */
    const shared = await shortenCode(result.code);
    if (!(await copyText(shared.code))) {
      setDialog({ type: "manual", code: shared.code });
      return;
    }
    notice(
      [copy.code.copied, result.lost, shared.note].filter(Boolean).join(" "),
    );
  };

  const handle = (value) => {
    if (value === WORK_ACTION_VALUES.save || value === WORK_ACTION_VALUES.cart) {
      const open = () =>
        setDialog({
          type: "save",
          linkedName: linkedName() || "",
          defaultName: defaultName() || copy.defaultNames[kind] || "",
          /* «В корзину»: то же окно и то же сохранение, а после него работа ложится в корзину. */
          thenCart: value === WORK_ACTION_VALUES.cart,
        });
      /* Снимок кадра — до окна: оно ляжет на кадр. Нечем снимать или нет холста — окно сразу; не дождались готового
         кадра за пару секунд — окно без обложки. */
      const shot = beginWorkCover({ kind: editorCoverKind(WORK_KINDS[kind]?.slotId) || "" });
      if (shot) void shot.then(open);
      else open();
      return true;
    }
    if (value === WORK_ACTION_VALUES.copy) {
      void copyCode();
      return true;
    }
    if (value === WORK_ACTION_VALUES.paste) {
      setDialog({ type: "paste" });
      return true;
    }
    return false;
  };

  /* Только что сохранённая работа этого вида — в корзину. Дубля нет: работа в корзине одна, повторное нажатие говорит «Уже в корзине». */
  const putInCart = async () => {
    try {
      const { newestWorkOfKind } = await import("../../cart/cart-works.js");
      const work = newestWorkOfKind(kind);
      if (!work) return { text: tr("Не получилось положить в корзину."), tone: "error" };
      if (cartHas(work.key)) return { text: tr("Уже в корзине."), tone: "success" };
      if (!addToCart(work.key)) return { text: tr("Корзина полна."), tone: "error" };
      return { text: tr("Добавлено в корзину."), tone: "success" };
    } catch {
      return { text: tr("Не получилось положить в корзину."), tone: "error" };
    }
  };

  const save = async ({ name, asNew }) => {
    try {
      const saved = await onSave({ name, asNew });
      /* Отказ, о котором редактор уже сказал сам: окно остаётся открытым. */
      if (!saved) return false;
      /* Работа записана — снимок кадра становится её обложкой (ключ работы известен только теперь). */
      void attachSavedCover(kind, listWorkshopWorks);
      const savedText = fill(saved.created ? copy.saveDialog.saved : copy.saveDialog.updated, {
        name: saved.name || name,
      });
      if (dialog?.thenCart) {
        const { text, tone } = await putInCart();
        notice([savedText, text].join(" "), tone);
      } else notice(savedText);
      return true;
    } catch (error) {
      notice(workSaveErrorText(copy, error), "error");
      return false;
    }
  };

  /* Код другого раздела — не сюда, но и не в никуда: он ложится в «Мои
     работы», откуда откроется в своём редакторе. */
  const addToWorks = async ({ code }) => {
    const result = await readWorkCode(code);
    await addWorkTemplates(result.templates);
    notice(
      [
        result.templates.length > 1
          ? fill(copy.code.addedMany, {
              kinds: result.templates
                .map((item) => copy.kinds[item.kind])
                .join(", "),
            })
          : fill(copy.code.added, {
              name: result.templates[0]?.name || copy.kinds[result.kind],
            }),
        workCodeLost(result),
      ]
        .filter(Boolean)
        .join(" "),
    );
  };

  const open = async ({ result }) => {
    await onOpen(result);
    notice(
      [
        fill(copy.code.opened, {
          name: result.templates[0]?.name || copy.kinds[result.kind],
        }),
        workCodeLost(result),
      ]
        .filter(Boolean)
        .join(" "),
    );
  };

  const dialogs =
    dialog?.type === "save" ? (
      <SaveToWorksDialog
        copy={copy}
        linkedName={dialog.linkedName}
        defaultName={dialog.defaultName}
        onSave={save}
        onClose={() => {
          dropPendingCover();
          setDialog(null);
        }}
      />
    ) : dialog?.type === "paste" ? (
      <WorkCodeDialog
        copy={copy}
        mode="open"
        accept={accept || [kind]}
        confirmLabel={openLabel}
        onConfirm={open}
        onAddToWorks={addToWorks}
        onClose={() => setDialog(null)}
      />
    ) : dialog?.type === "manual" ? (
      <ManualCodeDialog
        copy={copy}
        code={dialog.code}
        onClose={() => setDialog(null)}
      />
    ) : null;

  return { items, handle, dialogs };
}
