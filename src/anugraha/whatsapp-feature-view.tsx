"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { logout } from "@/actions/auth";
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowRightLeftIcon,
  ArrowUpRightIcon,
  BadgeCheckIcon,
  Building2Icon,
  CalendarDaysIcon,
  CheckCheckIcon,
  CheckCircle2Icon,
  CheckIcon,
  CheckSquareIcon,
  ChevronRightIcon,
  ClockIcon,
  CopyIcon,
  ExternalLinkIcon,
  EyeIcon,
  FilterIcon,
  FlameIcon,
  HomeIcon,
  IndianRupeeIcon,
  InfoIcon,
  KeyRoundIcon,
  LayersIcon,
  LayoutGridIcon,
  LockIcon,
  LogOutIcon,
  MapPinIcon,
  MessageCircleIcon,
  MessageSquareIcon,
  PhoneIcon,
  PlusIcon,
  QrCodeIcon,
  RadioIcon,
  RefreshCwIcon,
  SearchIcon,
  SendIcon,
  SettingsIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  SmartphoneIcon,
  SparklesIcon,
  SquareIcon,
  TableIcon,
  TagIcon,
  TrendingUpIcon,
  UserCheckIcon,
  UserPlusIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { WhatsAppIcon } from "@/components/brand/whatsapp-icon";
import { Logo } from "@/components/brand/logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  DataTableCard,
  DataTableHead,
  DataTableToolbar,
} from "@/components/app/data-table";
import {
  classifyPropertyMessage,
  isWhatsAppLid,
  type PropertyIntent,
} from "./intent-classifier";
import { extractProjectName } from "./project-extractor";
import {
  type ExtractedAILead,
  type AILeadMatch,
  type LeadIntent,
} from "./openai-lead-matcher";
import { matchPropertiesByRules } from "./property-script-matcher";
import { deduplicateCapturedMessages } from "./property-deduplicator";
import { ClientPagination } from "@/components/app/pagination";
import { cn } from "@/lib/utils";
import { QRCodeSvg } from "./qr-code-svg";

