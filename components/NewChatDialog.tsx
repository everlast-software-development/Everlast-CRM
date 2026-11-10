"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiCreateConversation, apiCreateCustomer, apiGetCustomers } from "@/lib/api";
import { DialogButtons, DialogShell } from "@/components/DialogShell";
import { errorMessage, inputCls, labelCls } from "@/components/settings/shared";

// The inbox's "+" (like WhatsApp Web's new chat): a phone number and a name →
// the contact (added, or found if they're already saved) and their chat on the
// line in use, opened. A new contact has never written, so their 24-hour
// window is closed: the chat offers an approved template to start with.

const digits = (s: string) => s.replace(/\D/g, "");

export function NewChatDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [phone, setPhone] = useState("+971 ");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = digits(phone).length >= 8;

  async function findByPhone(raw: string) {
    // The server keeps numbers as international digits; match on the ending, which
    // survives a local 05… number too.
    const tail = digits(raw).slice(-9);
    const res = await apiGetCustomers(1, 10, tail);
    return res.data.find((c) => digits(c.phone).endsWith(tail)) ?? null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || saving) return;
    setSaving(true);
    setError(null);
    try {
      let customerId: number;
      try {
        const created = await apiCreateCustomer({ phone: phone.trim(), ...(name.trim() ? { name: name.trim() } : {}) });
        customerId = Number(created.data.id);
      } catch (err) {
        // Already saved: open their chat instead.
        if (!(err instanceof ApiError) || err.status !== 409) throw err;
        const existing = await findByPhone(phone);
        if (!existing) throw err;
        customerId = Number(existing.id);
      }
      const conv = await apiCreateConversation(customerId);
      onClose();
      router.push(`/chats/${conv.data.id}`);
    } catch (err) {
      setError(errorMessage(err, "Couldn't start the chat."));
      setSaving(false);
    }
  }

  return (
    <DialogShell title="New chat" intro="Add a contact and open their chat on this line." onCancel={onClose} saving={saving}>
      <form onSubmit={submit} className="px-6 pb-6 space-y-4">
        <div>
          <label htmlFor="nc-phone" className={labelCls}>Phone number</label>
          <input id="nc-phone" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" dir="ltr" autoFocus placeholder="+971 50 123 4567" className={inputCls} />
          <p className="text-[11.5px] text-gray-400 mt-1">With the country code. If they&apos;re already a contact, their chat opens.</p>
        </div>
        <div>
          <label htmlFor="nc-name" className={labelCls}>Name <span className="font-normal text-gray-400">(optional)</span></label>
          <input id="nc-name" value={name} onChange={(e) => setName(e.target.value)} dir="auto" placeholder="Sara Ahmed" className={inputCls} />
        </div>
        <p className="text-[12px] text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
          WhatsApp lets you write first only with an approved template. Once they reply, you can chat freely for 24 hours.
        </p>
        {error && <p role="alert" className="text-[13px] text-red-500 font-medium">{error}</p>}
        <DialogButtons saving={saving} onCancel={onClose} label="Start chat" disabled={!ready} />
      </form>
    </DialogShell>
  );
}
