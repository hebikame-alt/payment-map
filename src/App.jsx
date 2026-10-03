import React, { useState, useMemo, useEffect } from "react";
import {
  Search,
  MapPin,
  X,
  Check,
  ChevronUp,
  Navigation,
  Flag,
  CreditCard,
  Smartphone,
  Banknote,
  Ticket,
  TrainFront,
  ExternalLink,
  Wallet,
  Store,
  Utensils,
  ShoppingCart,
  Pill,
  Hotel,
  ShoppingBag,
  ChevronLeft,
  Plus,
  Scissors,
  Fuel,
  MoreHorizontal,
} from "lucide-react";

import supabase from "./lib/supabaseClient";

// ---------------------------------------------------------------------------
// Design tokens (applied via inline style — Tailwind core utilities handle
// layout / spacing / type scale only, per this environment's constraints)
// ---------------------------------------------------------------------------
const COLORS = {
  ink: "#182B33", // primary chrome / headings
  inkSoft: "#3E4F56",
  slate: "#6B7A80", // secondary text
  paper: "#F2EAD8", // map "paper" base
  paperLine: "#DCCFA9", // map contour lines
  paperLineSoft: "#E7DAB8",
  teal: "#5B4FE0", // primary accent — "this works for me"
  tealDeep: "#443AB3",
  tealMist: "#ECEAFB",
  amber: "#C98A1E", // 一時利用（商品券・キャンペーン）— kept visually separate from payments
  amberMist: "#F7EBD3",
  coral: "#DD5B45", // secondary accent — reports / unavailable
  coralMist: "#FBE9E4",
  mist: "#F5F2EA", // sheet / card background
  line: "#E4DECF", // hairline borders on light surfaces
  cream: "#FBF8F1",
};

const FONT = {
  display:
    '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans JP", system-ui, sans-serif',
};

// ---------------------------------------------------------------------------
// Payment category display metadata (label / icon are UI-only concerns and
// are not stored in Supabase; the payments.category column supplies the id)
// ---------------------------------------------------------------------------
const PAYMENT_CATEGORY_META = {
  code: { label: "コード決済", icon: Smartphone },
  credit: { label: "クレジットカード", icon: CreditCard },
  cash: { label: "現金", icon: Banknote },
  transit: { label: "交通系", icon: TrainFront },
};
const PAYMENT_CATEGORY_ORDER = ["code", "credit", "cash", "transit"];

const STORE_CATEGORIES = [
  { id: "すべて", icon: ShoppingBag },
  { id: "飲食・グルメ", icon: Utensils },
  { id: "コンビニ", icon: Store },
  { id: "スーパー", icon: ShoppingCart },
  { id: "ドラッグストア", icon: Pill },
  { id: "小売・ショッピング", icon: ShoppingBag },
  { id: "サービス", icon: Scissors },
  { id: "ガソリンスタンド・駐車場", icon: Fuel },
  { id: "その他", icon: MoreHorizontal },
];

const STORE_ICON = {
  "飲食・グルメ": Utensils,
  "コンビニ": Store,
  "スーパー": ShoppingCart,
  "ドラッグストア": Pill,
  "小売・ショッピング": ShoppingBag,
  "サービス": Scissors,
  "ガソリンスタンド・駐車場": Fuel,
  "その他": MoreHorizontal,
};

