import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center pb-32">
      <div className="flex flex-col items-center w-full px-6" style={{ maxWidth: "480px", gap: "0" }}>
        <h1
          className="text-5xl font-light text-gray-900"
          style={{ letterSpacing: "-0.03em", marginBottom: "40px", fontWeight: "500" }}
        >
          velox
        </h1>

        <p
          className="text-gray-500 text-sm text-center leading-relaxed"
          style={{ marginBottom: "40px" }}
        >
          Please sign in or register for full access to Velox content and services.
        </p>

        <div className="flex flex-col w-full" style={{ gap: "12px" }}>
          <Link
            href="/signin"
            className="w-full text-gray-900 font-semibold text-center transition-colors text-sm"
            style={{
              backgroundColor: "#FFB800",
              padding: "18px",
              borderRadius: "12px",
            }}
          >
            Sign in
          </Link>
          <Link
            href="/register"
            className="w-full text-gray-900 font-semibold text-center transition-colors text-sm"
            style={{
              backgroundColor: "#F2F2F2",
              padding: "18px",
              borderRadius: "12px",
            }}
          >
            Register
          </Link>
        </div>
      </div>
    </div>
  );
}
