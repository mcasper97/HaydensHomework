import React, { useState } from "react";
import { FORM_TYPES, ITEM_TYPE_META, ACADEMIC_TYPES, SUBJECT_OPTIONS } from "../data/itemTypes.js";

// Which fields a given type shows *by default* — per Phase 1 decision, dates
// are never made mutually exclusive by type; this only controls which inputs
// are visible up front so the form isn't overwhelming (spec: "Do not show
// every possible field for every type"). A parent can still fill in both a
// start/occurrence date and a due date for project/study_task.
const showsField = (type, field) => {
  switch (field) {
    case "subject":
    case "academicTopic":
    case "academicUnit":
      return ACADEMIC_TYPES.includes(type);
    case "dueDate":
      return ["assignment", "project", "study_task"].includes(type);
    case "startDate":
      return ["test", "quiz", "project", "study_task", "school_event", "family_event", "reminder"].includes(type);
    case "endDate":
    case "allDay":
      return ["school_event", "family_event"].includes(type);
    case "parentItemId":
      return type === "study_task";
    // "Assessment-like" per the target domain model — tests/quizzes are
    // where a due-to-study signal is actually meaningful.
    case "preparationRequired":
      return type === "test" || type === "quiz";
    default:
      return true;
  }
};

/**
 * Type-aware create/edit form for the 8 canonical item types a parent can
 * create directly (chores stay on the existing recurring template UI — see
 * FORM_TYPES in itemTypes.js).
 *
 * onSubmit(payload, existingItem) is awaited — caller decides create vs.
 * update via itemsRepository.
 */
