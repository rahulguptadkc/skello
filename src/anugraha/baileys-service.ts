/**
 * Server-side Baileys WhatsApp Multi-Device Service for Skelo
 * Connects to WhatsApp via @whiskeysockets/baileys, listens for QR updates,
 * discovers all participating WhatsApp groups, and captures real-time group messages.
 */

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  normalizeMessageContent,
  type WASocket,
  type WAMessage,
} from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import pino from "pino";
import fs from "fs";
import path from "path";

export type WhatsAppConnectionStatus =
  | "starting"
  | "connecting"
  | "qr"
  | "connected"
  | "disconnected"
  | "reconnecting";

export interface WhatsAppServiceState {
  status: WhatsAppConnectionStatus;
  qrDataUrl: string | null;
  rawQr: string | null;
  connectedNumber: string | null;
  connectedName: string | null;
  connectedAt: string | null;
}

export interface DiscoveredWhatsAppGroup {
  id: string;
  name: string;
  participantCount: number;
  category: "broker_network" | "residential" | "commercial" | "direct_owners";
  lastActive: string;
  todayMessageCount: number;
}

export interface LiveCapturedGroupMessage {
  id: string;
  groupId: string;
  groupName: string;
  senderPhone: string;
  senderName: string;
  text: string;
  timestamp: number;
}

// Global in-memory singleton to persist across Next.js dev reloads
declare global {
  // eslint-disable-next-line no-var
  var __skeloWhatsAppState: WhatsAppServiceState | undefined;
  // eslint-disable-next-line no-var
  var __skeloWhatsAppSock: WASocket | null | undefined;
  // eslint-disable-next-line no-var
  var __skeloWhatsAppStarting: boolean | undefined;
  // eslint-disable-next-line no-var
  var __skeloWhatsAppConnectionReplaced: boolean | undefined;
  // eslint-disable-next-line no-var
  var __skeloWhatsAppReconnectAttempts: number | undefined;
  // eslint-disable-next-line no-var
  var __skeloWhatsAppReconnectAt: number | undefined;
  // eslint-disable-next-line no-var
  var __skeloWhatsAppReconnectTimer: ReturnType<typeof setTimeout> | undefined;
  // eslint-disable-next-line no-var
  var __skeloDiscoveredGroups: DiscoveredWhatsAppGroup[] | undefined;
  // eslint-disable-next-line no-var
  var __skeloPermittedGroups: Set<string> | undefined;
  // eslint-disable-next-line no-var
  var __skeloLiveMessages: LiveCapturedGroupMessage[] | undefined;
  // eslint-disable-next-line no-var
  var __skeloGroupsLastFetchedAt: number | undefined;
  // eslint-disable-next-line no-var
  var __skeloGroupsBackoffAttempts: number | undefined;
  // eslint-disable-next-line no-var
  var __skeloGroupsBackoffUntil: number | undefined;
}

const AUTH_DIR = path.join(process.cwd(), "auth");
const CREDS_FILE = path.join(AUTH_DIR, "creds.json");
const PERMITTED_FILE = path.join(AUTH_DIR, "permitted_groups.json");
const CAPTURED_MESSAGES_FILE = path.join(AUTH_DIR, "captured_messages.json");
const DISCOVERED_GROUPS_FILE = path.join(AUTH_DIR, "discovered_groups.json");

/**
 * Clear only Baileys' linked-device credentials. The same directory also
 * stores app data (permitted groups, discovered groups, and captured messages),
 * so removing the directory itself would make a rescan look like a fresh setup.
 */
function clearWhatsAppCredentialsFromDisk() {
  try {
    if (!fs.existsSync(AUTH_DIR)) return;

    const appDataFiles = new Set([
      path.basename(PERMITTED_FILE),
      path.basename(CAPTURED_MESSAGES_FILE),
      path.basename(DISCOVERED_GROUPS_FILE),
    ]);

    for (const entry of fs.readdirSync(AUTH_DIR, { withFileTypes: true })) {
      if (appDataFiles.has(entry.name) || entry.name.startsWith("lid-mapping-")) continue;
      const entryPath = path.join(AUTH_DIR, entry.name);
      if (entry.isFile()) fs.rmSync(entryPath, { force: true });
    }
  } catch (err) {
    console.error("[WhatsApp Baileys] Failed to clear linked-device credentials:", err);
  }
}

