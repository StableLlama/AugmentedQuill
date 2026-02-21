import { useEffect, useState } from 'react';
import { AppTheme, EditorSettings } from '../../types';

const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  fontSize: 18,
  maxWidth: 60,
  brightness: 0.95,
  contrast: 0.9,
  theme: 'mixed',
  sidebarWidth: 320,
};

export function useEditorPreferences() {
  const [editorSettings, setEditorSettings] = useState<EditorSettings>(() => {
    const saved = localStorage.getItem('augmentedquill_editor_settings');
    if (!saved) return DEFAULT_EDITOR_SETTINGS;
    try {
      return { ...DEFAULT_EDITOR_SETTINGS, ...JSON.parse(saved) };
    } catch {
      return DEFAULT_EDITOR_SETTINGS;
    }
  });

  useEffect(() => {
    localStorage.setItem(
      'augmentedquill_editor_settings',
      JSON.stringify(editorSettings)
    );
  }, [editorSettings]);

  const currentTheme: AppTheme = editorSettings.theme || 'mixed';
  const isLight = currentTheme === 'light';

  useEffect(() => {
    document.body.className = currentTheme;
  }, [currentTheme]);

  return { editorSettings, setEditorSettings, currentTheme, isLight };
}
