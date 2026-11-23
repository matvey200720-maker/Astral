import { stepsOf } from "./model.js";
import { Check } from "../../components/ui/icons.jsx";

const Mark = ({ done }) => (
  <span className="updates-step-mark" aria-hidden="true">
    {done ? <Check weight="bold" /> : null}
  </span>
);

const UpdateSteps = (props) => {
  const list = stepsOf(props.state);
  if (!list) return null;
  // Подпись списка и названия пунктов лежат в одном словаре: label отделяем от имён.
  const { label, ...names } = props.copy.steps;
  return (
    <ol className="updates-steps" aria-label={label}>
      {Array.from(list, ({ id, status }) => (
        <li
          key={id}
          data-status={status}
          aria-current={status === "active" ? "step" : undefined}
          style={
            status === "active" && props.percent != null
              ? {
                  "--step-fill":
                    Math.min(Math.max(props.percent, 0), 100) / 100,
                }
              : undefined
          }
        >
          <Mark done={status === "done"} />
          <span className="updates-step-name">{names[id]}</span>
        </li>
      ))}
    </ol>
  );
};

export default UpdateSteps;
