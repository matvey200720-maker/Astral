import helmet from "helmet";

export const desktopSecurityMiddleware = helmet({
  crossOriginResourcePolicy: { policy: "same-site" },
  contentSecurityPolicy: {
    directives: {
      /* Аватар аккаунта — с CDN Discord, и картинка ролика YouTube (кадр «Смотреть на YouTube», когда автор запретил
         встраивание) — только картинкой: ни скрипты, ни запросы окна туда не ходят. */
      "img-src": ["'self'", "data:", "blob:", "https://cdn.discordapp.com", "https://i.ytimg.com"],
      /* Канал данных Rust-движка (`native/astral-engine/.../http.rs`): порт
         случайный и узнаётся позже загрузки окна, поэтому — любой порт
         петли. Только запросы данных: скрипты отсюда не грузятся. */
      "connect-src": ["'self'", "blob:", "http://127.0.0.1:*"],
      "script-src": ["'self'", "'wasm-unsafe-eval'"],
      /* Плеер обзора в окне публикации: кадр для заявки снимают из видео
         YouTube, а локальное видео модератора играет из blob:. */
      "frame-src": [
        "'self'",
        "https://www.youtube-nocookie.com",
        "https://www.youtube.com",
      ],
      "media-src": ["'self'", "blob:"],
    },
  },
});
