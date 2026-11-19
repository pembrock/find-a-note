// A command-driven virtual source for the Darwin integration test.
#include <CoreMIDI/CoreMIDI.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

int main(void) {
    MIDIClientRef client;
    MIDIEndpointRef source = 0;
    if (MIDIClientCreate(CFSTR("Find a Note test"), NULL, NULL, &client)) return 1;
    char command[32];
    while (fgets(command, sizeof command, stdin)) {
        if (!strcmp(command, "open\n")) {
            if (source || MIDISourceCreateWithProtocol(client, CFSTR("Find a Note MAC-02 Test"),
                    kMIDIProtocol_1_0, &source)) return 2;
            if (MIDIObjectSetIntegerProperty(source, kMIDIPropertyUniqueID, 1702987654)) return 3;
        } else if (!strcmp(command, "close\n")) {
            if (MIDIEndpointDispose(source)) return 4;
            source = 0;
        } else if (!strcmp(command, "play\n")) {
            MIDIEventList list;
            const UInt32 words[] = {0x20903c64, 0x20914052, 0x20803c20, 0x20914000, 0x20904360};
            MIDIEventPacket *packet = MIDIEventListInit(&list, kMIDIProtocol_1_0);
            if (!MIDIEventListAdd(&list, sizeof list, packet, 0, 5, words)) return 5;
            if (MIDIReceivedEventList(source, &list)) return 6;
        } else {
            return 7;
        }
        if (getenv("FIND_A_NOTE_MIDI_TRACE")) {
            SInt32 unique = 0;
            OSStatus status = source ? MIDIObjectGetIntegerProperty(source, kMIDIPropertyUniqueID, &unique) : 0;
            fprintf(stderr, "fixture command=%s client=%u source=%u unique=%d status=%d\n", command, client, source, unique, status);
        }
        puts("OK");
        fflush(stdout);
    }
    if (source && MIDIEndpointDispose(source)) return 8;
    OSStatus status = MIDIClientDispose(client);
    if (getenv("FIND_A_NOTE_MIDI_TRACE"))
        fprintf(stderr, "fixture dispose-client=%u status=%d\n", client, status);
    return status != 0;
}
