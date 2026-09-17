import type { Metadata } from "next";
import InquiryScreen from "@/components/inquiry-screen";

export const metadata: Metadata = {
  title: "Inquiry · Koei Porcelain",
};

export default function InquiryPage() {
  return <InquiryScreen />;
}
