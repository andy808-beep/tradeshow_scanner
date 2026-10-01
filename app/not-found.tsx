import Link from "next/link";
import { zh } from "@/lib/i18n/zh-cn";

export default function NotFound() {
  return (
    <div className="space-y-4 py-10 text-center">
      <h1 className="text-lg font-semibold text-porcelain-950">{zh.notFound.title}</h1>
      <p className="text-sm text-porcelain-600">{zh.notFound.body}</p>
      <Link
        href="/"
        className="inline-block rounded-xl bg-porcelain-600 px-4 py-3 text-sm font-semibold text-white"
      >
        {zh.notFound.back}
      </Link>
    </div>
  );
}
