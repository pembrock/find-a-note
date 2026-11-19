//go:build darwin && cgo

#include <CoreMIDI/CoreMIDI.h>
#include <stdint.h>
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
    return MIDIClientCreate(CFSTR("Find a Note"), NULL, NULL, client);
}

int fanSourceName(MIDIEndpointRef source, char *name, CFIndex size) {
    CFStringRef value = NULL;
    if (MIDIObjectGetStringProperty(source, kMIDIPropertyDisplayName, &value) != noErr || !value)
        return 0;
    int ok = CFStringGetCString(value, name, size, kCFStringEncodingUTF8);
    CFRelease(value);
    return ok;
}

void fanPollRunLoop(void) {
    CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.001, false);
}
