'use client';

import { useRef, useState } from 'react';
import { X, Check, Plus, Trash2, Edit2 } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import {
  SUPPORTED_FIAT_CURRENCIES,
  FiatCurrencyCode,
  useUserPreferences,
} from '@/contexts/UserPreferencesContext';
import {
  useFeatureFlag,
  featureFlagSectionDividerBorderClass,
} from '@/hooks/useFeatureFlag';
import { useAccessibleModal } from '@/hooks/useAccessibleModal';
import { useChatTelemetry } from '@/hooks/useChatTelemetry';
import { useBeneficiaries, Beneficiary } from '@/hooks/useBeneficiaries';

interface UserSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function UserSettings({ isOpen, onClose }: UserSettingsProps) {
  const { isDarkMode } = useTheme();
  const enableConversionReminders = useFeatureFlag('enableConversionReminders');
  const {
    fiatCurrency,
    setFiatCurrency,
    remindersEnabled,
    setRemindersEnabled,
    reminderFrequency,
    setReminderFrequency,
  } = useUserPreferences();
  const { consented: telemetryConsented, setConsent: setTelemetryConsent } = useChatTelemetry();
  const { beneficiaries, isLoaded, addBeneficiary, deleteBeneficiary, renameBeneficiary } = useBeneficiaries();
  const panelRef = useRef<HTMLDivElement>(null);
  
  // Beneficiary management states
  const [showAddBeneficiary, setShowAddBeneficiary] = useState(false);
  const [editingBeneficiary, setEditingBeneficiary] = useState<Beneficiary | null>(null);
  const [newBeneficiaryName, setNewBeneficiaryName] = useState('');
  const [newBeneficiaryAddress, setNewBeneficiaryAddress] = useState('');
  
  useAccessibleModal(isOpen, panelRef, onClose);

  if (!isOpen) return null;

  const handleSelect = (code: FiatCurrencyCode) => {
    setFiatCurrency(code);
    onClose();
  };

  const handleAddBeneficiary = () => {
    if (newBeneficiaryName.trim() && newBeneficiaryAddress.trim()) {
      if (editingBeneficiary) {
        renameBeneficiary(editingBeneficiary.id, newBeneficiaryName);
        setEditingBeneficiary(null);
      } else {
        addBeneficiary(0, 'Unknown Bank', '000', newBeneficiaryAddress, newBeneficiaryAddress, newBeneficiaryName);
      }
      setNewBeneficiaryName('');
      setNewBeneficiaryAddress('');
      setShowAddBeneficiary(false);
    }
  };

  const handleEditBeneficiary = (beneficiary: Beneficiary) => {
    setEditingBeneficiary(beneficiary);
    setNewBeneficiaryName(beneficiary.name);
    setNewBeneficiaryAddress(beneficiary.accountName);
    setShowAddBeneficiary(true);
  };

