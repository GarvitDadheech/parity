import Link from "next/link";

const links = [
  { href: "/", label: "Markets" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/policies", label: "Automation" },
];

export function SiteNav() {
  return (
    <header className="border-hairline sticky top-0 z-20 border-b bg-canvas/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-6 px-5 py-3 md:px-8">
        <Link
          href="/"
          className="text-ink hover:text-accent text-sm font-medium tracking-tight transition-colors duration-100"
        >
          parity
        </Link>

        <nav className="flex items-center gap-4" aria-label="Main">
          {links.slice(1).map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-ink-dim hover:text-ink text-xs transition-colors duration-100"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto">
          <TelegramLink />
        </div>
      </div>
    </header>
  );
}

function TelegramLink() {
  const username = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
  if (!username) {
    return (
      <span className="text-ink-faint text-xs" title="Set NEXT_PUBLIC_TELEGRAM_BOT_USERNAME">
        Bot not configured
      </span>
    );
  }

  return (
    <a
      href={`https://t.me/${username}`}
      target="_blank"
      rel="noreferrer"
      className="border-hairline-strong text-ink hover:border-accent hover:text-accent inline-flex min-h-10 items-center rounded-sm border px-3 text-xs transition-colors duration-100"
    >
      Open in Telegram
    </a>
  );
}
