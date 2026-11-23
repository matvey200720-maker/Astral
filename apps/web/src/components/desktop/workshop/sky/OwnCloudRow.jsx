import { lazy, Suspense } from "react";
import { Cloud, Plus } from "../../../ui/icons.jsx";
import Button from "../../../ui/Button.jsx";
import { tr, useTr } from "../../../../locales/ui.js";

/* Конструктор — ленивым куском: стартовый кусок окна его не несёт, он нужен только тому, кто собирает своё облако. */
const CloudBuilder = lazy(() => import("./CloudBuilder.jsx"));

/*
 * Ряд «Мои» под готовыми облаками (10.11.2026): свои облака проекта и личного списка и плитка «Собрать своё».
 * Пока открыт конструктор, ряд уступает ему место — кадр над панелью показывает черновик.
 */
export default function OwnCloudRow({ own }) {
  useTr();
  if (own.draft)
    return (
      <Suspense fallback={null}>
        <CloudBuilder own={own} />
      </Suspense>
    );
  const blocked = Boolean(own.unavailable);
  return (
    <section className="sky-own" aria-label={tr("Мои облака")}>
      <h4 className="sky-own-title">{tr("Мои")}</h4>
      <div className="sky-cloud-grid is-ready" role="group" aria-label={tr("Мои облака")}>
        {own.list.map((item) => {
          const active = own.activeId === item.id;
          const thumb = own.thumbs[item.id] || null;
          return (
            <div className="sky-cloud-cell" key={item.id}>
              <button
                type="button"
                className={`sky-cloud${active ? " is-active" : ""}`}
                aria-pressed={active}
                disabled={blocked}
                title={blocked ? own.unavailable : item.name}
                onClick={() => own.onPick(item.id)}
              >
                <span
                  className={`sky-cloud-art${thumb ? "" : " is-drawn"}`}
                  style={thumb ? { backgroundImage: `url(${thumb})` } : undefined}
                  aria-hidden="true"
                />
                <b>{item.name}</b>
              </button>
              <Button variant="ghost" size="sm" disabled={blocked} onClick={() => own.onEdit(item.id)}>
                {tr("Изменить")}
              </Button>
            </div>
          );
        })}
        <button
          type="button"
          className="sky-cloud is-add"
          disabled={blocked}
          title={blocked ? own.unavailable : tr("Собрать своё облако из моделей вашей игры")}
          onClick={own.onNew}
        >
          <span className="sky-cloud-art is-plus" aria-hidden="true">
            <Plus />
          </span>
          <b>{tr("Собрать своё")}</b>
        </button>
      </div>
      {blocked ? (
        <p className="sky-note">
          <Cloud aria-hidden="true" />
          {own.unavailable}
        </p>
      ) : (
        !own.list.length && <p className="sky-note is-plain">{tr("Своих облаков пока нет: соберите первое.")}</p>
      )}
    </section>
  );
}
