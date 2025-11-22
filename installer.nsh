; Скрипт для установщика NSIS
; Устанавливает для всех пользователей

!macro customInstall
  ; Устанавливаем для всех пользователей
  SetShellVarContext all
!macroend

!macro customUnInstall
  ; Удаляем для всех пользователей
  SetShellVarContext all
!macroend

