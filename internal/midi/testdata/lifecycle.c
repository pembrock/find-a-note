// Standalone CoreMIDI run-loop ownership experiment; no Go driver or ports.
// Usage: ./lifecycle /absolute/path/to/compiled/source
#include <CoreMIDI/CoreMIDI.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>

static pthread_mutex_t mutex = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t changed = PTHREAD_COND_INITIALIZER;
static int phase;
static MIDIEndpointRef expected;
static FILE *commands, *replies;

static void require(int ok, const char *operation) {
    if (!ok) { fprintf(stderr, "FAIL: %s\n", operation); exit(1); }
}
static void command(const char *text) {
    fprintf(commands, "%s\n", text);
    fflush(commands);
    char reply[32];
    require(fgets(reply, sizeof reply, replies) && reply[0] == 'O', text);
}
static MIDIEndpointRef find(void) {
    for (ItemCount i = 0; i < MIDIGetNumberOfSources(); i++) {
        MIDIEndpointRef source = MIDIGetSource(i);
        SInt32 unique = 0;
        if (!MIDIObjectGetIntegerProperty(source, kMIDIPropertyUniqueID, &unique)
                && unique == 1702987654) return source;
    }
    return 0;
}
static void notify(const MIDINotification *message, void *ref) {
    fprintf(stderr, "notification=%u loop=%p\n", message->messageID, CFRunLoopGetCurrent());
}
static void advance(int next) {
    pthread_mutex_lock(&mutex);
    phase = next;
    pthread_cond_broadcast(&changed);
    pthread_mutex_unlock(&mutex);
}
static void waitPhase(int target) {
    pthread_mutex_lock(&mutex);
    while (phase < target) pthread_cond_wait(&changed, &mutex);
    pthread_mutex_unlock(&mutex);
}
static void *second(void *ref) {
    MIDIClientRef client = 0;
    require(!MIDIClientCreate(CFSTR("Lifecycle second"), notify, NULL, &client), "second client");
    command("open");
    // Give this thread's loop a bounded chance to deliver the topology change.
    CFAbsoluteTime deadline = CFAbsoluteTimeGetCurrent() + 1;
    while (!find() && CFAbsoluteTimeGetCurrent() < deadline)
        CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.01, false);
    MIDIEndpointRef before = find();
    fprintf(stderr, "second loop=%p before original loop: source=%u\n", CFRunLoopGetCurrent(), before);
    require(before == 0, "expected stale topology before pumping original loop");
    advance(1);
    waitPhase(2);
    MIDIEndpointRef after = find();
    fprintf(stderr, "second after original loop: source=%u expected=%u\n", after, expected);
    require(after != 0 && after == expected, "original loop restores topology without recreating source/client");
    require(!MIDIClientDispose(client), "dispose second client");
    return NULL;
}
int main(int argc, char **argv) {
    require(argc == 2, "fixture executable argument");
    alarm(10);
    int input[2], output[2];
    require(!pipe(input) && !pipe(output), "pipes");
    pid_t pid = fork();
    require(pid >= 0, "fork");
    if (!pid) {
        dup2(input[0], STDIN_FILENO); dup2(output[1], STDOUT_FILENO);
        close(input[0]); close(input[1]); close(output[0]); close(output[1]);
        execl(argv[1], argv[1], NULL); _exit(127);
    }
    close(input[0]); close(output[1]);
    commands = fdopen(input[1], "w"); replies = fdopen(output[0], "r");
    MIDIClientRef first = 0;
    require(!MIDIClientCreate(CFSTR("Lifecycle first"), notify, NULL, &first), "first client");
    fprintf(stderr, "first loop=%p\n", CFRunLoopGetCurrent());
    command("open");
    CFAbsoluteTime ready = CFAbsoluteTimeGetCurrent() + 3;
    while (!find() && CFAbsoluteTimeGetCurrent() < ready)
        CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.01, false);
    require(find() != 0, "first enumeration");
    require(!MIDIClientDispose(first), "dispose first client");
    command("close");
    pthread_t thread;
    require(!pthread_create(&thread, NULL, second, NULL), "second thread");
    waitPhase(1);
    CFAbsoluteTime deadline = CFAbsoluteTimeGetCurrent() + 3;
    while (!(expected = find()) && CFAbsoluteTimeGetCurrent() < deadline)
        CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.01, false);
    require(expected != 0, "source visible on original loop within 3 seconds");
    advance(2);
    pthread_join(thread, NULL);
    fclose(commands); fclose(replies);
    int status = 0;
    require(waitpid(pid, &status, 0) == pid && status == 0, "fixture cleanup");
    puts("PASS: pumping original run loop restored second client topology");
}
