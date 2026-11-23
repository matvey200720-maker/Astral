import { motionEnabled } from "../../../motion-preference.js";

/*
 * Полёт обложки к кнопке «Загрузки»: мод, который поставили, видно, куда
 * он ушёл. Отдельным модулем — его зовёт и оболочка (установка сборки), и
 * страница мода, а страница мода грузится своим куском только при открытии
 * мода и в стартовый кусок из-за одной этой функции ехать не должна.
 */
export function animateInstallToDownloads({ source, cover, label }) {
  if (typeof document === "undefined" || !motionEnabled()) {
    return Promise.resolve();
  }
  const target = document.querySelector(".sidebar-download-button");
  if (!target || typeof target.animate !== "function") {
    return Promise.resolve();
  }
  const sourceRect =
    source?.getBoundingClientRect?.() ||
    new DOMRect(
      window.innerWidth / 2 - 58,
      window.innerHeight / 2 - 34,
      116,
      68,
    );
  const targetRect = target.getBoundingClientRect();
  const width = Math.min(132, Math.max(84, sourceRect.width || 116));
  const height = Math.min(78, Math.max(52, sourceRect.height || 68));
  const startX = sourceRect.left + sourceRect.width / 2 - width / 2;
  const startY = sourceRect.top + sourceRect.height / 2 - height / 2;
  /* Редактор мастерской убирает рельс за левый край (navigation-rail.css), и
     кнопка «Загрузки» стоит за экраном. Карточка тогда садится на край окна на
     высоте кнопки, а не улетает за него, где её уже не видно. */
  const aimX = Math.max(targetRect.left + targetRect.width / 2, 24);
  const aimY = Math.min(
    Math.max(targetRect.top + targetRect.height / 2, 24),
    window.innerHeight - 24,
  );
  const deltaX = aimX - (startX + width / 2);
  const deltaY = aimY - (startY + height / 2);
  const flyer = document.createElement("div");
  const flyerLabel = document.createElement("span");
  flyer.className = "install-flight-card";
  flyer.setAttribute("aria-hidden", "true");
  flyer.style.left = `${startX}px`;
  flyer.style.top = `${startY}px`;
  flyer.style.width = `${width}px`;
  flyer.style.height = `${height}px`;
  /* Работа мастерской обложки-картинки не имеет — карточка без неё, а не с
     `url("")`, который браузер читает как адрес самой страницы. */
  if (cover) flyer.style.backgroundImage = `url("${cover}")`;
  else flyer.classList.add("is-plain");
  flyerLabel.textContent = label || "Astral";
  flyer.appendChild(flyerLabel);
  document.body.appendChild(flyer);
  const animation = flyer.animate(
    [
      {
        opacity: 0,
        transform: "translate3d(0, 8px, 0) scale(0.92) rotate(0deg)",
        borderRadius: "14px",
        clipPath: "inset(0 0 0 0 round 14px)",
      },
      {
        opacity: 1,
        offset: 0.12,
        transform: "translate3d(0, 0, 0) scale(1) rotate(0deg)",
        borderRadius: "14px",
        clipPath: "inset(0 0 0 0 round 14px)",
      },
      {
        opacity: 1,
        offset: 0.52,
        transform: `translate3d(${deltaX * 0.52}px, ${deltaY * 0.34 - 92}px, 0) scale(0.66) rotate(-5deg)`,
        borderRadius: "18px",
        clipPath: "inset(4% 10% 4% 10% round 18px)",
      },
      {
        opacity: 0.92,
        offset: 0.84,
        transform: `translate3d(${deltaX * 0.9}px, ${deltaY * 0.8 - 28}px, 0) scale(0.31) rotate(7deg)`,
        borderRadius: "24px",
        clipPath: "inset(8% 20% 8% 20% round 24px)",
      },
      {
        opacity: 0,
        transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(0.08) rotate(10deg)`,
        borderRadius: "999px",
        clipPath: "inset(18% 34% 18% 34% round 999px)",
      },
    ],
    {
      duration: FLIGHT_MS,
      easing: "cubic-bezier(0.2, 0.78, 0.2, 1)",
      fill: "forwards",
    },
  );
  target.animate(
    [
      { transform: "translateY(0) scale(1)" },
      { transform: "translateY(-3px) scale(1.04)", offset: 0.78 },
      { transform: "translateY(0) scale(1)" },
    ],
    {
      duration: 860,
      easing: "cubic-bezier(0.2, 0.78, 0.2, 1)",
    },
  );
  /* Установка ждёт полёта, а полёт — кадров. В свёрнутом или скрытом окне
     анимации стоят, и `finished` не приходит, пока окно не покажут: нажатие
     «Установить» молча висело бы. Поэтому не дольше самого полёта с запасом. */
  const landed = animation.finished.catch(() => undefined);
  const timeout = new Promise((resolve) =>
    setTimeout(resolve, FLIGHT_MS + FLIGHT_GRACE_MS),
  );
  return Promise.race([landed, timeout]).finally(() => flyer.remove());
}

const FLIGHT_MS = 760;
const FLIGHT_GRACE_MS = 240;
