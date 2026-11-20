# CI-02 — подготовка кроссплатформенного релиза Find a Note

## Сборка и происхождение пакетов

[Cross-platform build](../../.github/workflows/build-cross-platform.yml) собирает
Windows Setup и Portable, а также DMG для Apple Silicon. Используются
существующие `build-release.ps1`, `verify-ci-windows.ps1` и `build-macos.sh`.
Windows проверяет ProductName, версии обоих EXE, PE-архитектуру Portable и
идентичность payload установщика Portable. У Setup штатный x86-загрузчик NSIS,
payload — amd64. macOS проверяет идентификатор, обе версии Info.plist, Mach-O
arm64, ad hoc-подпись и байты .app в смонтированном DMG.

Владелец утверждает версию, ветку и полный SHA из `main` или ветки
release-кандидата в `pembrock/find-a-note`. Версия берётся из
`wails.json`, поле `info.productVersion`. Запустите **Actions → Cross-platform
build → Run workflow** на утверждённой ветке или используйте успешный прогон
`push` в `main`. В интерфейсе проверьте SHA и сохраните ID запуска и номер
попытки из URL вида `/actions/runs/<ID>/attempts/<attempt>`. Повторный запуск
выполняйте через **Re-run all jobs**, чтобы Windows, macOS и итоговый архив
относились к одной попытке. PR собирает синтетический merge commit. События PR
и прогоны на тегах отклоняются при подготовке стабильного релиза.

Архив `find-a-note-packages-<SHA>-<attempt>` берётся через GitHub API из
указанного запуска. Локальный инструмент проверяет статус попытки, workflow,
репозиторий, SHA, ветку, событие, SHA-256 архива, точный список файлов и
`build-metadata.json`. Метаданные связывают файлы с нативными проверками
платформ. Каждый пакет сверяется с `SHA256SUMS.txt`. Если версия, SHA,
платформы или попытка отличаются, подготовка прекращается.

## Подготовка комплекта на Windows

Работайте из корня чистого checkout с CI-02. Требуются Python 3.10+, Go из
`go.mod` и Git в PATH. Предоставьте через окружение сессии `GH_TOKEN` с
доступом Actions: Read для скачивания архива. Для публикации токену дополнительно
нужен Contents: Write. Передавайте токен через утверждённый способ хранения
учётных данных, исключая вывод значения в журнал.

Подготовьте UTF-8 Markdown с двумя непустыми разделами `## English` и
`## Русский`, всего до 4096 байт. Укажите изменения, требования платформ и ссылку
на соответствующий исходный код с утверждённым SHA. Значения в угловых скобках
замените утверждёнными значениями. Родитель выходного каталога должен
существовать, сам каталог создаётся командой.

```powershell
$version = (Get-Content -Raw wails.json | ConvertFrom-Json).info.productVersion
$commit = '<полный утверждённый SHA>'
$branch = '<main или ветка release-кандидата>'
$runId = '<ID запуска>'
$attempt = '<номер попытки>'
$directory = "release-$version-$attempt"
$releaseArgs = @('--version', $version, '--commit', $commit, '--branch', $branch,
                 '--run-id', $runId, '--attempt', $attempt, '--directory', $directory)
python -B scripts/release-pipeline.py prepare @releaseArgs --notes '<файл заметок>'
if ($LASTEXITCODE -ne 0) { throw 'Release preparation failed' }
```

Каталог содержит три пакета, `SHA256SUMS.txt`, исходный
`build-metadata.json`, двуязычный `RELEASE-NOTES.md` и
`release-metadata.json`. Последний содержит версию, SHA коммита, run ID,
попытку, ID и digest артефакта, SHA-256 и размеры трёх пакетов.

## Подписание и контроль

Отдельно получите разрешение владельца на использование существующего
production-ключа. Выполняйте `sign` только на доверенной Windows-машине.
Ключ остаётся вне репозитория и выходного каталога. В CI, GitHub Secrets,
артефакты, журналы и на Mac передаются только публичные материалы без
приватного ключа. В переменной `$signingKey` должен быть путь, предоставленный
владельцем в доверенной сессии.

```powershell
$confirmation = "v$version@$commit"
python -B scripts/release-pipeline.py sign @releaseArgs --confirm $confirmation --key $signingKey
if ($LASTEXITCODE -ne 0) { throw 'Release signing failed' }
python -B scripts/release-pipeline.py verify @releaseArgs
if ($LASTEXITCODE -ne 0) { throw 'Signed release verification failed' }
```

