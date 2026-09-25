import React from "react";

/* ============================== Illustrations ==============================
 * The house icon and the first two learner avatars below are REAL pixels
 * cropped directly out of the approved mockup image itself (public/
 * family-board/house-icon.png, avatar-coral.png, avatar-aqua.png) — not a
 * hand-drawn approximation. The house had its pale sky-blue background
 * chroma-keyed to transparent; each avatar was cropped and given a circular
 * alpha mask so it drops onto any background as a clean circle. Sized via
 * plain <img width/height>, which — like every other load-bearing layout
 * property in this app — works with or without the Tailwind CDN.
 *
 * A learner beyond the mockup's own two (Payton/Hayden) has no matching
 * source art to crop, so LearnerAvatar falls back to a hand-drawn SVG
 * critter face tinted by that learner's own accent color for any palette
 * index past 1 — still a picture, just not a literal crop of the mockup.
 */

const HOUSE_ICON_SRC = "/family-board/house-icon.png";
const LEARNER_AVATAR_IMAGES = ["/family-board/avatar-coral.png", "/family-board/avatar-aqua.png"];

// The brand mark — the mockup's own cottage artwork, background removed.
export const HouseIllustration = ({ size = 40 }) => (
  <img src={HOUSE_ICON_SRC} width={size} height={Math.round((size * 75) / 78)} alt="" aria-hidden="true" style={{ display: "block", objectFit: "contain" }} />
);

// A learner's avatar — the mockup's own cat/bear artwork for the first two
// palette slots (a household's first two learners, the common case); a
// hand-drawn SVG critter face (tinted by the learner's own accent) for any
// additional learner beyond that, so this never breaks for a 3rd+ child.
export const LearnerAvatar = ({ accent, size = 36, index = -1 }) => {
  const src = index >= 0 ? LEARNER_AVATAR_IMAGES[index] : undefined;
  if (src) {
    return (
      <img
        src={src}
        width={size}
        height={size}
        alt=""
        aria-hidden="true"
        style={{ display: "block", borderRadius: "50%", objectFit: "cover" }}
      />
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="10" cy="11" r="7" fill={accent.border} />
      <circle cx="30" cy="11" r="7" fill={accent.border} />
      <circle cx="10" cy="11" r="3.6" fill={accent.bg} />
      <circle cx="30" cy="11" r="3.6" fill={accent.bg} />
      <circle cx="20" cy="22" r="16" fill={accent.border} />
      <circle cx="20" cy="22" r="13" fill={accent.bg} />
      <circle cx="14.5" cy="20" r="2.1" fill="#30303A" />
      <circle cx="25.5" cy="20" r="2.1" fill="#30303A" />
      <circle cx="15.1" cy="19.3" r="0.6" fill="#FFFFFF" />
      <circle cx="26.1" cy="19.3" r="0.6" fill="#FFFFFF" />
      <ellipse cx="20" cy="25.5" rx="1.8" ry="1.4" fill="#30303A" />
      <path d="M14 29 Q20 33.5 26 29" stroke="#30303A" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <circle cx="10.5" cy="26" r="2.3" fill={accent.border} opacity="0.35" />
      <circle cx="29.5" cy="26" r="2.3" fill={accent.border} opacity="0.35" />
    </svg>
  );
};

// A soft, flat-vector sun — replaces the ☀️ emoji used as Today's decorative
// corner glyph.
export const SunIllustration = ({ size = 54 }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
    <g stroke="#F5B93E" strokeWidth="2.5" strokeLinecap="round">
      <line x1="20" y1="2" x2="20" y2="7" />
      <line x1="20" y1="33" x2="20" y2="38" />
      <line x1="2" y1="20" x2="7" y2="20" />
      <line x1="33" y1="20" x2="38" y2="20" />
      <line x1="7.5" y1="7.5" x2="11" y2="11" />
      <line x1="29" y1="29" x2="32.5" y2="32.5" />
      <line x1="32.5" y1="7.5" x2="29" y2="11" />
      <line x1="11" y1="29" x2="7.5" y2="32.5" />
    </g>
    <circle cx="20" cy="20" r="10" fill="#FFCE54" stroke="#F5B93E" strokeWidth="1.5" />
  </svg>
);

// A soft, flat-vector cloud cluster — replaces the ☁️ emoji used as a
// future day's decorative corner glyph.
export const CloudIllustration = ({ size = 40 }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
    <g fill="#FFFFFF" stroke="#CBE0F0" strokeWidth="1">
      <circle cx="14" cy="22" r="8" />
      <circle cx="24" cy="19" r="9.5" />
      <circle cx="31" cy="23" r="6.5" />
      <rect x="10" y="21" width="26" height="9" rx="4.5" />
    </g>
  </svg>
);
