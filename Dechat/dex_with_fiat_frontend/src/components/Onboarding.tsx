'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { X, ChevronRight, ChevronLeft, Play } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { useAccessibleModal } from '@/hooks/useAccessibleModal';

const ONBOARDING_COMPLETED_KEY = 'onboarding-completed';
const ONBOARDING_SKIPPED_KEY = 'onboarding-skipped';

interface CoachMark {
  id: string;
  title: string;
  description: string;
  targetSelector: string;
  position: 'top' | 'bottom' | 'left' | 'right';
}

const COACH_MARKS: CoachMark[] = [
  {
    id: 'wallet',
    title: 'Connect Your Wallet',
    description:
      'Click here to connect your Stellar wallet using Freighter. You need a connected wallet to make transactions.',
    targetSelector:
      '#onboarding-wallet-connect, button[aria-label*="connect"], button[aria-label*="wallet"]',
    position: 'bottom',
  },
  {
    id: 'chat',
    title: 'Chat with the Assistant',
    description:
      'Type your questions here. Try commands like /deposit, /rates, /portfolio, or /help to get started.',
    targetSelector:
      '[data-testid="chat-input-textarea"], textarea[placeholder*="Ask"]',
    position: 'top',
  },
  {
    id: 'sidebar',
    title: 'Chat History',
    description:
      'Access your previous conversations and continue where you left off.',
    targetSelector:
      '#onboarding-sidebar-toggle, button[aria-label*="menu"], button[aria-label*="sidebar"]',
    position: 'right',
  },
  {
    id: 'settings',
    title: 'Settings & Preferences',
    description:
      'Customize your experience: change currency, language, manage beneficiaries, and re-open this tour anytime.',
    targetSelector: '#onboarding-settings, button[aria-label*="settings"]',
    position: 'left',
  },
  {
    id: 'fees',
    title: 'Transaction Fees',
    description:
      'Stellar transactions have minimal fees. Check the network status badge at the top to see connection health.',
    targetSelector:
      '#onboarding-health-badge, [role="status"][title*="API"], [role="status"][title*="Stellar"]',
    position: 'bottom',
  },
];

interface OnboardingProps {
  isOpen: boolean;
  onClose: () => void;
  forceShow?: boolean;
}

export function useOnboarding() {
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(false);
  const [hasSkippedOnboarding, setHasSkippedOnboarding] = useState(false);

  useEffect(() => {
    const completed = localStorage.getItem(ONBOARDING_COMPLETED_KEY) === 'true';
    const skipped = localStorage.getItem(ONBOARDING_SKIPPED_KEY) === 'true';
    setHasCompletedOnboarding(completed);
    setHasSkippedOnboarding(skipped);
  }, []);

  const markCompleted = useCallback(() => {
    localStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true');
    localStorage.removeItem(ONBOARDING_SKIPPED_KEY);
    setHasCompletedOnboarding(true);
    setHasSkippedOnboarding(false);
  }, []);

  const markSkipped = useCallback(() => {
    localStorage.setItem(ONBOARDING_SKIPPED_KEY, 'true');
    setHasSkippedOnboarding(true);
  }, []);

  const resetOnboarding = useCallback(() => {
    localStorage.removeItem(ONBOARDING_COMPLETED_KEY);
    localStorage.removeItem(ONBOARDING_SKIPPED_KEY);
    setHasCompletedOnboarding(false);
    setHasSkippedOnboarding(false);
  }, []);

  const shouldShowOnboarding = !hasCompletedOnboarding && !hasSkippedOnboarding;

  return {
    hasCompletedOnboarding,
    hasSkippedOnboarding,
    shouldShowOnboarding,
    markCompleted,
    markSkipped,
    resetOnboarding,
  };
}

