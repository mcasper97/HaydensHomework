import React, { useEffect, useMemo, useState } from "react";
import { subscribeItems, createItem, updateItem, deleteItem, setItemStatus } from "../data/itemsRepository.js";
import { bucketItems, choresDueToday } from "./itemBuckets.js";
import { ITEM_TYPE_META, FORM_TYPES, ACADEMIC_TYPES } from "../data/itemTypes.js";
import ItemForm from "./ItemForm.jsx";

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
  const [filterChild, setFilterChild] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [formType, setFormType] = useState("assignment");

  useEffect(() => {
    const unsub = subscribeItems(ctx, {}, setItems);
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

  const openCreate = (type) => {
    setEditingItem(null);
    setFormType(type);
    setShowForm(true);
  };

  const openEdit = (item) => {
    setEditingItem(item);
    setFormType(item.type);
    setShowForm(true);
  };

  const handleFormSubmit = async (payload, existing) => {
    if (existing) await updateItem(ctx, existing.id, payload);
    else await createItem(ctx, payload);
    setShowForm(false);
    setEditingItem(null);
  };

  const handleComplete = (item) => setItemStatus(ctx, item.id, item.status === "completed" ? "open" : "completed");
  const handleDelete = (item) => {
    if (window.confirm(`Delete "${item.title}"?`)) deleteItem(ctx, item.id);
  };

  const renderItemRow = (item) => {
    const meta = ITEM_TYPE_META[item.type] || {};
    const isDone = item.status === "completed";
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
            {dateLabel ? ` · ${dateLabel}` : ""}
          </div>
        </div>
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

      {allowManage && (
        <div className="flex flex-wrap gap-2">
          {FORM_TYPES.map((t) => (
            <button
              key={t}
              onClick={() => openCreate(t)}
              className="text-xs font-bold px-3 py-1.5 rounded-full bg-purple-50 hover:bg-purple-100 text-purple-800 border border-purple-200 transition"
            >
              + {ITEM_TYPE_META[t].label}
            </button>
          ))}
        </div>
      )}

      {allowManage && showForm && (
        <div className="rounded-3xl p-5 border border-gray-200 bg-gray-50">
          <ItemForm
            children={children}
            candidateParentItems={candidateParentItems}
            initialType={formType}
            existingItem={editingItem}
            onSubmit={handleFormSubmit}
            onCancel={() => {
              setShowForm(false);
              setEditingItem(null);
            }}
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
