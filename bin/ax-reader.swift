#!/usr/bin/env swift
/**
 * ax-reader - macOS Accessibility API reader
 * Equivalent of MsaaReader.exe for Windows
 *
 * Usage: ax-reader "Window Title"
 * Output: JSON with UI elements and their screen coordinates
 *
 * Requires: Accessibility permissions in System Preferences
 */

import Cocoa
import ApplicationServices

struct UIElement: Codable {
    let type: String
    let name: String
    let description: String?
    let x: Int
    let y: Int
    let width: Int
    let height: Int
    let isEnabled: Bool
}

struct Response: Codable {
    let window: String
    let elements: [UIElement]
    let error: String?
}

// Check if we have accessibility permissions
func checkAccessibilityPermissions() -> Bool {
    let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: false]
    return AXIsProcessTrustedWithOptions(options as CFDictionary)
}

// Get value from AXUIElement safely
func getValue<T>(_ element: AXUIElement, attribute: String) -> T? {
    var value: AnyObject?
    let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
    if result == .success {
        return value as? T
    }
    return nil
}

// Get CGRect position from AXUIElement
func getPosition(_ element: AXUIElement) -> CGRect? {
    guard let positionValue: AXValue = getValue(element, attribute: kAXPositionAttribute),
          let sizeValue: AXValue = getValue(element, attribute: kAXSizeAttribute) else {
        return nil
    }

    var position = CGPoint.zero
    var size = CGSize.zero

    AXValueGetValue(positionValue, .cgPoint, &position)
    AXValueGetValue(sizeValue, .cgSize, &size)

    return CGRect(origin: position, size: size)
}

// Map AX role to simplified type
func mapRoleToType(_ role: String) -> String {
    switch role {
    case "AXButton": return "Button"
    case "AXTextField": return "Edit"
    case "AXTextArea": return "Edit"
    case "AXStaticText": return "Text"
    case "AXImage": return "Image"
    case "AXCheckBox": return "CheckBox"
    case "AXRadioButton": return "RadioButton"
    case "AXComboBox": return "ComboBox"
    case "AXPopUpButton": return "ComboBox"
    case "AXScrollBar": return "ScrollBar"
    case "AXSlider": return "Slider"
    case "AXTabGroup": return "Tab"
    case "AXTable": return "Table"
    case "AXList": return "List"
    case "AXMenuItem": return "MenuItem"
    case "AXMenuButton": return "MenuItem"
    case "AXLink": return "Hyperlink"
    case "AXGroup": return "Group"
    case "AXWindow": return "Window"
    default: return role.replacingOccurrences(of: "AX", with: "")
    }
}

// Walk the accessibility tree recursively
func walkElement(_ element: AXUIElement, elements: inout [UIElement], depth: Int = 0, maxDepth: Int = 25) {
    if depth > maxDepth { return }

    // Get element info
    guard let role: String = getValue(element, attribute: kAXRoleAttribute) else { return }
    let title: String? = getValue(element, attribute: kAXTitleAttribute)
    let description: String? = getValue(element, attribute: kAXDescriptionAttribute)
    let help: String? = getValue(element, attribute: kAXHelpAttribute)
    let enabled: Bool = getValue(element, attribute: kAXEnabledAttribute) ?? true

    // Get position
    if let rect = getPosition(element) {
        // Only include elements with meaningful content or interactive types
        let name = title ?? description ?? help ?? ""
        let type = mapRoleToType(role)

        // Include interactive elements or elements with text
        let isInteractive = ["Button", "Edit", "CheckBox", "RadioButton", "ComboBox",
                             "MenuItem", "Link", "Slider", "Tab"].contains(type)
        let hasContent = !name.isEmpty

        if (isInteractive || hasContent) && rect.width > 0 && rect.height > 0 {
            elements.append(UIElement(
                type: type,
                name: name,
                description: help,
                x: Int(rect.origin.x),
                y: Int(rect.origin.y),
                width: Int(rect.width),
                height: Int(rect.height),
                isEnabled: enabled
            ))
        }
    }

    // Walk children
    if let children: [AXUIElement] = getValue(element, attribute: kAXChildrenAttribute) {
        for child in children {
            walkElement(child, elements: &elements, depth: depth + 1, maxDepth: maxDepth)
        }
    }
}

// Find window by title
func findWindow(titleFragment: String) -> AXUIElement? {
    let apps = NSWorkspace.shared.runningApplications

    for app in apps {
        // Skip apps without regular activation policy (background apps, etc.)
        guard app.activationPolicy == .regular else { continue }

        let appElement = AXUIElementCreateApplication(app.processIdentifier)

        // Try to get windows
        if let windows: [AXUIElement] = getValue(appElement, attribute: kAXWindowsAttribute) {
            for window in windows {
                if let windowTitle: String = getValue(window, attribute: kAXTitleAttribute) {
                    if windowTitle.localizedCaseInsensitiveContains(titleFragment) {
                        return window
                    }
                }
            }
        }

        // Fallback: try to get focused window of the app if app name matches
        if let appName = app.localizedName, appName.localizedCaseInsensitiveContains(titleFragment) {
            if let focusedWindow: AXUIElement = getValue(appElement, attribute: kAXFocusedWindowAttribute) {
                return focusedWindow
            }
            // Try main window
            if let mainWindow: AXUIElement = getValue(appElement, attribute: kAXMainWindowAttribute) {
                return mainWindow
            }
        }
    }

    return nil
}

// Main execution
func main() {
    // Check accessibility permissions
    if !checkAccessibilityPermissions() {
        let response = Response(
            window: "",
            elements: [],
            error: "Accessibility permissions not granted. Enable in System Preferences > Security & Privacy > Privacy > Accessibility"
        )
        if let json = try? JSONEncoder().encode(response) {
            print(String(data: json, encoding: .utf8) ?? "{}")
        }
        exit(1)
    }

    // Get window title from arguments
    let args = CommandLine.arguments
    if args.count < 2 {
        let response = Response(
            window: "",
            elements: [],
            error: "Usage: ax-reader \"Window Title\""
        )
        if let json = try? JSONEncoder().encode(response) {
            print(String(data: json, encoding: .utf8) ?? "{}")
        }
        exit(1)
    }

    let windowTitle = args[1]

    // Find window
    guard let window = findWindow(titleFragment: windowTitle) else {
        let response = Response(
            window: windowTitle,
            elements: [],
            error: "Window not found: \(windowTitle)"
        )
        if let json = try? JSONEncoder().encode(response) {
            print(String(data: json, encoding: .utf8) ?? "{}")
        }
        exit(1)
    }

    // Walk accessibility tree
    var elements: [UIElement] = []
    walkElement(window, elements: &elements)

    // Output JSON
    let response = Response(
        window: windowTitle,
        elements: elements,
        error: nil
    )

    let encoder = JSONEncoder()
    encoder.outputFormatting = .prettyPrinted

    if let json = try? encoder.encode(response) {
        print(String(data: json, encoding: .utf8) ?? "{}")
    }
}

main()
