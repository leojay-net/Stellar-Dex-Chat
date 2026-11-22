'use client';

import React, { Suspense } from 'react';
import dynamic from 'next/dynamic';

const UserSettings = dynamic(() => import('./UserSettings'), {
  ssr: false,
});

interface UserSettingsWrapperProps {
  isOpen: boolean;
  onClose: () => void;
  onResetOnboarding?: () => void;
}

export default function UserSettingsWrapper(props: UserSettingsWrapperProps) {
  return (
    <Suspense fallback={null}>
      <UserSettings {...props} />
    </Suspense>
  );
}