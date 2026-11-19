Unicode true
ManifestDPIAware true
!include "MUI2.nsh"
!define PRODUCT_EXECUTABLE "Find a Note.exe"
!define UNINST_KEY_NAME "Find a Note"
!include "wails_tools.nsh"

!if "${REQUEST_EXECUTION_LEVEL}" != "user"
    !error "Build this installer with wails build -nsis -installscope user"
!endif

Name "${INFO_PRODUCTNAME}"
OutFile "..\..\bin\Find-a-Note-${INFO_PRODUCTVERSION}-Windows-Setup.exe"
InstallDir "$LOCALAPPDATA\Programs\${INFO_PRODUCTNAME}"
VIProductVersion "${INFO_PRODUCTVERSION}.0"
VIFileVersion "${INFO_PRODUCTVERSION}.0"
VIAddVersionKey "ProductName" "${INFO_PRODUCTNAME}"
VIAddVersionKey "FileDescription" "${INFO_PRODUCTNAME} Setup"
VIAddVersionKey "ProductVersion" "${INFO_PRODUCTVERSION}"
VIAddVersionKey "FileVersion" "${INFO_PRODUCTVERSION}"

!define MUI_ICON "..\icon.ico"
!define MUI_UNICON "..\icon.ico"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Var UpdateStage
Function .onInit
    !insertmacro wails.checkArchitecture
    ${GetParameters} $0
    ClearErrors
    ${GetOptions} $0 "/UPDATESTAGE" $1
    IfErrors normalInstall
    StrCpy $UpdateStage "1"
    SetSilent silent
    IfFileExists "$INSTDIR\.find-a-note-stage" stageAllowed
    SetErrorLevel 2
    Abort
stageAllowed:
    Return
normalInstall:
    SetRegView 64
    ReadRegStr $0 HKCU "${UNINST_KEY}" "InstallLocation"
    ${If} $0 != ""
        StrCpy $INSTDIR $0
    ${EndIf}
FunctionEnd

Section "Find a Note"
    SectionIn RO
    ${If} $UpdateStage == "1"
        SetOutPath "$INSTDIR"
        SetOverwrite off
        ClearErrors
        !insertmacro wails.files
        IfErrors stageFailed
        SetErrorLevel 0
        Quit
stageFailed:
        SetErrorLevel 3
        Abort
    ${EndIf}
    SetShellVarContext current
    !insertmacro wails.webview2runtime
    SetOutPath "$INSTDIR"
    SetOverwrite on
    ClearErrors
    !insertmacro wails.files
    IfErrors installFailed
    CreateShortcut "$SMPROGRAMS\${INFO_PRODUCTNAME}.lnk" "$INSTDIR\${PRODUCT_EXECUTABLE}"
    !insertmacro wails.writeUninstaller
    WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
    WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
    WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
    IfErrors installFailed
    Goto installDone
installFailed:
    MessageBox MB_OK|MB_ICONSTOP "Installation failed. Close Find a Note and retry." /SD IDOK
    SetErrorLevel 1
    Abort
installDone:
SectionEnd

Section /o "Desktop shortcut"
    CreateShortcut "$DESKTOP\${INFO_PRODUCTNAME}.lnk" "$INSTDIR\${PRODUCT_EXECUTABLE}"
SectionEnd

Section "Uninstall"
    SetShellVarContext current
    ClearErrors
    Delete "$INSTDIR\${PRODUCT_EXECUTABLE}"
    IfErrors uninstallFailed
    Delete "$SMPROGRAMS\${INFO_PRODUCTNAME}.lnk"
    Delete "$DESKTOP\${INFO_PRODUCTNAME}.lnk"
    !insertmacro wails.deleteUninstaller
    RMDir "$INSTDIR"
    Goto uninstallDone
uninstallFailed:
    MessageBox MB_OK|MB_ICONSTOP "Close Find a Note and retry uninstalling." /SD IDOK
    SetErrorLevel 1
    Abort
uninstallDone:
SectionEnd
