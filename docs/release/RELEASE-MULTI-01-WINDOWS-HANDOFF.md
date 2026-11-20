# RELEASE-MULTI-01 — передача сборки 0.4.0 на Windows

Ветка `release/0.4.0-preparation` ответвлена от MAC-05
`cdd2b2fbbf63283338f2eb155b1b371b88aa939b`. Точный релизный commit
передаётся в `SOURCE-REVISION.txt` и в ref локального Git bundle.
Комплект передачи включает исходники этого коммита, DMG, контрольные
суммы и заметки. Начинайте Windows-сессию с проверки этого комплекта.

## Получение точной ревизии

Скопируйте комплект на доверенную Windows-машину. В PowerShell внутри
клона выполните команды ниже. `$handoff` — полученный каталог комплекта.

```powershell
$commit = (Get-Content -Raw (Join-Path $handoff 'SOURCE-REVISION.txt')).Trim()
$ref = 'refs/heads/release/0.4.0-preparation'
$bundle = Join-Path $handoff 'Find-a-Note-0.4.0-preparation.bundle'

git bundle verify $bundle
if ($LASTEXITCODE -ne 0) { throw 'Invalid Git bundle' }
if ((git bundle list-heads $bundle $ref) -cne "$commit $ref") { throw 'Bundle revision mismatch' }

git fetch $bundle $ref
if ($LASTEXITCODE -ne 0 -or (git rev-parse FETCH_HEAD) -cne $commit) { throw 'Fetch revision mismatch' }
git switch -c release/0.4.0-preparation $commit
if ($LASTEXITCODE -ne 0 -or (git rev-parse HEAD) -cne $commit) { throw 'Checkout revision mismatch' }
git status --short --branch
```

Собирайте из отдельного чистого checkout. При наличии этой ветки проверьте
её HEAD и используйте отдельный worktree, сохранив имеющиеся файлы.

## Нативные проверки Windows

Windows 10/11 x64, WebView2 Runtime и Microsoft Edge, Go 1.25+,
Node.js 22+, Wails CLI 2.17.0, NSIS 3.x с `makensis` в PATH.
Выполните проверку в чистом тестовом Windows-профиле.

```powershell
wails doctor
Push-Location frontend
npm.cmd ci
npm.cmd run build
npm.cmd test
npm.cmd run test:ui
Pop-Location
go test ./...
go vet ./...
wails build -platform windows/amd64
./scripts/build-release.ps1
```

Проверяйте код завершения каждой команды. Артефакты лежат в
`artifacts/windows-0.4.0/`. Проверьте per-user Installer и Portable отдельно:

- `Find-a-Note-0.4.0-Windows-Setup.exe` и `Find-a-Note-0.4.0-Windows-Portable.exe`.
  У Setup, Portable и установленного EXE строки ProductVersion и FileVersion
  должны быть `0.4.0`, фиксированная версия — `0.4.0.0`, ProductName —
  `Find a Note`. Проверьте «О программе» в обоих запущенных вариантах.
- Подтвердите запуск через установленный WebView2, DWM, виртуальное пианино,
  звук, RU/EN и WinMM. Отдельно сообщите результат физического MIDI.
- Проверьте bundled лицензии и атрибуцию, SHA-256 обоих пакетов и совпадение
  установленного EXE с Portable. Проверьте повторную установку, сохранение
  профиля `%APPDATA%\Sonari.exe`, origin и значений `sonari.*`.
- Повторите совместимость с исходниками тегов `v0.2.2` и `v0.3.0`
  через `./scripts/test-update-legacy.sh` в Git Bash. При отсутствии тегов
  получите соответствующие публичные теги из origin. Тест проверяет подпись,
  Setup/Portable, игнорирование DMG, архитектуру и notes локально.
