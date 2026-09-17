import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import BottomNav from "@/components/bottom-nav";
import CatalogueStatus from "@/components/catalogue-status";
import { CatalogueProvider } from "@/components/catalogue-provider";
import SiteHeader from "@/components/site-header";
import { AuthenticationError } from "@/lib/auth/errors";
import { requireAuthenticatedUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}) {
  let email: string;
  try {
    const user = await requireAuthenticatedUser();
    email = user.email ?? "Employee";
  } catch (error) {
    if (error instanceof AuthenticationError) {
      redirect("/login");
    }
    throw error;
  }

  return (
    <CatalogueProvider>
      <SiteHeader email={email} />
      <CatalogueStatus />
      <main className="flex-1 px-4 pt-4 pb-24 print:p-0">{children}</main>
      <BottomNav />
    </CatalogueProvider>
  );
}