export default function Onboarding({
  isOpen,
  onClose,
  forceShow = false,
}: OnboardingProps) {
  const isVisible = isOpen || forceShow;
  const { isDarkMode } = useTheme();
  const [currentStep, setCurrentStep] = useState(0);
  const [targetElement, setTargetElement] = useState<HTMLElement | null>(null);
  const [highlightPosition, setHighlightPosition] = useState({
    top: 0,
    left: 0,
    width: 0,
    height: 0,
  });
  const panelRef = useRef<HTMLDivElement>(null);

  useAccessibleModal(isVisible, panelRef, onClose);

  const currentMark = COACH_MARKS[currentStep];

  // Find and highlight the target element
  useEffect(() => {
    if (!isVisible || !currentMark) return;

    const findTarget = () => {
      const targets = document.querySelectorAll(currentMark.targetSelector);
      if (targets.length > 0) {
        const target = targets[0] as HTMLElement;
        setTargetElement(target);
        const rect = target.getBoundingClientRect();
        setHighlightPosition({
          top: rect.top + window.scrollY,
          left: rect.left + window.scrollX,
          width: rect.width,
          height: rect.height,
        });
      }
    };

    // Initial find
    findTarget();

    // Retry if element not found (might be loading)
    const timeout = setTimeout(findTarget, 500);
    const retryTimeout = setTimeout(findTarget, 1500);

    return () => {
      clearTimeout(timeout);
      clearTimeout(retryTimeout);
    };
  }, [isVisible, currentStep, currentMark]);

  // Scroll target into view
  useEffect(() => {
    if (targetElement) {
      targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [targetElement]);

  const handleNext = () => {
    if (currentStep < COACH_MARKS.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleComplete();
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleComplete = () => {
    localStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true');
    localStorage.removeItem(ONBOARDING_SKIPPED_KEY);
    onClose();
  };

  const handleSkip = () => {
    localStorage.setItem(ONBOARDING_SKIPPED_KEY, 'true');
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'Escape':
        onClose();
        break;
      case 'ArrowRight':
        e.preventDefault();
        handleNext();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        handlePrevious();
        break;
    }
  };

  if (!isVisible) return null;

  // Calculate popover position based on target and coach mark position
  const getPopoverPosition = () => {
    const { top, left, width, height } = highlightPosition;
    const popoverWidth = 320;
    const popoverHeight = 200;
    const gap = 12;

    switch (currentMark.position) {
      case 'top':
        return {
          top: top - popoverHeight - gap,
          left: Math.max(12, left + width / 2 - popoverWidth / 2),
        };
      case 'bottom':
        return {
          top: top + height + gap,
          left: Math.max(12, left + width / 2 - popoverWidth / 2),
        };
      case 'left':
        return {
          top: Math.max(12, top + height / 2 - popoverHeight / 2),
          left: left - popoverWidth - gap,
        };
      case 'right':
        return {
          top: Math.max(12, top + height / 2 - popoverHeight / 2),
          left: left + width + gap,
        };
    }
  };

  const popoverPosition = getPopoverPosition();

  return (
    <>
      {/* Backdrop with dimmed areas */}
      <div
        className="fixed inset-0 z-[100] pointer-events-none"
        aria-hidden="true"
      >
        {/* Dark overlay */}
        <div
          className={`absolute inset-0 transition-opacity duration-300 ${
            isDarkMode ? 'bg-black/70' : 'bg-black/50'
          }`}
        />

        {/* Highlight hole */}
        {targetElement && (
          <div
            className={`absolute transition-all duration-300 ease-out border-2 ${
              isDarkMode
                ? 'border-blue-400 shadow-[0_0_0_4px_rgba(59,130,246,0.3)]'
                : 'border-blue-500 shadow-[0_0_0_4px_rgba(59,130,246,0.2)]'
            }`}
            style={{
              top: highlightPosition.top,
              left: highlightPosition.left,
              width: highlightPosition.width,
              height: highlightPosition.height,
              borderRadius: '8px',
            }}
          />
        )}
      </div>

      {/* Coach mark popover */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Onboarding step ${currentStep + 1} of ${COACH_MARKS.length}: ${currentMark.title}`}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={`fixed z-[110] w-80 rounded-xl shadow-2xl transition-all duration-300 ease-out pointer-events-auto focus:outline-none ${
          isDarkMode
            ? 'bg-gray-800 border border-gray-700'
            : 'bg-white border border-gray-200'
        }`}
        style={{
          top: popoverPosition.top,
          left: popoverPosition.left,
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          aria-label="Close onboarding"
          className={`absolute top-3 right-3 p-1.5 rounded-lg transition-colors ${
            isDarkMode
              ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-700'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
          }`}
        >
          <X className="w-4 h-4" />
        </button>

        {/* Content */}
        <div className="p-5">
          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-3">
            <div className="flex gap-1">
              {COACH_MARKS.map((_, idx) => (
                <div
                  key={idx}
                  className={`h-1 rounded-full transition-all duration-300 ${
                    idx === currentStep
                      ? 'w-6 bg-blue-500'
                      : idx < currentStep
                        ? 'w-4 bg-blue-500/50'
                        : 'w-4 bg-gray-600'
                  }`}
                  aria-hidden="true"
                />
              ))}
            </div>
            <span
              className={`text-xs font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}
            >
              {currentStep + 1} / {COACH_MARKS.length}
            </span>
          </div>

          {/* Title and description */}
          <h3
            className={`text-base font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}
          >
            {currentMark.title}
          </h3>
          <p
            className={`text-sm leading-relaxed mb-4 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}
          >
            {currentMark.description}
          </p>

          {/* Navigation buttons */}
          <div className="flex items-center justify-between gap-3">
            <button
              onClick={handleSkip}
              className={`text-sm font-medium transition-colors ${
                isDarkMode
                  ? 'text-gray-400 hover:text-gray-200'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Skip tour
            </button>

            <div className="flex items-center gap-2">
              {currentStep > 0 && (
                <button
                  onClick={handlePrevious}
                  aria-label="Previous step"
                  className={`p-2 rounded-lg transition-colors ${
                    isDarkMode
                      ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-700'
                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
              )}

              <button
                onClick={handleNext}
                aria-label={
                  currentStep === COACH_MARKS.length - 1
                    ? 'Complete onboarding'
                    : 'Next step'
                }
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isDarkMode
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                {currentStep === COACH_MARKS.length - 1 ? (
                  <>
                    <Play className="w-3.5 h-3.5" />
                    Get started
                  </>
                ) : (
                  <>
                    Next
                    <ChevronRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Arrow pointing to target */}
        <div
          className={`absolute w-3 h-3 transform rotate-45 ${
            isDarkMode
              ? 'bg-gray-800 border-r border-b border-gray-700'
              : 'bg-white border-r border-b border-gray-200'
          }`}
          style={{
            top:
              currentMark.position === 'bottom'
                ? '-6px'
                : currentMark.position === 'top'
                  ? 'auto'
                  : '50%',
            bottom:
              currentMark.position === 'top'
                ? '-6px'
                : currentMark.position === 'bottom'
                  ? 'auto'
                  : 'auto',
            left:
              currentMark.position === 'right'
                ? '-6px'
                : currentMark.position === 'left'
                  ? 'auto'
                  : '50%',
            right:
              currentMark.position === 'left'
                ? '-6px'
                : currentMark.position === 'right'
                  ? 'auto'
                  : 'auto',
            transform:
              currentMark.position === 'top' ||
              currentMark.position === 'bottom'
                ? 'translateX(-50%) rotate(45deg)'
                : 'translateY(-50%) rotate(45deg)',
          }}
        />
      </div>
    </>
  );
}
