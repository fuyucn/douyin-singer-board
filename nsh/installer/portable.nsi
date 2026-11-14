; Single-file portable launcher. First run extracts the NSH app to
; %LOCALAPPDATA%\Programs\SUSUSongBoard and starts it; later runs launch the
; extracted app directly. The registry build marker survives nsh/updater
; replacing the app directory, so an updated app is never overwritten by an
; older launcher.
Unicode true
!include "LogicLib.nsh"

!define APP_NAME "SUSUSongBoard"
!define APP_VERSION "0.43.4"
!define APP_BUILD "818"
!define APP_EXE "SUSUSongBoard.exe"

!ifdef RUNTIME_TEST_ID
!define INSTALL_NAME "${APP_NAME}-RuntimeTest-${RUNTIME_TEST_ID}"
!else
!define INSTALL_NAME "${APP_NAME}"
!endif

Name "${APP_NAME} Portable"
OutFile "..\dist\${APP_NAME}-Portable-${APP_VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\${INSTALL_NAME}"
RequestExecutionLevel user
SilentInstall silent
SetCompressor /SOLID lzma
Icon "..\assets\icon.ico"

VIProductVersion "0.43.4.818"
VIAddVersionKey "ProductName" "${APP_NAME}"
VIAddVersionKey "FileDescription" "${APP_NAME} portable launcher"
VIAddVersionKey "FileVersion" "${APP_VERSION}"
VIAddVersionKey "ProductVersion" "${APP_VERSION}"

Section "Run"
  ReadRegStr $1 HKCU "Software\${INSTALL_NAME}" "PortableBuild"
  IfFileExists "$INSTDIR\${APP_EXE}" 0 extract
  StrCmp $1 "${APP_BUILD}" run
  IntCmp $1 ${APP_BUILD} run extract run
extract:
  SetOutPath "$INSTDIR"
  File /r "..\dist\${APP_NAME}\*.*"
  WriteRegStr HKCU "Software\${INSTALL_NAME}" "PortableBuild" "${APP_BUILD}"
run:
  Exec "$INSTDIR\${APP_EXE}"
SectionEnd
