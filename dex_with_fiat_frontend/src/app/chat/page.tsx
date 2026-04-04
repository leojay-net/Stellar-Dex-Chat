'use client';
import dynamic from 'next/dynamic';

const StellarChatInterface = dynamic(
  () => import('@/components/StellarChatInterface'),
  { ssr: false }
);

export default function ChatPage() {
  return (
    <main className="h-screen w-screen overflow-hidden">
      <StellarChatInterface />
    </main>
  );
}
