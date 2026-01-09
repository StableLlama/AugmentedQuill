import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Trash2,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Bug,
  Layers,
  List,
} from 'lucide-react';
import { AppTheme } from '../types';
import { api } from '../services/api';

interface DebugLogsProps {
  isOpen: boolean;
  onClose: () => void;
  theme: AppTheme;
}

interface LogEntry {
  id: string;
  timestamp_start: string;
  timestamp_end: string | null;
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: any;
  };
  response: {
    status_code: number | null;
    body?: any;
    streaming?: boolean;
    chunks?: any[];
    full_content?: string;
    error?: any;
  } | null;
}

const JsonView: React.FC<{
  data: any;
  theme: AppTheme;
  depth?: number;
  label?: string;
}> = ({ data, theme, depth = 0, label }) => {
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (label === 'tools') return true;
    return false;
  });

  const isLight = theme === 'light';
  const textMain = isLight ? 'text-brand-gray-900' : 'text-brand-gray-100';
  const textMuted = 'text-brand-gray-500';

  const renderValue = () => {
    if (data === null) return <span className="text-blue-400">null</span>;
    if (typeof data === 'undefined')
      return <span className="text-brand-gray-600">undefined</span>;
    if (typeof data === 'string')
      return <span className="text-green-500">"{data}"</span>;
    if (typeof data === 'number')
      return <span className="text-orange-500">{data}</span>;
    if (typeof data === 'boolean')
      return <span className="text-purple-500">{data.toString()}</span>;
    return <span>{String(data)}</span>;
  };

  if (data === null || typeof data !== 'object') {
    return (
      <div className="flex items-start gap-1 py-0.5">
        {label && <span className="text-blue-400 shrink-0">{label}:</span>}
        {renderValue()}
      </div>
    );
  }

  const isArray = Array.isArray(data);
  const keys = Object.keys(data);

  if (keys.length === 0) return <span>{isArray ? '[]' : '{}'}</span>;

  return (
    <div className="pl-4 border-l border-brand-gray-500/20 my-0.5">
      <div
        className="flex items-center gap-1 cursor-pointer hover:bg-brand-gray-500/5 -ml-4 px-1 rounded"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        {label && <span className="text-blue-400 mr-1">{label}:</span>}
        <span className={textMuted}>
          {isArray ? `Array(${keys.length})` : 'Object'}
        </span>
      </div>
      {!isCollapsed && (
        <div className="space-y-0.5 mt-0.5">
          {keys.map((key) => (
            <div key={key} className="flex flex-col">
              <JsonView
                data={data[key]}
                theme={theme}
                depth={depth + 1}
                label={isArray ? undefined : key}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const DebugLogs: React.FC<DebugLogsProps> = ({ isOpen, onClose, theme }) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [expandedLogs, setExpandedLogs] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [streamMode, setStreamMode] = useState<'chunks' | 'aggregated'>('aggregated');
  const scrollRef = useRef<HTMLDivElement>(null);

  const isLight = theme === 'light';
  const bgMain = isLight ? 'bg-white' : 'bg-brand-gray-950';
  const textMain = isLight ? 'text-brand-gray-900' : 'text-brand-gray-100';
  const borderMain = isLight ? 'border-brand-gray-200' : 'border-brand-gray-800';
  const bgSecondary = isLight ? 'bg-brand-gray-50' : 'bg-brand-gray-900';

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  };

  const fetchLogs = async () => {
    setIsLoading(true);
    try {
      const data = await api.debug.getLogs();
      setLogs(data); // Show newest at bottom
    } catch (error) {
      console.error('Failed to fetch debug logs:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const clearLogs = async () => {
    if (!confirm('Are you sure you want to clear all logs?')) return;
    try {
      await api.debug.clearLogs();
      setLogs([]);
    } catch (error) {
      console.error('Failed to clear debug logs:', error);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchLogs();
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && logs.length > 0) {
      // Small delay to ensure content is rendered
      const timeoutId = setTimeout(scrollToBottom, 50);
      return () => clearTimeout(timeoutId);
    }
  }, [isOpen, logs.length]);

  const toggleExpand = (id: string) => {
    setExpandedLogs((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-black/50 backdrop-blur-sm p-4 md:p-8">
      <div
        className={`flex-1 flex flex-col rounded-xl shadow-2xl overflow-hidden border ${borderMain} ${bgMain}`}
      >
        {/* Header */}
        <div
          className={`flex items-center justify-between px-6 py-4 border-b ${borderMain} ${bgSecondary}`}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <Bug className="text-blue-500" size={20} />
            </div>
            <div>
              <h2 className={`text-lg font-bold ${textMain}`}>
                LLM Communication Logs
              </h2>
              <p className="text-xs text-brand-gray-500">
                Debug view for all LLM requests and responses
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div
              className={`flex items-center rounded-lg border ${borderMain} overflow-hidden mr-2`}
            >
              <button
                onClick={() => setStreamMode('aggregated')}
                className={`px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors ${
                  streamMode === 'aggregated'
                    ? 'bg-blue-500 text-white'
                    : `${bgSecondary} ${textMain} hover:bg-brand-gray-500/10`
                }`}
                title="Aggregated View"
              >
                <Layers size={14} /> Aggregated
              </button>
              <button
                onClick={() => setStreamMode('chunks')}
                className={`px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors ${
                  streamMode === 'chunks'
                    ? 'bg-blue-500 text-white'
                    : `${bgSecondary} ${textMain} hover:bg-brand-gray-500/10`
                }`}
                title="Chunks View"
              >
                <List size={14} /> Chunks
              </button>
            </div>
            <button
              onClick={fetchLogs}
              disabled={isLoading}
              className={`p-2 rounded-lg hover:bg-brand-gray-500/10 transition-colors ${
                isLoading ? 'animate-spin' : ''
              }`}
              title="Refresh Logs"
            >
              <RefreshCw size={18} className="text-brand-gray-500" />
            </button>
            <button
              onClick={clearLogs}
              className="p-2 rounded-lg hover:bg-red-500/10 transition-colors group"
              title="Clear Logs"
            >
              <Trash2
                size={18}
                className="text-brand-gray-500 group-hover:text-red-500"
              />
            </button>
            <div className={`w-px h-6 mx-2 ${borderMain}`} />
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-brand-gray-500/10 transition-colors"
              title="Close"
            >
              <X size={20} className="text-brand-gray-500" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-4">
          {logs.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-brand-gray-500 space-y-4">
              <Bug size={48} className="opacity-20" />
              <p>No LLM communications logged yet.</p>
            </div>
          ) : (
            logs.map((log) => (
              <div
                key={log.id}
                className={`border rounded-lg overflow-hidden ${borderMain} ${
                  expandedLogs[log.id] ? 'ring-1 ring-blue-500/30' : ''
                }`}
              >
                <div
                  className={`flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-brand-gray-500/5 transition-colors ${
                    expandedLogs[log.id] ? bgSecondary : ''
                  }`}
                  onClick={() => toggleExpand(log.id)}
                >
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    {expandedLogs[log.id] ? (
                      <ChevronDown size={16} />
                    ) : (
                      <ChevronRight size={16} />
                    )}
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-xs font-mono px-1.5 py-0.5 rounded ${
                            log.request.method === 'POST'
                              ? 'bg-green-500/10 text-green-500'
                              : 'bg-blue-500/10 text-blue-500'
                          }`}
                        >
                          {log.request.method}
                        </span>
                        <span className={`text-sm font-medium truncate ${textMain}`}>
                          {log.request.url.split('/').pop()}
                        </span>
                        {log.response?.status_code && (
                          <span
                            className={`text-xs font-mono px-1.5 py-0.5 rounded ${
                              log.response.status_code >= 200 &&
                              log.response.status_code < 300
                                ? 'bg-green-500/10 text-green-500'
                                : 'bg-red-500/10 text-red-500'
                            }`}
                          >
                            {log.response.status_code}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-[10px] text-brand-gray-500 font-mono">
                          Start: {new Date(log.timestamp_start).toLocaleTimeString()}
                        </span>
                        {log.timestamp_end && (
                          <span className="text-[10px] text-brand-gray-500 font-mono">
                            End: {new Date(log.timestamp_end).toLocaleTimeString()}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {expandedLogs[log.id] && (
                  <div
                    className={`p-4 border-t ${borderMain} space-y-4 font-mono text-xs`}
                  >
                    <div className="space-y-2">
                      <h4 className="text-brand-gray-500 uppercase tracking-wider text-[10px] font-bold">
                        Request
                      </h4>
                      <div
                        className={`p-3 rounded-lg overflow-x-auto ${
                          isLight ? 'bg-brand-gray-100' : 'bg-brand-gray-900'
                        }`}
                      >
                        <JsonView data={log.request} theme={theme} />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <h4 className="text-brand-gray-500 uppercase tracking-wider text-[10px] font-bold">
                        Response
                      </h4>
                      <div
                        className={`p-3 rounded-lg overflow-x-auto ${
                          isLight ? 'bg-brand-gray-100' : 'bg-brand-gray-900'
                        }`}
                      >
                        {log.response?.streaming && streamMode === 'aggregated' ? (
                          <div className="space-y-4">
                            <div className="space-y-1">
                              <span className="text-blue-400">status_code:</span>{' '}
                              {log.response.status_code}
                            </div>
                            {log.response.error && (
                              <div className="space-y-1">
                                <span className="text-red-400">error:</span>
                                <div
                                  className={
                                    'mt-1 p-2 rounded border border-red-500/30 bg-red-500/5 text-red-500 whitespace-pre-wrap font-sans text-sm'
                                  }
                                >
                                  {typeof log.response.error === 'string'
                                    ? log.response.error
                                    : JSON.stringify(log.response.error, null, 2)}
                                </div>
                              </div>
                            )}
                            <div className="space-y-1">
                              <span className="text-blue-400">full_content:</span>
                              <div
                                className={`mt-1 p-2 rounded border ${borderMain} whitespace-pre-wrap font-sans text-sm`}
                              >
                                {log.response.full_content}
                              </div>
                            </div>
                            {(log.response as any).tool_calls && (
                              <div className="space-y-1">
                                <span className="text-blue-400">tool_calls:</span>
                                <div className="mt-1">
                                  <JsonView
                                    data={(log.response as any).tool_calls}
                                    theme={theme}
                                  />
                                </div>
                              </div>
                            )}
                            <div className="space-y-1">
                              <span className="text-blue-400">metadata:</span>
                              <JsonView
                                data={{
                                  chunks_count: log.response.chunks?.length,
                                  streaming: true,
                                }}
                                theme={theme}
                              />
                            </div>
                          </div>
                        ) : (
                          <JsonView data={log.response} theme={theme} />
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
