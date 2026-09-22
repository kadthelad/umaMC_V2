import { defineAction, ActionError } from "astro:actions";
import { z } from "astro/zod";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { activeSessions } from "../lib/sessions";
import { sessions } from "astro/hono";
import { dbFolder, getSelectedDb } from "../lib/database";

const users = JSON.parse(fs.readFileSync("./auth/users.json", "utf-8"));

function requireLogin(context: { locals: App.Locals }) {
  if (!context.locals.isLoggedIn) {
    throw new ActionError({ code: "UNAUTHORIZED", message: "You must be logged in to do that." });
  }
}

function openWritableDb(context: { cookies: { get(name: string): { value: string } | undefined } }) {
  const selectedDb = getSelectedDb(context.cookies.get("selectedDb")?.value);
  return new Database(path.join(dbFolder, selectedDb));
}

const optionalNumber = z.preprocess(
  (v) => (v === "" || v === undefined || v === null ? null : v),
  z.coerce.number().int().positive().nullable()
);

// Unlike optionalNumber, this isn't a foreign key - coordinates can legitimately be 0 or negative.
const optionalInt = z.preprocess(
  (v) => (v === "" || v === undefined || v === null ? null : v),
  z.coerce.number().int().nullable()
);

const horseFields = {
  name: z.string().trim().min(1, "Name is required"),
  gender: z.coerce.number().int().min(0).max(2),
  birth_date: z.string().trim().min(1, "Birth date is required"),
  // Astro's form-action parser maps a submitted empty string to `null` for plain
  // z.string() fields, which fails validation - these two fields have no "required"
  // HTML attribute, so they must tolerate being cleared. `.optional()` is what makes
  // Astro map "" to `undefined` instead; normalizeHorseFields() fills in the DB default.
  death_date: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  speed: z.coerce.number().min(0),
  jump_height: z.coerce.number().min(0),
  heart_amount: z.coerce.number().min(0),
  sire_id: optionalNumber,
  dam_id: optionalNumber,
  breed_id: optionalNumber,
  stable_id: optionalNumber,
  owner_id: optionalNumber,
};

function normalizeHorseFields<T extends { death_date?: string; notes?: string }>(fields: T) {
  return {
    ...fields,
    death_date: fields.death_date || "00/00/0000",
    notes: fields.notes ?? "",
  };
}

const breedFields = {
  name: z.string().trim().min(1, "Name is required"),
};

const userFields = {
  name: z.string().trim().min(1, "Name is required"),
  auth_name: z.string().trim().optional(),
};

function normalizeUserFields<T extends { auth_name?: string }>(fields: T) {
  return {
    ...fields,
    auth_name: fields.auth_name || null,
  };
}

const stableFields = {
  name: z.string().trim().min(1, "Name is required"),
  owner_id: optionalNumber,
};

const racecourseFields = {
  name: z.string().trim().min(1, "Name is required"),
  coordinate_x: optionalInt,
  coordinate_y: optionalInt,
  // Unlike every other owner_id in this schema, Racecourse.owner_id is NOT NULL.
  owner_id: z.coerce.number().int().positive({ message: "Owner is required" }),
};

