#import <AppKit/AppKit.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

static void record(NSString *event) {
    NSBundle *bundle = NSBundle.mainBundle;
    NSString *logPath = [bundle objectForInfoDictionaryKey:@"ProbeLogPath"];
    FILE *log = fopen(logPath.fileSystemRepresentation, "a");
    if (!log) {
        exit(74);
    }
    fprintf(log, "%s version=%s pid=%d bundle=%s\n", event.UTF8String,
            [[bundle objectForInfoDictionaryKey:@"CFBundleVersion"] UTF8String],
            getpid(), bundle.bundlePath.fileSystemRepresentation);
    fclose(log);
}

@interface Probe : NSObject <NSApplicationDelegate>
@property(strong) NSWindow *window;
@end

@implementation Probe
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    if ([NSProcessInfo.processInfo.arguments containsObject:@"--fail"]) {
        record(@"controlled-failure");
        exit(42);
    }

    self.window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 440, 140)
        styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable
        backing:NSBackingStoreBuffered defer:NO];
    self.window.title = [NSBundle.mainBundle objectForInfoDictionaryKey:@"CFBundleName"];
    [self.window center];
    [self.window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
    dispatch_async(dispatch_get_main_queue(), ^{
        if (!self.window.visible) {
            exit(70);
        }
        record(@"ready");
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC),
            dispatch_get_main_queue(), ^{
                [NSApp terminate:nil];
            });
    });
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender {
    return YES;
}
@end

int main(void) {
    @autoreleasepool {
        NSApplication *application = NSApplication.sharedApplication;
        [application setActivationPolicy:NSApplicationActivationPolicyRegular];
        Probe *probe = [Probe new];
        application.delegate = probe;
        [application run];
    }
}
