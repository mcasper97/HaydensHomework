import React, { useEffect, useState } from "react";
import { subscribeApprovedSenders, addApprovedSender, updateApprovedSenderTarget, removeApprovedSender } from "./data/gmailApprovedSendersRepository.js";
import { buildSenderTargetOptions, parseSenderTargetValue, senderTargetToValue, getSenderTargetLabel } from "./data/gmailApprovedSenders.js";

/* ─────────────────────── Approved Gmail senders (Settings) ───────────────────────
 * Moved out of AuthShell.jsx as part of the UI/IA refactor and split from
 * its former sibling, the "Check Email" action (extraction/ingestion
 * logic is unchanged and now lives in GmailCheckEmailAction.jsx, a
 * primary Parent Home action, per the task: sender/email mapping belongs
 * in Settings, but the Check Email trigger belongs on Parent Home). This
 * file keeps only the exact-address allow-list CRUD — no behavior change
 * from the original sender-management code. Only rendered once Gmail is
 * connected (see GmailConnectionPanel).
 */
const GmailApprovedSendersPanel = ({ ctx, childProfiles }) => {
  const [senders, setSenders] = useState([]);
  const [newEmail, setNewEmail] = useState("");
  const [newTargetValue, setNewTargetValue] = useState("review");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const unsub = subscribeApprovedSenders(ctx, setSenders);
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.uid, ctx.isAdmin]);

  const targetOptions = buildSenderTargetOptions(childProfiles);

  const handleAdd = async () => {
    setError("");
    setBusy(true);
    try {
      await addApprovedSender(ctx, newEmail, parseSenderTargetValue(newTargetValue));
      setNewEmail("");
      setNewTargetValue("review");
    } catch (e) {
      setError(e.message || "Could not add that address.");
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (senderId) => {
    setError("");
    await removeApprovedSender(ctx, senderId);
  };

  const handleChangeTarget = async (senderId, value) => {
    setError("");
    try {
      await updateApprovedSenderTarget(ctx, senderId, parseSenderTargetValue(value));
    } catch (e) {
      setError(e.message || "Could not update that sender's target.");
    }
  };

  return (
    <div className="mt-4 pt-4 border-t border-gray-700">
      <h4 className="text-white font-semibold text-sm mb-2">Approved senders</h4>
      <p className="text-gray-400 text-xs mb-3">
        Only email from these exact addresses will ever be checked.
      </p>

      {senders.length === 0 ? (
        <p className="text-gray-400 text-sm mb-3">No approved senders yet.</p>
      ) : (
        <div className="space-y-2 mb-3">
          {senders.map((sender) => (
            <div key={sender.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl" style={{ background: "#1C1C1E" }}>
              <div className="min-w-0 flex-1">
                <div className="text-white text-sm break-all">{sender.email}</div>
                <select
                  value={senderTargetToValue(sender)}
                  onChange={(e) => handleChangeTarget(sender.id, e.target.value)}
                  aria-label={`Who ${sender.email} applies to (currently ${getSenderTargetLabel(sender, childProfiles)})`}
                  className="mt-1 px-2 py-1 rounded-lg text-white text-xs border border-gray-600"
                  style={{ background: "#2a2a2c" }}
                >
                  {targetOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={() => handleRemove(sender.id)}
                className="text-red-400 hover:text-red-300 text-xs font-semibold shrink-0"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2 mb-3">
        <input
          type="email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          placeholder="teacher@school.edu"
          className="w-full px-3 py-2 rounded-xl text-white text-sm border border-gray-600"
          style={{ background: "#1C1C1E" }}
        />
        <div className="flex gap-2">
          <select
            value={newTargetValue}
            onChange={(e) => setNewTargetValue(e.target.value)}
            className="flex-1 px-3 py-2 rounded-xl text-white text-sm border border-gray-600"
            style={{ background: "#1C1C1E" }}
          >
            {targetOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <button
            onClick={handleAdd}
            disabled={busy || !newEmail.trim()}
            className="px-4 py-2 rounded-xl font-semibold text-white text-sm transition hover:opacity-90 disabled:opacity-50 shrink-0"
            style={{ background: "linear-gradient(135deg, #2d6b3f, #1f4a2c)" }}
          >
            Add
          </button>
        </div>
      </div>

      {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
    </div>
  );
};

export default GmailApprovedSendersPanel;
