"use client";

import { signOutAction } from "@/lib/auth/actions";
import { clearConfidentialLocalData } from "@/lib/offline/clear";
import { useCatalogue } from "./catalogue-provider";
import { useInquiry } from "./inquiry-store";

export default function LogoutButton() {
  const { resetLocal } = useCatalogue();
  const { clearInquiry } = useInquiry();

  async function handleLogout() {
    try {
      await clearConfidentialLocalData();
    } finally {
      resetLocal();
      clearInquiry();
      await signOutAction();
    }
  }

  return (
    <button
      type="button"
      onClick={() => {
        void handleLogout();
      }}
      className="text-[11px] font-semibold tracking-wide text-white underline decoration-porcelain-300 underline-offset-2"
    >
      Log out
    </button>
  );
}
