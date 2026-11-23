import BranchOffer from "./BranchOffer.jsx";
import * as dom from "react-dom";
import BranchDeniedDialog from "./BranchDeniedDialog.jsx";
import * as overlay from "./overlay-host.js";
import BranchSwitchDialog from "./BranchSwitchDialog.jsx";

// Окна по старшинству: пока главный процесс ждёт ответа на вопрос, «Доступ снят» ни к чему.
const WINDOWS = [
  { slot: "switchRequest", View: BranchSwitchDialog, prop: "request" },
  { slot: "denied", View: BranchDeniedDialog, prop: "denied" },
];

const BranchesLayers = (props) => {
  const { language, offer } = props;
  const host = overlay.useOverlayHost();
  const shown = WINDOWS.find(({ slot }) => props[slot]);
  // Карточке наружу уходит только канал, не событие клика.
  const giveChannel = (give) => () => give(offer.channel);
  const card = {
    branch: offer,
    language,
    onHide: giveChannel(props.onHide),
    onLater: giveChannel(props.onLater),
  };

  // Карточка в углу: без слоя оверлея (и без .desktop-app) её не рисуем.
  return (
    <>
      {shown ? <shown.View {...{ [shown.prop]: props[shown.slot], language }} /> : null}
      {offer && host ? dom.createPortal(<BranchOffer {...card} />, host) : null}
    </>
  );
};

export default BranchesLayers;
