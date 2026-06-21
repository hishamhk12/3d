"use client";

// Seller-chat orchestrator. Owns the conversation state and the single network
// round-trip to the protected 3d proxy (POST /api/seller/chat). Ports the
// chatbot ChatClient behavior MINUS technical-document, voice, and web paths.
// The browser never calls FastAPI or the chatbot DB directly; identity is the
// seller session only. On an expired session it redirects to the seller login.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import "@/components/seller/chat/seller-chat.css";
import ChatHeader, { type ChatBotState } from "@/components/seller/chat/ChatHeader";
import ChatMessages from "@/components/seller/chat/ChatMessages";
import ChatComposer, { type ChatStyle } from "@/components/seller/chat/ChatComposer";
import type { ChatMessage } from "@/components/seller/chat/types";
import type { InventoryDTO } from "@/lib/seller/chat/inventory-types";

const ROBOT_SRC = "/seller-chat/robot.svg";
const STYLE_STORAGE_KEY = "seller-chat-style";

const SUGGESTIONS = [
  "اعطني الأصناف المنخفضة بالرياض",
  "اعطني الأصناف المنخفضة بجدة",
  "اعطني الأصناف الخلصانة في الدمام",
];

interface AskOk {
  ok: true;
  data: { answer: string; cards?: InventoryDTO[]; mode?: "ai" | "deterministic" };
}
interface AskErr {
  ok: false;
  status: number | null;
  validation: boolean;
  message: string;
}
type AskResult = AskOk | AskErr;

let counter = 0;
const nextId = () => `m${++counter}`;

