import { Check } from "../../ui/icons.jsx";

/**
 * Shared slot library used by weapons and clothing.
 * The caller owns media rendering so PNG and GLB-backed previews can evolve
 * independently without duplicating selection and removal behaviour.
 */
export default function WorkshopSlotGrid({
  slots,
  installedMods,
  removalMode,
  removalIds,
  onOpen,
  onToggleRemoval,
  renderPreview,
  getTitle,
  getSubtitle,
  className = "",
}) {
  return (
    <section
      className={`weapon-slot-grid workshop-slot-grid ${className}`.trim()}
      data-assembly-grid
    >
      {slots.map((slot, index) => {
        const installedMod = installedMods.find(
          (mod) => mod.catalogSlot === slot.id,
        );
        const removalSelected = Boolean(
          installedMod && removalIds.includes(installedMod.id),
        );

        return (
          <button
            type="button"
            className={`${installedMod ? "is-installed" : ""}${
              removalMode ? " is-editing" : ""
            }${removalSelected ? " is-removal-selected" : ""}`}
            key={slot.id}
            aria-pressed={
              removalMode && installedMod ? removalSelected : undefined
            }
            onClick={() => {
              if (removalMode) {
                onToggleRemoval(installedMod);
                return;
              }
              onOpen(slot.id);
            }}
          >
            {renderPreview({ slot, installedMod, index })}
            <div>
              <h3>{getTitle(slot)}</h3>
              <span>{getSubtitle(slot, installedMod)}</span>
            </div>
            {removalMode && installedMod && (
              <span className="workshop-remove-selector" aria-hidden="true">
                {removalSelected && <Check />}
              </span>
            )}
          </button>
        );
      })}
    </section>
  );
}
