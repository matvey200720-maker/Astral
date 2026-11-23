import { useState } from "react";
import Dialog from "../../components/ui/Dialog.jsx";
import Button from "../../components/ui/Button.jsx";
import { openLink } from "../../components/desktop/settings/open-link.js";
import { logoutAccount } from "../../api.js";
import { humanFailure } from "../../utils/installFailure.js";
import { tr } from "../../locales/ui.js";
import { Avatar } from "./ProfileHero.jsx";
import ProfileIcon from "./profile-icons.jsx";
import { siteProfileUrl } from "./site-link.js";
import { word } from "./profile-words.js";

const COVERS_SHOWN = 6;
const CONTACT_NAMES = {
  discord: "Discord",
  server: "Свой сервер или клан",
  telegram: "Telegram",
  youtube: "YouTube",
  tiktok: "TikTok",
  twitch: "Twitch",
};

/*
 * «Настройки профиля» — боковая панель (макет 15.11.2026). Работает здесь только «Выйти»:
 * окну нечем сохранить имя, аватар, обложку и контакты — для них нет ни вызова окна, ни поля
 * в ответе облака (имя меняется на сайте). Поля стоят закрытыми, как в макете закрыт Discord
 * («из входа через Discord»), и честно говорят, где их менять или что они появятся позже.
 */
export default function EditDrawer({
  open,
  onClose,
  account,
  name,
  cover,
  covers,
  contacts,
  language,
}) {
  const [step, setStep] = useState("idle");
  const [error, setError] = useState("");

  async function signOut() {
    setStep("busy");
    setError("");
    try {
      await logoutAccount();
      /* Успех: окно перезагружается и встречает экраном входа, поэтому ничего не сбрасываем. */
      window.location.reload();
    } catch (failure) {
      setStep("idle");
      setError(humanFailure(failure, language));
    }
  }

  const close = () => {
    setStep("idle");
    setError("");
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      titleId="pf-drawer-title"
      showClose={false}
      deferFocus
      size="drawer"
      className="pf-drawer"
      backdropClassName="pf-drawer-backdrop"
      bodyClassName="pf-drawer-body"
    >
      <header className="pf-dh">
        <h2 id="pf-drawer-title">{tr("Настройки профиля")}</h2>
        <button
          type="button"
          className="pf-ib"
          aria-label={tr("Закрыть")}
          onClick={close}
        >
          <ProfileIcon name="x" size={17} weight={2} />
        </button>
      </header>
      <div className="pf-db">
        <div>
          <div className="pf-lb">{tr("Аватар и имя")}</div>
          <div className="pf-avrow">
            <Avatar account={account} name={name} className="pf-av2" />
            <div className="pf-nf">
              <div className="pf-fld is-locked">
                <span>{name}</span>
                <span className="pf-fld-note">
                  <ProfileIcon name="lock" size={13} weight={2} />
                  {tr("меняется на сайте")}
                </span>
              </div>
              <div className="pf-bt">
                <Button
                  size="sm"
                  className="pf-btn"
                  icon={<ProfileIcon name="ext" size={15} weight={1.9} />}
                  onClick={() => openLink(siteProfileUrl())}
                >
                  {tr("Открыть профиль на сайте")}
                </Button>
              </div>
            </div>
          </div>
        </div>
        <div>
          <div className="pf-lb">
            {tr("Обложка")}
            <span>{tr("из твоих модов")}</span>
          </div>
          {covers.length > 0 ? (
            <div className="pf-covs">
              {covers.slice(0, COVERS_SHOWN).map((tile) => {
                const on = cover?.key === tile.key;
                return (
                  <div className={`pf-cvt${on ? " is-on" : ""}`} key={tile.key}>
                    <img
                      src={tile.picture}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      draggable={false}
                    />
                    <span>{tile.name}</span>
                    {on && (
                      <i className="pf-ck">
                        <ProfileIcon name="check" size={12} weight={3} />
                      </i>
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}
          <p className="pf-hintline">
            {tr(
              "Выбрать обложку можно будет позже: пока это картинка одного из твоих модов.",
            )}
          </p>
        </div>
        <div>
          <div className="pf-lb">
            {word("contacts")}
            <span>{tr("Видны в профиле на сайте и в приложении")}</span>
          </div>
          {contacts.map((contact) => (
            <div className="pf-crow" key={`${contact.kind}:${contact.text}`}>
              <span className="pf-ci">
                <ProfileIcon name={contact.kind} size={19} />
              </span>
              <div
                className="pf-fld is-locked"
                title={tr(CONTACT_NAMES[contact.kind])}
              >
                <span>{contact.text}</span>
              </div>
            </div>
          ))}
          <div className="pf-addc is-off" aria-disabled="true">
            <ProfileIcon name="plus" size={16} weight={2} />
            {tr("Добавить контакт")}
            <span>{tr("скоро")}</span>
          </div>
        </div>
        <div className="pf-quiet">
          {step === "confirm" || step === "busy" ? (
            <div className="pf-cf">
              <p>
                <b>{tr("Выйти из аккаунта")}</b>
                {tr(
                  "Моды в игре останутся на месте. Следующий запуск — с экрана входа.",
                )}
              </p>
              <div className="pf-bt">
                <Button
                  className="pf-btn"
                  disabled={step === "busy"}
                  onClick={() => setStep("idle")}
                >
                  {tr("Отмена")}
                </Button>
                <Button
                  className="pf-btn pf-btn-confirm"
                  icon={<ProfileIcon name="out" size={16} weight={1.9} />}
                  disabled={step === "busy"}
                  onClick={signOut}
                >
                  {tr("Да, выйти")}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="link"
              size="sm"
              className="pf-btn pf-so"
              icon={<ProfileIcon name="out" size={16} weight={1.8} />}
              onClick={() => setStep("confirm")}
            >
              {tr("Выйти из аккаунта")}
            </Button>
          )}
          {error && (
            <em className="pf-err" role="alert">
              {error}
            </em>
          )}
        </div>
      </div>
      <footer className="pf-df">
        <Button className="pf-btn" onClick={close}>
          {tr("Отмена")}
        </Button>
        {/* Сохранять пока нечего: имя меняется на сайте, контакты и обложка появятся позже — кнопка стоит, как в макете, но не нажимается. */}
        <Button
          className="pf-btn pf-save"
          variant="primary"
          disabled
          title={tr("Сохранять пока нечего: имя меняется на сайте")}
        >
          {tr("Сохранить")}
        </Button>
      </footer>
    </Dialog>
  );
}
