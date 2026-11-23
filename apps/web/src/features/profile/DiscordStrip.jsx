import { tr } from "../../locales/ui.js";
import Button from "../../components/ui/Button.jsx";
import { openLink } from "../../components/desktop/settings/open-link.js";
import BadgeMedal from "./BadgeMedal.jsx";
import { badgeById, badgeInfo } from "./badge-defs.js";
import ProfileIcon from "./profile-icons.jsx";
import { siteProfileUrl } from "./site-link.js";

/*
 * «Привяжи Discord» — полоса для аккаунта по почте (макет 15.11.2026). Привязка идёт на сайте:
 * у окна нет вызова, который связывает аккаунт с Discord, поэтому кнопка открывает профиль на сайте.
 */
export default function DiscordStrip({ onDismiss }) {
  const badge = badgeById("discord");
  return (
    <div className="pf-strip" role="region" aria-label={tr("Привяжи Discord")}>
      <span className="pf-strip-di">
        <ProfileIcon name="discord" size={26} weight={1.8} />
      </span>
      <div className="pf-strip-tx">
        <b>{tr("Привяжи Discord")}</b>
        <p>
          {tr(
            "Сервер Astral Mods, поддержка и значок «На сервере» — всё сразу, пароль для этого не нужен.",
          )}
        </p>
      </div>
      <span className="pf-strip-lk">
        <BadgeMedal badge={badge} info={badgeInfo(badge, 0)} size={40} />
        <span>
          <b>{tr("На сервере")}</b>
          <small>{tr("ждёт привязки")}</small>
        </span>
      </span>
      <Button
        variant="primary"
        className="pf-btn"
        icon={<ProfileIcon name="discord" size={17} weight={1.9} />}
        onClick={() => openLink(siteProfileUrl())}
      >
        {tr("Привязать Discord")}
      </Button>
      <button
        type="button"
        className="pf-strip-x"
        aria-label={tr("Скрыть")}
        onClick={onDismiss}
      >
        <ProfileIcon name="x" size={16} weight={2} />
      </button>
    </div>
  );
}