Перед подписью инструмент повторно получает архив по исходным ID и сверяет
происхождение, версию, SHA-256 и размеры. Существующий
[`cmd/update-manifest`](../../cmd/update-manifest) формирует канонический
schema 1, сравнивает содержимое манифеста с проверенными файлами и индексом
пакетов, затем подписывает Ed25519. Проверка закреплённым публичным ключом
выполняется до записи и повторно для записанного комплекта. Результат —
`update-manifest.json` и сырая 64-байтовая подпись `update-manifest.sig`.
Обе языковые секции входят в поле `notes`. Записи
`windows/amd64/installer`, `windows/amd64/portable` и `darwin/arm64/dmg`
сохраняют методы schema 1. Подписанные файлы сохраняйте побайтно.

## Публикация после отдельного разрешения

Предыдущий стабильный v0.4.0 опубликован одним релизом с тремя пакетами,
суммами, манифестом и подписью. Его тег указывает на
`14e085b24c85f47a81e255a63a0a631f6d7b0bdf`. CI-02 переносит проверки
существующей Windows-процедуры на единый комплект. [Релиз v0.4.0](https://github.com/pembrock/find-a-note/releases/tag/v0.4.0)

Только после разрешения владельца на тег и GitHub Release один оператор
выполняет команды ниже с теми же параметрами и подписанным комплектом.

```powershell
python -B scripts/release-pipeline.py publish @releaseArgs --confirm $confirmation
if ($LASTEXITCODE -ne 0) { throw 'Inspect GitHub state before retrying' }
python -B scripts/release-pipeline.py verify-public @releaseArgs
if ($LASTEXITCODE -ne 0) { throw 'Public release verification failed' }
```

`publish` проверяет отсутствие тега и релиза, создаёт draft и загружает восемь
файлов — три пакета, manifest, подпись, SHA256SUMS, notes и release metadata.
Инструмент сверяет размер, SHA-256 и байты каждого файла, проверяет скачанную
подпись, затем создаёт тег на точном SHA и переводит draft в стабильный latest.
После публикации проверяются публичный тег, latest, заметки, URL и байты
всех assets, а также скачанный подписанный манифест. Отдельная команда
`verify-public` выполняет тот же контроль в режиме чтения.

## Восстановление

- Если подготовка прервалась, повторите её с теми же ID и SHA. При истечении
  срока хранения артефакта получите новую полную успешную попытку для того же
  утверждённого SHA и подготовьте новый комплект с новым номером попытки.
- При ошибке подписи проверьте совпадение комплекта и закреплённого ключа.
  Если локальная пара файлов осталась после сбоя, повторите подготовку в
  новый каталог. Существующая пара защищена от перезаписи.
- После сетевой ошибки при публикации проверьте состояние GitHub. Если
  релиз уже публичен, выполните `verify-public`. Если остался ожидаемый
  draft, проверьте его ID, тело, целевой SHA и статус файлов. Повторите
  `publish` с тем же подтверждением и `--resume-draft <ID>`. Допустим только
  тот же draft и уже загруженные файлы с совпадающими размерами и SHA-256.
  Инструмент повторно скачает все draft assets перед публикацией.
- При конфликте, неполном asset со статусом `starter`, неверном теге или
  иной неожиданной записи остановитесь и разберите состояние с владельцем.
  Операции API не образуют транзакцию. Автоматического удаления, замены
  assets или отката тега нет. Если GitHub ещё обновляет latest, повторите
  только проверку после появления релиза в публичном API.

## Будущий выпуск 0.4.1

1. После принятия CI-02 подготовьте release-кандидат. Проверьте изменения
   относительно v0.4.0, установите `info.productVersion` в `0.4.1` и
   подготовьте `docs/RELEASE-NOTES-0.4.1.md` с реальными изменениями на двух
   языках. Утвердите полный SHA этого коммита.
2. Дождитесь успешной сборки указанной ревизии. Подставьте её SHA, ветку,
   run ID и попытку в команды подготовки. Передайте
   `--notes docs/RELEASE-NOTES-0.4.1.md` и получите три пакета версии 0.4.1.
3. Проверьте обычную установку и обновление в изолированных профилях
   Windows и macOS. После отдельного разрешения подпишите комплект и
   выполните `verify`.
4. После отдельного разрешения на публикацию запустите `publish` с
   подтверждением вида `v0.4.1@<SHA>`. Проверьте `verify-public`, затем
   обнаружение обновления у Windows Installer, Portable и macOS.

## Проверки и ограничения CI-02

```powershell
python -B scripts/test-release-pipeline.py -v
go test ./cmd/update-manifest ./internal/update
```

В Git Bash запустите `bash scripts/test-update-legacy.sh`, чтобы сверить
schema 1 с исходниками опубликованных 0.2.2, 0.3.0 и 0.4.0. Тесты используют
локальный HTTP-стенд, фиктивные пакеты и временные Ed25519-ключи. Тесты
publisher используют подменённый GitHub API. Нативные проверки, живой прогон
CI для CI-02, production-подпись, тег и публичный релиз 0.4.1 относятся к
следующему отдельно разрешённому этапу. Workflow сохраняет исходную модель
ad hoc codesign на macOS и существующую схему обновлений.
