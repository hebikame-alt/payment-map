import React, { useEffect, useState } from "react";
import supabase from "./lib/supabaseClient";

const REQUEST_TYPE_LABEL = {
  store_add: "店舗追加",
  payment_add: "決済追加",
  tempuse_add: "一時利用追加",
  store_manage: "店舗管理申請",
};

function formatPayload(payload) {
  if (!payload || typeof payload !== "object") return "-";
  const entries = Object.entries(payload);
  if (entries.length === 0) return "-";
  return entries.map(([key, value]) => `${key}: ${value}`).join(" / ");
}

// Renders each request type's payload the way a reviewer actually wants to
// read it, instead of a raw key:value dump.
function formatRequestContent(row, storeNameById) {
  const payload = row.payload || {};
  switch (row.type) {
    case "store_add":
      return `${payload.name || "-"}（${payload.category || "-"}）`;
    case "payment_add":
      return payload.name || "-";
    case "tempuse_add":
      return [payload.name, payload.region, payload.expiry].filter(Boolean).join(" / ");
    case "store_manage":
      return storeNameById[payload.store_id] || "(店舗が見つかりません)";
    default:
      return formatPayload(payload);
  }
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("ja-JP");
}

const PAYMENT_CATEGORY_OPTIONS = [
  { id: "code", label: "コード決済" },
  { id: "credit", label: "クレジットカード" },
  { id: "cash", label: "現金" },
  { id: "transit", label: "交通系" },
];

function randomAlnum() {
  return Math.random().toString(36).slice(2, 10);
}

// Half-width alphanumeric only, lowercase, no spaces — e.g. "LINE Pay" -> "linepay".
// NFKC first so full-width input ("ＬＩＮＥ Ｐａｙ") collapses to half-width too.
function slugifyPaymentName(name) {
  return (name || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

// Builds a payment id from the (edited) display name, falling back to a
// random string when nothing alphanumeric survives, and appending a
// sequential suffix if the base id already exists.
function buildUniquePaymentId(name, existingIds) {
  const base = slugifyPaymentName(name) || `payment_${randomAlnum()}`;
  if (!existingIds.includes(base)) return base;
  let n = 2;
  while (existingIds.includes(`${base}${n}`)) n++;
  return `${base}${n}`;
}

const UI = {
  pageBg: "#f4f5f7",
  card: "#ffffff",
  border: "#e5e7eb",
  text: "#1f2933",
  muted: "#6b7280",
  requestTint: "#eff6ff",
  requestAccent: "#1d4ed8",
  requestBorder: "#bfdbfe",
  flaggedTint: "#fef2f2",
  flaggedAccent: "#b91c1c",
  flaggedBorder: "#fecaca",
  danger: "#c0392b",
  successBg: "#ecfdf3",
  successText: "#166534",
  successBorder: "#bbf7d0",
};

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setLoading(false);
    if (signInError) {
      setError("ログインに失敗しました。メールアドレスとパスワードを確認してください。");
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: UI.pageBg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          width: 360,
          maxWidth: "90vw",
          textAlign: "left",
          background: UI.card,
          border: `1px solid ${UI.border}`,
          borderRadius: 12,
          padding: 28,
          boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
        }}
      >
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16, color: UI.text }}>
          管理画面ログイン
        </h1>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm" style={{ color: UI.text }}>
            メールアドレス
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded px-3 py-2 text-sm"
              style={{ border: `1px solid ${UI.border}` }}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm" style={{ color: UI.text }}>
            パスワード
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded px-3 py-2 text-sm"
              style={{ border: `1px solid ${UI.border}` }}
            />
          </label>
          {error && (
            <p className="text-sm" style={{ color: UI.danger }}>
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="mt-2 rounded px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: "#333" }}
          >
            {loading ? "ログイン中..." : "ログイン"}
          </button>
        </form>
      </div>
    </div>
  );
}