export default function SellerChatExperience({
  sellerName,
  showroomCode,
}: {
  sellerName: string;
  showroomCode: string;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [style, setStyle] = useState<ChatStyle>("balanced");
  const [reaction, setReaction] = useState<null | "success" | "error">(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Persisted style (tone/verbosity only).
  useEffect(() => {
    const saved = window.localStorage.getItem(STYLE_STORAGE_KEY);
    if (saved === "creative" || saved === "balanced" || saved === "precise") setStyle(saved);
  }, []);
  function changeStyle(s: ChatStyle) {
    setStyle(s);
    try {
      window.localStorage.setItem(STYLE_STORAGE_KEY, s);
    } catch {
      /* storage blocked — keep in-memory */
    }
  }

  // Mobile-app shell sizing: size the shell to the stable viewport height below
  // any global site header (0 on this route) so the messages panel scrolls
  // internally and the composer stays pinned. Reverts to natural height >=640px.
  useEffect(() => {
    const root = document.documentElement;
    function measure() {
      const header = document.querySelector("header[data-site-header]");
      const h = header ? Math.round(header.getBoundingClientRect().height) : 0;
      root.style.setProperty("--sc-offset", `${h}px`);
    }
    measure();
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      root.style.removeProperty("--sc-offset");
    };
  }, []);

  // Mobile web (iPhone Safari): drive --sc-app-height from the *real* visible
  // viewport so the keyboard / Safari chrome never compress the UI and the body
  // never scrolls. Keeps the latest message visible when the keyboard opens, but
  // only if the user was already near the bottom (never yanks them off older
  // messages they're reading). Scoped entirely to this page via the CSS above.
  useEffect(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;
    function apply() {
      const h = vv ? vv.height : window.innerHeight;
      root.style.setProperty("--sc-app-height", `${Math.round(h)}px`);
      const list = listRef.current;
      if (list && list.scrollHeight - list.scrollTop - list.clientHeight < 140) {
        requestAnimationFrame(() => list.scrollTo({ top: list.scrollHeight }));
      }
    }
    apply();
    vv?.addEventListener("resize", apply);
    vv?.addEventListener("scroll", apply);
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);
    return () => {
      vv?.removeEventListener("resize", apply);
      vv?.removeEventListener("scroll", apply);
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
      root.style.removeProperty("--sc-app-height");
    };
  }, []);

  const reactionTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  function clearReaction() {
    reactionTimers.current.forEach(clearTimeout);
    reactionTimers.current = [];
    setReaction(null);
  }
  function playSuccess() {
    clearReaction();
    setReaction("success");
    reactionTimers.current.push(setTimeout(() => setReaction(null), 900));
  }
  function playError() {
    clearReaction();
    setReaction("error");
    reactionTimers.current.push(setTimeout(() => setReaction(null), 1100));
  }
  useEffect(() => () => clearReaction(), []);

  const botState: ChatBotState = loading ? "thinking" : reaction ? reaction : "idle";

  function scrollToEnd() {
    requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }));
  }

  async function performAsk(q: string): Promise<AskResult> {
    try {
      const res = await fetch("/api/seller/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, style }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) return { ok: true, data };
      return {
        ok: false,
        status: res.status,
        validation: res.status === 400,
        message: data?.error ?? "حدث خطأ غير متوقع.",
      };
    } catch {
      return {
        ok: false,
        status: null,
        validation: false,
        message: "تعذر الاتصال بالخادم. تحقق من اتصالك وحاول مرة أخرى.",
      };
    }
  }

  function answerMessage(id: string, data: AskOk["data"]): ChatMessage {
    return { id, role: "bot", text: data.answer, cards: data.cards, mode: data.mode };
  }

  async function ask(question: string) {
    const q = question.trim();
    if (!q || loading) return;
    clearReaction();
    setMessages((m) => [...m, { id: nextId(), role: "user", text: q }]);
    setLoading(true);
    try {
      const result = await performAsk(q);
      if (result.ok) {
        setMessages((m) => [...m, answerMessage(nextId(), result.data)]);
        playSuccess();
      } else if (result.status === 401) {
        router.push("/login?type=seller");
        router.refresh();
        return;
      } else if (result.validation) {
        setMessages((m) => [...m, { id: nextId(), role: "bot", text: result.message, isError: true }]);
        playError();
      } else {
        setMessages((m) => [
          ...m,
          { id: nextId(), role: "bot", errorState: { kind: "retry", question: q } },
        ]);
        playError();
      }
    } finally {
      setLoading(false);
      scrollToEnd();
    }
  }

  async function retry(messageId: string, question: string) {
    if (loading || !question) return;
    setLoading(true);
    try {
      const result = await performAsk(question);
      if (result.ok) {
        setMessages((m) => m.map((x) => (x.id === messageId ? answerMessage(messageId, result.data) : x)));
        playSuccess();
      } else if (result.status === 401) {
        router.push("/login?type=seller");
        router.refresh();
      } else {
        setMessages((m) =>
          m.map((x) =>
            x.id === messageId
              ? { id: messageId, role: "bot", errorState: { kind: "retry", question } }
              : x,
          ),
        );
        playError();
      }
    } finally {
      setLoading(false);
      scrollToEnd();
    }
  }

  const placeholder = "اكتب سؤالك… مثال: اعطني الأصناف المنخفضة بالرياض";

  return (
    <div dir="rtl" className="seller-chat-scope sc-page mx-auto w-full max-w-[420px] px-2 py-3 sm:py-6">
      <div className="sc-shell sc-shadow-card relative mx-auto flex w-full min-h-0 max-w-[393px] flex-col overflow-hidden rounded-[40px] border border-slate-200 bg-white sm:!h-[82vh]">
        <ChatHeader state={botState} sellerName={sellerName} showroomCode={showroomCode} />
        <ChatMessages
          ref={listRef}
          messages={messages}
          loading={loading}
          suggestions={SUGGESTIONS}
          robotSrc={ROBOT_SRC}
          onAsk={ask}
          onRetry={retry}
        />
        <ChatComposer
          style={style}
          onStyleChange={changeStyle}
          loading={loading}
          placeholder={placeholder}
          onSend={ask}
        />
      </div>
    </div>
  );
}
