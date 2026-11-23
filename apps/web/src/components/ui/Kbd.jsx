// Плашка клавиши: подпись уже готова, компонент её не переводит и не меняет.
export default function Kbd({ children, className = "" }) {
  return <kbd className={className ? `ui-kbd ${className}` : "ui-kbd"}>{children}</kbd>;
}
