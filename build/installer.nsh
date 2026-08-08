!macro preInit
  ; Путь по умолчанию, если раньше программа ещё не устанавливалась.
  StrCpy $INSTDIR "$LOCALAPPDATA\Programs\coceLand"
!macroend

!define DIR_NAME "coceLand"

; Этот колбэк NSIS вызывает сам при ЛЮБОМ изменении пути на странице выбора
; папки - и когда юзер набирает путь руками, и когда жмёт "Обзор" и выбирает
; диск/папку. Если выбранный путь ещё не заканчивается на \coceLand - дописываем.
Function .onVerifyInstDir
  StrLen $0 "\${DIR_NAME}"
  StrCpy $1 "$INSTDIR" "" -$0
  StrCmp $1 "\${DIR_NAME}" skip_append
  StrCpy $INSTDIR "$INSTDIR\${DIR_NAME}"
  skip_append:
FunctionEnd
