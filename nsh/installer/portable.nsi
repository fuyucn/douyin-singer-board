; Single-file portable launcher. First run extracts the NSH app to
; %LOCALAPPDATA%\Programs\SUSUSongBoard and starts it; later runs launch the
; extracted app directly. The registry build marker survives nsh/updater
; replacing the app directory, so an updated app is never overwritten by an
; older launcher.
Unicode true
!include "LogicLib.nsh"

!define APP_NAME "SUSUSongBoard"
!define APP_VERSION "0.8.3"
!define APP_BUILD "803"
!define APP_EXE "SUSUSongBoard.exe"

Name "${APP_NAME} Portable"
OutFile "..\dist\${APP_NAME}-Portable-${APP_VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\${APP_NAME}"
RequestExecutionLevel user
SilentInstall silent
SetCompressor /SOLID lzma
Icon "..\assets\icon.ico"

VIProductVersion "0.8.3.0"
VIAddVersionKey "ProductName" "${APP_NAME}"
VIAddVersionKey "FileDescription" "${APP_NAME} portable launcher"
VIAddVersionKey "FileVersion" "${APP_VERSION}"
VIAddVersionKey "ProductVersion" "${APP_VERSION}"

Section "Run"
  ReadRegStr $1 HKCU "Software\${APP_NAME}" "PortableBuild"
  IfFileExists "$INSTDIR\${APP_EXE}" 0 extract
  StrCmp $1 "${APP_BUILD}" run
  IntCmp $1 ${APP_BUILD} run extract run
extract:
  SetOutPath "$INSTDIR"
  File /r "..\dist\${APP_NAME}\*.*"
  WriteRegStr HKCU "Software\${APP_NAME}" "PortableBuild" "${APP_BUILD}"
run:
  Exec "$INSTDIR\${APP_EXE}"
SectionEnd