  const handleDeleteBeneficiary = (id: string) => {
    deleteBeneficiary(id);
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="User settings"
        tabIndex={-1}
        className={`fixed inset-y-0 right-0 z-50 w-80 flex flex-col shadow-2xl focus:outline-none transition-colors duration-300 ${
          isDarkMode
            ? 'bg-gray-900 border-l border-gray-700'
            : 'bg-white border-l border-gray-200'
        }`}
      >
        {/* Header */}
        <div
          className={`flex items-center justify-between px-5 py-4 border-b ${
            isDarkMode ? 'border-gray-700' : 'border-gray-200'
          }`}
        >
          <h2
            className={`text-base font-semibold ${
              isDarkMode ? 'text-gray-100' : 'text-gray-900'
            }`}
          >
            Settings
          </h2>
          <button
            onClick={onClose}
            aria-label="Close settings"
            className={`p-1.5 rounded-lg transition-colors ${
              isDarkMode
                ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-6 space-y-6">
          {/* Beneficiaries section */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3
                className={`text-xs font-semibold uppercase tracking-wider ${
                  isDarkMode ? 'text-gray-400' : 'text-gray-500'
                }`}
              >
                Saved Beneficiaries
              </h3>
              <button
                onClick={() => {
                  setEditingBeneficiary(null);
                  setNewBeneficiaryName('');
                  setNewBeneficiaryAddress('');
                  setShowAddBeneficiary(!showAddBeneficiary);
                }}
                className={`p-1.5 rounded-lg transition-colors ${
                  isDarkMode
                    ? 'text-blue-400 hover:bg-blue-900/20'
                    : 'text-blue-600 hover:bg-blue-100'
                }`}
                aria-label="Add new beneficiary"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
            <p
              className={`text-xs mb-4 ${
                isDarkMode ? 'text-gray-500' : 'text-gray-400'
              }`}
            >
              Manage saved bank accounts for quick access during transfers.
            </p>

            {showAddBeneficiary && (
              <div className={`p-3 rounded-lg mb-3 border ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
                <div className="space-y-3">
                  <div>
                    <label
                      className={`text-xs font-medium block mb-1 ${
                        isDarkMode ? 'text-gray-300' : 'text-gray-600'
                      }`}
                    >
                      Name
                    </label>
                    <input
                      type="text"
                      placeholder="e.g., My Primary Account"
                      value={newBeneficiaryName}
                      onChange={(e) => setNewBeneficiaryName(e.target.value)}
                      aria-label="Beneficiary name"
                      className={`w-full px-3 py-2 rounded-lg text-sm border transition-colors ${
                        isDarkMode
                          ? 'bg-gray-700 border-gray-600 text-white focus:border-blue-500'
                          : 'bg-white border-gray-300 text-gray-900 focus:border-blue-500'
                      }`}
                    />
                  </div>
                  <div>
                    <label
                      className={`text-xs font-medium block mb-1 ${
                        isDarkMode ? 'text-gray-300' : 'text-gray-600'
                      }`}
                    >
                      Account Address / IBAN / Number
                    </label>
                    <input
                      type="text"
                      placeholder="e.g., Account number or IBAN"
                      value={newBeneficiaryAddress}
                      onChange={(e) => setNewBeneficiaryAddress(e.target.value)}
                      aria-label="Beneficiary account address"
                      className={`w-full px-3 py-2 rounded-lg text-sm border transition-colors ${
                        isDarkMode
                          ? 'bg-gray-700 border-gray-600 text-white focus:border-blue-500'
                          : 'bg-white border-gray-300 text-gray-900 focus:border-blue-500'
                      }`}
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleAddBeneficiary}
                      className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1 ${
                        isDarkMode
                          ? 'bg-blue-600 text-white hover:bg-blue-700'
                          : 'bg-blue-600 text-white hover:bg-blue-700'
                      }`}
                    >
                      <Check className="w-3 h-3" />
                      {editingBeneficiary ? 'Update' : 'Add'}
                    </button>
                    <button
                      onClick={() => {
                        setShowAddBeneficiary(false);
                        setEditingBeneficiary(null);
                        setNewBeneficiaryName('');
                        setNewBeneficiaryAddress('');
                      }}
                      className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${
                        isDarkMode
                          ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {isLoaded ? (
              beneficiaries.length === 0 ? (
                <p
                  className={`text-xs italic ${
                    isDarkMode ? 'text-gray-500' : 'text-gray-400'
                  }`}
                >
                  No saved beneficiaries yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {beneficiaries.map((beneficiary) => (
                    <div
                      key={beneficiary.id}
                      className={`p-2 rounded-lg border flex items-center justify-between group ${
                        isDarkMode
                          ? 'bg-gray-800 border-gray-700 hover:border-gray-600'
                          : 'bg-gray-50 border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className={`text-xs font-medium truncate ${isDarkMode ? 'text-gray-200' : 'text-gray-900'}`}>
                          {beneficiary.name}
                        </p>
                        <p className={`text-[10px] truncate ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                          {beneficiary.accountName}
                        </p>
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleEditBeneficiary(beneficiary)}
                          aria-label={`Edit ${beneficiary.name}`}
                          className={`p-1.5 rounded transition-colors ${
                            isDarkMode
                              ? 'text-blue-400 hover:bg-blue-900/20'
                              : 'text-blue-600 hover:bg-blue-100'
                          }`}
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => handleDeleteBeneficiary(beneficiary.id)}
                          aria-label={`Delete ${beneficiary.name}`}
                          className={`p-1.5 rounded transition-colors ${
                            isDarkMode
                              ? 'text-red-400 hover:bg-red-900/20'
                              : 'text-red-600 hover:bg-red-100'
                          }`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : (
              <p
                className={`text-xs italic ${
                  isDarkMode ? 'text-gray-500' : 'text-gray-400'
                }`}
              >
                Loading beneficiaries...
              </p>
            )}
          </section>

          {/* Currency section */}
          <section>
            <h3
              className={`text-xs font-semibold uppercase tracking-wider mb-3 ${
                isDarkMode ? 'text-gray-400' : 'text-gray-500'
              }`}
            >
              Default fiat currency
            </h3>
            <p
              className={`text-xs mb-4 ${
                isDarkMode ? 'text-gray-500' : 'text-gray-400'
              }`}
            >
              All quotes and conversion estimates will be displayed in this
              currency.
            </p>

            <ul
              role="listbox"
              aria-label="Select default fiat currency"
              className="space-y-1"
            >
              {SUPPORTED_FIAT_CURRENCIES.map(({ code, label, symbol }) => {
                const isSelected = fiatCurrency === code;
                return (
                  <li key={code}>
                    <button
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => handleSelect(code)}
                      className={`w-full flex items-center justify-between px-4 py-3 rounded-lg text-sm transition-all duration-150 ${
                        isSelected
                          ? isDarkMode
                            ? 'bg-blue-900/40 border border-blue-500/60 text-blue-300'
                            : 'bg-blue-50 border border-blue-300 text-blue-700'
                          : isDarkMode
                            ? 'border border-transparent hover:bg-gray-800 text-gray-300'
                            : 'border border-transparent hover:bg-gray-50 text-gray-700'
                      }`}
                    >
                      <span className="flex items-center gap-3">
                        <span
                          className={`w-7 text-center font-mono font-semibold text-xs ${
                            isSelected
                              ? isDarkMode
                                ? 'text-blue-300'
                                : 'text-blue-600'
                              : isDarkMode
                                ? 'text-gray-400'
                                : 'text-gray-500'
                          }`}
                        >
                          {symbol}
                        </span>
                        <span>{label}</span>
                      </span>

                      {isSelected && (
                        <Check
                          className={`w-4 h-4 shrink-0 ${
                            isDarkMode ? 'text-blue-400' : 'text-blue-600'
                          }`}
                        />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
          {/* Telemetry section */}
          <section
            className={`pt-6 border-t ${featureFlagSectionDividerBorderClass(isDarkMode)}`}
          >
            <h3
              className={`text-xs font-semibold uppercase tracking-wider mb-3 ${
                isDarkMode ? 'text-gray-400' : 'text-gray-500'
              }`}
            >
              Telemetry
            </h3>
            <p
              className={`text-xs mb-4 ${
                isDarkMode ? 'text-gray-500' : 'text-gray-400'
              }`}
            >
              Help improve the app by sending anonymous usage data
            </p>
            <div className="flex items-center justify-between">
              <span
                className={`text-sm ${
                  isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}
              >
                Enable telemetry
              </span>
              <button
                onClick={() => setTelemetryConsent(!telemetryConsented)}
                aria-pressed={telemetryConsented}
                aria-label="Telemetry consent"
                className={`relative inline-flex h-5 w-10 items-center rounded-full transition-colors focus:outline-none ${
                  telemetryConsented ? 'bg-blue-600' : 'bg-gray-700'
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    telemetryConsented ? 'translate-x-5.5' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </section>

          {enableConversionReminders && (
            <section
              className={`pt-6 border-t ${featureFlagSectionDividerBorderClass(isDarkMode)}`}
            >
              <h3
                className={`text-xs font-semibold uppercase tracking-wider mb-3 ${
                  isDarkMode ? 'text-gray-400' : 'text-gray-500'
                }`}
              >
                Conversion Reminders
              </h3>
              <p
                className={`text-xs mb-4 ${
                  isDarkMode ? 'text-gray-500' : 'text-gray-400'
                }`}
              >
                Get notified when it&apos;s time to check your XLM balance and
                consider converting to fiat.
              </p>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span
                    className={`text-sm ${
                      isDarkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}
                  >
                    Enable Reminders
                  </span>
                  <button
                    onClick={() => setRemindersEnabled(!remindersEnabled)}
                    className={`relative inline-flex h-5 w-10 items-center rounded-full transition-colors focus:outline-none ${
                      remindersEnabled ? 'bg-blue-600' : 'bg-gray-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                        remindersEnabled ? 'translate-x-5.5' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {remindersEnabled && (
                  <div className="space-y-2">
                    <label
                      className={`text-[10px] font-bold uppercase tracking-widest ${
                        isDarkMode ? 'text-gray-500' : 'text-gray-400'
                      }`}
                    >
                      Frequency
                    </label>
                    <div className="flex gap-2">
                      {(['weekly', 'monthly'] as const).map((freq) => (
                        <button
                          key={freq}
                          onClick={() => setReminderFrequency(freq)}
                          className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-all ${
                            reminderFrequency === freq
                              ? 'bg-blue-600/20 border-blue-500 text-blue-400'
                              : isDarkMode
                                ? 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
                                : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                          }`}
                        >
                          {freq.charAt(0).toUpperCase() + freq.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
