Unicode true
!include "LogicLib.nsh"

!define APP_NAME "NSHInputSmoke"
!define APP_VERSION "1.0.0"
!define APP_BUILD "1"
!define APP_EXE "NSHInputSmoke.exe"
!define INSTALL_NAME "NSHInputSmoke-${RUNTIME_TEST_ID}"

Name "NSH Windows Input Test"
OutFile "..\dist\NSH-Windows-Input-Test.exe"
InstallDir "$LOCALAPPDATA\Programs\${INSTALL_NAME}"
RequestExecutionLevel user
SilentInstall silent
SetCompressor /SOLID lzma

VIProductVersion "1.0.0.1"
VIAddVersionKey "ProductName" "NSH Windows Input Test"
VIAddVersionKey "FileDescription" "NSH Windows Input Test"
VIAddVersionKey "FileVersion" "${APP_VERSION}"
VIAddVersionKey "ProductVersion" "${APP_VERSION}"

Section "Run"
  SetOutPath "$INSTDIR"
  File /r "..\dist\NSHInputSmoke\*.*"
  Exec "$INSTDIR\${APP_EXE}"
SectionEnd
