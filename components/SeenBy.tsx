"use client";

import { useEffect, useState } from "react";
import { apiGetSeenBy } from "@/lib/api";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import type { ChatSeenBy } from "@/types";

const ROLE_WORD: Record<string, string> = {
  ADMIN: "Admin", SUPERVISOR: "Supervisor", AGENT: "Agent", MARKETING: "Marketing", DIRECTOR: "Director",
};

function ago(iso: string, now: number): string {
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/**
 * Who opened this chat while it belonged to someone else — supervisors and
 * admins only (team:supervise); renders nothing for anyone else. The list:
 * name, role, how many separate visits, when last. Recorded by the server when
 * the chat is opened (utils/chatPresence.js); the owner's own visits and
 * visits to unassigned chats aren't recorded.
 */
export function SeenBy({ conversationId, render }: {
  conversationId: number | string;
  /** Wraps the list in the caller's own section chrome. */
  render: (list: React.ReactNode, count: number) => React.ReactNode;
}) {
  const { can } = useCurrentUser();
  const allowed = can("team:supervise");
  const [rows, setRows] = useState<{ chat: string; list: ChatSeenBy[] } | null>(null);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    apiGetSeenBy(conversationId)
      .then((res) => { if (!cancelled) setRows({ chat: String(conversationId), list: res.data }); })
      .catch(() => { if (!cancelled) setRows({ chat: String(conversationId), list: [] }); });
    return () => { cancelled = true; };
  }, [allowed, conversationId]);

  if (!allowed) return null;
  const list = rows && rows.chat === String(conversationId) ? rows.list : null;

  const body = list === null ? (
    <p className="text-[12px] text-gray-400">Loading…</p>
  ) : list.length === 0 ? (
    <p className="text-[12px] text-gray-400">Nobody but its owner has opened this chat.</p>
  ) : (
    <ul className="space-y-2">
      {list.map((v) => {
        const name = v.user.name || v.user.username;
        return (
          <li key={v.user.id} className="flex items-center gap-2.5">
            <span className="w-7 h-7 rounded-full bg-sky-100 text-sky-700 text-[10px] font-bold flex items-center justify-center shrink-0">
              {name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-[12.5px] text-gray-800 truncate">
                {name} <span className="text-gray-400">· {ROLE_WORD[v.user.role] ?? v.user.role}</span>
              </span>
              <span className="block text-[11px] text-gray-400" title={new Date(v.lastSeenAt).toLocaleString()}>
                {v.visits === 1 ? "Opened once" : `Opened ${v.visits} times`} · last {ago(v.lastSeenAt, now)}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
  return <>{render(body, list?.length ?? 0)}</>;
}
