import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove
    }).index("email", ["email"]), // index for the email. do not remove or modify

    // Obsolescence Score audits. `report` holds the full ScanReport payload
    // (see src/lib/obsolescence/types.ts); summary fields are denormalized
    // for the recent-audits list.
    scans: defineTable({
      url: v.string(),
      host: v.string(),
      status: v.union(
        v.literal("queued"),
        v.literal("running"),
        v.literal("done"),
        v.literal("error"),
      ),
      stage: v.string(),
      stageNote: v.optional(v.string()),
      error: v.optional(v.string()),
      report: v.optional(v.any()),
      scoreValue: v.optional(v.number()),
      grade: v.optional(v.string()),
      durationMs: v.optional(v.number()),
      createdAt: v.number(),
      completedAt: v.optional(v.number()),
    }),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
