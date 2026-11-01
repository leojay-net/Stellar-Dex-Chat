import * as Sentry from '@sentry/nextjs';

const REPLAY_SESSION_SAMPLE_RATE = 0.1;
const REPLAY_OPTIONS = {
  maskAllText: true,
  blockAllMedia: true,
};

let replayIntegrationLoaded = false;

async function loadReplayIntegration() {
  if (replayIntegrationLoaded || typeof window === 'undefined') {
    return;
  }

  replayIntegrationLoaded = true;

  try {
    // @ts-expect-error @sentry/replay is an optional dynamic peer dependency
    const { replayIntegration } = await import('@sentry/replay');
    Sentry.addIntegration(replayIntegration(REPLAY_OPTIONS));
  } catch (error) {
    console.warn('Failed to lazy-load Sentry Replay integration:', error);
  }
}

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 1.0,
  debug: false,
  replaysOnErrorSampleRate: 1.0,
  replaysSessionSampleRate: REPLAY_SESSION_SAMPLE_RATE,
  integrations: [],
  beforeSend(event, hint) {
    if (event.exception) {
      const error = hint.originalException;
      console.error('Sentry capturing error:', error);
      void loadReplayIntegration();
    }
    return event;
  },
  environment: process.env.NODE_ENV || 'development',
});

if (
  typeof window !== 'undefined' &&
  Math.random() < REPLAY_SESSION_SAMPLE_RATE
) {
  void loadReplayIntegration();
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
