import * as appErrors from "../../features/app-errors/index.js";
import DesktopPageRouter from "./DesktopPageRouter.jsx";

/**
 * Маршрутизатор страниц с двумя охранами: чужаку страница публикации не
 * показывается совсем, а падение любой страницы остаётся внутри границы
 * ошибок и не ломает окно.
 */
export default function GuardedDesktopPageRouter(props) {
  const { page, publisher, home } = props;
  const language = home?.language;
  // Страница публикации — только для администрации (сторож: admin-gate-sources.test.js).
  if (page === "publisher" && !publisher?.isAdmin) return null;
  // Ключ по странице: с новой страницей граница и маршрутизатор начинают с нуля.
  return (
    <appErrors.AppErrorBoundary key={page} language={language} page={page}>
      <DesktopPageRouter {...props} />
    </appErrors.AppErrorBoundary>
  );
}
