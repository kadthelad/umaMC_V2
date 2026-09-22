/*
  Middleware runs before every request, so anything under /admin (or whatever 
  prefix you use for edit-only pages) gets bounced to /login unless a valid session cookie is present.
  Everything else on the site stays open to the public as before.
*/

import { defineMiddleware } from "astro:middleware";
import { activeSessions } from "./lib/sessions";

export const onRequest = defineMiddleware(async (context, next) => {
  const token = context.cookies.get("session")?.value;
  const username = token ? activeSessions.get(token) : undefined;

  context.locals.isLoggedIn = Boolean(username);
  context.locals.username = username;

  if (context.url.pathname.startsWith("/admin") && !username) {
    return context.redirect("/login");
  }

  if (context.url.pathname.startsWith("/login") && context.locals.isLoggedIn) {
    return context.redirect("/");
  }

  console.log("Active sessions:", activeSessions);
  return next();
});