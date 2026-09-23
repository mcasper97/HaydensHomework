import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../Firebase.js";

/**
 * Chore TEMPLATE (definition) read/write only — never choreCompletions or
 * chorePoints, which stay exactly where they already live (FamilyBoard.jsx's
 * own toggleChoreDone, execution-time only, untouched by this module).
 *
 * Extracted out of FamilyBoard.jsx (previously the only place that read or
 * wrote users/{uid}.choreTemplates) so "Manage Chores" can also be opened
 * directly from Parent Home (src/ChoreManagementPanel.jsx) without
 * duplicating this persistence logic. FamilyBoard.jsx's own Manage Chores
 * UI now calls these same functions instead of its own inline copy — same
 * persisted shape, same guest/real-account branching, no behavior change.
 *
 * Guest/local-demo mode (ctx.isAdmin) uses the same "crestly_admin_chores"
 * localStorage key FamilyBoard.jsx has always used — { templates,
 * completions, points } — and only ever touches the `templates` field here,
 * preserving whatever completions/points already exist under that key.
 */
const GUEST_CHORES_KEY = "crestly_admin_chores";

function readGuestChores() {
  const raw = localStorage.getItem(GUEST_CHORES_KEY);
  return raw ? JSON.parse(raw) : { templates: {}, completions: {}, points: {} };
}

function writeGuestChoreTemplates(templates) {
  const full = readGuestChores();
  localStorage.setItem(GUEST_CHORES_KEY, JSON.stringify({ ...full, templates }));
}

const uid4 = () => Math.random().toString(36).slice(2, 8);

export async function getChoreTemplates(ctx) {
  if (ctx.isAdmin) {
    return readGuestChores().templates || {};
  }
  if (!db || !ctx.uid) return {};
  const snap = await getDoc(doc(db, "users", ctx.uid));
  return snap.exists() ? (snap.data().choreTemplates || {}) : {};
}

async function saveChoreTemplates(ctx, templates) {
  if (ctx.isAdmin) {
    writeGuestChoreTemplates(templates);
    return;
  }
  const ref = doc(db, "users", ctx.uid);
  await setDoc(ref, { choreTemplates: templates }, { merge: true });
}

export async function addChoreTemplate(ctx, currentTemplates, childId, text, points) {
  const templates = { ...(currentTemplates || {}) };
  templates[childId] = [...(templates[childId] || []), { id: uid4(), text, points }];
  await saveChoreTemplates(ctx, templates);
  return templates;
}

export async function removeChoreTemplate(ctx, currentTemplates, childId, choreId) {
  const templates = { ...(currentTemplates || {}) };
  templates[childId] = (templates[childId] || []).filter((c) => c.id !== choreId);
  await saveChoreTemplates(ctx, templates);
  return templates;
}
