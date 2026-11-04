"use client";

import * as React from "react";
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
} from "@/lib/whatsapp/intent-classifier";
import {
  type ExtractedAILead,
  type AILeadMatch,
  type LeadIntent,
  runFallbackRuleBasedAnalysis,
} from "@/lib/whatsapp/openai-lead-matcher";
import { matchPropertiesByRules } from "@/lib/whatsapp/property-script-matcher";
import { cn } from "@/lib/utils";
import { QRCodeSvg } from "./qr-code-svg";

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
}: {
  organisationName: string;
}) {
  // Navigation View: "feed" (Live Inquiries Stream), "matches" (Potential Property Matches Table), or "settings"
  const [activeView, setActiveView] = React.useState<"feed" | "matches" | "settings">("feed");

  // Potential Property Matches State (Calculated by Script Matcher)
  const [inspectMatch, setInspectMatch] = React.useState<AILeadMatch | null>(null);
  const [matchSearchQuery, setMatchSearchQuery] = React.useState<string>("");

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
  const [isScraping, setIsScraping] = React.useState(false);
  const [lastFetchedAt, setLastFetchedAt] = React.useState<string>(() =>
    new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
  );
  const [cycleLabel, setCycleLabel] = React.useState<string>("Today 9:00 AM – Tomorrow 9:00 AM");
  const [nextBatchSlot, setNextBatchSlot] = React.useState<string>("3:00 PM");
  const [activeIntentFilter, setActiveIntentFilter] = React.useState<PropertyIntent | "all">("all");
  const [selectedGroupFilter, setSelectedGroupFilter] = React.useState<string>("all");
  const [searchQuery, setSearchQuery] = React.useState("");

  // Inspect message detail modal
  const [inspectMessage, setInspectMessage] = React.useState<CapturedWhatsAppMessage | null>(null);

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

  // Fetch / Scrape today's messages from API
  const fetchMessagesFromAPI = React.useCallback(
    async (silent = false) => {
      try {
        if (!silent) setIsScraping(true);
        const res = await fetch("/api/whatsapp-capture?today=true");
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
            }),
          );

          setMessages((prev) => {
            const existingIds = new Set(prev.map((m) => m.id));
            const newItems = mapped.filter((m) => !existingIds.has(m.id));
            if (newItems.length > 0) {
              toast.success(`Captured ${newItems.length} new WhatsApp inquiries`);
            } else if (!silent) {
              toast.info("WhatsApp inquiries feed up to date.");
            }
            const convertedIds = new Set(prev.filter((m) => m.convertedToLead).map((m) => m.id));
            return mapped.map((m) => ({
              ...m,
              convertedToLead: m.convertedToLead || convertedIds.has(m.id),
            }));
          });
          setLastFetchedAt(
            new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
          );

          if (json.data && json.data.cycleInfo) {
            if (json.data.cycleInfo.windowLabel) setCycleLabel(json.data.cycleInfo.windowLabel);
            if (json.data.cycleInfo.nextSlotFormatted) setNextBatchSlot(json.data.cycleInfo.nextSlotFormatted);
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

  // Scrape for confirmed groups
  const executeScrapeForGroups = React.useCallback(
    async (groupIds: string[], redirectBackToFeed = false) => {
      if (groupIds.length === 0) {
        toast.error("Please select at least one WhatsApp group to scrape.");
        return;
      }

      setIsScraping(true);
      try {
        const res = await fetch("/api/whatsapp-capture", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "set_permissions_and_scrape",
            selectedGroupIds: groupIds,
          }),
        });

        const json = await res.json();
        if (json.success && Array.isArray(json.items)) {
          const mapped: CapturedWhatsAppMessage[] = json.items.map(
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
            }),
          );

          setMessages((prev) => {
            const existingIds = new Set(prev.map((m) => m.id));
            const newItems = mapped.filter((m) => !existingIds.has(m.id));
            if (newItems.length > 0) {
              toast.success(`Captured ${newItems.length} new WhatsApp inquiries`);
            } else {
              toast.info("WhatsApp inquiries feed up to date.");
            }
            const convertedIds = new Set(prev.filter((m) => m.convertedToLead).map((m) => m.id));
            return mapped.map((m) => ({
              ...m,
              convertedToLead: m.convertedToLead || convertedIds.has(m.id),
            }));
          });
          setConfirmedGroupIds(groupIds);
          if (Array.isArray(json.discoveredGroups) && json.discoveredGroups.length > 0) {
            setAvailableGroups(json.discoveredGroups);
          }
          setLastFetchedAt(
            new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
          );
          toast.success(
            `Scraped ${mapped.length} messages from today across ${groupIds.length} selected group(s)!`,
          );
          if (redirectBackToFeed) {
            setActiveView("feed");
          }
        } else {
          toast.error("Failed to scrape messages from selected groups.");
        }
      } catch {
        toast.error("Error communicating with capture API.");
      } finally {
        setIsScraping(false);
      }
    },
    [],
  );

  // Initial load: Fetch once on mount if connected
  React.useEffect(() => {
    if (sessionStatus === "connected") {
      fetchMessagesFromAPI(false);
    }
  }, [fetchMessagesFromAPI, sessionStatus]);

  // Fetch today's captured messages every 45s (within suggested 30–60s window) from local database/disk cache
  React.useEffect(() => {
    if (sessionStatus !== "connected") return;

    const FETCH_MESSAGES_INTERVAL_MS = 45 * 1000;
    const interval = setInterval(() => {
      fetchMessagesFromAPI(true); // silent fetch from local database/disk
    }, FETCH_MESSAGES_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [fetchMessagesFromAPI, sessionStatus]);

  // Automated 1-Hour scheduled batch fetch (auto-fetches and adds new messages every 1 hr)
  React.useEffect(() => {
    const HOURLY_INTERVAL_MS = 60 * 60 * 1000;
    const hourlyTimer = setInterval(() => {
      fetchMessagesFromAPI(false);
    }, HOURLY_INTERVAL_MS);

    return () => clearInterval(hourlyTimer);
  }, [fetchMessagesFromAPI]);

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
    executeScrapeForGroups(selectedGroupIds, false);
    setIsEditingGroups(false);
  }

  // Filter messages
  const filteredMessages = React.useMemo(() => {
    return messages.filter((m) => {
      if (activeIntentFilter !== "all") {
        if (activeIntentFilter === "buy" && !(m.intent === "buy" || m.code?.startsWith("WB"))) return false;
        if (activeIntentFilter === "sell" && !(m.intent === "sell" || m.code?.startsWith("AS"))) return false;
        if (activeIntentFilter === "rent" && !(m.intent === "rent" || m.code?.startsWith("AR") || m.code?.startsWith("WR"))) return false;
        if (activeIntentFilter === "lease" && !(m.intent === "lease" || m.code?.startsWith("AR") || m.code?.startsWith("WR"))) return false;
      }
      if (
        selectedGroupFilter !== "all" &&
        m.groupId !== selectedGroupFilter &&
        m.groupId.replace(/:.*@/, "@") !== selectedGroupFilter.replace(/:.*@/, "@")
      ) {
        return false;
      }
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        m.messageText.toLowerCase().includes(q) ||
        m.senderName.toLowerCase().includes(q) ||
        m.senderPhone.toLowerCase().includes(q) ||
        m.groupName.toLowerCase().includes(q) ||
        (m.location && m.location.toLowerCase().includes(q)) ||
        (m.configuration && m.configuration.toLowerCase().includes(q)) ||
        (m.code && m.code.toLowerCase().includes(q))
      );
    });
  }, [messages, activeIntentFilter, selectedGroupFilter, searchQuery]);

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

  // Convert to Lead
  function handleConvertToLead(msg: CapturedWhatsAppMessage) {
    setMessages((prev) =>
      prev.map((m) => (m.id === msg.id ? { ...m, convertedToLead: true } : m)),
    );
    toast.success(
      `Lead created for ${msg.senderName} (${msg.intent.toUpperCase()} · ${msg.configuration || "Property"}) in Skelo CRM!`,
    );
  }

  // Deterministic Script-Based Matchmaking (Demand vs Supply)
  const potentialMatches = React.useMemo(() => {
    if (messages.length === 0) return [];
    const rawMsgs = messages.map((m) => ({
      id: m.id,
      senderName: m.senderName,
      senderPhone: m.senderPhone,
      groupName: m.groupName,
      groupId: m.groupId,
      text: m.messageText,
      timestamp: m.rawTimestamp || Date.now(),
    }));
    const result = runFallbackRuleBasedAnalysis(rawMsgs, "Local Script Matcher");
    return result.matches;
  }, [messages]);

  // Filtered Potential Matches for the table
  const filteredMatches = React.useMemo(() => {
    if (!matchSearchQuery.trim()) return potentialMatches;
    const q = matchSearchQuery.toLowerCase();
    return potentialMatches.filter((match) => {
      return (
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
  }, [potentialMatches, matchSearchQuery]);

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
    <div className="space-y-6 pb-16">
      {/* 1. TOP HEADER & MAIN NAVIGATION TABS */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between border-b border-border/70 pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/20">
              <WhatsAppIcon className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-foreground font-heading">
                  WhatsApp Lead Capture
                </h1>
                <Badge
                  variant="outline"
                  className="border-muted text-muted-foreground text-[11px] font-normal"
                >
                  Read-Only Mode
                </Badge>
              </div>
            </div>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Scrapes today&apos;s real estate inquiries from your permitted WhatsApp groups.
          </p>
        </div>

        {/* View Switcher: Live Feed vs AI Matcher vs Settings */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-muted/50 p-1 rounded-lg border border-border/70 shadow-2xs">
            <button
              onClick={() => setActiveView("feed")}
              className={cn(
                "px-3.5 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5",
                activeView === "feed"
                  ? "bg-background text-foreground shadow-2xs font-semibold"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <TableIcon className="h-3.5 w-3.5 text-blue-500" />
              <span>Inquiries Feed</span>
              <span className="rounded-full bg-muted px-1.5 py-0.2 text-[10px] text-muted-foreground font-mono">
                {messages.length}
              </span>
            </button>

            <button
              onClick={() => setActiveView("matches")}
              className={cn(
                "px-3.5 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5",
                activeView === "matches"
                  ? "bg-background text-foreground shadow-2xs font-semibold"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <ArrowRightLeftIcon className="h-3.5 w-3.5 text-rose-500" />
              <span>Potential Matches</span>
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.2 text-[10px] font-mono",
                  potentialMatches.length > 0
                    ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 font-bold"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {potentialMatches.length}
              </span>
            </button>

            <button
              onClick={() => {
                setSelectedGroupIds([...confirmedGroupIds]);
                setActiveView("settings");
              }}
              className={cn(
                "px-3.5 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5",
                activeView === "settings"
                  ? "bg-background text-foreground shadow-2xs font-semibold"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <SettingsIcon className="h-3.5 w-3.5 text-emerald-600" />
              <span>Settings</span>
              <span className="rounded-full bg-muted px-1.5 py-0.2 text-[10px] text-muted-foreground font-mono">
                {confirmedGroupIds.length} groups
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* VIEW A: SETTINGS VIEW (Choose Groups, Manage WhatsApp Connection)          */}
      {/* ========================================================================= */}
      {activeView === "settings" && (
        <div className="space-y-6 animate-in fade-in-50 duration-200">
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
                    1-Hour Batch Cadence & Policy
                  </CardTitle>
                </div>
                <Badge variant="outline" className="border-blue-500/30 text-blue-600 bg-blue-50/50 text-[11px]">
                  Every 1 Hour (Automated Hourly Batch)
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-5 text-xs text-muted-foreground space-y-2.5">
              <div className="flex items-center justify-between py-1 border-b border-border/40">
                <span className="font-medium text-foreground">Scrape Cadence:</span>
                <span className="text-foreground">Every 1 hour (runs at top of every hour: 10:00 AM, 11:00 AM, 12:00 PM...)</span>
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
                <span className="text-emerald-600 dark:text-emerald-400 font-medium">Safe & Zero-Spam (Automated 1-hour schedule; adds new messages into table)</span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW B: INQUIRIES FEED (TABLE VIEW AS DEFAULT)                            */}
      {/* ========================================================================= */}
      {activeView === "feed" && (
        <div className="space-y-6 animate-in fade-in-50 duration-200">
          {/* 2. STATS & METRICS RIBBON */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
            <Card className="p-4 border-border/70 shadow-2xs bg-card/60 backdrop-blur-xs">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-[11px] font-medium uppercase tracking-wider">
                  Today&apos;s Inquiries
                </span>
                <MessageSquareIcon className="h-4 w-4 text-blue-500" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold tracking-tight text-foreground font-heading">
                  {messages.length}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  inquiries captured
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground truncate" title={`Auto-synced every 1 hr • Next batch at ${nextBatchSlot}`}>
                Auto-synced every 1 hr • Next: {nextBatchSlot}
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
          <div className="space-y-3">
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

          {/* Search */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative w-full sm:w-72">
              <SearchIcon className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search BHK, location, budget..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-8 h-9 text-xs bg-card border-border/80 shadow-2xs"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                >
                  <XIcon className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-muted-foreground px-1">
          <span>
            Showing <strong>{filteredMessages.length}</strong> of{" "}
            <strong>{messages.length}</strong> messages from today
          </span>
          <div className="flex items-center gap-2.5">
            {lastFetchedAt && (
              <span className="flex items-center gap-1.5 text-muted-foreground font-medium">
                <ClockIcon className="h-3.5 w-3.5 text-emerald-600" />
                <span>Fetched today at {lastFetchedAt}</span>
              </span>
            )}
            <Button
              variant="default"
              size="sm"
              onClick={() => fetchMessagesFromAPI(false)}
              disabled={isScraping}
              className="gap-1.5 text-xs h-7.5 bg-foreground text-background hover:bg-foreground/90 shadow-2xs font-medium"
            >
              <RefreshCwIcon className={cn("h-3.5 w-3.5", isScraping && "animate-spin")} />
              <span>{isScraping ? "Fetching..." : "Fetch Today's Inquiries"}</span>
            </Button>
          </div>
        </div>
      </div>

      {/* 5. MESSAGES IN TABLE FORMAT */}
      <DataTableCard className="border border-border/70 shadow-2xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <DataTableHead filled>
                <th className="px-4 py-3 min-w-[190px]">Contact / Sender</th>
                <th className="px-3 py-3 min-w-[85px]">Intent</th>
                <th className="px-3 py-3 min-w-[90px]">Config</th>
                <th className="px-3 py-3 min-w-[110px]">Budget / Price</th>
                <th className="px-3 py-3 min-w-[130px]">Location</th>
                <th className="px-3 py-3 min-w-[90px]">Time</th>
                <th className="px-4 py-3 text-right min-w-[100px]">Action</th>
              </DataTableHead>

              <tbody className="divide-y divide-border/60 bg-card">
                {filteredMessages.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-12 text-center text-muted-foreground">
                      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-muted/60 mb-2">
                        <MessageSquareIcon className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <p className="font-semibold text-sm text-foreground">
                        No inquiries captured for today yet
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Messages from permitted WhatsApp groups will automatically appear here.
                      </p>
                    </td>
                  </tr>
                ) : (
                  filteredMessages.map((msg) => {
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

                        {/* 5. Location */}
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

                        {/* 6. Timestamp */}
                        <td className="px-3 py-3 align-middle text-[11px] text-muted-foreground whitespace-nowrap">
                          {msg.timestamp}
                        </td>

                        {/* 7. Action: View Message */}
                        <td className="px-4 py-3 align-middle text-right whitespace-nowrap">
                          <div className="flex items-center justify-end">
                            <Button
                              variant="outline"
                              size="xs"
                              onClick={() => setInspectMessage(msg)}
                              className="gap-1.5 text-xs h-7.5 text-foreground hover:bg-muted border-border/70 shadow-2xs font-medium"
                              title="View actual message"
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
    </div>
  )}

  {/* ========================================================================= */}
  {/* VIEW C: POTENTIAL PROPERTY MATCHES (TABULAR FORMAT)                       */}
  {/* ========================================================================= */}
  {activeView === "matches" && (
    <div className="space-y-6 animate-in fade-in-50 duration-200">
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

        <div className="relative w-full sm:w-72">
          <SearchIcon className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={matchSearchQuery}
            onChange={(e) => setMatchSearchQuery(e.target.value)}
            placeholder="Search by contact, locality, or BHK..."
            className="pl-9 h-8.5 text-xs border-border/80"
          />
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
                filteredMatches.map((match) => {
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

                          <Button
                            variant="outline"
                            size="xs"
                            onClick={() => {
                              const pitch = encodeURIComponent(match.suggestedPitch);
                              const phone = (match.demandContact.phone || "").replace(/[^0-9]/g, "");
                              window.open(
                                `https://wa.me/${phone}?text=${pitch}`,
                                "_blank",
                                "noopener,noreferrer",
                              );
                            }}
                            className="gap-1.5 text-xs h-7.5 text-emerald-700 dark:text-emerald-400 border-emerald-500/40 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 shadow-2xs font-medium rounded-md"
                            title="Pitch on WhatsApp"
                          >
                            <SendIcon className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                            <span>Pitch</span>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
          <div
            style={{ maxHeight: "50vh", height: "50vh" }}
            className="relative w-full max-w-lg h-[50vh] max-h-[50vh] flex flex-col rounded-2xl bg-card p-5 shadow-2xl border border-border overflow-hidden"
          >
            <div className="flex items-start justify-between border-b border-border/70 pb-3 shrink-0">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-foreground">
                    {inspectMessage.senderName}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {isWhatsAppLid(inspectMessage.senderPhone) ? "WhatsApp Member" : inspectMessage.senderPhone}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  From group: {inspectMessage.groupName} • {inspectMessage.timestamp}
                </p>
              </div>
              <button
                onClick={() => setInspectMessage(null)}
                className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                <XIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-2.5 bg-muted/30 rounded-xl border border-border/60 text-xs shrink-0 mt-3">
              <div>
                <span className="text-[10px] uppercase font-semibold text-muted-foreground block">
                  Broker Code & Intent
                </span>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {inspectMessage.code && (
                    <span className="font-mono text-[11px] font-black px-1.5 py-0.2 rounded bg-muted border border-border text-foreground">
                      {inspectMessage.code}
                    </span>
                  )}
                  <span className="font-bold uppercase text-foreground">
                    {inspectMessage.intent}
                  </span>
                </div>
              </div>
              <div>
                <span className="text-[10px] uppercase font-semibold text-muted-foreground block">
                  Configuration
                </span>
                <span className="font-bold text-foreground block mt-0.5 truncate" title={inspectMessage.configuration}>
                  {inspectMessage.configuration || "—"}
                </span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-semibold text-muted-foreground block">
                  Budget / Price
                </span>
                <span className="font-bold text-emerald-600 dark:text-emerald-400 block mt-0.5 truncate" title={inspectMessage.budgetOrPrice}>
                  {inspectMessage.budgetOrPrice || "—"}
                </span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-semibold text-muted-foreground block">
                  Location
                </span>
                <span className="font-bold text-foreground block mt-0.5 truncate" title={inspectMessage.location}>
                  {inspectMessage.location || "Bangalore"}
                </span>
              </div>
            </div>

            <div className="flex-1 min-h-0 flex flex-col space-y-1 mt-2.5 overflow-hidden">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide shrink-0">
                Raw WhatsApp Message Text:
              </label>
              <div className="flex-1 min-h-0 overflow-y-auto p-3 rounded-xl bg-muted/20 border border-border/70 text-xs text-foreground leading-relaxed font-sans select-text whitespace-pre-wrap">
                {inspectMessage.messageText}
              </div>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-border/70 shrink-0 mt-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copyToClipboard(inspectMessage.messageText)}
                className="text-xs h-8 gap-1.5"
              >
                <CopyIcon className="h-3.5 w-3.5" />
                <span>Copy Text</span>
              </Button>

              <div className="flex gap-2">
                {!inspectMessage.convertedToLead && (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => {
                      handleConvertToLead(inspectMessage);
                      setInspectMessage(null);
                    }}
                    className="text-xs h-8 bg-foreground text-background hover:bg-foreground/90 gap-1.5"
                  >
                    <UserPlusIcon className="h-3.5 w-3.5" />
                    <span>Convert to Lead</span>
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
