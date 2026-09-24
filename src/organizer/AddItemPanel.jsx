import React, { useEffect, useMemo, useState } from "react";
import { subscribeItems, createItem } from "../data/itemsRepository.js";
import { createSourceRecord } from "../data/sourceRecordsRepository.js";
import { ITEM_TYPE_META, FORM_TYPES, ACADEMIC_TYPES } from "../data/itemTypes.js";
import { autoPublishItemIfEligible } from "../data/googleCalendarAutoPublish.js";
import ItemForm from "./ItemForm.jsx";

/**
 * Add Item — the "+ type" quick-create row and its ItemForm-for-a-new-item
 * submit logic (createSourceRecord + createItem), extracted out of
 * ParentOrganizer.jsx (SHIP BLOCKER correction) so it can also be opened
 * directly from Parent Board (src/ParentBoard.jsx) without navigating into
 * Family Board, and without a duplicated copy of the create logic.
 * ParentOrganizer.jsx now renders this same component for its own "+ type"
 * affordance instead of its former inline copy — Family Board's Add Item
 * behavior is unchanged, just reached through this one shared component.
 * Editing an existing item is a separate, disjoint concern that stays in
 * ParentOrganizer.jsx (its own row-scoped Edit control), unaffected by
 * this extraction.
 *
 * Independently subscribes to items (same established precedent already
 * used by several sibling components — App.jsx, OrganizerCalendar.jsx,
 * ChildTodayView.jsx, and ParentOrganizer.jsx itself all call
 * subscribeItems independently) purely to compute candidateParentItems
 * for ItemForm's optional "Supports" (parentItemId) linking — not a
 * duplicated business-logic copy, just the same lightweight read pattern.
 */
const AddItemPanel = ({ ctx, children = [] }) => {
  const [items, setItems] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [formType, setFormType] = useState("assignment");
  const [savedMessage, setSavedMessage] = useState(false);

  useEffect(() => {
    const unsub = subscribeItems(ctx, {}, setItems);
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.uid, ctx.isAdmin]);

  const candidateParentItems = useMemo(
    () => items.filter((it) => ACADEMIC_TYPES.includes(it.type) && it.type !== "study_task"),
    [items]
  );

  const openCreate = (type) => {
    setFormType(type);
    setShowForm(true);
    setSavedMessage(false);
  };

  const handleFormSubmit = async (payload, existing) => {
    if (existing) {
      // AddItemPanel only ever mounts ItemForm with existingItem=null (see
      // below) — this branch can't be reached from here, kept only so this
      // function's shape exactly matches the create logic it was extracted
      // from, in case a future caller ever passes an existing item in.
      return;
    }
    let sourceRecordId = null;
    try {
      const record = await createSourceRecord(ctx, {
        sourceType: "manual",
        title: payload.title,
        createdByUid: ctx.uid,
      });
      sourceRecordId = record?.id ?? null;
    } catch (err) {
      // Provenance is best-effort — the item must still be created even
      // if the SourceRecord write fails for any reason.
      console.error("AddItemPanel: createSourceRecord failed", err);
    }
    const item = await createItem(ctx, sourceRecordId ? { ...payload, sourceRecordId } : payload);
    // Fire-and-forget, same as every other commit path — a manually-created
    // Item is explicitly parent-authored, so it needs no AI-confidence
    // review, but still goes through the identical post-commit Calendar
    // workflow (Section 25) once eligible/enabled; never blocks "Added!".
    autoPublishItemIfEligible(ctx, item);
    setShowForm(false);
    setSavedMessage(true);
  };

  return (
    <div className="space-y-3">
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

      {showForm && (
        <div className="rounded-3xl p-5 border border-gray-200 bg-gray-50">
          <ItemForm
            children={children}
            candidateParentItems={candidateParentItems}
            initialType={formType}
            existingItem={null}
            onSubmit={handleFormSubmit}
            showRecurrence
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      {savedMessage && <p className="text-green-400 text-sm font-semibold">Added!</p>}
    </div>
  );
};

export default AddItemPanel;
