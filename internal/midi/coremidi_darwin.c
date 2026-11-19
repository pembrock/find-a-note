//go:build darwin && cgo

#include <CoreMIDI/CoreMIDI.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <pthread.h>

static void fanTrace(const char *op, unsigned object, int status) {
    if (!getenv("FIND_A_NOTE_MIDI_TRACE")) return;
    uint64_t thread = 0;
    pthread_threadid_np(NULL, &thread);
    fprintf(stderr, "CoreMIDI %s object=%u status=%d thread=%llu loop=%p\n",
        op, object, status, (unsigned long long)thread, CFRunLoopGetCurrent());
}

static void fanNotify(const MIDINotification *message, void *ref) {
    fanTrace("notification", message->messageID, 0);
}
#include "_cgo_export.h"

OSStatus fanCreatePort(MIDIClientRef client, MIDIPortRef *port, uintptr_t token) {
    if (__builtin_available(macOS 11.0, *)) {
        return MIDIInputPortCreateWithProtocol(client, CFSTR("Find a Note Input"),
            kMIDIProtocol_1_0, port, ^(const MIDIEventList *list, void *ref) {
                if (list->protocol != kMIDIProtocol_1_0) return;
                const MIDIEventPacket *packet = list->packet;
                // UMP word counts by message type, including reserved types.
                static const unsigned sizes[] = {1,1,1,2,2,4,1,1,2,2,2,3,3,4,4,4};
                for (UInt32 p = 0; p < list->numPackets; p++) {
                    for (UInt32 i = 0; i < packet->wordCount;) {
                        uint32_t word = packet->words[i];
                        unsigned type = word >> 28;
                        if (sizes[type] > packet->wordCount - i) break;
                        if (type == 2) fanReceiveUMP(token, word);
                        i += sizes[type];
                    }
                    packet = MIDIEventPacketNext(packet);
                }
            });
    }
    return kMIDIWrongEndpointType;
}

OSStatus fanCreateClient(MIDIClientRef *client) {
    OSStatus status = MIDIClientCreate(CFSTR("Find a Note"), fanNotify, NULL, client);
    fanTrace("create-client", *client, status);
    return status;
}

int fanSourceName(MIDIEndpointRef source, char *name, CFIndex size) {
    CFStringRef value = NULL;
    OSStatus status = MIDIObjectGetStringProperty(source, kMIDIPropertyDisplayName, &value);
    fanTrace("display-name", source, status);
    if (status != noErr || !value)
        return 0;
    int ok = CFStringGetCString(value, name, size, kCFStringEncodingUTF8);
    CFRelease(value);
    return ok;
}

void fanPollRunLoop(void) {
    SInt32 result = CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.001, false);
    fanTrace("poll", 0, result);
}

OSStatus fanDisposeClient(MIDIClientRef client) {
    OSStatus status = MIDIClientDispose(client);
    fanTrace("dispose-client", client, status);
    return status;
}
OSStatus fanDisposePort(MIDIPortRef port) {
    OSStatus status = MIDIPortDispose(port);
    fanTrace("dispose-port", port, status);
    return status;
}
