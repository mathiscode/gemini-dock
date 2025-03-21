import { relations, sql } from 'drizzle-orm'
import { int, sqliteTable, text } from 'drizzle-orm/sqlite-core'

const NOTIFICATION_TYPES = ['comment', 'message', 'like', 'follow', 'mention', 'post', 'post-comment', 'post-like', 'post-mention'] as const
const REACTIONS = ['👍', '❤️', '😂', '😢', '😡', '😮', '😭'] as const
const ROLES = ['admin', 'user'] as const

export const users = sqliteTable('users', {
  id: int('id').primaryKey(),
  site: text('site').notNull().unique(),
  name: text('name').notNull().unique(),
  email: text('email'),
  password: text('password'),
  passcheck: text('passcheck'),
  emoji: text('emoji'),
  last_login: text('last_login'),
  fingerprint: text('fingerprint'),
  role: text('role', { enum: ROLES }).notNull().default('user'),
  createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
  updatedAt: text('updated_at').notNull().default(sql`(current_timestamp)`),
  metadata: text('metadata')
})

export const sessions = sqliteTable('sessions', {
  id: int('id').primaryKey(),
  userId: int('user_id').references(() => users.id),
  createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
  updatedAt: text('updated_at').notNull().default(sql`(current_timestamp)`),
  metadata: text('metadata')
})

export const posts = sqliteTable('posts', {
  id: int('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  userId: int('user_id').references(() => users.id),
  createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
  updatedAt: text('updated_at').notNull().default(sql`(current_timestamp)`),
  title: text('title').notNull(),
  content: text('content'),
  metadata: text('metadata')
})

export const comments = sqliteTable('comments', {
  id: int('id').primaryKey(),
  postId: int('post_id').references(() => posts.id),
  userId: int('user_id').references(() => users.id),
  createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
  updatedAt: text('updated_at').notNull().default(sql`(current_timestamp)`),
  content: text('content'),
  metadata: text('metadata')
})

export const messages = sqliteTable('messages', {
  id: int('id').primaryKey(),
  subject: text('subject').notNull(),
  from: int('from').references(() => users.id),
  to: int('to').references(() => users.id),
  createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
  updatedAt: text('updated_at').notNull().default(sql`(current_timestamp)`),
  content: text('content'),
  metadata: text('metadata')
})

export const notifications = sqliteTable('notifications', {
  id: int('id').primaryKey(),
  userId: int('user_id').references(() => users.id),
  type: text('type', { enum: NOTIFICATION_TYPES }).notNull(),
  link: text('link'),
  linkText: text('link_text'),
  createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
  updatedAt: text('updated_at').notNull().default(sql`(current_timestamp)`),
  content: text('content'),
  metadata: text('metadata')
})

export const likes = sqliteTable('likes', {
  id: int('id').primaryKey(),
  reaction: text('reaction', { enum: REACTIONS }).notNull(),
  userId: int('user_id').references(() => users.id),
  postId: int('post_id').references(() => posts.id),
  createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
  updatedAt: text('updated_at').notNull().default(sql`(current_timestamp)`),
})

export const data = sqliteTable('data', {
  id: int('id').primaryKey(),
  name: text('name').notNull(),
  value: text('value').notNull(),
  createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
  updatedAt: text('updated_at').notNull().default(sql`(current_timestamp)`),
  metadata: text('metadata')
})

// RELATIONS

export const userRelations = relations(users, ({ many }) => ({
  posts: many(posts),
  comments: many(comments),
  messages: many(messages),
  notifications: many(notifications),
  likes: many(likes)
}))

export const postRelations = relations(posts, ({ one, many }) => ({
  user: one(users, { fields: [posts.userId], references: [users.id] }),
  comments: many(comments)
}))

export const commentRelations = relations(comments, ({ one }) => ({
  user: one(users, { fields: [comments.userId], references: [users.id] }),
  post: one(posts, { fields: [comments.postId], references: [posts.id] })
}))

export const messageRelations = relations(messages, ({ one }) => ({
  from: one(users, { fields: [messages.from], references: [users.id] }),
  to: one(users, { fields: [messages.to], references: [users.id] })
}))

export const notificationRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] })
}))
