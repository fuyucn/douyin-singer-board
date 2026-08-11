; Remove app data left behind after uninstallation:
;   %APPDATA%\com.sususongboard.app  — SQLite database, config
;   %LOCALAPPDATA%\com.sususongboard.app — sidecar binaries
RMDir /r "$APPDATA\com.sususongboard.app"
RMDir /r "$LOCALAPPDATA\com.sususongboard.app"
