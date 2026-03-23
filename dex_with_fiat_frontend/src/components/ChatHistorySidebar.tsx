'use client';

import { useState,useEffect  } from 'react';
import { useChatHistory } from '@/hooks/useChatHistory';
import { useTheme } from '@/contexts/ThemeContext';
import {
    MessageSquare,
    Trash2,
    Search,
    X,
    Clock,
    Plus,
    Download
} from 'lucide-react';
import SkeletonSidebar from "@/components/ui/skeleton/SkeletonSidebar";

interface ChatHistorySidebarProps {
    onLoadSession: (sessionId: string) => void;
}

export default function ChatHistorySidebar({ onLoadSession }: ChatHistorySidebarProps) {
    const {
        sessions,
        currentSessionId,
        deleteSession,
        clearAllHistory,
        exportSession,
        searchSessions,
        hasHistory
    } = useChatHistory();

    const { isDarkMode } = useTheme();
    const [searchQuery, setSearchQuery] = useState('');
    const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 800);
    return () => clearTimeout(timer);
    }, []);

    const filteredSessions = searchQuery
        ? searchSessions(searchQuery)
        : sessions;

    const handleDeleteSession = (sessionId: string) => {
        deleteSession(sessionId);
        setShowDeleteConfirm(null);
    };

    const handleExportSession = (sessionId: string) => {
        const exportData = exportSession(sessionId);
        if (exportData) {
            const blob = new Blob([exportData], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `chat-session-${sessionId}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }
    };

    const formatDate = (date: Date) => {
        const now = new Date();
        const diffTime = now.getTime() - date.getTime();
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays === 0) {
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else if (diffDays === 1) {
            return 'Yesterday';
        } else if (diffDays < 7) {
            return `${diffDays} days ago`;
        } else {
            return date.toLocaleDateString();
        }
    };

    return (
        <div className={`h-full flex flex-col transition-colors duration-300 ${isDarkMode ? 'bg-gray-800' : 'bg-white'
            }`}>
            {/* Header */}
            <div className={`p-4 border-b transition-colors duration-300 ${isDarkMode ? 'border-gray-700' : 'border-gray-200'
                }`}>
                <div className="flex items-center justify-between mb-4">
                    <h2 className={`text-lg font-semibold transition-colors duration-300 ${isDarkMode ? 'text-gray-100' : 'text-gray-900'
                        }`}>Chat History</h2>
                    <button
                        onClick={clearAllHistory}
                        className={`p-2 rounded-lg transition-all duration-200 hover:scale-110 ${isDarkMode
                                ? 'text-gray-400 hover:text-red-400 hover:bg-red-900/20'
                                : 'text-gray-500 hover:text-red-600 hover:bg-red-50'
                            }`}
                        title="Clear all history"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>

                {/* Search */}
                <div className="relative">
                    <Search className={`absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 ${isDarkMode ? 'text-gray-400' : 'text-gray-400'
                        }`} />
                    <input
                        type="text"
                        placeholder="Search conversations..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className={`w-full pl-10 pr-4 py-2 rounded-lg text-sm transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 ${isDarkMode
                                ? 'bg-gray-700 border border-gray-600 text-gray-100 placeholder-gray-400 focus:border-blue-500'
                                : 'bg-gray-50 border border-gray-200 text-gray-900 placeholder-gray-500 focus:border-blue-500'
                            }`}
                    />
                    {searchQuery && (
                        <button
                            onClick={() => setSearchQuery('')}
                            className={`absolute right-3 top-1/2 transform -translate-y-1/2 transition-colors ${isDarkMode ? 'text-gray-400 hover:text-gray-200' : 'text-gray-400 hover:text-gray-600'
                                }`}
                        >
                            <X className="w-4 h-4" />
                        </button>
                    )}
                </div>
            </div>

            {/* Sessions List */}
            <div className="flex-1 overflow-y-auto">
                {isLoading ? (
    <SkeletonSidebar />
) : !hasHistory ? (
    <div className={`p-4 text-center ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
        <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No conversations yet</p>
        <p className="text-xs mt-1 opacity-70">
            Start chatting to see your history here
        </p>
    </div>
) : filteredSessions.length === 0 ? (
    <div className={`p-4 text-center ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
        <Search className="w-6 h-6 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No conversations found</p>
    </div>
) : (
                    <div className="p-2">
                        {filteredSessions.map((session) => (
                            <div
                                key={session.id}
                                className={`group relative p-3 mb-2 rounded-lg cursor-pointer transition-all duration-200 ${currentSessionId === session.id
                                        ? isDarkMode
                                            ? 'bg-blue-900/30 border border-blue-500/50 shadow-lg'
                                            : 'bg-blue-50 border border-blue-200 shadow-md'
                                        : isDarkMode
                                            ? 'hover:bg-gray-700/50 border border-transparent hover:border-gray-600/30'
                                            : 'hover:bg-gray-50 border border-transparent hover:border-gray-200'
                                    }`}
                                onClick={() => onLoadSession(session.id)}
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex-1 min-w-0">
                                        <h3 className={`text-sm font-medium truncate transition-colors duration-200 ${isDarkMode ? 'text-gray-100' : 'text-gray-900'
                                            }`}>
                                            {session.title || 'New Conversation'}
                                        </h3>
                                        <div className={`flex items-center mt-1 text-xs transition-colors duration-200 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'
                                            }`}>
                                            <Clock className="w-3 h-3 mr-1" />
                                            <span>{formatDate(session.lastUpdated || session.createdAt || new Date())}</span>
                                            <span className="ml-2">
                                                {session.messages?.length || 0} messages
                                            </span>
                                        </div>
                                        {session.messages && session.messages.length > 0 && (
                                            <p className={`text-xs mt-1 truncate transition-colors duration-200 ${isDarkMode ? 'text-gray-500' : 'text-gray-600'
                                                }`}>
                                                {session.messages[session.messages.length - 1]?.content?.substring(0, 50)}...
                                            </p>
                                        )}
                                    </div>

                                    <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleExportSession(session.id);
                                            }}
                                            className={`p-1 rounded transition-all hover:scale-110 ${isDarkMode
                                                    ? 'text-gray-400 hover:text-blue-400 hover:bg-blue-900/20'
                                                    : 'text-gray-400 hover:text-blue-600 hover:bg-blue-50'
                                                }`}
                                            title="Export conversation"
                                        >
                                            <Download className="w-3 h-3" />
                                        </button>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setShowDeleteConfirm(session.id);
                                            }}
                                            className={`p-1 rounded transition-all hover:scale-110 ${isDarkMode
                                                    ? 'text-gray-400 hover:text-red-400 hover:bg-red-900/20'
                                                    : 'text-gray-400 hover:text-red-600 hover:bg-red-50'
                                                }`}
                                            title="Delete conversation"
                                        >
                                            <Trash2 className="w-3 h-3" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* New Chat Button */}
            <div className={`p-4 border-t transition-colors duration-300 ${isDarkMode ? 'border-gray-700' : 'border-gray-200'
                }`}>
                <button
                    onClick={() => window.location.reload()}
                    className={`w-full flex items-center justify-center px-4 py-3 rounded-lg transition-all duration-200 font-medium hover:scale-[1.02] ${isDarkMode
                            ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg hover:shadow-blue-500/25'
                            : 'bg-blue-600 hover:bg-blue-700 text-white shadow-md hover:shadow-lg'
                        }`}
                >
                    <Plus className="w-4 h-4 mr-2" />
                    New Conversation
                </button>
            </div>

            {/* Delete Confirmation Modal */}
            {showDeleteConfirm && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 backdrop-blur-sm">
                    <div className={`rounded-lg p-6 max-w-sm mx-4 shadow-2xl transition-colors duration-300 ${isDarkMode ? 'bg-gray-800 border border-gray-700' : 'bg-white'
                        }`}>
                        <h3 className={`text-lg font-semibold mb-2 transition-colors duration-300 ${isDarkMode ? 'text-gray-100' : 'text-gray-900'
                            }`}>
                            Delete Conversation
                        </h3>
                        <p className={`mb-4 transition-colors duration-300 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'
                            }`}>
                            Are you sure you want to delete this conversation? This action cannot be undone.
                        </p>
                        <div className="flex space-x-3">
                            <button
                                onClick={() => setShowDeleteConfirm(null)}
                                className={`flex-1 px-4 py-2 rounded-lg transition-all duration-200 font-medium ${isDarkMode
                                        ? 'text-gray-300 bg-gray-700 hover:bg-gray-600 border border-gray-600'
                                        : 'text-gray-700 bg-gray-100 hover:bg-gray-200'
                                    }`}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => handleDeleteSession(showDeleteConfirm)}
                                className="flex-1 px-4 py-2 text-white bg-red-600 hover:bg-red-700 rounded-lg transition-all duration-200 font-medium"
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
