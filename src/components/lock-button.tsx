import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/lib/session";

async function lock() {
  "use server";
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/unlock");
}

export function LockButton() {
  return (
    <form action={lock}>
      <button
        className="rounded-2xl px-4 py-3 text-sm font-bold text-slate-500 transition hover:bg-white/8 hover:text-white"
        title="Clear this session"
      >
        Lock
      </button>
    </form>
  );
}
