import type { Metadata } from "next";
import LabelsScreen from "@/components/labels-screen";

export const metadata: Metadata = {
  title: "Labels · Koei Porcelain",
};

export default function LabelsPage() {
  return <LabelsScreen />;
}
