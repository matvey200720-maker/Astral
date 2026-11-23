// Номер не должен рваться по дефису при переносе строки, поэтому каждый известный номер
// уходит в свой span; в скопированном тексте дефис остаётся обычным.
export default function VersionText({ versions = [], text }) {
  // Длинные номера идут первыми: 0.9.0-beta.12 не распадается на 0.9.0-beta.1 и «2».
  const known = versions.filter((v) => v && typeof v === "string").sort((a, b) => -(a.length - b.length));
  if (!(known.length && text)) return text;
  // Знаки номера (точка, плюс, скобки) ищутся буквально; найденные номера встают на нечётные места.
  const re = new RegExp(`(${known.map((v) => v.replace(/\W/g, "\\$&")).join("|")})`);
  return String(text)
    .split(re)
    .map((s, i) =>
      i % 2 ? (
        <span key={i} className="updates-version">
          {s}
        </span>
      ) : (
        s
      ),
    );
}
