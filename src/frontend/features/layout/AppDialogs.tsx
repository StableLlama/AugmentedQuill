// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// Purpose: Defines the app dialogs unit so this responsibility stays isolated, testable, and easy to evolve.

import React, { RefObject } from 'react';

import { CreateProjectDialog } from '../projects/CreateProjectDialog';
import { SettingsDialog } from '../settings/SettingsDialog';
import { ProjectImages } from '../projects/ProjectImages';
import { AppTheme, Story } from '../../types';
import { EditorHandle } from '../editor/Editor';

type SettingsValue = React.ComponentProps<typeof SettingsDialog>['settings'];
type PromptsValue = React.ComponentProps<typeof SettingsDialog>['defaultPrompts'];
type ProjectsValue = React.ComponentProps<typeof SettingsDialog>['projects'];

type AppDialogsProps = {
  isSettingsOpen: boolean;
  setIsSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  appSettings: SettingsValue;
  setAppSettings: React.ComponentProps<typeof SettingsDialog>['onSaveSettings'];
  projects: ProjectsValue;
  story: Story;
  handleLoadProject: React.ComponentProps<typeof SettingsDialog>['onLoadProject'];
  handleCreateProject: React.ComponentProps<typeof SettingsDialog>['onCreateProject'];
  handleImportProject: React.ComponentProps<typeof SettingsDialog>['onImportProject'];
  handleDeleteProject: React.ComponentProps<typeof SettingsDialog>['onDeleteProject'];
  handleRenameProject: React.ComponentProps<typeof SettingsDialog>['onRenameProject'];
  handleConvertProject: React.ComponentProps<typeof SettingsDialog>['onConvertProject'];
  refreshProjects: React.ComponentProps<typeof SettingsDialog>['onRefreshProjects'];
  currentTheme: AppTheme;
  prompts: PromptsValue;

  isImagesOpen: boolean;
  setIsImagesOpen: React.Dispatch<React.SetStateAction<boolean>>;
  updateStoryImageSettings: React.ComponentProps<
    typeof ProjectImages
  >['onUpdateSettings'];
  editorRef: RefObject<EditorHandle | null>;

  isCreateProjectOpen: boolean;
  setIsCreateProjectOpen: React.Dispatch<React.SetStateAction<boolean>>;
  handleCreateProjectConfirm: React.ComponentProps<
    typeof CreateProjectDialog
  >['onCreate'];
};

export const AppDialogs: React.FC<AppDialogsProps> = ({
  isSettingsOpen,
  setIsSettingsOpen,
  appSettings,
  setAppSettings,
  projects,
  story,
  handleLoadProject,
  handleCreateProject,
  handleImportProject,
  handleDeleteProject,
  handleRenameProject,
  handleConvertProject,
  refreshProjects,
  currentTheme,
  prompts,
  isImagesOpen,
  setIsImagesOpen,
  updateStoryImageSettings,
  editorRef,
  isCreateProjectOpen,
  setIsCreateProjectOpen,
  handleCreateProjectConfirm,
}) => {
  return (
    <>
      <SettingsDialog
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={appSettings}
        onSaveSettings={setAppSettings}
        projects={projects}
        activeProjectId={story.id}
        onLoadProject={handleLoadProject}
        onCreateProject={handleCreateProject}
        onImportProject={handleImportProject}
        onDeleteProject={handleDeleteProject}
        onRenameProject={handleRenameProject}
        onConvertProject={handleConvertProject}
        onRefreshProjects={refreshProjects}
        activeProjectType={story.projectType}
        activeProjectStats={{
          chapterCount: story.chapters.length,
          bookCount: story.books?.length || 0,
        }}
        theme={currentTheme}
        defaultPrompts={prompts}
      />

      <ProjectImages
        isOpen={isImagesOpen}
        onClose={() => setIsImagesOpen(false)}
        theme={currentTheme}
        settings={appSettings}
        prompts={prompts}
        imageStyle={story.image_style}
        imageAdditionalInfo={story.image_additional_info}
        onUpdateSettings={updateStoryImageSettings}
        onInsert={(filename, url, altText) => {
          if (url && editorRef.current) {
            editorRef.current.insertImage(filename, url, altText);
            setIsImagesOpen(false);
          }
        }}
      />

      <CreateProjectDialog
        isOpen={isCreateProjectOpen}
        onClose={() => setIsCreateProjectOpen(false)}
        onCreate={handleCreateProjectConfirm}
        theme={currentTheme}
      />
    </>
  );
};
