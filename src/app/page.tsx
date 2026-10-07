import Link from "next/link";

// The home page deliberately says almost nothing. Astrologers use their personal link; ops use /ops.
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-bold">Astrotalk Live</h1>
      <p className="text-[var(--muted)]">Astrologers: please use the personal link you were sent.</p>
      <Link className="btn" href="/ops">
        Team login
      </Link>
    </main>
  );
}
