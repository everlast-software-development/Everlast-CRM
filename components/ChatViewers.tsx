"use client";

import { useEffect, useState } from "react";
import { getSocket } from "@/lib/socket";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ChatViewer } from "@/types";

const nameOf = (v: ChatViewer) => v.name || v.username;
const initials = (v: ChatViewer) =>
  nameOf(v).split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

/**
 * Colleagues who have this chat open right now, as small avatars in the chat
 * header — so two people don't answer the same patient at once.
 *
 * Opening the chat tells the server (socket "conversation.view"); closing it,
 * or switching chats, says so ("conversation.leave"); the server answers
 * everyone in the chat with the current list ("conversation.viewers"), which
 * also drops people whose browser went away. `typing` (usernames, from the
 * existing typing events) marks who is writing a reply.
 */
export function ChatViewers({ conversationId, typing = [] }: { conversationId: string; typing?: string[] }) {
  const { me } = useCurrentUser();
  const [viewers, setViewers] = useState<{ chat: string; list: ChatViewer[] }>({ chat: conversationId, list: [] });

  useEffect(() => {
    const socket = getSocket();
    const id = Number(conversationId);
    // Only while this tab is actually on screen: a chat left open in a background
    // tab, a minimised window or a locked computer isn't someone viewing it.
    const view = () => { if (document.visibilityState === "visible") socket.emit("conversation.view", { conversationId: id }); };
    const leave = () => socket.emit("conversation.leave", { conversationId: id });
    const onVisibility = () => (document.visibilityState === "visible" ? view() : leave());
    const onViewers = (p: { conversationId?: number | string; viewers?: ChatViewer[] }) => {
      if (String(p?.conversationId) === conversationId) setViewers({ chat: conversationId, list: p.viewers ?? [] });
    };
    socket.on("conversation.viewers", onViewers);
    // After a reconnect the server has forgotten us: say again what we're showing.
    socket.on("connect", view);
    document.addEventListener("visibilitychange", onVisibility);
    view();
    return () => {
      socket.off("conversation.viewers", onViewers);
      socket.off("connect", view);
      document.removeEventListener("visibilitychange", onVisibility);
      leave();
    };
  }, [conversationId]);

  // Only this chat's list (a late answer for the previous chat is ignored), without me.
  const others = viewers.chat === conversationId ? viewers.list.filter((v) => v.id !== me?.id) : [];
  if (!others.length) return null;

  const isTyping = (v: ChatViewer) => typing.includes(v.username);
  const typers = others.filter(isTyping);
  const lead = typers[0] ?? others[0];
  const rest = (typers.length ? typers.length : others.length) - 1;
  const sentence = `${nameOf(lead)}${rest > 0 ? ` +${rest}` : ""} ${typers.length ? (typers.length > 1 ? "are typing…" : "is typing…") : others.length > 1 ? "are viewing" : "is viewing"}`;
  const shown = others.slice(0, 3);

  return (
    <div className="hidden sm:flex items-center gap-2 shrink-0" aria-live="polite">
      <div className="flex -space-x-2">
        {shown.map((v) => (
          <Tooltip key={v.id}>
            <TooltipTrigger asChild>
              <span
                className={`relative w-7 h-7 rounded-full ring-2 ring-white flex items-center justify-center text-[10px] font-bold ${
                  isTyping(v) ? "bg-amber-100 text-amber-700" : "bg-sky-100 text-sky-700"
                }`}
              >
                {initials(v)}
                {isTyping(v) && <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-amber-500 ring-2 ring-white animate-pulse" />}
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-[12px]">
              {nameOf(v)} {isTyping(v) ? "is typing a reply" : "has this chat open"}
            </TooltipContent>
          </Tooltip>
        ))}
        {others.length > shown.length && (
          <span className="w-7 h-7 rounded-full ring-2 ring-white bg-gray-100 text-gray-500 text-[10px] font-bold flex items-center justify-center">
            +{others.length - shown.length}
          </span>
        )}
      </div>
      <span className={`hidden xl:inline text-[11.5px] whitespace-nowrap ${typers.length ? "text-amber-600 font-medium" : "text-gray-400"}`}>
        {sentence}
      </span>
    </div>
  );
}
