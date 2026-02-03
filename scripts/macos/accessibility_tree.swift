#!/usr/bin/env swift

import AppKit
import ApplicationServices
import Foundation

/// Structure representing an accessibility element with all its properties
struct AccessibilityElement: Codable {
    let role: String
    let title: String?
    let value: String?
    let description: String?
    let absolutePosition: String?
    let size: String?
    let enabled: Bool?
    let path: String
    let children: [AccessibilityElement]

    enum CodingKeys: String, CodingKey {
        case role, title, value, description
        case absolutePosition = "absolute_position"
        case size, enabled, path, children
    }
}

/// Manager for accessibility operations
class AccessibilityTreeExtractor {

    /// Check if accessibility permissions are granted
    static func checkPermissions() -> Bool {
        return AXIsProcessTrusted()
    }

    /// Get attribute value from an AXUIElement
    static func getAttribute(_ element: AXUIElement, _ attribute: String) -> Any? {
        var value: AnyObject?
        let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
        return result == .success ? value : nil
    }

    /// Get the frontmost application
    static func getFrontmostApp() -> NSRunningApplication? {
        return NSWorkspace.shared.frontmostApplication
    }

    /// Parse an accessibility element recursively
    static func parseElement(
        _ element: AXUIElement,
        depth: Int = 0,
        maxDepth: Int = 20,
        parentPath: String = "root"
    ) -> AccessibilityElement? {

        // Prevent infinite recursion
        guard depth <= maxDepth else {
            return nil
        }

        // Get basic attributes
        let role = getAttribute(element, kAXRoleAttribute as String) as? String ?? "Unknown"
        let title = getAttribute(element, kAXTitleAttribute as String) as? String
        let value = getAttribute(element, kAXValueAttribute as String)
        let description = getAttribute(element, kAXDescriptionAttribute as String) as? String
        let enabled = getAttribute(element, kAXEnabledAttribute as String) as? Bool

        // Get position (NSPoint)
        var absolutePosition: String?
        if let position = getAttribute(element, kAXPositionAttribute as String) {
            var point = CGPoint.zero
            if AXValueGetValue(position as! AXValue, .cgPoint, &point) {
                absolutePosition = String(format: "%.2f;%.2f", point.x, point.y)
            }
        }

        // Get size (NSSize)
        var elementSize: String?
        if let sizeValue = getAttribute(element, kAXSizeAttribute as String) {
            var size = CGSize.zero
            if AXValueGetValue(sizeValue as! AXValue, .cgSize, &size) {
                elementSize = String(format: "%.2f;%.2f", size.width, size.height)
            }
        }

        // Convert value to string if needed
        var valueString: String?
        if let val = value {
            if let str = val as? String {
                valueString = str
            } else if let num = val as? NSNumber {
                valueString = num.stringValue
            } else {
                valueString = String(describing: val)
            }
        }

        // Parse children recursively
        var childElements: [AccessibilityElement] = []
        if let children = getAttribute(element, kAXChildrenAttribute as String) as? [AXUIElement] {
            for (index, child) in children.enumerated() {
                let childPath = "\(parentPath)/\(role)[\(index)]"
                if let childElement = parseElement(child, depth: depth + 1, maxDepth: maxDepth, parentPath: childPath) {
                    childElements.append(childElement)
                }
            }
        }

        return AccessibilityElement(
            role: role,
            title: title,
            value: valueString,
            description: description,
            absolutePosition: absolutePosition,
            size: elementSize,
            enabled: enabled,
            path: parentPath,
            children: childElements
        )
    }

    /// Extract accessibility tree for the frontmost window
    static func extractTree() -> AccessibilityElement? {
        // Check permissions
        guard checkPermissions() else {
            fputs("Error: Accessibility permissions not granted\n", stderr)
            return nil
        }

        // Get frontmost app
        guard let app = getFrontmostApp() else {
            fputs("Error: No frontmost application\n", stderr)
            return nil
        }

        // Create AXUIElement for the app
        let appElement = AXUIElementCreateApplication(app.processIdentifier)

        // Get focused window
        guard let focusedWindowRef = getAttribute(appElement, kAXFocusedWindowAttribute as String) else {
            fputs("Error: No focused window\n", stderr)
            return nil
        }
        let focusedWindow = focusedWindowRef as! AXUIElement

        // Parse the entire tree
        return parseElement(focusedWindow, depth: 0, maxDepth: 20, parentPath: "root")
    }
}

// Main execution
let tree = AccessibilityTreeExtractor.extractTree()

if let tree = tree {
    // Encode to JSON
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]

    do {
        let jsonData = try encoder.encode(tree)
        if let jsonString = String(data: jsonData, encoding: .utf8) {
            print(jsonString)
            exit(0)
        } else {
            fputs("Error: Failed to convert JSON to string\n", stderr)
            exit(1)
        }
    } catch {
        fputs("Error: Failed to encode JSON - \(error.localizedDescription)\n", stderr)
        exit(1)
    }
} else {
    fputs("Error: Failed to extract accessibility tree\n", stderr)
    exit(1)
}
