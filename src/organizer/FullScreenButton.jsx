import React, { useEffect, useState } from "react";
import { SURFACE } from "./boardTheme.js";

/* ─────────────────────── Full Screen control ───────────────────────
 * A small display affordance for the wall-mounted/kitchen-display use case
 * (Section 14-15) — enters/exits the browser's native Fullscreen API. Purely
 * presentational: never touches Family Board data/state, and is a no-op
 * (renders nothing) when the API isn't available, per Section 15's
 * "handles unsupported browsers gracefully" requirement — there is no
 * disabled/greyed-out button to explain, it simply isn't there.
 *
 * Uses the unprefixed Fullscreen API only (document.documentElement.
 * requestFullscreen / document.exitFullscreen / document.fullscreenElement
 * / the "fullscreenchange" event) — every evergreen browser Family Board
 * targets (Chrome, Edge, Firefox, Safari 16.4+) supports the unprefixed
 * form, so no vendor-prefix fallback branching is needed here.
 */
const isFullscreenSupported = () =>
  typeof document !== "undefined" && !!document.documentElement.requestFullscreen && document.fullscreenEnabled !== false;

const FullScreenButton = () => {
  const [supported] = useState(isFullscreenSupported);
  const [isFullscreen, setIsFullscreen] = useState(() => !!document.fullscreenElement);

  useEffect(() => {
    if (!supported) return;
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [supported]);

  if (!supported) return null;

  const toggle = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  };

  return (
    <button
      data-testid="fullscreen-toggle"
      onClick={toggle}
      aria-label={isFullscreen ? "Exit Full Screen" : "Full Screen"}
      className="font-semibold transition"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        height: 40,
        padding: "0 14px",
        borderRadius: 999,
        fontSize: 13,
        color: SURFACE.textSecondary,
        background: "#FFFFFF",
        border: `1px solid ${SURFACE.border}`,
      }}
    >
      <span aria-hidden="true">⛶</span>
      {isFullscreen ? "Exit Full Screen" : "Full Screen"}
    </button>
  );
};

export default FullScreenButton;
