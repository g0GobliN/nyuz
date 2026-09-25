import { Link, useNavigate } from "@tanstack/react-router";
import { CreditCard, LogOut, Settings } from "lucide-react";
import { useState } from "react";
import { UserAvatar } from "@/components/user-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/auth";
import { NAV_STAFF } from "@/lib/dashboard-nav";

/**
 * The avatar in the header.
 *
 * It used to be a plain link to Settings, which meant the app had no way to
 * sign out at all — `signOut` existed on the auth context and nothing in the
 * product ever called it. The avatar is where people look for that, so it opens
 * a menu instead, with Settings still one click away.
 *
 * It also carries Billing and the staff destinations, because in neither chrome
 * does the sideways-scrolling strip list them. `NAV_STAFF` lives in the sidebar,
 * and the sidebar is absent from both the app shell and the browser's
 * `lg:hidden` mobile layout — so without this menu there would be no link to the
 * console anywhere in the product, and the only way in would be typing the URL. They are
 * rendered at every width rather than behind `lg:hidden`: a menu whose contents
 * change depending on how wide the window is is worse than one extra row on a
 * desktop that also has a sidebar.
 *
 * One implementation, two headers (the website's and the app shell's). The
 * shadow of a second copy is a sign-out that works in one of them.
 */
export function AccountMenu({ staff, name }: { staff: boolean; name: string }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  const out = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } catch (error) {
      console.error(error);
    } finally {
      // Home either way. A sign-out that fails and leaves someone sitting on a
      // dashboard they believe they have left is the worse outcome; the auth
      // listener reconciles the real session state on the way.
      navigate({ to: "/" });
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Account"
          className="ml-1 flex items-center justify-center rounded-full transition-opacity hover:opacity-85"
        >
          <UserAvatar name={name} />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        {/* Identifies the account before offering to leave it — on a shared
            machine, which account you are signing out of is the question. */}
        {name || user?.email ? (
          <>
            <div className="px-2 py-1.5">
              {name ? <p className="truncate text-[13px] font-medium">{name}</p> : null}
              {user?.email ? (
                <p className="truncate text-[12px] text-muted-foreground">{user.email}</p>
              ) : null}
            </div>
            <DropdownMenuSeparator />
          </>
        ) : null}

        <DropdownMenuItem asChild>
          <Link to="/dashboard/settings">
            <Settings /> Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/dashboard/billing">
            <CreditCard /> Billing
          </Link>
        </DropdownMenuItem>

        {staff ? (
          <>
            <DropdownMenuSeparator />
            {NAV_STAFF.map(({ to, label, icon: Icon }) => (
              <DropdownMenuItem key={to} asChild>
                <Link to={to}>
                  <Icon /> {label}
                </Link>
              </DropdownMenuItem>
            ))}
          </>
        ) : null}

        <DropdownMenuSeparator />

        <DropdownMenuItem onSelect={() => void out()} disabled={signingOut}>
          <LogOut /> {signingOut ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
