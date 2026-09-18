"use client";

import type { ReactNode } from "react";
import { useAppPath } from "./app-path";
import InquiryScreen from "./inquiry-screen";
import LabelsScreen from "./labels-screen";
import SavedInquiriesScreen from "./saved-inquiries-screen";
import SavedInquiryDetailScreen from "./saved-inquiry-detail-screen";
import SearchPanel from "./search-panel";

/**
 * Renders the main booth screens from the current path so switching to
 * /inquiry does not wait on a server/RSC response. Product detail routes
 * still use the page `children`.
 */
export default function AppScreens({ children }: { children: ReactNode }) {
  const { path } = useAppPath();

  if (path === "/inquiry") return <InquiryScreen />;
  if (path === "/labels") return <LabelsScreen />;
  if (path === "/inquiries") return <SavedInquiriesScreen />;
  if (path.startsWith("/inquiries/")) {
    return <SavedInquiryDetailScreen id={path.slice("/inquiries/".length)} />;
  }
  if (path === "/") return <SearchPanel />;
  return <>{children}</>;
}
