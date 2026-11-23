import * as Prewarm from "./SettingsPrewarm.jsx";
import { featurePage, usePreloadWhenIdle } from "../lazy-page.jsx";
import Dialog from "../../ui/Dialog.jsx";

function loadSettingsChunk() {
  return import("../../../features/settings/index.js");
}

const SettingsPage = featurePage(loadSettingsChunk, "SettingsPage");

// Одна и та же ссылка на всю жизнь модуля: хук подтяжки перезапускает эффект при смене массива.
const WARMUP_PAGES = [SettingsPage];

const DIALOG_FIXED = Object.freeze({
  titleId: "settings-page-title",
  showClose: false,
  deferFocus: true,
  size: "settings",
  className: "settings-window",
  backdropClassName: "settings-window-backdrop",
  bodyClassName: "settings-window-body",
});

// Подтяжка куска, прогрев и прогрев раскладки — строго в этом порядке.
function useWindowPrewarm(open, busy) {
  usePreloadWhenIdle(WARMUP_PAGES);
  const prewarm = Prewarm.useSettingsPrewarm({ busy, open });
  const { abort, done, keep, warming } = prewarm;
  Prewarm.useWarmLayout({ active: warming, busy: prewarm.busy, onAbort: abort, onDone: done });
  return keep;
}

const SettingsWindow = (props) => {
  const { open, onClose, settings } = props;
  const keep = useWindowPrewarm(open, !!settings.installing);
  const page = <SettingsPage {...settings} onBack={onClose} />;

  return (
    <Dialog open={open} keep={keep} onClose={onClose} {...DIALOG_FIXED}>
      {page}
    </Dialog>
  );
};

export default SettingsWindow;
