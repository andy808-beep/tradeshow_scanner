"use client";

import { useEffect, useState } from "react";

export default function OnlineOnlyNotice({ children }: { children: string }) {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    function update() {
      setOnline(navigator.onLine);
    }
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (online) return null;

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <p className="font-semibold">Network required</p>
      <p className="mt-1">{children}</p>
    </div>
  );
}
