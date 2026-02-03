#!/usr/bin/swift

import ApplicationServices
import Cocoa

// Get target app name or PID from command line
guard CommandLine.arguments.count > 1 else {
    print("Usage: enable_ax <app_name_or_pid>")
    exit(1)
}

let target = CommandLine.arguments[1]
let workspace = NSWorkspace.shared
let runningApps = workspace.runningApplications

var targetApp: NSRunningApplication?

// Try to parse as PID first
if let pid = Int32(target) {
    targetApp = runningApps.first(where: { $0.processIdentifier == pid })
} else {
    // Search by name
    targetApp = runningApps.first(where: {
        $0.localizedName == target ||
        $0.bundleIdentifier == target
    })
}

guard let app = targetApp else {
    print("ERROR: App '\(target)' not found")
    exit(1)
}

let pid = app.processIdentifier

// Create AXUIElement for the app
let appElement = AXUIElementCreateApplication(pid)

// Try to set AXManualAccessibility to true
let result = AXUIElementSetAttributeValue(
    appElement,
    "AXManualAccessibility" as CFString,
    kCFBooleanTrue
)

if result == .success {
    print("SUCCESS: Enabled AXManualAccessibility for '\(app.localizedName ?? target)' (PID: \(pid))")
    exit(0)
} else {
    print("ERROR: Failed to enable AXManualAccessibility (error code: \(result.rawValue))")
    exit(1)
}
