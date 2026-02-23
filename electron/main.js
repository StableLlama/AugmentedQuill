// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the main unit so this responsibility stays isolated, testable, and easy to evolve.
 */

const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

let mainWindow;
let backendProcess;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    icon: path.join(__dirname, '../static/images/logo_2048.png'),
  });

  // Wait for the backend to be ready before loading the URL
  const checkBackend = setInterval(() => {
    http
      .get('http://127.0.0.1:8000', (res) => {
        if (res.statusCode === 200) {
          clearInterval(checkBackend);
          mainWindow.loadURL('http://127.0.0.1:8000');
        }
      })
      .on('error', () => {
        // Backend not ready yet
      });
  }, 500);

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

function startBackend() {
  const isWin = process.platform === 'win32';
  const executableName = isWin ? 'run_app.exe' : 'run_app';

  // In production, the backend is bundled in resources/backend
  // In development, we assume it's built in ../dist/run_app
  const backendPath = app.isPackaged
    ? path.join(process.resourcesPath, 'backend', executableName)
    : path.join(__dirname, '..', 'dist', 'run_app', executableName);

  backendProcess = spawn(backendPath, ['--no-chdir', '--no-browser'], {
    cwd: app.getPath('userData'), // Run in user data dir so data/ is saved there
  });

  backendProcess.stdout.on('data', (data) => {
    console.log(`Backend: ${data}`);
  });

  backendProcess.stderr.on('data', (data) => {
    console.error(`Backend Error: ${data}`);
  });
}

app.on('ready', () => {
  startBackend();
  createWindow();
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', function () {
  if (mainWindow === null) {
    createWindow();
  }
});

app.on('will-quit', () => {
  if (backendProcess) {
    backendProcess.kill();
  }
});
