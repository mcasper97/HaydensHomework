import React from "react";

/* ============================== Illustrations ==============================
 * ILLUSTRATION-SYSTEM PASS: every piece below (house, small tree, tree
 * cluster, sun) is a REAL crop out of the approved mockup's own Today-hero
 * landscape scene (the same image the house/avatars were cropped from
 * earlier), each with its own real alpha transparency — not a screenshot
 * of the whole scene, not a single flattened background image, and not a
 * blurred/masked rectangle. Cropping used a multi-sample chroma-key against
 * that scene's own sky/hill colors (not a naive single-color key, since the
 * scene's background shifts from mint-green sky to a pale-blue distant
 * hill), so each asset's edge is genuinely transparent, not faded/blurred to
 * hide a crop boundary. These pieces are meant to be COMPOSED together
 * (house + tree + hill silhouette + sun/cloud) by whatever renders them,
 * rather than used as one pre-baked scene image — that's what lets Today's
 * hero and each future-day header show a different, deterministic
 * arrangement of the same consistent art style instead of one static PNG
 * repeated everywhere.
 *
 * The learner avatars below are the same kind of real crop (the mockup's
 * cat/bear artwork for the household's first two learners); a learner
 * beyond that has no matching source art, so LearnerAvatar falls back to a
 * hand-drawn SVG critter face tinted by that learner's own accent color —
 * still a picture, just not a literal crop of the mockup.
 */

const HOUSE_SRC = "/family-board/landscape/house.png"; // 75x57 — house + its own small foundation bush
const TREE_SMALL_SRC = "/family-board/landscape/tree-small.png"; // 38x56 — single small tree
const TREE_LARGE_SRC = "/family-board/landscape/tree-large.png"; // 84x98 — large tree + a second smaller tree beside it
const SUN_SRC = "/family-board/landscape/sun.png"; // 112x90 — the mockup's own sun-with-rays
const LEARNER_AVATAR_IMAGES = ["/family-board/avatar-coral.png", "/family-board/avatar-aqua.png"];

// The brand mark / landscape-scene house — a crisp, real crop with genuine
// alpha transparency (no mask, no blur, no visible rectangle) sized by its
// own native 75:57 aspect ratio.
export const HouseIllustration = ({ size = 40 }) => (
  <img
    src={HOUSE_SRC}
    width={size}
    height={Math.round((size * 57) / 75)}
    alt=""
    aria-hidden="true"
    style={{ display: "block", objectFit: "contain" }}
  />
);

// A single small tree — native 38:56 aspect ratio.
export const TreeSmallIllustration = ({ size = 40 }) => (
  <img
    src={TREE_SMALL_SRC}
    width={size}
    height={Math.round((size * 56) / 38)}
    alt=""
    aria-hidden="true"
    style={{ display: "block", objectFit: "contain" }}
  />
);

// A large tree paired with a smaller companion tree — native 84:98 aspect
// ratio. Used where a header has room for a fuller cluster (Today's hero);
// TreeSmallIllustration is the single-tree alternative for tighter
// future-day headers.
export const TreeLargeIllustration = ({ size = 60 }) => (
  <img
    src={TREE_LARGE_SRC}
    width={size}
    height={Math.round((size * 98) / 84)}
    alt=""
    aria-hidden="true"
    style={{ display: "block", objectFit: "contain" }}
  />
);

// A soft rolling-hill/grass silhouette — a flat, two-tone SVG shape (not a
// raster crop: the mockup's own hill band has no clean edges to crop at
// arbitrary widths, and every header needs a different width), in the same
// green family as the mockup's own grass. Deliberately just a silhouette —
// house/tree/sun art supplies all the detail, this is the "ground" they
// stand on.
export const HillIllustration = ({ width = 200, height = 40, flat = false, fadeRight = false }) => (
  <svg
    width={width}
    height={height}
    viewBox="0 0 200 40"
    preserveAspectRatio="none"
    aria-hidden="true"
    style={{
      display: "block",
      // Tapers the hill's own right edge to transparent instead of ending
      // as a hard vertical "shelf" — used where the hill bleeds into open
      // space rather than being clipped by a header's own edge anyway.
      ...(fadeRight
        ? { WebkitMaskImage: "linear-gradient(to right, #000 82%, transparent 100%)", maskImage: "linear-gradient(to right, #000 82%, transparent 100%)" }
        : null),
    }}
  >
    {flat ? (
      <rect x="0" y="14" width="200" height="26" fill="#8FDB7A" />
    ) : (
      <path d="M0 26 Q30 8 60 20 T130 14 T200 22 V40 H0 Z" fill="#8FDB7A" />
    )}
    <path d="M0 34 Q40 24 90 30 T200 28 V40 H0 Z" fill="#6FCB63" />
  </svg>
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

// The mockup's own sun-with-rays artwork — a real crop (same style as
// house/tree above), replacing the earlier hand-drawn SVG sun so Today's
// hero sun matches the same illustration system as the rest of its scene.
export const SunIllustration = ({ size = 54 }) => (
  <img
    src={SUN_SRC}
    width={size}
    height={Math.round((size * 90) / 112)}
    alt=""
    aria-hidden="true"
    style={{ display: "block", objectFit: "contain" }}
  />
);

// A soft, flat-vector cloud cluster — hand-drawn (no clean single cloud to
// crop out of the source scene at this simple a shape), but already in a
// plain, flat, two-tone style consistent with the hill silhouette above.
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
