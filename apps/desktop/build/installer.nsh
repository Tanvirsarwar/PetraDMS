; Extra NSIS steps for the PetraDMS installer (included by electron-builder).
;
; PetraDMS keeps the shop's business data (database, backups, invoices, exports) in
;   %LOCALAPPDATA%\PetraDMS   (or the folder the owner chose in the setup wizard)
; which is outside the program folder. Installing a newer version or uninstalling removes only the program,
; never that data. A person uninstalling by hand is told so; silent uninstalls and upgrades show nothing.

!macro customUnInstall
  ${ifNot} ${isUpdated}
    IfSilent +2 0
    MessageBox MB_OK|MB_ICONINFORMATION "PetraDMS has been removed from this computer.$\r$\n$\r$\nYour business data was NOT deleted. It is still in:$\r$\n$LOCALAPPDATA\PetraDMS$\r$\n(or the data folder you chose when you first set up PetraDMS).$\r$\n$\r$\nDelete that folder yourself only if you are sure you no longer need the records."
  ${endIf}
!macroend
