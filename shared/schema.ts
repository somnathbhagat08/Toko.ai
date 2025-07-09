import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  name: text("name").notNull(),
  avatar: text("avatar"),
  provider: text("provider").default("local"), // 'local' or 'google'
  country: text("country").default("Any on Earth"), // User's preferred country to match with
  tags: text("tags").array().default([]), // User tags/interests for matching
  isOnline: boolean("is_online").default(false), // Real-time online status
  lastSeen: timestamp("last_seen").defaultNow(), // Last activity timestamp
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  email: true,
  password: true,
  name: true,
  avatar: true,
  provider: true,
  country: true,
  tags: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
