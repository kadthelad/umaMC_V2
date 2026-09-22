// scripts/create-user.mjs — run this once by hand whenever you need to add/change a user
import crypto from "node:crypto";

const [, , password] = process.argv;
const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync(password, salt, 64).toString("hex");

console.log(JSON.stringify({ salt, hash }, null, 2));