# CI-01 · Сборка Windows и macOS в GitHub Actions

[Cross-platform build](../../.github/workflows/build-cross-platform.yml)
запускается для pull request, при push в `main` и вручную. Каждое задание
получает один и тот же `github.sha`. Для pull request это синтетический
merge commit GitHub. Обе сборки проверяют HEAD и архитектуру раннера.
Финальное задание запускается после успеха обеих платформ и заново проверяет
комплект, версию, SHA коммита и SHA-256 каждого пакета.

| Компонент | Версия или источник |
| --- | --- |
| Windows x64 | `windows-latest`, проверка `RUNNER_ARCH=X64` и `uname -m=x86_64` |
| macOS arm64 | `macos-15`, проверка `RUNNER_ARCH=ARM64` и `uname -m=arm64` |
| Go | 1.26.11, `GOTOOLCHAIN=local` на раннере |
| Node.js | 24.2.0, зависимости из `frontend/package-lock.json` через `npm ci` |
| Wails CLI | 2.17.0, версия сверяется с модулем Go |
| NSIS | 3.12.0 из Chocolatey, проверяется версия `makensis` |
| Python | 3.13.14; утилиты DMG из `build/darwin/dmg/requirements.txt` |
| GitHub Actions | Официальные actions закреплены полными commit SHA |

GitHub относит `macos-15` к Apple Silicon. SDK, Xcode и системный Edge
поставляет образ раннера. Версии Chromium и WebKit определяет Playwright
из lock-файла. [Справочник раннеров](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)

## Windows

`scripts/build-release.ps1 -RunChecks` выполняет frontend build, unit-тесты,
`go test ./...`, `go vet ./...` и прежнюю сборку Wails с per-user NSIS
и встроенным WebView2 bootstrapper. Сценарий сверяет версию и имя продукта
в ресурсах обоих EXE, затем вычисляет SHA-256. CI проверяет PE-заголовки
и извлекает вложенный EXE в новый временный каталог через существующий
режим `/UPDATESTAGE`. Этот режим не выполняет обычную установку. Setup
имеет штатный x86 NSIS-загрузчик. Portable и вложенное приложение должны
иметь архитектуру amd64 и совпадать по SHA-256. Playwright использует
headless Edge на Windows.

## macOS

`scripts/build-macos.sh` выполняет frontend build и unit-тесты,
Go test, vet и проверку встроенных ресурсов. Скрипт собирает production
Mach-O arm64, проверяет Info.plist, версию, bundle ID и минимальную macOS,
пакует лицензии и выполняет ad hoc codesign. Он использует тот же
[оформленный образ MAC-04A](../macos/MAC-04A-DMG-DESIGN.md) с тёмным
фоном, фиолетовой стрелкой и ярлыком Applications. DMG проверяется
`hdiutil`, монтируется только для чтения, сверяется с исходной .app
и повторно проходит проверку подписи. Playwright запускает headless
Chromium и WebKit.

## Артефакты и SHA-256

Каждая платформа загружает архив с именем `<платформа>-<SHA>`.
Итоговый архив `find-a-note-packages-<SHA>` появляется при успешной сборке
и повторной проверке всех пакетов. В нём находятся:

- `Find-a-Note-X.Y.Z-Windows-Setup.exe`
- `Find-a-Note-X.Y.Z-Windows-Portable.exe`
- `Find-a-Note-X.Y.Z-macOS-arm64.dmg`
- `SHA256SUMS.txt`
- `build-metadata.json` с версией, commit SHA и SHA-256 каждого пакета.

Файлы отбираются по точным именам. Отсутствие пакета, несовпадение
контрольной суммы, версии или commit SHA завершают задание ошибкой.
Метаданные фиксируют SHA checkout для запуска Actions. Извлеките итоговый
ZIP и проверьте его в распакованном каталоге:

```sh
shasum -a 256 -c SHA256SUMS.txt
```

В Windows можно сравнить каждый результат
`Get-FileHash -Algorithm SHA256 -LiteralPath <пакет>` с `SHA256SUMS.txt`.

## Запуск из интерфейса GitHub

Владелец с правом записи может открыть **Actions → Cross-platform build → Run
workflow**, выбрать ветку и запустить сборку. После завершения итоговый ZIP
доступен в разделе **Artifacts**. [Ручной запуск workflow](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)

## Подготовка релиза и ограничения

Workflow использует `contents: read` и не сохраняет checkout credentials.
Pull request из fork использует обычный `pull_request` с учётом правил
одобрения репозитория. В CI не передаются ключи или секреты публикации.
На скачанных пакетах нет release-манифеста или подписи manifest.

Перед релизом владелец сверяет SHA с утверждённым исходным коммитом,
повторно проверяет SHA-256 и проводит нативную приёмку. Manifest schema 1
подписывается существующим production-ключом на доверенной машине по
[процедуре передачи общего релиза](../release/RELEASE-MULTI-01-WINDOWS-HANDOFF.md).
Тег и GitHub Release требуют отдельного разрешения владельца. .app
использует ad hoc подпись, поэтому штатная политика Gatekeeper может
потребовать ручного подтверждения. Developer ID и notarization не входят
в CI.

Headless Playwright покрывает веб-интерфейс. Реальный Finder, WebView2
desktop, действия Gatekeeper, физический MIDI и установка на обычной
пользовательской машине требуют отдельного запуска. Режим
`/UPDATESTAGE` проверяет payload установщика, но не заменяет приёмку
обычной установки и отката.

## Проверка на GitHub Actions

[Прогон на main](https://github.com/pembrock/find-a-note/actions/runs/44797065930)
по событию `push` завершился успешно. Все три задания использовали
`8a96fd5d313fccc1fbf3c694807bc983a25a9fc4`.

| Задание | Результат |
| --- | --- |
| Windows amd64 | **PASS**. Setup и Portable проверены, 69 тестов Edge прошли. |
| macOS arm64 | **PASS**. DMG проверен, по 69 тестов Chromium и WebKit прошли. |
| Итоговый архив | **PASS**. Пакеты, SHA-256 и метаданные проверены, ZIP загружен в Actions. |

## Историческая локальная проверка до hosted-прогона

На Apple Silicon прошли `actionlint`, разбор PowerShell-сценариев,
production-сборка .app и DMG, 13 frontend unit-тестов, 64 теста Chromium,
64 теста WebKit, Go test и vet. Проверены macOS SHA-256, метаданные,
подпись и оформление образа. Проверка сводного архива выполнена с
реальным DMG и условными Windows-файлами. Она отклонила повреждённый
пакет, отсутствующий пакет и несовпадающий SHA. Go-кросс-компиляция дала
PE32+ amd64. Setup, Portable и Edge проверены в hosted-прогоне выше.
