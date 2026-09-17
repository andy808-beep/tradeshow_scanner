import LogoutButton from "./logout-button";

export default function SiteHeader({ email }: { email: string }) {
  return (
    <header className="print-chrome sticky top-0 z-10 bg-porcelain-800 px-4 py-2.5 text-white shadow-sm print:hidden">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-base leading-tight font-semibold tracking-tight">
            Koei Porcelain
          </p>
          <p className="text-xs text-porcelain-200">Trade show inquiry tool</p>
        </div>
        <div className="flex min-w-0 max-w-[58%] flex-col items-end gap-0.5">
          <p
            className="w-full truncate text-right text-[11px] leading-tight text-porcelain-200"
            title={email}
          >
            {email}
          </p>
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
