'use client';

import Link, { useLinkStatus } from 'next/link';
import type { ComponentProps } from 'react';

function PendingMarker() {
  const { pending } = useLinkStatus();
  return pending ? <span data-route-loading hidden /> : null;
}

export function ProgressLink({ children, ...props }: ComponentProps<typeof Link>) {
  return <Link {...props}>{children}<PendingMarker /></Link>;
}
