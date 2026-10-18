import Link from "next/link";

type PageProps = {
  params: Promise<{ slug: string; subslug: string }>;
};

export default async function SubcategoryPage({ params }: PageProps) {
  const { slug, subslug } = await params;

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.15em] text-[#8f8676]">
          Subcategory
        </p>
        <h1 className="mt-1.5 text-3xl font-semibold text-[#1f1c17]">{subslug}</h1>
        <p className="mt-1.5 text-sm text-[#655d51]">
          Under category <span className="font-medium text-[#1f1c17]">{slug}</span>.
        </p>
      </div>

      <div className="rounded-2xl border border-black/5 bg-white/90 p-5 shadow-[0_8px_30px_rgba(18,16,13,0.05)]">
        <p className="text-sm font-semibold text-[#1f1c17]">Coming soon</p>
        <p className="mt-2 text-sm text-[#655d51]">
          This is a placeholder page for a custom subcategory.
        </p>
      </div>

      <Link
        href={["investing", "cinematography", "library"].includes(slug) ? `/${slug}` : `/c/${slug}`}
        className="inline-flex rounded-full border border-black/10 bg-white px-3.5 py-1.5 text-xs font-medium text-[#3b352d] hover:bg-[#faf8f2]"
      >
        Back
      </Link>
    </div>
  );
}

