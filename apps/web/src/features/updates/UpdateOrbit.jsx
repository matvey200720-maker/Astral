import { WarningCircle, Check } from "../../components/ui/icons.jsx";

// Длина окружности радиуса 92: то же число (578.05px) стоит в updates.css.
// Радиус и длина меняются только вместе (docs/beta/release-channels.md, §5.4).
const CIRCUMFERENCE = 2 * Math.PI * 92;

// Доля закрашенного кольца по виду знака: замкнуто у done и error, растёт у progress, иначе пусто.
const unit = (v) => (Number.isFinite(v) && v > 0 ? Math.min(v, 1) : 0);
const SHARES = new Map([
  ["progress", unit],
  ["error", () => 1],
  ["done", () => 1],
]);
const BADGES = new Map([
  ["error", WarningCircle],
  ["done", Check],
]);

// Круги кольца по порядку: [класс, радиус, поворот]. Два pulse подряд: второй сдвигает стиль по времени.
const RINGS = [
  ["update-orbit-track", 92],
  ["update-orbit-ring2", 80],
  ["update-orbit-pulse", 92],
  ["update-orbit-pulse", 92],
  ["update-orbit-flash", 92],
  ["update-orbit-arc", 92, "rotate(-90 104 104)"],
];
// Спутники: [класс, радиус, как поворачивать]; «голова» едет по закрашенной доле.
const turn = (share) => ({ transform: `rotate(${(share * 360).toFixed(2)}deg)` });
const SATELLITES = [
  ["update-orbit-head", 4.2, turn],
  ["update-orbit-drift", 3.4, null],
];

const Star = () => <img src="/brand/astral-mark.png" draggable="false" className="update-orbit-star" alt="" />;

const Rings = ({ share }) => (
  <svg viewBox="0 0 208 208" focusable="false">
    {RINGS.map(([cls, r, transform], n) => (
      <circle key={n} transform={transform} r={r} cy="104" cx="104" className={cls} />
    ))}
    {SATELLITES.map(([cls, r, tilt], n) => (
      <g key={n} style={tilt ? tilt(share) : undefined} className={cls}>
        <circle r={r} cy="12" cx="104" />
      </g>
    ))}
  </svg>
);

const UpdateOrbit = (props) => {
  const { kind = "idle", value = 0, size = "lg" } = props;
  const share = (SHARES.get(kind) ?? (() => 0))(value);
  const Badge = BADGES.get(kind);
  const off = (CIRCUMFERENCE * (1 - share)).toFixed(2) + "px";
  return (
    <div style={{ "--orbit-off": off }} data-size={size} data-kind={kind} className="update-orbit" aria-hidden="true">
      <Star />
      <Rings share={share} />
      <span className="update-orbit-badge">{Badge ? <Badge weight="bold" /> : null}</span>
    </div>
  );
};

export default UpdateOrbit;
