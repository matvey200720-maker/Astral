import React from "react";
import {
  BaseballCap,
  Eyeglasses,
  FaceMask,
  HandPalm,
  HandbagSimple,
  Pants,
  PenNibStraight,
  ShieldCheck,
  Sneaker,
  SuitcaseSimple,
  TShirt,
} from "./components/ui/icons.jsx";

const clothingArtwork = {
  armor: ShieldCheck,
  tshirts: TShirt,
  "government-clothing": SuitcaseSimple,
  pants: Pants,
  shoes: Sneaker,
  hats: BaseballCap,
  accessories: Eyeglasses,
  gloves: HandPalm,
  masks: FaceMask,
  tattoos: PenNibStraight,
  bags: HandbagSimple,
};

export const WorkshopSlotArtwork = React.memo(function WorkshopSlotArtwork({
  slotId,
}) {
  const Icon = clothingArtwork[slotId];
  if (!Icon) return null;

  return (
    <span
      className="workshop-slot-artwork"
      data-workshop-artwork={slotId}
      aria-hidden="true"
    >
      <span className="workshop-slot-artwork-halo" />
      <Icon weight="duotone" />
    </span>
  );
});
