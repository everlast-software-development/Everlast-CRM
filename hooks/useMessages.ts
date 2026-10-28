"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { apiGetMessages, apiMarkRead } from "@/lib/api";
import { getSocket } from "@/lib/socket";
import type { Message } from "@/types";

const PAGE_SIZE = 50;

interface UseMessagesReturn {
  messages: Message[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
  error: string | null;
  appendOptimistic: (msg: Message) => void;
  confirmOptimistic: (tempId: string, confirmed: Message) => void;
  discardOptimistic: (tempId: string) => void;
  typingUsers: string[];
}

function getLocalId(m: Message): string {
  return m._id != null ? String(m._id) : m.id != null ? String(m.id) : "";
}

function isTemp(m: Message): boolean {
  return getLocalId(m).startsWith("temp-");
}

// Every id a message can be known by here: the server's `id`, and the `_id`
// a confirmed optimistic bubble carries. Two entries sharing one are the same
// message. (Checking `id` alone let a bubble confirmed by the send response,
// which only has `_id`, be shown a second time when the live event arrived.)
function idsOf(m: Message): string[] {
  return [m._id, m.id].filter((v) => v != null && v !== "").map(String).filter((v) => !v.startsWith("temp-"));
}
const sameMessage = (a: Message, b: Message) => idsOf(a).some((id) => idsOf(b).includes(id));

// Delivery only moves forward: a late "sent" must not undo "read".
const STATUS_RANK: Record<string, number> = { PENDING: 0, SENT: 1, DELIVERED: 2, READ: 3 };
function furthestStatus(a: Message["status"], b: Message["status"]): Message["status"] {
  if (a === "FAILED" || b === "FAILED") return "FAILED";
  if (a == null) return b;
  if (b == null) return a;
  return (STATUS_RANK[String(b)] ?? -1) > (STATUS_RANK[String(a)] ?? -1) ? b : a;
}

// The server's copy wins (its time, not the agent's computer clock), keeping
// the bubble's local key so React doesn't remount it, and the furthest status.
function mergeServer(local: Message, server: Message): Message {
  return { ...local, ...server, _id: local._id ?? server._id, status: furthestStatus(local.status, server.status) };
}

export function emitTypingStart(conversationId: number | string, username: string): void {
  getSocket().emit("typing.start", { conversationId, username });
}

export function emitTypingStop(conversationId: number | string, username: string): void {
  getSocket().emit("typing.stop", { conversationId, username });
}

export function useMessages(conversationId: string): UseMessagesReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);

  // Refs avoid stale-closure issues in the loadMore guard
  const pageRef = useRef(1);
  const loadingMoreRef = useRef(false);
  const hasMoreRef = useRef(false);

  // Initial load — backend returns DESC (newest first), reverse for display
  useEffect(() => {
    if (!conversationId) return;
    setLoading(true);
    setMessages([]);
    setError(null);
    setHasMore(false);
    hasMoreRef.current = false;
    pageRef.current = 1;

    apiGetMessages(conversationId, 1, PAGE_SIZE)
      .then((res) => {
        setMessages([...res.data].reverse());
        const more = res.data.length >= PAGE_SIZE;
        setHasMore(more);
        hasMoreRef.current = more;
        apiMarkRead(conversationId).catch(() => {});
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load messages");
      })
      .finally(() => setLoading(false));
  }, [conversationId]);

  // Load older messages (scroll-up triggered)
  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMoreRef.current) return;
    const nextPage = pageRef.current + 1;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const res = await apiGetMessages(conversationId, nextPage, PAGE_SIZE);
      const older = [...res.data].reverse();
      setMessages((prev) => {
        const existingIds = new Set(prev.map(getLocalId).filter(Boolean));
        const fresh = older.filter((m) => !existingIds.has(getLocalId(m)));
        return [...fresh, ...prev];
      });
      const more = res.data.length >= PAGE_SIZE;
      setHasMore(more);
      hasMoreRef.current = more;
      pageRef.current = nextPage;
    } catch {
      // silently keep what we have
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [conversationId]);

  // Real-time socket events
  useEffect(() => {
    if (!conversationId) return;
    const socket = getSocket();

    const handleMessageCreated = ({
      message,
      conversationId: cid,
    }: {
      message: Message;
      conversationId: unknown;
    }) => {
      if (String(cid) !== conversationId) return;

      setMessages((prev) => {
        // Already shown (the send response confirmed its bubble first): update
        // that bubble with the server's copy instead of adding a second one.
        const knownIdx = prev.findIndex((m) => sameMessage(m, message));
        if (knownIdx !== -1) {
          const next = [...prev];
          next[knownIdx] = mergeServer(prev[knownIdx], message);
          return next;
        }

        if (String(message.senderType) === "AGENT") {
          // Replace the optimistic temp with the confirmed message
          const tempIdx = prev.findIndex((m) => {
            if (!isTemp(m)) return false;
            return message.messageType === "TEXT"
              ? m.content === message.content
              : m.messageType === message.messageType;
          });
          if (tempIdx !== -1) {
            const next = [...prev];
            next[tempIdx] = message;
            return next;
          }
        }

        if (String(message.senderType) === "CUSTOMER") {
          apiMarkRead(conversationId).catch(() => {});
        }

        return [...prev, message];
      });
    };

    const handleStatusUpdated = ({
      messageId,
      status,
    }: {
      messageId: number | string;
      status: string;
    }) => {
      const targetId = String(messageId);
      setMessages((prev) => {
        const idx = prev.findIndex((m) => getLocalId(m) === targetId);
        if (idx === -1) return prev;
        const next = [...prev];
        next[idx] = { ...next[idx], status: status as import("@/types").Message["status"] };
        return next;
      });
    };

    const handleTypingStart = ({
      conversationId: cid,
      username,
    }: {
      conversationId: number | string;
      username: string;
    }) => {
      if (String(cid) !== conversationId) return;
      setTypingUsers((prev) =>
        prev.includes(username) ? prev : [...prev, username]
      );
    };

    const handleTypingStop = ({
      conversationId: cid,
      username,
    }: {
      conversationId: number | string;
      username: string;
    }) => {
      if (String(cid) !== conversationId) return;
      setTypingUsers((prev) => prev.filter((u) => u !== username));
    };

    const handleMediaReady = ({
      messageId,
      mediaUrl,
    }: {
      messageId: number | string;
      mediaUrl: string;
    }) => {
      const targetId = String(messageId);
      setMessages((prev) => {
        const idx = prev.findIndex((m) => getLocalId(m) === targetId);
        if (idx === -1) return prev;
        const next = [...prev];
        next[idx] = { ...next[idx], mediaUrl };
        return next;
      });
    };

    const handleDeleted = ({
      messageId,
    }: {
      messageId: number | string;
      conversationId: unknown;
    }) => {
      const targetId = String(messageId);
      setMessages((prev) => {
        const idx = prev.findIndex((m) => getLocalId(m) === targetId);
        if (idx === -1) return prev;
        const next = [...prev];
        next[idx] = { ...next[idx], deletedAt: new Date().toISOString(), content: "", mediaUrl: null };
        return next;
      });
    };

    const handleReaction = ({
      messageId,
      reactions,
    }: {
      messageId: number | string;
      reactions: Record<string, number> | null;
    }) => {
      const targetId = String(messageId);
      setMessages((prev) => {
        const idx = prev.findIndex((m) => getLocalId(m) === targetId);
        if (idx === -1) return prev;
        const next = [...prev];
        next[idx] = { ...next[idx], reactions };
        return next;
      });
    };

    // Socket.IO doesn't replay events broadcast while disconnected (e.g. a
    // backend restart) — on reconnect, pull the latest page and merge in
    // anything missed instead of leaving the open conversation silently
    // stale until the agent manually refreshes.
    const handleReconnect = () => {
      apiGetMessages(conversationId, 1, PAGE_SIZE)
        .then((res) => {
          const latest = [...res.data].reverse();
          setMessages((prev) => {
            const existingIds = new Set(prev.map(getLocalId).filter(Boolean));
            const missing = latest.filter((m) => !existingIds.has(getLocalId(m)));
            if (missing.length === 0) return prev;
            return [...prev, ...missing].sort(
              (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
            );
          });
        })
        .catch(() => {});
    };

    socket.on("message.created", handleMessageCreated);
    socket.on("connect", handleReconnect);
    socket.on("message.status_updated", handleStatusUpdated);
    socket.on("message.media_ready", handleMediaReady);
    socket.on("message.reaction", handleReaction);
    socket.on("message.deleted", handleDeleted);
    socket.on("typing.start", handleTypingStart);
    socket.on("typing.stop", handleTypingStop);

    return () => {
      socket.off("message.created", handleMessageCreated);
      socket.off("connect", handleReconnect);
      socket.off("message.status_updated", handleStatusUpdated);
      socket.off("message.media_ready", handleMediaReady);
      socket.off("message.reaction", handleReaction);
      socket.off("message.deleted", handleDeleted);
      socket.off("typing.start", handleTypingStart);
      socket.off("typing.stop", handleTypingStop);
    };
  }, [conversationId]);

  useEffect(() => {
    setTypingUsers([]);
  }, [conversationId]);

  const appendOptimistic = useCallback((msg: Message) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  // Removes an optimistic bubble outright — for a send the server refused
  // before it reached WhatsApp (e.g. the 24h window is closed), where a FAILED
  // bubble would suggest a delivery problem that never happened.
  const discardOptimistic = useCallback((tempId: string) => {
    setMessages((prev) => prev.filter((m) => getLocalId(m) !== tempId));
  }, []);

  const confirmOptimistic = useCallback((tempId: string, confirmed: Message) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => getLocalId(m) === tempId);
      if (idx === -1) return prev;
      // The live event got here first and the message is already on screen:
      // drop the "sending…" bubble rather than show it twice.
      const shown = prev.findIndex((m, i) => i !== idx && sameMessage(m, confirmed));
      if (shown !== -1) {
        const next = prev.filter((_, i) => i !== idx);
        const at = shown > idx ? shown - 1 : shown;
        next[at] = { ...next[at], status: furthestStatus(next[at].status, confirmed.status) };
        return next;
      }
      const next = [...prev];
      next[idx] = confirmed;
      return next;
    });
  }, []);

  return {
    messages,
    loading,
    loadingMore,
    hasMore,
    loadMore,
    error,
    appendOptimistic,
    confirmOptimistic,
    discardOptimistic,
    typingUsers,
  };
}
