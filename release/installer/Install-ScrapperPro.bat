@echo off
setlocal EnableExtensions
title Scrapper Pro Installer

set "INSTALL_DIR=%LOCALAPPDATA%\ScrapperPro\extension"
set "SRC=%~dp0extension"

echo.
echo  ========================================
echo   Scrapper Pro - Extension Installer
echo  ========================================
echo.

if not exist "%SRC%\manifest.json" (
  echo ERROR: extension files not found next to this installer.
  echo Make sure you unzipped the full folder.
  pause
  exit /b 1
)

echo Installing to:
echo   %INSTALL_DIR%
echo.

if exist "%INSTALL_DIR%" rd /s /q "%INSTALL_DIR%"
mkdir "%INSTALL_DIR%" 2>nul
xcopy /E /I /Y "%SRC%\*" "%INSTALL_DIR%\" >nul

echo Done.
echo.
echo  ONE-TIME setup in Chrome (only once per laptop):
echo  1. Chrome will open chrome://extensions
echo  2. Turn ON "Developer mode" (top right)
echo  3. Click "Load unpacked"
echo  4. Paste this path and press Enter:
echo.
echo     %INSTALL_DIR%
echo.
echo  After that, Scrapper Pro stays installed.
echo  You do NOT select the folder again.
echo.
echo  Default API is already set to Render.
echo.

echo %INSTALL_DIR%| clip
echo (Install path copied to clipboard)
echo.

start "" chrome "chrome://extensions"

echo Opening install folder...
explorer "%INSTALL_DIR%"

echo.
pause
