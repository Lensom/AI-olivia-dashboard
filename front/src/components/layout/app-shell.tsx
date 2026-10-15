import { ReactNode } from "react";
import { Footer } from "./footer";
import { Header } from "./header";
import { Sidebar } from "./sidebar";
import { AuthProvider } from "@/state/auth-store";
import { CategoriesProvider } from "@/state/categories-store";
import { BrokerProvider } from "@/state/broker-store";
import { InvestingProvider } from "@/state/investing-store";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-[#f6f3ea]">
      <AuthProvider>
        <Header />
        <CategoriesProvider>
          <InvestingProvider>
            <BrokerProvider>
              <div className="mx-auto flex w-full max-w-[1760px] flex-1 gap-5 px-4 py-7 md:px-5 md:py-8">
                <Sidebar />
                <main className="min-w-0 flex-1">{children}</main>
              </div>
            </BrokerProvider>
          </InvestingProvider>
        </CategoriesProvider>
        <Footer />
      </AuthProvider>
    </div>
  );
}
