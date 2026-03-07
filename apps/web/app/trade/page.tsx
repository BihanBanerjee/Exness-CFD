"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createChart, CandlestickSeries, type IChartApi, type ISeriesApi, type CandlestickData, ColorType } from "lightweight-charts";
import api from "@/lib/axios";

// ─── Types ───────────────────────────────────────────────────────────
type Asset = "BTCUSDT" | "ETHUSDT" | "SOLUSDT";
type Duration = "30s" | "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
type OrderType = "LONG" | "SHORT";

interface PriceData {
  symbol: string;
  bidPrice: number;
  askPrice: number;
}

interface Order {
  orderId: string;
  asset: string;
  orderType: string;
  leverage: number;
  margin: string;
  executionPrice: string;
  executionPriceInt: string;
  qtyInt: string;
  stopLossInt: string;
  takeProfitInt: string;
  finalPnLInt: string;
  liquidationPrice: string;
  status: string;
  createdAt: string;
  closeReason?: "MANUAL" | "MARGIN_CALL" | "STOP_LOSS" | "TAKE_PROFIT";
}

const SCALE = 100_000_000; // 10^8 — all BigInt prices/quantities are scaled by this
function fromInt(val: string): number {
  return parseInt(val, 10) / SCALE;
}

const ASSETS: { symbol: Asset; label: string; icon: string }[] = [
  { symbol: "BTCUSDT", label: "BTC", icon: "₿" },
  { symbol: "ETHUSDT", label: "ETH", icon: "Ξ" },
  { symbol: "SOLUSDT", label: "SOL", icon: "◎" },
];

const DURATIONS: Duration[] = ["30s", "1m", "5m", "15m", "1h", "4h", "1d"];

