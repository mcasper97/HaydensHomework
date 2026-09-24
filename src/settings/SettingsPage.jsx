import React from "react";
import HouseholdSettingsSection from "./HouseholdSettingsSection.jsx";
import ChildManagementSection from "./ChildManagementSection.jsx";
import GmailConnectionPanel from "../GmailConnectionPanel.jsx";
import EmailImportSettingsSection from "./EmailImportSettingsSection.jsx";
import GoogleCalendarConnectionPanel from "../GoogleCalendarConnectionPanel.jsx";
import GoogleCalendarRoutingPanel from "../GoogleCalendarRoutingPanel.jsx";
import DeviceModeSettings from "../DeviceModeSettings.jsx";

/* ─────────────────────── Settings Page ───────────────────────
 * Permanent authenticated Settings page (UI/IA refactor). Temporarily the
 * home for all household/integration configuration while first-run
 * onboarding remains deferred — see the task's explicit "no setup
 * enforcement yet" requirement. Composes existing, already-self-contained
 * panels (Gmail/Calendar connection+routing, Device Mode) moved verbatim
 * out of AuthShell.jsx, plus small extracted Household/Child sections —
 * no configuration logic is duplicated here, only relocated and composed.
 *
 * Reachable as its own destination from Board Selector (navigation
 * refactor — see BoardSelector.jsx), itself only reachable once a real,
 * authenticated (or guest) parent session exists — never from the
 * unauthenticated landing page, Child Home, Family Board, or a
 * locked/shared Display surface.
 */
const SettingsPage = ({
  user,
  onBack,
  onSignOut,
  children,
  familyLastName,
  editingName,
  setEditingName,
  lastNameInput,
  setLastNameInput,
  savingName,
  saveFamilyName,
  timezone,
  editingTimezone,
  setEditingTimezone,
  timezoneInput,
  setTimezoneInput,
  timezoneError,
  setTimezoneError,
  savingTimezone,
  saveTimezone,
  showAdd,
  setShowAdd,
  newName,
  setNewName,
  newEmoji,
  setNewEmoji,
  saving,
  saveError,
  setSaveError,
  addChild,
  renameChild,
  googleCalendarRouting,
  onRoutingSaved,
  googleCalendarAutoPublishEnabled,
  onAutoPublishSaved,
  deviceMode,
  onSetDeviceMode,
  onLockChild,
}) => {
  const ctx = { uid: user?.uid, isAdmin: !!user?.isAdmin };

  return (
    <div className="min-h-screen p-4" style={{ background: "#1C1C1E" }}>
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={onBack}
            className="text-gray-400 hover:text-white font-semibold text-sm"
          >
            ← All Boards
          </button>
        </div>

        <h1 className="text-3xl font-display text-white mb-6">Settings</h1>

        <HouseholdSettingsSection
          familyLastName={familyLastName}
          editingName={editingName}
          setEditingName={setEditingName}
          lastNameInput={lastNameInput}
          setLastNameInput={setLastNameInput}
          savingName={savingName}
          saveFamilyName={saveFamilyName}
          timezone={timezone}
          editingTimezone={editingTimezone}
          setEditingTimezone={setEditingTimezone}
          timezoneInput={timezoneInput}
          setTimezoneInput={setTimezoneInput}
          timezoneError={timezoneError}
          setTimezoneError={setTimezoneError}
          savingTimezone={savingTimezone}
          saveTimezone={saveTimezone}
        />

        <ChildManagementSection
          children={children}
          showAdd={showAdd}
          setShowAdd={setShowAdd}
          newName={newName}
          setNewName={setNewName}
          newEmoji={newEmoji}
          setNewEmoji={setNewEmoji}
          saving={saving}
          saveError={saveError}
          setSaveError={setSaveError}
          addChild={addChild}
          renameChild={renameChild}
        />

        {/* Gmail/Calendar integrations require a real Firebase-authenticated
            parent — guest/local mode has no account to attach a connection
            to (see GUEST_USER in AuthShell.jsx and every existing
            Gmail/Calendar panel's own doc comment); unchanged gating. */}
        {!user?.isAdmin && (
          <>
            <GmailConnectionPanel ctx={ctx} childProfiles={children} />
            <EmailImportSettingsSection ctx={ctx} childProfiles={children} timezone={timezone} />
            <GoogleCalendarConnectionPanel />
            <GoogleCalendarRoutingPanel
              uid={user.uid}
              familyChildren={children}
              googleCalendarRouting={googleCalendarRouting}
              onRoutingSaved={onRoutingSaved}
              googleCalendarAutoPublishEnabled={googleCalendarAutoPublishEnabled}
              onAutoPublishSaved={onAutoPublishSaved}
            />
          </>
        )}

        <div className="rounded-3xl p-5 mb-6 border border-gray-700" style={{ background: "#2a2a2c" }}>
          <h3 className="text-white font-display text-lg mb-4">Account</h3>
          <p className="text-gray-400 text-sm mb-3">{user?.email}</p>
          <button
            onClick={onSignOut}
            className="px-4 py-2 rounded-xl font-semibold text-white text-sm transition hover:opacity-90 border border-gray-600"
            style={{ background: "#1C1C1E" }}
          >
            Sign out
          </button>

          <DeviceModeSettings
            children={children}
            deviceMode={deviceMode}
            onSetDeviceMode={onSetDeviceMode}
            onLockChild={onLockChild}
          />
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