export const server = {
  login: defineAction({
    accept: "form",
    input: z.object({
      username: z.string(),
      password: z.string(),
    }),
    handler: async ({ username, password }, context) => {
      const user = users[username];
      if (!user) {
        throw new ActionError({ code: "UNAUTHORIZED", message: "Invalid username or password." });
      }

      const attemptedHash = crypto.scryptSync(password, user.salt, 64);
      const storedHash = Buffer.from(user.hash, "hex");

      const valid =
        attemptedHash.length === storedHash.length &&
        crypto.timingSafeEqual(attemptedHash, storedHash);

      if (!valid) {
        throw new ActionError({ code: "UNAUTHORIZED", message: "Invalid username or password." });
      }

      const sessionToken = crypto.randomBytes(32).toString("hex");
      activeSessions.set(sessionToken, username);

      context.cookies.set("session", sessionToken, {
        httpOnly: true,
        secure: true,
        sameSite: "strict",
        path: "/",
        maxAge: 60 * 60 * 24 * 7, // 1 week
      });

      return { success: true };
    },
  }),
  logout: defineAction({
    accept: "form",
    handler: async (_input, context) => {
        const token = context.cookies.get("session")?.value;

        if (token) {
          activeSessions.delete(token);
        }

        context.cookies.delete("session", { path: "/" });
        return { success: true };
      },
  }),

  horse: {
    create: defineAction({
      accept: "form",
      input: z.object(horseFields),
      handler: async (input, context) => {
        requireLogin(context);

        const db = openWritableDb(context);
        try {
          const stmt = db.prepare(
            `INSERT INTO Horse (name, gender, birth_date, death_date, notes, speed, jump_height, heart_amount, sire_id, dam_id, breed_id, stable_id, owner_id)
             VALUES (@name, @gender, @birth_date, @death_date, @notes, @speed, @jump_height, @heart_amount, @sire_id, @dam_id, @breed_id, @stable_id, @owner_id)`
          );
          const result = stmt.run(normalizeHorseFields(input));
          return { success: true, id: Number(result.lastInsertRowid) };
        } finally {
          db.close();
        }
      },
    }),

    update: defineAction({
      accept: "form",
      input: z.object({ id: z.coerce.number().int().positive(), ...horseFields }),
      handler: async ({ id, ...fields }, context) => {
        requireLogin(context);

        if (id === fields.sire_id || id === fields.dam_id) {
          throw new ActionError({ code: "BAD_REQUEST", message: "A horse cannot be its own parent." });
        }

        const db = openWritableDb(context);
        try {
          const stmt = db.prepare(
            `UPDATE Horse SET name=@name, gender=@gender, birth_date=@birth_date, death_date=@death_date,
             notes=@notes, speed=@speed, jump_height=@jump_height, heart_amount=@heart_amount,
             sire_id=@sire_id, dam_id=@dam_id, breed_id=@breed_id, stable_id=@stable_id, owner_id=@owner_id
             WHERE id=@id`
          );
          const result = stmt.run(normalizeHorseFields({ id, ...fields }));
          if (result.changes === 0) {
            throw new ActionError({ code: "NOT_FOUND", message: "Horse not found." });
          }
          return { success: true };
        } finally {
          db.close();
        }
      },
    }),

    remove: defineAction({
      accept: "form",
      input: z.object({ id: z.coerce.number().int().positive() }),
      handler: async ({ id }, context) => {
        requireLogin(context);

        const db = openWritableDb(context);
        try {
          const result = db.prepare("DELETE FROM Horse WHERE id = ?").run(id);
          if (result.changes === 0) {
            throw new ActionError({ code: "NOT_FOUND", message: "Horse not found." });
          }
          return { success: true };
        } finally {
          db.close();
        }
      },
    }),
  },

  breed: {
    create: defineAction({
      accept: "form",
      input: z.object(breedFields),
      handler: async (input, context) => {
        requireLogin(context);

        const db = openWritableDb(context);
        try {
          const stmt = db.prepare("INSERT INTO Breed (name) VALUES (@name)");
          const result = stmt.run(input);
          return { success: true, id: Number(result.lastInsertRowid) };
        } finally {
          db.close();
        }
      },
    }),

    update: defineAction({
      accept: "form",
      input: z.object({ id: z.coerce.number().int().positive(), ...breedFields }),
      handler: async ({ id, ...fields }, context) => {
        requireLogin(context);

        const db = openWritableDb(context);
        try {
          const result = db.prepare("UPDATE Breed SET name=@name WHERE id=@id").run({ id, ...fields });
          if (result.changes === 0) {
            throw new ActionError({ code: "NOT_FOUND", message: "Breed not found." });
          }
          return { success: true };
        } finally {
          db.close();
        }
      },
    }),

    remove: defineAction({
      accept: "form",
      input: z.object({ id: z.coerce.number().int().positive() }),
      handler: async ({ id }, context) => {
        requireLogin(context);

        const db = openWritableDb(context);
        try {
          const result = db.prepare("DELETE FROM Breed WHERE id = ?").run(id);
          if (result.changes === 0) {
            throw new ActionError({ code: "NOT_FOUND", message: "Breed not found." });
          }
          return { success: true };
        } finally {
          db.close();
        }
      },
    }),
  },

  user: {
    create: defineAction({
      accept: "form",
      input: z.object(userFields),
      handler: async (input, context) => {
        requireLogin(context);

        const db = openWritableDb(context);
        try {
          const stmt = db.prepare("INSERT INTO User (name, auth_name) VALUES (@name, @auth_name)");
          const result = stmt.run(normalizeUserFields(input));
          return { success: true, id: Number(result.lastInsertRowid) };
        } finally {
          db.close();
        }
      },
    }),

    update: defineAction({
      accept: "form",
      input: z.object({ id: z.coerce.number().int().positive(), ...userFields }),
      handler: async ({ id, ...fields }, context) => {
        requireLogin(context);

        const db = openWritableDb(context);
        try {
          const result = db
            .prepare("UPDATE User SET name=@name, auth_name=@auth_name WHERE id=@id")
            .run(normalizeUserFields({ id, ...fields }));
          if (result.changes === 0) {
            throw new ActionError({ code: "NOT_FOUND", message: "User not found." });
          }
          return { success: true };
        } finally {
          db.close();
        }
      },
    }),

    remove: defineAction({
      accept: "form",
      input: z.object({ id: z.coerce.number().int().positive() }),
      handler: async ({ id }, context) => {
        requireLogin(context);

        const db = openWritableDb(context);
        try {
          const result = db.prepare("DELETE FROM User WHERE id = ?").run(id);
          if (result.changes === 0) {
            throw new ActionError({ code: "NOT_FOUND", message: "User not found." });
          }
          return { success: true };
        } finally {
          db.close();
        }
      },
    }),
  },

  stable: {
    create: defineAction({
      accept: "form",
      input: z.object(stableFields),
      handler: async (input, context) => {
        requireLogin(context);

        const db = openWritableDb(context);
        try {
          const stmt = db.prepare("INSERT INTO Stable (name, owner_id) VALUES (@name, @owner_id)");
          const result = stmt.run(input);
          return { success: true, id: Number(result.lastInsertRowid) };
        } finally {
          db.close();
        }
      },
    }),

    update: defineAction({
      accept: "form",
      input: z.object({ id: z.coerce.number().int().positive(), ...stableFields }),
      handler: async ({ id, ...fields }, context) => {
        requireLogin(context);

        const db = openWritableDb(context);
        try {
          const result = db
            .prepare("UPDATE Stable SET name=@name, owner_id=@owner_id WHERE id=@id")
            .run({ id, ...fields });
          if (result.changes === 0) {
            throw new ActionError({ code: "NOT_FOUND", message: "Stable not found." });
          }
          return { success: true };
        } finally {
          db.close();
        }
      },
    }),

    remove: defineAction({
      accept: "form",
      input: z.object({ id: z.coerce.number().int().positive() }),
      handler: async ({ id }, context) => {
        requireLogin(context);

        const db = openWritableDb(context);
        try {
          const result = db.prepare("DELETE FROM Stable WHERE id = ?").run(id);
          if (result.changes === 0) {
            throw new ActionError({ code: "NOT_FOUND", message: "Stable not found." });
          }
          return { success: true };
        } finally {
          db.close();
        }
      },
    }),
  },

  racecourse: {
    create: defineAction({
      accept: "form",
      input: z.object(racecourseFields),
      handler: async (input, context) => {
        requireLogin(context);

        const db = openWritableDb(context);
        try {
          const stmt = db.prepare(
            "INSERT INTO Racecourse (name, coordinate_x, coordinate_y, owner_id) VALUES (@name, @coordinate_x, @coordinate_y, @owner_id)"
          );
          const result = stmt.run(input);
          return { success: true, id: Number(result.lastInsertRowid) };
        } finally {
          db.close();
        }
      },
    }),

    update: defineAction({
      accept: "form",
      input: z.object({ id: z.coerce.number().int().positive(), ...racecourseFields }),
      handler: async ({ id, ...fields }, context) => {
        requireLogin(context);

        const db = openWritableDb(context);
        try {
          const result = db
            .prepare(
              "UPDATE Racecourse SET name=@name, coordinate_x=@coordinate_x, coordinate_y=@coordinate_y, owner_id=@owner_id WHERE id=@id"
            )
            .run({ id, ...fields });
          if (result.changes === 0) {
            throw new ActionError({ code: "NOT_FOUND", message: "Racecourse not found." });
          }
          return { success: true };
        } finally {
          db.close();
        }
      },
    }),

    remove: defineAction({
      accept: "form",
      input: z.object({ id: z.coerce.number().int().positive() }),
      handler: async ({ id }, context) => {
        requireLogin(context);

        const db = openWritableDb(context);
        try {
          const result = db.prepare("DELETE FROM Racecourse WHERE id = ?").run(id);
          if (result.changes === 0) {
            throw new ActionError({ code: "NOT_FOUND", message: "Racecourse not found." });
          }
          return { success: true };
        } finally {
          db.close();
        }
      },
    }),
  },
};