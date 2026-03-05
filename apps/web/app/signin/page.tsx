"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/v1/user/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || "Invalid credentials");
        return;
      }

      router.push("/trade");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

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

          {/* Tabs */}
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

          {/* Form */}
          <form onSubmit={handleSubmit} className="flex flex-col">

            {/* Email */}
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

            {/* Password */}
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

            {/* Sign in button */}
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
        </div>
      </div>
    </div>
  );
}
