import { tr } from "../../locales/ui.js";
import { trFill } from "../../locales/tr-fill.js";
import BadgeMedal from "./BadgeMedal.jsx";
import { groupName, stepName } from "./badge-words.js";

/* Строка состояния под «как получить»: подпись слева, цифра справа, у значка в пути — полоска. */
function StateLine({ badge, info }) {
  const bar = (
    <div className="pf-bar">
      <i style={{ width: `${Math.round(info.pct * 100)}%` }} />
    </div>
  );
  if (badge.steps) {
    return (
      <>
        <div className="pf-bc-stt">
          <span>{trFill("Ступень {0} из {1}", info.stage, info.total)}</span>
          <b>
            {info.next
              ? trFill("{0} / {1}", info.have, info.next)
              : tr("готово")}
          </b>
        </div>
        {info.next ? bar : null}
      </>
    );
  }
  if (info.state === "got")
    return (
      <div className="pf-bc-stt">
        <span>{tr("Получен")}</span>
      </div>
    );
  if (info.state === "prog") {
    return (
      <>
        <div className="pf-bc-stt">
          <span>{tr("В процессе")}</span>
          <b>{trFill("{0} / {1}", info.have, info.need)}</b>
        </div>
        {bar}
      </>
    );
  }
  if (info.state === "soon")
    return (
      <div className="pf-bc-stt">
        <span>{tr("Скоро")}</span>
      </div>
    );
  return (
    <div className="pf-bc-stt">
      <span>{tr("Закрыт")}</span>
      <b>{trFill("{0} / {1}", 0, info.need)}</b>
    </div>
  );
}

function Card({ item, isNew }) {
  const { badge, info } = item;
  return (
    <div className={`pf-bc is-${info.state}`} data-badge={badge.id}>
      <BadgeMedal badge={badge} info={info} size={64} />
      <div className="pf-bc-tx">
        <b className="pf-bc-nm">{tr(badge.name)}</b>
        <span className="pf-bc-hw">{tr(badge.how)}</span>
        <StateLine badge={badge} info={info} />
      </div>
      {isNew && <i className="pf-new pf-bc-new">{tr("Новый")}</i>}
    </div>
  );
}

export default function BadgesTab({ groups, summary, nearest, unseen }) {
  const soon = nearest.slice(0, 3);
  return (
    <>
      <div className="pf-bsum">
        <div className="pf-bsum-big">
          {summary.got}
          <small>{trFill("из {0}", summary.total)}</small>
        </div>
        <div className="pf-bsum-pr">
          <div className="pf-bar pf-bar-lg">
            <i
              style={{
                width: `${Math.round((summary.got / summary.total) * 100)}%`,
              }}
            />
          </div>
          <div className="pf-bsum-lg">
            <span>
              <i />
              {trFill("Получено {0}", summary.got)}
            </span>
            <span>
              <i className="p" />
              {trFill("В процессе {0}", summary.prog)}
            </span>
            <span>
              <i className="c" />
              {trFill("Закрыто {0}", summary.lock)}
            </span>
          </div>
        </div>
      </div>
      {soon.length > 0 && (
        <div className="pf-soon">
          {/* Надзаголовок прописными — орган макета 15.11: исключение для сверки `caps`. */}
          <div className="pf-eyebrow" data-audit-ignore="caps">
            {tr("Скоро получишь")}
          </div>
          {soon.map(({ badge, info }) => (
            <div className="pf-soon-n" key={badge.id}>
              <BadgeMedal badge={badge} info={info} size={46} />
              <div>
                <b>{stepName(badge, info)}</b>
                <small>
                  {trFill("{0} из {1}", info.have, info.next || info.need)}
                </small>
              </div>
            </div>
          ))}
        </div>
      )}
      {groups.map((group) => {
        const got = group.items.filter(
          (item) => item.info.state === "got",
        ).length;
        return (
          <section key={group.id} data-group={group.id}>
            <div className="pf-bgh">
              <h2>{groupName(group)}</h2>
              <span className="pf-count">
                {trFill("{0} из {1}", got, group.items.length)}
              </span>
            </div>
            <div className="pf-bgrid">
              {group.items.map((item) => (
                <Card
                  item={item}
                  key={item.badge.id}
                  isNew={unseen.includes(item.badge.id)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}
