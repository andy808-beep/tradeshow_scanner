import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export async function generateMetadata(
  props: PageProps<"/inquiries/[id]">,
): Promise<Metadata> {
  await props.params;
  return { title: "询问单详情 | Koei 展会询问" };
}

/** Rendered by AppScreens from the current path. */
export default function SavedInquiryDetailPage() {
  return null;
}
