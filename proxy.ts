import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  // This app has no Server Actions, so a request naming one is a bot probing
  // for the React Server Components flaw (patched here — Next 16.2.6, React
  // 19.2.4). Refuse it before Next.js handles it, which also stops the
  // "Failed to find Server Action" log noise these probes cause.
  if (request.headers.has("next-action")) {
    return new NextResponse(null, { status: 404 });
  }

  const loggedIn = request.cookies.get("logged_in")?.value;
  const { pathname, searchParams } = request.nextUrl;

  if (pathname.startsWith("/chats") && !loggedIn) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // `logged_in` is a client-written hint, not proof of a session — the real
  // credential is the httpOnly `token` JWT, which the API can reject at any
  // time. So this convenience redirect must never fire on the bounce-back
  // from an expired session: lib/api.ts sends 401s to /login?expired=1, and
  // honouring the hint there would push the user straight back to /chats,
  // which 401s again — an endless /login <-> /chats loop.
  if (pathname === "/login" && loggedIn && !searchParams.has("expired")) {
    return NextResponse.redirect(new URL("/chats", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)"],
};