- Для нативной приёмки старых updater используйте отдельную VM и локальный
  GitHub-подобный стенд. Если нужна инструментированная сборка исторического
  тега для локального фида и временного ключа, держите её отдельно от
  релизных артефактов. Для каждой версии проверьте обнаружение 0.4.0,
  отображение notes, правильный выбор Installer/Portable, проверку подписи
  и байтов, подтверждение, перезапуск, сохранение профиля и rollback при
  неуспешном старте. Запишите commit, различия тестовой сборки и результаты.
  Тестовый feed и манифесты остаются локальными.

## Общий комплект и подписание

Граница текущей задачи — подготовка. Подписание production, теги и публикация
требуют отдельного разрешения владельца. Используйте существующую процедуру
обращения с ключом из [AGENTS.md](../../AGENTS.md) и [UPDATE-01](../UPDATE-01.md).
Production подпись создаётся на доверенной Windows-машине существующим
внешним ключом. В комплект передачи входят только публичные материалы.

1. Создайте новый staging-каталог для общего релиза. Перенесите в него оба
   прошедших проверку Windows EXE и `macos/Find-a-Note-0.4.0-macOS-arm64.dmg`
   из комплекта. На Windows сравните SHA-256 DMG с записью из
   `macos/SHA256SUMS.txt`, полученной с Mac. Аналогично проверьте EXE по суммам
   Windows-сборки. Используйте `Get-FileHash -Algorithm SHA256`.
2. Считайте версию из `wails.json` и передайте её генератору. После разрешения
   владельца выполните подготовленные команды из корня checkout. `$stage`
   указывает на новый staging-каталог, `$signingKey` предоставляется владельцем
   в доверенной среде согласно AGENTS.md.

   ```powershell
   $ErrorActionPreference = 'Stop'
   $version = (Get-Content -Raw wails.json | ConvertFrom-Json).info.productVersion
   if ($version -cne '0.4.0') { throw 'Unexpected source version' }

   go run ./cmd/update-manifest -macos -key $signingKey -version $version -dir $stage -notes docs/RELEASE-NOTES-0.4.0.md
   if ($LASTEXITCODE -ne 0) { throw 'Signing failed' }

   $manifest = Get-Content -Raw -Encoding UTF8 (Join-Path $stage 'update-manifest.json') | ConvertFrom-Json
   if ($manifest.schema -ne 1 -or $manifest.product -cne 'find-a-note' -or $manifest.version -cne $version -or $manifest.packages.Count -ne 3) {
       throw 'Unexpected manifest'
   }
   if ((Get-Item (Join-Path $stage 'update-manifest.sig')).Length -ne 64) { throw 'Invalid signature size' }
   $lines = foreach ($package in $manifest.packages) {
       $asset = Get-Item -LiteralPath (Join-Path $stage $package.name)
       $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $asset.FullName).Hash.ToLowerInvariant()
       if ($asset.Length -ne $package.size -or $hash -cne $package.sha256) { throw "Asset mismatch: $($package.name)" }
       "$hash  $($package.name)"
   }
   $lines | Set-Content -Encoding ascii (Join-Path $stage 'SHA256SUMS.txt')
   ```

   Генератор проверяет сырую подпись по закреплённому публичному ключу до
   записи файлов. Сохраните оригинальные байты manifest и sig. Проверьте
   записи `windows/amd64/installer` (`nsis-stage-v1`),
   `windows/amd64/portable` (`replace-exe`) и
   `darwin/arm64/dmg` (`manual-dmg`).
3. Для будущего GitHub Release подготовьте единый тег `v0.4.0` на проверенном
   коммите и один стабильный релиз. После разрешения владельца создайте draft,
   приложите три пакета, `update-manifest.json`, `update-manifest.sig`,
   `SHA256SUMS.txt` и предоставьте соответствующие исходники GPLv3.
   Используйте двуязычные заметки из комплекта. Сверьте подпись и суммы
   загруженных assets перед переводом draft в stable. Схема и процедура
   описаны в [MAC-05](../macos/MAC-05-UPDATE-CHANNEL.md).
