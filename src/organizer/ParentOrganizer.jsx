import React, { useEffect, useMemo, useState } from "react";
import { subscribeItems, updateItem, deleteItem, setItemStatus } from "../data/itemsRepository.js";
import { subscribeItemCompletions, setItemCompletion } from "../data/itemCompletionsRepository.js";
import { bucketItems, choresDueToday, todayStr, isOccurrenceCompleted } from "./itemBuckets.js";
import { ITEM_TYPE_META, ACADEMIC_TYPES } from "../data/itemTypes.js";
import ItemForm from "./ItemForm.jsx";
import AddItemPanel from "./AddItemPanel.jsx";
import { isItemEligibleForCalendarPublish } from "./calendarEventMapping.js";

/**
 * Parent Organizer — Today / Needs Attention / Upcoming, filterable by child,
 * reading/writing only the canonical itemsRepository. Chores are shown as a
 * read/complete-only projection of the existing legacy chore data (Phase 1
 * decision: chores are not migrated into canonical items) — creating/removing
 * a chore *template* still happens through FamilyBoard's existing chore UI.
 *
 * allowManage (Phase 1.5) — when false, hides the "+ type" quick-create row,
 * the ItemForm mount, and each row's Edit/Delete controls. Used by the
 * display-only Organizer view (see organizer/OrganizerDisplay.jsx) so it
 * reuses this exact same bucketing/rendering code in read-mostly form
 * instead of a separate component.
 * allowComplete — independently controls the complete-toggle checkboxes
 * (items and chores). Kept separate from allowManage per Phase 1.5: the wall
 * Organizer allows marking things done/undone but never create/edit/delete.
 */