function SectionCard({ accentTint, accentColor, accentBorder, title, children }) {
  return (
    <section
      className="mb-8"
      style={{
        background: UI.card,
        border: `1px solid ${UI.border}`,
        borderRadius: 12,
        overflow: "hidden",
        boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
      }}
    >
      <div
        style={{
          padding: "12px 18px",
          background: accentTint,
          borderBottom: `1px solid ${accentBorder}`,
        }}
      >
        <h2 style={{ fontSize: 15, fontWeight: 700, color: accentColor, margin: 0 }}>{title}</h2>
      </div>
      <div style={{ padding: 18 }}>{children}</div>
    </section>
  );
}

function AdminDashboard({ session }) {
  const [pendingRequests, setPendingRequests] = useState([]);
  const [flaggedIssues, setFlaggedIssues] = useState([]);
  const [storeNameById, setStoreNameById] = useState({});
  const [loadingData, setLoadingData] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [decidingId, setDecidingId] = useState(null);
  const [actionError, setActionError] = useState("");
  const [categoryPromptId, setCategoryPromptId] = useState(null);
  const [paymentDraftName, setPaymentDraftName] = useState("");
  const [paymentDraftCategory, setPaymentDraftCategory] = useState(null);
  const [toast, setToast] = useState("");

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  const loadData = async () => {
    setLoadingData(true);
    setLoadError("");

    const [
      { data: requestsData, error: requestsError },
      { data: flaggedData, error: flaggedError },
      { data: storesData, error: storesError },
      { data: paymentsData, error: paymentsError },
    ] = await Promise.all([
      supabase
        .from("requests")
        .select("*")
        .eq("status", "pending")
        .order("submitted_at", { ascending: false }),
      supabase.from("flagged_payment_issues_snapshot").select("*"),
      supabase.from("stores").select("id, name"),
      supabase.from("payments").select("id, name"),
    ]);

    const firstError = requestsError || flaggedError || storesError || paymentsError;
    if (firstError) {
      console.error(firstError);
      setLoadError("データの取得に失敗しました。");
      setLoadingData(false);
      return;
    }

    const storeNameMap = {};
    (storesData || []).forEach((s) => (storeNameMap[s.id] = s.name));
    const paymentNameById = {};
    (paymentsData || []).forEach((p) => (paymentNameById[p.id] = p.name));

    const mergedFlagged = (flaggedData || []).map((row) => ({
      ...row,
      storeName: storeNameMap[row.store_id] || row.store_id,
      paymentName: paymentNameById[row.payment_id] || row.payment_id,
    }));

    setPendingRequests(requestsData || []);
    setFlaggedIssues(mergedFlagged);
    setStoreNameById(storeNameMap);
    setLoadingData(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const markApproved = async (row) => {
    const { error } = await supabase
      .from("requests")
      .update({ status: "approved" })
      .eq("id", row.id);
    if (error) {
      console.error(error);
      setActionError("登録はできましたが、ステータスの更新に失敗しました。");
      return false;
    }
    setPendingRequests((prev) => prev.filter((r) => r.id !== row.id));
    setToast("承認しました");
    return true;
  };

  const handleApprove = async (row) => {
    setActionError("");

    if (row.type === "payment_add") {
      setCategoryPromptId(row.id);
      setPaymentDraftName(row.payload?.name || "");
      setPaymentDraftCategory(null);
      return;
    }

    setDecidingId(row.id);

    let insertError = null;
    if (row.type === "store_add") {
      ({ error: insertError } = await supabase.from("stores").insert({
        name: row.payload?.name,
        category: row.payload?.category,
      }));
    } else if (row.type === "tempuse_add") {
      ({ error: insertError } = await supabase.from("temp_uses").insert({
        name: row.payload?.name,
        expiry: row.payload?.expiry,
        published: true,
      }));
    }
    // store_manage has no table to insert into — status change only.

    if (insertError) {
      console.error(insertError);
      setDecidingId(null);
      setActionError("登録に失敗しました。ステータスは変更していません。");
      return;
    }

    await markApproved(row);
    setDecidingId(null);
  };

  const handleApprovePayment = async (row, category, editedName) => {
    setActionError("");
    setDecidingId(row.id);

    const finalName = editedName.trim();

    const { data: existingPayments, error: idsError } = await supabase
      .from("payments")
      .select("id");

    if (idsError) {
      console.error(idsError);
      setDecidingId(null);
      setActionError("登録に失敗しました。ステータスは変更していません。");
      return;
    }

    const existingIds = (existingPayments || []).map((p) => p.id);
    const id = buildUniquePaymentId(finalName, existingIds);

    const { error: insertError } = await supabase.from("payments").insert({
      id,
      name: finalName,
      category,
    });

    if (insertError) {
      console.error(insertError);
      setDecidingId(null);
      setActionError("登録に失敗しました。ステータスは変更していません。");
      return;
    }

    await markApproved(row);
    setDecidingId(null);
    setCategoryPromptId(null);
    setPaymentDraftName("");
    setPaymentDraftCategory(null);
  };

  const handleReject = async (id) => {
    setActionError("");
    setDecidingId(id);
    const { error } = await supabase.from("requests").update({ status: "rejected" }).eq("id", id);
    setDecidingId(null);
    if (error) {
      console.error(error);
      setActionError("更新に失敗しました。もう一度お試しください。");
      return;
    }
    setPendingRequests((prev) => prev.filter((r) => r.id !== id));
    setToast("却下しました");
  };

  const thStyle = (accent) => ({
    padding: "10px 14px",
    borderBottom: `1px solid ${accent}`,
    textAlign: "left",
    fontSize: 12.5,
    fontWeight: 700,
    color: UI.muted,
    whiteSpace: "nowrap",
  });
  const tdStyle = {
    padding: "10px 14px",
    borderBottom: `1px solid ${UI.border}`,
    color: UI.text,
    verticalAlign: "top",
  };

  return (
    <div style={{ minHeight: "100vh", background: UI.pageBg }}>
      <div style={{ maxWidth: 1040, margin: "0 auto", padding: "28px 20px", textAlign: "left" }}>
        <div className="mb-6 flex items-center justify-between">
          <h1 style={{ fontSize: 22, fontWeight: 700, color: UI.text }}>運営管理画面</h1>
          <div className="flex items-center gap-3">
            <span className="text-sm" style={{ color: UI.muted }}>
              {session.user?.email}
            </span>
            <button
              onClick={() => supabase.auth.signOut()}
              className="rounded px-3 py-1.5 text-sm font-semibold"
              style={{ background: "#eee", border: `1px solid ${UI.border}`, color: UI.text }}
            >
              ログアウト
            </button>
          </div>
        </div>

        {toast && (
          <p
            className="mb-4 text-sm font-semibold"
            style={{
              color: UI.successText,
              background: UI.successBg,
              border: `1px solid ${UI.successBorder}`,
              borderRadius: 8,
              padding: "8px 12px",
            }}
          >
            {toast}
          </p>
        )}
        {loadError && (
          <p className="mb-4 text-sm" style={{ color: UI.danger }}>
            {loadError}
          </p>
        )}
        {actionError && (
          <p className="mb-4 text-sm" style={{ color: UI.danger }}>
            {actionError}
          </p>
        )}

        {loadingData ? (
          <p className="text-sm" style={{ color: UI.muted }}>
            読み込み中...
          </p>
        ) : (
          <>
            <SectionCard
              title={`未処理の依頼（${pendingRequests.length}件）`}
              accentTint={UI.requestTint}
              accentColor={UI.requestAccent}
              accentBorder={UI.requestBorder}
            >
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                  <thead>
                    <tr>
                      <th style={thStyle(UI.requestBorder)}>種別</th>
                      <th style={thStyle(UI.requestBorder)}>内容</th>
                      <th style={thStyle(UI.requestBorder)}>送信日時</th>
                      <th style={thStyle(UI.requestBorder)}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingRequests.map((row) => {
                      const isBusy = decidingId === row.id;
                      return (
                        <tr key={row.id}>
                          <td style={tdStyle}>{REQUEST_TYPE_LABEL[row.type] || row.type}</td>
                          <td style={tdStyle}>{formatRequestContent(row, storeNameById)}</td>
                          <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                            {formatDate(row.submitted_at)}
                          </td>
                          <td
                            style={{
                              ...tdStyle,
                              whiteSpace: categoryPromptId === row.id ? "normal" : "nowrap",
                              minWidth: categoryPromptId === row.id ? 260 : undefined,
                            }}
                          >
                            {isBusy ? (
                              <span className="text-xs font-semibold" style={{ color: UI.muted }}>
                                処理中...
                              </span>
                            ) : categoryPromptId === row.id ? (
                              <div className="flex flex-col gap-2">
                                <input
                                  type="text"
                                  value={paymentDraftName}
                                  onChange={(e) => setPaymentDraftName(e.target.value)}
                                  placeholder="正式な決済名"
                                  className="rounded px-2 py-1 text-xs"
                                  style={{ border: `1px solid ${UI.border}`, width: "100%" }}
                                />
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="text-xs" style={{ color: UI.muted }}>
                                    カテゴリ:
                                  </span>
                                  {PAYMENT_CATEGORY_OPTIONS.map((opt) => (
                                    <button
                                      key={opt.id}
                                      onClick={() => setPaymentDraftCategory(opt.id)}
                                      className="rounded px-2 py-1 text-xs font-semibold"
                                      style={
                                        paymentDraftCategory === opt.id
                                          ? { background: "#2e8b57", color: "#fff" }
                                          : { background: "#eee", border: `1px solid ${UI.border}`, color: UI.text }
                                      }
                                    >
                                      {opt.label}
                                    </button>
                                  ))}
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <button
                                    onClick={() => handleApprovePayment(row, paymentDraftCategory, paymentDraftName)}
                                    disabled={!paymentDraftCategory || !paymentDraftName.trim()}
                                    className="rounded px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
                                    style={{ background: "#2e8b57" }}
                                  >
                                    確定
                                  </button>
                                  <button
                                    onClick={() => {
                                      setCategoryPromptId(null);
                                      setPaymentDraftName("");
                                      setPaymentDraftCategory(null);
                                    }}
                                    className="rounded px-2.5 py-1 text-xs font-semibold"
                                    style={{ background: "#eee", border: `1px solid ${UI.border}` }}
                                  >
                                    キャンセル
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <button
                                  onClick={() => handleApprove(row)}
                                  className="mr-2 rounded px-2.5 py-1 text-xs font-semibold text-white"
                                  style={{ background: "#2e8b57" }}
                                >
                                  承認
                                </button>
                                <button
                                  onClick={() => handleReject(row.id)}
                                  className="rounded px-2.5 py-1 text-xs font-semibold text-white"
                                  style={{ background: UI.danger }}
                                >
                                  却下
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {pendingRequests.length === 0 && (
                      <tr>
                        <td colSpan={4} style={{ padding: "16px 14px", textAlign: "center", color: UI.muted }}>
                          未処理の依頼はありません
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </SectionCard>

            <SectionCard
              title="要確認一覧（決済NGの報告が続いている店舗）"
              accentTint={UI.flaggedTint}
              accentColor={UI.flaggedAccent}
              accentBorder={UI.flaggedBorder}
            >
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                  <thead>
                    <tr>
                      <th style={thStyle(UI.flaggedBorder)}>店舗名</th>
                      <th style={thStyle(UI.flaggedBorder)}>決済名</th>
                      <th style={thStyle(UI.flaggedBorder)}>NG日数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flaggedIssues.map((row, i) => (
                      <tr key={`${row.store_id}-${row.payment_id}-${i}`}>
                        <td style={tdStyle}>{row.storeName}</td>
                        <td style={tdStyle}>{row.paymentName}</td>
                        <td style={tdStyle}>{row.ng_days}</td>
                      </tr>
                    ))}
                    {flaggedIssues.length === 0 && (
                      <tr>
                        <td colSpan={3} style={{ padding: "16px 14px", textAlign: "center", color: UI.muted }}>
                          要確認の店舗はありません
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          </>
        )}
      </div>
    </div>
  );
}

export default function AdminApp() {
  const [session, setSession] = useState(undefined); // undefined = loading, null = signed out

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#666" }}>読み込み中...</div>
    );
  }

  return session ? <AdminDashboard session={session} /> : <LoginForm />;
}
