// src/lib/database.js
import fs from "node:fs";

export const dbFolder = "./databases";

export function getDatabases() {
  return fs.readdirSync(dbFolder).filter((file) => file.endsWith(".db"));
}

export function getSelectedDb(cookieValue, databases = getDatabases()) {
  if (cookieValue && databases.includes(cookieValue)) return cookieValue;
  return databases[0];
}