const ParentOrganizer = ({
  ctx,
  children = [],
  choreTemplates = {},
  choreCompletions = {},
  onToggleChore,
  allowManage = true,
  allowComplete = true,
}) => {
  const [items, setItems] = useState([]);
  const [completions, setCompletions] = useState([]);
  const [filterChild, setFilterChild] = useState("");
  const [editingItem, setEditingItem] = useState(null);

  useEffect(() => {
    const unsub = subscribeItems(ctx, {}, setItems);
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.uid, ctx.isAdmin]);

  useEffect(() => {
    const unsub = subscribeItemCompletions(ctx, setCompletions);
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.uid, ctx.isAdmin]);

  const buckets = useMemo(() => bucketItems(items, { childId: filterChild || undefined }), [items, filterChild]);

  const candidateParentItems = useMemo(
    () =>
      items.filter(
        (it) =>
          ACADEMIC_TYPES.includes(it.type) &&
          it.type !== "study_task" &&
          (!filterChild || (it.childIds || []).includes(filterChild))
      ),
    [items, filterChild]
  );

  const childById = (id) => children.find((c) => c.id === id);

  const choreGroups = useMemo(() => {
    const scope = filterChild ? children.filter((c) => c.id === filterChild) : children;
    return scope
      .map((c) => ({ child: c, chores: choresDueToday(choreTemplates, choreCompletions, c.id) }))
      .filter((g) => g.chores.length > 0);
  }, [children, filterChild, choreTemplates, choreCompletions]);

  const openEdit = (item) => {
    setEditingItem(item);
  };

  // Create-item logic itself (SourceRecord + createItem) lives in
  // AddItemPanel.jsx now (SHIP BLOCKER correction — extracted so Parent
  // Home can reuse it without navigating into Family Board). This handler
  // is edit-only; existingItem is always set when this form is shown.
  const handleEditSubmit = async (payload, existing) => {
    await updateItem(ctx, existing.id, payload);
    setEditingItem(null);
  };

  const handleComplete = (item) => {
    if (item.schedule?.recurring) {
      const today = todayStr();
      const done = isOccurrenceCompleted(item.id, today, completions);
      setItemCompletion(ctx, { itemId: item.id, occurrenceDate: today, completed: !done });
      return;
    }
    setItemStatus(ctx, item.id, item.status === "completed" ? "open" : "completed");
  };
  const handleDelete = (item) => {
    if (window.confirm(`Delete "${item.title}"?`)) deleteItem(ctx, item.id);
  };

  // The one place a row's Calendar indicator is decided — never shown at
  // all for an ineligible (recurring, or unsupported-type/chore) item.
  // Purely informational now (auto-commit/Calendar slice, Section 26): the
  // manual "Add to Google Calendar" action is removed — publishing is a
  // fully automatic post-commit side effect once a household enables it
  // (see src/data/googleCalendarAutoPublish.js), never a per-item click
  // here. A Calendar failure surfaces durably in the Review Inbox's
  // "Google Calendar issues" section (ReviewInboxPanel.jsx), not here.
  const renderCalendarControl = (item) => {
    if (!isItemEligibleForCalendarPublish(item)) return null;
    if (item.googleCalendarEventId) {
      return (
        <span className="text-xs font-bold text-green-600 flex-shrink-0 whitespace-nowrap">
          Google Calendar ✓
        </span>
      );
    }
    return null;
  };

  const renderItemRow = (item) => {
    const meta = ITEM_TYPE_META[item.type] || {};
    const isRecurring = !!item.schedule?.recurring;
    const isDone = isRecurring ? isOccurrenceCompleted(item.id, todayStr(), completions) : item.status === "completed";
    const dateLabel = item.dueDate || item.startDate;
    return (
      <div key={item.id} className="flex items-center gap-3 p-3 rounded-2xl bg-white border border-gray-200">
        <button
          onClick={() => allowComplete && handleComplete(item)}
          disabled={!allowComplete}
          aria-label={isDone ? "Mark not complete" : "Mark complete"}
          className={`w-7 h-7 flex-shrink-0 rounded-full border-2 flex items-center justify-center text-xs font-bold transition ${
            isDone ? "bg-green-500 border-green-500 text-white" : "border-gray-300 text-transparent hover:border-gray-400"
          } ${!allowComplete ? "cursor-default" : ""}`}
        >
          ✓
        </button>
        <div className="flex-1 min-w-0">
          <div className={`font-bold text-gray-900 text-sm truncate ${isDone ? "line-through opacity-50" : ""}`}>
            {isRecurring ? "🔁 " : ""}
            {meta.icon} {item.title}
          </div>
          <div className="text-xs text-gray-500 truncate">
            {(item.childIds || [])
              .map((cid) => childById(cid)?.name)
              .filter(Boolean)
              .join(", ")}
            {item.subject ? ` · ${item.subject}` : ""}
            {[item.academicTopic, item.academicUnit].filter(Boolean).length > 0
              ? ` · ${[item.academicTopic, item.academicUnit].filter(Boolean).join(" · ")}`
              : ""}
            {isRecurring ? "" : dateLabel ? ` · ${dateLabel}` : ""}
          </div>
        </div>
        {allowManage && renderCalendarControl(item)}
        {allowManage && (
          <>
            <button onClick={() => openEdit(item)} className="text-gray-400 hover:text-gray-700 text-xs font-bold px-2 flex-shrink-0">
              Edit
            </button>
            <button onClick={() => handleDelete(item)} aria-label="Delete" className="text-gray-400 hover:text-red-500 text-lg px-1 flex-shrink-0">
              ×
            </button>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setFilterChild("")}
          className={`px-3 py-1.5 rounded-full text-sm font-bold border transition ${
            !filterChild ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-300"
          }`}
        >
          All kids
        </button>
        {children.map((c) => (
          <button
            key={c.id}
            onClick={() => setFilterChild(c.id)}
            className={`px-3 py-1.5 rounded-full text-sm font-bold border transition ${
              filterChild === c.id ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-300"
            }`}
          >
            {c.emoji} {c.name}
          </button>
        ))}
      </div>

      {allowManage && <AddItemPanel ctx={ctx} children={children} />}

      {allowManage && editingItem && (
        <div className="rounded-3xl p-5 border border-gray-200 bg-gray-50">
          <ItemForm
            children={children}
            candidateParentItems={candidateParentItems}
            initialType={editingItem.type}
            existingItem={editingItem}
            onSubmit={handleEditSubmit}
            showRecurrence
            onCancel={() => setEditingItem(null)}
          />
        </div>
      )}

      <div>
        <h3 className="text-lg font-extrabold text-gray-900 mb-2">🔆 Today</h3>
        <div className="space-y-2">
          {buckets.today.length === 0 && choreGroups.length === 0 && <p className="text-sm text-gray-500">Nothing due today.</p>}
          {buckets.today.map(renderItemRow)}
          {choreGroups.map((g) => (
            <div key={g.child.id} className="space-y-2">
              {g.chores.map((chore) => (
                <div key={chore.id} className="flex items-center gap-3 p-3 rounded-2xl bg-white border border-gray-200">
                  <button
                    onClick={() => allowComplete && onToggleChore?.(g.child.id, chore)}
                    disabled={!allowComplete}
                    aria-label={chore.done ? "Mark chore not done" : "Mark chore done"}
                    className={`w-7 h-7 flex-shrink-0 rounded-full border-2 flex items-center justify-center text-xs font-bold transition ${
                      chore.done ? "bg-green-500 border-green-500 text-white" : "border-gray-300 text-transparent hover:border-gray-400"
                    } ${!allowComplete ? "cursor-default" : ""}`}
                  >
                    ✓
                  </button>
                  <div className={`flex-1 text-sm font-bold text-gray-900 ${chore.done ? "line-through opacity-50" : ""}`}>
                    🧹 {chore.text}
                    {!filterChild && <span className="text-gray-400 font-normal"> · {g.child.emoji} {g.child.name}</span>}
                  </div>
                  <span className="text-xs text-purple-700 font-bold flex-shrink-0">+{chore.points ?? 0}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {buckets.overdue.length > 0 && (
        <div>
          <h3 className="text-lg font-extrabold text-red-700 mb-2">⚠️ Needs Attention</h3>
          <div className="space-y-2">{buckets.overdue.map(renderItemRow)}</div>
        </div>
      )}

      <div>
        <h3 className="text-lg font-extrabold text-gray-900 mb-2">📆 Upcoming</h3>
        <div className="space-y-2">
          {buckets.upcoming.length === 0 && <p className="text-sm text-gray-500">Nothing else coming up.</p>}
          {buckets.upcoming.map(renderItemRow)}
        </div>
      </div>

    </div>
  );
};

export default ParentOrganizer;
