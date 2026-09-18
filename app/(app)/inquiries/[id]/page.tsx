import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export async function generateMetadata(
  props: PageProps<"/inquiries/[id]">,
): Promise<Metadata> {
  const { id } = await props.params;
  return { title: `Inquiry ${id.slice(0, 8)} · Koei Porcelain` };
}

/** Rendered by AppScreens from the current path. */
export default function SavedInquiryDetailPage() {
  return null;
}
