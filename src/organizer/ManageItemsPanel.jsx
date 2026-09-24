import React, { useEffect, useMemo, useState } from "react";
import { subscribeItems, updateItem, deleteItem } from "../data/itemsRepository.js";
import { ITEM_TYPE_META, ACADEMIC_TYPES } from "../data/itemTypes.js";
import ItemForm from "./ItemForm.jsx";

/**
 * Manage Items — Parent Board's committed-Item management surface (edit +
 * delete only, no completion toggle — that stays Family Board's job).
 *
 * This restores capability that quietly disappeared when Family Board was
 * redesigned into the execution-only unified agenda: ParentOrganizer.jsx,
 * which used to own the row-scoped Edit/Delete controls, stopped being
 * rendered anywhere. Rather than reviving ParentOrganizer.jsx wholesale
 * (which would also reintroduce its Today/Upcoming layout, its own inline
 * AddItemPanel mount, and its Calendar-status indicator — all things this
 * slice deliberately does NOT want back), this component extracts just the
 * edit/delete logic ParentOrganizer.jsx already had, verbatim:
 *   - openEdit/handleEditSubmit: identical to ParentOrganizer's own
 *     (updateItem(ctx, existing.id, payload) — a patch merge, never a new
 *     document, so the Item's id/sourceRecordId/sourceCandidateId/
 *     commitMode are all preserved automatically, since ItemForm's payload
 *     never includes those fields at all).
 *   - handleDelete: identical to ParentOrganizer's own
 *     (window.confirm + deleteItem(ctx, item.id) — itemsRepository.js's
 *     existing deleteItem only ever removes the Item document itself; it
 *     does not cascade to SourceRecords, IngestionCandidates, or a
 *     Google Calendar event that Item may have been published to. Google
 *     Calendar delete/unpublish remains out of scope for this slice — an
 *     already-published event is left in place, unchanged, exactly as
 *     before this component existed).
 *
 * Deliberately does NOT render a Calendar status indicator (Section 6 of
 * the task spec) — a publish success stays silent, a failure still
 * surfaces via Review Inbox's existing "Google Calendar issues" section,
 * unaffected by this file.
 */
const ManageItemsPanel = ({ ctx, children = [] }) => {
  const [items, setItems] = useState([]);
  const [editingItem, setEditingItem] = useState(null);

  useEffect(() => {
    const unsub = subscribeItems(ctx, {}, setItems);
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.uid, ctx.isAdmin]);

  const candidateParentItems = useMemo(
    () => items.filter((it) => ACADEMIC_TYPES.includes(it.type) && it.type !== "study_task"),
    [items]
  );

  const childById = (id) => children.find((c) => c.id === id);

  const openEdit = (item) => setEditingItem(item);

  const handleEditSubmit = async (payload, existing) => {
    await updateItem(ctx, existing.id, payload);
    setEditingItem(null);
  };

  const handleDelete = (item) => {
    if (window.confirm(`Delete "${item.title}"?`)) deleteItem(ctx, item.id);
  };

  return (
    <div className="space-y-3">
      {editingItem && (
        <div className="rounded-3xl p-5 border border-gray-700" style={{ background: "#1C1C1E" }}>
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

      {items.length === 0 && <p className="text-gray-400 text-sm">No items yet.</p>}

      <div className="space-y-2">
        {items.map((item) => {
          const meta = ITEM_TYPE_META[item.type] || {};
          return (
            <div
              key={item.id}
              data-testid="manage-items-row"
              className="flex items-center gap-3 p-3 rounded-2xl"
              style={{ background: "#1C1C1E" }}
            >
              <div className="flex-1 min-w-0">
                <div className="font-bold text-white text-sm truncate">
                  {meta.icon} {item.title || "(untitled)"}
                </div>
                <div className="text-xs text-gray-400 truncate">
                  {(item.childIds || [])
                    .map((cid) => childById(cid)?.name)
                    .filter(Boolean)
                    .join(", ") || "Family"}
                  {item.dueDate || item.startDate ? ` · ${item.dueDate || item.startDate}` : ""}
                </div>
              </div>
              <button
                onClick={() => openEdit(item)}
                className="text-gray-400 hover:text-white text-xs font-bold px-2 flex-shrink-0"
              >
                Edit
              </button>
              <button
                onClick={() => handleDelete(item)}
                aria-label="Delete"
                className="text-gray-400 hover:text-red-500 text-lg px-1 flex-shrink-0"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ManageItemsPanel;
