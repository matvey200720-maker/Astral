/*
 * Заставка «Контур», ошибка запуска (15.11.2026): два действия. Едет отдельным куском, только когда запуск не удался
 * (`startupFlow.fail`): обычному запуску он не нужен. «Закрыть Astral» закрывает окно (последнее окно — выход из приложения),
 * «Написать в поддержку» открывает Discord сообщества, где ведётся поддержка.
 */

import { tr } from "../../../locales/ui.js";
import Button from "../../../components/ui/Button.jsx";
import { communityLinks } from "../../../components/desktop/desktopShellDefaults.js";
import { openLink } from "../../../components/desktop/settings/open-link.js";
import { FAIL_WORDS } from "./splash-words.js";

export default function SplashFailure() {
  return (
    <div className="ss-actions">
      <Button variant="primary" size="lg" onClick={() => window.close()}>
        {tr(FAIL_WORDS.close)}
      </Button>
      <Button
        variant="secondary"
        size="lg"
        onClick={() => openLink(communityLinks.discord)}
      >
        {tr(FAIL_WORDS.support)}
      </Button>
    </div>
  );
}
