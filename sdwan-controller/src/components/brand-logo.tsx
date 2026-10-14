'use client';

import { useState } from 'react';
import { Network } from 'lucide-react';
import Image from 'next/image';

export function BrandLogo({ compact = false }: { compact?: boolean }) {
  const [available, setAvailable] = useState(true);
  return available ? (
    <Image
      src="/api/branding/logo"
      alt="Organization logo"
      width={600}
      height={180}
      unoptimized
      style={{ width: 'auto', height: 'auto' }}
      onError={() => setAvailable(false)}
      className={compact ? 'max-h-10 max-w-[164px] object-contain' : 'max-h-14 max-w-[220px] object-contain'}
    />
  ) : (
    <div className="flex items-center gap-2 text-primary">
      <Network size={compact ? 22 : 26} />
      <span className="font-semibold">SD-WAN Controller</span>
    </div>
  );
}
