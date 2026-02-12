export { ImapClient, createClientFromEnv } from "./client.js";
export {
  listEmails,
  listEmailsFromDomain,
  listEmailsFromSender,
  fetchEmailContent,
  fetchEmailAttachment,
  daysAgo,
  extractEmailAddress,
} from "./search.js";
export { listFolders, createFolder, moveEmail } from "./folders.js";
export { starEmail, unstarEmail, listStarredEmails } from "./flags.js";
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
