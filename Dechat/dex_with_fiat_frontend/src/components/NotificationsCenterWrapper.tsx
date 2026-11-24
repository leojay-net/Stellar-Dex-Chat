'use client';

import React, { Suspense } from 'react';
import dynamic from 'next/dynamic';

const NotificationsCenter = dynamic(() => import('./NotificationsCenter'), {
  ssr: false,
});

export default function NotificationsCenterWrapper() {
  return (
    <Suspense fallback={null}>
      <NotificationsCenter />
    </Suspense>
  );
}
