export { ImapClient, createClientFromEnv } from "./client.js";
export {
  listEmails,
  fetchEmailContent,
  fetchEmailAttachment,
  daysAgo,
  extractEmailAddress,
} from "./search.js";
export { listFolders, createFolder, moveEmail } from "./folders.js";
export type { ImapConfig, EmailEntry } from "./types.js";
export type {
  EmailContent,
  AttachmentInfo,
  AttachmentData,
} from "./search.js";
export type { FolderEntry } from "./folders.js";
