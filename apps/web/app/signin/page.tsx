"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import api from "@/lib/axios";

type AuthTab = "password" | "magic-link";

export default function SignIn() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<AuthTab>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await api.post("/api/v1/user/signin", { email, password });
      router.push("/trade");
    } catch (err: any) {
      setError(err.response?.data?.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleMagicLinkSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await api.post("/api/v1/user/magic-link", { email });
      setMagicLinkSent(true);
    } catch (err: any) {
      const message = err.response?.data?.message || "Something went wrong. Please try again.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  const tabStyle = (isActive: boolean) => ({
    flex: 1,
    paddingBottom: "12px",
    fontSize: "14px",
    fontWeight: isActive ? 600 : 500,
    color: isActive ? "#141d22" : "#9ca3af",
    borderBottom: isActive ? "3px solid #141d22" : "none",
    marginBottom: "-1px",
    cursor: "pointer" as const,
    textAlign: "center" as const,
    background: "none",
    border: "none",
  });

  return (
    <div className="min-h-screen bg-white flex flex-col">

      {/* Navbar */}
      <header style={{ borderBottom: "1px solid #e5e7eb", padding: "20px 32px" }}>
        <Link
          href="/"
          style={{ fontSize: "24px", fontWeight: 600, color: "#141d22", letterSpacing: "-0.03em" }}
        >
          velox
        </Link>
      </header>

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center" style={{ paddingTop: "64px" }}>
        <div className="w-full" style={{ maxWidth: "480px", padding: "0 16px" }}>

          {/* Heading */}
          <h1 style={{ fontSize: "28px", fontWeight: 700, color: "#141d22", marginBottom: "32px" }}>
            Welcome to Velox
          </h1>

          {/* Sign in / Register tabs */}
          <div className="flex" style={{ borderBottom: "1px solid #e5e7eb", marginBottom: "32px" }}>
            <div
              style={{
                flex: 1,
                paddingBottom: "12px",
                fontSize: "14px",
                fontWeight: 600,
                color: "#141d22",
                borderBottom: "3px solid #141d22",
                marginBottom: "-1px",
                cursor: "pointer",
                textAlign: "center",
              }}
            >
              Sign in
            </div>
            <Link
              href="/register"
              style={{
                flex: 1,
                paddingBottom: "12px",
                fontSize: "14px",
                fontWeight: 500,
                color: "#9ca3af",
                textAlign: "center",
              }}
            >
              Create an account
            </Link>
          </div>

          {/* Auth method tabs */}
          <div className="flex" style={{ marginBottom: "24px", gap: "4px" }}>
            <button
              onClick={() => { setActiveTab("password"); setError(""); setMagicLinkSent(false); }}
              style={tabStyle(activeTab === "password")}
            >
              Password
            </button>
            <button
              onClick={() => { setActiveTab("magic-link"); setError(""); setMagicLinkSent(false); }}
              style={tabStyle(activeTab === "magic-link")}
            >
              Email Link
            </button>
          </div>

          {/* Password form */}
          {activeTab === "password" && (
            <form onSubmit={handlePasswordSubmit} className="flex flex-col">
              <div className="flex flex-col" style={{ gap: "8px", marginBottom: "24px" }}>
                <label style={{ fontSize: "14px", color: "#374151" }}>Your email address</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full focus:outline-none"
                  style={{
                    border: "1px solid #d1d5db",
                    borderRadius: "6px",
                    padding: "14px 12px",
                    fontSize: "14px",
                  }}
                />
              </div>

              <div className="flex flex-col" style={{ gap: "8px", marginBottom: "40px" }}>
                <label style={{ fontSize: "14px", color: "#374151" }}>Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full focus:outline-none"
                    style={{
                      border: "1px solid #d1d5db",
                      borderRadius: "6px",
                      padding: "14px 40px 14px 12px",
                      fontSize: "14px",
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2"
                    style={{ color: "#9ca3af" }}
                  >
                    {showPassword ? (
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {error && <p style={{ color: "#ef4444", fontSize: "14px", marginBottom: "16px" }}>{error}</p>}

              <button
                type="submit"
                disabled={loading}
                className="w-full disabled:opacity-60 transition-colors"
                style={{
                  backgroundColor: "#FFB800",
                  padding: "16px",
                  borderRadius: "6px",
                  fontSize: "14px",
                  fontWeight: 600,
                  color: "#141d22",
                }}
              >
                {loading ? "Signing in..." : "Sign in"}
              </button>
            </form>
          )}

          {/* Magic link form */}
          {activeTab === "magic-link" && (
            <>
              {magicLinkSent ? (
                <div className="flex flex-col items-center" style={{ padding: "32px 0", textAlign: "center" }}>
                  <div style={{
                    width: "48px",
                    height: "48px",
                    borderRadius: "50%",
                    backgroundColor: "#FFF8E1",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: "16px",
                    fontSize: "24px",
                  }}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="#FFB800" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <h2 style={{ fontSize: "18px", fontWeight: 600, color: "#141d22", marginBottom: "8px" }}>
                    Check your inbox
                  </h2>
                  <p style={{ fontSize: "14px", color: "#6b7280", lineHeight: 1.5 }}>
                    We sent a sign-in link to <strong>{email}</strong>. Click the link in the email to sign in.
                  </p>
                  <button
                    onClick={() => { setMagicLinkSent(false); setEmail(""); }}
                    style={{
                      marginTop: "24px",
                      fontSize: "14px",
                      color: "#FFB800",
                      fontWeight: 600,
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                    }}
                  >
                    Use a different email
                  </button>
                </div>
              ) : (
                <form onSubmit={handleMagicLinkSubmit} className="flex flex-col">
                  <div className="flex flex-col" style={{ gap: "8px", marginBottom: "40px" }}>
                    <label style={{ fontSize: "14px", color: "#374151" }}>Your email address</label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full focus:outline-none"
                      style={{
                        border: "1px solid #d1d5db",
                        borderRadius: "6px",
                        padding: "14px 12px",
                        fontSize: "14px",
                      }}
                    />
                  </div>

                  {error && (
                    <div style={{ marginBottom: "16px" }}>
                      <p style={{ color: "#ef4444", fontSize: "14px" }}>{error}</p>
                      {error.includes("register") && (
                        <Link href="/register" style={{ color: "#FFB800", fontSize: "14px", fontWeight: 600 }}>
                          Create an account
                        </Link>
                      )}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full disabled:opacity-60 transition-colors"
                    style={{
                      backgroundColor: "#FFB800",
                      padding: "16px",
                      borderRadius: "6px",
                      fontSize: "14px",
                      fontWeight: 600,
                      color: "#141d22",
                    }}
                  >
                    {loading ? "Sending..." : "Send Magic Link"}
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
