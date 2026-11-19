# MAC-02A · Lifecycle CoreMIDI

Дата: 20 ноября 2026. База: `feature/mac-02-coremidi`,
`d0e11fd62d2c66423b3d42dd9d13d3c02ce5b2c8`.
Итог: **PASS** для воспроизводимого виртуального lifecycle на этой машине.
MAC-03–06, push, теги и публикации не выполнялись.

## Установленная причина

Ошибка в управлении временем жизни **потока/run loop production-драйвера**.
`MIDIClientCreate` привязывает notifications к run loop первого вызова в процессе,
а не каждого нового клиента. Это прямо описано в установленном SDK,
`CoreMIDI.framework/Headers/MIDIServices.h`, раздел `MIDIClientCreate`.
`MIDIClientDispose` не переносит эту привязку на следующий поток.

Раньше каждый manager вызывал `runtime.LockOSThread` при создании своего клиента,
а при Close делал `UnlockOSThread`. Manager завершался, следующий мог получить
другой системный поток. Его `CFRunLoopRunInMode` обслуживал другой run loop.
CoreMIDI сохранял устаревший список handles; чтение свойств уже удалённого
endpoint возвращало `-50`. Отсюда `Name:CoreMIDI`, пустой `Identity` и невозможность
обнаружить новый источник. Это не доказательство существования endpoint с
неполными свойствами на стороне MIDI-сервера: в данном сбое handle был устаревшим.

Первый baseline `count=2` прошёл. Затем baseline `count=10` дал 3 PASS / 7 FAIL,
включая:

```text
unexpected state: {Devices:[{ID:1323070| Name:CoreMIDI Identity:}] ...}
```

Диагностический прогон старого lifecycle показал:

```text
create-client object=1749028 status=0 thread=1838171 loop=0x7aeb400000
dispose-client object=1749028 status=0 thread=1838171 loop=0x7aeb400000
create-client object=1749034 status=0 thread=1838163 loop=0x102adeeb0
display-name object=1749032 status=-50 thread=1838163 loop=0x102adeeb0
```

При этом fixture после `open` сам успешно читал `UniqueID=1702987654`.
Увеличивать ожидание, повторять чтение с произвольными retry или принимать
пустую identity в тесте не требуется и не делалось.

## Изоляция причины

Добавлен независимый `internal/midi/testdata/lifecycle.c`. В нём нет Go,
production-драйвера, входных портов, receive block и таблицы токенов.
Первый клиент создаётся, перечисляет источник и освобождается на главном потоке.
Источник удаляется. Второй клиент создаётся на другом pthread; fixture создаёт
новый endpoint. Обработка run loop второго потока в течение ограниченной одной
секунды не обновляет topology. Затем первый поток обрабатывает **исходный**
run loop до появления ожидаемого UniqueID (не более трёх секунд).
Тот же второй клиент сразу видит тот же новый endpoint. Ни клиент, ни fixture
на этапе восстановления не пересоздаются. Общая граница эксперимента — 10 секунд
через `alarm`, ожидания фазы синхронизированы condition variable, sleep отсутствует.

Фактический результат:

```text
first loop=0x1035366d0
second loop=0x753d424000 before original loop: source=0
notification=2 loop=0x1035366d0
notification=4 loop=0x1035366d0
notification=3 loop=0x1035366d0
notification=2 loop=0x1035366d0
notification=4 loop=0x1035366d0
notification=1 loop=0x1035366d0
second after original loop: source=6823976 expected=6823976
PASS: pumping original run loop restored second client topology
```

Первый вариант C-пробы без исходного перечисления не воспроизводил устаревшую
топологию. Финальная проба повторяет исходное перечисление, как приложение.
Исследовательские запуски с block API не использованы для доказательства:
часть запусков пересеклась с другим fixture с тем же фиксированным ID.
Эти логи сохранены локально, но исключены из итоговой матрицы.
Все финальные MIDI-прогоны выполнены последовательно.

## Исправление и ресурсы

Минимальное изменение области владения run loop: один лениво создаваемый
служебный Go worker с `LockOSThread`, общий для процесса. Создание клиента,
перечисление/poll и освобождение клиента выполняются синхронно на нём.
Manager продолжает владеть своим клиентом и входом; общий интерфейс, Windows,
алгоритмы тренировок и аудио не меняются.

- **MIDIClient:** каждый manager создаёт и действительно освобождает свой client;
  после Shutdown тест проверяет `client == 0`.
- **Порты/подключения:** прежний путь Start/Disconnect/Dispose сохранён.
  Логи подтверждают успешный create/connect/dispose. Disconnect удалённого
  endpoint может вернуть `-50`; последующий DisposePort успешен. Это прежнее
  допустимое поведение при hot unplug, отдельно от stale topology.
- **Receive block/токены:** block по-прежнему захватывает только числовой токен.
  Close удаляет токен, через mutex дожидается текущего sink и обнуляет его,
  затем освобождает порт. Тест проверяет пустую таблицу после Shutdown;
  проверка отсутствия нот после Disconnect сохранена.
- **Manager:** Shutdown дожидается завершения manager goroutine и освобождения
  client. Run loop worker после Shutdown намеренно остаётся до выхода процесса:
  это один общий системный поток, а не новый оставленный поток на каждый client.
  Между запросами он заблокирован на Go channel, busy polling отсутствует.
  Завершать его при каждом Shutdown нельзя: следующий client снова получил бы
  неверный run loop. Освобождение этого системного потока — при выходе процесса.
- **Notifications:** поздние уведомления обрабатываются исходным run loop при
  очередном перечислении. Уведомления не захватывают Go receiver/client и
  не публикуют ноты. Сохраняется существующая модель polling менеджера.
