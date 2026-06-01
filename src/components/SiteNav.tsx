import { Link } from "@tanstack/react-router";

export function SiteNav() {
  return (
    <header className="sticky top-6 z-50 flex justify-center px-4">
      <nav className="pill-nav flex items-center gap-1 px-2 py-2">
        <Link to="/" className="flex items-center gap-2 px-4 py-2 font-semibold">
          <span className="inline-block size-5 rounded-md bg-foreground" />
          ForgeCloud
        </Link>
        <a href="#product" className="hidden md:inline px-3 py-2 text-sm text-muted-foreground hover:text-foreground">Product</a>
        <a href="#agents" className="hidden md:inline px-3 py-2 text-sm text-muted-foreground hover:text-foreground">Agents</a>
        <a href="#flow" className="hidden md:inline px-3 py-2 text-sm text-muted-foreground hover:text-foreground">Flow</a>
        <a href="#pricing" className="hidden md:inline px-3 py-2 text-sm text-muted-foreground hover:text-foreground">Pricing</a>
        <Link to="/app/chat" className="ml-1 rounded-full px-4 py-2 text-sm font-medium hover:bg-muted">Sign in</Link>
        <Link
          to="/app/chat"
          className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90"
        >
          Start building
        </Link>
      </nav>
    </header>
  );
}