export function loadDiscoveredGroupsFromDisk(): DiscoveredWhatsAppGroup[] {
  try {
    if (fs.existsSync(DISCOVERED_GROUPS_FILE)) {
      const content = fs.readFileSync(DISCOVERED_GROUPS_FILE, "utf-8");
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch {
    // ignore
  }
  return [];
}

export function saveDiscoveredGroupsToDisk(groups: DiscoveredWhatsAppGroup[]) {
  try {
    if (!fs.existsSync(AUTH_DIR)) {
      fs.mkdirSync(AUTH_DIR, { recursive: true });
    }
    fs.writeFileSync(DISCOVERED_GROUPS_FILE, JSON.stringify(groups, null, 2), "utf-8");
  } catch (err) {
    console.error("[WhatsApp Baileys] Failed to save discovered groups to disk:", err);
  }
}

export function loadCapturedMessagesFromDisk(): LiveCapturedGroupMessage[] {
  try {
    if (fs.existsSync(CAPTURED_MESSAGES_FILE)) {
      const content = fs.readFileSync(CAPTURED_MESSAGES_FILE, "utf-8");
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (err) {
    console.error("[WhatsApp Baileys] Failed to load captured messages from disk:", err);
  }
  return [];
}

export function saveCapturedMessagesToDisk(msgs: LiveCapturedGroupMessage[]) {
  try {
    if (!fs.existsSync(AUTH_DIR)) {
      fs.mkdirSync(AUTH_DIR, { recursive: true });
    }
    fs.writeFileSync(CAPTURED_MESSAGES_FILE, JSON.stringify(msgs, null, 2), "utf-8");
  } catch (err) {
    console.error("[WhatsApp Baileys] Failed to save captured messages to disk:", err);
  }
}

export function hasSavedCredentials(): boolean {
  try {
    return fs.existsSync(CREDS_FILE);
  } catch {
    return false;
  }
}

export function getSavedCredentialsInfo(): {
  phone: string | null;
  name: string | null;
} | null {
  try {
    if (fs.existsSync(CREDS_FILE)) {
      const raw = fs.readFileSync(CREDS_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed.me?.id) {
        const idStr = String(parsed.me.id);
        const rawNum = idStr.split("@")[0].split(":")[0];
        const formatted = rawNum
          ? rawNum.startsWith("+")
            ? rawNum
            : `+${rawNum}`
          : null;
        return {
          phone: formatted,
          name: parsed.me.name || "Connected WhatsApp",
        };
      }
    }
  } catch {
    // ignore
  }
  return null;
}

export function loadPermittedGroupIdsFromDisk(): string[] {
  try {
    if (fs.existsSync(PERMITTED_FILE)) {
      const content = fs.readFileSync(PERMITTED_FILE, "utf-8");
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch {
    // ignore
  }
  return [];
}

export function savePermittedGroupIdsToDisk(ids: string[]) {
  try {
    if (!fs.existsSync(AUTH_DIR)) {
      fs.mkdirSync(AUTH_DIR, { recursive: true });
    }
    fs.writeFileSync(PERMITTED_FILE, JSON.stringify(ids, null, 2), "utf-8");
  } catch (err) {
    console.error("[WhatsApp Baileys] Failed to save permitted groups to disk:", err);
  }
}

if (!globalThis.__skeloWhatsAppState) {
  const savedCreds = getSavedCredentialsInfo();
  if (savedCreds?.phone) {
    globalThis.__skeloWhatsAppState = {
      status: "connected",
      qrDataUrl: null,
      rawQr: null,
      connectedNumber: savedCreds.phone,
      connectedName: savedCreds.name,
      connectedAt: new Date().toISOString(),
    };
  } else {
    globalThis.__skeloWhatsAppState = {
      status: "starting",
      qrDataUrl: null,
      rawQr: null,
      connectedNumber: null,
      connectedName: null,
      connectedAt: null,
    };
  }
}

if (!globalThis.__skeloDiscoveredGroups || globalThis.__skeloDiscoveredGroups.length === 0) {
  globalThis.__skeloDiscoveredGroups = loadDiscoveredGroupsFromDisk();
}

if (!globalThis.__skeloPermittedGroups || globalThis.__skeloPermittedGroups.size === 0) {
  const diskPermitted = loadPermittedGroupIdsFromDisk();
  globalThis.__skeloPermittedGroups = new Set(diskPermitted);
}

if (!globalThis.__skeloLiveMessages || globalThis.__skeloLiveMessages.length === 0) {
  globalThis.__skeloLiveMessages = loadCapturedMessagesFromDisk();
}

function categorizeGroupName(
  name: string,
): "broker_network" | "residential" | "commercial" | "direct_owners" {
  const lower = (name || "").toLowerCase();
  if (
    lower.includes("broker") ||
    lower.includes("agent") ||
    lower.includes("network") ||
    lower.includes("association")
  ) {
    return "broker_network";
  }
  if (
    lower.includes("commercial") ||
    lower.includes("office") ||
    lower.includes("retail") ||
    lower.includes("lease") ||
    lower.includes("workspace")
  ) {
    return "commercial";
  }
  if (
    lower.includes("owner") ||
    lower.includes("direct") ||
    lower.includes("investor")
  ) {
    return "direct_owners";
  }
  return "residential";
}

// Recursive message unwrapper: unpacks ephemeral, view-once, edited, device-sent, and wrapped messages
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function unwrapMessage(msg: any): any {
  if (!msg) return msg;
  if (msg.ephemeralMessage?.message) return unwrapMessage(msg.ephemeralMessage.message);
  if (msg.viewOnceMessage?.message) return unwrapMessage(msg.viewOnceMessage.message);
  if (msg.viewOnceMessageV2?.message) return unwrapMessage(msg.viewOnceMessageV2.message);
  if (msg.documentWithCaptionMessage?.message) return unwrapMessage(msg.documentWithCaptionMessage.message);
  if (msg.editedMessage?.message?.protocolMessage?.editedMessage) {
    return unwrapMessage(msg.editedMessage.message.protocolMessage.editedMessage);
  }
  if (msg.deviceSentMessage?.message) return unwrapMessage(msg.deviceSentMessage.message);
  return msg;
}

function extractMessageText(m: WAMessage): string {
  if (!m.message) return "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawMsg = unwrapMessage(m.message);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const normalized = (normalizeMessageContent(rawMsg) || rawMsg) as any;
  const unwrapped = unwrapMessage(normalized);
  return (
    unwrapped.conversation ||
    unwrapped.extendedTextMessage?.text ||
    unwrapped.imageMessage?.caption ||
    unwrapped.videoMessage?.caption ||
    unwrapped.documentMessage?.caption ||
    unwrapped.documentWithCaptionMessage?.message?.documentMessage?.caption ||
    unwrapped.buttonsResponseMessage?.selectedDisplayText ||
    unwrapped.listResponseMessage?.title ||
    unwrapped.templateButtonReplyMessage?.selectedId ||
    rawMsg.conversation ||
    rawMsg.extendedTextMessage?.text ||
    ""
  );
}

export function extractContactFromMessage(
  _text: string,
  defaultName: string,
  defaultPhone: string,
): { name: string; phone: string } {
  // Strictly return the sender who sent the message in the group.
  // Do NOT extract phone numbers or contacts from message body text.
  return { name: defaultName, phone: defaultPhone };
}

// Robustly parse Baileys timestamp (handles protobuf Long, numbers, strings, seconds vs ms)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseBaileysTimestamp(raw: any): number {
  if (!raw) return Date.now();
  if (typeof raw === "number") {
    return raw > 1e11 ? raw : raw * 1000;
  }
  if (typeof raw === "string") {
    const num = Number(raw);
    if (!isNaN(num)) return num > 1e11 ? num : num * 1000;
  }
  if (typeof raw === "object" && raw !== null) {
    if (typeof raw.toNumber === "function") {
      const num = raw.toNumber();
      return num > 1e11 ? num : num * 1000;
    }
    if (typeof raw.low === "number") {
      const num = raw.low;
      return num > 1e11 ? num : num * 1000;
    }
  }
  return Date.now();
}

export function getWhatsAppServiceState(): WhatsAppServiceState {
  if (!globalThis.__skeloWhatsAppState) {
    const saved = getSavedCredentialsInfo();
    const hasCreds = hasSavedCredentials();
    globalThis.__skeloWhatsAppState = {
      status: globalThis.__skeloWhatsAppSock ? "connected" : hasCreds ? "starting" : "disconnected",
      qrDataUrl: null,
      rawQr: null,
      connectedNumber: saved?.phone || null,
      connectedName: saved?.name || null,
      connectedAt: hasCreds ? new Date().toISOString() : null,
    };
  }

  const state = globalThis.__skeloWhatsAppState;

  // Accurately reflect status: if the socket is not active, status cannot be "connected"
  if (!globalThis.__skeloWhatsAppSock && state.status === "connected") {
    state.status = hasSavedCredentials() ? "starting" : "disconnected";
  }

  return state;
}

export function setPermittedGroupIds(ids: string[]) {
  globalThis.__skeloPermittedGroups = new Set(ids);
  savePermittedGroupIdsToDisk(ids);
}

export function getPermittedGroupIds(): string[] {
  const fromMemory = Array.from(globalThis.__skeloPermittedGroups || []);
  if (fromMemory.length > 0) return fromMemory;
  const fromDisk = loadPermittedGroupIdsFromDisk();
  if (fromDisk.length > 0) {
    globalThis.__skeloPermittedGroups = new Set(fromDisk);
    return fromDisk;
  }
  return [];
}

/**
 * Resolves a WhatsApp participant (including modern privacy LIDs) to their real phone number.
 * Looks up reverse mapping files (e.g. lid-mapping-<lid>_reverse.json) in the auth directory.
 * Message text is deliberately ignored because listing contact numbers are not sender identities.
 */
export function resolvePhoneNumberFromParticipant(
  rawParticipant: string,
  _messageText?: string,
): string {
  if (!rawParticipant) return "WhatsApp Member";
  const rawNumber = String(rawParticipant).split("@")[0].split(":")[0].replace(/[^0-9]/g, "");
  if (!rawNumber) return "WhatsApp Member";
  let resolvedNumber = rawNumber;

  // If modern WhatsApp LID (typically >= 13 digits), check for reverse lid mapping in auth directory
  if (rawNumber.length >= 13) {
    const reversePath = path.join(AUTH_DIR, `lid-mapping-${rawNumber}_reverse.json`);
    if (fs.existsSync(reversePath)) {
      try {
        const mapped = JSON.parse(fs.readFileSync(reversePath, "utf8"));
        if (typeof mapped === "string") {
          const mappedDigits = mapped.replace(/[^0-9]/g, "");
          if (mappedDigits.length >= 10 && mappedDigits.length <= 15) {
            resolvedNumber = mappedDigits;
          }
        }
      } catch {}
    }
  }

  // Never infer the sender from a phone number inside the message. Listing
  // contact numbers often belong to a different person than the group sender.
  // An unresolved LID is safer to show as unknown than as a guessed phone.
  if (resolvedNumber.length >= 13 || resolvedNumber.length < 10) {
    return "WhatsApp Member";
  }

  // Format clean Indian or international number
  if (resolvedNumber.startsWith("91") && resolvedNumber.length === 12) {
    return `+91 ${resolvedNumber.slice(2, 7)} ${resolvedNumber.slice(7)}`;
  }
  if (resolvedNumber.length === 10) {
    return `+91 ${resolvedNumber.slice(0, 5)} ${resolvedNumber.slice(5)}`;
  }
  return resolvedNumber.startsWith("+") ? resolvedNumber : `+${resolvedNumber}`;
}

export function getLiveCapturedMessages(): LiveCapturedGroupMessage[] {
  const fromDisk = loadCapturedMessagesFromDisk();
  // Dynamically resolve any LID or raw participant in loaded messages
  const resolved = fromDisk.map((m) => {
    let phone = m.senderPhone;
    const rawDigits = phone ? phone.replace(/[^0-9]/g, "") : "";
    if (!phone || rawDigits.length >= 13 || (!phone.startsWith("+91") && rawDigits.startsWith("91"))) {
      const fixed = resolvePhoneNumberFromParticipant(rawDigits || m.senderPhone, m.text);
      if (fixed) {
        phone = fixed;
      }
    }
    return {
      ...m,
      senderPhone: phone,
    };
  });

  const diskMap = new Map(resolved.map((m) => [m.id, m]));
  if (!globalThis.__skeloLiveMessages || globalThis.__skeloLiveMessages.length === 0) {
    globalThis.__skeloLiveMessages = resolved;
  } else {
    // Update existing in-memory items with resolved phones, and append new ones
    globalThis.__skeloLiveMessages = globalThis.__skeloLiveMessages.map((m) => {
      const updated = diskMap.get(m.id);
      return updated ? { ...m, senderPhone: updated.senderPhone } : m;
    });
    const memIds = new Set(globalThis.__skeloLiveMessages.map((m) => m.id));
    for (const dm of resolved) {
      if (!memIds.has(dm.id)) {
        globalThis.__skeloLiveMessages.push(dm);
      }
    }
  }
  return globalThis.__skeloLiveMessages || [];
}

/**
 * Rate-limit & Exponential Backoff Policy for WhatsApp Group Operations:
 * 1. Fetch all participating groups: Once every 30 minutes
 * 2. Refresh group metadata: Only when specifically required
 * 3. Retry after 429 (rate-overlimit): Wait with exponential backoff (1m, 2m, 4m... up to 30m)
 * 4. Initial group discovery: Once after socket connection
 */
const GROUPS_SYNC_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const BASE_BACKOFF_DELAY_MS = 60 * 1000; // 1 minute base backoff
const MAX_BACKOFF_DELAY_MS = 30 * 60 * 1000; // 30 minutes max backoff

export async function fetchDiscoveredGroups(force = false): Promise<DiscoveredWhatsAppGroup[]> {
  const cachedMemory = globalThis.__skeloDiscoveredGroups || [];
  const now = Date.now();
  const backoffUntil = globalThis.__skeloGroupsBackoffUntil || 0;

  // 1. Instant Return: If not forced, immediately return cached groups from memory or disk
  if (!force) {
    if (cachedMemory.length > 0) return cachedMemory;
    const fromDisk = loadDiscoveredGroupsFromDisk();
    if (fromDisk.length > 0) {
      globalThis.__skeloDiscoveredGroups = fromDisk;
      return fromDisk;
    }
  }

  // 2. Check Exponential Backoff: if throttled by WhatsApp 429, wait until backoff timer elapses
  if (now < backoffUntil) {
    const remainingSec = Math.round((backoffUntil - now) / 1000);
    console.log(
      `[WhatsApp Baileys] Exponential backoff active (${remainingSec}s remaining). Serving cached groups.`,
    );
    return cachedMemory.length > 0 ? cachedMemory : loadDiscoveredGroupsFromDisk();
  }

  // 3. Fallback to Disk Cache if in-memory cache is empty
  if (cachedMemory.length === 0) {
    const fromDisk = loadDiscoveredGroupsFromDisk();
    if (fromDisk.length > 0) {
      globalThis.__skeloDiscoveredGroups = fromDisk;
      if (!force) return fromDisk;
    }
  }

  const sock = globalThis.__skeloWhatsAppSock;
  if (!sock) {
    return globalThis.__skeloDiscoveredGroups || loadDiscoveredGroupsFromDisk();
  }

  try {
    // Wrap groupFetchAllParticipating in a 3-second timeout so it never hangs API requests
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("groupFetchAllParticipating timed out after 3000ms")), 3000),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawGroups = (await Promise.race([
      sock.groupFetchAllParticipating(),
      timeoutPromise,
    ])) as Record<string, any>;

    const groupList: DiscoveredWhatsAppGroup[] = Object.values(rawGroups).map(
      (g) => ({
        id: g.id,
        name: g.subject || "WhatsApp Group",
        participantCount: Array.isArray(g.participants)
          ? g.participants.length
          : 0,
        category: categorizeGroupName(g.subject || ""),
        lastActive: "Today",
        todayMessageCount: 0,
      }),
    );

    // Success: reset exponential backoff counter and update last fetched timestamp
    globalThis.__skeloDiscoveredGroups = groupList;
    globalThis.__skeloGroupsLastFetchedAt = Date.now();
    globalThis.__skeloGroupsBackoffAttempts = 0;
    globalThis.__skeloGroupsBackoffUntil = 0;
    saveDiscoveredGroupsToDisk(groupList);
    return groupList;
  } catch (err: any) {
    const isRateLimit =
      err?.data === 429 ||
      err?.message?.includes("rate-overlimit") ||
      err?.output?.statusCode === 429;

    if (isRateLimit) {
      // Exponential Backoff calculation: base * 2^(attempts - 1)
      const attempts = (globalThis.__skeloGroupsBackoffAttempts || 0) + 1;
      globalThis.__skeloGroupsBackoffAttempts = attempts;
      const backoffMs = Math.min(
        MAX_BACKOFF_DELAY_MS,
        BASE_BACKOFF_DELAY_MS * Math.pow(2, attempts - 1),
      );
      globalThis.__skeloGroupsBackoffUntil = Date.now() + backoffMs;

      console.warn(
        `[WhatsApp Baileys] Rate-overlimit (429) received. Activating exponential backoff for ${Math.round(
          backoffMs / 1000,
        )}s (attempt ${attempts}). Serving cached groups.`,
      );
      return cachedMemory.length > 0 ? cachedMemory : loadDiscoveredGroupsFromDisk();
    }

    console.warn(
      "[WhatsApp Baileys] Could not fetch participating groups from socket:",
      err?.message || err,
    );
    return cachedMemory.length > 0 ? cachedMemory : loadDiscoveredGroupsFromDisk();
  }
}

/**
 * Refresh group metadata: only when specifically required (e.g. detailed inspect view)
 */
export async function refreshGroupMetadata(groupId: string): Promise<any> {
  const sock = globalThis.__skeloWhatsAppSock;
  if (!sock) return null;
  try {
    return await sock.groupMetadata(groupId);
  } catch (err: any) {
    console.warn(
      `[WhatsApp Baileys] Could not refresh metadata for group ${groupId}:`,
      err?.message || err,
    );
    return null;
  }
}

export async function startWhatsAppService(): Promise<WhatsAppServiceState> {
  const currentState = getWhatsAppServiceState();

  // Never create a second socket while this process already owns one.
  if (globalThis.__skeloWhatsAppSock) {
    return currentState;
  }
  if (globalThis.__skeloWhatsAppStarting) {
    return currentState;
  }
  if (currentState.status === "reconnecting" && (globalThis.__skeloWhatsAppReconnectAt || 0) > Date.now()) {
    return currentState;
  }
  // A 440 close means another process owns this account. Do not fight it by
  // repeatedly opening the same credentials; an explicit reconnect resets this.
  if (globalThis.__skeloWhatsAppConnectionReplaced && hasSavedCredentials()) {
    return currentState;
  }

  globalThis.__skeloWhatsAppStarting = true;
  currentState.status = "starting";

  try {
    if (!fs.existsSync(AUTH_DIR)) {
      fs.mkdirSync(AUTH_DIR, { recursive: true });
    }

    const { state: authState, saveCreds } =
      await useMultiFileAuthState(AUTH_DIR);

    const sock = makeWASocket({
      auth: authState,
      logger: pino({ level: "silent" }) as never,
      browser: ["Skelo Lead Capture", "Chrome", "1.0"],
      syncFullHistory: true,
      shouldSyncHistoryMessage: () => true,
    });

    globalThis.__skeloWhatsAppSock = sock;
    sock.ev.on("creds.update", saveCreds);

    // 1. Connection Lifecycle Handler
    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      // WhatsApp emitted a new QR string -> convert to Image URL
      if (qr) {
        currentState.status = "qr";
        currentState.rawQr = qr;
        try {
          currentState.qrDataUrl = await QRCode.toDataURL(qr, {
            margin: 1,
            width: 320,
          });
          console.log("[WhatsApp Baileys] QR ready for scanning.");
        } catch (err) {
          console.error("[WhatsApp Baileys] Failed to convert QR to DataURL", err);
        }
      }

      // WhatsApp connection opened successfully
      if (connection === "open") {
        currentState.status = "connected";
        globalThis.__skeloWhatsAppConnectionReplaced = false;
        globalThis.__skeloWhatsAppReconnectAttempts = 0;
        globalThis.__skeloWhatsAppReconnectAt = 0;
        if (globalThis.__skeloWhatsAppReconnectTimer) {
          clearTimeout(globalThis.__skeloWhatsAppReconnectTimer);
          globalThis.__skeloWhatsAppReconnectTimer = undefined;
        }
        currentState.qrDataUrl = null;
        currentState.rawQr = null;
        currentState.connectedAt = new Date().toISOString();

        const user = sock.user;
        const rawPhone = user?.id ? String(user.id).split("@")[0].split(":")[0] : "";
        currentState.connectedNumber = rawPhone
          ? (rawPhone.startsWith("+") ? rawPhone : `+${rawPhone}`)
          : getSavedCredentialsInfo()?.phone || null;
        currentState.connectedName = user?.name || getSavedCredentialsInfo()?.name || "Connected WhatsApp";

        console.log(
          `[WhatsApp Baileys] Connected as ${currentState.connectedNumber} (${currentState.connectedName})`,
        );

        // Initial group discovery: Once after socket connection
        setTimeout(() => {
          fetchDiscoveredGroups(false).catch(console.error);
        }, 2000);
      }

      // WhatsApp connection closed
      if (connection === "close") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const errOutput = (lastDisconnect?.error as any)?.output;
        const statusCode = errOutput?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;
        const connectionReplaced =
          statusCode === DisconnectReason.connectionReplaced;

        console.log(
          `[WhatsApp Baileys] Connection closed (code=${statusCode}, loggedOut=${loggedOut}, connectionReplaced=${connectionReplaced})`,
        );

        // Code 440: Another process opened WhatsApp with these credentials.
        if (connectionReplaced) {
          console.warn(
            "[WhatsApp Baileys] Session is owned by another process (code 440). Stopping reconnect attempts to prevent duplicate scanners.",
          );
          globalThis.__skeloWhatsAppConnectionReplaced = true;
          if (hasSavedCredentials()) {
            const saved = getSavedCredentialsInfo();
            currentState.status = "connected";
            if (saved?.phone) currentState.connectedNumber = saved.phone;
            if (saved?.name) currentState.connectedName = saved.name;
          } else {
            currentState.status = "disconnected";
          }
          globalThis.__skeloWhatsAppSock = null;
          globalThis.__skeloWhatsAppStarting = false;
          globalThis.__skeloWhatsAppReconnectAt = 0;
          return;
        }

        if (loggedOut) {
          clearWhatsAppCredentialsFromDisk();
          currentState.status = "disconnected";
          currentState.qrDataUrl = null;
          currentState.rawQr = null;
          currentState.connectedNumber = null;
          currentState.connectedName = null;
          globalThis.__skeloWhatsAppSock = null;
          globalThis.__skeloWhatsAppStarting = false;
          globalThis.__skeloWhatsAppReconnectAttempts = 0;
          globalThis.__skeloWhatsAppReconnectAt = Date.now() + 800;
          globalThis.__skeloWhatsAppReconnectTimer = setTimeout(() => {
            globalThis.__skeloWhatsAppReconnectAt = 0;
            globalThis.__skeloWhatsAppReconnectTimer = undefined;
            startWhatsAppService().catch(console.error);
          }, 800);
        } else {
          currentState.status = "reconnecting";
          globalThis.__skeloWhatsAppSock = null;
          globalThis.__skeloWhatsAppStarting = false;
          const attempts = (globalThis.__skeloWhatsAppReconnectAttempts || 0) + 1;
          globalThis.__skeloWhatsAppReconnectAttempts = attempts;
          const reconnectDelayMs = Math.min(120_000, 2_000 * 2 ** Math.min(attempts - 1, 6));
          globalThis.__skeloWhatsAppReconnectAt = Date.now() + reconnectDelayMs;
          globalThis.__skeloWhatsAppReconnectTimer = setTimeout(() => {
            globalThis.__skeloWhatsAppReconnectAt = 0;
            globalThis.__skeloWhatsAppReconnectTimer = undefined;
            startWhatsAppService().catch(console.error);
          }, reconnectDelayMs);
        }
      }
    });

    // Helper to process incoming or synced messages
    const processMessages = (msgs: WAMessage[]) => {
      const permittedList = getPermittedGroupIds();
      const permitted = new Set(permittedList.map((id) => id.replace(/:.*@/, "@").toLowerCase()));
      const permittedDigits = new Set(
        permittedList.map((id) => id.split("@")[0].replace(/[^0-9]/g, "")).filter(Boolean),
      );
      const groupMap = new Map(
        (globalThis.__skeloDiscoveredGroups || []).map((g) => [g.id, g.name]),
      );

      for (const m of msgs) {
        if (!m.message) continue;
        const jid = m.key?.remoteJid || "";
        if (!jid) continue;

        const normalizedJid = jid.replace(/:.*@/, "@");

        // Only group messages
        if (!normalizedJid.endsWith("@g.us")) continue;

        // Strict customer permission check: only scrape if permitted!
        const cleanJid = normalizedJid.toLowerCase();
        const cleanRawJid = jid.toLowerCase();
        const jidDigits = cleanJid.split("@")[0].replace(/[^0-9]/g, "");

        const isGroupPermitted =
          permitted.size === 0 ||
          permitted.has(cleanJid) ||
          permitted.has(cleanRawJid) ||
          (jidDigits && permittedDigits.has(jidDigits));

        if (!isGroupPermitted) {
          continue;
        }

        const text = extractMessageText(m);
        if (!text.trim()) continue;

        const senderJid =
          m.key.participant ||
          (m as any).participant ||
          (m.key.fromMe ? sock.user?.id || jid : jid);
        const formattedPhone = resolvePhoneNumberFromParticipant(senderJid, text);

        const senderName = m.key.fromMe
          ? sock.user?.name || currentState.connectedName || formattedPhone
          : m.pushName || formattedPhone;

        const groupName =
          groupMap.get(normalizedJid) ||
          groupMap.get(jid) ||
          "Group for whatsapp testing";
        const timestamp = parseBaileysTimestamp(m.messageTimestamp);

        const liveRecord: LiveCapturedGroupMessage = {
          id: m.key.id || `live-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          groupId: normalizedJid,
          groupName,
          senderPhone: formattedPhone,
          senderName,
          text,
          timestamp,
        };

        if (!globalThis.__skeloLiveMessages) {
          globalThis.__skeloLiveMessages = [];
        }
        if (
          !globalThis.__skeloLiveMessages.some(
            (existing) => existing.id === liveRecord.id,
          )
        ) {
          globalThis.__skeloLiveMessages.unshift(liveRecord);
          if (globalThis.__skeloLiveMessages.length > 500) {
            globalThis.__skeloLiveMessages.pop();
          }
          saveCapturedMessagesToDisk(globalThis.__skeloLiveMessages);
        }

        console.log(
          `[WhatsApp Ingest] [${groupName}] ${senderName}: ${text.slice(0, 80)}`,
        );
      }
    };

    // 2. Incoming Messages Listener (accepts both notify and append)
    sock.ev.on("messages.upsert", async ({ messages: msgs }) => {
      processMessages(msgs);
    });

    // 3. Message Updates Listener (handles decrypted or edited messages)
    sock.ev.on("messages.update", async (updates) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msgs = updates.map((u) => u.update as any).filter((m) => m && m.message);
      if (msgs.length > 0) {
        processMessages(msgs);
      }
    });

    // 4. History Sync Listener (captures recent messages from synced groups)
    sock.ev.on("messaging-history.set", async ({ messages: msgs }) => {
      if (Array.isArray(msgs)) {
        processMessages(msgs);
      }
    });

    return currentState;
  } catch (err) {
    console.error("[WhatsApp Baileys] Error starting service:", err);
    currentState.status = "disconnected";
    return currentState;
  } finally {
    globalThis.__skeloWhatsAppStarting = false;
  }
}

export async function disconnectWhatsAppService(): Promise<WhatsAppServiceState> {
  const currentState = getWhatsAppServiceState();
  try {
    if (globalThis.__skeloWhatsAppSock) {
      await globalThis.__skeloWhatsAppSock.logout().catch(() => {});
      globalThis.__skeloWhatsAppSock = null;
    }
  } catch {
    // ignore
  }

  clearWhatsAppCredentialsFromDisk();

  currentState.status = "disconnected";
  currentState.qrDataUrl = null;
  currentState.rawQr = null;
  currentState.connectedNumber = null;
  currentState.connectedName = null;
  currentState.connectedAt = null;
  globalThis.__skeloWhatsAppStarting = false;
  globalThis.__skeloWhatsAppConnectionReplaced = false;
  globalThis.__skeloWhatsAppReconnectAttempts = 0;
  globalThis.__skeloWhatsAppReconnectAt = 0;
  if (globalThis.__skeloWhatsAppReconnectTimer) {
    clearTimeout(globalThis.__skeloWhatsAppReconnectTimer);
    globalThis.__skeloWhatsAppReconnectTimer = undefined;
  }
  return currentState;
}
