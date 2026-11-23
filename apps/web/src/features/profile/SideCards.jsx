import { tr } from "../../locales/ui.js";
import { trFill } from "../../locales/tr-fill.js";
import { formatSize } from "../../catalog-utils.js";
import { Skeleton } from "../../components/ui/Skeleton.jsx";
import ProfileIcon from "./profile-icons.jsx";

const BRANCH_NAMES = { alpha: "Альфа", beta: "Бета", release: "Релиз" };
const STATE_NOTES = { open: "Открыт", closed: "Закрыт", soon: "Скоро" };

/* «Доступ»: ветки Astral, что открыты этому аккаунту, и версия каждой. Без снимка веток (окно не в бете) карточки нет.
   Снимок ещё едет — те же три строки с названиями и серыми плитами на месте состояния и версии (владелец 18.11.2026: пусть
   сначала будет каркас, а цифры подставятся), чтобы правый столбец не прыгал. */
function AccessCard({ rows, loading }) {
  if (loading && !rows.length) {
    return (
      <div className="pf-card" data-card="access" aria-busy="true">
        <div className="pf-card-h">
          <span className="pf-eyebrow" data-audit-ignore="caps">
            {tr("Доступ")}
          </span>
        </div>
        {/* Бета без доступа в карточке не показывается, поэтому каркас — две строки: Альфа и Релиз. */}
        {["alpha", "release"].map((channel) => (
          <div className="pf-arow is-off" key={channel}>
            <span className="pf-arow-i">
              <ProfileIcon name="lock" size={15} weight={1.9} />
            </span>
            <div>
              <b>{tr(BRANCH_NAMES[channel])}</b>
              <Skeleton line className="pf-skel-line" />
            </div>
            <Skeleton className="pf-skel-code" />
          </div>
        ))}
      </div>
    );
  }
  if (!rows.length) return null;
  return (
    <div className="pf-card" data-card="access">
      <div className="pf-card-h">
        {/* Надзаголовки прописными — орган макета 15.11: исключение для сверки `caps`. */}
        <span className="pf-eyebrow" data-audit-ignore="caps">
          {tr("Доступ")}
        </span>
      </div>
      {rows.map((row) => (
        <div
          className={`pf-arow${row.state === "open" ? "" : " is-off"}`}
          key={row.channel}
        >
          <span className="pf-arow-i">
            <ProfileIcon
              name={row.state === "open" ? "check" : "lock"}
              size={row.state === "open" ? 16 : 15}
              weight={row.state === "open" ? 2.2 : 1.9}
            />
          </span>
          <div>
            <b>{tr(BRANCH_NAMES[row.channel])}</b>
            <small>{tr(STATE_NOTES[row.state])}</small>
          </div>
          {row.state === "open" && row.version ? (
            <code>{row.version}</code>
          ) : null}
          {row.state === "soon" ? <code>{tr("скоро")}</code> : null}
        </div>
      ))}
    </div>
  );
}

/* Сколько гигабайт памяти: главный процесс присылает `memory.totalBytes`, песочница — готовые `memoryGb`. */
export function memoryGbOf(hardware) {
  const direct = Number(hardware?.memoryGb);
  if (direct > 0) return Math.round(direct);
  const bytes = Number(hardware?.memory?.totalBytes);
  return bytes > 0 ? Math.round(bytes / 1024 ** 3) : 0;
}

/* Железо читает главный процесс; имени компьютера и версии Windows у окна нет, поэтому заголовок — видеокарта. */
function hardwareLines(hardware) {
  const gb = memoryGbOf(hardware);
  return {
    title: hardware?.gpus?.[0]?.name || tr("Этот компьютер"),
    note: gb ? trFill("{0} ГБ ОЗУ", gb) : "",
  };
}

function DeviceCard({
  hardware,
  connected,
  counts,
  bytes,
  language,
  hardwareLoading,
  countsLoading,
}) {
  const { title, note } = hardwareLines(hardware);
  return (
    <div className="pf-card" data-card="device">
      <div className="pf-card-h">
        <span className="pf-eyebrow" data-audit-ignore="caps">
          {tr("Это устройство")}
        </span>
      </div>
      <div className="pf-pdev">
        <ProfileIcon name="monitor" size={22} />
        <div>
          <b>{title}</b>
          {note && <small>{note}</small>}
          {!note && hardwareLoading && (
            <Skeleton line className="pf-skel-line" />
          )}
        </div>
        {connected && (
          <span className="pf-pdev-on">
            <i className="pf-dot" />
            {tr("на связи")}
          </span>
        )}
      </div>
      <div className="pf-cnts">
        {[
          [counts.total, "Всего"],
          [counts.gunpacks, "Ганпаки"],
          [counts.redux, "Редуксы"],
          [counts.clothing, "Одежда"],
        ].map(([value, name]) => (
          <div key={name}>
            <b>
              {countsLoading ? <Skeleton className="pf-skel-num" /> : value}
            </b>
            <small>{tr(name)}</small>
          </div>
        ))}
      </div>
      {(bytes > 0 || countsLoading) && (
        <div className="pf-size">
          <span>{tr("Занято в библиотеке")}</span>
          <b>
            {countsLoading ? (
              <Skeleton className="pf-skel-size" />
            ) : (
              formatSize(bytes, language)
            )}
          </b>
        </div>
      )}
    </div>
  );
}

export default function SideCards({
  access,
  accessLoading = false,
  hardware,
  hardwareLoading = false,
  connected,
  counts,
  countsLoading = false,
  bytes,
  language,
}) {
  return (
    <aside className="pf-side">
      <AccessCard rows={access} loading={accessLoading} />
      <DeviceCard
        hardware={hardware}
        hardwareLoading={hardwareLoading}
        connected={connected}
        counts={counts}
        countsLoading={countsLoading}
        bytes={bytes}
        language={language}
      />
    </aside>
  );
}
