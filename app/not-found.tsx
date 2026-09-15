import Link from "next/link";

export default function NotFound() {
  return (
    <div className="space-y-4 py-10 text-center">
      <h1 className="text-lg font-semibold text-porcelain-950">Product not found</h1>
      <p className="text-sm text-porcelain-600">
        That product code is not in the sample catalogue yet.
      </p>
      <Link
        href="/"
        className="inline-block rounded-xl bg-porcelain-600 px-4 py-3 text-sm font-semibold text-white"
      >
        Back to search
      </Link>
    </div>
  );
}