- **Fixture:** проверяется exit status; при EOF явно освобождаются оставшийся
  endpoint и клиент. Во время проверки повторного production-клиента fixture
  и endpoint остаются живыми, что отделяет production lifecycle от fixture.
- **CFString:** копирование имени и `CFRelease` прежние.

Добавленная диагностика включается `FIND_A_NOTE_MIDI_TRACE=1`: native handle,
OSStatus, thread ID, адрес CFRunLoop, ID уведомлений, статусы портов и подключения,
команды/UniqueID и завершение fixture. По умолчанию диагностические логи выключены.
Существующий ограниченный poll CFRunLoop и интервал Refresh не увеличены.

## Проверки

Среда: Apple Silicon arm64, macOS 27.2.1 (26B131), SDK 27.2,
Go 1.25.0; race — установленный Go 1.26.11; Wails 2.17.0.

| Проверка | Итог |
| --- | --- |
| Воспроизведение baseline `count=10` | **PASS** как воспроизведение; исходный код **FAIL**, 7/10 lifecycle |
| Независимая C-проба причины | **PASS**, восстановление через исходный run loop |
| Финальный `go test -count=1 -v ./...` с fixture | **PASS** |
| Финальный `go test -count=2 -v ./internal/midi` с fixture | **PASS**, 2/2 integration |
| Финальный `go test -count=10 -v ./internal/midi` с trace/fixture | **PASS**, 10/10 integration, два manager/client на каждый тест |
| `go test -race -count=2 ./internal/midi ./internal/update` с fixture | **PASS**, Go 1.26.11 |
| `go vet ./...` | **PASS** |
| Frontend build / `npm test` | **PASS**, 13 тестов; прежние предупреждения Radix/chunk size |
| Production `CGO_ENABLED=1 wails build -platform darwin/arm64 -m -nosyncgomod -skipbindings` | **PASS** |
| Mach-O `file`, `lipo -archs`; `plutil -lint` | **PASS**, arm64 / корректный plist |
| Обнаружение, Note On/Off, каналы/velocity, отключение, reconnect по ID | **PASS**, виртуальный CoreMIDI source |
| Disconnect, Shutdown, очистка токенов, повторный client при живом endpoint | **PASS**, native integration |
| Симулированные manager-сценарии / stale callbacks / UMP | **PASS**, Go suite |
| Yamaha P-45 / Nektar SE25, звук, физический USB | **NOT TESTED**, физические устройства/сценарии не упражнялись |
| Windows application suite / Windows build | **NOT TESTED**, нет Windows runner; общие и Windows исходники не изменены |
| GUI, Playwright, старые macOS, другие приложения — владельцы первого CoreMIDI run loop | **NOT TESTED**, вне этой проверки lifecycle |

Первоначальные sandbox-прогоны не достигали сценария: MIDIClientCreate возвращал
`-10833`, tsx — `EPERM` при создании IPC pipe, Wails — exit 1 при компиляции.
Указанные PASS получены после разрешённых запусков вне sandbox. Это отдельные
ограничения окружения, они не объясняют воспроизведённый stale endpoint.

## Повторение и артефакты

Из корня репозитория, вне ограничений sandbox для CoreMIDI; запускать по очереди,
без других экземпляров fixture с UniqueID `1702987654`:

```sh
mkdir -p artifacts/mac-02a
clang -framework CoreMIDI -framework CoreFoundation internal/midi/testdata/source.c -o artifacts/mac-02a/source
clang -framework CoreMIDI -framework CoreFoundation internal/midi/testdata/lifecycle.c -o artifacts/mac-02a/lifecycle
artifacts/mac-02a/lifecycle "$PWD/artifacts/mac-02a/source"
FIND_A_NOTE_MIDI_TRACE=1 FIND_A_NOTE_MIDI_FIXTURE="$PWD/artifacts/mac-02a/source" go test -timeout=90s -count=1 -v ./...
FIND_A_NOTE_MIDI_FIXTURE="$PWD/artifacts/mac-02a/source" go test -timeout=90s -count=2 -v ./internal/midi
FIND_A_NOTE_MIDI_TRACE=1 FIND_A_NOTE_MIDI_FIXTURE="$PWD/artifacts/mac-02a/source" go test -timeout=90s -count=10 -v ./internal/midi
GOTOOLCHAIN=go1.26.11 FIND_A_NOTE_MIDI_FIXTURE="$PWD/artifacts/mac-02a/source" go test -race -timeout=90s -count=2 -v ./internal/midi ./internal/update
go vet ./...
CGO_ENABLED=1 /Users/pembrock/go/bin/wails build -platform darwin/arm64 -m -nosyncgomod -skipbindings
```

Локальные логи: `artifacts/mac-02a/{baseline-count10,trace-before,native-experiment,count1,count2,count10,race,vet,frontend-build,frontend-test,production-build}.log`.
Текущий .app: `build/bin/find-a-note.app`.
Предыдущая сборка сохранена: `artifacts/mac-02a/baseline-find-a-note.app`.
Артефакты не включаются в коммит. Новых зависимостей и ключей нет.

Ветка: `feature/mac-02-coremidi`. Итоговый HEAD — локальный коммит с этим отчётом
(полный hash приведён в ответе; также `git log -1 --format=%H`).
После коммита tracked tree чист; пользовательские `.DS_Store`,
`build/.DS_Store`, `docs/.DS_Store` остаются untracked и не изменялись намеренно.

Ограничение: это приёмка виртуального CoreMIDI lifecycle на указанной машине;
аппаратная MIDI/аудио и Windows приёмка не заявляются.
