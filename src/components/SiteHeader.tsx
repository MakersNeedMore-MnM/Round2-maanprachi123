import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import logo from "@/assets/logo.svg";
import { LogOut } from "lucide-react";
import { Link, useNavigate } from "react-router";

export function SiteHeader({ active }: { active?: "audit" | "method" }) {
  const { isLoading, isAuthenticated, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate("/");
    } catch (error) {
      console.error("Sign out error:", error);
    }
  };

  return (
    <header className="border-b border-border/70 bg-background/80 backdrop-blur-sm">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-2.5">
          <img src={logo} alt="Obsolescence Score" width={24} height={24} className="rounded-[4px]" />
          <span className="text-sm font-semibold tracking-tight">Obsolescence Score</span>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            — an internal tool
          </span>
        </Link>
        <nav className="flex items-center gap-1">
          <Link
            to="/dashboard"
            className={
              "rounded-md px-3 py-1.5 text-sm transition-colors " +
              (active === "audit"
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            Audit
          </Link>
          <Link
            to="/#method"
            className={
              "rounded-md px-3 py-1.5 text-sm transition-colors " +
              (active === "method"
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            Method
          </Link>
          {!isLoading && isAuthenticated && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-2 gap-1.5 text-muted-foreground hover:text-foreground"
              onClick={handleSignOut}
            >
              <LogOut className="size-3.5" />
              Sign out
            </Button>
          )}
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border/70">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-1 px-6 py-8 text-xs text-muted-foreground sm:flex-row sm:items-baseline sm:justify-between">
        <p>Obsolescence Score — an internal research instrument.</p>
        <p>Every number is either measured from the live site or labeled as an estimate.</p>
      </div>
    </footer>
  );
}