// ---------------------------------------------------------------------------
// Deterministic pseudo-random map placement
// ---------------------------------------------------------------------------
// stores has no x/y columns. Position on the map is derived from the store's
// id so the same store always lands in the same spot; this is a placeholder
// for real lat/lng once Google Maps integration replaces it.
function hashSeed(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

// Integer avalanche mix (murmur3-style finalizer) so sequential ids don't
// produce sequential-looking hashes — plain djb2 output on short, similar
// strings ("1:x" vs "2:x") barely changes, which is what clustered the pins.
function mix32(n, salt) {
  let h = (n ^ salt) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h = (h ^ (h >>> 16)) >>> 0;
  return h;
}

// x and y each get their own salt AND their own mixing pass so the two axes
// don't move together (which would line stores up diagonally).
const AXIS_SALT = { x: 0x9e3779b9, y: 0x27d4eb2f };

function storeCoord(id, axis) {
  const base = hashSeed(String(id));
  const mixed = mix32(base, AXIS_SALT[axis]);
  return 15 + ((mixed % 10000) / 10000) * 70; // 15–85, evenly spread
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Nudges pins that landed too close together (which makes their name labels
// overlap) outward along a deterministic spiral until they clear the
// minimum distance, without ever leaving the 15–85 map bounds.
function spreadStores(list, minDist = 7) {
  const sorted = [...list].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const placed = [];

  return sorted.map((store) => {
    let x = store.x;
    let y = store.y;
    let attempt = 0;

    while (placed.some((p) => Math.hypot(p.x - x, p.y - y) < minDist) && attempt < 24) {
      attempt++;
      const angle = mix32(hashSeed(String(store.id)), attempt) % 360 * (Math.PI / 180);
      const radius = minDist * 0.6 * attempt;
      x = clamp(store.x + Math.cos(angle) * radius, 15, 85);
      y = clamp(store.y + Math.sin(angle) * radius, 15, 85);
    }

    placed.push({ x, y });
    return { ...store, x, y };
  });
}

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------
function Pin({ store, isMatch, dimmed, hasTempUse, onClick }) {
  const Icon = STORE_ICON[store.category] || ShoppingBag;
  return (
    <button
      onClick={() => onClick(store)}
      className="absolute flex flex-col items-center transition-all duration-300"
      style={{
        left: `${store.x}%`,
        top: `${store.y}%`,
        transform: "translate(-50%, -100%)",
        opacity: dimmed ? 0.55 : 1,
        zIndex: dimmed ? 1 : 2,
      }}
      aria-label={store.name}
    >
      <span
        className="mb-1 whitespace-nowrap rounded px-1 py-0.5 text-[9px] font-semibold leading-none shadow-sm"
        style={{
          background: dimmed ? "rgba(242,234,216,0.85)" : COLORS.cream,
          color: dimmed ? "#9B9282" : COLORS.ink,
        }}
      >
        {store.name.length > 8 ? `${store.name.slice(0, 8)}…` : store.name}
      </span>
      <div className="relative">
        <div
          className="flex items-center justify-center rounded-full shadow-md transition-transform duration-300"
          style={{
            width: isMatch ? 26 : 18,
            height: isMatch ? 26 : 18,
            background: isMatch ? COLORS.teal : "#B9B2A0",
            border: `2px solid ${COLORS.cream}`,
          }}
        >
          {isMatch && <Icon size={13} color={COLORS.cream} strokeWidth={2.4} />}
        </div>
        {hasTempUse && (
          <div
            className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full"
            style={{ background: COLORS.amber, border: `1.5px solid ${COLORS.cream}` }}
          >
            <Ticket size={8} color={COLORS.cream} strokeWidth={3} />
          </div>
        )}
      </div>
    </button>
  );
}

function PaymentChip({ id, name, selected, onToggle }) {
  return (
    <button
      onClick={() => onToggle(id)}
      className="flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium transition-colors"
      style={{
        background: selected ? COLORS.teal : COLORS.cream,
        color: selected ? COLORS.cream : COLORS.inkSoft,
        border: `1.5px solid ${selected ? COLORS.teal : COLORS.line}`,
      }}
    >
      {selected && <Check size={14} strokeWidth={3} />}
      {name}
    </button>
  );
}

function SheetBackdrop({ onClose }) {
  return (
    <div
      className="absolute inset-0 z-30"
      style={{ background: "rgba(24,43,51,0.42)" }}
      onClick={onClose}
    />
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function PaymentMapPrototype() {
  const [registered, setRegistered] = useState([]); // confirmed payment ids
  const [pending, setPending] = useState([]); // in-progress selection in the register sheet
  const [sheet, setSheet] = useState(null); // null | 'register' | 'detail' | 'report'
  const [selectedStore, setSelectedStore] = useState(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("すべて");
  const [paymentSearch, setPaymentSearch] = useState("");
  const [toast, setToast] = useState("");
  const [reportPaymentId, setReportPaymentId] = useState(null);
  const [reportDone, setReportDone] = useState(false);
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportError, setReportError] = useState("");
  const [selectedTempUses, setSelectedTempUses] = useState([]);
  const [pendingTempUses, setPendingTempUses] = useState([]);
  const [requestForm, setRequestForm] = useState(null); // null | 'store' | 'payment' | 'tempuse' | 'manage'
  const [requestDone, setRequestDone] = useState(false);
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [reqStoreName, setReqStoreName] = useState("");
  const [reqStoreCategory, setReqStoreCategory] = useState("飲食");
  const [reqPaymentName, setReqPaymentName] = useState("");
  const [reqTempName, setReqTempName] = useState("");
  const [reqTempRegion, setReqTempRegion] = useState("");
  const [reqTempExpiry, setReqTempExpiry] = useState("");
  const [reqManageStoreId, setReqManageStoreId] = useState(null);

  const [stores, setStores] = useState([]);
  const [payments, setPayments] = useState([]);
  const [activeTempUses, setActiveTempUses] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setLoading(true);

      const [
        { data: storesData, error: storesError },
        { data: storePaymentsData, error: storePaymentsError },
        { data: paymentsData, error: paymentsError },
        { data: tempUsesData, error: tempUsesError },
        { data: tempUseStoresData, error: tempUseStoresError },
      ] = await Promise.all([
        supabase.from("stores").select("*"),
        supabase.from("store_payments").select("*"),
        supabase.from("payments").select("*"),
        supabase.from("temp_uses").select("*"),
        supabase.from("temp_use_stores").select("*"),
      ]);

      if (cancelled) return;

      const firstError =
        storesError || storePaymentsError || paymentsError || tempUsesError || tempUseStoresError;
      if (firstError) {
        console.error(firstError);
        setLoading(false);
        return;
      }

      const paymentIdsByStore = {};
      const lastConfirmedByStore = {};
      (storePaymentsData || []).forEach((row) => {
        if (!paymentIdsByStore[row.store_id]) paymentIdsByStore[row.store_id] = [];
        paymentIdsByStore[row.store_id].push(row.payment_id);

        if (
          row.last_confirmed &&
          (!lastConfirmedByStore[row.store_id] ||
            row.last_confirmed > lastConfirmedByStore[row.store_id])
        ) {
          lastConfirmedByStore[row.store_id] = row.last_confirmed;
        }
      });

      const mergedStores = (storesData || []).map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        x: storeCoord(s.id, "x"),
        y: storeCoord(s.id, "y"),
        lastConfirmed: lastConfirmedByStore[s.id] || null,
        payments: paymentIdsByStore[s.id] || [],
      }));

      const storeIdsByTempUse = {};
      (tempUseStoresData || []).forEach((row) => {
        if (!storeIdsByTempUse[row.temp_use_id]) storeIdsByTempUse[row.temp_use_id] = [];
        storeIdsByTempUse[row.temp_use_id].push(row.store_id);
      });

      const todayStr = new Date().toISOString().slice(0, 10);
      const mergedActiveTempUses = (tempUsesData || [])
        .filter((t) => t.expiry >= todayStr)
        .map((t) => ({
          id: t.id,
          name: t.name,
          region: t.region,
          expiry: t.expiry,
          storeIds: storeIdsByTempUse[t.id] || [],
        }));

      setStores(spreadStores(mergedStores));
      setPayments(paymentsData || []);
      setActiveTempUses(mergedActiveTempUses);
      setLoading(false);
    }

    fetchData();
    return () => {
      cancelled = true;
    };
  }, []);

  const paymentName = useMemo(() => {
    const map = {};
    payments.forEach((p) => (map[p.id] = p.name));
    return map;
  }, [payments]);

  const paymentCategories = useMemo(() => {
    const groups = {};
    payments.forEach((p) => {
      if (!groups[p.category]) groups[p.category] = [];
      groups[p.category].push({ id: p.id, name: p.name });
    });
    const orderedIds = [
      ...PAYMENT_CATEGORY_ORDER.filter((id) => groups[id]),
      ...Object.keys(groups).filter((id) => !PAYMENT_CATEGORY_ORDER.includes(id)),
    ];
    return orderedIds.map((id) => ({
      id,
      label: PAYMENT_CATEGORY_META[id]?.label || id,
      icon: PAYMENT_CATEGORY_META[id]?.icon || Wallet,
      items: groups[id],
    }));
  }, [payments]);

  const hasFilter = registered.length > 0;

  const visibleStores = useMemo(() => {
    return stores.filter((s) => category === "すべて" || s.category === category).filter(
      (s) => s.name.includes(query.trim())
    );
  }, [stores, category, query]);

  const isMatch = (store) =>
    !hasFilter || store.payments.some((p) => registered.includes(p));

  const storeTempUses = (storeId) =>
    activeTempUses.filter((t) => t.storeIds.includes(storeId));

  const filteredPaymentCategories = useMemo(() => {
    if (!paymentSearch.trim()) return paymentCategories;
    const q = paymentSearch.trim();
    return paymentCategories.map((cat) => ({
      ...cat,
      items: cat.items.filter((i) => i.name.includes(q)),
    })).filter((cat) => cat.items.length > 0);
  }, [paymentCategories, paymentSearch]);

  const openRegister = () => {
    setPending(registered);
    setPaymentSearch("");
    setSheet("register");
  };

  const togglePending = (id) => {
    setPending((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  const confirmRegister = () => {
    setRegistered(pending);
    setSheet(null);
    setToast(`${pending.length}件の決済を登録しました`);
  };

  const openStore = (store) => {
    setSelectedStore(store);
    setSheet("detail");
  };

  const openReport = () => {
    setReportPaymentId(selectedStore?.payments?.[0] || null);
    setReportDone(false);
    setReportError("");
    setSheet("report");
  };

  const openTempUseSheet = () => {
    setPendingTempUses(selectedTempUses);
    setSheet("tempuse");
  };

  const toggleTempUse = (id) => {
    setPendingTempUses((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  const confirmTempUse = () => {
    setSelectedTempUses(pendingTempUses);
    setSheet(null);
  };

  const openRequestMenu = () => {
    setRequestForm(null);
    setRequestDone(false);
    setRequestError("");
    setSheet("request");
  };

  const REQUEST_TYPE_DB = {
    store: "store_add",
    payment: "payment_add",
    tempuse: "tempuse_add",
    manage: "store_manage",
  };

  const buildRequestPayload = () => {
    if (requestForm === "store") {
      return { name: reqStoreName.trim(), category: reqStoreCategory };
    }
    if (requestForm === "payment") {
      return { name: reqPaymentName.trim() };
    }
    if (requestForm === "tempuse") {
      return {
        name: reqTempName.trim(),
        region: reqTempRegion.trim(),
        expiry: reqTempExpiry,
      };
    }
    if (requestForm === "manage") {
      return { store_id: reqManageStoreId };
    }
    return {};
  };

  const submitRequest = async () => {
    if (requestSubmitting) return;
    setRequestError("");
    setRequestSubmitting(true);

    const { error } = await supabase.from("requests").insert({
      type: REQUEST_TYPE_DB[requestForm],
      status: "pending",
      payload: buildRequestPayload(),
    });

    setRequestSubmitting(false);

    if (error) {
      console.error(error);
      setRequestError("送信に失敗しました。もう一度お試しください。");
      return;
    }

    setRequestDone(true);
    setTimeout(() => {
      setRequestForm(null);
      setRequestDone(false);
      setReqStoreName("");
      setReqPaymentName("");
      setReqTempName("");
      setReqTempRegion("");
      setReqTempExpiry("");
      setReqManageStoreId(null);
    }, 1300);
  };

  const submitReport = async (result) => {
    if (reportSubmitting) return;
    setReportError("");
    setReportSubmitting(true);

    const { error } = await supabase.from("user_reports").insert({
      store_id: selectedStore?.id,
      payment_id: reportPaymentId,
      result,
      reported_at: new Date().toISOString(),
    });

    setReportSubmitting(false);

    if (error) {
      console.error(error);
      setReportError("送信に失敗しました。もう一度お試しください。");
      return;
    }

    setReportDone(true);
    setTimeout(() => {
      setSheet("detail");
      setReportDone(false);
    }, 1300);
  };

  if (loading) {
    return (
      <div
        className="min-h-screen w-full flex items-center justify-center p-4 sm:p-8"
        style={{
          background: `radial-gradient(circle at 30% 20%, ${COLORS.inkSoft}, ${COLORS.ink})`,
          fontFamily: FONT.display,
        }}
      >
        <div
          className="relative flex w-full max-w-sm flex-col items-center justify-center gap-3 overflow-hidden rounded-[2.25rem] shadow-2xl"
          style={{
            height: "min(860px, 92vh)",
            background: COLORS.mist,
            border: `6px solid ${COLORS.ink}`,
          }}
        >
          <div
            className="h-8 w-8 animate-spin rounded-full border-2"
            style={{ borderColor: COLORS.line, borderTopColor: COLORS.teal }}
          />
          <p className="text-sm font-medium" style={{ color: COLORS.slate }}>
            読み込み中...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center p-4 sm:p-8"
      style={{
        background: `radial-gradient(circle at 30% 20%, ${COLORS.inkSoft}, ${COLORS.ink})`,
        fontFamily: FONT.display,
      }}
    >
      {/* Phone frame */}
      <div
        className="relative w-full max-w-sm overflow-hidden rounded-[2.25rem] shadow-2xl"
        style={{
          height: "min(860px, 92vh)",
          background: COLORS.mist,
          border: `6px solid ${COLORS.ink}`,
        }}
      >
        {/* Status notch */}
        <div
          className="absolute left-1/2 top-2 z-40 h-5 w-28 -translate-x-1/2 rounded-full"
          style={{ background: COLORS.ink }}
        />

        <div className="flex h-full w-full flex-col">
          {/* Top bar */}
          <div
            className="flex flex-col gap-2.5 px-4 pb-3 pt-8"
            style={{ background: COLORS.ink }}
          >
            <div className="flex items-center gap-2">
              <div
                className="flex flex-1 items-center gap-2 rounded-full px-3 py-2"
                style={{ background: "rgba(255,255,255,0.1)" }}
              >
                <Search size={16} color="#C7D2D4" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="店名で検索（例：イオン）"
                  className="w-full bg-transparent text-sm outline-none placeholder:text-slate-300"
                  style={{ color: COLORS.cream }}
                />
                {query && (
                  <button onClick={() => setQuery("")}>
                    <X size={14} color="#C7D2D4" />
                  </button>
                )}
              </div>
              <button
                onClick={openRegister}
                className="flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold"
                style={{
                  background: hasFilter ? COLORS.teal : "rgba(255,255,255,0.14)",
                  color: COLORS.cream,
                }}
              >
                <Wallet size={14} />
                {hasFilter ? `決済 ${registered.length}` : "決済を登録"}
              </button>
              <button
                onClick={openRequestMenu}
                aria-label="依頼する"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                style={{ background: "rgba(255,255,255,0.14)" }}
              >
                <Plus size={17} color={COLORS.cream} />
              </button>
            </div>
          </div>

          {/* Map canvas */}
          <div
            className="relative flex-1 overflow-hidden"
            style={{
              background: `repeating-linear-gradient(0deg, ${COLORS.paperLineSoft} 0px, ${COLORS.paperLineSoft} 1px, ${COLORS.paper} 1px, ${COLORS.paper} 34px), repeating-linear-gradient(90deg, ${COLORS.paperLineSoft} 0px, ${COLORS.paperLineSoft} 1px, transparent 1px, transparent 34px)`,
            }}
          >
            {/* decorative "roads" for a hand-drawn map feel */}
            <svg
              className="pointer-events-none absolute inset-0 h-full w-full"
              preserveAspectRatio="none"
              viewBox="0 0 100 100"
            >
              <path
                d="M -5 30 Q 40 10, 105 35"
                stroke={COLORS.paperLine}
                strokeWidth="2.2"
                fill="none"
              />
              <path
                d="M 15 -5 Q 35 55, 20 105"
                stroke={COLORS.paperLine}
                strokeWidth="2.2"
                fill="none"
              />
              <path
                d="M -5 70 Q 50 88, 105 65"
                stroke={COLORS.paperLine}
                strokeWidth="1.6"
                fill="none"
              />
            </svg>

            {/* current location marker */}
            <div
              className="absolute flex flex-col items-center"
              style={{ left: "50%", top: "50%", transform: "translate(-50%,-50%)" }}
            >
              <span
                className="mb-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold shadow-sm"
                style={{ background: COLORS.inkSoft, color: COLORS.cream }}
              >
                現在地
              </span>
              <div className="relative flex items-center justify-center">
                <div
                  className="absolute h-16 w-16 animate-ping rounded-full"
                  style={{ background: "rgba(107,122,128,0.25)" }}
                />
                <div
                  className="absolute h-9 w-9 rounded-full"
                  style={{ background: "rgba(107,122,128,0.18)" }}
                />
                <div
                  className="h-4 w-4 rounded-full"
                  style={{ background: COLORS.slate, border: "2.5px solid white" }}
                />
              </div>
            </div>

            {visibleStores.map((s) => (
              <Pin
                key={s.id}
                store={s}
                isMatch={isMatch(s)}
                dimmed={hasFilter && !isMatch(s)}
                hasTempUse={
                  selectedTempUses.length > 0 &&
                  storeTempUses(s.id).some((t) => selectedTempUses.includes(t.id))
                }
                onClick={openStore}
              />
            ))}

            {visibleStores.length === 0 && (
              <div
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-2xl px-4 py-3 text-center text-sm shadow-md"
                style={{ background: COLORS.cream, color: COLORS.slate }}
              >
                この条件に合うお店が見つかりません
              </div>
            )}

            {/* recenter + temp-use toggle */}
            <div className="absolute bottom-4 right-4 flex flex-col items-end gap-2">
              <button
                onClick={openTempUseSheet}
                className="flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-bold shadow-md"
                style={{
                  background: selectedTempUses.length > 0 ? COLORS.amber : COLORS.cream,
                  color: selectedTempUses.length > 0 ? COLORS.cream : COLORS.inkSoft,
                }}
              >
                <Ticket size={13} />
                {selectedTempUses.length > 0 ? `一時利用 ${selectedTempUses.length}` : "一時利用"}
              </button>
              <button
                className="flex h-10 w-10 items-center justify-center rounded-full shadow-md"
                style={{ background: COLORS.cream }}
              >
                <Navigation size={17} color={COLORS.ink} />
              </button>
            </div>

            {/* onboarding banner */}
            {!hasFilter && (
              <div
                className="absolute bottom-4 left-4 right-28 rounded-2xl px-4 py-3 shadow-lg"
                style={{ background: COLORS.ink }}
              >
                <p className="text-xs leading-relaxed" style={{ color: "#D8DEDF" }}>
                  自分の決済を登録すると、使えるお店だけを表示できます
                </p>
                <button
                  onClick={openRegister}
                  className="mt-2 rounded-full px-3 py-1.5 text-xs font-semibold"
                  style={{ background: COLORS.teal, color: COLORS.cream }}
                >
                  決済を登録する
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* Sheets                                                        */}
        {/* ------------------------------------------------------------- */}
        {sheet === "register" && (
          <>
            <SheetBackdrop onClose={() => setSheet(null)} />
            <div
              className="absolute inset-x-0 bottom-0 z-40 flex max-h-[88%] flex-col rounded-t-3xl shadow-2xl"
              style={{ background: COLORS.mist }}
            >
              <div className="flex items-center justify-between px-5 pb-2 pt-4">
                <h2 className="text-base font-bold" style={{ color: COLORS.ink }}>
                  自分の決済を登録
                </h2>
                <button onClick={() => setSheet(null)}>
                  <X size={20} color={COLORS.slate} />
                </button>
              </div>

              <div className="px-5 pb-2">
                <div
                  className="flex items-center gap-2 rounded-full px-3 py-2"
                  style={{ background: COLORS.cream, border: `1px solid ${COLORS.line}` }}
                >
                  <Search size={15} color={COLORS.slate} />
                  <input
                    value={paymentSearch}
                    onChange={(e) => setPaymentSearch(e.target.value)}
                    placeholder="決済を検索（例：Visa）"
                    className="w-full bg-transparent text-sm outline-none"
                    style={{ color: COLORS.ink }}
                  />
                </div>
              </div>

              {/* quick cash button */}
              <div className="px-5 pb-1 pt-1">
                <button
                  onClick={() => togglePending("cash")}
                  className="flex w-full items-center justify-between rounded-2xl px-4 py-3"
                  style={{
                    background: pending.includes("cash") ? COLORS.teal : COLORS.cream,
                    border: `1.5px solid ${pending.includes("cash") ? COLORS.teal : COLORS.line}`,
                  }}
                >
                  <span
                    className="flex items-center gap-2 text-sm font-semibold"
                    style={{ color: pending.includes("cash") ? COLORS.cream : COLORS.ink }}
                  >
                    <Banknote size={17} />
                    現金
                  </span>
                  {pending.includes("cash") && <Check size={17} color={COLORS.cream} strokeWidth={3} />}
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-5 pb-3 pt-2">
                {filteredPaymentCategories
                  .filter((cat) => cat.id !== "cash")
                  .map((cat) => (
                    <div key={cat.id} className="mb-4">
                      <div
                        className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide"
                        style={{ color: COLORS.slate }}
                      >
                        <cat.icon size={13} />
                        {cat.label}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {cat.items.map((item) => (
                          <PaymentChip
                            key={item.id}
                            id={item.id}
                            name={item.name}
                            selected={pending.includes(item.id)}
                            onToggle={togglePending}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                {filteredPaymentCategories.filter((c) => c.id !== "cash").length === 0 &&
                  !paymentSearch.includes("現") && (
                    <p className="py-4 text-center text-sm" style={{ color: COLORS.slate }}>
                      一致する決済が見つかりません
                    </p>
                  )}
              </div>

              <div className="px-5 pb-6 pt-2" style={{ borderTop: `1px solid ${COLORS.line}` }}>
                <button
                  disabled={pending.length === 0}
                  onClick={confirmRegister}
                  className="mt-3 w-full rounded-full py-3 text-sm font-bold transition-opacity"
                  style={{
                    background: COLORS.teal,
                    color: COLORS.cream,
                    opacity: pending.length === 0 ? 0.4 : 1,
                  }}
                >
                  登録完了{pending.length > 0 ? `（${pending.length}）` : ""}
                </button>
              </div>
            </div>
          </>
        )}

        {sheet === "tempuse" && (
          <>
            <SheetBackdrop onClose={() => setSheet(null)} />
            <div
              className="absolute inset-x-0 bottom-0 z-40 flex max-h-[80%] flex-col rounded-t-3xl shadow-2xl"
              style={{ background: COLORS.mist }}
            >
              <div className="flex items-center justify-between px-5 pb-2 pt-4">
                <div>
                  <h2 className="text-base font-bold" style={{ color: COLORS.ink }}>
                    一時利用を選ぶ
                  </h2>
                  <p className="text-xs" style={{ color: COLORS.slate }}>
                    地図に表示したい商品券・キャンペーンを選んでください
                  </p>
                </div>
                <button onClick={() => setSheet(null)}>
                  <X size={20} color={COLORS.slate} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-3">
                <div className="flex flex-col gap-2">
                  {activeTempUses.map((t) => {
                    const selected = pendingTempUses.includes(t.id);
                    return (
                      <button
                        key={t.id}
                        onClick={() => toggleTempUse(t.id)}
                        className="flex items-center justify-between rounded-2xl px-4 py-3 text-left"
                        style={{
                          background: selected ? COLORS.amberMist : COLORS.cream,
                          border: `1.5px solid ${selected ? COLORS.amber : COLORS.line}`,
                        }}
                      >
                        <div>
                          <p className="text-sm font-bold" style={{ color: COLORS.ink }}>
                            {t.name}
                          </p>
                          <p className="mt-0.5 text-[11px]" style={{ color: COLORS.slate }}>
                            {t.region} ・ 期限 {t.expiry.replaceAll("-", "/")}まで ・ 対象
                            {t.storeIds.length}店舗
                          </p>
                        </div>
                        <div
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                          style={{
                            background: selected ? COLORS.amber : "transparent",
                            border: `1.5px solid ${selected ? COLORS.amber : COLORS.line}`,
                          }}
                        >
                          {selected && <Check size={14} color={COLORS.cream} strokeWidth={3} />}
                        </div>
                      </button>
                    );
                  })}
                </div>
                {activeTempUses.length === 0 && (
                  <p className="py-6 text-center text-sm" style={{ color: COLORS.slate }}>
                    現在利用できる一時利用はありません
                  </p>
                )}
              </div>

              <div className="px-5 pb-6 pt-2" style={{ borderTop: `1px solid ${COLORS.line}` }}>
                <div className="flex gap-2 pt-3">
                  {pendingTempUses.length > 0 && (
                    <button
                      onClick={() => setPendingTempUses([])}
                      className="rounded-full px-4 py-3 text-sm font-bold"
                      style={{ background: COLORS.cream, color: COLORS.slate, border: `1.5px solid ${COLORS.line}` }}
                    >
                      解除
                    </button>
                  )}
                  <button
                    onClick={confirmTempUse}
                    className="flex-1 rounded-full py-3 text-sm font-bold"
                    style={{ background: COLORS.amber, color: COLORS.cream }}
                  >
                    地図に反映{pendingTempUses.length > 0 ? `（${pendingTempUses.length}）` : ""}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}

        {sheet === "request" && (
          <>
            <SheetBackdrop onClose={() => setSheet(null)} />
            <div
              className="absolute inset-x-0 bottom-0 z-40 flex max-h-[85%] flex-col rounded-t-3xl shadow-2xl"
              style={{ background: COLORS.mist }}
            >
              {requestForm === null && (
                <>
                  <div className="flex items-center justify-between px-5 pb-2 pt-4">
                    <h2 className="text-base font-bold" style={{ color: COLORS.ink }}>
                      依頼する
                    </h2>
                    <button onClick={() => setSheet(null)}>
                      <X size={20} color={COLORS.slate} />
                    </button>
                  </div>
                  <p className="px-5 pb-3 text-xs" style={{ color: COLORS.slate }}>
                    依頼は運営が確認したうえで正式に登録されます。依頼だけで情報がすぐ変わることはありません。
                  </p>
                  <div className="flex flex-col gap-2 px-5 pb-6">
                    {[
                      {
                        id: "store",
                        icon: MapPin,
                        title: "店舗を追加してほしい",
                        desc: "地図にまだ載っていないお店を依頼",
                      },
                      {
                        id: "payment",
                        icon: CreditCard,
                        title: "決済方法を追加してほしい",
                        desc: "一覧にない決済方法を依頼",
                      },
                      {
                        id: "tempuse",
                        icon: Ticket,
                        title: "一時利用を追加してほしい",
                        desc: "商品券・キャンペーンを依頼",
                      },
                      {
                        id: "manage",
                        icon: Flag,
                        title: "自分の店舗を管理したい",
                        desc: "店舗管理者としての申請",
                      },
                    ]
                      .filter((item) => item.id !== "manage") // temporarily hidden from the menu
                      .map((item) => (
                      <button
                        key={item.id}
                        onClick={() => {
                          setRequestError("");
                          setRequestForm(item.id);
                        }}
                        className="flex items-center gap-3 rounded-2xl px-4 py-3 text-left"
                        style={{ background: COLORS.cream, border: `1px solid ${COLORS.line}` }}
                      >
                        <div
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                          style={{ background: COLORS.tealMist }}
                        >
                          <item.icon size={16} color={COLORS.tealDeep} />
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-bold" style={{ color: COLORS.ink }}>
                            {item.title}
                          </p>
                          <p className="text-[11px]" style={{ color: COLORS.slate }}>
                            {item.desc}
                          </p>
                        </div>
                        <ChevronUp size={16} color={COLORS.slate} style={{ transform: "rotate(90deg)" }} />
                      </button>
                    ))}
                  </div>
                </>
              )}

              {requestForm !== null && (
                <div className="flex flex-1 flex-col overflow-y-auto px-5 pb-6 pt-4">
                  <div className="mb-4 flex items-center gap-2">
                    <button
                      onClick={() => {
                        setRequestError("");
                        setRequestForm(null);
                      }}
                    >
                      <ChevronLeft size={20} color={COLORS.slate} />
                    </button>
                    <h2 className="text-base font-bold" style={{ color: COLORS.ink }}>
                      {requestForm === "store" && "店舗を追加してほしい"}
                      {requestForm === "payment" && "決済方法を追加してほしい"}
                      {requestForm === "tempuse" && "一時利用を追加してほしい"}
                      {requestForm === "manage" && "自分の店舗を管理したい"}
                    </h2>
                  </div>

                  {!requestDone ? (
                    <>
                      {requestForm === "store" && (
                        <div className="flex flex-col gap-4">
                          <div>
                            <p className="mb-1.5 text-xs font-bold" style={{ color: COLORS.slate }}>
                              Google Mapsでお店を検索
                            </p>
                            <input
                              value={reqStoreName}
                              onChange={(e) => setReqStoreName(e.target.value)}
                              placeholder="店名を入力（例：〇〇食堂）"
                              className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                              style={{ background: COLORS.cream, border: `1px solid ${COLORS.line}`, color: COLORS.ink }}
                            />
                          </div>
                          <div>
                            <p className="mb-1.5 text-xs font-bold" style={{ color: COLORS.slate }}>
                              店舗カテゴリ
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {STORE_CATEGORIES.filter((c) => c.id !== "すべて").map((c) => (
                                <button
                                  key={c.id}
                                  onClick={() => setReqStoreCategory(c.id)}
                                  className="rounded-full px-3 py-1.5 text-xs font-medium"
                                  style={{
                                    background: reqStoreCategory === c.id ? COLORS.teal : COLORS.cream,
                                    color: reqStoreCategory === c.id ? COLORS.cream : COLORS.inkSoft,
                                    border: `1px solid ${reqStoreCategory === c.id ? COLORS.teal : COLORS.line}`,
                                  }}
                                >
                                  {c.id}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}

                      {requestForm === "payment" && (
                        <div>
                          <p className="mb-1.5 text-xs font-bold" style={{ color: COLORS.slate }}>
                            追加してほしい決済の名称
                          </p>
                          <input
                            value={reqPaymentName}
                            onChange={(e) => setReqPaymentName(e.target.value)}
                            placeholder="例：PayPalペイ"
                            className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                            style={{ background: COLORS.cream, border: `1px solid ${COLORS.line}`, color: COLORS.ink }}
                          />
                          <p className="mt-2 text-[11px]" style={{ color: COLORS.slate }}>
                            一覧（決済登録画面）に見つからない場合のみ依頼してください
                          </p>
                        </div>
                      )}

                      {requestForm === "tempuse" && (
                        <div className="flex flex-col gap-4">
                          <div>
                            <p className="mb-1.5 text-xs font-bold" style={{ color: COLORS.slate }}>
                              名称
                            </p>
                            <input
                              value={reqTempName}
                              onChange={(e) => setReqTempName(e.target.value)}
                              placeholder="例：〇〇市 生活応援クーポン"
                              className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                              style={{ background: COLORS.cream, border: `1px solid ${COLORS.line}`, color: COLORS.ink }}
                            />
                          </div>
                          <div>
                            <p className="mb-1.5 text-xs font-bold" style={{ color: COLORS.slate }}>
                              対象地域
                            </p>
                            <input
                              value={reqTempRegion}
                              onChange={(e) => setReqTempRegion(e.target.value)}
                              placeholder="例：石川県〇〇市"
                              className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                              style={{ background: COLORS.cream, border: `1px solid ${COLORS.line}`, color: COLORS.ink }}
                            />
                          </div>
                          <div>
                            <p className="mb-1.5 text-xs font-bold" style={{ color: COLORS.slate }}>
                              利用期限
                            </p>
                            <input
                              type="date"
                              value={reqTempExpiry}
                              onChange={(e) => setReqTempExpiry(e.target.value)}
                              className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                              style={{ background: COLORS.cream, border: `1px solid ${COLORS.line}`, color: COLORS.ink }}
                            />
                          </div>
                        </div>
                      )}

                      {requestForm === "manage" && (
                        <div>
                          <p className="mb-1.5 text-xs font-bold" style={{ color: COLORS.slate }}>
                            管理者になりたい店舗を選択
                          </p>
                          <div className="flex flex-col gap-2">
                            {stores.map((s) => (
                              <button
                                key={s.id}
                                onClick={() => setReqManageStoreId(s.id)}
                                className="flex items-center justify-between rounded-xl px-3.5 py-2.5 text-left text-sm"
                                style={{
                                  background: reqManageStoreId === s.id ? COLORS.tealMist : COLORS.cream,
                                  border: `1.5px solid ${reqManageStoreId === s.id ? COLORS.teal : COLORS.line}`,
                                  color: COLORS.ink,
                                }}
                              >
                                {s.name}
                                {reqManageStoreId === s.id && <Check size={15} color={COLORS.tealDeep} strokeWidth={3} />}
                              </button>
                            ))}
                          </div>
                          <p className="mt-2 text-[11px]" style={{ color: COLORS.slate }}>
                            申請後、運営の承認を経て店舗管理者になります
                          </p>
                        </div>
                      )}

                      <button
                        onClick={submitRequest}
                        disabled={
                          requestSubmitting ||
                          (requestForm === "store" && !reqStoreName.trim()) ||
                          (requestForm === "payment" && !reqPaymentName.trim()) ||
                          (requestForm === "tempuse" && (!reqTempName.trim() || !reqTempRegion.trim() || !reqTempExpiry)) ||
                          (requestForm === "manage" && !reqManageStoreId)
                        }
                        className="mt-6 w-full rounded-full py-3 text-sm font-bold transition-opacity"
                        style={{
                          background: COLORS.teal,
                          color: COLORS.cream,
                          opacity:
                            requestSubmitting ||
                            (requestForm === "store" && !reqStoreName.trim()) ||
                            (requestForm === "payment" && !reqPaymentName.trim()) ||
                            (requestForm === "tempuse" && (!reqTempName.trim() || !reqTempRegion.trim() || !reqTempExpiry)) ||
                            (requestForm === "manage" && !reqManageStoreId)
                              ? 0.4
                              : 1,
                        }}
                      >
                        依頼を送信
                      </button>

                      {requestError && (
                        <p className="mt-3 text-center text-xs font-semibold" style={{ color: COLORS.coral }}>
                          {requestError}
                        </p>
                      )}
                    </>
                  ) : (
                    <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10">
                      <div
                        className="flex h-12 w-12 items-center justify-center rounded-full"
                        style={{ background: COLORS.tealMist }}
                      >
                        <Check size={22} color={COLORS.tealDeep} strokeWidth={3} />
                      </div>
                      <p className="text-sm font-bold" style={{ color: COLORS.ink }}>
                        依頼を送信しました
                      </p>
                      <p className="text-center text-[11px]" style={{ color: COLORS.slate }}>
                        運営の確認後、正式に反映されます
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {sheet === "detail" && selectedStore && (
          <>
            <SheetBackdrop onClose={() => setSheet(null)} />
            <div
              className="absolute inset-x-0 bottom-0 z-40 rounded-t-3xl px-5 pb-6 pt-3 shadow-2xl"
              style={{ background: COLORS.mist }}
            >
              <div className="mx-auto mb-3 h-1 w-10 rounded-full" style={{ background: COLORS.line }} />
              <div className="mb-1 flex items-start justify-between">
                <div>
                  <span
                    className="mb-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold"
                    style={{ background: COLORS.tealMist, color: COLORS.tealDeep }}
                  >
                    {selectedStore.category}
                  </span>
                  <h2 className="text-lg font-bold leading-snug" style={{ color: COLORS.ink }}>
                    {selectedStore.name}
                  </h2>
                </div>
                <button onClick={() => setSheet(null)}>
                  <X size={20} color={COLORS.slate} />
                </button>
              </div>

              <p className="mb-2 mt-3 text-xs font-bold" style={{ color: COLORS.slate }}>
                使える決済
              </p>
              <div className="mb-4 flex flex-wrap gap-2">
                {selectedStore.payments.map((p) => {
                  const owned = registered.includes(p);
                  return (
                    <span
                      key={p}
                      className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium"
                      style={{
                        background: owned ? COLORS.tealMist : COLORS.cream,
                        color: owned ? COLORS.tealDeep : COLORS.inkSoft,
                        border: `1px solid ${owned ? COLORS.teal : COLORS.line}`,
                      }}
                    >
                      {owned && <Check size={12} strokeWidth={3} />}
                      {paymentName[p]}
                    </span>
                  );
                })}
              </div>

              <p className="mb-4 text-xs" style={{ color: COLORS.slate }}>
                最終確認：{selectedStore.lastConfirmed || "未確認"}
              </p>

              {storeTempUses(selectedStore.id).length > 0 && (
                <div className="mb-4">
                  <p className="mb-2 flex items-center gap-1 text-xs font-bold" style={{ color: COLORS.slate }}>
                    <Ticket size={12} />
                    使える一時利用（商品券・キャンペーン）
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {storeTempUses(selectedStore.id).map((t) => {
                      const selected = selectedTempUses.includes(t.id);
                      return (
                        <div
                          key={t.id}
                          className="rounded-xl px-3 py-2"
                          style={{
                            background: COLORS.amberMist,
                            border: selected ? `1.5px solid ${COLORS.amber}` : "1.5px solid transparent",
                          }}
                        >
                          <p className="text-xs font-bold" style={{ color: "#8A5F14" }}>
                            {t.name}
                          </p>
                          <p className="text-[11px]" style={{ color: "#9C7530" }}>
                            {t.region} ・ 期限 {t.expiry.replaceAll("-", "/")}まで
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                    selectedStore.name
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-full py-3 text-sm font-bold"
                  style={{ background: COLORS.ink, color: COLORS.cream }}
                >
                  <ExternalLink size={15} />
                  Google Mapsで開く
                </a>
                <button
                  onClick={openReport}
                  className="flex items-center justify-center gap-1.5 rounded-full px-4 py-3 text-sm font-bold"
                  style={{ background: COLORS.cream, color: COLORS.coral, border: `1.5px solid ${COLORS.coral}` }}
                >
                  <Flag size={15} />
                  報告
                </button>
              </div>
            </div>
          </>
        )}

        {sheet === "report" && selectedStore && (
          <>
            <SheetBackdrop onClose={() => setSheet("detail")} />
            <div
              className="absolute inset-x-0 bottom-0 z-40 rounded-t-3xl px-5 pb-6 pt-3 shadow-2xl"
              style={{ background: COLORS.mist }}
            >
              <div className="mx-auto mb-3 h-1 w-10 rounded-full" style={{ background: COLORS.line }} />
              {!reportDone ? (
                <>
                  <div className="mb-4 flex items-center gap-2">
                    <button onClick={() => setSheet("detail")}>
                      <ChevronLeft size={20} color={COLORS.slate} />
                    </button>
                    <h2 className="text-base font-bold" style={{ color: COLORS.ink }}>
                      決済情報を報告
                    </h2>
                  </div>

                  <p className="mb-2 text-xs font-bold" style={{ color: COLORS.slate }}>
                    どの決済について報告しますか？
                  </p>
                  <div className="mb-5 flex flex-wrap gap-2">
                    {selectedStore.payments.map((p) => (
                      <button
                        key={p}
                        onClick={() => setReportPaymentId(p)}
                        className="rounded-full px-3.5 py-2 text-sm font-medium"
                        style={{
                          background: reportPaymentId === p ? COLORS.ink : COLORS.cream,
                          color: reportPaymentId === p ? COLORS.cream : COLORS.inkSoft,
                          border: `1.5px solid ${reportPaymentId === p ? COLORS.ink : COLORS.line}`,
                        }}
                      >
                        {paymentName[p]}
                      </button>
                    ))}
                  </div>

                  <p className="mb-2 text-xs font-bold" style={{ color: COLORS.slate }}>
                    {paymentName[reportPaymentId]}は使えましたか？
                  </p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => submitReport("ok")}
                      disabled={reportSubmitting}
                      className="flex flex-1 flex-col items-center gap-1 rounded-2xl py-4 transition-opacity disabled:opacity-50"
                      style={{ background: COLORS.tealMist, border: `1.5px solid ${COLORS.teal}` }}
                    >
                      <Check size={20} color={COLORS.tealDeep} />
                      <span className="text-sm font-bold" style={{ color: COLORS.tealDeep }}>
                        使えた
                      </span>
                    </button>
                    <button
                      onClick={() => submitReport("ng")}
                      disabled={reportSubmitting}
                      className="flex flex-1 flex-col items-center gap-1 rounded-2xl py-4 transition-opacity disabled:opacity-50"
                      style={{ background: COLORS.coralMist, border: `1.5px solid ${COLORS.coral}` }}
                    >
                      <X size={20} color={COLORS.coral} />
                      <span className="text-sm font-bold" style={{ color: COLORS.coral }}>
                        使えなかった
                      </span>
                    </button>
                  </div>

                  {reportError && (
                    <p className="mt-3 text-center text-xs font-semibold" style={{ color: COLORS.coral }}>
                      {reportError}
                    </p>
                  )}

                  <p className="mt-4 text-center text-[11px] leading-relaxed" style={{ color: COLORS.slate }}>
                    報告だけで正式な店舗情報がすぐに変わることはありません。
                    <br />
                    複数の報告が集まった場合に運営が確認します。
                  </p>
                </>
              ) : (
                <div className="flex flex-col items-center gap-2 py-6">
                  <div
                    className="flex h-12 w-12 items-center justify-center rounded-full"
                    style={{ background: COLORS.tealMist }}
                  >
                    <Check size={22} color={COLORS.tealDeep} strokeWidth={3} />
                  </div>
                  <p className="text-sm font-bold" style={{ color: COLORS.ink }}>
                    報告ありがとうございました
                  </p>
                </div>
              )}
            </div>
          </>
        )}

        {/* toast */}
        {toast && (
          <div
            className="absolute bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full px-4 py-2 text-xs font-semibold shadow-lg"
            style={{ background: COLORS.ink, color: COLORS.cream }}
          >
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}