const ItemForm = ({
  children = [],
  candidateParentItems = [],
  initialType = "assignment",
  existingItem = null,
  onSubmit,
  onCancel,
}) => {
  const [type, setType] = useState(existingItem?.type || initialType);
  const [title, setTitle] = useState(existingItem?.title || "");
  const [childIds, setChildIds] = useState(existingItem?.childIds || (children[0] ? [children[0].id] : []));
  const [subject, setSubject] = useState(existingItem?.subject || SUBJECT_OPTIONS[0]);
  const [academicTopic, setAcademicTopic] = useState(existingItem?.academicTopic || "");
  const [academicUnit, setAcademicUnit] = useState(existingItem?.academicUnit || "");
  const [preparationRequired, setPreparationRequired] = useState(!!existingItem?.preparationRequired);
  const [startDate, setStartDate] = useState(existingItem?.startDate || "");
  const [startTime, setStartTime] = useState(existingItem?.startTime || "");
  const [dueDate, setDueDate] = useState(existingItem?.dueDate || "");
  const [dueTime, setDueTime] = useState(existingItem?.dueTime || "");
  const [endDate, setEndDate] = useState(existingItem?.endDate || "");
  const [allDay, setAllDay] = useState(existingItem?.allDay ?? true);
  const [notes, setNotes] = useState(existingItem?.notes || "");
  const [parentItemId, setParentItemId] = useState(existingItem?.parentItemId || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const toggleChild = (id) => {
    setChildIds((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim() || childIds.length === 0 || saving) return;
    setSaving(true);
    setError("");

    const payload = {
      type,
      title: title.trim(),
      childIds,
      subject: showsField(type, "subject") ? subject : null,
      academicTopic: showsField(type, "academicTopic") && academicTopic.trim() ? academicTopic.trim() : null,
      academicUnit: showsField(type, "academicUnit") && academicUnit.trim() ? academicUnit.trim() : null,
      preparationRequired: showsField(type, "preparationRequired") ? preparationRequired : null,
      startDate: showsField(type, "startDate") && startDate ? startDate : null,
      startTime: showsField(type, "startDate") && startDate && startTime ? startTime : null,
      dueDate: showsField(type, "dueDate") && dueDate ? dueDate : null,
      dueTime: showsField(type, "dueDate") && dueDate && dueTime ? dueTime : null,
      endDate: showsField(type, "endDate") && endDate ? endDate : null,
      allDay: showsField(type, "allDay") ? allDay : true,
      notes: notes.trim(),
      parentItemId: showsField(type, "parentItemId") && parentItemId ? parentItemId : null,
    };

    try {
      await onSubmit(payload, existingItem);
    } catch (err) {
      setError(err?.message || "Couldn't save — please try again.");
      setSaving(false);
      return;
    }
    setSaving(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="text-xs font-bold text-gray-500 uppercase">Type</label>
        <div className="flex flex-wrap gap-2 mt-1">
          {FORM_TYPES.map((t) => (
            <button
              type="button"
              key={t}
              onClick={() => setType(t)}
              className={`px-3 py-1.5 rounded-full text-sm font-bold border transition ${
                type === t ? "bg-purple-700 text-white border-purple-700" : "bg-white text-gray-600 border-gray-300"
              }`}
            >
              {ITEM_TYPE_META[t].icon} {ITEM_TYPE_META[t].label}
            </button>
          ))}
        </div>
      </div>

      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        required
        autoFocus
        className="w-full px-4 py-2 border border-gray-200 rounded-2xl"
      />

      {children.length > 0 && (
        <div>
          <label className="text-xs font-bold text-gray-500 uppercase">For</label>
          <div className="flex flex-wrap gap-2 mt-1">
            {children.map((c) => (
              <button
                type="button"
                key={c.id}
                onClick={() => toggleChild(c.id)}
                className={`px-3 py-1.5 rounded-full text-sm font-bold border transition ${
                  childIds.includes(c.id) ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-600 border-gray-300"
                }`}
              >
                {c.emoji} {c.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {showsField(type, "subject") && (
        <select value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full px-4 py-2 border border-gray-200 rounded-2xl">
          {SUBJECT_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      )}

      {(showsField(type, "academicTopic") || showsField(type, "academicUnit")) && (
        <div className="flex gap-2">
          {showsField(type, "academicTopic") && (
            <input
              type="text"
              value={academicTopic}
              onChange={(e) => setAcademicTopic(e.target.value)}
              placeholder="Topic (optional)"
              className="flex-1 px-4 py-2 border border-gray-200 rounded-2xl"
            />
          )}
          {showsField(type, "academicUnit") && (
            <input
              type="text"
              value={academicUnit}
              onChange={(e) => setAcademicUnit(e.target.value)}
              placeholder="Unit (optional)"
              className="flex-1 px-4 py-2 border border-gray-200 rounded-2xl"
            />
          )}
        </div>
      )}

      {showsField(type, "startDate") && (
        <div>
          <label className="text-xs font-bold text-gray-500 uppercase">
            {type === "test" || type === "quiz" ? "Date" : type === "project" || type === "study_task" ? "Scheduled / start date" : "Start"}
          </label>
          <div className="flex gap-2 mt-1">
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="flex-1 px-4 py-2 border border-gray-200 rounded-2xl" />
            {!allDay && (
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="w-32 px-4 py-2 border border-gray-200 rounded-2xl" />
            )}
          </div>
        </div>
      )}

      {showsField(type, "preparationRequired") && (
        <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
          <input type="checkbox" checked={preparationRequired} onChange={(e) => setPreparationRequired(e.target.checked)} />
          Studying/preparation required
        </label>
      )}

      {showsField(type, "endDate") && (
        <div>
          <label className="text-xs font-bold text-gray-500 uppercase">End</label>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full px-4 py-2 border border-gray-200 rounded-2xl mt-1" />
        </div>
      )}

      {showsField(type, "allDay") && (
        <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
          All day
        </label>
      )}

      {showsField(type, "dueDate") && (
        <div>
          <label className="text-xs font-bold text-gray-500 uppercase">Due date</label>
          <div className="flex gap-2 mt-1">
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="flex-1 px-4 py-2 border border-gray-200 rounded-2xl" />
            <input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} className="w-32 px-4 py-2 border border-gray-200 rounded-2xl" />
          </div>
        </div>
      )}

      {showsField(type, "parentItemId") && candidateParentItems.length > 0 && (
        <div>
          <label className="text-xs font-bold text-gray-500 uppercase">Supports (optional)</label>
          <select
            value={parentItemId}
            onChange={(e) => setParentItemId(e.target.value)}
            className="w-full px-4 py-2 border border-gray-200 rounded-2xl mt-1"
          >
            <option value="">No linked item</option>
            {candidateParentItems.map((it) => (
              <option key={it.id} value={it.id}>
                {ITEM_TYPE_META[it.type]?.label}: {it.title}
              </option>
            ))}
          </select>
        </div>
      )}

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes (optional)"
        rows={2}
        className="w-full px-4 py-2 border border-gray-200 rounded-2xl"
      />

      {error && <p className="text-red-600 text-sm font-semibold">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!title.trim() || childIds.length === 0 || saving}
          className="flex-1 bg-purple-700 hover:bg-purple-800 disabled:opacity-50 text-white font-extrabold py-2 rounded-2xl"
        >
          {saving ? "Saving..." : existingItem ? "Save changes" : "Add"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="px-4 py-2 rounded-2xl font-extrabold text-gray-500 border border-gray-300">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
};

export default ItemForm;