// ─── Component ───────────────────────────────────────────────────────
export default function TradePage() {
  const router = useRouter();

  // State
  const [selectedAsset, setSelectedAsset] = useState<Asset>("BTCUSDT");
  const [selectedDuration, setSelectedDuration] = useState<Duration>("1m");
  const [prices, setPrices] = useState<Record<string, PriceData>>({});
  const prevPricesRef = useRef<Record<string, PriceData>>({});
  const [balance, setBalance] = useState<string>("0.00");
  const [userEmail, setUserEmail] = useState<string>("");
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [closedOrders, setClosedOrders] = useState<Order[]>([]);
  const [positionTab, setPositionTab] = useState<"open" | "closed">("open");

  // Order form
  const [orderType, setOrderType] = useState<OrderType>("LONG");
  const [leverage, setLeverage] = useState(10);
  const [qty, setQty] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [orderLoading, setOrderLoading] = useState(false);
  const [orderError, setOrderError] = useState("");

  // Chart
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const bidLineRef = useRef<ReturnType<ISeriesApi<"Candlestick">["createPriceLine"]> | null>(null);
  const askLineRef = useRef<ReturnType<ISeriesApi<"Candlestick">["createPriceLine"]> | null>(null);
  const lastCandleRef = useRef<CandlestickData | null>(null);
  const selectedAssetRef = useRef<Asset>(selectedAsset);
  const selectedDurationRef = useRef<Duration>(selectedDuration);

  const orderTypeRef = useRef<OrderType>(orderType);

  // Keep refs in sync with state
  useEffect(() => { selectedAssetRef.current = selectedAsset; }, [selectedAsset]);
  useEffect(() => { selectedDurationRef.current = selectedDuration; }, [selectedDuration]);
  useEffect(() => { orderTypeRef.current = orderType; }, [orderType]);

  // Resizable sidebar
  const SIDEBAR_MIN = 220;
  const SIDEBAR_MAX = 500;
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const isResizingRef = useRef(false);

  // Resizable positions panel (drag vertically)
  const PANEL_MIN = 120;
  const PANEL_MAX = 500;
  const [panelHeight, setPanelHeight] = useState(200);
  const isResizingPanelRef = useRef(false);
  const centerColumnRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingRef.current) {
        const newWidth = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, e.clientX));
        setSidebarWidth(newWidth);
      }
      if (isResizingPanelRef.current && centerColumnRef.current) {
        const rect = centerColumnRef.current.getBoundingClientRect();
        const newHeight = Math.min(PANEL_MAX, Math.max(PANEL_MIN, rect.bottom - e.clientY));
        setPanelHeight(newHeight);
      }
    };
    const handleMouseUp = () => {
      if (isResizingRef.current) {
        isResizingRef.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
      if (isResizingPanelRef.current) {
        isResizingPanelRef.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  // Resize chart when sidebar width or panel height changes
  useEffect(() => {
    if (chartRef.current && chartContainerRef.current) {
      chartRef.current.applyOptions({
        width: chartContainerRef.current.clientWidth,
        height: chartContainerRef.current.clientHeight,
      });
    }
  }, [sidebarWidth, panelHeight]);

  // Toggle bid/ask price line visibility based on order type
  useEffect(() => {
    const isBuy = orderType === "LONG";
    if (bidLineRef.current) {
      bidLineRef.current.applyOptions({ lineVisible: !isBuy, axisLabelVisible: !isBuy });
    }
    if (askLineRef.current) {
      askLineRef.current.applyOptions({ lineVisible: isBuy, axisLabelVisible: isBuy });
    }
  }, [orderType]);

  // ─── WebSocket for live prices (ticket-based auth) ─────────────────
  useEffect(() => {
    let ws: WebSocket | null = null;
    let cancelled = false;

    async function connect() {
      try {
        // Step 1: Get a one-time ticket from the backend
        const { data } = await api.get("/api/v1/user/ws-ticket");
        if (cancelled) return;
        const { ticket } = data;

        // Step 2: Connect to WebSocket
        ws = new WebSocket("ws://localhost:3006");

        ws.onopen = () => {
          // Step 3: Authenticate with the ticket
          ws!.send(JSON.stringify({
            type: "auth",
            ticket,
            clientId: `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          }));
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === "price_update") {
              // Update sidebar prices
              setPrices((prev) => {
                prevPricesRef.current = prev;
                return {
                  ...prev,
                  [msg.symbol]: {
                    symbol: msg.symbol,
                    bidPrice: msg.data.bidPrice,
                    askPrice: msg.data.askPrice,
                  },
                };
              });

              // Update chart if this is the currently selected asset
              if (msg.symbol === selectedAssetRef.current && seriesRef.current) {
                const bidPrice = msg.data.bidPrice;
                const askPrice = msg.data.askPrice;
                const midPrice = (bidPrice + askPrice) / 2;

                // Update candle
                if (lastCandleRef.current) {
                  const candle = lastCandleRef.current;
                  const updated: CandlestickData = {
                    ...candle,
                    close: midPrice,
                    high: Math.max(candle.high as number, midPrice),
                    low: Math.min(candle.low as number, midPrice),
                  };
                  lastCandleRef.current = updated;
                  seriesRef.current.update(updated);
                }

                // Update bid/ask price lines
                if (bidLineRef.current) {
                  bidLineRef.current.applyOptions({ price: bidPrice, title: `Bid ${bidPrice.toFixed(2)}` });
                }
                if (askLineRef.current) {
                  askLineRef.current.applyOptions({ price: askPrice, title: `Ask ${askPrice.toFixed(2)}` });
                }
              }
            }
          } catch {}
        };
      } catch {}
    }

    connect();

    return () => {
      cancelled = true;
      ws?.close();
    };
  }, []);

  // ─── Fetch user info ───────────────────────────────────────────────
  useEffect(() => {
    api.get("/api/v1/user/me")
      .then(({ data }) => { if (data?.user?.email) setUserEmail(data.user.email); })
      .catch(() => {});
  }, []);

  // ─── Close profile menu on outside click ──────────────────────────
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node)) {
        setShowProfileMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // ─── Sign out ─────────────────────────────────────────────────────
  const handleSignOut = async () => {
    await api.post("/api/v1/user/signout");
    router.push("/signin");
  };

  // ─── Fetch balance ─────────────────────────────────────────────────
  const fetchBalance = useCallback(async () => {
    try {
      const { data } = await api.get("/api/v1/order/user/balance");
      setBalance(data.balance?.balance || "0.00");
    } catch (err: any) {
      if (err.response?.status === 401) router.push("/signin");
    }
  }, [router]);

  // ─── Fetch orders ──────────────────────────────────────────────────
  const fetchOrders = useCallback(async () => {
    try {
      const [openRes, closedRes] = await Promise.all([
        api.get("/api/v1/order/user/orders?status=OPEN"),
        api.get("/api/v1/order/user/orders?status=CLOSED"),
      ]);
      setOrders(openRes.data.orders || []);
      setClosedOrders(closedRes.data.orders || []);
    } catch {}
  }, []);

  useEffect(() => {
    fetchBalance();
    fetchOrders();
    const interval = setInterval(() => {
      fetchBalance();
      fetchOrders();
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchBalance, fetchOrders]);

  // ─── Chart ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!chartContainerRef.current) return;

    chartRef.current = null;
    seriesRef.current = null;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#1a1a2e" },
        textColor: "#8a8a9a",
      },
      grid: {
        vertLines: { color: "#2a2a3e" },
        horzLines: { color: "#2a2a3e" },
      },
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
      crosshair: {
        vertLine: { color: "#555" },
        horzLine: { color: "#555" },
      },
      timeScale: {
        borderColor: "#2a2a3e",
        timeVisible: true,
        secondsVisible: selectedDuration === "30s",
      },
      rightPriceScale: {
        borderColor: "#2a2a3e",
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#26a69a",
      downColor: "#ef5350",
      borderUpColor: "#26a69a",
      borderDownColor: "#ef5350",
      wickUpColor: "#26a69a",
      wickDownColor: "#ef5350",
      lastValueVisible: false,
    });

    chartRef.current = chart;
    seriesRef.current = series;

    // Create bid/ask price lines (only one visible at a time based on orderType)
    const isBuy = orderTypeRef.current === "LONG";
    bidLineRef.current = series.createPriceLine({
      price: 0,
      color: "#ff9800",
      lineWidth: 1,
      lineStyle: 2, // dashed
      axisLabelVisible: !isBuy,
      lineVisible: !isBuy,
      title: "Bid",
    });
    askLineRef.current = series.createPriceLine({
      price: 0,
      color: "#42a5f5",
      lineWidth: 1,
      lineStyle: 2, // dashed
      axisLabelVisible: isBuy,
      lineVisible: isBuy,
      title: "Ask",
    });

    // Fetch candle data
    api.get(`/candles?asset=${selectedAsset}&duration=${selectedDuration}`)
      .then(({ data }) => {
        if (data.candles && data.candles.length > 0) {
          const candles = data.candles as CandlestickData[];
          series.setData(candles);
          lastCandleRef.current = candles[candles.length - 1] ?? null;
          chart.timeScale().fitContent();
        }
      })
      .catch(console.error);

    // Resize handler
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
    };
  }, [selectedAsset, selectedDuration]);

  // ─── Open order ────────────────────────────────────────────────────
  async function handleOpenOrder() {
    setOrderError("");
    setOrderLoading(true);
    try {
      const body: Record<string, unknown> = {
        orderType,
        asset: selectedAsset,
        leverage,
        qty: Number(qty),
      };
      if (stopLoss) body.stopLoss = Number(stopLoss);
      if (takeProfit) body.takeProfit = Number(takeProfit);

      await api.post("/api/v1/order/open", body);
      setQty("");
      setStopLoss("");
      setTakeProfit("");
      fetchBalance();
      fetchOrders();
    } catch (err: any) {
      const raw = err.response?.data?.error || err.response?.data?.message || "";
      if (raw.includes("INSUFFICIENT_BALANCE")) {
        setOrderError("Insufficient balance for this order");
      } else if (raw.includes("ENGINE_NOT_READY")) {
        setOrderError("Trading engine is starting up. Please try again shortly");
      } else {
        setOrderError(raw || "Something went wrong");
      }
    } finally {
      setOrderLoading(false);
    }
  }

  // ─── Close order ───────────────────────────────────────────────────
  async function handleCloseOrder(orderId: string) {
    try {
      const { data } = await api.post(`/api/v1/order/close/${orderId}`);
      fetchBalance();
      if (data.order) {
        setOrders((prev) => prev.filter((o) => o.orderId !== orderId));
        setClosedOrders((prev) => [data.order, ...prev]);
      } else {
        fetchOrders();
      }
    } catch {}
  }

  // ─── Current price for selected asset ──────────────────────────────
  const currentPrice = prices[selectedAsset];

  // ─── Compute real-time PnL for open orders using live prices ──────
  const computePnL = (order: Order): number => {
    const livePrice = prices[order.asset];
    if (!livePrice) return 0;
    const entry = fromInt(order.executionPriceInt);
    const qty = fromInt(order.qtyInt);
    const current = order.orderType === "LONG" ? livePrice.bidPrice : livePrice.askPrice;
    if (order.orderType === "LONG") return (current - entry) * qty;
    return (entry - current) * qty;
  };

  const totalPnL = orders.reduce((sum, o) => sum + computePnL(o), 0);
  const equity = parseFloat(balance) + totalPnL;

  return (
    <div className="flex flex-col h-screen bg-trade-bg text-trade-text font-sans">

      {/* ─── Top Bar ───────────────────────────────────── */}
      <div className="flex items-center h-12 border-b border-trade-border px-4 gap-6">
        {ASSETS.map((a) => (
          <button
            key={a.symbol}
            onClick={() => setSelectedAsset(a.symbol)}
            className={`flex items-center gap-1.5 border-none px-4 py-2 text-[13px] font-semibold rounded cursor-pointer ${
              selectedAsset === a.symbol
                ? "bg-trade-secondary text-brand"
                : "bg-transparent text-trade-muted"
            }`}
          >
            <span>{a.icon}</span>
            <span>{a.label}/USD</span>
          </button>
        ))}

        <div className="flex-1" />

        <span className="text-[13px] text-trade-muted flex gap-4">
          <span>Balance: <span className="text-trade-text font-semibold">${balance}</span></span>
          {orders.length > 0 && (
            <>
              <span>Equity: <span className={`font-semibold ${equity >= parseFloat(balance) ? "text-bull" : "text-bear"}`}>${equity.toFixed(2)}</span></span>
              <span>P/L: <span className={`font-semibold ${totalPnL >= 0 ? "text-bull" : "text-bear"}`}>{totalPnL >= 0 ? "+" : ""}{totalPnL.toFixed(2)} USD</span></span>
            </>
          )}
        </span>

        {/* Profile button */}
        <div ref={profileMenuRef} className="relative ml-4">
          <button
            onClick={() => setShowProfileMenu((v) => !v)}
            className="w-8 h-8 rounded-full bg-trade-border border-none cursor-pointer flex items-center justify-center"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d1d4dc" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </button>

          {showProfileMenu && (
            <div className="absolute top-10 right-0 bg-trade-secondary border border-trade-border rounded-lg py-2 min-w-[220px] z-[100] shadow-[0_8px_24px_rgba(0,0,0,0.4)]">
              {/* User email */}
              <div className="flex items-center gap-2.5 px-4 py-3 border-b border-trade-border">
                <div className="w-7 h-7 rounded-full bg-trade-border flex items-center justify-center">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8a8a9a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                </div>
                <span className="text-[13px] text-trade-text">{userEmail || "—"}</span>
              </div>

              {/* Sign Out */}
              <button
                onClick={handleSignOut}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 bg-transparent border-none cursor-pointer text-[13px] text-trade-text hover:bg-trade-border"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8a8a9a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ─── Main Layout ───────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ─── Left Sidebar: Instruments ─────────────────── */}
        <div className="flex flex-col relative" style={{ width: `${sidebarWidth}px`, minWidth: `${SIDEBAR_MIN}px`, maxWidth: `${SIDEBAR_MAX}px` }}>
          <div className="px-3 pt-3 pb-2 text-xs font-bold text-trade-text uppercase tracking-wide">
            Instruments
          </div>
          {/* Column headers */}
          <div className="flex px-3 py-1 pb-2 text-[10px] text-trade-dim font-semibold border-b border-trade-border">
            <div className="flex-1">Symbol</div>
            <div className="w-20 text-right">Bid</div>
            <div className="w-20 text-right">Ask</div>
          </div>
          {/* Scrollable asset list */}
          <div className="flex-1 overflow-y-auto overflow-x-auto">
            {ASSETS.map((a) => {
              const p = prices[a.symbol];
              const prev = prevPricesRef.current[a.symbol];
              const bidUp = p && prev ? p.bidPrice >= prev.bidPrice : true;
              const askUp = p && prev ? p.askPrice >= prev.askPrice : true;
              return (
                <div
                  key={a.symbol}
                  onClick={() => setSelectedAsset(a.symbol)}
                  className={`flex items-center px-3 py-2.5 cursor-pointer border-b border-trade-secondary min-w-fit ${
                    selectedAsset === a.symbol
                      ? "bg-trade-secondary border-l-3 border-l-brand"
                      : "bg-transparent border-l-3 border-l-transparent"
                  }`}
                >
                  <div className="flex-1 flex items-center gap-2">
                    <span className="text-sm">{a.icon}</span>
                    <span className="text-[13px] font-semibold text-trade-text whitespace-nowrap">{a.label}</span>
                  </div>
                  <div
                    className={`w-20 text-right text-xs font-semibold font-mono px-1.5 py-0.5 rounded-sm mr-2 transition-colors duration-150 ${
                      p
                        ? bidUp ? "text-bull bg-bull/12" : "text-bear bg-bear/12"
                        : "text-trade-dim bg-transparent"
                    }`}
                  >
                    {p ? p.bidPrice.toFixed(2) : "—"}
                  </div>
                  <div
                    className={`w-20 text-right text-xs font-semibold font-mono px-1.5 py-0.5 rounded-sm transition-colors duration-150 ${
                      p
                        ? askUp ? "text-bull bg-bull/12" : "text-bear bg-bear/12"
                        : "text-trade-dim bg-transparent"
                    }`}
                  >
                    {p ? p.askPrice.toFixed(2) : "—"}
                  </div>
                </div>
              );
            })}
          </div>
          {/* Drag handle */}
          <div
            onMouseDown={() => {
              isResizingRef.current = true;
              document.body.style.cursor = "col-resize";
              document.body.style.userSelect = "none";
            }}
            className="absolute top-0 right-0 w-[5px] h-full cursor-col-resize bg-transparent z-10 border-r border-trade-border hover:bg-brand"
          />
        </div>

        {/* ─── Center: Chart + Positions ────────────────── */}
        <div ref={centerColumnRef} className="flex flex-col flex-1 overflow-hidden">

          {/* Timeframe selector */}
          <div className="flex items-center px-4 py-2 gap-1 border-b border-trade-border">
            {DURATIONS.map((d) => (
              <button
                key={d}
                onClick={() => setSelectedDuration(d)}
                className={`border-none px-2.5 py-1 text-xs font-semibold rounded-sm cursor-pointer ${
                  selectedDuration === d
                    ? "bg-active text-white"
                    : "bg-transparent text-trade-muted"
                }`}
              >
                {d}
              </button>
            ))}

            {currentPrice && (
              <div className="flex-1 text-right text-xs">
                <span className="text-trade-muted">Bid </span>
                <span className="text-bear font-semibold">{currentPrice.bidPrice.toFixed(2)}</span>
                <span className="text-trade-muted ml-3">Ask </span>
                <span className="text-bull font-semibold">{currentPrice.askPrice.toFixed(2)}</span>
              </div>
            )}
          </div>

          {/* Chart */}
          <div ref={chartContainerRef} className="flex-1 min-h-0" />

          {/* Positions panel */}
          <div className="flex flex-col relative" style={{ height: `${panelHeight}px`, minHeight: `${PANEL_MIN}px` }}>
            {/* Vertical drag handle */}
            <div
              onMouseDown={() => {
                isResizingPanelRef.current = true;
                document.body.style.cursor = "row-resize";
                document.body.style.userSelect = "none";
              }}
              className="absolute top-0 left-0 right-0 h-[5px] cursor-row-resize bg-transparent z-10 border-t border-trade-border hover:bg-brand"
            />
            {/* Tabs */}
            <div className="flex border-b border-trade-border">
              <button
                onClick={() => setPositionTab("open")}
                className={`px-4 py-2 text-xs font-semibold bg-transparent border-t-0 border-l-0 border-r-0 border-b-2 cursor-pointer ${
                  positionTab === "open"
                    ? "text-trade-text border-b-active"
                    : "text-trade-muted border-b-transparent"
                }`}
              >
                Open ({orders.length})
              </button>
              <button
                onClick={() => setPositionTab("closed")}
                className={`px-4 py-2 text-xs font-semibold bg-transparent border-t-0 border-l-0 border-r-0 border-b-2 cursor-pointer ${
                  positionTab === "closed"
                    ? "text-trade-text border-b-active"
                    : "text-trade-muted border-b-transparent"
                }`}
              >
                Closed ({closedOrders.length})
              </button>
            </div>

            {/* Table header */}
            <div className="flex px-4 py-2 text-[10px] text-trade-dim font-semibold uppercase tracking-wide border-b border-trade-border">
              <div className="flex-1 min-w-[70px]">Symbol</div>
              <div className="flex-[0.7] min-w-[55px]">Type</div>
              <div className="flex-1 min-w-[80px] text-right">Volume</div>
              <div className="flex-[1.1] min-w-[90px] text-right">Open price</div>
              <div className="flex-[1.1] min-w-[90px] text-right">{positionTab === "closed" ? "Close price" : "Current price"}</div>
              <div className="flex-1 min-w-[80px] text-right">S/L</div>
              <div className="flex-1 min-w-[80px] text-right">T/P</div>
              <div className="flex-1 min-w-[80px] text-right">P/L, USD</div>
              <div className="w-20" />
            </div>

            {/* Positions list */}
            <div className="overflow-y-auto flex-1">
              {positionTab === "open" && orders.length === 0 && (
                <div className="text-center p-6 text-trade-muted text-[13px]">
                  No open positions
                </div>
              )}
              {positionTab === "closed" && closedOrders.length === 0 && (
                <div className="text-center p-6 text-trade-muted text-[13px]">
                  No closed positions
                </div>
              )}

              {positionTab === "open" &&
                orders.map((o) => {
                  const pnl = computePnL(o);
                  const livePrice = prices[o.asset];
                  const currentDisplay = livePrice ? (o.orderType === "LONG" ? livePrice.bidPrice : livePrice.askPrice).toFixed(2) : "—";
                  const assetLabel = o.asset.replace("USDT", "");
                  const sl = o.stopLossInt && o.stopLossInt !== "0" ? fromInt(o.stopLossInt) : null;
                  const tp = o.takeProfitInt && o.takeProfitInt !== "0" ? fromInt(o.takeProfitInt) : null;
                  return (
                    <div
                      key={o.orderId}
                      className="flex items-center px-4 py-2.5 text-xs border-b border-trade-secondary"
                    >
                      <div className="flex-1 min-w-[70px] flex items-center gap-1.5">
                        <span className="font-semibold text-trade-text">{assetLabel}</span>
                      </div>
                      <div className="flex-[0.7] min-w-[55px] flex items-center gap-1">
                        <span className={`w-1.5 h-1.5 rounded-full ${o.orderType === "LONG" ? "bg-bull" : "bg-bear"}`} />
                        <span className="text-trade-text">{o.orderType === "LONG" ? "Buy" : "Sell"}</span>
                      </div>
                      <div className="flex-1 min-w-[80px] text-right text-trade-text">{fromInt(o.qtyInt).toFixed(8)}</div>
                      <div className="flex-[1.1] min-w-[90px] text-right text-trade-muted font-mono">{parseFloat(o.executionPrice).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                      <div className="flex-[1.1] min-w-[90px] text-right text-trade-text font-mono">{currentDisplay !== "—" ? parseFloat(currentDisplay).toLocaleString(undefined, { minimumFractionDigits: 2 }) : "—"}</div>
                      <div className={`flex-1 min-w-[80px] text-right font-mono ${sl ? "text-bear" : "text-trade-dim"}`}>{sl ? sl.toLocaleString(undefined, { minimumFractionDigits: 2 }) : "—"}</div>
                      <div className={`flex-1 min-w-[80px] text-right font-mono ${tp ? "text-bull" : "text-trade-dim"}`}>{tp ? tp.toLocaleString(undefined, { minimumFractionDigits: 2 }) : "—"}</div>
                      <div className={`flex-1 min-w-[80px] text-right font-semibold font-mono ${pnl >= 0 ? "text-bull" : "text-bear"}`}>
                        {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}
                      </div>
                      <div className="w-20 text-right">
                        <button
                          onClick={() => handleCloseOrder(o.orderId)}
                          className="bg-transparent text-trade-muted border border-trade-border px-3 py-1 rounded-sm text-[11px] font-semibold cursor-pointer hover:border-bear hover:text-bear"
                        >
                          Close
                        </button>
                      </div>
                    </div>
                  );
                })}

              {positionTab === "closed" &&
                closedOrders.map((o) => {
                  const pnl = fromInt(o.finalPnLInt);
                  const assetLabel = o.asset.replace("USDT", "");
                  const sl = o.stopLossInt && o.stopLossInt !== "0" ? fromInt(o.stopLossInt) : null;
                  const tp = o.takeProfitInt && o.takeProfitInt !== "0" ? fromInt(o.takeProfitInt) : null;
                  // Compute close price: LONG: entry + PnL/qty, SHORT: entry - PnL/qty
                  const entryPrice = fromInt(o.executionPriceInt);
                  const qty = fromInt(o.qtyInt);
                  const closePrice = qty > 0
                    ? (o.orderType === "LONG" ? entryPrice + pnl / qty : entryPrice - pnl / qty)
                    : entryPrice;
                  return (
                    <div
                      key={o.orderId}
                      className="flex items-center px-4 py-2.5 text-xs border-b border-trade-secondary"
                    >
                      <div className="flex-1 min-w-[70px] font-semibold text-trade-text">{assetLabel}</div>
                      <div className="flex-[0.7] min-w-[55px] flex items-center gap-1">
                        <span className={`w-1.5 h-1.5 rounded-full ${o.orderType === "LONG" ? "bg-bull" : "bg-bear"}`} />
                        <span className="text-trade-text">{o.orderType === "LONG" ? "Buy" : "Sell"}</span>
                      </div>
                      <div className="flex-1 min-w-[80px] text-right text-trade-text">{fromInt(o.qtyInt).toFixed(8)}</div>
                      <div className="flex-[1.1] min-w-[90px] text-right text-trade-muted font-mono">{parseFloat(o.executionPrice).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                      <div className="flex-[1.1] min-w-[90px] text-right text-trade-text font-mono">{closePrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                      <div className={`flex-1 min-w-[80px] text-right font-mono ${sl ? "text-bear" : "text-trade-dim"}`}>{sl ? sl.toLocaleString(undefined, { minimumFractionDigits: 2 }) : "—"}</div>
                      <div className={`flex-1 min-w-[80px] text-right font-mono ${tp ? "text-bull" : "text-trade-dim"}`}>{tp ? tp.toLocaleString(undefined, { minimumFractionDigits: 2 }) : "—"}</div>
                      <div className={`flex-1 min-w-[80px] text-right font-semibold font-mono ${pnl >= 0 ? "text-bull" : "text-bear"}`}>
                        {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}
                      </div>
                      <div className="w-20 text-center">
                        {(() => {
                          const reason = o.closeReason;
                          const cfg = reason === "MARGIN_CALL"
                            ? { label: "Margin Call", cls: "bg-bear/15 text-bear" }
                            : reason === "STOP_LOSS"
                            ? { label: "S/L", cls: "bg-warn/15 text-warn" }
                            : reason === "TAKE_PROFIT"
                            ? { label: "T/P", cls: "bg-bull/15 text-bull" }
                            : { label: "Manual", cls: "bg-trade-muted/15 text-trade-muted" };
                          return (
                            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${cfg.cls}`}>
                              {cfg.label}
                            </span>
                          );
                        })()}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>

        {/* ─── Right Sidebar: Order Form ────────────────── */}
        <div className="w-[280px] border-l border-trade-border p-4 overflow-y-auto">

          <div className="text-sm font-bold text-trade-text mb-4">
            {ASSETS.find((a) => a.symbol === selectedAsset)?.label}/USD
          </div>

          {/* Sell / Buy buttons */}
          <div className="flex gap-1 mb-4">
            <button
              onClick={() => setOrderType("SHORT")}
              className={`flex-1 py-3 px-2 border-none rounded text-xs font-bold cursor-pointer text-center ${
                orderType === "SHORT" ? "bg-bear text-white" : "bg-trade-secondary text-trade-muted"
              }`}
            >
              <div>Sell</div>
              {currentPrice && (
                <div className="text-sm mt-0.5">{currentPrice.bidPrice.toFixed(2)}</div>
              )}
            </button>
            <button
              onClick={() => setOrderType("LONG")}
              className={`flex-1 py-3 px-2 border-none rounded text-xs font-bold cursor-pointer text-center ${
                orderType === "LONG" ? "bg-bull text-white" : "bg-trade-secondary text-trade-muted"
              }`}
            >
              <div>Buy</div>
              {currentPrice && (
                <div className="text-sm mt-0.5">{currentPrice.askPrice.toFixed(2)}</div>
              )}
            </button>
          </div>

          {/* Leverage */}
          <div className="mb-4">
            <label className="text-[11px] text-trade-muted block mb-1.5">
              Leverage: {leverage}x
            </label>
            <input
              type="range"
              min={1}
              max={100}
              value={leverage}
              onChange={(e) => setLeverage(Number(e.target.value))}
              className="w-full accent-brand"
            />
            <div className="flex justify-between text-[10px] text-trade-muted">
              <span>1x</span>
              <span>100x</span>
            </div>
          </div>

          {/* Volume */}
          <div className="mb-4">
            <label className="text-[11px] text-trade-muted block mb-1.5">Volume (units)</label>
            <input
              type="number"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="0.00"
              className="w-full bg-trade-secondary border border-trade-border rounded py-2.5 px-2.5 text-trade-text text-[13px]"
            />
          </div>

          {/* Take Profit */}
          <div className="mb-4">
            <label className="text-[11px] text-trade-muted block mb-1.5">Take Profit</label>
            <input
              type="number"
              value={takeProfit}
              onChange={(e) => setTakeProfit(e.target.value)}
              placeholder="Not set"
              className="w-full bg-trade-secondary border border-trade-border rounded py-2.5 px-2.5 text-trade-text text-[13px]"
            />
          </div>

          {/* Stop Loss */}
          <div className="mb-6">
            <label className="text-[11px] text-trade-muted block mb-1.5">Stop Loss</label>
            <input
              type="number"
              value={stopLoss}
              onChange={(e) => setStopLoss(e.target.value)}
              placeholder="Not set"
              className="w-full bg-trade-secondary border border-trade-border rounded py-2.5 px-2.5 text-trade-text text-[13px]"
            />
          </div>

          {orderError && (
            <p className="text-bear text-xs mb-3">{orderError}</p>
          )}

          {/* Place Order */}
          <button
            onClick={handleOpenOrder}
            disabled={orderLoading || !qty}
            className={`w-full py-3.5 border-none rounded text-[13px] font-bold text-white disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
              orderType === "LONG" ? "bg-bull" : "bg-bear"
            }`}
          >
            {orderLoading
              ? "Placing..."
              : `${orderType === "LONG" ? "Buy" : "Sell"} ${ASSETS.find((a) => a.symbol === selectedAsset)?.label}/USD`}
          </button>
        </div>
      </div>
    </div>
  );
}
