"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createChart, CandlestickSeries, type IChartApi, type ISeriesApi, type CandlestickData, ColorType } from "lightweight-charts";

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
  qty: string;
  currentPnL: string;
  status: string;
  createdAt: string;
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

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      const newWidth = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, e.clientX));
      setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => {
      if (isResizingRef.current) {
        isResizingRef.current = false;
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

  // Resize chart when sidebar width changes
  useEffect(() => {
    if (chartRef.current && chartContainerRef.current) {
      chartRef.current.applyOptions({
        width: chartContainerRef.current.clientWidth,
      });
    }
  }, [sidebarWidth]);

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
        const res = await fetch("/api/v1/user/ws-ticket", { credentials: "include" });
        if (!res.ok || cancelled) return;
        const { ticket } = await res.json();

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

  // ─── Fetch balance ─────────────────────────────────────────────────
  const fetchBalance = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/order/user/balance", { credentials: "include" });
      if (res.status === 401) {
        router.push("/signin");
        return;
      }
      const data = await res.json();
      setBalance(data.balance?.balance || "0.00");
    } catch {}
  }, [router]);

  // ─── Fetch orders ──────────────────────────────────────────────────
  const fetchOrders = useCallback(async () => {
    try {
      const [openRes, closedRes] = await Promise.all([
        fetch("/api/v1/order/user/orders?status=OPEN", { credentials: "include" }),
        fetch("/api/v1/order/user/orders?status=CLOSED", { credentials: "include" }),
      ]);
      if (openRes.ok) {
        const data = await openRes.json();
        setOrders(data.orders || []);
      }
      if (closedRes.ok) {
        const data = await closedRes.json();
        setClosedOrders(data.orders || []);
      }
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
      color: "#ef5350",
      lineWidth: 1,
      lineStyle: 2, // dashed
      axisLabelVisible: !isBuy,
      lineVisible: !isBuy,
      title: "Bid",
    });
    askLineRef.current = series.createPriceLine({
      price: 0,
      color: "#26a69a",
      lineWidth: 1,
      lineStyle: 2, // dashed
      axisLabelVisible: isBuy,
      lineVisible: isBuy,
      title: "Ask",
    });

    // Fetch candle data
    fetch(`/candles?asset=${selectedAsset}&duration=${selectedDuration}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.candles && data.candles.length > 0) {
          const candles = data.candles as CandlestickData[];
          series.setData(candles);
          lastCandleRef.current = candles[candles.length - 1];
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

      const res = await fetch("/api/v1/order/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setOrderError(data.message || "Failed to open order");
        return;
      }
      setQty("");
      setStopLoss("");
      setTakeProfit("");
      fetchBalance();
      fetchOrders();
    } catch {
      setOrderError("Something went wrong");
    } finally {
      setOrderLoading(false);
    }
  }

  // ─── Close order ───────────────────────────────────────────────────
  async function handleCloseOrder(orderId: string) {
    try {
      const res = await fetch(`/api/v1/order/close/${orderId}`, {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        fetchBalance();
        fetchOrders();
      }
    } catch {}
  }

  // ─── Current price for selected asset ──────────────────────────────
  const currentPrice = prices[selectedAsset];

  return (
    <div className="flex flex-col" style={{ height: "100vh", backgroundColor: "#131722", color: "#d1d4dc", fontFamily: "sans-serif" }}>

      {/* ─── Top Bar ───────────────────────────────────── */}
      <div className="flex items-center" style={{ height: "48px", borderBottom: "1px solid #2a2a3e", padding: "0 16px", gap: "24px" }}>
        {ASSETS.map((a) => (
          <button
            key={a.symbol}
            onClick={() => setSelectedAsset(a.symbol)}
            style={{
              background: selectedAsset === a.symbol ? "#1e222d" : "transparent",
              color: selectedAsset === a.symbol ? "#FFB800" : "#8a8a9a",
              border: "none",
              padding: "8px 16px",
              fontSize: "13px",
              fontWeight: 600,
              borderRadius: "4px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <span>{a.icon}</span>
            <span>{a.label}/USD</span>
          </button>
        ))}

        <div className="flex-1" />

        <span style={{ fontSize: "13px", color: "#8a8a9a" }}>
          Balance: <span style={{ color: "#26a69a", fontWeight: 600 }}>${balance}</span>
        </span>
      </div>

      {/* ─── Main Layout ───────────────────────────────── */}
      <div className="flex flex-1" style={{ overflow: "hidden" }}>

        {/* ─── Left Sidebar: Instruments ─────────────────── */}
        <div style={{ width: `${sidebarWidth}px`, minWidth: `${SIDEBAR_MIN}px`, maxWidth: `${SIDEBAR_MAX}px`, display: "flex", flexDirection: "column", position: "relative" }}>
          <div style={{ padding: "12px 12px 8px", fontSize: "12px", fontWeight: 700, color: "#d1d4dc", textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Instruments
          </div>
          {/* Column headers */}
          <div style={{ display: "flex", padding: "4px 12px 8px", fontSize: "10px", color: "#6a6a7a", fontWeight: 600, borderBottom: "1px solid #2a2a3e" }}>
            <div style={{ flex: 1 }}>Symbol</div>
            <div style={{ width: "80px", textAlign: "right" }}>Bid</div>
            <div style={{ width: "80px", textAlign: "right" }}>Ask</div>
          </div>
          {/* Scrollable asset list */}
          <div style={{ flex: 1, overflowY: "auto", overflowX: "auto" }}>
            {ASSETS.map((a) => {
              const p = prices[a.symbol];
              const prev = prevPricesRef.current[a.symbol];
              const bidUp = p && prev ? p.bidPrice >= prev.bidPrice : true;
              const askUp = p && prev ? p.askPrice >= prev.askPrice : true;
              return (
                <div
                  key={a.symbol}
                  onClick={() => setSelectedAsset(a.symbol)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "10px 12px",
                    cursor: "pointer",
                    backgroundColor: selectedAsset === a.symbol ? "#1e222d" : "transparent",
                    borderLeft: selectedAsset === a.symbol ? "3px solid #FFB800" : "3px solid transparent",
                    borderBottom: "1px solid #1e222d",
                    minWidth: "fit-content",
                  }}
                >
                  <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "14px" }}>{a.icon}</span>
                    <span style={{ fontSize: "13px", fontWeight: 600, color: "#d1d4dc", whiteSpace: "nowrap" }}>{a.label}</span>
                  </div>
                  <div style={{
                    width: "80px",
                    textAlign: "right",
                    fontSize: "12px",
                    fontWeight: 600,
                    fontFamily: "monospace",
                    color: p ? (bidUp ? "#26a69a" : "#ef5350") : "#6a6a7a",
                    backgroundColor: p ? (bidUp ? "rgba(38,166,154,0.12)" : "rgba(239,83,80,0.12)") : "transparent",
                    padding: "3px 6px",
                    borderRadius: "3px",
                    marginRight: "8px",
                    transition: "color 0.15s",
                  }}>
                    {p ? p.bidPrice.toFixed(2) : "—"}
                  </div>
                  <div style={{
                    width: "80px",
                    textAlign: "right",
                    fontSize: "12px",
                    fontWeight: 600,
                    fontFamily: "monospace",
                    color: p ? (askUp ? "#26a69a" : "#ef5350") : "#6a6a7a",
                    backgroundColor: p ? (askUp ? "rgba(38,166,154,0.12)" : "rgba(239,83,80,0.12)") : "transparent",
                    padding: "3px 6px",
                    borderRadius: "3px",
                    transition: "color 0.15s",
                  }}>
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
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              width: "5px",
              height: "100%",
              cursor: "col-resize",
              backgroundColor: "transparent",
              zIndex: 10,
              borderRight: "1px solid #2a2a3e",
            }}
            onMouseEnter={(e) => { (e.target as HTMLElement).style.backgroundColor = "#FFB800"; }}
            onMouseLeave={(e) => { if (!isResizingRef.current) (e.target as HTMLElement).style.backgroundColor = "transparent"; }}
          />
        </div>

        {/* ─── Center: Chart + Positions ────────────────── */}
        <div className="flex flex-col flex-1" style={{ overflow: "hidden" }}>

          {/* Timeframe selector */}
          <div className="flex items-center" style={{ padding: "8px 16px", gap: "4px", borderBottom: "1px solid #2a2a3e" }}>
            {DURATIONS.map((d) => (
              <button
                key={d}
                onClick={() => setSelectedDuration(d)}
                style={{
                  background: selectedDuration === d ? "#2962ff" : "transparent",
                  color: selectedDuration === d ? "#fff" : "#8a8a9a",
                  border: "none",
                  padding: "4px 10px",
                  fontSize: "12px",
                  fontWeight: 600,
                  borderRadius: "3px",
                  cursor: "pointer",
                }}
              >
                {d}
              </button>
            ))}

            {currentPrice && (
              <div className="flex-1 text-right" style={{ fontSize: "12px" }}>
                <span style={{ color: "#8a8a9a" }}>Bid </span>
                <span style={{ color: "#ef5350", fontWeight: 600 }}>{currentPrice.bidPrice.toFixed(2)}</span>
                <span style={{ color: "#8a8a9a", marginLeft: "12px" }}>Ask </span>
                <span style={{ color: "#26a69a", fontWeight: 600 }}>{currentPrice.askPrice.toFixed(2)}</span>
              </div>
            )}
          </div>

          {/* Chart */}
          <div ref={chartContainerRef} className="flex-1" style={{ minHeight: 0 }} />

          {/* Positions panel */}
          <div style={{ height: "200px", borderTop: "1px solid #2a2a3e", overflowY: "auto" }}>
            {/* Tabs */}
            <div className="flex" style={{ borderBottom: "1px solid #2a2a3e" }}>
              <button
                onClick={() => setPositionTab("open")}
                style={{
                  padding: "8px 16px",
                  fontSize: "12px",
                  fontWeight: 600,
                  color: positionTab === "open" ? "#d1d4dc" : "#8a8a9a",
                  borderBottom: positionTab === "open" ? "2px solid #2962ff" : "2px solid transparent",
                  background: "none",
                  border: "none",
                  borderBottomStyle: "solid",
                  borderBottomWidth: "2px",
                  borderBottomColor: positionTab === "open" ? "#2962ff" : "transparent",
                  cursor: "pointer",
                }}
              >
                Open ({orders.length})
              </button>
              <button
                onClick={() => setPositionTab("closed")}
                style={{
                  padding: "8px 16px",
                  fontSize: "12px",
                  fontWeight: 600,
                  color: positionTab === "closed" ? "#d1d4dc" : "#8a8a9a",
                  background: "none",
                  border: "none",
                  borderBottomStyle: "solid",
                  borderBottomWidth: "2px",
                  borderBottomColor: positionTab === "closed" ? "#2962ff" : "transparent",
                  cursor: "pointer",
                }}
              >
                Closed ({closedOrders.length})
              </button>
            </div>

            {/* Positions list */}
            <div style={{ padding: "8px" }}>
              {positionTab === "open" && orders.length === 0 && (
                <div style={{ textAlign: "center", padding: "24px", color: "#8a8a9a", fontSize: "13px" }}>
                  No open positions
                </div>
              )}
              {positionTab === "closed" && closedOrders.length === 0 && (
                <div style={{ textAlign: "center", padding: "24px", color: "#8a8a9a", fontSize: "13px" }}>
                  No closed positions
                </div>
              )}

              {positionTab === "open" &&
                orders.map((o) => (
                  <div
                    key={o.orderId}
                    className="flex items-center"
                    style={{ padding: "8px", fontSize: "12px", borderBottom: "1px solid #2a2a3e", gap: "16px" }}
                  >
                    <span style={{ fontWeight: 600, color: o.orderType === "LONG" ? "#26a69a" : "#ef5350" }}>
                      {o.orderType}
                    </span>
                    <span>{o.asset}</span>
                    <span style={{ color: "#8a8a9a" }}>{o.leverage}x</span>
                    <span style={{ color: "#8a8a9a" }}>Qty: {o.qty}</span>
                    <span style={{ color: "#8a8a9a" }}>Entry: ${o.executionPrice}</span>
                    <span
                      style={{
                        color: parseFloat(o.currentPnL) >= 0 ? "#26a69a" : "#ef5350",
                        fontWeight: 600,
                      }}
                    >
                      PnL: ${o.currentPnL}
                    </span>
                    <div className="flex-1" />
                    <button
                      onClick={() => handleCloseOrder(o.orderId)}
                      style={{
                        background: "#ef5350",
                        color: "#fff",
                        border: "none",
                        padding: "4px 12px",
                        borderRadius: "3px",
                        fontSize: "11px",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      Close
                    </button>
                  </div>
                ))}

              {positionTab === "closed" &&
                closedOrders.map((o) => (
                  <div
                    key={o.orderId}
                    className="flex items-center"
                    style={{ padding: "8px", fontSize: "12px", borderBottom: "1px solid #2a2a3e", gap: "16px" }}
                  >
                    <span style={{ fontWeight: 600, color: o.orderType === "LONG" ? "#26a69a" : "#ef5350" }}>
                      {o.orderType}
                    </span>
                    <span>{o.asset}</span>
                    <span style={{ color: "#8a8a9a" }}>{o.leverage}x</span>
                    <span style={{ color: "#8a8a9a" }}>Qty: {o.qty}</span>
                    <span
                      style={{
                        color: parseFloat(o.currentPnL) >= 0 ? "#26a69a" : "#ef5350",
                        fontWeight: 600,
                      }}
                    >
                      PnL: ${o.currentPnL}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        </div>

        {/* ─── Right Sidebar: Order Form ────────────────── */}
        <div style={{ width: "280px", borderLeft: "1px solid #2a2a3e", padding: "16px", overflowY: "auto" }}>

          <div style={{ fontSize: "14px", fontWeight: 700, color: "#d1d4dc", marginBottom: "16px" }}>
            {ASSETS.find((a) => a.symbol === selectedAsset)?.label}/USD
          </div>

          {/* Sell / Buy buttons */}
          <div className="flex" style={{ gap: "4px", marginBottom: "16px" }}>
            <button
              onClick={() => setOrderType("SHORT")}
              style={{
                flex: 1,
                padding: "12px 8px",
                background: orderType === "SHORT" ? "#ef5350" : "#1e222d",
                color: orderType === "SHORT" ? "#fff" : "#8a8a9a",
                border: "none",
                borderRadius: "4px",
                fontSize: "12px",
                fontWeight: 700,
                cursor: "pointer",
                textAlign: "center",
              }}
            >
              <div>Sell</div>
              {currentPrice && (
                <div style={{ fontSize: "14px", marginTop: "2px" }}>{currentPrice.bidPrice.toFixed(2)}</div>
              )}
            </button>
            <button
              onClick={() => setOrderType("LONG")}
              style={{
                flex: 1,
                padding: "12px 8px",
                background: orderType === "LONG" ? "#26a69a" : "#1e222d",
                color: orderType === "LONG" ? "#fff" : "#8a8a9a",
                border: "none",
                borderRadius: "4px",
                fontSize: "12px",
                fontWeight: 700,
                cursor: "pointer",
                textAlign: "center",
              }}
            >
              <div>Buy</div>
              {currentPrice && (
                <div style={{ fontSize: "14px", marginTop: "2px" }}>{currentPrice.askPrice.toFixed(2)}</div>
              )}
            </button>
          </div>

          {/* Leverage */}
          <div style={{ marginBottom: "16px" }}>
            <label style={{ fontSize: "11px", color: "#8a8a9a", display: "block", marginBottom: "6px" }}>
              Leverage: {leverage}x
            </label>
            <input
              type="range"
              min={1}
              max={100}
              value={leverage}
              onChange={(e) => setLeverage(Number(e.target.value))}
              style={{ width: "100%", accentColor: "#FFB800" }}
            />
            <div className="flex" style={{ justifyContent: "space-between", fontSize: "10px", color: "#8a8a9a" }}>
              <span>1x</span>
              <span>100x</span>
            </div>
          </div>

          {/* Volume */}
          <div style={{ marginBottom: "16px" }}>
            <label style={{ fontSize: "11px", color: "#8a8a9a", display: "block", marginBottom: "6px" }}>Volume (USD)</label>
            <input
              type="number"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="0.00"
              style={{
                width: "100%",
                background: "#1e222d",
                border: "1px solid #2a2a3e",
                borderRadius: "4px",
                padding: "10px",
                color: "#d1d4dc",
                fontSize: "13px",
              }}
            />
          </div>

          {/* Take Profit */}
          <div style={{ marginBottom: "16px" }}>
            <label style={{ fontSize: "11px", color: "#8a8a9a", display: "block", marginBottom: "6px" }}>Take Profit</label>
            <input
              type="number"
              value={takeProfit}
              onChange={(e) => setTakeProfit(e.target.value)}
              placeholder="Not set"
              style={{
                width: "100%",
                background: "#1e222d",
                border: "1px solid #2a2a3e",
                borderRadius: "4px",
                padding: "10px",
                color: "#d1d4dc",
                fontSize: "13px",
              }}
            />
          </div>

          {/* Stop Loss */}
          <div style={{ marginBottom: "24px" }}>
            <label style={{ fontSize: "11px", color: "#8a8a9a", display: "block", marginBottom: "6px" }}>Stop Loss</label>
            <input
              type="number"
              value={stopLoss}
              onChange={(e) => setStopLoss(e.target.value)}
              placeholder="Not set"
              style={{
                width: "100%",
                background: "#1e222d",
                border: "1px solid #2a2a3e",
                borderRadius: "4px",
                padding: "10px",
                color: "#d1d4dc",
                fontSize: "13px",
              }}
            />
          </div>

          {orderError && (
            <p style={{ color: "#ef5350", fontSize: "12px", marginBottom: "12px" }}>{orderError}</p>
          )}

          {/* Place Order */}
          <button
            onClick={handleOpenOrder}
            disabled={orderLoading || !qty}
            style={{
              width: "100%",
              padding: "14px",
              background: orderType === "LONG" ? "#26a69a" : "#ef5350",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              fontSize: "13px",
              fontWeight: 700,
              cursor: orderLoading || !qty ? "not-allowed" : "pointer",
              opacity: orderLoading || !qty ? 0.5 : 1,
            }}
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
