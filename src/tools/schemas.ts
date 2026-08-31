import { z } from "zod"

/**
 * Esquemas de salida (`outputSchema`) compartidos por las tools. Describen la
 * misma forma que devuelven los repositorios, para que el cliente MCP reciba
 * `structuredContent` tipado además del texto.
 */

export const WorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  kind: z.string(),
  role: z.string().optional(),
})

export const ProjectSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  key: z.string(),
  color: z.string(),
  description: z.string().nullable(),
  archived: z.boolean(),
  isGroup: z.boolean(),
  createdAt: z.string(),
})

export const IssueModuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  color: z.string(),
})

export const SubprojectSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  color: z.string(),
})

export const IssueTypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  icon: z.string().nullable(),
})

export const IssueStatusSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  position: z.number(),
  color: z.string(),
})

export const LabelSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
})

export const MemberSchema = z.object({
  userId: z.string(),
  role: z.string(),
  fullName: z.string().nullable(),
  email: z.string(),
})

export const OptionSchema = z.object({
  value: z.string(),
  label: z.string(),
})

const IssueRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string().optional(),
  color: z.string(),
})

export const IssueListItemSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  number: z.number(),
  title: z.string(),
  priority: z.string(),
  dueDate: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  assigneeId: z.string().nullable(),
  reporterId: z.string(),
  sprintId: z.string().nullable(),
  status: IssueRefSchema.nullable(),
  type: IssueRefSchema.nullable(),
  module: IssueRefSchema.nullable(),
  subproject: IssueRefSchema.extend({ slug: z.string() }).nullable(),
  labels: z.array(LabelSchema),
})

export const CommentSchema = z.object({
  id: z.string(),
  authorId: z.string(),
  body: z.string(),
  createdAt: z.string(),
})

export const ActivitySchema = z.object({
  id: z.string(),
  actorId: z.string().nullable(),
  action: z.string(),
  fromValue: z.string().nullable(),
  toValue: z.string().nullable(),
  createdAt: z.string(),
})

export const AttachmentSchema = z.object({
  id: z.string(),
  issueId: z.string().nullable(),
  filename: z.string(),
  size: z.number().nullable(),
  mimeType: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.string(),
  url: z.string().nullable(),
})

export const IssueDetailSchema = IssueListItemSchema.extend({
  description: z.string(),
  stepsToReproduce: z.string(),
  businessLogic: z.string(),
  resolutionNotes: z.string(),
  comments: z.array(CommentSchema),
  activity: z.array(ActivitySchema),
  attachments: z.array(AttachmentSchema),
})

export const NoteSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  projectId: z.string().nullable(),
  subprojectId: z.string().nullable(),
  issueId: z.string().nullable(),
  authorId: z.string(),
  title: z.string(),
  content: z.string(),
  pinned: z.boolean(),
  visibility: z.string(),
  color: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