function getNextHourlySlotLabel(): string {
  const now = new Date();
  const currentHour = now.getHours();

  if (currentHour < 9) {
    const slot = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0, 0);
    return slot.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  if (currentHour < 20) {
    const slot = new Date(now.getFullYear(), now.getMonth(), now.getDate(), currentHour + 1, 0, 0, 0);
    return slot.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  const tomorrow9am = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0, 0);
  return `Tomorrow, ${tomorrow9am.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

export interface WhatsAppGroupOption {
  id: string;
  name: string;
  participantCount: number;
  category: "broker_network" | "residential" | "commercial" | "direct_owners";
  lastActive: string;
  todayMessageCount: number;
}

export interface CapturedWhatsAppMessage {
  id: string;
  senderName: string;
  senderPhone: string;
  groupId: string;
  groupName: string;
  messageText: string;
  intent: PropertyIntent;
  confidence: number;
  configuration?: string;
  budgetOrPrice?: string;
  location?: string;
  tags: string[];
  timestamp: string;
  rawTimestamp?: number;
  isToday?: boolean;
  convertedToLead?: boolean;
  code?: string;
  propertyType?: string;
  dealType?: string;
  sizeDisplay?: string;
  priceNote?: string;
  projectName?: string;
  isActive?: boolean;
}

function runPotentialMatchScript(messages: CapturedWhatsAppMessage[]): AILeadMatch[] {
  // Only include active properties in the matchmaking algorithm. Inactive/checked properties are excluded.
  const activeMessages = messages.filter((message) => message.isActive !== false);
  const leads: ExtractedAILead[] = activeMessages.flatMap((message) => {
    const text = message.messageText || "";
    const demandPhrase = /\b(looking|need|require|required|requirement|want|wanted|seeking|buyer|tenant)\b/i.test(text);
    const codeIntent = message.code?.slice(0, 2).toUpperCase();
    const classifiedIntent = codeIntent === "WB"
      ? "buy"
      : codeIntent === "AS"
        ? "sell"
        : codeIntent === "AR" || codeIntent === "WR"
          ? "rent"
          : message.intent === "general"
            ? classifyPropertyMessage(text).intent
            : message.intent;

    let intent: LeadIntent;
    if (classifiedIntent === "buy") intent = "buy";
    else if (classifiedIntent === "sell") intent = "sell";
    else if (classifiedIntent === "rent") {
      intent = codeIntent === "WR" || demandPhrase ? "rent_seek" : "rent_out";
    } else if (classifiedIntent === "lease") intent = demandPhrase ? "lease_seek" : "lease_out";
    else return [];

    return [{
      id: message.id,
      timestamp: (message.rawTimestamp ?? Date.parse(message.timestamp)) || undefined,
      // Keep split listings distinct, but block matches between listings
      // extracted from the same original WhatsApp message.
      sourceMessageId: message.id
        .replace(/-list-\d+(?:-item-\d+)?$/, "")
        .replace(/-item-\d+$/, ""),
      senderName: message.senderName,
      senderPhone: message.senderPhone,
      contactPerson: message.senderName,
      contactPhone: message.senderPhone,
      groupName: message.groupName,
      intent,
      intentLabel: intent,
      side: intent === "buy" || intent === "rent_seek" || intent === "lease_seek"
        ? "demand"
        : "supply",
      propertyType: message.propertyType || message.configuration || "Property",
      configuration: message.configuration || message.sizeDisplay,
      projectName: message.projectName || extractProjectName(text),
      location: message.location,
      budgetOrPrice: message.budgetOrPrice,
      extractedSummary: text.slice(0, 180),
      rawTextSnippet: text,
    }];
  });

  return matchPropertiesByRules(leads);
}

const AVAILABLE_GROUPS: WhatsAppGroupOption[] = [
  {
    id: "120363024829102938@g.us",
    name: "Gurgaon Top Brokers Network",
    participantCount: 486,
    category: "broker_network",
    lastActive: "18m ago",
    todayMessageCount: 14,
  },
  {
    id: "120363098712345678@g.us",
    name: "DLF & Golf Course Road Resale",
    participantCount: 612,
    category: "residential",
    lastActive: "Just now",
    todayMessageCount: 22,
  },
  {
    id: "120363112233445566@g.us",
    name: "Cyber City & Sohna Commercial Lease",
    participantCount: 320,
    category: "commercial",
    lastActive: "45m ago",
    todayMessageCount: 8,
  },
  {
    id: "120363998877665544@g.us",
    name: "South Delhi Luxury Rentals & Flats",
    participantCount: 528,
    category: "residential",
    lastActive: "1h ago",
    todayMessageCount: 11,
  },
  {
    id: "120363445566778899@g.us",
    name: "Direct Owners & Investors Pool",
    participantCount: 195,
    category: "direct_owners",
    lastActive: "2h ago",
    todayMessageCount: 6,
  },
];

export function WhatsAppFeatureView({
  organisationName,
  userEmail,
}: {
  organisationName: string;
  userEmail?: string;
}) {
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = React.useState(false);

  async function handleLogout() {
    setIsLoggingOut(true);
    try {
      const result = await logout();
      if (result && !result.success) {
        toast.error(result.error || "Failed to log out");
        setIsLoggingOut(false);
      } else {
        router.push("/login");
        router.refresh();
      }
    } catch {
      router.push("/login");
      router.refresh();
    }
  }

  // Navigation view: inquiry categories, Potential Matches, Your Leads, or Settings.
  const [activeView, setActiveView] = React.useState<"feed" | "matches" | "leads" | "settings">("feed");

  // Potential Property Matches State (Calculated by Script Matcher)
  const [inspectMatch, setInspectMatch] = React.useState<AILeadMatch | null>(null);

  // Real WhatsApp Session State
  const [sessionStatus, setSessionStatus] = React.useState<
    "disconnected" | "qr_ready" | "connected"
  >("qr_ready");
  const [qrCodeDataUrl, setQrCodeDataUrl] = React.useState<string | null>(null);
  const [qrCodeRaw, setQrCodeRaw] = React.useState<string>(
    "2@skelo-whatsapp-lead-capture-session-01,WA-REF",
  );
  const [connectedNumber, setConnectedNumber] = React.useState<string | null>(null);
  const [connectedName, setConnectedName] = React.useState<string | null>(null);
  const [isRefreshingQR, setIsRefreshingQR] = React.useState(false);

  // Group Selection State (Managed inside Settings)
  const [availableGroups, setAvailableGroups] = React.useState<WhatsAppGroupOption[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = React.useState<string[]>([]);
  const [confirmedGroupIds, setConfirmedGroupIds] = React.useState<string[]>([]);
  const [groupSearchQuery, setGroupSearchQuery] = React.useState("");
  const [isLoadingGroups, setIsLoadingGroups] = React.useState(false);
  const [isEditingGroups, setIsEditingGroups] = React.useState(false);

  // Feed State
  const [messages, setMessages] = React.useState<CapturedWhatsAppMessage[]>([]);
  const [serverSearchResults, setServerSearchResults] = React.useState<{
    query: string;
    codePrefix: string;
    items: CapturedWhatsAppMessage[];
  } | null>(null);
  const searchRequestSequenceRef = React.useRef(0);
  const messagesRef = React.useRef<CapturedWhatsAppMessage[]>([]);
  const lastFetchedMessageTimestampRef = React.useRef<number | null>(null);
  const todayMessagesCount = React.useMemo(
    () => messages.filter((message) => message.isToday !== false).length,
    [messages],
  );
  const [potentialMatches, setPotentialMatches] = React.useState<AILeadMatch[]>([]);
  const [isScraping, setIsScraping] = React.useState(false);
  const [lastFetchedAt, setLastFetchedAt] = React.useState<string>(() =>
    new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
  );
  const [cycleLabel, setCycleLabel] = React.useState<string>("Hourly 9 AM–8 PM");
  const [nextBatchSlot, setNextBatchSlot] = React.useState<string>(getNextHourlySlotLabel);
  const [activeCodeFilter, setActiveCodeFilter] = React.useState<"AR" | "AS" | "WR" | "WB">("AR");
  const [activeIntentFilter, setActiveIntentFilter] = React.useState<PropertyIntent | "all">("all");
  const [selectedGroupFilter, setSelectedGroupFilter] = React.useState<string>("all");
  const [searchInput, setSearchInput] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");

  React.useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchInput);
    }, 1000);

    return () => {
      clearTimeout(handler);
    };
  }, [searchInput]);

  // Pagination states (max 20 rows per page)
  const [feedPage, setFeedPage] = React.useState(1);
  const [matchesPage, setMatchesPage] = React.useState(1);

  React.useEffect(() => {
    setFeedPage(1);
  }, [debouncedSearch, activeCodeFilter, selectedGroupFilter]);

  React.useEffect(() => {
    setMatchesPage(1);
  }, [debouncedSearch]);

  // Inspect message detail modal
  const [inspectMessage, setInspectMessage] = React.useState<CapturedWhatsAppMessage | null>(null);
  const [confirmToggleMessage, setConfirmToggleMessage] = React.useState<CapturedWhatsAppMessage | null>(null);
  const [isConvertingToLead, setIsConvertingToLead] = React.useState(false);

  // Today's Formatted Date String
  const todayLabel = React.useMemo(() => {
    return new Intl.DateTimeFormat("en-IN", {
      weekday: "long",
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date());
  }, []);

  // Check / Sync Session Status from /api/qr (Baileys Live Stream)
  const checkSessionStatus = React.useCallback(async () => {
    try {
      const res = await fetch("/api/qr");
      const json = await res.json();
      if (json.status === "connected") {
        setSessionStatus("connected");
        setQrCodeDataUrl(null);
        if (json.connectedNumber) setConnectedNumber(json.connectedNumber);
        if (json.connectedName) setConnectedName(json.connectedName);
        return "connected";
      } else if (json.qr) {
        setSessionStatus("qr_ready");
        setQrCodeDataUrl(json.qr);
        if (json.rawQr) setQrCodeRaw(json.rawQr);
        return "qr";
      } else {
        setSessionStatus("qr_ready");
        return json.status || "starting";
      }
    } catch {
      return "error";
    }
  }, []);

  // Poll /api/qr every 2.5s ONLY while waiting for phone scan; stops forever once connected
  React.useEffect(() => {
    let timer: NodeJS.Timeout;
    let isMounted = true;

    async function poll() {
      const statusResult = await checkSessionStatus();
      if (isMounted && statusResult !== "connected") {
        timer = setTimeout(poll, 2500);
      }
    }

    if (sessionStatus !== "connected") {
      poll();
    }

    return () => {
      isMounted = false;
      if (timer) clearTimeout(timer);
    };
  }, [checkSessionStatus, sessionStatus]);

  // Request fresh QR Code
  async function handleRefreshQR() {
    setIsRefreshingQR(true);
    try {
      const res = await fetch("/api/whatsapp-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request_qr" }),
      });
      const json = await res.json();
      if (json.success) {
        setSessionStatus("qr_ready");
        if (json.data && json.data.qrCodeRaw) {
          setQrCodeRaw(json.data.qrCodeRaw);
        } else {
          setQrCodeRaw("2@skelo-wa-ref-" + Date.now());
        }
        toast.success("Fresh QR code generated. Scan with WhatsApp to connect.");
      }
    } catch {
      toast.error("Failed to generate QR code.");
    } finally {
      setIsRefreshingQR(false);
    }
  }

  // Disconnect WhatsApp
  async function handleDisconnectWhatsApp() {
    try {
      const res = await fetch("/api/whatsapp-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "disconnect" }),
      });
      const json = await res.json();
      if (json.success) {
        setSessionStatus("qr_ready");
        setConnectedNumber(null);
        setConnectedName(null);
        setQrCodeDataUrl(null);
        toast.info("WhatsApp disconnected. Scan QR to reconnect.");
      }
    } catch {
      toast.error("Failed to disconnect.");
    }
  }

  // Read newly persisted messages; this endpoint owns WhatsApp ingestion and
  // is used for initial, scheduled-cache, and manual refreshes only.
  const fetchMessagesFromAPI = React.useCallback(
    async (silent = false, refreshBackend = false) => {
      try {
        if (!silent) setIsScraping(true);
        const params = new URLSearchParams({ today: "false" });
        if (!refreshBackend) params.set("cached", "true");
        if (lastFetchedMessageTimestampRef.current !== null) {
          params.set("since", String(lastFetchedMessageTimestampRef.current));
        }
        const endpoint = `/api/whatsapp-capture?${params.toString()}`;
        const res = await fetch(endpoint);
        const json = await res.json();
        if (json.success && json.data) {
          const rawItems = json.data.items || [];
          const mapped: CapturedWhatsAppMessage[] = rawItems.map(
            (item: {
              id: string;
              sender_name: string;
              sender_phone: string;
              group_id: string;
              group_name: string;
              message_text: string;
              intent: PropertyIntent;
              confidence: number;
              configuration?: string;
              budget_or_price?: string;
              location?: string;
              tags: string[];
              timestamp: string;
              raw_timestamp?: number;
              is_today?: boolean;
              code?: string;
              property_type?: string;
              deal_type?: string;
              size_display?: string;
              price_note?: string;
              project_name?: string;
              is_active?: boolean;
              convertedToLead?: boolean;
              converted_to_lead?: boolean;
            }) => ({
              id: item.id,
              senderName: item.sender_name,
              senderPhone: item.sender_phone,
              groupId: item.group_id,
              groupName: item.group_name,
              messageText: item.message_text,
              intent: item.intent,
              confidence: item.confidence,
              configuration: item.configuration,
              budgetOrPrice: item.budget_or_price,
              location: item.location,
              tags: item.tags,
              timestamp: item.timestamp,
              rawTimestamp: item.raw_timestamp,
              isToday: item.is_today,
              code: item.code,
              propertyType: item.property_type,
              dealType: item.deal_type,
              sizeDisplay: item.size_display,
              priceNote: item.price_note,
              projectName: item.project_name,
              isActive: item.is_active !== false,
              convertedToLead: item.convertedToLead === true || item.converted_to_lead === true,
            }),
          );
          const deduplicated = deduplicateCapturedMessages(mapped);

          const currentById = new Map(messagesRef.current.map((message) => [message.id, message]));
          let newCount = 0;
          for (const message of deduplicated) {
            const existing = currentById.get(message.id);
            if (!existing) newCount++;
            currentById.set(message.id, {
              ...existing,
              ...message,
              convertedToLead: message.convertedToLead || existing?.convertedToLead,
            });
          }
          const merged = deduplicateCapturedMessages([...currentById.values()]).sort(
            (a, b) => (b.rawTimestamp || 0) - (a.rawTimestamp || 0),
          );
          messagesRef.current = merged;
          setMessages(merged);
          // Recalculate matches against the complete local history while the
          // feed itself receives only the incremental API response.
          setPotentialMatches(
            runPotentialMatchScript(merged.filter((message) => message.isToday !== false && message.isActive !== false)),
          );
          if (newCount > 0) {
            toast.success(`Captured ${newCount} new WhatsApp inquiries`);
          } else if (!silent) {
            toast.info("WhatsApp inquiries feed up to date.");
          }
          const latestTimestamp = merged.reduce<number | null>(
            (latest, message) => message.rawTimestamp !== undefined
              ? Math.max(latest ?? 0, message.rawTimestamp)
              : latest,
            null,
          );
          if (latestTimestamp !== null) {
            lastFetchedMessageTimestampRef.current = latestTimestamp;
          }
          if (json.data.fetchedAt) {
            setLastFetchedAt(
              new Date(json.data.fetchedAt).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              }),
            );
          }

          if (json.data && json.data.cycleInfo) {
            if (json.data.cycleInfo.windowLabel) setCycleLabel(json.data.cycleInfo.windowLabel);
          }

          if (Array.isArray(json.data.discoveredGroups)) {
            setAvailableGroups(json.data.discoveredGroups);
            if (Array.isArray(json.data.permittedGroupIds) && json.data.permittedGroupIds.length > 0) {
              setSelectedGroupIds(json.data.permittedGroupIds);
              setConfirmedGroupIds(json.data.permittedGroupIds);
            } else if (json.data.discoveredGroups.length > 0) {
              const allIds = json.data.discoveredGroups.map((g: WhatsAppGroupOption) => g.id);
              setSelectedGroupIds(allIds);
              setConfirmedGroupIds(allIds);
            }
          }

          if (json.data.isConnected) {
            setSessionStatus("connected");
          }
        }
      } catch {
        if (!silent) toast.error("Error communicating with capture API.");
      } finally {
        if (!silent) setIsScraping(false);
      }
    },
    [],
  );

  // Search persisted rows directly. This endpoint never touches the WhatsApp
  // session, group discovery, or message ingestion route.
  const fetchDatabaseSearch = React.useCallback(async (searchQuery: string, codePrefix = "") => {
    const query = searchQuery.trim();
    if (!query) return;

    const requestSequence = ++searchRequestSequenceRef.current;
    const params = new URLSearchParams({ search: query });
    if (codePrefix) params.set("codePrefix", codePrefix);

    try {
      const response = await fetch(`/api/whatsapp-capture/search?${params.toString()}`, {
        cache: "no-store",
      });
      const json = await response.json();
      if (!response.ok || !json.success || !json.data) {
        throw new Error(json.error || "Database search failed");
      }

      const items: CapturedWhatsAppMessage[] = (json.data.items || []).map((item: {
        id: string;
        sender_name: string;
        sender_phone: string;
        group_id: string;
        group_name: string;
        message_text: string;
        intent: PropertyIntent;
        confidence: number;
        configuration?: string;
        budget_or_price?: string;
        location?: string;
        tags?: string[];
        timestamp: string;
        raw_timestamp?: number;
        is_today?: boolean;
        code?: string;
        property_type?: string;
        deal_type?: string;
        size_display?: string;
        price_note?: string;
        project_name?: string;
        is_active?: boolean;
        convertedToLead?: boolean;
        converted_to_lead?: boolean;
      }) => ({
        id: item.id,
        senderName: item.sender_name,
        senderPhone: item.sender_phone,
        groupId: item.group_id,
        groupName: item.group_name,
        messageText: item.message_text || "",
        intent: item.intent,
        confidence: item.confidence,
        configuration: item.configuration,
        budgetOrPrice: item.budget_or_price,
        location: item.location,
        tags: item.tags || [],
        timestamp: item.timestamp,
        rawTimestamp: item.raw_timestamp,
        isToday: item.is_today,
        code: item.code,
        propertyType: item.property_type,
        dealType: item.deal_type,
        sizeDisplay: item.size_display,
        priceNote: item.price_note,
        projectName: item.project_name,
        isActive: item.is_active !== false,
        convertedToLead: item.convertedToLead === true || item.converted_to_lead === true,
      }));

      if (requestSequence === searchRequestSequenceRef.current) {
        setServerSearchResults({
          query,
          codePrefix,
          items: deduplicateCapturedMessages(items),
        });
      }
    } catch (error) {
      if (requestSequence === searchRequestSequenceRef.current) {
        setServerSearchResults({ query, codePrefix, items: [] });
        toast.error(error instanceof Error ? error.message : "Database search failed");
      }
    }
  }, []);

  const handleManualFetch = React.useCallback(async () => {
    await fetchMessagesFromAPI(false, true);
    if (debouncedSearch.trim()) {
      await fetchDatabaseSearch(
        debouncedSearch,
        activeView === "feed" ? activeCodeFilter : "",
      );
    }
  }, [activeCodeFilter, activeView, debouncedSearch, fetchDatabaseSearch, fetchMessagesFromAPI]);

  const handleRefreshGroups = React.useCallback(async () => {
    setIsLoadingGroups(true);
    try {
      const res = await fetch("/api/whatsapp-capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "refresh_groups" }),
      });
      const json = await res.json();
      if (json.success && Array.isArray(json.groups)) {
        setAvailableGroups(json.groups);
        if (json.groups.length > 0) {
          toast.success(`Discovered ${json.groups.length} groups from your connected WhatsApp!`);
        } else {
          toast.info("No groups found on this WhatsApp account yet.");
        }
      } else {
        await fetchMessagesFromAPI(true);
        toast.info("Groups synced from WhatsApp.");
      }
    } catch {
      toast.error("Failed to sync groups from WhatsApp.");
    } finally {
      setIsLoadingGroups(false);
    }
  }, [fetchMessagesFromAPI]);

  // Save the permitted groups; message ingestion remains on the backend schedule.
  const savePermittedGroups = React.useCallback(
    async (groupIds: string[]) => {
      if (groupIds.length === 0) {
        toast.error("Please select at least one WhatsApp group to monitor.");
        return;
      }

      setIsScraping(true);
      try {
        const res = await fetch("/api/whatsapp-capture", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "set_permissions",
            selectedGroupIds: groupIds,
          }),
        });

        const json = await res.json();
        if (json.success) {
          setConfirmedGroupIds(groupIds);
          toast.success(`Monitoring ${groupIds.length} selected group(s). The next fetch will run at ${nextBatchSlot}.`);
          await fetchMessagesFromAPI(true, false);
        } else {
          toast.error("Failed to save WhatsApp group permissions.");
        }
      } catch {
        toast.error("Error saving WhatsApp group permissions.");
      } finally {
        setIsScraping(false);
      }
    },
    [fetchMessagesFromAPI, nextBatchSlot],
  );

  // Initial load: Fetch once on mount if connected
  React.useEffect(() => {
    if (sessionStatus === "connected") {
      fetchMessagesFromAPI(true, false);
    }
  }, [fetchMessagesFromAPI, sessionStatus]);

  // Debounce global search requests and search persisted inquiries via API.
  // Feed category tabs pass their code; Matches searches across all categories.
  React.useEffect(() => {
    if (!debouncedSearch.trim()) {
      return;
    }
    if (sessionStatus !== "connected" || activeView === "settings") return;
    fetchDatabaseSearch(
      debouncedSearch,
      activeView === "feed" ? activeCodeFilter : "",
    );
  }, [activeCodeFilter, activeView, debouncedSearch, fetchDatabaseSearch, sessionStatus]);

  // Keep the displayed next-run time current
  React.useEffect(() => {
    const updateNextSlot = () => {
      setNextBatchSlot(getNextHourlySlotLabel());
    };
    updateNextSlot();
    const displayTimer = setInterval(updateNextSlot, 30 * 1000);
    return () => clearInterval(displayTimer);
  }, []);

  // Refresh the persisted feed periodically; WhatsApp ingestion itself is
  // handled by the hourly backend cron, so avoid a database read every minute.
  React.useEffect(() => {
    if (sessionStatus !== "connected" || activeView === "settings") return;
    const cachePoll = setInterval(() => {
      if (debouncedSearch.trim()) {
        fetchDatabaseSearch(debouncedSearch, activeView === "feed" ? activeCodeFilter : "");
      } else {
        fetchMessagesFromAPI(true, false);
      }
    }, 5 * 60 * 1000);
    return () => clearInterval(cachePoll);
  }, [activeCodeFilter, activeView, debouncedSearch, fetchDatabaseSearch, fetchMessagesFromAPI, sessionStatus]);

  // Sync fresh groups from connected WhatsApp when opening Settings
  React.useEffect(() => {
    if (activeView === "settings" && sessionStatus === "connected") {
      fetchMessagesFromAPI(true);
    }
  }, [activeView, fetchMessagesFromAPI, sessionStatus]);

  // Group selection helpers
  function toggleGroupSelection(groupId: string) {
    setSelectedGroupIds((prev) =>
      prev.includes(groupId)
        ? prev.filter((id) => id !== groupId)
        : [...prev, groupId],
    );
  }

  function selectAllGroups() {
    setSelectedGroupIds(availableGroups.map((g) => g.id));
  }

  function deselectAllGroups() {
    setSelectedGroupIds([]);
  }

  function handleStartEditGroups() {
    setIsEditingGroups(true);
    setSelectedGroupIds([...confirmedGroupIds]);
    if (availableGroups.length === 0) {
      handleRefreshGroups();
    }
  }

  function handleSavePermissions() {
    if (selectedGroupIds.length === 0) {
      toast.error("Please select at least 1 WhatsApp group to monitor.");
      return;
    }
    savePermittedGroups(selectedGroupIds);
    setIsEditingGroups(false);
  }

  // Filter messages
  const filteredMessages = React.useMemo(() => {
    const query = debouncedSearch.trim();
    const expectedSearchCodePrefix = activeView === "feed" ? activeCodeFilter : "";
    const hasCurrentServerResults = Boolean(
      query &&
      serverSearchResults?.query === query &&
      serverSearchResults.codePrefix === expectedSearchCodePrefix,
    );
    const sourceMessages = query
      ? hasCurrentServerResults ? serverSearchResults?.items ?? [] : []
      : messages;

    return sourceMessages.filter((m) => {
      if (activeView === "leads") {
        if (!m.convertedToLead) return false;
      } else {
        if (m.convertedToLead) return false;
        if (activeView === "feed" && !m.code?.startsWith(activeCodeFilter)) return false;
      }
      if (
        selectedGroupFilter !== "all" &&
        m.groupId !== selectedGroupFilter &&
        m.groupId.replace(/:.*@/, "@") !== selectedGroupFilter.replace(/:.*@/, "@")
      ) {
        return false;
      }
      if (!query) return true;
      const q = query.toLowerCase();
      return (
        (m.projectName && m.projectName.toLowerCase().includes(q)) ||
        m.messageText.toLowerCase().includes(q) ||
        m.senderName.toLowerCase().includes(q) ||
        m.senderPhone.toLowerCase().includes(q) ||
        m.groupName.toLowerCase().includes(q) ||
        (m.location && m.location.toLowerCase().includes(q)) ||
        (m.configuration && m.configuration.toLowerCase().includes(q)) ||
        (m.budgetOrPrice && m.budgetOrPrice.toLowerCase().includes(q)) ||
        (m.sizeDisplay && m.sizeDisplay.toLowerCase().includes(q)) ||
        (m.propertyType && m.propertyType.toLowerCase().includes(q)) ||
        (m.dealType && m.dealType.toLowerCase().includes(q)) ||
        m.tags.some((tag) => tag.toLowerCase().includes(q)) ||
        (m.code && m.code.toLowerCase().includes(q))
      );
    });
  }, [messages, activeCodeFilter, activeView, selectedGroupFilter, debouncedSearch, serverSearchResults]);

  // Intent breakdown counts
  const intentCounts = React.useMemo(() => {
    const counts = {
      all: messages.length,
      buy: 0,
      rent: 0,
      sell: 0,
      lease: 0,
      general: 0,
    };
    for (const m of messages) {
      if (m.intent === "buy" || m.code?.startsWith("WB")) counts.buy++;
      else if (m.intent === "sell" || m.code?.startsWith("AS")) counts.sell++;
      else if (m.intent === "rent" || m.code?.startsWith("AR") || m.code?.startsWith("WR")) counts.rent++;
      else if (m.intent === "lease") counts.lease++;
      else counts.general++;
    }
    return counts;
  }, [messages]);

  const codeCounts = React.useMemo(() => ({
    AR: messages.filter((message) => !message.convertedToLead && message.code?.startsWith("AR")).length,
    AS: messages.filter((message) => !message.convertedToLead && message.code?.startsWith("AS")).length,
    WR: messages.filter((message) => !message.convertedToLead && message.code?.startsWith("WR")).length,
    WB: messages.filter((message) => !message.convertedToLead && message.code?.startsWith("WB")).length,
  }), [messages]);
  const convertedLeadCount = React.useMemo(
    () => messages.filter((message) => message.convertedToLead).length,
    [messages],
  );

  // Convert to Lead
  async function handleConvertToLead(msg: CapturedWhatsAppMessage) {
    setIsConvertingToLead(true);
    try {
      const response = await fetch("/api/whatsapp-capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "convert_to_lead", messageId: msg.id }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Failed to move inquiry to Your Leads");
      }

      setMessages((previous) => {
        const updated = previous.map((message) =>
          message.id === msg.id ? { ...message, convertedToLead: true } : message,
        );
        messagesRef.current = updated;
        return updated;
      });
      setInspectMessage(null);
      setActiveView("leads");
      toast.success(`${msg.senderName} was moved to Your Leads.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to move inquiry to Your Leads.");
    } finally {
      setIsConvertingToLead(false);
    }
  }

  // Toggle Property Active / Inactive status (Checked)
  async function handleToggleActive(msg: CapturedWhatsAppMessage) {
    const nextActive = !(msg.isActive !== false);

    // Optimistic UI state update
    setMessages((prev) => {
      const updated = prev.map((m) => (m.id === msg.id ? { ...m, isActive: nextActive } : m));
      messagesRef.current = updated;
      // Re-run potential matchmaking excluding inactive properties
      setPotentialMatches(
        runPotentialMatchScript(updated.filter((m) => m.isToday !== false && m.isActive !== false)),
      );
      return updated;
    });

    if (inspectMessage && inspectMessage.id === msg.id) {
      setInspectMessage((prev) => (prev ? { ...prev, isActive: nextActive } : null));
    }

    try {
      const res = await fetch("/api/whatsapp-capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "toggle_active",
          messageId: msg.id,
          isActive: nextActive,
        }),
      });
      const json = await res.json();
      if (json.success) {
        if (!nextActive) {
          toast.success("Property marked as Checked & Inactive (excluded from potential matches).");
        } else {
          toast.success("Property reactivated (included in potential matches).");
        }
      } else {
        toast.error(json.error || "Failed to update property status.");
      }
    } catch {
      toast.error("Network error updating property status.");
    }
  }

  // Filtered Potential Matches for the table
  const filteredMatches = React.useMemo(() => {
    if (!debouncedSearch.trim()) return potentialMatches;
    const q = debouncedSearch.toLowerCase().trim();
    const backendSearchIds = new Set(
      serverSearchResults?.query === debouncedSearch.trim() && !serverSearchResults.codePrefix
        ? serverSearchResults.items.map((message) => message.id)
        : [],
    );
    return potentialMatches.filter((match) => {
      return (
        backendSearchIds.has(match.demandLeadId) ||
        backendSearchIds.has(match.supplyLeadId) ||
        (match.demandProject && match.demandProject.toLowerCase().includes(q)) ||
        (match.supplyProject && match.supplyProject.toLowerCase().includes(q)) ||
        (match.demandBudget && match.demandBudget.toLowerCase().includes(q)) ||
        (match.supplyPrice && match.supplyPrice.toLowerCase().includes(q)) ||
        (match.demandConfig && match.demandConfig.toLowerCase().includes(q)) ||
        (match.supplyConfig && match.supplyConfig.toLowerCase().includes(q)) ||
        match.demandContact.name.toLowerCase().includes(q) ||
        match.demandContact.phone.toLowerCase().includes(q) ||
        (match.demandContact.location && match.demandContact.location.toLowerCase().includes(q)) ||
        match.supplyContact.name.toLowerCase().includes(q) ||
        match.supplyContact.phone.toLowerCase().includes(q) ||
        (match.supplyContact.location && match.supplyContact.location.toLowerCase().includes(q)) ||
        match.demandLeadSummary.toLowerCase().includes(q) ||
        match.supplyLeadSummary.toLowerCase().includes(q) ||
        match.matchReason.toLowerCase().includes(q)
      );
    });
  }, [potentialMatches, debouncedSearch, serverSearchResults]);

  const PAGE_SIZE = 20;

  const paginatedMessages = React.useMemo(() => {
    const totalPages = Math.max(1, Math.ceil(filteredMessages.length / PAGE_SIZE));
    const safePage = Math.max(1, Math.min(feedPage, totalPages));
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredMessages.slice(start, start + PAGE_SIZE);
  }, [filteredMessages, feedPage]);

  const paginatedMatches = React.useMemo(() => {
    const totalPages = Math.max(1, Math.ceil(filteredMatches.length / PAGE_SIZE));
    const safePage = Math.max(1, Math.min(matchesPage, totalPages));
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredMatches.slice(start, start + PAGE_SIZE);
  }, [filteredMatches, matchesPage]);

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    toast.success("Message copied to clipboard!");
  }

  // Filter groups in settings search
  const filteredAvailableGroups = React.useMemo(() => {
    if (!groupSearchQuery.trim()) return availableGroups;
    const q = groupSearchQuery.toLowerCase();
    return availableGroups.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        g.category.toLowerCase().includes(q),
    );
  }, [availableGroups, groupSearchQuery]);

  // Partition groups: selected ones above, unselected after that
  const sortedAvailableGroups = React.useMemo(() => {
    const selected = filteredAvailableGroups.filter((g) =>
      selectedGroupIds.includes(g.id),
    );
    const unselected = filteredAvailableGroups.filter(
      (g) => !selectedGroupIds.includes(g.id),
    );
    return { selected, unselected };
  }, [filteredAvailableGroups, selectedGroupIds]);

  // Confirmed groups for overview
  const confirmedGroupsList = React.useMemo(() => {
    return availableGroups.filter((g) => confirmedGroupIds.includes(g.id));
  }, [availableGroups, confirmedGroupIds]);

  // ===========================================================================
  // STEP 1: SCAN WHATSAPP SCREEN (Rendered if not connected)
  // ===========================================================================
  if (sessionStatus !== "connected") {
    return (
      <div className="max-w-4xl mx-auto space-y-8 py-8 animate-in fade-in-50 duration-300">
        <div className="flex items-center justify-between border-b border-border/70 pb-4">
          <Logo href="" />
          <Button
            variant="outline"
            size="sm"
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="h-8 px-3 text-xs gap-1.5 text-muted-foreground hover:text-destructive hover:border-destructive/40 hover:bg-destructive/10 border-border/70 transition-colors shadow-2xs cursor-pointer"
            title="Log out of Skelo"
          >
            <LogOutIcon className="h-3.5 w-3.5" />
            <span>{isLoggingOut ? "Logging out..." : "Log out"}</span>
          </Button>
        </div>

        {/* Title */}
        <div className="text-center space-y-2">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/20 mb-1">
            <WhatsAppIcon className="h-6 w-6" />
          </div>
          <div className="flex items-center justify-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 font-bold text-xs">
              1
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-foreground font-heading">
              Step 1: Scan WhatsApp to Connect
            </h1>
          </div>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            To start scraping real estate group messages, link your WhatsApp account by scanning the QR code below.
          </p>
        </div>

        {/* Main Connect Card */}
        <Card className="border border-border/80 shadow-md overflow-hidden bg-card">
          <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border/60">
            {/* Left: Live QR Code Display */}
            <div className="p-8 flex flex-col items-center justify-center bg-muted/10 text-center space-y-5">
              <div className="relative p-3 bg-white rounded-2xl border-2 border-dashed border-emerald-500/40 shadow-inner flex items-center justify-center">
                {qrCodeDataUrl ? (
                  <img
                    src={qrCodeDataUrl}
                    alt="Scan WhatsApp QR Code"
                    className="w-56 h-56 rounded-lg object-contain"
                  />
                ) : (
                  <QRCodeSvg
                    value={qrCodeRaw || "2@skelo-whatsapp-lead-capture-session-01,WA-REF"}
                    size={216}
                  />
                )}

                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="bg-white p-2 rounded-full shadow-md border border-border/40">
                    <WhatsAppIcon className="h-6 w-6 text-emerald-600" />
                  </div>
                </div>
              </div>

              {/* Status indicator */}
              <div className="space-y-1">
                <div className="inline-flex items-center gap-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
                  <span>Waiting for scan from your phone...</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  The code refreshes automatically when scanned
                </p>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRefreshQR}
                  disabled={isRefreshingQR}
                  className="gap-1.5 text-xs h-8"
                >
                  <RefreshCwIcon className={cn("h-3.5 w-3.5", isRefreshingQR && "animate-spin")} />
                  <span>Refresh Code</span>
                </Button>
              </div>
            </div>

            {/* Right: Step-by-Step Instructions */}
            <div className="p-8 flex flex-col justify-between space-y-6">
              <div className="space-y-4">
                <h3 className="font-semibold text-sm text-foreground uppercase tracking-wider">
                  How to link your phone:
                </h3>

                <div className="space-y-3.5 text-xs text-foreground/90">
                  <div className="flex items-start gap-3">
                    <span className="flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 font-bold text-xs">
                      1
                    </span>
                    <div>
                      <p className="font-semibold text-foreground">Open WhatsApp on your phone</p>
                      <p className="text-muted-foreground mt-0.5">
                        Works with personal WhatsApp or WhatsApp Business accounts.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <span className="flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 font-bold text-xs">
                      2
                    </span>
                    <div>
                      <p className="font-semibold text-foreground">Go to Linked Devices</p>
                      <p className="text-muted-foreground mt-0.5">
                        <strong>Android:</strong> Tap the 3 dots (⋮) in the top right → <strong>Linked Devices</strong>.<br />
                        <strong>iPhone:</strong> Tap <strong>Settings</strong> in bottom right → <strong>Linked Devices</strong>.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <span className="flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 font-bold text-xs">
                      3
                    </span>
                    <div>
                      <p className="font-semibold text-foreground">Tap &ldquo;Link a Device&rdquo; and scan</p>
                      <p className="text-muted-foreground mt-0.5">
                        Point your camera at the QR code on the left. The session connects instantly.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Safety badge */}
              <div className="p-3.5 rounded-xl bg-muted/40 border border-border/70 text-xs text-muted-foreground space-y-1">
                <div className="flex items-center gap-1.5 font-medium text-foreground">
                  <ShieldCheckIcon className="h-4 w-4 text-emerald-600" />
                  <span>100% Read-Only Safety Protocol</span>
                </div>
                <p className="text-[11px] leading-relaxed">
                  Skelo only listens to incoming inquiries from groups you select in Step 2. It will never send outbound messages or modify your chats.
                </p>
              </div>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  // ===========================================================================
  // MAIN VIEW: ONCE CONNECTED (TABLE & SETTINGS)
  // ===========================================================================
  return (
    <div className="-mx-4 -mt-6 space-y-0 pb-16 md:-mx-8 md:-mt-8">
      <header className="bg-[#002f32] text-white shadow-sm">
        <div className="flex min-h-[76px] items-center justify-between gap-4 border-b border-white/10 px-4 py-3 md:px-8">
          <div className="flex min-w-0 items-center gap-4 md:gap-6">
            <Logo href="" tone="sidebar" className="shrink-0" />
            <span className="rounded-full bg-gradient-to-r from-[#dcff37] to-[#8af0bc] px-4 py-2 text-[11px] font-black tracking-[0.12em] text-[#002f32] sm:text-xs">
              WHATSAPP LEAD MATCHER
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3 md:gap-4">
            <span className="hidden items-center gap-2 text-sm text-white/75 sm:flex" title={userEmail}>
              <span className="size-2.5 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(74,222,128,0.65)]" />
              Listening to {confirmedGroupIds.length} groups
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleManualFetch}
              disabled={isScraping}
              className="h-8.5 gap-1.5 rounded-lg border-white/20 bg-white/10 px-3 text-xs font-semibold text-white shadow-2xs transition-colors hover:bg-white/20 hover:text-white disabled:opacity-50"
              title="Manually fetch today's WhatsApp inquiries"
            >
              <RefreshCwIcon className={cn("size-3.5 shrink-0", isScraping && "animate-spin")} />
              <span>{isScraping ? "Fetching..." : "Fetch Today's Inquiries"}</span>
            </Button>
            <button
              onClick={() => {
                setSelectedGroupIds([...confirmedGroupIds]);
                setActiveView("settings");
              }}
              className={cn("rounded-lg p-2 transition-colors hover:bg-white/10", activeView === "settings" && "bg-white/10 text-lime-300")}
              aria-label="Settings"
              title="Settings"
            >
              <SettingsIcon className="size-5" />
            </button>
            <button
              onClick={handleLogout}
              disabled={isLoggingOut}
              className="rounded-lg p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
              aria-label={isLoggingOut ? "Logging out" : "Log out"}
              title="Log out of Skelo"
            >
              <LogOutIcon className="size-5" />
            </button>
          </div>
        </div>
        <nav className="no-scrollbar flex flex-wrap items-end gap-1 px-4 pt-1 md:px-8" aria-label="Inquiry categories">
          {([
            { code: "AR", title: "Available for rent", count: codeCounts.AR },
            { code: "AS", title: "Available for sale", count: codeCounts.AS },
            { code: "WR", title: "Wants to rent", count: codeCounts.WR },
            { code: "WB", title: "Wants to buy", count: codeCounts.WB },
          ] as const).map((tab) => {
            const selected = activeView === "feed" && activeCodeFilter === tab.code;
            return (
              <button
                key={tab.code}
                onClick={() => {
                  setActiveCodeFilter(tab.code);
                  setActiveView("feed");
                }}
                className={cn(
                  "flex shrink-0 items-center gap-2.5 rounded-t-xl px-4 py-3 text-sm transition-colors md:px-5",
                  selected ? "bg-[#fbfcfa] text-[#00363a]" : "text-white/65 hover:bg-white/5 hover:text-white",
                )}
              >
                <span className="font-black tracking-wide">{tab.code}</span>
                <span className="hidden md:inline">{tab.title}</span>
                <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold", selected ? "bg-[#e0ff38] text-[#00363a]" : "bg-white/10 text-white/70")}>
                  {tab.count}
                </span>
              </button>
            );
          })}
          <button
            onClick={() => setActiveView("matches")}
            className={cn(
              "flex shrink-0 items-center gap-2.5 rounded-t-xl px-4 py-3 text-sm transition-colors md:px-5",
              activeView === "matches" ? "bg-[#fbfcfa] text-[#00363a]" : "text-white/65 hover:bg-white/5 hover:text-white",
            )}
          >
            <span className="font-black tracking-wide">MATCHED</span>
            <span className="hidden md:inline">Matches</span>
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold", activeView === "matches" ? "bg-[#e0ff38] text-[#00363a]" : "bg-white/10 text-white/70")}>
              {potentialMatches.length}
            </span>
          </button>
          <button
            onClick={() => setActiveView("leads")}
            className={cn(
              "flex shrink-0 items-center gap-2.5 rounded-t-xl px-4 py-3 text-sm transition-colors md:px-5",
              activeView === "leads" ? "bg-[#fbfcfa] text-[#00363a]" : "text-white/65 hover:bg-white/5 hover:text-white",
            )}
          >
            <span className="font-black tracking-wide">LEADS</span>
            <span className="hidden md:inline">Your Leads</span>
            <span className={cn(
              "rounded-full px-2 py-0.5 text-xs font-bold",
              activeView === "leads" ? "bg-[#e0ff38] text-[#00363a]" : "bg-white/10 text-white/70",
            )}>
              {convertedLeadCount}
            </span>
          </button>
          {activeView !== "settings" && (
            <div className="relative ml-auto flex w-full shrink-0 items-center py-2 sm:w-[min(24rem,40vw)] sm:pl-3">
              <SearchIcon className="pointer-events-none absolute left-6 top-1/2 h-4 w-4 -translate-y-1/2 text-[#789497]" />
              <Input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search property, contact, locality, or BHK..."
                aria-label="Search inquiries and matches"
                className="h-10 rounded-xl border-[#dce7e6] bg-white pl-10 pr-9 text-sm text-[#12383b] shadow-none placeholder:text-[#789497] focus-visible:ring-[#85dbaa]"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchInput("");
                    setDebouncedSearch("");
                  }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-[#789497] transition-colors hover:bg-[#eef5f2] hover:text-[#12383b]"
                  aria-label="Clear search"
                >
                  <XIcon className="h-4 w-4" />
                </button>
              )}
            </div>
          )}
        </nav>
      </header>

      {/* ========================================================================= */}
      {/* VIEW A: SETTINGS VIEW (Choose Groups, Manage WhatsApp Connection)          */}
      {/* ========================================================================= */}
      {activeView === "settings" && (
        <div className="space-y-6 bg-[#fbfcfa] px-4 py-7 md:px-8 animate-in fade-in-50 duration-200">
          <div className="flex items-center justify-between pb-2">
            <div>
              <h2 className="text-base font-semibold text-foreground font-heading">
                WhatsApp Capture Settings
              </h2>
              <p className="text-xs text-muted-foreground">
                Configure your linked WhatsApp account and choose the groups Skelo is permitted to scrape.
              </p>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setActiveView("feed")}
              className="gap-1.5 text-xs h-8 shadow-2xs"
            >
              <ArrowLeftIcon className="h-3.5 w-3.5" />
              <span>Back to Inquiries Table</span>
            </Button>
          </div>

          {/* 1. Connection Card */}
          <Card className="border-border/70 shadow-2xs">
            <CardHeader className="py-4 px-5 border-b border-border/60 bg-muted/20">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <SmartphoneIcon className="h-4 w-4 text-emerald-600" />
                  <CardTitle className="text-sm font-semibold">
                    Linked WhatsApp Account
                  </CardTitle>
                </div>
                <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300 gap-1 text-[11px] font-medium">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Connected
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-foreground">
                    {connectedNumber || "Connected Account"}
                  </span>
                  <span className="text-xs text-muted-foreground">• {connectedName || "Active WhatsApp Session"}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Read-only listener. Messages never trigger outbound replies or modifications on your account.
                </p>
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={handleDisconnectWhatsApp}
                className="text-xs h-8 gap-1.5 shrink-0 text-destructive hover:bg-destructive/10 border-destructive/30"
              >
                <LogOutIcon className="h-3.5 w-3.5" />
                <span>Disconnect / Re-scan QR</span>
              </Button>
            </CardContent>
          </Card>

          {/* 2. Group Permission & Selection Card */}
          <Card className="border-border/70 shadow-2xs overflow-hidden">
            <CardHeader className="py-4 px-5 border-b border-border/60 bg-muted/20">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <ShieldCheckIcon className="h-4 w-4 text-emerald-600" />
                    <CardTitle className="text-sm font-semibold">
                      {isEditingGroups
                        ? "Edit WhatsApp Groups to Scrape"
                        : "Permitted WhatsApp Groups for Lead Scraping"}
                    </CardTitle>
                  </div>
                  <CardDescription className="text-xs mt-0.5">
                    {isEditingGroups
                      ? "Select the groups you want Skelo to monitor. Selected groups appear above the rest."
                      : "Skelo strictly respects customer permission. Only incoming inquiries from permitted groups below are scraped into your feed."}
                  </CardDescription>
                </div>

                {isEditingGroups ? (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRefreshGroups}
                      disabled={isLoadingGroups}
                      className="h-8 text-xs gap-1.5 border-border/80"
                    >
                      <RefreshCwIcon className={cn("h-3.5 w-3.5", isLoadingGroups && "animate-spin")} />
                      <span>Sync Groups</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={selectAllGroups}
                      className="h-8 text-xs gap-1 text-muted-foreground hover:text-foreground"
                    >
                      <CheckSquareIcon className="h-3.5 w-3.5" />
                      Select All
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={deselectAllGroups}
                      className="h-8 text-xs gap-1 text-muted-foreground hover:text-foreground"
                    >
                      <SquareIcon className="h-3.5 w-3.5" />
                      Deselect All
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    onClick={handleStartEditGroups}
                    className="h-8 text-xs gap-1.5 bg-foreground text-background hover:bg-foreground/90 shadow-2xs"
                  >
                    <SlidersHorizontalIcon className="h-3.5 w-3.5" />
                    <span>Edit Groups ({confirmedGroupIds.length})</span>
                  </Button>
                )}
              </div>
            </CardHeader>

            <CardContent className="p-5 space-y-4">
              {!isEditingGroups ? (
                /* SUMMARY MODE */
                <div>
                  {confirmedGroupsList.length === 0 ? (
                    <div className="p-8 text-center space-y-3 bg-muted/15 rounded-xl border border-dashed border-border/70 my-2">
                      <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 mx-auto">
                        <UsersIcon className="h-5 w-5" />
                      </div>
                      <p className="text-sm font-semibold text-foreground">
                        No Groups Currently Selected
                      </p>
                      <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                        This is a monthly configuration step. Click &ldquo;Edit Groups&rdquo; to choose which WhatsApp groups Skelo is allowed to monitor.
                      </p>
                      <Button
                        size="sm"
                        onClick={handleStartEditGroups}
                        className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 shadow-2xs"
                      >
                        <SlidersHorizontalIcon className="h-3.5 w-3.5" />
                        <span>Edit Groups</span>
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-80 overflow-y-auto pr-1">
                        {confirmedGroupsList.map((group) => (
                          <div
                            key={group.id}
                            className="flex items-start gap-3 p-3.5 rounded-xl border border-emerald-500/40 bg-emerald-50/30 dark:bg-emerald-950/20 dark:border-emerald-700/40 shadow-2xs"
                          >
                            <div className="pt-0.5 text-emerald-600">
                              <CheckCircle2Icon className="h-4 w-4" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold truncate text-foreground">
                                {group.name}
                              </p>
                              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1">
                                  <UsersIcon className="h-3 w-3" />
                                  {group.participantCount} members
                                </span>
                                <span>•</span>
                                <span className="capitalize">{group.category.replace("_", " ")}</span>
                              </div>
                            </div>
                            <Badge
                              variant="outline"
                              className="text-[10px] bg-background text-emerald-700 border-emerald-300 dark:text-emerald-400 shrink-0 font-medium"
                            >
                              Active
                            </Badge>
                          </div>
                        ))}
                      </div>

                      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-border/70 text-xs text-muted-foreground">
                        <span>
                          Skelo is actively scraping from <strong>{confirmedGroupsList.length}</strong> permitted group(s).
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleStartEditGroups}
                          className="text-xs h-8 gap-1.5 border-border/80"
                        >
                          <SlidersHorizontalIcon className="h-3.5 w-3.5" />
                          <span>Change Permitted Groups</span>
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* EDIT MODE */
                <div className="space-y-4">
                  <div className="relative w-full">
                    <SearchIcon className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Filter groups by name or category..."
                      value={groupSearchQuery}
                      onChange={(e) => setGroupSearchQuery(e.target.value)}
                      className="pl-9 h-9 text-xs bg-background"
                    />
                  </div>

                  {filteredAvailableGroups.length === 0 ? (
                    <div className="p-8 text-center space-y-3 bg-muted/15 rounded-xl border border-dashed border-border/70 my-2">
                      <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 mx-auto">
                        <UsersIcon className="h-5 w-5" />
                      </div>
                      <p className="text-sm font-semibold text-foreground">
                        No WhatsApp Groups Found
                      </p>
                      <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                        {groupSearchQuery
                          ? "No groups match your search filter."
                          : `Syncing participating groups from your connected WhatsApp (${connectedNumber || "Account"}). Click below to load them.`}
                      </p>
                      {!groupSearchQuery && (
                        <Button
                          size="sm"
                          variant="default"
                          onClick={handleRefreshGroups}
                          disabled={isLoadingGroups}
                          className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 shadow-2xs"
                        >
                          <RefreshCwIcon className={cn("h-3.5 w-3.5", isLoadingGroups && "animate-spin")} />
                          <span>Sync Groups from WhatsApp</span>
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-4 max-h-96 overflow-y-auto pr-1">
                      {/* 1. SELECTED GROUPS (SHOWN ABOVE) */}
                      {sortedAvailableGroups.selected.length > 0 && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                            <BadgeCheckIcon className="h-3.5 w-3.5" />
                            <span>Selected for Scraping ({sortedAvailableGroups.selected.length})</span>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {sortedAvailableGroups.selected.map((group) => (
                              <div
                                key={group.id}
                                onClick={() => toggleGroupSelection(group.id)}
                                className="flex items-start gap-3.5 p-3.5 rounded-xl border cursor-pointer transition-all bg-emerald-50/50 border-emerald-500/60 dark:bg-emerald-950/25 dark:border-emerald-700/60 shadow-2xs"
                              >
                                <div className="pt-0.5">
                                  <input
                                    type="checkbox"
                                    checked={true}
                                    onChange={() => {}}
                                    className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                                  />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-semibold truncate text-foreground">
                                    {group.name}
                                  </p>
                                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                                    <span className="flex items-center gap-1">
                                      <UsersIcon className="h-3 w-3" />
                                      {group.participantCount} members
                                    </span>
                                    <span>•</span>
                                    <span className="capitalize">{group.category.replace("_", " ")}</span>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 2. OTHER AVAILABLE GROUPS (SHOWN AFTER THAT) */}
                      {sortedAvailableGroups.unselected.length > 0 && (
                        <div className="space-y-2 pt-2">
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                            <span>Other Available Groups ({sortedAvailableGroups.unselected.length})</span>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {sortedAvailableGroups.unselected.map((group) => (
                              <div
                                key={group.id}
                                onClick={() => toggleGroupSelection(group.id)}
                                className="flex items-start gap-3.5 p-3.5 rounded-xl border cursor-pointer transition-all bg-muted/10 border-border/80 hover:border-muted-foreground/30"
                              >
                                <div className="pt-0.5">
                                  <input
                                    type="checkbox"
                                    checked={false}
                                    onChange={() => {}}
                                    className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                                  />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium truncate text-foreground">
                                    {group.name}
                                  </p>
                                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                                    <span className="flex items-center gap-1">
                                      <UsersIcon className="h-3 w-3" />
                                      {group.participantCount} members
                                    </span>
                                    <span>•</span>
                                    <span className="capitalize">{group.category.replace("_", " ")}</span>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-border/70">
                    <div className="text-xs text-muted-foreground">
                      <strong>{selectedGroupIds.length}</strong> of {availableGroups.length} groups selected for scraping
                    </div>

                    <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedGroupIds([...confirmedGroupIds]);
                          setIsEditingGroups(false);
                        }}
                        className="text-xs h-9"
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleSavePermissions}
                        disabled={isScraping || selectedGroupIds.length === 0}
                        className="text-xs h-9 bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 shadow-2xs"
                      >
                        <CheckCheckIcon className="h-3.5 w-3.5" />
                        <span>Save Groups ({selectedGroupIds.length})</span>
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 3. Daily Fetch Schedule & Cadence Card */}
          <Card className="border-border/70 shadow-2xs">
            <CardHeader className="py-4 px-5 border-b border-border/60 bg-muted/20">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CalendarDaysIcon className="h-4 w-4 text-blue-600" />
                  <CardTitle className="text-sm font-semibold">
                    Hourly Fetch Schedule
                  </CardTitle>
                </div>
                <Badge variant="outline" className="border-blue-500/30 text-blue-600 bg-blue-50/50 text-[11px]">
                  Hourly · 9:00 AM–10:00 PM
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-5 text-xs text-muted-foreground space-y-2.5">
              <div className="flex items-center justify-between py-1 border-b border-border/40">
                <span className="font-medium text-foreground">Scrape Cadence:</span>
                <span className="text-foreground">Every hour from 9:00 AM through 10:00 PM, in your local time</span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-border/40">
                <span className="font-medium text-foreground">Daily Cycle Scope:</span>
                <span className="text-foreground">Today&apos;s inquiries from permitted WhatsApp groups</span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-border/40">
                <span className="font-medium text-foreground">Current Active Cycle:</span>
                <span className="font-mono text-foreground font-medium">{cycleLabel}</span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-border/40">
                <span className="font-medium text-foreground">Next Scheduled Auto-Batch:</span>
                <span className="text-foreground font-medium">{nextBatchSlot}</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="font-medium text-foreground">Account Safety & Rate Limits:</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-medium">Automatic fetches run hourly from 9:00 AM to 10:00 PM; Fetch Today&apos;s Inquiries runs immediately</span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW B: INQUIRIES FEED (TABLE VIEW AS DEFAULT)                            */}
      {/* ========================================================================= */}
      {(activeView === "feed" || activeView === "leads") && (
        <div className="space-y-6 bg-[#fbfcfa] px-4 py-7 md:px-8 animate-in fade-in-50 duration-200">
          {/* 2. STATS & METRICS RIBBON */}
          <div className="hidden grid-cols-2 md:grid-cols-4 gap-3.5">
            <Card className="p-4 border-border/70 shadow-2xs bg-card/60 backdrop-blur-xs">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-[11px] font-medium uppercase tracking-wider">
                  Today&apos;s Inquiries
                </span>
                <MessageSquareIcon className="h-4 w-4 text-blue-500" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold tracking-tight text-foreground font-heading">
                  {todayMessagesCount}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  inquiries captured
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground truncate" title={`Hourly from 9:00 AM to 8:00 PM • Next fetch at ${nextBatchSlot}`}>
                Hourly 9 AM–8 PM • Next: {nextBatchSlot}
              </p>
            </Card>

            <Card className="p-4 border-border/70 shadow-2xs bg-card/60 backdrop-blur-xs">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-[11px] font-medium uppercase tracking-wider">
                  Permitted Groups
                </span>
                <ShieldCheckIcon className="h-4 w-4 text-emerald-500" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold tracking-tight text-foreground font-heading">
                  {confirmedGroupIds.length}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  of {availableGroups.length} permitted
                </span>
              </div>
              <button
                onClick={() => {
                  setSelectedGroupIds([...confirmedGroupIds]);
                  setActiveView("settings");
                }}
                className="mt-1 text-[11px] font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 flex items-center gap-1"
              >
                <span>Edit in Settings</span>
                <ChevronRightIcon className="h-3 w-3" />
              </button>
            </Card>

            <Card className="p-4 border-border/70 shadow-2xs bg-card/60 backdrop-blur-xs">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-[11px] font-medium uppercase tracking-wider">
                  Lead Conversion
                </span>
                <UserCheckIcon className="h-4 w-4 text-purple-500" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold tracking-tight text-foreground font-heading">
                  {messages.filter((m) => m.convertedToLead).length}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  converted to CRM
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground truncate">
                {messages.length - messages.filter((m) => m.convertedToLead).length} pending review
              </p>
            </Card>

            <Card className="p-4 border-border/70 shadow-2xs bg-card/60 backdrop-blur-xs">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-[11px] font-medium uppercase tracking-wider">
                  Intent Breakdown
                </span>
                <TrendingUpIcon className="h-4 w-4 text-amber-500" />
              </div>
              <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-semibold text-blue-600 bg-blue-50 dark:bg-blue-950/40 px-1.5 py-0.5 rounded-sm">
                  Buy: {intentCounts.buy}
                </span>
                <span className="text-xs font-semibold text-purple-600 bg-purple-50 dark:bg-purple-950/40 px-1.5 py-0.5 rounded-sm">
                  Rent: {intentCounts.rent}
                </span>
                <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded-sm">
                  Sell: {intentCounts.sell}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Lease: {intentCounts.lease} inquiries
              </p>
            </Card>
          </div>

          {/* 3. INTENT TABS & SEARCH CONTROLS */}
          <div className="hidden space-y-3">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
              {/* Segmented Filter Pills */}
              <div className="flex flex-wrap items-center gap-1 p-1 bg-muted/40 rounded-lg border border-border/70">
                <button
                  onClick={() => setActiveIntentFilter("all")}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5",
                    activeIntentFilter === "all"
                      ? "bg-background text-foreground shadow-2xs font-semibold"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span>All Inquiries</span>
                  <span className="rounded-full bg-muted px-1.5 py-0.2 text-[10px] text-muted-foreground font-mono">
                    {intentCounts.all}
                  </span>
                </button>

                <button
                  onClick={() => setActiveIntentFilter("buy")}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5",
                    activeIntentFilter === "buy"
                      ? "bg-blue-600 text-white shadow-2xs font-semibold"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                  )}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                  <span>Buy</span>
                  <span className={cn(
                    "rounded-full px-1.5 py-0.2 text-[10px] font-mono",
                    activeIntentFilter === "buy" ? "bg-blue-500/50 text-white" : "bg-muted text-muted-foreground"
                  )}>
                    {intentCounts.buy}
                  </span>
                </button>

                <button
                  onClick={() => setActiveIntentFilter("rent")}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5",
                    activeIntentFilter === "rent"
                      ? "bg-purple-600 text-white shadow-2xs font-semibold"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                  )}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-purple-400" />
                  <span>Rent</span>
                  <span className={cn(
                    "rounded-full px-1.5 py-0.2 text-[10px] font-mono",
                    activeIntentFilter === "rent" ? "bg-purple-500/50 text-white" : "bg-muted text-muted-foreground"
                  )}>
                    {intentCounts.rent}
                  </span>
                </button>

                <button
                  onClick={() => setActiveIntentFilter("sell")}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5",
                    activeIntentFilter === "sell"
                      ? "bg-emerald-600 text-white shadow-2xs font-semibold"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                  )}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  <span>Sell</span>
                  <span className={cn(
                    "rounded-full px-1.5 py-0.2 text-[10px] font-mono",
                    activeIntentFilter === "sell" ? "bg-emerald-500/50 text-white" : "bg-muted text-muted-foreground"
                  )}>
                    {intentCounts.sell}
                  </span>
                </button>

                <button
                  onClick={() => setActiveIntentFilter("lease")}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5",
                    activeIntentFilter === "lease"
                  ? "bg-amber-600 text-white shadow-2xs font-semibold"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
              )}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              <span>Lease</span>
              <span className={cn(
                "rounded-full px-1.5 py-0.2 text-[10px] font-mono",
                activeIntentFilter === "lease" ? "bg-amber-500/50 text-white" : "bg-muted text-muted-foreground"
              )}>
                {intentCounts.lease}
              </span>
            </button>
          </div>

        </div>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="flex items-baseline gap-3 text-2xl font-bold tracking-tight text-[#07363a]">
              {activeView === "leads" ? (
                <span>Your Leads</span>
              ) : (
                <>
                  <span>{activeCodeFilter}</span>
                  <span className="text-lg font-medium text-[#708f91]">
                    {{ AR: "Available for rent", AS: "Available for sale", WR: "Wants to rent", WB: "Wants to buy" }[activeCodeFilter]}
                  </span>
                </>
              )}
            </h2>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-[#789497] px-1">
          <span>
            Showing <strong>{filteredMessages.length}</strong> of{" "}
            <strong>{activeView === "leads" ? convertedLeadCount : codeCounts[activeCodeFilter]}</strong>{" "}
            {activeView === "leads" ? "leads" : "stored inquiries"}
          </span>
          <div className="flex items-center gap-2.5">
            {lastFetchedAt && (
              <span className="flex items-center gap-1.5 text-muted-foreground font-medium">
                <ClockIcon className="h-3.5 w-3.5 text-emerald-600" />
                <span>Last synced at {lastFetchedAt}</span>
              </span>
            )}
            <Button
              variant="default"
              size="sm"
              onClick={handleManualFetch}
              disabled={isScraping}
              className="gap-1.5 text-xs h-8 rounded-lg bg-[#00363a] text-white hover:bg-[#06494d] shadow-none font-medium"
            >
              <RefreshCwIcon className={cn("h-3.5 w-3.5", isScraping && "animate-spin")} />
              <span>{isScraping ? "Fetching..." : "Fetch Today's Inquiries"}</span>
            </Button>
          </div>
        </div>
      </div>

      {/* 5. MESSAGES IN TABLE FORMAT */}
      <DataTableCard className="overflow-hidden rounded-2xl border border-[#dce7e6] bg-white shadow-none">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <DataTableHead filled>
                <th className="px-4 py-3 min-w-[190px]">Contact / Sender</th>
                <th className="px-3 py-3 min-w-[85px]">Intent</th>
                <th className="px-3 py-3 min-w-[90px]">Config</th>
                <th className="px-3 py-3 min-w-[110px]">Budget / Price</th>
                <th className="px-3 py-3 min-w-[130px]">Project Name</th>
                <th className="px-3 py-3 min-w-[130px]">Location</th>
                <th className="px-3 py-3 min-w-[90px]">Time</th>
                <th className="px-4 py-3 text-right min-w-[100px]">Action</th>
              </DataTableHead>

              <tbody className="divide-y divide-border/60 bg-card">
                {filteredMessages.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-12 text-center text-muted-foreground">
                      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-muted/60 mb-2">
                        <MessageSquareIcon className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <p className="font-semibold text-sm text-foreground">
                        {activeView === "leads" ? "No leads yet" : "No inquiries captured for today yet"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {activeView === "leads"
                          ? "Use Convert to Lead on an inquiry to add it here."
                          : "Messages from permitted WhatsApp groups will automatically appear here."}
                      </p>
                    </td>
                  </tr>
                ) : (
                  paginatedMessages.map((msg) => {
                    const intentBadgeClass = {
                      buy: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800",
                      rent: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/50 dark:text-purple-300 dark:border-purple-800",
                      sell: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800",
                      lease: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800",
                      general: "bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-900 dark:text-gray-300 dark:border-gray-800",
                    }[msg.intent];

                    const initials = msg.senderName
                      .split(" ")
                      .map((n) => n[0])
                      .slice(0, 2)
                      .join("")
                      .toUpperCase();

                    return (
                      <tr
                        key={msg.id}
                        className={cn(
                          "hover:bg-muted/30 transition-colors group/row",
                          msg.convertedToLead && "bg-emerald-50/15 dark:bg-emerald-950/10",
                          msg.isActive === false && "opacity-60 bg-muted/15",
                        )}
                      >
                        {/* 1. Sender Contact */}
                        <td className="px-4 py-3 align-middle font-medium">
                          <div className="flex items-center gap-2.5">
                            <div className="relative flex h-7.5 w-7.5 shrink-0 items-center justify-center rounded-full bg-muted/80 text-[11px] font-bold text-foreground">
                              {initials}
                              <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-white dark:bg-gray-900">
                                <WhatsAppIcon className="h-2 w-2 text-emerald-600" />
                              </span>
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-foreground truncate max-w-[140px]">
                                {msg.senderName}
                              </p>
                              <p className="font-mono text-[11px] text-muted-foreground truncate">
                                {isWhatsAppLid(msg.senderPhone) ? "WhatsApp Member" : msg.senderPhone}
                              </p>
                            </div>
                          </div>
                        </td>

                        {/* 2. Intent Badge & Code Pill */}
                        <td className="px-3 py-3 align-middle">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {msg.code && (
                              <span
                                className={cn(
                                  "font-mono text-[10px] font-black px-1.5 py-0.5 rounded shadow-2xs border tracking-tight",
                                  msg.code.startsWith("WB")
                                    ? "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800"
                                    : msg.code.startsWith("AS")
                                    ? "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800"
                                    : msg.code.startsWith("WR")
                                    ? "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800"
                                    : "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-800",
                                )}
                                title={`Code: ${msg.code}`}
                              >
                                {msg.code}
                              </span>
                            )}
                            <Badge
                              className={cn(
                                "text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 border shadow-2xs",
                                intentBadgeClass,
                              )}
                            >
                              {msg.code?.startsWith("WB")
                                ? "BUY"
                                : msg.code?.startsWith("AS")
                                ? "SELL"
                                : msg.code?.startsWith("WR")
                                ? "RENT SEEK"
                                : msg.code?.startsWith("AR")
                                ? "RENT"
                                : msg.intent}
                            </Badge>
                            {msg.dealType && msg.dealType !== "standard" && (
                              <Badge className="bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-950 dark:text-orange-300 text-[9px] font-bold px-1.5 py-0 shadow-2xs">
                                {msg.dealType}
                              </Badge>
                            )}
                            {msg.isActive === false && (
                              <Badge className="bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800 text-[9px] font-bold px-1.5 py-0 shadow-2xs">
                                INACTIVE
                              </Badge>
                            )}
                          </div>
                        </td>

                        {/* 3. Configuration */}
                        <td className="px-3 py-3 align-middle">
                          {msg.configuration ? (
                            <span className="inline-flex items-center gap-1 font-semibold text-foreground text-xs">
                              <HomeIcon className="h-3 w-3 text-blue-500" />
                              {msg.configuration}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </td>

                        {/* 4. Budget / Price */}
                        <td className="px-3 py-3 align-middle">
                          {msg.budgetOrPrice ? (
                            <span className="font-semibold text-emerald-700 dark:text-emerald-400 text-xs">
                              {msg.budgetOrPrice}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </td>

                        {/* 5. Project Name */}
                        <td className="px-3 py-3 align-middle">
                          {msg.projectName ? (
                            <span className="inline-flex items-center gap-1 font-medium text-foreground text-xs">
                              <Building2Icon className="h-3 w-3 text-emerald-600 shrink-0" />
                              <span className="truncate max-w-[130px]" title={msg.projectName}>
                                {msg.projectName}
                              </span>
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </td>

                        {/* 6. Location */}
                        <td className="px-3 py-3 align-middle">
                          {msg.location ? (
                            <span className="inline-flex items-center gap-1 text-foreground text-xs">
                              <MapPinIcon className="h-3 w-3 text-rose-500 shrink-0" />
                              <span className="truncate max-w-[130px]">{msg.location}</span>
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </td>

                        {/* 7. Timestamp */}
                        <td className="px-3 py-3 align-middle text-[11px] text-muted-foreground whitespace-nowrap">
                          {msg.timestamp}
                        </td>

                        {/* 8. Action: View Message */}
                        <td className="px-4 py-3 align-middle text-right whitespace-nowrap">
                          <div className="flex items-center justify-end">
                            <Button
                              variant="outline"
                              size="xs"
                              onClick={() => setInspectMessage(msg)}
                              className={cn(
                                "gap-1.5 text-xs h-7.5 hover:bg-muted border-border/70 shadow-2xs font-medium",
                                msg.isActive === false ? "text-muted-foreground border-amber-500/30" : "text-foreground",
                              )}
                              title={msg.isActive === false ? "View inactive (checked) inquiry" : "View actual message"}
                            >
                              <EyeIcon className={cn("h-3.5 w-3.5", msg.isActive === false ? "text-amber-500" : "text-blue-500")} />
                              <span>View</span>
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </DataTableCard>

        {filteredMessages.length > 0 && (
          <ClientPagination
            total={filteredMessages.length}
            pageSize={PAGE_SIZE}
            currentPage={feedPage}
            onPageChange={setFeedPage}
            itemName="inquiries"
          />
        )}
    </div>
  )}

  {/* ========================================================================= */}
  {/* VIEW C: POTENTIAL PROPERTY MATCHES (TABULAR FORMAT)                       */}
  {/* ========================================================================= */}
  {activeView === "matches" && (
    <div className="space-y-6 bg-[#fbfcfa] px-4 py-7 md:px-8 animate-in fade-in-50 duration-200">
      {/* Header & Search Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground font-heading flex items-center gap-2">
            <span>Potential Demand ⇄ Supply Matches</span>
            <Badge variant="outline" className="border-rose-500/30 text-rose-600 bg-rose-50/50 dark:bg-rose-950/30 dark:text-rose-400 text-[11px] font-semibold">
              Script-Based Matchmaker
            </Badge>
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Automatically pairs active buyer &amp; tenant requirements with matching supply listings based on intent, budget, location, and configuration.
          </p>
        </div>

      </div>

      {/* Matches Table */}
      <DataTableCard className="border border-border/70 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <DataTableHead filled>
              <th className="px-4 py-3 min-w-[180px]">Demand (Requirement)</th>
              <th className="px-3 py-3 min-w-[90px]">Req. Config</th>
              <th className="px-3 py-3 min-w-[110px]">Budget</th>
              <th className="px-3 py-3 min-w-[120px]">Demand Locality</th>
              <th className="px-4 py-3 min-w-[180px]">Matched Supply (Listing)</th>
              <th className="px-3 py-3 min-w-[130px]">Available Details</th>
              <th className="px-3 py-3 min-w-[120px]">Supply Locality</th>
              <th className="px-3 py-3 min-w-[150px]">Match Score &amp; Reason</th>
              <th className="px-4 py-3 text-right min-w-[90px]">Action</th>
            </DataTableHead>

            <tbody className="divide-y divide-border/60 bg-card">
              {filteredMatches.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-12 text-center text-muted-foreground">
                    <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-muted/60 mb-2">
                      <ArrowRightLeftIcon className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <p className="font-semibold text-sm text-foreground">
                      No potential matches found
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      When matching buyer/tenant demands and seller/landlord listings are captured, they will appear here in tabular form.
                    </p>
                  </td>
                </tr>
              ) : (
                paginatedMatches.map((match) => {
                  const demandInitials = match.demandContact.name
                    .split(" ")
                    .map((n) => n[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase() || "DM";

                  const supplyInitials = match.supplyContact.name
                    .split(" ")
                    .map((n) => n[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase() || "SP";

                  const scorePercent = Math.round(match.matchScore * 100);

                  return (
                    <tr
                      key={match.id}
                      className="hover:bg-muted/30 transition-colors group/row"
                    >
                      {/* 1. Demand Contact */}
                      <td className="px-4 py-3 align-middle font-medium">
                        <div className="flex items-center gap-2.5">
                          <div className="relative flex h-7.5 w-7.5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 text-[11px] font-bold">
                            {demandInitials}
                            <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-white dark:bg-gray-900">
                              <WhatsAppIcon className="h-2 w-2 text-emerald-600" />
                            </span>
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-foreground truncate max-w-[130px]">
                              {match.demandContact.name}
                            </p>
                            <p className="font-mono text-[11px] text-muted-foreground truncate">
                              {match.demandContact.phone || "—"}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* 2. Req. Config */}
                      <td className="px-3 py-3 align-middle">
                        <span className="inline-flex items-center gap-1 font-semibold text-foreground text-xs">
                          <HomeIcon className="h-3 w-3 text-blue-500 shrink-0" />
                          <span className="truncate max-w-[100px]">{match.demandConfig || match.demandLeadSummary.split(" in ")[0]}</span>
                        </span>
                      </td>

                      {/* 3. Budget */}
                      <td className="px-3 py-3 align-middle">
                        <span className="font-semibold text-emerald-700 dark:text-emerald-400 text-xs">
                          {match.demandBudget || "On Request"}
                        </span>
                      </td>

                      {/* 4. Demand Location */}
                      <td className="px-3 py-3 align-middle">
                        {match.demandContact.location ? (
                          <span className="inline-flex items-center gap-1 text-foreground text-xs">
                            <MapPinIcon className="h-3 w-3 text-rose-500 shrink-0" />
                            <span className="truncate max-w-[110px]">{match.demandContact.location}</span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>

                      {/* 5. Matched Supply Contact */}
                      <td className="px-4 py-3 align-middle font-medium">
                        <div className="flex items-center gap-2.5">
                          <div className="relative flex h-7.5 w-7.5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 text-[11px] font-bold">
                            {supplyInitials}
                            <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-white dark:bg-gray-900">
                              <WhatsAppIcon className="h-2 w-2 text-emerald-600" />
                            </span>
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-foreground truncate max-w-[130px]">
                              {match.supplyContact.name}
                            </p>
                            <p className="font-mono text-[11px] text-muted-foreground truncate">
                              {match.supplyContact.phone || "—"}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* 6. Available Details (Supply Config & Price) */}
                      <td className="px-3 py-3 align-middle">
                        <div className="space-y-0.5">
                          <p className="font-semibold text-foreground truncate max-w-[120px]">
                            {match.supplyConfig || match.supplyLeadSummary.split(" in ")[0]}
                          </p>
                          <p className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400 truncate">
                            {match.supplyPrice || "On Request"}
                          </p>
                        </div>
                      </td>

                      {/* 7. Supply Location */}
                      <td className="px-3 py-3 align-middle">
                        {match.supplyContact.location ? (
                          <span className="inline-flex items-center gap-1 text-foreground text-xs">
                            <MapPinIcon className="h-3 w-3 text-emerald-600 shrink-0" />
                            <span className="truncate max-w-[110px]">{match.supplyContact.location}</span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>

                      {/* 8. Match Score & Reason */}
                      <td className="px-3 py-3 align-middle">
                        <div className="space-y-1">
                          <Badge className="bg-rose-500/10 text-rose-700 border-rose-300 dark:bg-rose-950/40 dark:text-rose-300 font-bold text-[10px] gap-1 px-1.5 py-0.2">
                            <FlameIcon className="h-3 w-3 text-rose-500" />
                            {scorePercent}% Match
                          </Badge>
                          <p className="text-[10px] text-muted-foreground truncate max-w-[140px]" title={match.matchReason}>
                            {match.matchReason}
                          </p>
                        </div>
                      </td>

                      {/* 9. Action Buttons */}
                      <td className="px-4 py-3 align-middle text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="outline"
                            size="xs"
                            onClick={() => setInspectMatch(match)}
                            className="gap-1.5 text-xs h-7.5 text-foreground hover:bg-muted border-border/70 shadow-2xs font-medium"
                            title="View match breakdown"
                          >
                            <EyeIcon className="h-3.5 w-3.5 text-blue-500" />
                            <span>View</span>
                          </Button>

                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </DataTableCard>

      {filteredMatches.length > 0 && (
        <ClientPagination
          total={filteredMatches.length}
          pageSize={PAGE_SIZE}
          currentPage={matchesPage}
          onPageChange={setMatchesPage}
          itemName="matches"
        />
      )}
    </div>
  )}

  {/* MATCH DETAIL INSPECTION MODAL */}
  {inspectMatch && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-xl rounded-2xl bg-card p-6 shadow-2xl border border-border space-y-4">
        <div className="flex items-start justify-between border-b border-border/70 pb-3">
          <div>
            <div className="flex items-center gap-2">
              <Badge className="bg-rose-500 text-white font-bold text-xs gap-1">
                <FlameIcon className="h-3 w-3" />
                {Math.round(inspectMatch.matchScore * 100)}% Match Score
              </Badge>
              <span className="font-semibold text-sm text-foreground">
                Potential Property Match
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {inspectMatch.matchReason}
            </p>
          </div>
          <button
            onClick={() => setInspectMatch(null)}
            className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Side-by-Side Comparison */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          {/* Demand Side */}
          <div className="p-3.5 rounded-xl border border-blue-500/30 bg-blue-500/5 space-y-2">
            <div className="flex items-center justify-between">
              <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 text-[10px] font-semibold uppercase">
                Demand (Requirement)
              </Badge>
              <span className="text-[11px] font-mono text-muted-foreground">
                {inspectMatch.demandContact.phone || "No phone"}
              </span>
            </div>
            <p className="text-xs font-bold text-foreground">
              {inspectMatch.demandLeadSummary}
            </p>
            <div className="space-y-1 text-xs text-muted-foreground">
              <div>Contact: <strong className="text-foreground">{inspectMatch.demandContact.name}</strong></div>
              {inspectMatch.demandContact.location && (
                <div className="flex items-center gap-1">
                  <MapPinIcon className="h-3 w-3 text-rose-500" />
                  <span>{inspectMatch.demandContact.location}</span>
                </div>
              )}
            </div>
          </div>

          {/* Supply Side */}
          <div className="p-3.5 rounded-xl border border-emerald-500/30 bg-emerald-500/5 space-y-2">
            <div className="flex items-center justify-between">
              <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 text-[10px] font-semibold uppercase">
                Supply (Available Listing)
              </Badge>
              <span className="text-[11px] font-mono text-muted-foreground">
                {inspectMatch.supplyContact.phone || "No phone"}
              </span>
            </div>
            <p className="text-xs font-bold text-foreground">
              {inspectMatch.supplyLeadSummary}
            </p>
            <div className="space-y-1 text-xs text-muted-foreground">
              <div>Contact: <strong className="text-foreground">{inspectMatch.supplyContact.name}</strong></div>
              {inspectMatch.supplyContact.location && (
                <div className="flex items-center gap-1">
                  <MapPinIcon className="h-3 w-3 text-emerald-600" />
                  <span>{inspectMatch.supplyContact.location}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Suggested Pitch Box */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            <span>Suggested WhatsApp Pitch:</span>
            <button
              onClick={() => {
                navigator.clipboard.writeText(inspectMatch.suggestedPitch);
                toast.success("Pitch message copied to clipboard!");
              }}
              className="text-emerald-600 hover:underline flex items-center gap-1 font-normal lowercase first-letter:uppercase text-[11px]"
            >
              <CopyIcon className="h-3 w-3" />
              Copy Pitch
            </button>
          </div>
          <div className="p-3.5 rounded-xl bg-muted/20 border border-border/70 text-xs text-foreground leading-relaxed italic select-text whitespace-pre-wrap">
            &quot;{inspectMatch.suggestedPitch}&quot;
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-border/70">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setInspectMatch(null)}
            className="text-xs h-8"
          >
            Close
          </Button>

          <Button
            size="sm"
            onClick={() => {
              const pitch = encodeURIComponent(inspectMatch.suggestedPitch);
              const phone = (inspectMatch.demandContact.phone || "").replace(/[^0-9]/g, "");
              window.open(
                `https://wa.me/${phone}?text=${pitch}`,
                "_blank",
                "noopener,noreferrer",
              );
            }}
            className="text-xs h-8 bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 shadow-2xs font-medium"
          >
            <SendIcon className="h-3.5 w-3.5" />
            <span>Pitch Client on WhatsApp</span>
          </Button>
        </div>
      </div>
    </div>
  )}

  {/* FULL MESSAGE INSPECT MODAL */}
      {inspectMessage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 sm:p-6 animate-in fade-in duration-200">
          <div
            style={{ width: "60vw", maxWidth: "60vw", height: "60vh", maxHeight: "60vh" }}
            className="relative w-[92vw] sm:w-[80vw] lg:w-[60vw] max-w-[60vw] h-[60vh] max-h-[60vh] flex flex-col rounded-2xl bg-card p-6 sm:p-7 shadow-2xl border border-border/80 overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-start justify-between border-b border-border/70 pb-4 shrink-0">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold text-sm flex items-center justify-center shrink-0 border border-emerald-500/20">
                  {inspectMessage.senderName.charAt(0).toUpperCase() || "W"}
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-base text-foreground tracking-tight">
                      {inspectMessage.senderName}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground bg-muted/60 px-2 py-0.5 rounded-md border border-border/50">
                      {isWhatsAppLid(inspectMessage.senderPhone) ? "WhatsApp Member" : inspectMessage.senderPhone}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5 flex-wrap">
                    <span className="font-medium text-foreground/80">{inspectMessage.groupName}</span>
                    <span>•</span>
                    <ClockIcon className="h-3 w-3 text-muted-foreground" />
                    <span>{inspectMessage.timestamp}</span>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setInspectMessage(null)}
                className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                aria-label="Close modal"
              >
                <XIcon className="h-5 w-5" />
              </button>
            </div>

            {/* Inactive / Checked Property Notice Banner */}
            {inspectMessage.isActive === false && (
              <div className="mt-3 px-3.5 py-2 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-between text-xs text-amber-800 dark:text-amber-300 shrink-0">
                <div className="flex items-center gap-2">
                  <CheckCircle2Icon className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                  <span>
                    <strong>Checked Property:</strong> Marked as inactive and excluded from the Potential Matches algorithm.
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => setConfirmToggleMessage(inspectMessage)}
                  className="h-6 text-[11px] px-2.5 border-amber-500/40 hover:bg-amber-500/20 text-amber-900 dark:text-amber-200 font-medium"
                >
                  Reactivate
                </Button>
              </div>
            )}

            {/* Extracted Details Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 sm:gap-4 p-3.5 sm:p-4 bg-muted/35 rounded-xl border border-border/70 text-xs shrink-0 mt-4 shadow-2xs">
              <div>
                <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider block mb-1">
                  Broker Code & Intent
                </span>
                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                  {inspectMessage.code && (
                    <span className="font-mono text-[11px] font-black px-1.5 py-0.5 rounded bg-background border border-border/80 text-foreground shadow-2xs">
                      {inspectMessage.code}
                    </span>
                  )}
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px] uppercase font-bold px-1.5 py-0.2 tracking-wider",
                      inspectMessage.intent === "buy" && "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-400",
                      inspectMessage.intent === "sell" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                      inspectMessage.intent === "rent" && "border-purple-500/40 bg-purple-500/10 text-purple-700 dark:text-purple-400",
                      inspectMessage.intent === "lease" && "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
                    )}
                  >
                    {inspectMessage.intent}
                  </Badge>
                </div>
              </div>

              <div>
                <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider block mb-1">
                  Configuration
                </span>
                <span className="font-bold text-sm text-foreground block truncate" title={inspectMessage.configuration}>
                  {inspectMessage.configuration || "—"}
                </span>
              </div>

              <div>
                <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider block mb-1">
                  Budget / Price
                </span>
                <span className="font-bold text-sm text-emerald-600 dark:text-emerald-400 block truncate" title={inspectMessage.budgetOrPrice}>
                  {inspectMessage.budgetOrPrice || "—"}
                </span>
              </div>

              <div>
                <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider block mb-1">
                  Project Name
                </span>
                <span className="font-bold text-sm text-foreground block truncate" title={inspectMessage.projectName}>
                  {inspectMessage.projectName ? (
                    <span className="inline-flex items-center gap-1">
                      <Building2Icon className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      <span>{inspectMessage.projectName}</span>
                    </span>
                  ) : (
                    "—"
                  )}
                </span>
              </div>

              <div>
                <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider block mb-1">
                  Location
                </span>
                <span className="font-bold text-sm text-foreground block truncate" title={inspectMessage.location}>
                  {inspectMessage.location ? (
                    <span className="inline-flex items-center gap-1">
                      <MapPinIcon className="h-3.5 w-3.5 text-rose-500 shrink-0" />
                      <span>{inspectMessage.location}</span>
                    </span>
                  ) : (
                    "—"
                  )}
                </span>
              </div>
            </div>

            {/* Raw Message Container */}
            <div className="flex-1 min-h-0 flex flex-col space-y-1.5 mt-4 overflow-hidden">
              <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider shrink-0 flex items-center gap-1.5">
                <MessageSquareIcon className="h-3.5 w-3.5 text-muted-foreground" />
                <span>Raw WhatsApp Message Text:</span>
              </label>
              <div className="flex-1 min-h-0 overflow-y-auto p-4 rounded-xl bg-muted/25 border border-border/80 text-[13px] text-foreground leading-relaxed font-sans select-text whitespace-pre-wrap shadow-inner">
                {inspectMessage.messageText}
              </div>
            </div>

            {/* Footer Actions */}
            <div className="flex items-center justify-between pt-4 border-t border-border/70 shrink-0 mt-4 flex-wrap gap-2">
              <div className="flex items-center gap-2.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyToClipboard(inspectMessage.messageText)}
                  className="text-xs h-9 px-3.5 gap-2 border-border/80 hover:bg-muted font-medium"
                >
                  <CopyIcon className="h-3.5 w-3.5" />
                  <span>Copy Text</span>
                </Button>

                {/* Status Toggle on right side of Copy Text */}
                <button
                  type="button"
                  onClick={() => setConfirmToggleMessage(inspectMessage)}
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-1 rounded-xl border cursor-pointer select-none transition-all shadow-2xs h-9",
                    inspectMessage.isActive === false
                      ? "bg-amber-500/15 border-amber-500/40 hover:bg-amber-500/20"
                      : "bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/15",
                  )}
                  title={
                    inspectMessage.isActive === false
                      ? "Checked & Inactive (Excluded from matching). Click to reactivate."
                      : "Active (Eligible for matching). Click to mark as Checked / Inactive."
                  }
                >
                  <div className="text-left">
                    <span
                      className={cn(
                        "text-[11px] font-bold block leading-tight",
                        inspectMessage.isActive === false
                          ? "text-amber-800 dark:text-amber-300"
                          : "text-emerald-700 dark:text-emerald-400",
                      )}
                    >
                      {inspectMessage.isActive === false ? "Checked / Inactive" : "Active Property"}
                    </span>
                    <span className="text-[9.5px] text-muted-foreground block -mt-0.5">
                      {inspectMessage.isActive === false ? "Excluded from match" : "Eligible for match"}
                    </span>
                  </div>
                  <div
                    className={cn(
                      "relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out",
                      inspectMessage.isActive === false ? "bg-amber-600/70 dark:bg-amber-500/70" : "bg-emerald-600",
                    )}
                  >
                    <span
                      className={cn(
                        "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out",
                        inspectMessage.isActive === false ? "translate-x-0" : "translate-x-4",
                      )}
                    />
                  </div>
                </button>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setInspectMessage(null)}
                  className="text-xs h-9 px-3.5 text-muted-foreground hover:text-foreground"
                >
                  Close
                </Button>

                {!inspectMessage.convertedToLead ? (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => void handleConvertToLead(inspectMessage)}
                    disabled={isConvertingToLead}
                    className="text-xs h-9 px-4 bg-foreground text-background hover:bg-foreground/90 gap-2 font-medium shadow-2xs"
                  >
                    <UserPlusIcon className="h-3.5 w-3.5" />
                    <span>{isConvertingToLead ? "Saving..." : "Convert to Lead"}</span>
                  </Button>
                ) : (
                  <Badge
                    variant="outline"
                    className="text-xs py-1 px-3 border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 gap-1.5"
                  >
                    <CheckCircle2Icon className="h-3.5 w-3.5" />
                    <span>Converted to Lead</span>
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRMATION MODAL FOR TOGGLING ACTIVE / INACTIVE */}
      {confirmToggleMessage && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="relative w-full max-w-md rounded-2xl bg-card p-6 shadow-2xl border border-border/90 flex flex-col gap-4">
            <div className="flex items-start gap-3.5">
              <div
                className={cn(
                  "h-10 w-10 rounded-full flex items-center justify-center shrink-0 border",
                  confirmToggleMessage.isActive === false
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                    : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
                )}
              >
                {confirmToggleMessage.isActive === false ? (
                  <CheckCircle2Icon className="h-5 w-5" />
                ) : (
                  <ShieldAlertIcon className="h-5 w-5" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-bold text-foreground">
                  {confirmToggleMessage.isActive === false
                    ? "Reactivate Property Inquiry?"
                    : "Mark Property as Checked & Inactive?"}
                </h3>
                <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                  {confirmToggleMessage.isActive === false ? (
                    <>
                      This will reactivate <strong>{confirmToggleMessage.senderName}</strong>&apos;s property inquiry. It will immediately be included in the <strong>Potential Matches</strong> algorithm again.
                    </>
                  ) : (
                    <>
                      Are you sure you want to mark this property as checked? It will be marked as <strong>Inactive</strong> and excluded from the <strong>Potential Matches</strong> algorithm so it won&apos;t match with any other properties.
                    </>
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-border/70 mt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmToggleMessage(null)}
                className="text-xs h-9 px-3.5"
              >
                Cancel
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={async () => {
                  const target = confirmToggleMessage;
                  setConfirmToggleMessage(null);
                  await handleToggleActive(target);
                }}
                className={cn(
                  "text-xs h-9 px-4 font-semibold shadow-2xs gap-1.5",
                  confirmToggleMessage.isActive === false
                    ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                    : "bg-amber-600 hover:bg-amber-700 text-white",
                )}
              >
                {confirmToggleMessage.isActive === false ? (
                  <>
                    <CheckCircle2Icon className="h-3.5 w-3.5" />
                    <span>Confirm Reactivation</span>
                  </>
                ) : (
                  <>
                    <ShieldAlertIcon className="h-3.5 w-3.5" />
                    <span>Confirm & Mark Inactive</span>
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
