export { ImapClient, createClientFromEnv } from "./client.js";
export {
  findEmails,
  parseTimeParam,
  hasAttachmentPart,
  fetchEmailContent,
  fetchEmailAttachment,
  extractEmailAddress,
} from "./search.js";
export type { FindEmailsOptions } from "./search.js";
export { listFolders, createFolder, moveEmail, folderExists, bulkMoveBySender } from "./folders.js";
export { starEmail, unstarEmail, markRead, markUnread, listStarredEmails, listAllStarredEmails } from "./flags.js";
export type { StarredFolderGroup } from "./flags.js";
export {
  findDraftsFolder,
  createDraft,
  updateDraft,
} from "./drafts.js";
export {
  buildCompositeId,
  parseCompositeId,
  resolveEmailId,
  resolveInMailbox,
} from "./resolve.js";
export type { ImapConfig, EmailEntry } from "./types.js";
export type {
  EmailContent,
  AttachmentInfo,
  AttachmentData,
} from "./search.js";
export type { FolderEntry } from "./folders.js";
export type { DraftOptions, DraftResult } from "./drafts.js";
