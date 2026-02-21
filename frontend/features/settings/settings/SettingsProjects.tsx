// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// Purpose: Defines the settings projects unit so this responsibility stays isolated, testable, and easy to evolve.

import React, { useRef, useState } from 'react';
import {
  Plus,
  Trash2,
  Save,
  Edit2,
  BookOpen,
  Upload,
  Download,
  FileText,
  Library,
  RefreshCw,
} from 'lucide-react';
import { AppTheme, ProjectMetadata } from '../../../types';
import { Button } from '../../../components/ui/Button';
import { api } from '../../../services/api';

interface SettingsProjectsProps {
  projects: ProjectMetadata[];
  activeProjectId: string;
  onLoadProject: (id: string) => void;
  onCreateProject: () => void;
  onDeleteProject: (id: string) => void;
  onRenameProject: (id: string, newName: string) => void;
  onConvertProject: (newType: string) => void;
  onImportProject: (file: File) => Promise<void>;
  onRefreshProjects: () => void;
  onCloseDialog: () => void;
  activeProjectType?: 'short-story' | 'novel' | 'series';
  activeProjectStats: {
    chapterCount: number;
    bookCount: number;
  };
  theme: AppTheme;
}

export const SettingsProjects: React.FC<SettingsProjectsProps> = ({
  projects,
  activeProjectId,
  onLoadProject,
  onCreateProject,
  onDeleteProject,
  onRenameProject,
  onConvertProject,
  onRefreshProjects,
  onImportProject,
  onCloseDialog,
  activeProjectType,
  activeProjectStats,
  theme,
}) => {
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [tempName, setTempName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isLight = theme === 'light';

  const canConvertTo = (target: string) => {
    if (!activeProjectType) return false;
    if (target === activeProjectType) return true;

    const rank = (t: string) => {
      if (t === 'short-story') return 0;
      if (t === 'novel') return 1;
      if (t === 'series') return 2;
      return 1;
    };

    const curr = rank(activeProjectType);
    const dest = rank(target);

    // Upscale always allowed
    if (dest > curr) return true;

    // Downscale checks
    if (activeProjectType === 'series') {
      if (activeProjectStats.bookCount > 1) return false;
      if (target === 'short-story' && activeProjectStats.chapterCount > 1) return false;
    }

    if (activeProjectType === 'novel') {
      if (target === 'short-story' && activeProjectStats.chapterCount > 1) return false;
    }

    return true;
  };

  const getProjectIcon = (type: string) => {
    switch (type) {
      case 'short-story':
        return <FileText size={16} />;
      case 'series':
        return <Library size={16} />;
      default:
        return <BookOpen size={16} />;
    }
  };

  const handleExport = async (id: string) => {
    try {
      const blob = await api.projects.export(id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${id}.zip`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      alert('Export failed');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h3
            className={`text-lg md:text-2xl font-bold mb-1 ${
              isLight ? 'text-brand-gray-800' : 'text-brand-gray-300'
            }`}
          >
            Your Projects
          </h3>
          <p
            className={`text-sm ${
              isLight ? 'text-brand-gray-500' : 'text-brand-gray-500'
            }`}
          >
            Manage your stories and creative works.
          </p>
        </div>
        <div className="flex gap-2">
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept=".zip"
            onChange={(e) => {
              if (e.target.files?.[0]) onImportProject(e.target.files[0]);
              if (fileInputRef.current) fileInputRef.current.value = '';
            }}
          />
          <Button
            theme={theme}
            onClick={(e) => {
              e.currentTarget.blur();
              onRefreshProjects();
            }}
            variant="secondary"
            icon={<RefreshCw size={16} />}
            title="Refresh Projects"
          />
          <Button
            theme={theme}
            onClick={() => fileInputRef.current?.click()}
            variant="secondary"
            icon={<Upload size={16} />}
            title="Import Project (ZIP)"
          >
            Import
          </Button>
          <Button theme={theme} onClick={onCreateProject} icon={<Plus size={16} />}>
            New Project
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3">
        {projects.map((proj) => (
          <div
            key={proj.id}
            className={`group flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-lg border transition-all gap-3 ${
              proj.id === activeProjectId
                ? 'bg-brand-50 border-brand-500/50'
                : isLight
                  ? 'bg-brand-gray-50 border-brand-gray-200 hover:border-brand-gray-300'
                  : 'bg-brand-gray-800 border-brand-gray-700 hover:border-brand-gray-600'
            }`}
          >
            <div className="flex items-center space-x-4">
              <div
                className={`hidden sm:block w-2 h-12 rounded-full ${
                  proj.id === activeProjectId
                    ? 'bg-brand-500'
                    : isLight
                      ? 'bg-brand-gray-300'
                      : 'bg-brand-gray-600'
                }`}
              ></div>
              <div className="flex-1">
                {editingNameId === proj.id ? (
                  <div className="flex items-center space-x-2">
                    <input
                      value={tempName}
                      onChange={(e) => setTempName(e.target.value)}
                      className={`border rounded px-2 py-1 text-sm focus:outline-none focus:border-brand-500 w-full ${
                        isLight
                          ? 'bg-brand-gray-50 border-brand-gray-300 text-brand-gray-800'
                          : 'bg-brand-gray-950 border-brand-gray-600 text-brand-gray-300'
                      }`}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          onRenameProject(proj.id, tempName);
                          setEditingNameId(null);
                        }
                      }}
                    />
                    <button
                      onClick={() => {
                        onRenameProject(proj.id, tempName);
                        setEditingNameId(null);
                      }}
                      className="text-brand-600 hover:text-brand-700"
                    >
                      <Save size={16} />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    <div
                      className={`mt-1 opacity-50 ${
                        isLight ? 'text-brand-gray-500' : 'text-brand-gray-400'
                      }`}
                    >
                      {getProjectIcon(proj.type)}
                    </div>
                    <div>
                      <div className="flex items-center space-x-2 group/title">
                        <h4
                          className={`font-bold ${
                            isLight ? 'text-brand-gray-800' : 'text-brand-gray-300'
                          }`}
                        >
                          {proj.title}
                        </h4>
                        <button
                          onClick={() => {
                            setEditingNameId(proj.id);
                            setTempName(proj.title);
                          }}
                          className={`opacity-0 group-hover/title:opacity-100 transition-opacity ${
                            isLight
                              ? 'text-brand-gray-500 hover:text-brand-gray-700'
                              : 'text-brand-gray-500 hover:text-brand-gray-300'
                          }`}
                        >
                          <Edit2 size={12} />
                        </button>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-brand-gray-500 mt-0.5">
                        <span className="capitalize">{proj.type} Project</span>
                        <span>•</span>
                        <span>
                          Last edited: {new Date(proj.updatedAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center space-x-3 justify-end">
              <button
                className={`p-2 rounded transition-colors ${
                  isLight
                    ? 'text-brand-gray-400 hover:text-brand-600 hover:bg-brand-gray-100'
                    : 'text-brand-gray-500 hover:text-brand-400 hover:bg-brand-gray-800'
                }`}
                onClick={() => handleExport(proj.id)}
                title="Export Project (ZIP)"
              >
                <Download size={18} />
              </button>
              {proj.id !== activeProjectId && (
                <Button
                  theme={theme}
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    onLoadProject(proj.id);
                    onCloseDialog();
                  }}
                >
                  Open
                </Button>
              )}
              {proj.id === activeProjectId && (
                <div className="flex flex-col items-end gap-2">
                  <span className="text-xs font-medium text-brand-700 bg-brand-100 px-2 py-1 rounded">
                    Active
                  </span>
                  {activeProjectType && (
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs ${
                          isLight ? 'text-brand-gray-500' : 'text-brand-gray-400'
                        }`}
                      >
                        Type:
                      </span>
                      <select
                        className={`text-xs p-1 rounded border ${
                          isLight
                            ? 'bg-white border-brand-gray-300'
                            : 'bg-brand-gray-950 border-brand-gray-700'
                        }`}
                        value={activeProjectType}
                        onChange={(e) => {
                          onConvertProject(e.target.value);
                        }}
                      >
                        <option
                          value="short-story"
                          disabled={!canConvertTo('short-story')}
                        >
                          Short Story{' '}
                          {!canConvertTo('short-story') ? '(Too many items)' : ''}
                        </option>
                        <option value="novel" disabled={!canConvertTo('novel')}>
                          Novel {!canConvertTo('novel') ? '(Too many items)' : ''}
                        </option>
                        <option value="series" disabled={!canConvertTo('series')}>
                          Series
                        </option>
                      </select>
                    </div>
                  )}
                </div>
              )}
              <button
                onClick={() => {
                  if (
                    window.confirm(
                      `Are you sure you want to delete "${proj.title}"? This action cannot be undone.`
                    )
                  ) {
                    onDeleteProject(proj.id);
                  }
                }}
                className={`p-2 rounded transition-colors ${
                  isLight
                    ? 'text-brand-gray-600 hover:text-red-600 hover:bg-red-50'
                    : 'text-brand-gray-500 hover:text-red-400 hover:bg-red-950/30'
                }`}
                title="Delete"
              >
                <Trash2 size={18} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
