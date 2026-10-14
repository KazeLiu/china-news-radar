export function AiTitleBadge({ generated }: { generated?: boolean }) {
  return generated ? <span className="inline-block align-middle mx-1.5 rounded border border-[var(--accent-blue)]/30 px-1.5 py-0.5 text-xs font-normal text-[var(--accent-blue)] whitespace-nowrap">AI生成</span> : null;
}
