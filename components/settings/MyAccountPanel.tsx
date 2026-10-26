"use client";

import { useState } from "react";
import { apiUpdateMyProfile, apiChangeMyPassword, ApiError } from "@/lib/api";
import type { UserRole } from "@/types";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { useToast } from "@/components/ui/toast";
import {
  SectionCard,
  errorMessage,
  inputCls,
  labelCls,
  primaryBtnCls,
} from "@/components/settings/shared";

// Display only — what the user sees about themselves. Access is never decided
// from this, see CurrentUserProvider.
const ROLE_LABEL: Record<UserRole, string> = {
  ADMIN: "Admin",
  MARKETING: "Marketing",
  SUPERVISOR: "Supervisor",
  AGENT: "Agent",
  DIRECTOR: "Director",
};

function ReadOnlyField({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-[14px] text-gray-800 ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Display name
// ---------------------------------------------------------------------------

// Settings only renders once /users/me has answered, so `me` is already known
// when this mounts and the field can start from it directly.
function ProfileForm() {
  const { me } = useCurrentUser();
  const toast = useToast();
  const [name, setName] = useState(me?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!me) return null;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { setError("Name can't be empty."); return; }
    if (trimmed.length > 60) { setError("Name must be 60 characters or fewer."); return; }
    setSaving(true);
    setError(null);
    try {
      await apiUpdateMyProfile(trimmed);
      toast.success("Name updated");
      // CurrentUserProvider has no refresh — it fetches /users/me once per
      // load — so reload to put the new name in the sidebar and everywhere else.
      setTimeout(() => window.location.reload(), 600);
    } catch (err) {
      setError(errorMessage(err, "Failed to update your name"));
      setSaving(false);
    }
  }

  const unchanged = name.trim() === (me.name ?? "");

  return (
    <SectionCard title="Profile" description="Your name is what colleagues see on assignments and replies.">
      <form onSubmit={handleSave} className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <ReadOnlyField label="Username" value={me.username} mono />
          <ReadOnlyField label="Role" value={ROLE_LABEL[me.role] ?? me.role} />
        </div>
        <p className="text-[12px] text-gray-400 -mt-2">Your username and role are changed by an admin on the Users tab.</p>

        <div>
          <label className={labelCls}>Display name</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jane Smith" maxLength={60} className={inputCls} />
        </div>

        {error && <p className="text-[13px] text-red-500 font-medium">{error}</p>}

        <div className="flex justify-end">
          <button type="submit" disabled={saving || unchanged} className={primaryBtnCls}>
            {saving ? "Saving…" : "Save name"}
          </button>
        </div>
      </form>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Password
// ---------------------------------------------------------------------------

function PasswordForm() {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!current) { setError("Enter your current password."); return; }
    if (next.length < 8) { setError("New password must be at least 8 characters."); return; }
    if (next !== confirm) { setError("Passwords do not match."); return; }
    setSaving(true);
    setError(null);
    try {
      await apiChangeMyPassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      toast.success("Password changed — you were signed out on your other devices");
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "WRONG_PASSWORD"
          ? "Current password is incorrect."
          : errorMessage(err, "Failed to change password"),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard title="Password" description="At least 8 characters.">
      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className={labelCls}>Current password</label>
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} className={inputCls} autoComplete="current-password" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>New password</label>
            <input type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="Min 8 characters" className={inputCls} autoComplete="new-password" />
          </div>
          <div>
            <label className={labelCls}>Confirm new password</label>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Re-enter password" className={inputCls} autoComplete="new-password" />
          </div>
        </div>

        {error && <p className="text-[13px] text-red-500 font-medium">{error}</p>}

        <div className="flex justify-end">
          <button type="submit" disabled={saving} className={primaryBtnCls}>
            {saving ? "Changing…" : "Change password"}
          </button>
        </div>
      </form>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function MyAccountPanel() {
  return (
    <div className="px-6 py-6 max-w-2xl space-y-4">
      <ProfileForm />
      <PasswordForm />
    </div>
  );
}
