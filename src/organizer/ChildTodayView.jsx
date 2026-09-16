import React, { useEffect, useMemo, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../Firebase.js";
import { subscribeItems } from "../data/itemsRepository.js";
import { bucketItems, choresDueToday } from "./itemBuckets.js";
import { ITEM_TYPE_META } from "../data/itemTypes.js";

/**
 * Minimal child-facing "My Day" — assignments/study tasks/upcoming
 * assessments (canonical items) plus today's chores (legacy projection),
 * scoped to the selected stable childId. Read-only in Phase 1 besides
 * chore-toggle isn't exposed here (that stays a parent action).
 */
const ChildTodayView = ({ uid, childId, isAdmin }) => {
  const [items, setItems] = useState([]);
  const [choreTemplates, setChoreTemplates] = useState({});
  const [choreCompletions, setChoreCompletions] = useState({});

  const ctx = useMemo(() => ({ uid, isAdmin }), [uid, isAdmin]);

  useEffect(() => {
    if (!childId) return undefined;
    const unsub = subscribeItems(ctx, { childId }, setItems);
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.uid, ctx.isAdmin, childId]);

  useEffect(() => {
    if (isAdmin) {
      try {
        const raw = localStorage.getItem("crestly_admin_chores");
        const parsed = raw ? JSON.parse(raw) : {};
        setChoreTemplates(parsed.templates || {});
        setChoreCompletions(parsed.completions || {});
      } catch {
        // ignore — same best-effort behavior as the rest of the guest/local path
      }
      return undefined;
    }
    if (!db || !uid) return undefined;
    const unsub = onSnapshot(doc(db, "users", uid), (snap) => {
      const data = snap.exists() ? snap.data() : {};
      setChoreTemplates(data.choreTemplates || {});
      setChoreCompletions(data.choreCompletions || {});
    });
    return unsub;
  }, [uid, isAdmin]);

  if (!childId) return null;

  const buckets = bucketItems(items, { childId });
  const chores = choresDueToday(choreTemplates, choreCompletions, childId);
  const dueNow = [...buckets.overdue, ...buckets.today];
  const nothingAtAll = dueNow.length === 0 && chores.length === 0 && buckets.upcoming.length === 0;

  return (
    <div className="bg-white rounded-3xl border border-gray-200 shadow-md p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">🗓️</span>
        <h3 className="text-lg font-extrabold text-gray-900">My Day</h3>
      </div>

      {nothingAtAll && <p className="text-sm text-gray-600">Nothing on your plate right now. 🎉</p>}

      {dueNow.length > 0 && (
        <div className="space-y-2 mb-4">
          {dueNow.map((item) => {
            const meta = ITEM_TYPE_META[item.type] || {};
            const overdue = buckets.overdue.includes(item);
            return (
              <div key={item.id} className={`rounded-2xl p-3 border ${overdue ? "border-red-300 bg-red-50" : "border-gray-200 bg-gray-50"}`}>
                <div className="font-extrabold text-gray-900 text-sm">
                  {meta.icon} {item.title}
                </div>
                {(item.subject || item.academicTopic || item.academicUnit) && (
                  <div className="text-xs text-gray-600">
                    {[item.subject, item.academicTopic, item.academicUnit].filter(Boolean).join(" · ")}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {chores.length > 0 && (
        <div className="space-y-1.5 mb-4">
          <div className="text-xs font-bold text-gray-500 uppercase">Chores</div>
          {chores.map((c) => (
            <div key={c.id} className={`text-sm font-semibold text-gray-800 ${c.done ? "line-through opacity-50" : ""}`}>
              🧹 {c.text}
            </div>
          ))}
        </div>
      )}

      {buckets.upcoming.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-bold text-gray-500 uppercase">Coming up</div>
          {buckets.upcoming.slice(0, 5).map((item) => {
            const meta = ITEM_TYPE_META[item.type] || {};
            const dateLabel = item.dueDate || item.startDate;
            return (
              <div key={item.id} className="flex items-center gap-2 text-sm text-gray-700">
                <span className="text-xs font-bold text-purple-700 flex-shrink-0" style={{ minWidth: 60 }}>
                  {dateLabel}
                </span>
                <span className="truncate">
                  {meta.icon} {item.title}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ChildTodayView;
